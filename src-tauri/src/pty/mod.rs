use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

pub const EVENT_DATA: &str = "pty://data";
pub const EVENT_EXIT: &str = "pty://exit";

const TERM: &str = "xterm-256color";

type PtyMap = Arc<Mutex<HashMap<String, PtyEntry>>>;

struct PtyEntry {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DataEvent {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    id: String,
    code: u32,
}

#[derive(Default)]
pub struct PtyManager {
    ptys: PtyMap,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open(&self, app: AppHandle, id: String, cols: u32, rows: u32) -> AppResult<()> {
        let size = PtySize {
            rows: rows.clamp(1, u16::MAX as u32) as u16,
            cols: cols.clamp(1, u16::MAX as u32) as u16,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| AppError::Other(e.to_string()))?;

        let mut cmd = CommandBuilder::new_default_prog();
        cmd.env("TERM", TERM);
        if let Some(home) = home_dir() {
            cmd.cwd(home);
        }

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Other(e.to_string()))?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let killer = child.clone_killer();

        self.ptys.lock().insert(
            id.clone(),
            PtyEntry {
                master: pair.master,
                writer,
                killer,
            },
        );

        spawn_reader(app.clone(), id.clone(), reader);

        let ptys = self.ptys.clone();
        std::thread::spawn(move || {
            let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
            ptys.lock().remove(&id);
            let _ = app.emit(EVENT_EXIT, ExitEvent { id, code });
        });

        Ok(())
    }

    pub fn write(&self, id: &str, data: Vec<u8>) -> AppResult<()> {
        let mut ptys = self.ptys.lock();
        let entry = ptys
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
        entry
            .writer
            .write_all(&data)
            .and_then(|()| entry.writer.flush())
            .map_err(|e| AppError::Other(e.to_string()))
    }

    pub fn resize(&self, id: &str, cols: u32, rows: u32) -> AppResult<()> {
        let ptys = self.ptys.lock();
        let entry = ptys
            .get(id)
            .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
        entry
            .master
            .resize(PtySize {
                rows: rows.clamp(1, u16::MAX as u32) as u16,
                cols: cols.clamp(1, u16::MAX as u32) as u16,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(e.to_string()))
    }

    pub fn close(&self, id: &str) -> AppResult<()> {
        if let Some(mut entry) = self.ptys.lock().remove(id) {
            let _ = entry.killer.kill();
        }
        Ok(())
    }
}

fn spawn_reader(app: AppHandle, id: String, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let _ = app.emit(
                        EVENT_DATA,
                        DataEvent {
                            id: id.clone(),
                            data: STANDARD.encode(&buf[..n]),
                        },
                    );
                }
            }
        }
    });
}

fn home_dir() -> Option<String> {
    #[cfg(windows)]
    let key = "USERPROFILE";
    #[cfg(not(windows))]
    let key = "HOME";
    std::env::var(key).ok().filter(|v| !v.is_empty())
}
