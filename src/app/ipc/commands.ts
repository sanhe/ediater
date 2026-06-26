import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { log } from "../log/actionLog";
import { countLines } from "../log/mapping";

/**
 * Typed wrappers around Tauri backend commands. One function per command keeps
 * the invoke() string keys and argument shapes in a single place.
 *
 * Every data command is routed through `log.ioSpan` so each backend call is
 * recorded as a timed, content-free `io.*` span in the action log. `ping` and
 * the action-log sink itself stay on raw `invoke` (the latter to avoid logging
 * the log).
 */

/** Health check — returns a backend version string. */
export function ping(): Promise<string> {
  return invoke<string>("ping");
}

/** Load the persisted session blob, or null if none has been saved yet. */
export function loadSession(): Promise<unknown> {
  return log.ioSpan(
    "load_session",
    () => invoke<unknown>("load_session"),
    () => ({}),
  );
}

/** Persist the session blob (atomic write on the backend). */
export function saveSession(data: unknown): Promise<void> {
  return log.ioSpan(
    "save_session",
    () => invoke<void>("save_session", { data }),
    () => ({}),
  );
}

/** A single directory entry, mirroring the Rust `FileEntry`. */
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  size: number | null;
  modified: number | null;
  extension: string | null;
}

/** List the direct children of a directory (non-recursive). */
export function listDirectory(
  path: string,
  showHidden: boolean,
): Promise<FileEntry[]> {
  return log.ioSpan(
    "list_directory",
    () => invoke<FileEntry[]>("list_directory", { path, showHidden }),
    (entries) => ({ path, showHidden, resultCount: entries.length }),
  );
}

/** Start (or replace) recursive watchers for the given set of folders. */
export function watchPaths(paths: string[]): Promise<void> {
  return log.ioSpan(
    "watch_paths",
    () => invoke<void>("watch_paths", { paths }),
    () => ({ pathsCount: paths.length }),
  );
}

export interface FileContent {
  content: string;
  /** Last-modified time in epoch ms, used as an optimistic version. */
  version: number;
  readonly: boolean;
}

/** Read a UTF-8 text file for the editor. */
export function readFile(path: string): Promise<FileContent> {
  return log.ioSpan(
    "read_file",
    () => invoke<FileContent>("read_file", { path }),
    (file) => ({
      path,
      resultBytes: file.content.length,
      resultLines: countLines(file.content),
      version: file.version,
    }),
  );
}

/** Write content to a file; resolves to the new version (mtime in ms). */
export function writeFile(path: string, content: string): Promise<number> {
  return log.ioSpan(
    "write_file",
    () => invoke<number>("write_file", { path, content }),
    (version) => ({ path, contentBytes: content.length, version }),
  );
}

/** Open the native folder picker; returns the chosen path or null. */
export async function pickFolder(): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}
