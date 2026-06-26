/**
 * The impure tail of the logger: an in-memory ring buffer that batches
 * pre-serialized JSONL lines and flushes them to the Rust sink.
 *
 * Mirrors createDebouncedPersister (debounce + flushNow) but adds a size
 * trigger, a bounded buffer (drop-oldest), and a recursion guard. Every method
 * is defensive: a logger must never throw into or block the app.
 */

import { invoke } from "@tauri-apps/api/core";
import type { LogConfig } from "./config";

/** Pushes a batch of pre-serialized JSONL lines to durable storage. */
export type LogSink = (lines: string[]) => Promise<unknown>;

/**
 * The production sink: a RAW Tauri invoke (never routed through the traced IPC
 * wrappers, so logging can never recursively log itself).
 */
export function appendActionLogLines(lines: string[]): Promise<unknown> {
  return invoke("append_action_log", { lines });
}

export class LogClient {
  private buffer: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlush = false;

  constructor(
    private readonly sink: LogSink,
    private readonly cfg: LogConfig,
  ) {}

  /** Buffer one serialized line; flush by size, by timer, or immediately. */
  push(line: string, immediate = false): void {
    try {
      this.buffer.push(line);
      if (this.buffer.length > this.cfg.maxBuffer) {
        // Drop the oldest to bound memory if the sink is wedged.
        this.buffer.splice(0, this.buffer.length - this.cfg.maxBuffer);
      }
      if (immediate || this.buffer.length >= this.cfg.batchSize) {
        this.flushNow();
      } else {
        this.schedule();
      }
    } catch {
      // Never propagate.
    }
  }

  private schedule(): void {
    if (this.timer) return;
    try {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushNow();
      }, this.cfg.flushMs);
    } catch {
      // setTimeout unavailable — drop the schedule; size trigger still works.
    }
  }

  /** Flush the current batch fire-and-forget. Safe to call any time. */
  flushNow(): void {
    try {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.inFlush || this.buffer.length === 0) return;
      const batch = this.buffer;
      this.buffer = [];
      this.inFlush = true;
      const settle = () => {
        // Drop the batch on failure (bounded memory); the monotonic seq lets a
        // consumer detect the gap. Then drain anything buffered mid-flush.
        this.inFlush = false;
        if (this.buffer.length > 0) this.schedule();
      };
      try {
        // Dispatch the sink synchronously so the IPC is initiated immediately
        // (important on the unload path, where a deferred microtask may not run).
        void Promise.resolve(this.sink(batch)).then(settle, settle);
      } catch {
        // Sink threw synchronously — recover and keep going.
        settle();
      }
    } catch {
      this.inFlush = false;
    }
  }

  get bufferLength(): number {
    return this.buffer.length;
  }
}
