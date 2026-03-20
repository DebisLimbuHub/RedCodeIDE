use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::db::DbState;
use crate::scope::{check_scope_with_conn, extract_targets_from_command, ScopeCheckResult};

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

/// One live PTY session.
struct PtySession {
    /// Write half: forwarded from the frontend (xterm.js keystrokes → shell stdin).
    writer: Box<dyn Write + Send>,
    /// Master PTY: kept alive so the slave fd stays open; used for resize.
    master: Box<dyn portable_pty::MasterPty + Send>,
    /// Child process handle: dropped on close → SIGHUP to the shell.
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    /// Accumulates the current input line between keystrokes.
    line_buffer: String,
    /// Engagement to scope-check against; None means no active engagement.
    engagement_id: Option<String>,
}

// SAFETY: all fields already have Send bounds declared in their trait objects.
unsafe impl Sync for PtySession {}

/// Shared state managed by Tauri.
pub struct TerminalState(Mutex<HashMap<String, PtySession>>);

impl TerminalState {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

/// Emitted on the "terminal-data" channel for every chunk of PTY output.
#[derive(Clone, Serialize)]
pub struct TerminalDataPayload {
    pub id: String,
    pub data: Vec<u8>,
}

/// Emitted on the "scope-warning" channel when a command is blocked.
#[derive(Clone, Serialize)]
pub struct ScopeWarningPayload {
    /// Which terminal session the blocked command came from.
    pub session_id: String,
    /// The full command string (trimmed).
    pub command: String,
    /// The scope check verdict (serialised as `{ "type": "OutOfScope", … }`).
    pub result: ScopeCheckResult,
}

// ---------------------------------------------------------------------------
// Line-buffer helpers
// ---------------------------------------------------------------------------

/// Update the tracked line buffer for a single incoming byte.
/// Mirrors the terminal control codes that bash/zsh readline honour.
fn update_line_buffer(buf: &mut String, byte: u8) {
    match byte {
        // DEL / Backspace — remove last character
        0x7f | 0x08 => { buf.pop(); }
        // Ctrl+C / Ctrl+U — kill line
        0x03 | 0x15 => { buf.clear(); }
        // Ctrl+W — kill last word
        0x17 => {
            let s = std::mem::take(buf);
            let without_space = s.trim_end_matches(|c: char| c == ' ');
            let without_word  = without_space.trim_end_matches(|c: char| c != ' ');
            *buf = without_word.to_string();
        }
        // ESC — start of an escape sequence we can't parse; reset buffer
        0x1b => { buf.clear(); }
        // Printable ASCII
        0x20..=0x7e => { buf.push(byte as char); }
        // Everything else (control chars, high bytes) — pass to PTY but don't
        // touch the buffer.
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Spawn a new PTY + shell and return its session ID.
#[tauri::command]
pub fn create_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    rows: u16,
    cols: u16,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();

    let pty_system = NativePtySystem::default();
    let portable_pty::PtyPair { master, slave } = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");

    let child = slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(slave);

    let writer = master.take_writer().map_err(|e| e.to_string())?;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;

    {
        let mut sessions = state.0.lock().unwrap();
        sessions.insert(id.clone(), PtySession {
            writer,
            master,
            _child: child,
            line_buffer: String::new(),
            engagement_id: None,
        });
    }

    // Background thread: PTY stdout → Tauri events → xterm.js
    let id_clone  = id.clone();
    let app_clone = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app_clone.emit("terminal-data", TerminalDataPayload {
                        id: id_clone.clone(),
                        data: buf[..n].to_vec(),
                    });
                }
            }
        }
        let _ = app_clone.emit("terminal-exit", &id_clone);
    });

    Ok(id)
}

/// Set the engagement that scope checks should run against for this session.
/// Called by the frontend whenever `currentEngagement` changes.
#[tauri::command]
pub fn set_terminal_engagement(
    state: State<'_, TerminalState>,
    id: String,
    engagement_id: Option<String>,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("terminal session '{id}' not found"))?;
    eprintln!("[terminal] set_terminal_engagement session={id:?} engagement={engagement_id:?}");
    session.engagement_id = engagement_id;
    Ok(())
}

