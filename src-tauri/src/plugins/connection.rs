//! JSON-RPC 2.0 over a plugin process's stdio, framed with `Content-Length`
//! headers (LSP-style). A reader thread correlates responses back to pending
//! requests by id; stderr is drained to avoid blocking the child.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

type Pending = Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>;
type NotifHandler = Arc<Mutex<Option<Box<dyn Fn(Value) + Send>>>>;

pub struct Connection {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    next_id: AtomicU64,
    pending: Pending,
    notif: NotifHandler,
}

fn write_message(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    stdin
        .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
        .and_then(|_| stdin.write_all(&body))
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("write failed: {e}"))
}

/// Read one Content-Length-framed JSON message. Ok(None) on clean EOF.
fn read_message<R: BufRead>(reader: &mut R) -> std::io::Result<Option<Value>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Ok(None); // EOF
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break; // end of headers
        }
        if let Some(rest) = trimmed.strip_prefix("Content-Length:") {
            content_length = rest.trim().parse::<usize>().ok();
        }
    }
    let len = match content_length {
        Some(n) => n,
        None => return Ok(None),
    };
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    Ok(serde_json::from_slice(&buf).ok())
}

impl Connection {
    /// Spawn the plugin process and start its reader/stderr threads.
    pub fn spawn(program: &str, args: &[String], cwd: &Path) -> Result<Connection, String> {
        let mut child = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .env("TERM", "dumb")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("failed to spawn {program}: {e}"))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;

        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let notif: NotifHandler = Arc::new(Mutex::new(None));

        // Reader: route responses to their pending request by id; forward
        // notifications (no id) to the registered handler (e.g. AI streaming).
        {
            let pending = pending.clone();
            let notif = notif.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(stdout);
                loop {
                    match read_message(&mut reader) {
                        Ok(Some(value)) => {
                            let id = value.get("id").and_then(|v| v.as_u64());
                            let is_response = value.get("result").is_some()
                                || value.get("error").is_some();
                            if let (Some(id), true) = (id, is_response) {
                                let result = match value.get("error") {
                                    Some(err) => Err(err.to_string()),
                                    None => Ok(value
                                        .get("result")
                                        .cloned()
                                        .unwrap_or(Value::Null)),
                                };
                                if let Some(tx) =
                                    pending.lock().ok().and_then(|mut m| m.remove(&id))
                                {
                                    let _ = tx.send(result);
                                }
                            } else if id.is_none() && value.get("method").is_some() {
                                if let Ok(guard) = notif.lock() {
                                    if let Some(handler) = guard.as_ref() {
                                        handler(value);
                                    }
                                }
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
            });
        }

        // Drain stderr so a chatty plugin can't block on a full pipe.
        thread::spawn(move || {
            let mut sink = Vec::new();
            let _ = BufReader::new(stderr).read_to_end(&mut sink);
        });

        Ok(Connection {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            next_id: AtomicU64::new(1),
            pending,
            notif,
        })
    }

    /// Register a handler for plugin→host notifications (e.g. AI stream events).
    pub fn set_notification_handler(&self, handler: Box<dyn Fn(Value) + Send>) {
        if let Ok(mut guard) = self.notif.lock() {
            *guard = Some(handler);
        }
    }

    pub fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "pending lock poisoned".to_string())?
            .insert(id, tx);

        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        {
            let mut stdin = self.stdin.lock().map_err(|_| "stdin lock poisoned")?;
            write_message(&mut stdin, &msg)?;
        }

        match rx.recv_timeout(REQUEST_TIMEOUT) {
            Ok(result) => result,
            Err(_) => {
                self.pending.lock().ok().and_then(|mut m| m.remove(&id));
                Err(format!("plugin request '{method}' timed out"))
            }
        }
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        let mut stdin = self.stdin.lock().map_err(|_| "stdin lock poisoned")?;
        write_message(&mut stdin, &msg)
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
