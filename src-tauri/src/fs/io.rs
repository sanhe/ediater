//! Reading and writing file contents for the editor. Files are treated as
//! UTF-8 text; binary or oversized files are rejected with a clear error.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    /// Last-modified time in epoch milliseconds; used as an optimistic version.
    pub version: u64,
    pub readonly: bool,
}

fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read_file(path: &str) -> Result<FileContent, String> {
    let p = Path::new(path);
    let meta = fs::metadata(p).map_err(|e| format!("failed to stat {path}: {e}"))?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "file is too large to open ({} bytes, max {})",
            meta.len(),
            MAX_FILE_BYTES
        ));
    }
    let bytes = fs::read(p).map_err(|e| format!("failed to read {path}: {e}"))?;
    let content =
        String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8 (binary?)".to_string())?;
    let readonly = meta.permissions().readonly();
    Ok(FileContent {
        content,
        version: mtime_ms(p),
        readonly,
    })
}

pub fn write_file(path: &str, content: &str) -> Result<u64, String> {
    let p = Path::new(path);
    // Write to a sibling temp file then rename for an atomic replace.
    let tmp = format!("{path}.ediater-tmp");
    fs::write(&tmp, content).map_err(|e| format!("failed to write {path}: {e}"))?;
    fs::rename(&tmp, p).map_err(|e| format!("failed to commit write to {path}: {e}"))?;
    Ok(mtime_ms(p))
}
