import { invoke, Channel } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

/**
 * Typed wrappers around Tauri backend commands. One function per command keeps
 * the invoke() string keys and argument shapes in a single place.
 */

/** Health check — returns a backend version string. */
export function ping(): Promise<string> {
  return invoke<string>("ping");
}

/** Load the persisted session blob, or null if none has been saved yet. */
export function loadSession(): Promise<unknown> {
  return invoke<unknown>("load_session");
}

/** Persist the session blob (atomic write on the backend). */
export function saveSession(data: unknown): Promise<void> {
  return invoke<void>("save_session", { data });
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
  return invoke<FileEntry[]>("list_directory", { path, showHidden });
}

/** Start (or replace) recursive watchers for the given set of folders. */
export function watchPaths(paths: string[]): Promise<void> {
  return invoke<void>("watch_paths", { paths });
}

export interface FileContent {
  content: string;
  /** Last-modified time in epoch ms, used as an optimistic version. */
  version: number;
  readonly: boolean;
}

/** Read a UTF-8 text file for the editor. */
export function readFile(path: string): Promise<FileContent> {
  return invoke<FileContent>("read_file", { path });
}

/** Write content to a file; resolves to the new version (mtime in ms). */
export function writeFile(path: string, content: string): Promise<number> {
  return invoke<number>("write_file", { path, content });
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

/** Open the native folder picker; returns the chosen path or null. */
export async function pickFolder(): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}
