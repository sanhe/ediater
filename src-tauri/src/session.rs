//! Session persistence: the frontend owns the SessionData shape; the backend
//! stores it as an opaque JSON blob in the app config directory, written
//! atomically (temp file + rename) to avoid truncation on crash.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

const SESSION_FILE: &str = "session.json";

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve config dir: {e}"))?;
    Ok(dir.join(SESSION_FILE))
}

pub fn load(app: &AppHandle) -> Result<Option<Value>, String> {
    let path = session_path(app)?;
    match fs::read(&path) {
        Ok(bytes) => {
            let value = serde_json::from_slice::<Value>(&bytes)
                .map_err(|e| format!("failed to parse session: {e}"))?;
            Ok(Some(value))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("failed to read session: {e}")),
    }
}

pub fn save(app: &AppHandle, data: &Value) -> Result<(), String> {
    let path = session_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create config dir: {e}"))?;
    }
    let body =
        serde_json::to_vec_pretty(data).map_err(|e| format!("failed to serialize session: {e}"))?;

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &body).map_err(|e| format!("failed to write session: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("failed to commit session: {e}"))?;
    Ok(())
}
