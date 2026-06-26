/**
 * Tiny pub/sub so a search result (or any navigation) can reveal a line in the
 * editor for a given file. If the editor for that path isn't mounted yet (the
 * file was just opened), the request is buffered and delivered when the editor
 * subscribes on mount.
 */
export interface RevealTarget {
  /** 1-based line number. */
  line: number;
  /** 0-based column, optional. */
  column?: number;
}

type Handler = (target: RevealTarget) => void;

/** A buffered reveal is dropped if no editor for the path mounts within this. */
const PENDING_TTL_MS = 4000;

const handlers = new Map<string, Set<Handler>>();
const pending = new Map<string, RevealTarget>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearPending(path: string): void {
  pending.delete(path);
  const timer = pendingTimers.get(path);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(path);
  }
}

export function onReveal(path: string, handler: Handler): () => void {
  let set = handlers.get(path);
  if (!set) {
    set = new Set();
    handlers.set(path, set);
  }
  set.add(handler);

  const buffered = pending.get(path);
  if (buffered) {
    clearPending(path);
    handler(buffered);
  }

  return () => {
    const current = handlers.get(path);
    current?.delete(handler);
    if (current && current.size === 0) handlers.delete(path);
  };
}

export function requestReveal(path: string, line: number, column?: number): void {
  const target: RevealTarget = { line, column };
  const set = handlers.get(path);
  if (set && set.size > 0) {
    set.forEach((h) => h(target));
    return;
  }
  // No editor mounted yet (file just opened) — buffer briefly until it mounts.
  clearPending(path);
  pending.set(path, target);
  pendingTimers.set(
    path,
    setTimeout(() => clearPending(path), PENDING_TTL_MS),
  );
}

// --- set-text channel (e.g. applying a formatter's output to the live view) ---

type TextHandler = (text: string) => void;
const textHandlers = new Map<string, Set<TextHandler>>();

export function onSetText(path: string, handler: TextHandler): () => void {
  let set = textHandlers.get(path);
  if (!set) {
    set = new Set();
    textHandlers.set(path, set);
  }
  set.add(handler);
  return () => {
    const current = textHandlers.get(path);
    current?.delete(handler);
    if (current && current.size === 0) textHandlers.delete(path);
  };
}

/** Replace the live editor content for `path` (no-op if it isn't mounted). */
export function requestSetText(path: string, text: string): void {
  textHandlers.get(path)?.forEach((h) => h(text));
}
