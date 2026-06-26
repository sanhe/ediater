//! Recursive project file watching. Emits a debounced `fs-changed` event with
//! the set of affected paths; the frontend refreshes any loaded directory whose
//! contents changed.

use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use notify_debouncer_full::new_debouncer;
use notify_debouncer_full::notify::{EventKind, RecursiveMode};
use notify_debouncer_full::DebounceEventResult;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// Opaque handle that keeps the underlying debounced watcher alive. Dropping it
/// (or replacing it in AppState) stops watching. Boxed as `Any` so callers need
/// not name the debouncer's generic cache/watcher types.
pub struct ProjectWatcher {
    _inner: Box<dyn std::any::Any + Send>,
}

#[derive(Clone, Serialize)]
struct FsChanged {
    paths: Vec<String>,
}

pub fn watch_paths(app: &AppHandle, paths: &[String]) -> Result<ProjectWatcher, String> {
    let handle = app.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
        move |result: DebounceEventResult| {
            let Ok(events) = result else {
                return;
            };
            let mut paths: BTreeSet<String> = BTreeSet::new();
            for event in events {
                // Skip pure access events; keep create/modify/remove/rename.
                if matches!(event.kind, EventKind::Access(_)) {
                    continue;
                }
                for p in event.paths.iter() {
                    paths.insert(p.to_string_lossy().to_string());
                }
            }
            if !paths.is_empty() {
                // Invalidate the fuzzy-search file index (files added/removed).
                if let Some(state) = handle.try_state::<crate::state::AppState>() {
                    if let Ok(mut cache) = state.file_index.lock() {
                        cache.clear();
                    }
                }
                let _ = handle.emit(
                    "fs-changed",
                    FsChanged {
                        paths: paths.into_iter().collect(),
                    },
                );
            }
        },
    )
    .map_err(|e| format!("failed to create watcher: {e}"))?;

    for path in paths {
        debouncer
            .watch(Path::new(path), RecursiveMode::Recursive)
            .map_err(|e| format!("failed to watch {path}: {e}"))?;
    }

    Ok(ProjectWatcher {
        _inner: Box::new(debouncer),
    })
}
