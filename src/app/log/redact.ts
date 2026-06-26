/**
 * Pure path/error redaction for the action log.
 *
 * The log records paths so a downstream AI can correlate events to files, but
 * the scope is configurable. Nothing here touches IO; the facade supplies the
 * home dir and workspace roots as context.
 */

import type { PathScope } from "./config";

export interface RedactContext {
  /** Absolute home directory, collapsed to "~" in "full" mode. */
  home?: string;
  /** Open workspace roots, used to relativize in "relative" mode. */
  roots?: string[];
}

/** Last path segment (filename), tolerant of "/" and "\\" separators. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** Lowercase extension including the dot (".ts"), or undefined when none. */
export function extOf(path: string): string | undefined {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  // No extension for "" / "name" / dotfiles like ".gitignore".
  if (dot <= 0 || dot === name.length - 1) return undefined;
  return name.slice(dot).toLowerCase();
}

function relativize(path: string, roots: string[] | undefined): string | null {
  if (!roots) return null;
  // Prefer the longest matching root so nested roots relativize correctly.
  let best: string | null = null;
  for (const root of roots) {
    if (!root) continue;
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (path === root) return baseName(path);
    if (path.startsWith(prefix) && (best === null || root.length > best.length)) {
      best = root;
    }
  }
  if (best === null) return null;
  const rel = path.slice(best.length).replace(/^[/\\]+/, "");
  return rel.length > 0 ? rel : baseName(path);
}

/**
 * Redact a single path according to `scope`.
 *  - "full":     keep the path; collapse a leading home dir to "~".
 *  - "relative": make it relative to the nearest open root (else fall back to full).
 *  - "basename": keep only the filename.
 */
export function redactPath(
  path: string,
  scope: PathScope,
  ctx: RedactContext = {},
): string {
  if (!path) return path;
  switch (scope) {
    case "basename":
      return baseName(path);
    case "relative": {
      const rel = relativize(path, ctx.roots);
      if (rel !== null) return rel;
      return collapseHome(path, ctx.home);
    }
    case "full":
    default:
      return collapseHome(path, ctx.home);
  }
}

function collapseHome(path: string, home: string | undefined): string {
  if (!home) return path;
  const h = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === h) return "~";
  if (path.startsWith(`${h}/`)) return `~${path.slice(h.length)}`;
  return path;
}

/**
 * Redact an error message: collapse any absolute-looking paths to basenames
 * (errors often embed user paths), then truncate. Always returns a string.
 */
export function redactErrorMessage(
  message: string,
  maxLen: number,
): string {
  // Reduce absolute path-like runs to their basename to avoid leaking trees.
  // Separator-agnostic so Windows backslash paths are scrubbed too (the colon
  // in a drive letter like "C:" naturally bounds the match).
  const scrubbed = message.replace(
    /(?:[/\\][^\s/\\:]+){2,}/g,
    (match) => `…/${baseName(match)}`,
  );
  return scrubbed.length > maxLen ? `${scrubbed.slice(0, maxLen)}…` : scrubbed;
}

/** Coerce any thrown value into a redacted, bounded error message. */
export function toErrorMessage(err: unknown, maxLen: number): string {
  let raw: string;
  if (err instanceof Error) raw = err.message;
  else if (typeof err === "string") raw = err;
  else {
    try {
      raw = JSON.stringify(err);
    } catch {
      raw = String(err);
    }
  }
  return redactErrorMessage(raw ?? "", maxLen);
}
