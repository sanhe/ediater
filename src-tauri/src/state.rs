//! Shared application state managed by Tauri and accessed from commands.

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::fs::watch::ProjectWatcher;
use crate::plugins::host::PluginHost;
use crate::pty::session::PtySession;
use crate::search::files::FileIndex;

#[derive(Default)]
pub struct AppState {
    /// The active project's recursive file watcher, if any. Replacing it (or
    /// dropping AppState) stops watching.
    pub watcher: Mutex<Option<ProjectWatcher>>,
    /// Live terminal sessions, keyed by pty id.
    pub ptys: Mutex<HashMap<String, PtySession>>,
    /// Cancel flags for in-flight text searches, keyed by search id.
    pub searches: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Cached file lists for fuzzy search, keyed by root; cleared on fs changes.
    pub file_index: Mutex<HashMap<String, FileIndex>>,
    /// External-process plugin host (discovery + live connections).
    pub plugin_host: Mutex<PluginHost>,
    /// Serializes action-log appends so concurrent batches never interleave.
    pub log_lock: Mutex<()>,
}
