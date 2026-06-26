/**
 * Action-log tunables. Pure module: a default config plus the env opt-out.
 *
 * These mirror the persistence/debounce style used elsewhere in the app. All
 * durations are milliseconds; sizes are counts of events unless noted.
 */

/** How paths are recorded. Local-only IDE, so "full" is the default. */
export type PathScope = "full" | "relative" | "basename";

export interface LogConfig {
  /** Master switch. When false, every log.* call is a no-op. */
  enabled: boolean;
  /** How file paths are redacted before they reach disk. */
  pathScope: PathScope;

  // Edit coalescing (per path).
  /** Idle gap that closes an edit burst. */
  idleMs: number;
  /** Max edits before a burst is force-flushed. */
  maxEditsPerBurst: number;
  /** Max wall-clock span before a burst is force-flushed. */
  maxBurstMs: number;

  // Last-wins collapsing (resize / active-tab churn).
  collapseMs: number;

  // fs-changed sampling.
  fsSample: number;

  // Batching / flush (mirrors createDebouncedPersister).
  batchSize: number;
  flushMs: number;
  /** Hard cap on the in-memory ring buffer; drop oldest past this. */
  maxBuffer: number;

  // Privacy.
  /** Truncate error messages to this many chars. */
  maxErrLen: number;
}

export const DEFAULT_LOG_CONFIG: LogConfig = {
  enabled: true,
  pathScope: "full",

  idleMs: 750,
  maxEditsPerBurst: 200,
  maxBurstMs: 5000,

  collapseMs: 300,

  fsSample: 5,

  batchSize: 64,
  flushMs: 2000,
  maxBuffer: 5000,

  maxErrLen: 500,
};

/**
 * Resolve the effective config, honouring the build-time opt-out
 * `VITE_EDIATER_LOG=off`. Defensive: any access failure falls back to enabled.
 */
export function resolveLogConfig(
  overrides?: Partial<LogConfig>,
): LogConfig {
  let enabled = DEFAULT_LOG_CONFIG.enabled;
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> })
      .env;
    if (env && String(env.VITE_EDIATER_LOG).toLowerCase() === "off") {
      enabled = false;
    }
  } catch {
    // import.meta.env unavailable (e.g. some test runners) — keep default.
  }
  return { ...DEFAULT_LOG_CONFIG, enabled, ...overrides };
}
