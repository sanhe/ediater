//! Pseudo-terminal sessions backed by `portable-pty` (cross-platform: ConPTY on
//! Windows, Unix PTY elsewhere). A reader thread streams output to the frontend
//! base64-encoded over a Tauri channel; a `pty-exit` event fires on shell exit.

use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub fn next_pty_id() -> String {
    format!("pty-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    }
}

/// A live PTY: the writer feeds the shell's stdin, the master resizes it, and
/// the child is killed on close. The reader lives in its own thread.
pub struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

impl PtySession {
    pub fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.writer
            .write_all(data)
            .and_then(|_| self.writer.flush())
            .map_err(|e| format!("pty write failed: {e}"))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("pty resize failed: {e}"))
    }

    pub fn kill(&mut self) {
        let _ = self.child.kill();
    }
}

#[allow(clippy::too_many_arguments)]
pub fn spawn(
    app: AppHandle,
    id: String,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
    on_data: Channel<String>,
) -> Result<PtySession, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let shell = shell.filter(|s| !s.is_empty()).unwrap_or_else(default_shell);
    let mut cmd = CommandBuilder::new(shell);
    if let Some(dir) = cwd.filter(|c| !c.is_empty()) {
        cmd.cwd(dir);
    }
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn shell: {e}"))?;
    // The slave handle is held by the child now; drop ours in the parent.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to take pty writer: {e}"))?;

    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if on_data.send(BASE64.encode(&buf[..n])).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app.emit("pty-exit", id);
    });

    Ok(PtySession {
        writer,
        master: pair.master,
        child,
    })
}
