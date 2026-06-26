//! Shared application state managed by Tauri and accessed from commands.

use std::sync::Mutex;

use crate::fs::watch::ProjectWatcher;

#[derive(Default)]
pub struct AppState {
    /// The active project's recursive file watcher, if any. Replacing it (or
    /// dropping AppState) stops watching.
    pub watcher: Mutex<Option<ProjectWatcher>>,
}
