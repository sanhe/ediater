//! Fuzzy filename search ("Go to File"), via the `nucleo` matcher over a
//! gitignore-aware file walk. Synchronous and bounded; the frontend debounces.

use std::collections::HashMap;
use std::path::Path;

use ignore::WalkBuilder;
use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher};
use serde::Serialize;

const MAX_WALK: usize = 200_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FuzzyMatch {
    /// Absolute path (used to open the file).
    pub path: String,
    /// Path relative to the search root (shown in the UI).
    pub rel: String,
    pub score: u32,
}

fn collect_files(root: &str) -> Vec<(String, String)> {
    let root_path = Path::new(root);
    let mut out: Vec<(String, String)> = Vec::new();
    for result in WalkBuilder::new(root).hidden(true).build() {
        let entry = match result {
            Ok(e) => e,
            Err(_) => continue,
        };
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let abs = entry.path().to_string_lossy().to_string();
        let rel = entry
            .path()
            .strip_prefix(root_path)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .to_string();
        out.push((abs, rel));
        if out.len() >= MAX_WALK {
            break;
        }
    }
    out
}

pub fn search_files(query: &str, root: &str, limit: usize) -> Vec<FuzzyMatch> {
    let files = collect_files(root);

    if query.trim().is_empty() {
        return files
            .into_iter()
            .take(limit)
            .map(|(path, rel)| FuzzyMatch { path, rel, score: 0 })
            .collect();
    }

    // Map rel -> abs so we can recover absolute paths from match results.
    let abs_by_rel: HashMap<&str, &str> = files
        .iter()
        .map(|(abs, rel)| (rel.as_str(), abs.as_str()))
        .collect();

    let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
    let pattern = Pattern::parse(query, CaseMatching::Smart, Normalization::Smart);
    let mut matches =
        pattern.match_list(files.iter().map(|(_, rel)| rel.as_str()), &mut matcher);
    matches.truncate(limit);

    matches
        .into_iter()
        .map(|(rel, score)| FuzzyMatch {
            path: abs_by_rel.get(rel).copied().unwrap_or(rel).to_string(),
            rel: rel.to_string(),
            score,
        })
        .collect()
}
