//! Project-wide text search ("Find in Path"), built on ripgrep's own crates
//! (`grep` + `ignore`) in-process: gitignore-aware walking, binary-file skip,
//! smart-case literal or regex matching. Matches stream to the frontend over a
//! Tauri channel as they are found, and a cooperative cancel flag stops it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use grep::matcher::Matcher;
use grep::regex::RegexMatcherBuilder;
use grep::searcher::sinks::Lossy;
use grep::searcher::{BinaryDetection, SearcherBuilder};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

const MAX_MATCHES: usize = 5000;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub regex: bool,
}

/// Streamed search events (Rust → frontend). Tagged union keyed by `kind`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SearchEvent {
    Match {
        file: String,
        line: u64,
        column: u32,
        text: String,
    },
    Done {
        matched: usize,
        truncated: bool,
        cancelled: bool,
    },
    Error {
        message: String,
    },
}

pub fn run(
    query: String,
    root: String,
    opts: SearchOptions,
    cancel: Arc<AtomicBool>,
    on_event: Channel<SearchEvent>,
) {
    if query.is_empty() {
        let _ = on_event.send(SearchEvent::Done {
            matched: 0,
            truncated: false,
            cancelled: false,
        });
        return;
    }

    let pattern = if opts.regex {
        query.clone()
    } else {
        regex::escape(&query)
    };
    // Smart case: insensitive unless the pattern has an uppercase *literal*.
    // `case_smart` analyzes the regex's literals, so it correctly ignores
    // metacharacters like \D / \W (a raw uppercase-char check would trip on them).
    let mut builder = RegexMatcherBuilder::new();
    if opts.case_sensitive {
        builder.case_insensitive(false);
    } else {
        builder.case_smart(true);
    }

    let matcher = match builder.build(&pattern) {
        Ok(m) => m,
        Err(e) => {
            let _ = on_event.send(SearchEvent::Error {
                message: format!("invalid pattern: {e}"),
            });
            return;
        }
    };

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\x00'))
        .line_number(true)
        .build();

    let mut count = 0usize;
    let mut truncated = false;

    for result in WalkBuilder::new(&root).hidden(true).build() {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path().to_path_buf();
        let path_str = path.to_string_lossy().to_string();

        let _ = searcher.search_path(
            &matcher,
            &path,
            // Lossy (not UTF8) so an invalid byte doesn't abort the rest of the
            // file — it's substituted with U+FFFD and matching continues.
            Lossy(|line_number, line| {
                if cancel.load(Ordering::Relaxed) {
                    return Ok(false);
                }
                // Convert the match's byte offset to a UTF-16 column to match the
                // editor's (JS) string indexing.
                let column = matcher
                    .find(line.as_bytes())
                    .ok()
                    .flatten()
                    .and_then(|m| line.get(..m.start()))
                    .map(|prefix| prefix.encode_utf16().count() as u32)
                    .unwrap_or(0);
                let _ = on_event.send(SearchEvent::Match {
                    file: path_str.clone(),
                    line: line_number,
                    column,
                    text: line.trim_end_matches(['\n', '\r']).to_string(),
                });
                count += 1;
                Ok(count < MAX_MATCHES)
            }),
        );

        if count >= MAX_MATCHES {
            truncated = true;
            break;
        }
    }

    let cancelled = cancel.load(Ordering::Relaxed);
    let _ = on_event.send(SearchEvent::Done {
        matched: count,
        truncated,
        cancelled,
    });
}
