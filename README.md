# ediater

A lightweight, cross-platform IDE — simple and fast, in the spirit of PhpStorm
but small. Built with **Tauri 2** (Rust) + **React 19** + **TypeScript**, with a
**CodeMirror 6** editor and a PhpStorm-style dockable, tabbed panel system.

> **Status:** early development. The workspace shell, docking, file tree, editor,
> and command palette work today; the integrated terminal, project search, and
> the plugin system are in progress (see [Roadmap](#roadmap)).

## Features

- **Dockable tab-group panels.** Every dock region is a tab strip of panels
  (like PhpStorm tool windows / VS Code editor groups). Drag a tab onto another
  group's center to tabify, onto an edge to split, or within the bar to reorder.
  Drag the seams to resize. The whole layout persists across restarts.
- **File-manager tree.** A virtualized, lazy-loading tree rooted at a single
  folder. Open several folders at once — each becomes its own explorer tab.
  Folders auto-refresh on disk changes via a native file watcher.
- **Code editor.** CodeMirror 6 with multiple files as tabs, dirty tracking,
  `⌘/Ctrl+S` save (atomic writes), and on-demand syntax highlighting for many
  languages (PHP, INI, JS/TS, JSON, and more) loaded lazily to stay lightweight.
- **Command palette.** `⌘/Ctrl+Shift+P` with fuzzy search; keybindings for
  toggling panels and switching theme.
- **Light/dark theming** and full session persistence (layout, open folders &
  files, theme).

## Tech stack

| Concern        | Choice                                              |
| -------------- | --------------------------------------------------- |
| Shell          | Tauri 2.x (Rust backend, system WebView frontend)   |
| UI             | React 19 + TypeScript + Vite                        |
| Editor         | CodeMirror 6 (`@codemirror/language-data`)          |
| Docking        | Custom recursive tab-group split-tree (no library)  |
| File tree      | react-arborist                                      |
| File watching  | `notify` / `notify-debouncer-full`                  |
| Tests          | Vitest (frontend), `cargo test` (backend)           |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/) 9+
- [Rust](https://www.rust-lang.org/tools/install) (stable) + Cargo
- Platform WebView toolchain:
  - **macOS** — Xcode Command Line Tools (`xcode-select --install`)
  - **Linux** — `webkit2gtk` and related dev packages
  - **Windows** — WebView2 runtime (preinstalled on Windows 11)

See the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)
for details.

### Install & run

```bash
pnpm install          # install JS dependencies (also fetches the Tauri CLI)
pnpm tauri dev        # run the app in development (hot-reload frontend)
```

The first `pnpm tauri dev` compiles the Rust backend, so it takes a few minutes;
subsequent runs are fast.

### Build a release bundle

```bash
pnpm tauri build      # produces a platform installer/app under src-tauri/target
```

### Other scripts

```bash
pnpm dev              # frontend dev server only (Vite)
pnpm build            # type-check (tsc) + production frontend build
pnpm test             # run the frontend unit tests (Vitest)
pnpm gen:icon         # regenerate the placeholder app icon source
```

## Project layout

```
src/                      React + TypeScript frontend
  app/                    hub: session state, reducer, IPC, persistence, context
  layout/                 pure docking algebra (layout.ts) + DockLayout renderer
  panels/explorer/        file tree (react-arborist)
  panels/editor/          CodeMirror editor + documents store
  commands/               command registry, palette, keybindings
  styles/                 global + layout CSS, theme tokens
src-tauri/                Rust backend (Tauri)
  src/commands.rs         IPC command surface
  src/fs/                 directory listing, file IO, file watching
  src/session.rs          session blob persistence
docs/                     architecture & contributor docs
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Roadmap

- **M2** — integrated terminal (xterm.js + `portable-pty`) and project-wide
  search ("Find in Path" via a ripgrep sidecar + fuzzy filename search).
- **M3** — an **external-process plugin system** (JSON-RPC over stdio): plugins
  are standalone executables the IDE launches for formatting, syntax-grammar
  contributions, and AI integrations (e.g. Claude/Codex). See the design in
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#plugin-system-planned).
- **M4** — polish: file tree create/rename/delete, large-file handling, settings
  & keybinding UI, bundle optimization, packaging/signing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
conventions.
