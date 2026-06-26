//! Plugin manifest (`plugin.toml`): declares identity, how to launch the
//! plugin process, and its contribution points (v1: formatters + commands).
//! Unknown fields are ignored so the schema can grow without breaking plugins.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: &str = "1.0";

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub plugin: PluginMeta,
    // Parsed for forward-compat (protocol/engine version gating); not yet read.
    #[serde(default)]
    #[allow(dead_code)]
    pub engine: Engine,
    /// How to launch the process. Absent for grammar-only plugins (which never
    /// spawn a process — the host just reads their grammar files).
    #[serde(default)]
    pub entry: Option<Entry>,
    #[serde(default)]
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PluginMeta {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Engine {
    #[serde(default)]
    #[allow(dead_code)]
    pub protocol: String,
}

/// How to launch the plugin process. v1 supports an interpreter command
/// (e.g. `node index.mjs`); per-OS native binaries come later.
#[derive(Debug, Clone, Deserialize)]
pub struct Entry {
    pub command: Option<CommandEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CommandEntry {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    #[serde(default)]
    pub formatters: Vec<Formatter>,
    #[serde(default)]
    pub grammars: Vec<Grammar>,
    #[serde(default)]
    pub commands: Vec<CommandContribution>,
    #[serde(default)]
    pub ai_actions: Vec<AiAction>,
    #[serde(default)]
    pub activation_events: Vec<String>,
}

/// A static TextMate grammar contribution (syntax highlighting). The host reads
/// the grammar file and hands it to the frontend highlighter — no process is
/// spawned for highlighting.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grammar {
    pub scope_name: String,
    pub language_id: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Path to the `*.tmLanguage.json` file, relative to the plugin dir.
    pub path: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAction {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub streaming: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Formatter {
    pub language_id: String,
    #[serde(default)]
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandContribution {
    pub id: String,
    #[serde(default)]
    pub title: String,
}

impl Manifest {
    pub fn load(dir: &Path) -> Result<Manifest, String> {
        let path = dir.join("plugin.toml");
        let text = fs::read_to_string(&path)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        toml::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
    }

    /// Does this plugin contribute a formatter for the given language id?
    pub fn formats_language(&self, language_id: &str) -> bool {
        self.capabilities
            .formatters
            .iter()
            .any(|f| f.language_id == language_id)
    }

    /// Does this plugin provide the given AI action?
    pub fn provides_ai_action(&self, action_id: &str) -> bool {
        self.capabilities.ai_actions.iter().any(|a| a.id == action_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_command_plugin_with_a_formatter() {
        let toml = r#"
            [plugin]
            id = "ediater.json-formatter"
            name = "JSON Formatter"
            version = "0.1.0"

            [engine]
            protocol = "1.0"

            [entry.command]
            program = "node"
            args = ["index.mjs"]

            [capabilities]
            activationEvents = ["onLanguage:json"]

            [[capabilities.formatters]]
            languageId = "json"
            extensions = [".json"]
        "#;
        let m: Manifest = toml::from_str(toml).expect("parse");
        assert_eq!(m.plugin.id, "ediater.json-formatter");
        let command = m.entry.as_ref().and_then(|e| e.command.as_ref()).unwrap();
        assert_eq!(command.program, "node");
        assert!(m.formats_language("json"));
        assert!(!m.formats_language("php"));
        assert_eq!(m.capabilities.activation_events, vec!["onLanguage:json"]);
    }
}
