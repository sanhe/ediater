import { invoke, Channel } from "@tauri-apps/api/core";
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

export interface PtySpawnOptions {
  cwd?: string;
  shell?: string;
  cols: number;
  rows: number;
  /** Channel receiving base64-encoded output chunks from the shell. */
  onData: Channel<string>;
}

/** Spawn a shell in a PTY; resolves to the pty id. */
export function ptySpawn(opts: PtySpawnOptions): Promise<string> {
  return invoke<string>("pty_spawn", {
    cwd: opts.cwd,
    shell: opts.shell,
    cols: opts.cols,
    rows: opts.rows,
    onData: opts.onData,
  });
}

/** Send user input to a PTY. */
export function ptyWrite(id: string, data: string): Promise<void> {
  return invoke<void>("pty_write", { id, data });
}

/** Resize a PTY to a character grid. */
export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke<void>("pty_resize", { id, cols, rows });
}

/** Kill a PTY session. */
export function ptyKill(id: string): Promise<void> {
  return invoke<void>("pty_kill", { id });
}

export interface SearchOptions {
  caseSensitive?: boolean;
  regex?: boolean;
}

export type SearchEvent =
  | { kind: "match"; file: string; line: number; column: number; text: string }
  | { kind: "done"; matched: number; truncated: boolean; cancelled: boolean }
  | { kind: "error"; message: string };

/**
 * Start a streaming text search. Matches arrive on `onEvent`. Search/fuzzy
 * calls use raw invoke (no io-span logging) since they fire per keystroke.
 */
export function searchText(
  searchId: string,
  query: string,
  root: string,
  options: SearchOptions,
  onEvent: Channel<SearchEvent>,
): Promise<void> {
  return invoke<void>("search_text", { searchId, query, root, options, onEvent });
}

/** Cancel an in-flight text search. */
export function cancelSearch(searchId: string): Promise<void> {
  return invoke<void>("cancel_search", { searchId });
}

export interface FuzzyMatch {
  path: string;
  rel: string;
  score: number;
}

/** Fuzzy filename search under a root folder. */
export function searchFiles(
  query: string,
  root: string,
  limit?: number,
): Promise<FuzzyMatch[]> {
  return invoke<FuzzyMatch[]>("search_files", { query, root, limit });
}

/** Open the native folder picker; returns the chosen path or null. */
export async function pickFolder(): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}
