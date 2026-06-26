//! Non-recursive directory listing for the explorer tree. Each call returns the
//! direct children of one directory; the tree lazy-loads deeper levels.

use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: Option<u64>,
    /// Last-modified time in epoch milliseconds.
    pub modified: Option<u64>,
    pub extension: Option<String>,
}

fn modified_ms(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

pub fn list_directory(path: &str, show_hidden: bool) -> Result<Vec<FileEntry>, String> {
    let dir = Path::new(path);
    let read = fs::read_dir(dir).map_err(|e| format!("failed to read {path}: {e}"))?;

    let mut entries: Vec<FileEntry> = Vec::new();
    for item in read {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue,
        };
        let name = item.file_name().to_string_lossy().to_string();
        let hidden = name.starts_with('.');
        if hidden && !show_hidden {
            continue;
        }

        let entry_path = item.path();
        let file_type = match item.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let is_symlink = file_type.is_symlink();

        // Follow symlinks to classify the target; fall back to the link itself.
        let target_meta = fs::metadata(&entry_path).ok();
        let is_dir = match &target_meta {
            Some(m) => m.is_dir(),
            None => file_type.is_dir(),
        };

        let size = if is_dir {
            None
        } else {
            target_meta.as_ref().map(|m| m.len())
        };
        let modified = target_meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(modified_ms);
        let extension = if is_dir {
            None
        } else {
            entry_path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
        };

        entries.push(FileEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            is_symlink,
            size,
            modified,
            extension,
        });
    }

    // Directories first, then case-insensitive name order.
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}
