//! Plugin host: discovers plugins from the plugins directory, lazily spawns a
//! plugin process (with the JSON-RPC handshake) on first use, and routes
//! capability requests (v1: formatting). A crashed connection is dropped so it
//! respawns on the next request.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use super::connection::Connection;
use super::manifest::{AiAction, CommandContribution, Manifest, PROTOCOL_VERSION};

pub struct DiscoveredPlugin {
    pub dir: PathBuf,
    pub manifest: Manifest,
}

/// requestId -> (frontend stream channel, plugin id serving it).
type AiStreams = Arc<Mutex<HashMap<String, (Channel<Value>, String)>>>;

#[derive(Default)]
pub struct PluginHost {
    discovered: Vec<DiscoveredPlugin>,
    connections: HashMap<String, Connection>,
    ai_streams: AiStreams,
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
    pub ai_actions: Vec<AiAction>,
}

/// Forward an `ai/stream` notification to the frontend channel for its request.
fn route_ai_stream(streams: &AiStreams, value: Value) {
    if value.get("method").and_then(|m| m.as_str()) != Some("ai/stream") {
        return;
    }
    let params = match value.get("params") {
        Some(p) => p.clone(),
        None => return,
    };
    let request_id = match params.get("requestId").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return,
    };
    let kind = params
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if let Ok(map) = streams.lock() {
        if let Some((channel, _)) = map.get(&request_id) {
            let _ = channel.send(params);
        }
    }
    if kind == "done" || kind == "error" {
        if let Ok(mut map) = streams.lock() {
            map.remove(&request_id);
        }
    }
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
                ai_actions: p.manifest.capabilities.ai_actions.clone(),
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

        // Route this plugin's AI stream notifications to the frontend.
        let streams = self.ai_streams.clone();
        conn.set_notification_handler(Box::new(move |value| {
            route_ai_stream(&streams, value);
        }));

        self.connections.insert(plugin_id.to_string(), conn);
        Ok(())
    }

    /// Start a streaming AI action; stream events arrive on `channel`.
    pub fn ai_action(
        &mut self,
        action_id: &str,
        request_id: &str,
        prompt: &str,
        context: Value,
        channel: Channel<Value>,
    ) -> Result<(), String> {
        let plugin_id = self
            .discovered
            .iter()
            .find(|p| p.manifest.provides_ai_action(action_id))
            .map(|p| p.manifest.plugin.id.clone())
            .ok_or_else(|| format!("no plugin provides ai action '{action_id}'"))?;

        self.ensure_connection(&plugin_id)?;
        self.ai_streams
            .lock()
            .map_err(|_| "ai streams lock poisoned".to_string())?
            .insert(request_id.to_string(), (channel, plugin_id.clone()));

        self.connections
            .get(&plugin_id)
            .expect("connection just ensured")
            .notify(
                "ai/action",
                json!({
                    "actionId": action_id,
                    "requestId": request_id,
                    "prompt": prompt,
                    "context": context,
                }),
            )
    }

    /// Cancel an in-flight AI action.
    pub fn ai_cancel(&mut self, request_id: &str) -> Result<(), String> {
        let entry = self
            .ai_streams
            .lock()
            .map_err(|_| "ai streams lock poisoned".to_string())?
            .remove(request_id);
        if let Some((_, plugin_id)) = entry {
            if let Some(conn) = self.connections.get(&plugin_id) {
                let _ = conn.notify("ai/cancel", json!({ "requestId": request_id }));
            }
        }
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
