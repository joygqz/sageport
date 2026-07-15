use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

use super::exec::exec_capture_limited;
use super::session::SessionManager;
use crate::error::{AppError, AppResult};

pub const EVENT_STATS: &str = "monitor://stats";

const POLL_INTERVAL: Duration = Duration::from_secs(5);
const UNSUPPORTED_BACKOFF: Duration = Duration::from_secs(30);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_SAFE_INTEGER: u64 = (1u64 << 53) - 1;
const MAX_OS_NAME_CHARS: usize = 256;

const STATS_COMMAND: &str = "cat /proc/loadavg 2>/dev/null; echo ---; \
free -b 2>/dev/null; echo ---; df -kP / 2>/dev/null; echo ---; nproc 2>/dev/null; echo ---; \
cat /proc/uptime 2>/dev/null; echo ---; cat /etc/os-release 2>/dev/null; echo ---; \
cat /proc/net/dev 2>/dev/null";

#[derive(Debug, PartialEq, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HostStats {
    pub cpu_load: f64,
    pub cpu_count: u32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uptime_secs: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net_rx_rate: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net_tx_rate: Option<u64>,
}

#[derive(Debug, PartialEq, Clone, Copy)]
pub struct NetTotals {
    pub rx: u64,
    pub tx: u64,
}

#[derive(Debug, PartialEq)]
pub struct Sample {
    pub stats: HostStats,
    pub net: Option<NetTotals>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatsEvent {
    session_id: String,
    attempt: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    stats: Option<HostStats>,
    unsupported: bool,
}

fn parse_uptime(section: &str) -> Option<u64> {
    let secs: f64 = section.split_whitespace().next()?.parse().ok()?;
    (secs.is_finite() && secs >= 0.0 && secs <= MAX_SAFE_INTEGER as f64).then_some(secs as u64)
}

fn parse_os_release(section: &str) -> Option<String> {
    let line = section.lines().find(|l| l.starts_with("PRETTY_NAME="))?;
    let value = line.trim_start_matches("PRETTY_NAME=").trim();
    let value = value.trim_matches('"');
    let value: String = value
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_OS_NAME_CHARS)
        .collect();
    (!value.is_empty()).then_some(value)
}

fn parse_counter(value: &str) -> Option<u64> {
    let value = value.parse::<u64>().ok()?;
    (value <= MAX_SAFE_INTEGER).then_some(value)
}

fn parse_net_dev(section: &str) -> Option<NetTotals> {
    let mut rx = 0u64;
    let mut tx = 0u64;
    let mut seen = false;
    for line in section.lines() {
        let Some((iface, rest)) = line.split_once(':') else {
            continue;
        };
        if iface.trim() == "lo" {
            continue;
        }
        let cols: Vec<&str> = rest.split_whitespace().collect();
        if cols.len() < 9 {
            continue;
        }
        rx = rx.checked_add(parse_counter(cols[0])?)?;
        tx = tx.checked_add(parse_counter(cols[8])?)?;
        if rx > MAX_SAFE_INTEGER || tx > MAX_SAFE_INTEGER {
            return None;
        }
        seen = true;
    }
    if seen {
        Some(NetTotals { rx, tx })
    } else {
        None
    }
}

