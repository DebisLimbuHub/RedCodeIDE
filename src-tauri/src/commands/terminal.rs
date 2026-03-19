use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

/// One live PTY session.
struct PtySession {
    /// Write half: forwarded from the frontend (xterm.js keystrokes → shell stdin).
    writer: Box<dyn Write + Send>,
    /// Master PTY: kept alive so the slave fd stays open; used for resize.
    /// portable-pty v0.8 only guarantees Send (not Sync) on MasterPty.
    master: Box<dyn portable_pty::MasterPty + Send>,
    /// Child process handle: dropped on close → SIGHUP to the shell.
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

// SAFETY: all fields already have Send bounds declared in their trait objects.
// Sync is not required because sessions are always accessed under the Mutex.
unsafe impl Sync for PtySession {}

/// Shared state managed by Tauri — registered with `.manage()` in lib.rs.
pub struct TerminalState(Mutex<HashMap<String, PtySession>>);

impl TerminalState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/// Emitted on the "terminal-data" event for every chunk of PTY output.
#[derive(Clone, Serialize)]
pub struct TerminalDataPayload {
    pub id: String,
    /// Raw bytes from the PTY master — serialised as a JSON array of u8.
    pub data: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Spawn a new PTY + shell and return its session ID.
///
/// The shell is taken from `$SHELL`, falling back to `/bin/bash`.
/// A background OS thread reads PTY output and emits `terminal-data` events.
#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    rows: u16,
    cols: u16,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();

    let pty_system = NativePtySystem::default();

    // Open a new PTY pair.
    let portable_pty::PtyPair { master, slave } = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Spawn the user's shell inside the PTY slave.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");

    let child = slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    // Drop our copy of the slave fd.  If we hold it open, the master read
    // would block forever after the child exits (kernel keeps slave "busy").
    drop(slave);

    // Separate the write and read halves of the master.
    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    // Register session before the reader thread starts so that a very fast
    // exit can still find the entry for cleanup.
    {
        let mut sessions = state.0.lock().unwrap();
        sessions.insert(
            id.clone(),
            PtySession {
                writer,
                master,
                _child: child,
            },
        );
    }

    // Background thread: pump PTY stdout → Tauri events → xterm.js.
    let id_clone = id.clone();
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_clone.emit(
                        "terminal-data",
                        TerminalDataPayload {
                            id: id_clone.clone(),
                            data: buf[..n].to_vec(),
                        },
                    );
                }
            }
        }
        // Notify the frontend that the shell process exited.
        let _ = app_clone.emit("terminal-exit", &id_clone);
    });

    Ok(id)
}

/// Forward raw bytes from xterm.js to the PTY master (shell stdin).
///
/// `data` is a JSON `number[]` on the wire (Tauri serialises `Vec<u8>` that way).
#[tauri::command]
pub fn write_terminal(
    state: State<'_, TerminalState>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut sessions = state.0.lock().unwrap();
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("terminal session '{id}' not found"))?;

    session.writer.write_all(&data).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Notify the PTY of a size change so that line-wrapping tools (vim, less, …)
/// reflow correctly.
#[tauri::command]
pub fn resize_terminal(
    state: State<'_, TerminalState>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let sessions = state.0.lock().unwrap();
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("terminal session '{id}' not found"))?;

    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

/// Remove the session.  Dropping `PtySession` closes the master fd, which
/// sends SIGHUP to the shell.
#[tauri::command]
pub fn close_terminal(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    state.0.lock().unwrap().remove(&id);
    Ok(())
}
