/**
 * The action-log facade: the single object the rest of the app talks to.
 *
 * It owns the run id + monotonic sequence, the synchronous cause stack, the
 * edit coalescer and last-wins collapsers, and drives their timers — then hands
 * serialized events to the LogClient. Every public method is wrapped so a
 * logging fault can never throw into or block the app, and is a no-op when
 * logging is disabled. The app-callback path (e.g. command.run's fn) always
 * executes regardless of logging outcome.
 */

import {
  LogClient,
  appendActionLogLines,
  type LogSink,
} from "./client";
import { resolveLogConfig, type LogConfig } from "./config";
import { EditCoalescer, LastWins, type EditSummary } from "./coalescer";
import {
  commandPayload,
  fsChangedPayload,
  makeFileRef,
  sessionEvent,
  type EventDescriptor,
} from "./mapping";
import {
  extOf,
  redactPath,
  toErrorMessage,
  type RedactContext,
} from "./redact";
import {
  LOG_SCHEMA_VERSION,
  type ActionEvent,
  type ActionPayload,
  type ActionSource,
  type ActionVerb,
  type CommandVia,
  type IoDigest,
} from "./schema";
import type { SessionAction } from "../session/reducer";
import type { SessionData } from "../session/sessionData";

interface RecordExtra {
  causeId?: number;
  durMs?: number;
  outcome?: "ok" | "error";
  error?: { message: string };
}

export interface RunStartInfo {
  appVersion?: string;
  platform?: string;
  /** Active theme preference at start: a theme id or "system". */
  theme: string;
}

export interface LoggerOptions {
  config?: Partial<LogConfig>;
  sink?: LogSink;
  client?: LogClient;
  runId?: string;
}

function genRunId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // fall through
  }
  return `run-${Date.now().toString(36)}-${Math.floor(
    Math.random() * 1e9,
  ).toString(36)}`;
}

export class ActionLogger {
  private readonly cfg: LogConfig;
  private readonly client: LogClient;
  private readonly runId: string;

  private seq = 0;
  private started = false;
  private ended = false;
  private readonly causeStack: number[] = [];
  private redactCtx: RedactContext = {};
  private pendingCommandVia: { via: CommandVia; keybinding?: string } | null =
    null;