/// Forward raw bytes from xterm.js to the PTY, intercepting Enter (\r / \n)
/// to run a scope check when a network-targeting command is detected.
///
/// Flow for bytes WITHOUT \r or \n:
///   – Update the line buffer tracker.
///   – Write the bytes to the PTY (user sees their typing echoed back).
///
/// Flow for bytes containing \r or \n:
///   – Flush any pre-newline bytes to the PTY and buffer.
///   – Run scope check on the accumulated command.
///   – InScope / no engagement / no network target → write \r, execute.
///   – Otherwise → emit "scope-warning" event, withhold \r from PTY.
#[tauri::command]
pub fn write_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    db: State<'_, DbState>,
    id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    // Find the first newline byte in the payload.
    let newline_pos = data.iter().position(|&b| b == b'\r' || b == b'\n');

    // ---- Phase 1: update buffer + write under sessions lock ----------------
    // Returns Some((command, newline_pos)) when a newline was found.
    let scope_work: Option<(String, Option<String>, usize)> = {
        let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
        let session = sessions
            .get_mut(&id)
            .ok_or_else(|| format!("terminal session '{id}' not found"))?;

        if let Some(pos) = newline_pos {
            // Update buffer with pre-newline bytes and write them to PTY.
            for &byte in &data[..pos] {
                update_line_buffer(&mut session.line_buffer, byte);
            }
            if pos > 0 {
                session.writer.write_all(&data[..pos]).map_err(|e| e.to_string())?;
                session.writer.flush().map_err(|e| e.to_string())?;
            }
            let command     = std::mem::take(&mut session.line_buffer);
            let engagement  = session.engagement_id.clone();
            Some((command.trim().to_string(), engagement, pos))
        } else {
            // No newline — just track the buffer and write everything.
            for &byte in &data {
                update_line_buffer(&mut session.line_buffer, byte);
            }
            session.writer.write_all(&data).map_err(|e| e.to_string())?;
            session.writer.flush().map_err(|e| e.to_string())?;
            None
        }
    }; // sessions lock released

    // ---- Phase 2: scope check (needs DB lock, sessions lock already free) --
    if let Some((command, engagement_id, pos)) = scope_work {
        // Only scope-check non-empty commands that target a network resource.
        let targets = extract_targets_from_command(&command);
        let needs_check = !command.is_empty()
            && !targets.is_empty()
            && engagement_id.is_some();

        if needs_check {
            let eid = engagement_id.unwrap();
            let result = {
                let db_conn = db.0.lock().map_err(|e| e.to_string())?;
                check_scope_with_conn(&db_conn, &eid, &command)?
            };

            if !matches!(result, ScopeCheckResult::InScope) {
                // Block: emit warning, do NOT send \r to the PTY.
                eprintln!("[terminal] scope blocked: cmd={command:?} result={result:?}");
                app.emit("scope-warning", ScopeWarningPayload {
                    session_id: id,
                    command,
                    result,
                }).map_err(|e| e.to_string())?;
                return Ok(());
            }
        }

        // Safe or no check needed — write \r (and any trailing bytes) to PTY.
        let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.get_mut(&id) {
            session.writer.write_all(&data[pos..]).map_err(|e| e.to_string())?;
            session.writer.flush().map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Execute a previously-blocked command: send Ctrl+U (clear the shell's line
/// buffer) followed by the command bytes and a carriage return.
///
/// Because the blocked \r was never sent to the PTY, the shell still has the
/// original typed text in its input buffer.  Ctrl+U wipes it cleanly before
/// we replay the full command, making the behaviour robust regardless of
/// whether extra characters were typed in the meantime.
#[tauri::command]
pub fn force_execute(
    state: State<'_, TerminalState>,
    id: String,
    command: String,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("terminal session '{id}' not found"))?;

    // Ctrl+U kills the current line in the shell, then we write command + Enter.
    let mut payload = Vec::with_capacity(command.len() + 2);
    payload.push(0x15); // Ctrl+U
    payload.extend_from_slice(command.as_bytes());
    payload.push(b'\r');

    session.writer.write_all(&payload).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Notify the PTY of a terminal resize.
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
    session.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

/// Remove a session; dropping PtySession closes the master fd → SIGHUP to shell.
#[tauri::command]
pub fn close_terminal(state: State<'_, TerminalState>, id: String) -> Result<(), String> {
    state.0.lock().unwrap().remove(&id);
    Ok(())
}
