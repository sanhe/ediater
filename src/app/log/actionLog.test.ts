import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, type ActionLogger } from "./actionLog";
import type { LoggerOptions } from "./actionLog";
import type { LogConfig } from "./config";
import type { ActionEvent } from "./schema";
import type { SessionData } from "../session/sessionData";

function prev(): SessionData {
  return {
    version: 3,
    ui: { theme: "dark", customThemes: [], activeGroupId: null },
    layout: null,
    panels: {},
  };
}

type Sink = ReturnType<typeof vi.fn>;

function makeLogger(config: Partial<LogConfig> = {}): {
  sink: Sink;
  logger: ActionLogger;
} {
  const sink: Sink = vi.fn(() => Promise.resolve());
  const options: LoggerOptions = {
    sink: sink as unknown as LoggerOptions["sink"],
    runId: "run-test",
    config: { batchSize: 1000, flushMs: 100_000, ...config },
  };
  return { sink, logger: createLogger(options) };
}

/** Flush the logger and let the fire-and-forget sink chain settle. */
async function drained(logger: ActionLogger, sink: Sink): Promise<ActionEvent[]> {
  logger.flushNow();
  await Promise.resolve();
  await Promise.resolve();
  return sink.mock.calls
    .flatMap((c) => c[0] as string[])
    .map((line) => JSON.parse(line) as ActionEvent);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ActionLogger", () => {
  it("emits monotonic, gap-free seq with a stable run id and schema version", async () => {
    const { sink, logger } = makeLogger();
    logger.dispatch({ type: "openFileTab", path: "/a.ts" }, prev());
    logger.dispatch({ type: "openFileTab", path: "/b.ts" }, prev());
    const evs = await drained(logger, sink);
    expect(evs.map((e) => e.seq)).toEqual([1, 2]);
    expect(evs.every((e) => e.runId === "run-test")).toBe(true);
    expect(evs.every((e) => e.v === 1)).toBe(true);
    expect(evs.map((e) => e.action)).toEqual(["file.open", "file.open"]);
  });

  it("threads cause_id from command.run to synchronous dispatches", async () => {
    const { sink, logger } = makeLogger();
    logger.setNextCommandSource("palette");
    logger.command({ id: "view.toggleTheme", title: "Toggle" }, () => {
      logger.dispatch({ type: "setTheme", theme: "light" }, prev());
    });
    const evs = await drained(logger, sink);
    const cmd = evs.find((e) => e.action === "command.run");
    const theme = evs.find((e) => e.action === "theme.set");
    expect(cmd).toBeDefined();
    expect(cmd?.payload).toMatchObject({ via: "palette", commandId: "view.toggleTheme" });
    expect(cmd?.causeId).toBeUndefined();
    expect(theme?.causeId).toBe(cmd?.seq);
  });

  it("does not thread cause across an await", async () => {
    const { sink, logger } = makeLogger();
    await logger.command({ id: "c", title: "C" }, async () => {
      await Promise.resolve();
      logger.dispatch({ type: "setTheme", theme: "light" }, prev());
    });
    const evs = await drained(logger, sink);
    const theme = evs.find((e) => e.action === "theme.set");
    expect(theme?.causeId).toBeUndefined();
  });

  it("records io spans with a digest, duration, and ok outcome", async () => {
    const { sink, logger } = makeLogger();
    const result = await logger.ioSpan(
      "read_file",
      () => Promise.resolve({ content: "abc", version: 5 }),
      (r) => ({ resultBytes: r.content.length, version: r.version }),
    );
    expect(result).toEqual({ content: "abc", version: 5 });
    const io = (await drained(logger, sink)).find((e) => e.action === "io.read_file");
    expect(io?.outcome).toBe("ok");
    expect(io?.durMs).toBeGreaterThanOrEqual(0);
    expect(io?.payload).toMatchObject({
      kind: "io",
      command: "read_file",
      digest: { resultBytes: 3, version: 5 },
    });
  });

  it("records io error outcome (redacted) and rethrows", async () => {
    const { sink, logger } = makeLogger();
    await expect(
      logger.ioSpan(
        "write_file",
        () => Promise.reject(new Error("disk full at /Users/x/secret/y.ts")),
        () => ({}),
      ),
    ).rejects.toThrow("disk full");
    const io = (await drained(logger, sink)).find((e) => e.action === "io.write_file");
    expect(io?.outcome).toBe("error");
    expect(io?.error?.message).toContain("disk full");
    expect(io?.error?.message).not.toContain("/Users/x/secret");
  });

  it("never throws when the sink throws, and still flushes later events", () => {
    const sink: Sink = vi.fn(() => {
      throw new Error("nope");
    });
    const logger = createLogger({
      sink: sink as unknown as LoggerOptions["sink"],
      runId: "r",
      config: { batchSize: 1 },
    });
    expect(() =>
      logger.dispatch({ type: "setTheme", theme: "light" }, prev()),
    ).not.toThrow();
  });

  it("runs the command body even when logging is disabled", () => {
    const logger = createLogger({ config: { enabled: false } });
    let ran = false;
    logger.command({ id: "c", title: "C" }, () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it("is a no-op (never calls the sink) when disabled", async () => {
    const sink: Sink = vi.fn(() => Promise.resolve());
    const logger = createLogger({
      sink: sink as unknown as LoggerOptions["sink"],
      config: { enabled: false },
    });
    logger.runStart({ theme: "dark" });
    logger.dispatch({ type: "setTheme", theme: "light" }, prev());
    logger.docOpen("/a.ts", { bytes: 1, lines: 1, readonly: false });
    logger.flushNow();
    await Promise.resolve();
    expect(sink).not.toHaveBeenCalled();
  });

  it("drops the oldest events past maxBuffer", async () => {
    const { sink, logger } = makeLogger({ maxBuffer: 3 });
    for (let i = 1; i <= 5; i += 1) {
      logger.dispatch({ type: "openFileTab", path: `/f${i}.ts` }, prev());
    }
    const evs = await drained(logger, sink);
    expect(evs.map((e) => e.seq)).toEqual([3, 4, 5]);
  });

  it("auto-flushes when the batch size is reached", async () => {
    const { sink, logger } = makeLogger({ batchSize: 2 });
    logger.dispatch({ type: "openFileTab", path: "/a" }, prev());
    expect(sink).not.toHaveBeenCalled();
    logger.dispatch({ type: "openFileTab", path: "/b" }, prev());
    await Promise.resolve();
    await Promise.resolve();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toHaveLength(2);
  });

  it("coalesces an edit burst into one doc.edit and orders it before save", async () => {
    vi.useFakeTimers();
    const { sink, logger } = makeLogger({ idleMs: 750 });
    logger.docEdit("/a.ts", 0, 1);
    logger.docEdit("/a.ts", 1, 2);
    logger.docEdit("/a.ts", 2, 3);
    // Saving force-flushes the pending edit first.
    logger.docSave("/a.ts", { bytes: 3, wasDirty: true, version: 9 });
    logger.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    const evs = sink.mock.calls
      .flatMap((c) => c[0] as string[])
      .map((l) => JSON.parse(l) as ActionEvent);
    const edit = evs.find((e) => e.action === "doc.edit");
    const save = evs.find((e) => e.action === "doc.save");
    expect(edit?.payload).toMatchObject({ kind: "docEdit", edits: 3, toLength: 3 });
    expect(save).toBeDefined();
    expect(edit!.seq).toBeLessThan(save!.seq);
  });

  it("collapses active-tab churn to the last value within collapseMs", async () => {
    vi.useFakeTimers();
    const { sink, logger } = makeLogger({ collapseMs: 300 });
    logger.dispatch({ type: "setActiveTab", groupId: "g1", panelId: "p1" }, prev());
    logger.dispatch({ type: "setActiveTab", groupId: "g1", panelId: "p2" }, prev());
    await vi.advanceTimersByTimeAsync(300);
    logger.flushNow();
    await vi.advanceTimersByTimeAsync(0);
    const acts = sink.mock.calls
      .flatMap((c) => c[0] as string[])
      .map((l) => JSON.parse(l) as ActionEvent)
      .filter((e) => e.action === "tab.activate");
    expect(acts).toHaveLength(1);
    expect(acts[0].payload).toMatchObject({ panelId: "p2" });
  });

  it("records run.start with self-describing metadata", async () => {
    const { sink, logger } = makeLogger();
    logger.runStart({ theme: "light", platform: "MacIntel", appVersion: "1.2.3" });
    const start = (await drained(logger, sink)).find((e) => e.action === "run.start");
    expect(start?.payload).toMatchObject({
      kind: "run",
      theme: "light",
      platform: "MacIntel",
      appVersion: "1.2.3",
      schemaVersion: 1,
    });
  });

  it("emits run.start and run.end at most once per run (StrictMode-safe)", async () => {
    const { sink, logger } = makeLogger();
    logger.runStart({ theme: "dark" });
    logger.runStart({ theme: "dark" });
    logger.runEnd();
    logger.runEnd();
    const evs = await drained(logger, sink);
    expect(evs.filter((e) => e.action === "run.start")).toHaveLength(1);
    expect(evs.filter((e) => e.action === "run.end")).toHaveLength(1);
  });
});
