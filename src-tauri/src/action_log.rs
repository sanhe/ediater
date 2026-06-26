//! Action-log sink: a dumb, durable JSONL store. The frontend owns the schema
//! (see `src/app/log/schema.ts`); the backend appends opaque, pre-serialized
//! JSON lines, one per line. Daily files, size-based rotation, and a startup
//! retention sweep. Best-effort and panic-free: a logging fault must never take
//! the app down, so every IO error becomes an `Err(String)` the caller ignores.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const LOG_SUBDIR: &str = "logs";
const FILE_PREFIX: &str = "actions-";
const FILE_SUFFIX: &str = ".jsonl";
/// Roll the active daily file once it would grow past this size.
const MAX_LOG_BYTES: u64 = 16 * 1024 * 1024;
/// Delete daily files older than this many days on startup.
pub const RETENTION_DAYS: i64 = 14;
/// Bound on rotation suffixes per day (a safety backstop, never expected).
const MAX_ROTATIONS: u32 = 10_000;

/// Seconds since the Unix epoch (UTC), or 0 if the clock is before the epoch.
fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Civil (year, month, day) from a Unix timestamp in UTC. Pure integer math
/// (Howard Hinnant's `civil_from_days`), so no date crate is needed. Filenames
/// use UTC; events themselves carry epoch `ts`, so ordering never depends on
/// the filename's calendar day.
fn ymd_from_unix(secs: i64) -> (i64, u32, u32) {
    // Floor-divide to days so pre-epoch timestamps still map correctly.
    let days = secs.div_euclid(86_400);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32; // [1, 12]
    let year = y + if m <= 2 { 1 } else { 0 };
    (year, m, d)
}

/// YYYYMMDD as a single integer for the given timestamp (UTC).
fn date_int(secs: i64) -> u32 {
    let (y, m, d) = ymd_from_unix(secs);
    (y as u32) * 10_000 + m * 100 + d
}

/// Active daily file name for the given timestamp, e.g. `actions-20260626.jsonl`.
fn file_name_for(secs: i64) -> String {
    format!("{FILE_PREFIX}{:08}{FILE_SUFFIX}", date_int(secs))
}

/// Parse the YYYYMMDD date out of `actions-YYYYMMDD.jsonl` or
/// `actions-YYYYMMDD.N.jsonl`. Returns `None` for any other name.
fn parse_date_from_name(name: &str) -> Option<u32> {
    let rest = name.strip_prefix(FILE_PREFIX)?;
    if rest.len() < 9 {
        return None;
    }
    let (digits, tail) = rest.split_at(8);
    if !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    // Tail must be ".jsonl" or ".N.jsonl" — in both cases it starts with '.'.
    if !tail.starts_with('.') || !tail.ends_with(FILE_SUFFIX) {
        return None;
    }
    digits.parse::<u32>().ok()
}

/// Resolve `<app_config_dir>/logs` (mirrors `session.rs`).
pub fn logs_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("failed to resolve config dir: {e}"))?;
    Ok(dir.join(LOG_SUBDIR))
}

/// Append pre-serialized JSON lines to today's log file under `dir`.
pub fn append_to_dir(dir: &Path, lines: &[String]) -> Result<(), String> {
    append_inner(dir, lines, MAX_LOG_BYTES, now_unix_secs())
}

/// Testable core of `append_to_dir` with injectable size cap and clock.
fn append_inner(
    dir: &Path,
    lines: &[String],
    max_bytes: u64,
    now_secs: i64,
) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    fs::create_dir_all(dir).map_err(|e| format!("create logs dir: {e}"))?;
    let path = dir.join(file_name_for(now_secs));
    rotate_if_needed(&path, max_bytes)?;

    let mut buf = String::with_capacity(lines.iter().map(|l| l.len() + 1).sum());
    for line in lines {
        buf.push_str(line);
        buf.push('\n');
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open log: {e}"))?;
    file.write_all(buf.as_bytes())
        .map_err(|e| format!("write log: {e}"))?;
    // No fsync: best-effort durability, never block the IPC call.
    Ok(())
}

/// Rename the active file to the next free `…-DATE.N.jsonl` once it exceeds
/// `max_bytes`, so a fresh daily file is started on the next append.
fn rotate_if_needed(path: &Path, max_bytes: u64) -> Result<(), String> {
    let len = match fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(_) => return Ok(()), // no file yet — nothing to rotate
    };
    if len < max_bytes {
        return Ok(());
    }
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return Ok(()),
    };
    let stem = name.strip_suffix(FILE_SUFFIX).unwrap_or(name);
    for n in 1..MAX_ROTATIONS {
        let rolled = dir.join(format!("{stem}.{n}{FILE_SUFFIX}"));
        if !rolled.exists() {
            return fs::rename(path, &rolled).map_err(|e| format!("rotate log: {e}"));
        }
    }
    Ok(()) // give up quietly; keep appending to the oversized file
}

