# ediater — Architecture

This document describes how ediater is put together. It reflects the current
implementation (workspace shell, docking, file tree, editor, command palette)
and the planned design for features still in progress (terminal, search,
plugins).

## Guiding principles

- **Pure core, thin shell.** The docking algebra, session reducer, and command
  registry are pure and serializable, and unit-tested without a webview.
- **Hub-and-spoke state.** A single `SessionData` object is owned by `<App>` and
  mutated through one pure reducer. Panels reach it via React context, not prop
  drilling. There is no Redux/Zustand.
- **Native work in Rust.** File IO, directory listing, watching (and later pty
  and search) live in the Tauri backend; the frontend orchestrates over IPC.
- **Lightweight by default.** Language grammars and (later) panels are loaded
  lazily so the base bundle stays small.

## Process model

```
┌─────────────────────────────────────────────┐
│ WebView (React 19 + TypeScript)              │
│  App hub · DockLayout · panels · palette     │
└───────────────┬─────────────────────────────┘
                │ Tauri IPC (commands + events)
┌───────────────┴─────────────────────────────┐
│ Rust backend (Tauri 2)                       │
│  fs listing/io/watch · session store         │
│  (planned: pty, ripgrep sidecar, plugin host)│
└──────────────────────────────────────────────┘
```

## Frontend module map (`src/`)

```
app/
  App.tsx                hub: owns SessionData, IPC wiring, persistence, context
  session/sessionData.ts SessionData type + migrations
  session/reducer.ts     pure reducer (all mutations funnel here)
  session/persistence.ts debounced save
  ipc/commands.ts        typed invoke() wrappers
  ipc/events.ts          typed listen() wrapper
  workspace.tsx          React context exposing session/dispatch + actions
layout/
  layout.ts              PURE tab-group split-tree algebra (unit-tested)
  layout.test.ts         algebra tests (Vitest)
  DockLayout.tsx         renderer: group tab bars, tab drag, resize, drop zones
  panel.ts               panel payloads (explorer root, editor path) + titles
  panelRegistry.tsx      PanelKind -> body component
  ids.ts                 process-unique id generator
panels/explorer/
  ExplorerPanel.tsx      one explorer tab (a single folder root)
  FileTree.tsx           react-arborist tree: lazy load + watch refresh
panels/editor/
  EditorPanel.tsx        one file per panel (group tabs provide the tabs)
  CodeMirrorView.tsx     a CodeMirror 6 instance bound to one file
  documents.tsx          global document store (buffers keyed by path)
  cm/languages.ts        filename -> CodeMirror language (lazy)
commands/
  useCommands.ts         live command registry
  CommandPalette.tsx     fuzzy command palette overlay
  keybindings.ts         global keybinding dispatch
  fuzzy.ts               subsequence fuzzy matcher
app/log/
  schema.ts              PURE log event contract (verbs, payloads, ActionEvent)
  config.ts              PURE tunables + env opt-out
  redact.ts              PURE path/error redaction
  mapping.ts             PURE action -> log verb/payload mappers (unit-tested)
  coalescer.ts           PURE edit coalescer + last-wins collapser (unit-tested)
  client.ts              batched ring buffer -> Rust sink (raw invoke)
  actionLog.ts           the `log` facade singleton (wires it all; never throws)
components/AppShell.tsx  titlebar + docking workspace + status bar
styles/                  global.css (theme tokens) + layout.css
```

## Backend module map (`src-tauri/src/`)

```
main.rs        thin launcher -> lib::run()
lib.rs         Tauri builder: plugins, managed state, command handlers
state.rs       AppState (file watcher handle + action-log lock)
commands.rs    #[tauri::command] surface
session.rs     load/save the session blob (atomic write) in the app config dir
action_log.rs  append-only JSONL action-log sink (daily file, rotation, retention)
fs/listing.rs  list_directory -> FileEntry[]
fs/io.rs       read_file / write_file (UTF-8, size-guarded, atomic write)
fs/watch.rs    recursive multi-root watcher -> debounced `fs-changed` events
```

