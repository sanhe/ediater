import { useCallback, useState } from "react";

/**
 * Per-panel ephemeral state that survives the panel component remounting.
 *
 * The docking renderer remounts a group's subtree when a split reparents it
 * (React reconciles by position), which would otherwise reset a panel's local
 * state — e.g. the search query or the AI transcript. Backing that state with a
 * module-level store keyed by panel id makes it survive the remount. State is
 * dropped via `clearPanelState` when the panel is actually closed.
 */
const store = new Map<string, unknown>();

export function usePanelState<T>(
  key: string,
  initial: T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() =>
    store.has(key) ? (store.get(key) as T) : initial,
  );
  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next =
          typeof value === "function" ? (value as (p: T) => T)(prev) : value;
        store.set(key, next);
        return next;
      });
    },
    [key],
  );
  return [state, set];
}

/** Drop all stored state for a panel (call when the panel is closed). */
export function clearPanelState(panelId: string): void {
  const prefix = `${panelId}:`;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
