# Contributing to ediater

Thanks for hacking on ediater! This guide covers the development workflow.

## Setup

Install the [prerequisites](README.md#prerequisites) (Node + pnpm, Rust, and
your platform's WebView toolchain), then:

```bash
pnpm install
pnpm tauri dev
```

The first run compiles the Rust backend (a few minutes); after that the frontend
hot-reloads on save and the backend rebuilds only when `src-tauri/` changes.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design. In short:

- `src/` — React + TypeScript frontend (app hub, docking, panels, commands).
- `src-tauri/` — Rust backend (IPC commands, filesystem, watching, session).
- `docs/` — architecture and contributor docs.

## Day-to-day commands

```bash
pnpm tauri dev     # run the app (dev)
pnpm build         # type-check (tsc --noEmit) + production frontend build
pnpm test          # frontend unit tests (Vitest)
pnpm test:watch    # Vitest in watch mode
pnpm tauri build   # release bundle

cargo check --manifest-path src-tauri/Cargo.toml   # fast backend type-check
cargo test  --manifest-path src-tauri/Cargo.toml   # backend tests
```

Before pushing, make sure `pnpm build`, `pnpm test`, and `cargo check` all pass.

## Conventions

- **TypeScript** is `strict`, with `noUnusedLocals`/`noUnusedParameters` on —
  keep imports and bindings tidy.
- **Keep the docking algebra pure.** All structural changes to the layout live
  in `src/layout/layout.ts` as pure functions and must have unit tests in
  `src/layout/layout.test.ts`. UI components (e.g. `DockLayout.tsx`) dispatch
  reducer actions; they don't mutate the tree directly.
- **All session mutations go through the reducer** (`src/app/session/reducer.ts`).
  Don't mutate `SessionData` elsewhere.
- **macOS is case-insensitive** — don't create files whose names differ only in
  case (e.g. the algebra is `layout.ts`; its renderer is `DockLayout.tsx`).
- **Match the surrounding style** — comment density, naming, and idioms.

## Backend notes

- New IPC commands: add the `#[tauri::command]` in `src-tauri/src/commands.rs`,
  register it in `src-tauri/src/lib.rs`, and add a typed wrapper in
  `src/app/ipc/commands.ts`. Tauri converts JS camelCase args to Rust snake_case.
- New plugin permissions/capabilities are declared in
  `src-tauri/capabilities/default.json`.

## Tests

- Add Vitest tests next to the code as `*.test.ts`. The layout algebra is the
  best example of the level of coverage to aim for on pure logic.
- Run the app (`pnpm tauri dev`) to verify UI/behavior changes end-to-end.

## Commits

- Keep commits focused and message subjects in the imperative mood.
- Ensure the build and tests pass before committing.
