use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;

use crate::error::{AppError, AppResult};
use crate::terminal_output::TerminalOutput;

const TERM: &str = "xterm-256color";

type PtyMap = Arc<Mutex<HashMap<String, PtyEntry>>>;

struct PtyEntry {
    attempt: u32,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Clone, Default)]
pub struct PtyManager {
    ptys: PtyMap,
}

impl PtyManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open(
        &self,
        on_event: Channel,
        id: String,
        attempt: u32,
        cols: u32,
        rows: u32,
    ) -> AppResult<()> {
        let mut ptys = self.ptys.lock();
        if ptys.get(&id).is_some_and(|entry| entry.attempt >= attempt) {
            return Ok(());
        }

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

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Other(e.to_string()))?;
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Other(e.to_string()))?;
        drop(pair.slave);
        let killer = child.clone_killer();

        let previous = ptys.insert(
            id.clone(),
            PtyEntry {
                attempt,
                master: Arc::new(Mutex::new(pair.master)),
                writer: Arc::new(Mutex::new(writer)),
                killer,
            },
        );
        drop(ptys);
        if let Some(mut previous) = previous {
            let _ = previous.killer.kill();
        }

        let output = Arc::new(TerminalOutput::new(on_event));
        if let Err(error) = output.status("connected", None) {
            self.close(&id, Some(attempt))?;
            return Err(error);
        }
        let reader = spawn_reader(output.clone(), reader);

        let ptys = self.ptys.clone();
        std::thread::spawn(move || {
            let _ = child.wait();
            let mut ptys = ptys.lock();
            if ptys.get(&id).is_some_and(|entry| entry.attempt == attempt) {
                ptys.remove(&id);
            }
            drop(ptys);
            let _ = reader.join();
            let _ = output.status("closed", None);
        });

        Ok(())
    }

    pub fn write(&self, id: &str, attempt: u32, data: Vec<u8>) -> AppResult<()> {
        let writer = {
            let ptys = self.ptys.lock();
            let entry = ptys
                .get(id)
                .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
            if entry.attempt != attempt {
                return Ok(());
            }
            entry.writer.clone()
        };
        let mut writer = writer.lock();
        writer
            .write_all(&data)
            .and_then(|()| writer.flush())
            .map_err(|e| AppError::Other(e.to_string()))
    }

    pub fn resize(&self, id: &str, attempt: u32, cols: u32, rows: u32) -> AppResult<()> {
        let master = {
            let ptys = self.ptys.lock();
            let entry = ptys
                .get(id)
                .ok_or_else(|| AppError::NotFound(format!("terminal {id}")))?;
            if entry.attempt != attempt {
                return Ok(());
            }
            entry.master.clone()
        };
        let result = master
            .lock()
            .resize(PtySize {
                rows: rows.clamp(1, u16::MAX as u32) as u16,
                cols: cols.clamp(1, u16::MAX as u32) as u16,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Other(e.to_string()));
        result
    }

    pub fn close(&self, id: &str, attempt: Option<u32>) -> AppResult<()> {
        let entry = {
            let mut ptys = self.ptys.lock();
            if ptys
                .get(id)
                .is_some_and(|entry| attempt.is_none_or(|value| value == entry.attempt))
            {
                ptys.remove(id)
            } else {
                None
            }
        };
        if let Some(mut entry) = entry {
            let _ = entry.killer.kill();
        }
        Ok(())
    }

    pub fn close_all(&self) {
        let entries: Vec<_> = self.ptys.lock().drain().map(|(_, entry)| entry).collect();
        for mut entry in entries {
            let _ = entry.killer.kill();
        }
    }
}

fn spawn_reader(
    output: Arc<TerminalOutput>,
    mut reader: Box<dyn Read + Send>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if output.write(&buf[..n]).is_err() {
                        break;
                    }
                }
            }
        }
    })
}

fn home_dir() -> Option<std::ffi::OsString> {
    #[cfg(windows)]
    let key = "USERPROFILE";
    #[cfg(not(windows))]
    let key = "HOME";
    std::env::var_os(key).filter(|value| !value.is_empty())
}