## Docking model (the core)

Every dock region is a **group**: a tab strip of panels with one active tab.
Groups are arranged by **splits** (row/column) with proportional sizes. The
whole structure is a pure tree defined in [`src/layout/layout.ts`](../src/layout/layout.ts):

```ts
type LayoutNode =
  | { kind: "group"; id; panelIds: string[]; activePanelId: string }
  | { kind: "split"; id; direction: "row" | "column"; children: LayoutNode[]; sizes: number[] };
```

The tree stores **structure only**; panel payloads live in a side map
`panels: Record<string, PanelState>`, so the algebra never changes when panel
content does. Key pure operations (all return a new tree):

- `addPanelToGroup` / `removePanel` — add or drop a tab; empty groups are
  dropped and single-child splits collapsed.
- `movePanelToGroup` — move a tab into another group (or reorder within one).
- `splitPanelToGroup` — drop a tab on a group edge to create a new adjacent group.
- `setActivePanel`, `updateSplitSizes` (water-filling clamp to a min pane size).
- `closestZone(x, y, w, h)` — the drop zone under the cursor: `center` (tabify)
  or the nearest edge (split).

`DockLayout.tsx` renders the tree as nested flexbox, draws each group's tab bar,
and implements pointer-driven **tab drag** (hit-testing `[data-group-id]` /
`[data-tabbar]` to decide tabify vs split vs reorder) and **seam resize**. All
structural results are dispatched as reducer actions — the component computes
nothing about the tree itself.

### Panels

A panel is a single dockable view that lives as a tab. Each kind carries the
state it needs:

| Kind       | Payload     | Notes                                        |
| ---------- | ----------- | -------------------------------------------- |
| `explorer` | `root`      | one folder; several can be open as tabs      |
| `editor`   | `path`      | one file; the buffer lives in the doc store  |
| `terminal` | —           | planned (M2)                                 |
| `search`   | —           | planned (M2)                                 |

## Editor

- `EditorPanel` renders one file; the dock group's tab strip provides the tabs.
- Buffers are global and keyed by absolute path in `documents.tsx`, so the same
  file open in two editor groups shares one buffer and dirty state. Content is
  in-memory only (not persisted in the session).
- `CodeMirrorView` builds one `EditorView` per mounted file. Theme and language
  are swapped via CodeMirror **compartments**; `⌘/Ctrl+S` is a high-precedence
  keybinding that calls the document store's `save` (an atomic backend write).
- Syntax highlighting uses CodeMirror's own lazily-loaded language packages
  today. Arbitrary TextMate grammars contributed by plugins will be layered on
  via a Shiki bridge when the plugin system lands.

## Session & persistence

`SessionData` (see [`sessionData.ts`](../src/app/session/sessionData.ts)) holds
the theme, the active group id, the layout tree, and the panel map. It is
serializable and versioned; `migrateSession` salvages the theme and only trusts
structured workspace state from a matching schema version.

The frontend debounces saves and calls the `save_session` command; the backend
writes the blob atomically (temp file + rename) into the app config dir
(`~/Library/Application Support/dev.ediater.app/` on macOS, platform equivalents
elsewhere). On launch the session is restored and file watchers are re-armed for
every open explorer folder.

## Action log

ediater records a durable, append-only log of user/system actions so a
downstream AI can later reconstruct *what the user did and why*. It follows the
same posture as the session blob: the **frontend owns the schema**, the **Rust
backend is a dumb durable sink**.

- **Schema (AI-facing, content-free).** Each entry is one JSON object on its own
  JSONL line: `v` (schema version), `runId` (one per launch), monotonic `seq`,
  `ts` (epoch ms), a stable semantic `action` verb, the emitting `source`, an
  optional `causeId`/`durMs`/`outcome`/`error`, and a compact `payload`. The
  contract lives in [`src/app/log/schema.ts`](../src/app/log/schema.ts).
  **Payloads never contain file/buffer contents, queries, or secrets** — only
  paths and cheap metadata (lengths, line counts, versions). Order events by
  `(runId, seq)`, never by file boundary (a run can span midnight / rotation).
