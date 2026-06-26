//! Tauri command surface (frontend → Rust). Thin wrappers that delegate to the
//! respective service modules.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::action_log;
use crate::fs::io::{self, FileContent};
use crate::fs::listing::{self, FileEntry};
use crate::fs::watch;
use crate::plugins::host::{GrammarContribution, PluginDescriptor};
use crate::pty::session as pty;
use crate::search::{files as search_files_mod, text as search_text_mod};
use crate::session;
use crate::state::AppState;

/// Directories scanned for plugins (currently the per-user app-data dir).
fn plugin_dirs(app: &AppHandle) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(cfg) = app.path().app_config_dir() {
        dirs.push(cfg.join("plugins"));
    }
    dirs
}

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

/// Start a streaming project-wide text search. Matches arrive on `on_event`;
/// returns immediately while the search runs on a worker thread.
#[tauri::command]
pub fn search_text(
    app: AppHandle,
    state: State<AppState>,
    search_id: String,
    query: String,
    root: String,
    options: search_text_mod::SearchOptions,
    on_event: Channel<search_text_mod::SearchEvent>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = state
            .searches
            .lock()
            .map_err(|e| format!("search lock poisoned: {e}"))?;
        // Single-flight: cancel any in-flight searches — the UI only wants the
        // latest. With the in-file cancel check, the old threads stop promptly.
        for flag in map.values() {
            flag.store(true, Ordering::Relaxed);
        }
        map.insert(search_id.clone(), cancel.clone());
    }

    let app_handle = app.clone();
    std::thread::spawn(move || {
        search_text_mod::run(query, root, options, cancel, on_event);
        if let Some(st) = app_handle.try_state::<AppState>() {
            if let Ok(mut map) = st.searches.lock() {
                map.remove(&search_id);
            }
        }
    });
    Ok(())
}

/// Cancel an in-flight text search by id.
#[tauri::command]
pub fn cancel_search(state: State<AppState>, search_id: String) -> Result<(), String> {
    if let Some(flag) = state
        .searches
        .lock()
        .map_err(|e| format!("search lock poisoned: {e}"))?
        .get(&search_id)
    {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Fuzzy filename search under `root`; returns the best matches. The file list
/// is cached per root (and invalidated by the watcher) so rapid keystrokes
/// don't re-walk the tree.
#[tauri::command]
pub fn search_files(
    state: State<AppState>,
    query: String,
    root: String,
    limit: Option<usize>,
) -> Result<Vec<search_files_mod::FuzzyMatch>, String> {
    let index = {
        let mut cache = state
            .file_index
            .lock()
            .map_err(|e| format!("file index lock poisoned: {e}"))?;
        match cache.get(&root) {
            Some(index) => index.clone(),
            None => {
                let index = search_files_mod::build_index(&root);
                cache.insert(root.clone(), index.clone());
                index
            }
        }
    };
    Ok(search_files_mod::search_files(&index, &query, limit.unwrap_or(50)))
}

/// List discovered plugins and their contributions.
#[tauri::command]
pub fn plugins_list(
    app: AppHandle,
    state: State<AppState>,
) -> Result<Vec<PluginDescriptor>, String> {
    let dirs = plugin_dirs(&app);
    let mut host = state
        .plugin_host
        .lock()
        .map_err(|e| format!("plugin host lock poisoned: {e}"))?;
    host.ensure_discovered(&dirs);
    Ok(host.list())
}

/// Re-scan the plugins directory.
#[tauri::command]
pub fn plugins_reload(
    app: AppHandle,
    state: State<AppState>,
) -> Result<Vec<PluginDescriptor>, String> {
    let dirs = plugin_dirs(&app);
    let mut host = state
        .plugin_host
        .lock()
        .map_err(|e| format!("plugin host lock poisoned: {e}"))?;
    host.discover(&dirs);
    Ok(host.list())
}

/// List grammar contributions (with their loaded TextMate JSON).
#[tauri::command]
pub fn plugins_get_grammars(
    app: AppHandle,
    state: State<AppState>,
) -> Result<Vec<GrammarContribution>, String> {
    let dirs = plugin_dirs(&app);
    let mut host = state
        .plugin_host
        .lock()
        .map_err(|e| format!("plugin host lock poisoned: {e}"))?;
    host.ensure_discovered(&dirs);
    Ok(host.grammars())
}

/// Format a document via a formatter plugin for `language_id`. Returns the
/// formatted text, or an error if no plugin handles the language.
#[tauri::command]
pub fn format_document(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    content: String,
    language_id: String,
) -> Result<String, String> {
    let dirs = plugin_dirs(&app);
    let mut host = state
        .plugin_host
        .lock()
        .map_err(|e| format!("plugin host lock poisoned: {e}"))?;
    host.ensure_discovered(&dirs);
    host.format(&path, &language_id, &content)
}

/// Start a streaming AI action; stream events arrive on `on_event`.
#[tauri::command]
pub fn ai_action(
    app: AppHandle,
    state: State<AppState>,
    action_id: String,
    request_id: String,
    prompt: String,
    context: Value,
    on_event: Channel<Value>,
) -> Result<(), String> {
    let dirs = plugin_dirs(&app);
    let mut host = state
        .plugin_host
        .lock()
        .map_err(|e| format!("plugin host lock poisoned: {e}"))?;
    host.ensure_discovered(&dirs);
    host.ai_action(&action_id, &request_id, &prompt, context, on_event)
}

/// Cancel an in-flight AI action.
#[tauri::command]
pub fn ai_cancel(state: State<AppState>, request_id: String) -> Result<(), String> {
    state
        .plugin_host
        .lock()
        .map_err(|e| format!("plugin host lock poisoned: {e}"))?
        .ai_cancel(&request_id)
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
