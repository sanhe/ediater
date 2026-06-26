import { describe, expect, it } from "vitest";
import { EditCoalescer, LastWins } from "./coalescer";
import { DEFAULT_LOG_CONFIG } from "./config";

const cfg = DEFAULT_LOG_CONFIG;

describe("EditCoalescer", () => {
  it("accumulates a burst and summarizes net/added/removed from deltas", () => {
    const c = new EditCoalescer();
    // Type "abc" (0->1->2->3) then delete one char (3->2).
    c.add("/f.ts", ".ts", 0, 1, 1000);
    c.add("/f.ts", ".ts", 1, 2, 1010);
    c.add("/f.ts", ".ts", 2, 3, 1020);
    c.add("/f.ts", ".ts", 3, 2, 1030);

    // Not yet idle: nothing flushes.
    expect(c.drainReady(1030 + cfg.idleMs - 1, cfg)).toEqual([]);

    const ready = c.drainReady(1030 + cfg.idleMs, cfg);
    expect(ready).toHaveLength(1);
    const s = ready[0];
    expect(s.path).toBe("/f.ts");
    expect(s.ext).toBe(".ts");
    expect(s.edits).toBe(4);
    expect(s.fromLength).toBe(0);
    expect(s.toLength).toBe(2);
    expect(s.netChars).toBe(2);
    expect(s.addedChars).toBe(3);
    expect(s.removedChars).toBe(1);
    expect(s.burstMs).toBe(30);
    expect(c.pendingCount).toBe(0);
  });

  it("flushes by edit-count cap", () => {
    const c = new EditCoalescer();
    const capped = { ...cfg, maxEditsPerBurst: 3 };
    c.add("/f", undefined, 0, 1, 0);
    c.add("/f", undefined, 1, 2, 1);
    expect(c.shouldFlushNow("/f", capped)).toBe(false);
    c.add("/f", undefined, 2, 3, 2);
    expect(c.shouldFlushNow("/f", capped)).toBe(true);
    // Flushes despite not being idle.
    expect(c.drainReady(2, capped)).toHaveLength(1);
  });

  it("flushes by span cap", () => {
    const c = new EditCoalescer();
    const spanned = { ...cfg, maxBurstMs: 100 };
    c.add("/f", undefined, 0, 1, 0);
    c.add("/f", undefined, 1, 2, 100);
    expect(c.shouldFlushNow("/f", spanned)).toBe(true);
    expect(c.drainReady(100, spanned)).toHaveLength(1);
  });

  it("force-drains a single path and all paths", () => {
    const c = new EditCoalescer();
    c.add("/a", undefined, 0, 1, 0);
    c.add("/b", undefined, 0, 2, 0);
    expect(c.drainPath("/a")?.path).toBe("/a");
    expect(c.drainPath("/missing")).toBeUndefined();
    const all = c.drainAll();
    expect(all.map((s) => s.path)).toEqual(["/b"]);
    expect(c.pendingCount).toBe(0);
  });
});

describe("LastWins", () => {
  it("keeps only the latest value per key", () => {
    const lw = new LastWins<number>();
    lw.set("k", 1);
    lw.set("k", 2);
    expect(lw.size).toBe(1);
    expect(lw.has("k")).toBe(true);
    expect(lw.take("k")).toBe(2);
    expect(lw.take("k")).toBeUndefined();
  });

  it("drains all pending values", () => {
    const lw = new LastWins<number>();
    lw.set("a", 1);
    lw.set("b", 2);
    expect(lw.drainAll().sort()).toEqual([1, 2]);
    expect(lw.size).toBe(0);
  });
});
