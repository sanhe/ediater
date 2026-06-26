//! Tauri command surface (frontend → Rust). Thin wrappers that delegate to the
//! respective service modules.

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::fs::io::{self, FileContent};
use crate::fs::listing::{self, FileEntry};
use crate::fs::watch;
use crate::pty::session as pty;
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

/// Spawn a shell in a new PTY; output streams to `on_data`. Returns the pty id.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    state: State<AppState>,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
) -> Result<String, String> {
    let id = pty::next_pty_id();
    let session = pty::spawn(app, id.clone(), cwd, shell, cols, rows, on_data)?;
    state
        .ptys
        .lock()
        .map_err(|e| format!("pty lock poisoned: {e}"))?
        .insert(id.clone(), session);
    Ok(id)
}

/// Write bytes to a PTY's stdin (what the user typed).
#[tauri::command]
pub fn pty_write(state: State<AppState>, id: String, data: String) -> Result<(), String> {
    let mut map = state
        .ptys
        .lock()
        .map_err(|e| format!("pty lock poisoned: {e}"))?;
    match map.get_mut(&id) {
        Some(session) => session.write(data.as_bytes()),
        None => Err(format!("no pty {id}")),
    }
}

/// Resize a PTY to the given character grid.
#[tauri::command]
pub fn pty_resize(
    state: State<AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state
        .ptys
        .lock()
        .map_err(|e| format!("pty lock poisoned: {e}"))?;
    match map.get(&id) {
        Some(session) => session.resize(cols, rows),
        None => Err(format!("no pty {id}")),
    }
}

/// Kill a PTY and drop its session.
#[tauri::command]
pub fn pty_kill(state: State<AppState>, id: String) -> Result<(), String> {
    if let Some(mut session) = state
        .ptys
        .lock()
        .map_err(|e| format!("pty lock poisoned: {e}"))?
        .remove(&id)
    {
        session.kill();
    }
    Ok(())
}
