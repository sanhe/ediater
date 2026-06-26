//! Shared application state managed by Tauri and accessed from commands.

use std::collections::HashMap;
use std::sync::Mutex;

use crate::fs::watch::ProjectWatcher;
use crate::pty::session::PtySession;

#[derive(Default)]
pub struct AppState {
    /// The active project's recursive file watcher, if any. Replacing it (or
    /// dropping AppState) stops watching.
    pub watcher: Mutex<Option<ProjectWatcher>>,
    /// Live terminal sessions, keyed by pty id.
    pub ptys: Mutex<HashMap<String, PtySession>>,
}