  private readonly edits = new EditCoalescer();
  private editTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly collapser = new LastWins<EventDescriptor>();
  private readonly collapseTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(options: LoggerOptions = {}) {
    this.cfg = resolveLogConfig(options.config);
    this.client =
      options.client ??
      new LogClient(options.sink ?? appendActionLogLines, this.cfg);
    this.runId = options.runId ?? genRunId();
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  // ── context ──────────────────────────────────────────────────────────────

  /** Set the absolute home dir (collapsed to "~" in "full" path scope). */
  setHome(home: string): void {
    try {
      this.redactCtx = { ...this.redactCtx, home };
    } catch {
      /* never throw */
    }
  }

  /** Set the open workspace roots (used to relativize paths). */
  setRoots(roots: string[]): void {
    try {
      this.redactCtx = { ...this.redactCtx, roots };
    } catch {
      /* never throw */
    }
  }

  /** Tell the logger how the next command was triggered (palette/keybinding). */
  setNextCommandSource(via: CommandVia, keybinding?: string): void {
    try {
      this.pendingCommandVia = { via, keybinding };
    } catch {
      /* never throw */
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  runStart(info: RunStartInfo): void {
    // Idempotent: at most one run.start per run, even if the mounting effect
    // fires twice (React StrictMode dev double-invoke, remounts).
    if (!this.cfg.enabled || this.started) return;
    this.started = true;
    try {
      this.record("run.start", "system", {
        kind: "run",
        appVersion: info.appVersion ?? "unknown",
        platform: info.platform ?? "unknown",
        theme: info.theme,
        schemaVersion: LOG_SCHEMA_VERSION,
      });
    } catch {
      /* never throw */
    }
  }

  runEnd(): void {
    // Idempotent: safe to call from more than one unload signal.
    if (!this.cfg.enabled || this.ended) return;
    this.ended = true;
    try {
      this.flushPending();
      this.record("run.end", "system");
      this.client.flushNow();
    } catch {
      /* never throw */
    }
  }

  /** Flush all buffered/coalesced work to disk now (best-effort). */
  flushNow(): void {
    if (!this.cfg.enabled) return;
    try {
      this.flushPending();
      this.client.flushNow();
    } catch {
      /* never throw */
    }
  }

  // ── reducer dispatches ─────────────────────────────────────────────────────

  /** Log a dispatched SessionAction using the state *before* it applied. */
  dispatch(action: SessionAction, prev: SessionData): void {
    if (!this.cfg.enabled) return;
    try {
      const desc = sessionEvent(action, prev, this.cfg.pathScope, this.redactCtx);
      if (desc.collapseKey) this.emitCollapsible(desc.collapseKey, desc);
      else this.record(desc.action, desc.source, desc.payload);
    } catch {
      /* never throw */
    }
  }

  // ── commands ───────────────────────────────────────────────────────────────

  /**
   * Run a command's body, recording a `command.run` event whose seq becomes the
   * cause of any synchronous dispatch/IO the body triggers. The body always
   * runs and its result/throw is passed through unchanged.
   */
  command<T>(
    cmd: { id: string; title: string; keybinding?: string },
    fn: () => T,
  ): T {
    if (!this.cfg.enabled) return fn();
    let pushedCause = false;
    try {
      const via = this.pendingCommandVia?.via ?? "palette";
      const keybinding = this.pendingCommandVia?.keybinding;
      this.pendingCommandVia = null;
      const seq = this.record(
        "command.run",
        "command",
        commandPayload(cmd, via, keybinding),
      );
      if (seq > 0) {
        this.causeStack.push(seq);
        pushedCause = true;
      }
    } catch {
      /* logging must not stop the command */
    }
    try {
      return fn();
    } finally {
      if (pushedCause) {
        try {
          this.causeStack.pop();
        } catch {
          /* never throw */
        }
      }
    }
  }

  // ── document ops ────────────────────────────────────────────────────────────

  docOpen(
    path: string,
    info: { bytes: number; lines: number; readonly: boolean },
  ): void {
    if (!this.cfg.enabled) return;
    try {
      this.record("doc.open", "document", {
        kind: "docOpen",
        file: this.fileRef(path),
        bytes: info.bytes,
        lines: info.lines,
        readonly: info.readonly,
      });
    } catch {
      /* never throw */
    }
  }

  /** Record one edit (length transition only) into the coalescer. */
  docEdit(path: string, fromLength: number, toLength: number): void {
    if (!this.cfg.enabled) return;
    try {
      this.edits.add(path, extOf(path), fromLength, toLength, Date.now());
      if (this.edits.shouldFlushNow(path, this.cfg)) this.flushEdits();
      else this.scheduleEditFlush();
    } catch {
      /* never throw */
    }
  }

  docSave(
    path: string,
    info: { bytes: number; wasDirty: boolean; version: number },
  ): void {
    if (!this.cfg.enabled) return;
    try {
      this.forceFlushEdit(path); // keep edit-then-save ordering
      this.record("doc.save", "document", {
        kind: "docSave",
        file: this.fileRef(path),
        bytes: info.bytes,
        wasDirty: info.wasDirty,
        version: info.version,
      });
    } catch {
      /* never throw */
    }
  }

  docClose(path: string, dirty: boolean): void {
    if (!this.cfg.enabled) return;
    try {
      this.forceFlushEdit(path);
      this.record("doc.close", "document", {
        kind: "docClose",
        file: this.fileRef(path),
        dirty,
      });
    } catch {
      /* never throw */
    }
  }

  // ── backend IO spans ───────────────────────────────────────────────────────

  /**
   * Wrap a backend IO call as a span: records `io.<command>` with a duration,
   * outcome, and a content-free digest when it resolves/rejects. The original
   * promise (value or rejection) is passed through untouched.
   */
  ioSpan<T>(
    command: string,
    op: () => Promise<T>,
    buildDigest: (result: T) => IoDigest,
  ): Promise<T> {
    if (!this.cfg.enabled) return op();
    let startTs = 0;
    let cause: number | undefined;
    try {
      startTs = Date.now();
      cause = this.currentCause();
    } catch {
      /* never throw */
    }
    let result: Promise<T>;
    try {
      result = op();
    } catch (err) {
      this.emitIo(command, {}, "error", startTs, cause, err);
      throw err;
    }
    return result.then(
      (r) => {
        let digest: IoDigest = {};
        try {
          digest = buildDigest(r);
        } catch {
          digest = {};
        }
        this.emitIo(command, digest, "ok", startTs, cause, undefined);
        return r;
      },
      (err) => {
        this.emitIo(command, {}, "error", startTs, cause, err);
        throw err;
      },
    );
  }

  // ── backend events ──────────────────────────────────────────────────────────

  fsChanged(paths: string[]): void {
    if (!this.cfg.enabled) return;
    try {
      this.record(
        "fs.changed",
        "event",
        fsChangedPayload(
          paths,
          this.cfg.fsSample,
          this.cfg.pathScope,
          this.redactCtx,
        ),
      );
    } catch {
      /* never throw */
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private currentCause(): number | undefined {
    return this.causeStack.length > 0
      ? this.causeStack[this.causeStack.length - 1]
      : undefined;
  }

  private fileRef(path: string) {
    return makeFileRef(path, this.cfg.pathScope, this.redactCtx);
  }

  /** Assign a seq, build the event, hand it to the client. Returns the seq. */
  private record(
    action: ActionVerb,
    source: ActionSource,
    payload?: ActionPayload,
    extra?: RecordExtra,
  ): number {
    if (!this.cfg.enabled) return 0;
    try {
      this.seq += 1;
      const event: ActionEvent = {
        v: LOG_SCHEMA_VERSION,
        runId: this.runId,
        seq: this.seq,
        ts: Date.now(),
        action,
        source,
      };
      const causeId = extra?.causeId ?? this.currentCause();
      if (causeId !== undefined) event.causeId = causeId;
      if (extra?.durMs !== undefined) event.durMs = extra.durMs;
      if (extra?.outcome !== undefined) event.outcome = extra.outcome;
      if (extra?.error !== undefined) event.error = extra.error;
      if (payload !== undefined) event.payload = payload;
      const line = JSON.stringify(event);
      this.client.push(line, extra?.outcome === "error");
      return this.seq;
    } catch {
      return 0;
    }
  }

  private emitIo(
    command: string,
    digest: IoDigest,
    outcome: "ok" | "error",
    startTs: number,
    cause: number | undefined,
    err: unknown,
  ): void {
    try {
      const extra: RecordExtra = {
        causeId: cause,
        durMs: Math.max(0, Date.now() - startTs),
        outcome,
      };
      if (outcome === "error") {
        extra.error = { message: toErrorMessage(err, this.cfg.maxErrLen) };
      }
      // Redact any path embedded in the digest to honour pathScope.
      const safeDigest = digest.path
        ? {
            ...digest,
            path: redactPath(digest.path, this.cfg.pathScope, this.redactCtx),
          }
        : digest;
      this.record(`io.${command}` as ActionVerb, "ipc", {
        kind: "io",
        command,
        digest: safeDigest,
      }, extra);
    } catch {
      /* never throw */
    }
  }

  private emitCollapsible(key: string, desc: EventDescriptor): void {
    this.collapser.set(key, desc);
    const existing = this.collapseTimers.get(key);
    if (existing) clearTimeout(existing);
    try {
      const t = setTimeout(() => {
        this.collapseTimers.delete(key);
        const d = this.collapser.take(key);
        if (d) this.record(d.action, d.source, d.payload);
      }, this.cfg.collapseMs);
      this.collapseTimers.set(key, t);
    } catch {
      // No timer: emit immediately so the event isn't lost.
      const d = this.collapser.take(key);
      if (d) this.record(d.action, d.source, d.payload);
    }
  }

  private scheduleEditFlush(): void {
    if (this.editTimer) return;
    try {
      this.editTimer = setTimeout(() => {
        this.editTimer = null;
        this.flushEdits();
      }, this.cfg.idleMs);
    } catch {
      /* size/span triggers still apply */
    }
  }

  private flushEdits(): void {
    try {
      if (this.editTimer) {
        clearTimeout(this.editTimer);
        this.editTimer = null;
      }
      for (const s of this.edits.drainReady(Date.now(), this.cfg)) {
        this.recordEdit(s);
      }
      if (this.edits.pendingCount > 0) this.scheduleEditFlush();
    } catch {
      /* never throw */
    }
  }

  private forceFlushEdit(path: string): void {
    const s = this.edits.drainPath(path);
    if (s) this.recordEdit(s);
  }

  private recordEdit(s: EditSummary): void {
    this.record("doc.edit", "document", {
      kind: "docEdit",
      file: this.fileRef(s.path),
      edits: s.edits,
      netChars: s.netChars,
      addedChars: s.addedChars,
      removedChars: s.removedChars,
      fromLength: s.fromLength,
      toLength: s.toLength,
      burstMs: s.burstMs,
    });
  }

  private flushPending(): void {
    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    for (const s of this.edits.drainAll()) this.recordEdit(s);
    for (const t of this.collapseTimers.values()) clearTimeout(t);
    this.collapseTimers.clear();
    for (const d of this.collapser.drainAll()) {
      this.record(d.action, d.source, d.payload);
    }
  }
}

export function createLogger(options?: LoggerOptions): ActionLogger {
  return new ActionLogger(options);
}

/** Process-wide logger singleton. */
export const log = createLogger();
