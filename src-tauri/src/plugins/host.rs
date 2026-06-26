//! Plugin host: discovers plugins from the plugins directory, lazily spawns a
//! plugin process (with the JSON-RPC handshake) on first use, and routes
//! capability requests (v1: formatting). A crashed connection is dropped so it
//! respawns on the next request.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::json;

use super::connection::Connection;
use super::manifest::{CommandContribution, Manifest, PROTOCOL_VERSION};

pub struct DiscoveredPlugin {
    pub dir: PathBuf,
    pub manifest: Manifest,
}

#[derive(Default)]
pub struct PluginHost {
    discovered: Vec<DiscoveredPlugin>,
    connections: HashMap<String, Connection>,
    loaded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDescriptor {
    pub id: String,
    pub name: String,
    pub version: String,
    /// Language ids this plugin can format.
    pub formatters: Vec<String>,
    pub commands: Vec<CommandContribution>,
}

impl PluginHost {
    pub fn discover(&mut self, dirs: &[PathBuf]) {
        self.discovered.clear();
        for base in dirs {
            let entries = match std::fs::read_dir(base) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let dir = entry.path();
                if !dir.is_dir() {
                    continue;
                }
                if let Ok(manifest) = Manifest::load(&dir) {
                    self.discovered.push(DiscoveredPlugin { dir, manifest });
                }
            }
        }
        self.loaded = true;
    }

    pub fn ensure_discovered(&mut self, dirs: &[PathBuf]) {
        if !self.loaded {
            self.discover(dirs);
        }
    }

    pub fn list(&self) -> Vec<PluginDescriptor> {
        self.discovered
            .iter()
            .map(|p| PluginDescriptor {
                id: p.manifest.plugin.id.clone(),
                name: p.manifest.plugin.name.clone(),
                version: p.manifest.plugin.version.clone(),
                formatters: p
                    .manifest
                    .capabilities
                    .formatters
                    .iter()
                    .map(|f| f.language_id.clone())
                    .collect(),
                commands: p.manifest.capabilities.commands.clone(),
            })
            .collect()
    }

    fn ensure_connection(&mut self, plugin_id: &str) -> Result<(), String> {
        if self.connections.contains_key(plugin_id) {
            return Ok(());
        }
        let plugin = self
            .discovered
            .iter()
            .find(|p| p.manifest.plugin.id == plugin_id)
            .ok_or_else(|| format!("unknown plugin {plugin_id}"))?;
        let command = plugin
            .manifest
            .entry
            .command
            .as_ref()
            .ok_or_else(|| format!("plugin {plugin_id} has no [entry.command]"))?;

        let conn = Connection::spawn(&command.program, &command.args, &plugin.dir)?;
        conn.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "host": { "name": "ediater", "version": env!("CARGO_PKG_VERSION") },
            }),
        )?;
        let _ = conn.notify("initialized", json!({}));
        self.connections.insert(plugin_id.to_string(), conn);
        Ok(())
    }

    /// Format `text` via the first plugin that handles `language_id`.
    pub fn format(
        &mut self,
        path: &str,
        language_id: &str,
        text: &str,
    ) -> Result<String, String> {
        let plugin_id = self
            .discovered
            .iter()
            .find(|p| p.manifest.formats_language(language_id))
            .map(|p| p.manifest.plugin.id.clone())
            .ok_or_else(|| format!("no formatter plugin for '{language_id}'"))?;

        self.ensure_connection(&plugin_id)?;

        let result = self
            .connections
            .get(&plugin_id)
            .expect("connection just ensured")
            .request(
                "format",
                json!({
                    "path": path,
                    "languageId": language_id,
                    "text": text,
                    "options": { "tabSize": 2, "insertSpaces": true },
                }),
            );

        match result {
            Ok(value) => value
                .get("text")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "formatter returned no text".to_string()),
            Err(e) => {
                // Drop the (possibly dead) connection so it respawns next time.
                self.connections.remove(&plugin_id);
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "spawns the sample node plugin; run with `cargo test -- --ignored`"]
    fn formats_json_via_sample_plugin() {
        let plugins_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../plugins");
        let mut host = PluginHost::default();
        host.discover(&[plugins_dir]);
        assert!(
            host.discovered.iter().any(|p| p.manifest.plugin.id == "ediater.json-formatter"),
            "sample plugin not discovered",
        );
        let formatted = host
            .format("a.json", "json", "{\"b\":2,\"a\":1}")
            .expect("format should succeed");
        assert!(formatted.contains("\"b\": 2"), "got: {formatted}");
        assert!(formatted.contains('\n'), "should be pretty-printed");
    }
}
