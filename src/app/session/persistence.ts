import { saveSession } from "../ipc/commands";
import type { SessionData } from "./sessionData";

/**
 * Debounced session persister. The app schedules a save on every state change;
 * we coalesce rapid changes and write at most once per `delayMs`.
 */
export interface SessionPersister {
  schedule(data: SessionData): void;
  flushNow(): void;
}

export function createDebouncedPersister(delayMs = 500): SessionPersister {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: SessionData | null = null;

  const flush = () => {
    timer = null;
    if (pending) {
      const data = pending;
      pending = null;
      void saveSession(data);
    }
  };

  return {
    schedule(data: SessionData) {
      pending = data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    flushNow() {
      if (timer) clearTimeout(timer);
      flush();
    },
  };
}