/// Delete daily files older than `keep_days`. Per-file and listing errors are
/// swallowed; pruning is opportunistic.
pub fn sweep_retention(dir: &Path, keep_days: i64) -> Result<(), String> {
    sweep_inner(dir, keep_days, now_unix_secs())
}

fn sweep_inner(dir: &Path, keep_days: i64, now_secs: i64) -> Result<(), String> {
    let cutoff = date_int(now_secs - keep_days.max(0) * 86_400);
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(()), // no logs dir yet
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(date) = parse_date_from_name(name) else {
            continue;
        };
        if date < cutoff {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("ediater-log-test-{}-{}", std::process::id(), n));
            fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    // 2026-06-26 00:00:00 UTC.
    const T_20260626: i64 = 1_782_432_000;

    #[test]
    fn date_helpers_round_trip() {
        assert_eq!(ymd_from_unix(T_20260626), (2026, 6, 26));
        assert_eq!(date_int(T_20260626), 2026_06_26);
        assert_eq!(date_int(0), 1970_01_01);
        // One second before midnight is still the previous UTC day.
        assert_eq!(date_int(T_20260626 - 1), 2026_06_25);
        assert_eq!(file_name_for(T_20260626), "actions-20260626.jsonl");
    }

    #[test]
    fn parse_date_accepts_daily_and_rotated_names() {
        assert_eq!(parse_date_from_name("actions-20260626.jsonl"), Some(2026_06_26));
        assert_eq!(parse_date_from_name("actions-20260626.3.jsonl"), Some(2026_06_26));
        assert_eq!(parse_date_from_name("actions-2026062.jsonl"), None);
        assert_eq!(parse_date_from_name("actions-abcdefgh.jsonl"), None);
        assert_eq!(parse_date_from_name("session.json"), None);
        assert_eq!(parse_date_from_name("actions-20260626.txt"), None);
    }

    #[test]
    fn append_writes_one_line_each_and_appends() {
        let tmp = TempDir::new();
        append_inner(tmp.path(), &["{\"a\":1}".into()], MAX_LOG_BYTES, T_20260626).unwrap();
        append_inner(
            tmp.path(),
            &["{\"b\":2}".into(), "{\"c\":3}".into()],
            MAX_LOG_BYTES,
            T_20260626,
        )
        .unwrap();
        let body = fs::read_to_string(tmp.path().join("actions-20260626.jsonl")).unwrap();
        assert_eq!(body, "{\"a\":1}\n{\"b\":2}\n{\"c\":3}\n");
    }

    #[test]
    fn append_empty_is_noop() {
        let tmp = TempDir::new();
        append_inner(tmp.path(), &[], MAX_LOG_BYTES, T_20260626).unwrap();
        assert!(!tmp.path().join("actions-20260626.jsonl").exists());
    }

    #[test]
    fn rotation_rolls_over_when_oversized() {
        let tmp = TempDir::new();
        // Tiny cap forces a roll on the second append.
        append_inner(tmp.path(), &["xxxxxxxxxx".into()], 4, T_20260626).unwrap();
        append_inner(tmp.path(), &["yyyy".into()], 4, T_20260626).unwrap();
        let rolled = fs::read_to_string(tmp.path().join("actions-20260626.1.jsonl")).unwrap();
        let fresh = fs::read_to_string(tmp.path().join("actions-20260626.jsonl")).unwrap();
        assert_eq!(rolled, "xxxxxxxxxx\n");
        assert_eq!(fresh, "yyyy\n");
    }

    #[test]
    fn sweep_deletes_old_keeps_recent_and_ignores_others() {
        let tmp = TempDir::new();
        let old = tmp.path().join("actions-20260601.jsonl");
        let recent = tmp.path().join("actions-20260626.jsonl");
        let other = tmp.path().join("session.json");
        fs::write(&old, "old\n").unwrap();
        fs::write(&recent, "recent\n").unwrap();
        fs::write(&other, "{}").unwrap();

        sweep_inner(tmp.path(), 14, T_20260626).unwrap();

        assert!(!old.exists(), "file older than 14 days should be deleted");
        assert!(recent.exists(), "today's file should be kept");
        assert!(other.exists(), "non-log files should be left alone");
    }

    #[test]
    fn append_to_missing_parent_errors_without_panic() {
        // A path whose parent is a file, not a directory, cannot be created.
        let tmp = TempDir::new();
        let not_a_dir = tmp.path().join("file");
        fs::write(&not_a_dir, "x").unwrap();
        let result = append_inner(&not_a_dir.join("sub"), &["{}".into()], MAX_LOG_BYTES, T_20260626);
        assert!(result.is_err());
    }
}
