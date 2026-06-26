/**
 * Action-log wire + on-disk contract. One JSON object per JSONL line.
 *
 * This is the single source of truth for what the log records. It is *pure*
 * (no React/Tauri/IO imports) so it can be reasoned about and unit-tested in
 * isolation, and so a downstream AI consumer can rely on a stable shape.
 *
 * Stability rules:
 *  - Fields are additive. Never repurpose an existing field's meaning.
 *  - The semantic `action` verbs are decoupled from internal type names, so
 *    refactors (e.g. renaming a SessionAction) do not churn the AI-facing log.
 *  - Bump LOG_SCHEMA_VERSION only for a breaking change; consumers can branch.
 *  - Payloads are content-free: never file/buffer contents, queries, or secrets.
 */

export const LOG_SCHEMA_VERSION = 1;

/** Closed vocabulary of semantic action verbs. See mapping.ts for the source map. */
export type ActionVerb =
  // lifecycle
  | "run.start"
  | "run.end"
  // workspace structure — 1:1 with reducer SessionActions, renamed for stability
  | "session.hydrate"
  | "theme.set"
  | "theme.upsert"
  | "theme.import"
  | "theme.remove"
  | "folder.open"
  | "file.open"
  | "panel.close"
  | "tab.activate"
  | "group.activate"
  | "tab.move"
  | "tab.split"
  | "split.resize"
  | "panel.toggle"
  // command system
  | "command.run"
  // document ops
  | "doc.open"
  | "doc.edit"
  | "doc.save"
  | "doc.close"
  // backend IO (request span -> result via outcome/dur_ms)
  | "io.read_file"
  | "io.write_file"
  | "io.list_directory"
  | "io.watch_paths"
  | "io.load_session"
  | "io.save_session"
  // backend -> frontend
  | "fs.changed";

/** The surface that emitted the event. */
export type ActionSource =
  | "system"
  | "reducer"
  | "command"
  | "document"
  | "ipc"
  | "event";

export type CommandVia = "palette" | "keybinding";
/** The light/dark family a theme belongs to. */
export type ThemeKindStr = "light" | "dark";
export type PanelKindStr = "explorer" | "editor" | "terminal" | "search";
export type SplitEdgeStr = "left" | "right" | "top" | "bottom";

/** A file reference: a (possibly redacted) path plus cheap metadata. */
export interface FileRef {
  /** Join key across events. Subject to the configured pathScope. */
  path: string;
  /** Lowercase extension incl. dot, e.g. ".ts". Omitted when none. */
  ext?: string;
}

/** Argument/result digest for a backend IO command. Never carries `content`. */
export interface IoDigest {
  path?: string;
  pathsCount?: number;
  showHidden?: boolean;
  /** write_file: content.length (chars), never the string. */
  contentBytes?: number;
  /** read_file: result.content.length (chars). */
  resultBytes?: number;
  resultLines?: number;
  /** list_directory: number of entries returned. */
  resultCount?: number;
  /** write/read mtime version. */
  version?: number;
}

/** Per-verb payloads. All intent-bearing and content-free. */
export type ActionPayload =
  | {
      kind: "run";
      appVersion: string;
      platform: string;
      /** Active theme preference at start: a theme id or "system". */
      theme: string;
      schemaVersion: number;
    }
  | { kind: "theme"; to: string }
  | { kind: "themeEdit"; themeId: string; label?: string; themeKind?: ThemeKindStr }
  | { kind: "themeImport"; count: number; ids: string[] }
  | { kind: "folder"; root: string; reused: boolean }
  | { kind: "file"; file: FileRef; reused: boolean }
  | {
      kind: "panel";
      panelId: string;
      panelKind?: PanelKindStr;
      file?: FileRef;
    }
  | { kind: "tabActivate"; groupId: string; panelId: string }
  | { kind: "groupActivate"; groupId: string }
  | { kind: "tabMove"; panelId: string; targetGroup: string; index?: number }
  | { kind: "tabSplit"; panelId: string; targetGroup: string; edge: SplitEdgeStr }
  | { kind: "splitResize"; splitId: string; paneCount: number }
  | { kind: "panelToggle"; panelKind: PanelKindStr; opened: boolean }
  | { kind: "hydrate"; restored: boolean; panelCount: number }
  | {
      kind: "command";
      commandId: string;
      title: string;
      via: CommandVia;
      keybinding?: string;
    }
  | {
      kind: "docOpen";
      file: FileRef;
      bytes: number;
      lines: number;
      readonly: boolean;
    }
  | {
      // Coalesced summary of an edit burst (see coalescer.ts).
      kind: "docEdit";
      file: FileRef;
      edits: number;
      netChars: number;
      addedChars: number;
      removedChars: number;
      fromLength: number;
      toLength: number;
      burstMs: number;
    }
  | {
      kind: "docSave";
      file: FileRef;
      bytes: number;
      wasDirty: boolean;
      version: number;
    }
  | { kind: "docClose"; file: FileRef; dirty: boolean }
  | { kind: "io"; command: string; digest: IoDigest }
  | { kind: "fsChanged"; count: number; sample: string[] };

/** One immutable log event. JSON-serializable; exactly one per JSONL line. */
export interface ActionEvent {
  /** = LOG_SCHEMA_VERSION at write time. */
  v: number;
  /** One id per app launch — correlates all events of a session. */
  runId: string;
  /**
   * Process-monotonic, gap-free sequence within a run; the canonical order.
   * Note: collapsed events (`tab.activate`/`group.activate`/`split.resize`) and
   * coalesced `doc.edit` bursts are assigned `seq`/`ts` at *flush* time, so for
   * those a smaller `seq` can correspond to a slightly later originating
   * gesture. Treat their relative order as approximate; `doc.edit` carries
   * `burstMs` for the real span of the burst.
   */
  seq: number;
  /** Epoch ms (Date.now()) at emit time. */
  ts: number;
  /** Stable semantic verb. */
  action: ActionVerb;
  /** Emitting surface. */
  source: ActionSource;
  /** seq of the action that caused this one (same synchronous tick). */
  causeId?: number;
  /** Wall-clock duration in ms for spans (io.*). */
  durMs?: number;
  /** Outcome for spans that can fail. */
  outcome?: "ok" | "error";
  /** Present only when outcome === "error"; redacted + truncated. */
  error?: { message: string };
  /** Compact, intent-bearing payload. Never file contents. */
  payload?: ActionPayload;
}
