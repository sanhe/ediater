import {
  listen,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event";

/**
 * Typed wrapper around Tauri's event bus. Backend → frontend streams
 * (file changes, search matches, plugin status, …) subscribe through here.
 *
 * High-frequency streams (pty output, search matches) will use Tauri Channels
 * instead of this global bus; those are wired in their respective panels.
 */
export function onEvent<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  return listen<T>(event, handler);
}