- **Surfaces covered.** Workspace mutations (every reducer `SessionAction`, via a
  `loggedDispatch` wrapper — not the reducer, so it stays pure and fires once
  under StrictMode), command executions (palette + keybinding), document ops
  (open/edit/save/close), backend IO calls (`io.*` spans with duration +
  outcome), `fs-changed` events, and `run.start`/`run.end` lifecycle. A
  command's `seq` becomes the `causeId` of the dispatches/IO it triggers in the
  same synchronous tick.
- **No spam, never blocks.** Editor edits are coalesced per file into one
  `doc.edit` burst summary; resize/active-tab churn is collapsed last-wins.
  Events are batched in a bounded ring buffer and flushed (size/time/`flushNow`)
  like the session persister. Every logging path is wrapped so a fault can never
  throw into or block the app, and the whole subsystem no-ops when disabled
  (`VITE_EDIATER_LOG=off`).
- **Storage.** The backend ([`action_log.rs`](../src-tauri/src/action_log.rs))
  appends pre-serialized lines to `<app_config_dir>/logs/actions-YYYYMMDD.jsonl`
  (next to `session.json`; macOS:
  `~/Library/Application Support/dev.ediater.app/logs/`). Files roll past 16 MiB
  to `actions-YYYYMMDD.N.jsonl`, and files older than 14 days are swept on
  startup. Paths are recorded in full by default (local-only IDE) with the home
  dir collapsed to `~`; `pathScope` can narrow this to relative/basename.

## IPC surface

**Commands** (frontend → Rust): `ping`, `load_session`, `save_session`,
`list_directory`, `read_file`, `write_file`, `watch_paths`,
`append_action_log`.

**Events** (Rust → frontend): `fs-changed` — a debounced set of changed paths;
the explorer refreshes any loaded directory whose contents changed.

Tauri converts JS camelCase command arguments to Rust snake_case automatically.
High-frequency streams planned for M2 (pty output, search matches) will use
Tauri **Channels** rather than the global event bus.

## Command system

`useCommands` builds a live `Command[]` from the current workspace/documents
context. `CommandPalette` (⌘/Ctrl+Shift+P) fuzzy-filters them; `keybindings.ts`
dispatches global shortcuts. This registry is the single place plugins will
contribute commands.

## Plugin system (planned)

ediater's plugin model is **external processes**: a plugin is a standalone
executable the IDE discovers from a manifest, launches lazily, and talks to over
**JSON-RPC 2.0 on stdio** (LSP-style `Content-Length` framing). This keeps
plugins out of the core, language-agnostic, and crash-isolated.

Planned v1 capabilities:

- **Formatters** — `format` request returns text edits applied as one editor
  transaction; a sidecar formatter (e.g. `php-cs-fixer`) needs no editor changes.
- **Grammars** — a static contribution: the plugin ships a TextMate grammar the
  host registers with its highlighter (no process spawned for highlighting).
- **AI actions** — streaming `ai/action` (tokens over JSON-RPC notifications)
  for Claude/Codex-style refactor/explain, rendered into an AI panel or a diff.
- **Commands** — contributed into the command palette, able to call back into a
  permission-scoped host API.

Plugins declare their permissions (fs/network/subprocess) in the manifest and
are consented to at install. Because external processes run with the user's
privileges, this is a *trusted-plugin* model (same posture as VS Code/LSP); the
host enforces the host-API surface and scrubs the child environment. See the
full design in the approved plan.

## Testing

- **Frontend:** `pnpm test` runs Vitest. The docking algebra has thorough unit
  tests in `src/layout/layout.test.ts`.
- **Backend:** `cargo test --manifest-path src-tauri/Cargo.toml` (search/parse
  and protocol tests grow with M2/M3).
- **End-to-end:** run `pnpm tauri dev` and exercise the app directly.
