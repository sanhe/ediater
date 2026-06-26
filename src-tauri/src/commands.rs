//! Tauri command surface (frontend → Rust). Thin wrappers that delegate to the
//! respective service modules.

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::action_log;
use crate::fs::io::{self, FileContent};
use crate::fs::listing::{self, FileEntry};
use crate::fs::watch;
use crate::session;
use crate::state::AppState;

/// Health check. Returns a version string so the frontend can confirm the
/// backend is reachable.
#[tauri::command]
pub fn ping() -> String {
    format!("ok ediater v{}", env!("CARGO_PKG_VERSION"))
}

/// Load the persisted session blob, or `null` if none exists yet.
#[tauri::command]
pub fn load_session(app: AppHandle) -> Result<Option<Value>, String> {
    session::load(&app)
}

/// Persist the session blob.
#[tauri::command]
pub fn save_session(app: AppHandle, data: Value) -> Result<(), String> {
    session::save(&app, &data)
}

/// List the direct children of a directory (non-recursive).
#[tauri::command]
pub fn list_directory(path: String, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    listing::list_directory(&path, show_hidden)
}

/// Read a UTF-8 text file's content for the editor.
#[tauri::command]
pub fn read_file(path: String) -> Result<FileContent, String> {
    io::read_file(&path)
}

/// Write content to a file; returns the new version (mtime in ms).
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<u64, String> {
    io::write_file(&path, &content)
}

/// Start (or replace) recursive watchers for the open project folders.
#[tauri::command]
pub fn watch_paths(
    app: AppHandle,
    state: State<AppState>,
    paths: Vec<String>,
) -> Result<(), String> {
    let watcher = watch::watch_paths(&app, &paths)?;
    *state
        .watcher
        .lock()
        .map_err(|e| format!("watcher lock poisoned: {e}"))? = Some(watcher);
    Ok(())
}

/// Append a batch of pre-serialized JSONL action-log lines to durable storage.
/// Best-effort: the frontend ignores the result so logging never breaks the app.
#[tauri::command]
pub fn append_action_log(
    app: AppHandle,
    state: State<AppState>,
    lines: Vec<String>,
) -> Result<(), String> {
    let _guard = state
        .log_lock
        .lock()
        .map_err(|e| format!("log lock poisoned: {e}"))?;
    let dir = action_log::logs_dir(&app)?;
    action_log::append_to_dir(&dir, &lines)
}