pub fn parse_stats(output: &str) -> Option<Sample> {
    let sections: Vec<&str> = output.split("---").collect();
    if sections.len() < 4 {
        return None;
    }

    let cpu_load: f64 = sections[0].split_whitespace().next()?.parse().ok()?;
    if !cpu_load.is_finite() || cpu_load < 0.0 {
        return None;
    }

    let mut mem_total = 0u64;
    let mut mem_used = 0u64;
    for line in sections[1].lines() {
        let mut cols = line.split_whitespace();
        if cols.next() == Some("Mem:") {
            let total = parse_counter(cols.next()?)?;
            let used = parse_counter(cols.next()?)?;
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
    let disk_total = parse_counter(disk_cols[1])?.checked_mul(1024)?;
    let disk_used = parse_counter(disk_cols[2])?.checked_mul(1024)?;
    if disk_total > MAX_SAFE_INTEGER || disk_used > MAX_SAFE_INTEGER {
        return None;
    }

    let cpu_count: u32 = sections[3].trim().parse().unwrap_or(1).max(1);

    Some(Sample {
        stats: HostStats {
            cpu_load,
            cpu_count,
            mem_used,
            mem_total,
            disk_used,
            disk_total,
            os: sections.get(5).and_then(|s| parse_os_release(s)),
            uptime_secs: sections.get(4).and_then(|s| parse_uptime(s)),
            net_rx_rate: None,
            net_tx_rate: None,
        },
        net: sections.get(6).and_then(|s| parse_net_dev(s)),
    })
}

struct ActiveMonitor {
    attempt: u32,
    generation: u64,
    shutdown: watch::Sender<bool>,
}

#[derive(Default)]
pub struct MonitorManager {
    active: Arc<Mutex<HashMap<String, ActiveMonitor>>>,
    next_generation: AtomicU64,
}

impl MonitorManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn stop(&self, session_id: &str, attempt: u32) {
        let monitor = {
            let mut active = self.active.lock();
            if active
                .get(session_id)
                .is_some_and(|monitor| monitor.attempt == attempt)
            {
                active.remove(session_id)
            } else {
                None
            }
        };
        if let Some(monitor) = monitor {
            let _ = monitor.shutdown.send(true);
        }
    }

    pub fn stop_all(&self) {
        for (_, monitor) in self.active.lock().drain() {
            let _ = monitor.shutdown.send(true);
        }
    }

    pub fn start(
        &self,
        app: AppHandle,
        sessions: Arc<SessionManager>,
        session_id: String,
        attempt: u32,
    ) -> AppResult<()> {
        if sessions
            .connection_for_attempt(&session_id, attempt)
            .is_none()
        {
            return Err(AppError::NotFound(format!("SSH session {session_id}")));
        }

        let (tx, rx) = watch::channel(false);
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let previous = {
            let mut active = self.active.lock();
            if active
                .get(&session_id)
                .is_some_and(|monitor| monitor.attempt == attempt)
            {
                return Ok(());
            }
            active.insert(
                session_id.clone(),
                ActiveMonitor {
                    attempt,
                    generation,
                    shutdown: tx,
                },
            )
        };
        if let Some(previous) = previous {
            let _ = previous.shutdown.send(true);
        }
        let active = self.active.clone();
        tokio::spawn(async move {
            run_monitor(app, sessions, session_id.clone(), attempt, rx).await;
            remove_finished(&active, &session_id, generation);
        });
        Ok(())
    }
}

fn remove_finished(
    active: &Mutex<HashMap<String, ActiveMonitor>>,
    session_id: &str,
    generation: u64,
) {
    let mut active = active.lock();
    if active
        .get(session_id)
        .is_some_and(|monitor| monitor.generation == generation)
    {
        active.remove(session_id);
    }
}

async fn run_monitor(
    app: AppHandle,
    sessions: Arc<SessionManager>,
    session_id: String,
    attempt: u32,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut prev_net: Option<(std::time::Instant, NetTotals)> = None;
    loop {
        let Some(conn) = sessions.connection_for_attempt(&session_id, attempt) else {
            break;
        };

        let result = tokio::select! {
            biased;
            _ = shutdown.changed() => break,
            result = tokio::time::timeout(
                COMMAND_TIMEOUT,
                exec_capture_limited(&conn.handle, STATS_COMMAND, MAX_OUTPUT_BYTES),
            ) => result,
        };
        if *shutdown.borrow() {
            break;
        }

        let interval = match result {
            Err(_) | Ok(Err(_)) => POLL_INTERVAL,
            Ok(Ok(output)) => match parse_stats(&output.stdout) {
                Some(mut sample) => {
                    let now = std::time::Instant::now();
                    if let (Some(net), Some((then, prev))) = (sample.net, prev_net) {
                        let secs = now.duration_since(then).as_secs_f64();
                        if secs > 0.0 && net.rx >= prev.rx && net.tx >= prev.tx {
                            sample.stats.net_rx_rate =
                                Some(((net.rx - prev.rx) as f64 / secs) as u64);
                            sample.stats.net_tx_rate =
                                Some(((net.tx - prev.tx) as f64 / secs) as u64);
                        }
                    }
                    prev_net = sample.net.map(|net| (now, net));
                    emit(&app, &session_id, attempt, Some(sample.stats));
                    POLL_INTERVAL
                }
                None => {
                    prev_net = None;
                    emit(&app, &session_id, attempt, None);
                    UNSUPPORTED_BACKOFF
                }
            },
        };
        drop(conn);

        tokio::select! {
            _ = tokio::time::sleep(interval) => {}
            _ = shutdown.changed() => break,
        }
    }
}

fn emit(app: &AppHandle, session_id: &str, attempt: u32, stats: Option<HostStats>) {
    let _ = app.emit(
        EVENT_STATS,
        StatsEvent {
            session_id: session_id.to_string(),
            attempt,
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
        let sample = parse_stats(output).expect("parsed");
        let stats = sample.stats;
        assert_eq!(stats.cpu_load, 0.52);
        assert_eq!(stats.cpu_count, 8);
        assert_eq!(stats.mem_total, 16000000000);
        assert_eq!(stats.mem_used, 8000000000);
        assert_eq!(stats.disk_total, 500000000 * 1024);
        assert_eq!(stats.disk_used, 200000000 * 1024);
        assert_eq!(stats.os, None);
        assert_eq!(stats.uptime_secs, None);
        assert_eq!(sample.net, None);
    }

    #[test]
    fn parses_extended_stats() {
        let output = "0.52 0.48 0.44 1/234 5678\n\
---\n\
              total        used        free\n\
Mem:    16000000000  8000000000  4000000000\n\
---\n\
Filesystem     1024-blocks      Used Available Capacity Mounted on\n\
/dev/disk1s1     500000000 200000000 300000000      40% /\n\
---\n\
8\n\
---\n\
123456.78 987654.32\n\
---\n\
NAME=\"Ubuntu\"\n\
PRETTY_NAME=\"Ubuntu 22.04.4 LTS\"\n\
VERSION_ID=\"22.04\"\n\
---\n\
Inter-|   Receive                                                |  Transmit\n\
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed\n\
    lo: 9000000    1000    0    0    0     0          0         0  9000000    1000    0    0    0     0       0          0\n\
  eth0: 5000000    4000    0    0    0     0          0         0  3000000    2000    0    0    0     0       0          0\n\
  eth1: 1000000    2000    0    0    0     0          0         0   500000    1000    0    0    0     0       0          0\n";
        let sample = parse_stats(output).expect("parsed");
        assert_eq!(sample.stats.uptime_secs, Some(123456));
        assert_eq!(sample.stats.os.as_deref(), Some("Ubuntu 22.04.4 LTS"));
        assert_eq!(
            sample.net,
            Some(NetTotals {
                rx: 6000000,
                tx: 3500000
            })
        );
    }

    #[test]
    fn rejects_non_linux_output() {
        assert!(parse_stats("command not found").is_none());
        assert!(parse_stats("0.1\n---\ngarbage\n---\n---\n").is_none());
    }

    #[test]
    fn rejects_invalid_or_overflowing_stats() {
        let invalid_cpu = "NaN\n---\nMem: 1 1\n---\nheader\nfs 1 1 0\n---\n1\n";
        assert!(parse_stats(invalid_cpu).is_none());

        let overflowing_disk = format!(
            "0.1\n---\nMem: 1 1\n---\nheader\nfs {} 1 0\n---\n1\n",
            u64::MAX
        );
        assert!(parse_stats(&overflowing_disk).is_none());
    }

    #[test]
    fn stale_task_cannot_remove_replacement() {
        let active = Mutex::new(HashMap::new());
        let (shutdown, _rx) = watch::channel(false);
        active.lock().insert(
            "session".into(),
            ActiveMonitor {
                attempt: 2,
                generation: 20,
                shutdown,
            },
        );

        remove_finished(&active, "session", 10);
        assert_eq!(active.lock().get("session").unwrap().generation, 20);

        remove_finished(&active, "session", 20);
        assert!(!active.lock().contains_key("session"));
    }
}
