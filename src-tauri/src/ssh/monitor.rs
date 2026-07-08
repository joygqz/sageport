use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use super::exec::exec_capture;
use super::session::SessionManager;

pub const EVENT_STATS: &str = "monitor://stats";

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const UNSUPPORTED_BACKOFF: Duration = Duration::from_secs(30);

const STATS_COMMAND: &str = "cat /proc/loadavg 2>/dev/null; echo ---; \
free -b 2>/dev/null; echo ---; df -kP / 2>/dev/null; echo ---; nproc 2>/dev/null";

#[derive(Debug, PartialEq, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HostStats {
    pub cpu_load: f64,
    pub cpu_count: u32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatsEvent {
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    stats: Option<HostStats>,
    unsupported: bool,
}

pub fn parse_stats(output: &str) -> Option<HostStats> {
    let sections: Vec<&str> = output.split("---").collect();
    if sections.len() < 4 {
        return None;
    }

    let cpu_load: f64 = sections[0].split_whitespace().next()?.parse().ok()?;

    let mut mem_total = 0u64;
    let mut mem_used = 0u64;
    for line in sections[1].lines() {
        let mut cols = line.split_whitespace();
        if cols.next() == Some("Mem:") {
            let total: u64 = cols.next()?.parse().ok()?;
            let used: u64 = cols.next()?.parse().ok()?;
            mem_total = total;
            mem_used = used;
        }
    }
    if mem_total == 0 {
        return None;
    }

    let disk_line = sections[2]
        .lines()
        .filter(|l| !l.trim().is_empty())
        .nth(1)?;
    let disk_cols: Vec<&str> = disk_line.split_whitespace().collect();
    if disk_cols.len() < 4 {
        return None;
    }
    let disk_total = disk_cols[1].parse::<u64>().ok()? * 1024;
    let disk_used = disk_cols[2].parse::<u64>().ok()? * 1024;

    let cpu_count: u32 = sections[3].trim().parse().unwrap_or(1).max(1);

    Some(HostStats {
        cpu_load,
        cpu_count,
        mem_used,
        mem_total,
        disk_used,
        disk_total,
    })
}

#[derive(Default)]
pub struct MonitorManager {
    active: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl MonitorManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stop(&self, session_id: &str) {
        if let Some(tx) = self.active.lock().remove(session_id) {
            let _ = tx.send(true);
        }
    }

    pub fn start(&self, app: AppHandle, sessions: Arc<SessionManager>, session_id: String) {
        let (tx, rx) = watch::channel(false);
        {
            let mut active = self.active.lock();
            if active.contains_key(&session_id) {
                return;
            }
            active.insert(session_id.clone(), tx);
        }
        let active = self.active.clone();
        tokio::spawn(async move {
            run_monitor(app, sessions, session_id.clone(), rx).await;
            active.lock().remove(&session_id);
        });
    }
}

async fn run_monitor(
    app: AppHandle,
    sessions: Arc<SessionManager>,
    session_id: String,
    mut shutdown: watch::Receiver<bool>,
) {
    loop {
        let Some(conn) = sessions.connection(&session_id) else {
            break;
        };

        let interval = match exec_capture(&conn.handle, STATS_COMMAND).await {
            Ok(output) => match parse_stats(&output.stdout) {
                Some(stats) => {
                    emit(&app, &session_id, Some(stats));
                    POLL_INTERVAL
                }
                None => {
                    emit(&app, &session_id, None);
                    UNSUPPORTED_BACKOFF
                }
            },
            Err(_) => break,
        };
        drop(conn);

        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = shutdown.changed() => break,
        }
    }
}

fn emit(app: &AppHandle, session_id: &str, stats: Option<HostStats>) {
    let _ = app.emit(
        EVENT_STATS,
        StatsEvent {
            session_id: session_id.to_string(),
            unsupported: stats.is_none(),
            stats,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_linux_stats() {
        let output = "0.52 0.48 0.44 1/234 5678\n\
---\n\
              total        used        free\n\
Mem:    16000000000  8000000000  4000000000\n\
Swap:    2000000000           0  2000000000\n\
---\n\
Filesystem     1024-blocks      Used Available Capacity Mounted on\n\
/dev/disk1s1     500000000 200000000 300000000      40% /\n\
---\n\
8\n";
        let stats = parse_stats(output).expect("parsed");
        assert_eq!(stats.cpu_load, 0.52);
        assert_eq!(stats.cpu_count, 8);
        assert_eq!(stats.mem_total, 16000000000);
        assert_eq!(stats.mem_used, 8000000000);
        assert_eq!(stats.disk_total, 500000000 * 1024);
        assert_eq!(stats.disk_used, 200000000 * 1024);
    }

    #[test]
    fn rejects_non_linux_output() {
        assert!(parse_stats("command not found").is_none());
        assert!(parse_stats("0.1\n---\ngarbage\n---\n---\n").is_none());
    }
}
