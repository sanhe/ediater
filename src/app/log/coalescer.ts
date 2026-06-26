/**
 * Pure coalescing primitives for the action log. No timers, no IO — the facade
 * drives these with timers and turns the results into events. Keeping them pure
 * makes the flush logic exhaustively unit-testable.
 */

import type { LogConfig } from "./config";

/** Content-free summary of one burst of edits to a single document. */
export interface EditSummary {
  path: string;
  ext?: string;
  edits: number;
  netChars: number;
  addedChars: number;
  removedChars: number;
  fromLength: number;
  toLength: number;
  burstMs: number;
}

interface Burst {
  ext?: string;
  firstTs: number;
  lastTs: number;
  edits: number;
  fromLength: number;
  toLength: number;
  addedChars: number;
  removedChars: number;
}

function summarize(path: string, b: Burst): EditSummary {
  const summary: EditSummary = {
    path,
    edits: b.edits,
    netChars: b.toLength - b.fromLength,
    addedChars: b.addedChars,
    removedChars: b.removedChars,
    fromLength: b.fromLength,
    toLength: b.toLength,
    burstMs: b.lastTs - b.firstTs,
  };
  if (b.ext) summary.ext = b.ext;
  return summary;
}

/**
 * Accumulates per-path edit bursts. An edit is recorded as a (fromLength,
 * toLength) length transition — never content — so typing produces one summary
 * per burst instead of one event per keystroke.
 */
export class EditCoalescer {
  private readonly bursts = new Map<string, Burst>();

  /** Record one edit. Lengths are character counts of the buffer. */
  add(
    path: string,
    ext: string | undefined,
    fromLength: number,
    toLength: number,
    now: number,
  ): void {
    const delta = toLength - fromLength;
    const existing = this.bursts.get(path);
    if (!existing) {
      this.bursts.set(path, {
        ext,
        firstTs: now,
        lastTs: now,
        edits: 1,
        fromLength,
        toLength,
        addedChars: delta > 0 ? delta : 0,
        removedChars: delta < 0 ? -delta : 0,
      });
      return;
    }
    existing.lastTs = now;
    existing.toLength = toLength;
    existing.edits += 1;
    if (delta > 0) existing.addedChars += delta;
    else if (delta < 0) existing.removedChars += -delta;
    if (ext && !existing.ext) existing.ext = ext;
  }

  /** True once a burst meets any flush condition. */
  private shouldFlush(b: Burst, now: number, cfg: LogConfig): boolean {
    return (
      now - b.lastTs >= cfg.idleMs ||
      b.edits >= cfg.maxEditsPerBurst ||
      b.lastTs - b.firstTs >= cfg.maxBurstMs
    );
  }

  /** Does a burst currently meet an immediate (count/span) flush condition? */
  shouldFlushNow(path: string, cfg: LogConfig): boolean {
    const b = this.bursts.get(path);
    if (!b) return false;
    return (
      b.edits >= cfg.maxEditsPerBurst || b.lastTs - b.firstTs >= cfg.maxBurstMs
    );
  }

  /** Drain every burst that is ready to flush at `now`. */
  drainReady(now: number, cfg: LogConfig): EditSummary[] {
    const out: EditSummary[] = [];
    for (const [path, b] of this.bursts) {
      if (this.shouldFlush(b, now, cfg)) {
        out.push(summarize(path, b));
        this.bursts.delete(path);
      }
    }
    return out;
  }

  /** Force-drain one path (used before doc.save / doc.close). */
  drainPath(path: string): EditSummary | undefined {
    const b = this.bursts.get(path);
    if (!b) return undefined;
    this.bursts.delete(path);
    return summarize(path, b);
  }

  /** Force-drain everything (used on run.end). */
  drainAll(): EditSummary[] {
    const out: EditSummary[] = [];
    for (const [path, b] of this.bursts) out.push(summarize(path, b));
    this.bursts.clear();
    return out;
  }

  get pendingCount(): number {
    return this.bursts.size;
  }
}

/**
 * Last-write-wins buffer keyed by a string. Used to collapse high-churn
 * actions (split resize, active-tab churn): only the latest value per key
 * survives until it is taken. Pure; the facade attaches timers.
 */
export class LastWins<T> {
  private readonly pending = new Map<string, T>();

  set(key: string, value: T): void {
    this.pending.set(key, value);
  }

  take(key: string): T | undefined {
    const v = this.pending.get(key);
    this.pending.delete(key);
    return v;
  }

  drainAll(): T[] {
    const out = [...this.pending.values()];
    this.pending.clear();
    return out;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  get size(): number {
    return this.pending.size;
  }
}
