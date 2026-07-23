use std::collections::HashSet;
use std::io;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio::{net, time};

use crate::domain::{Host, HostInput, HostView};
use crate::error::{AppError, AppResult};
use crate::repository::host_repo;
use crate::state::AppState;

const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const HEALTH_CONCURRENCY: usize = 32;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostHealthCheck {
    pub host_id: String,
    pub status: HostHealthStatus,
    pub latency_ms: Option<u128>,
    pub checked_at: String,
    pub error_kind: Option<HostHealthErrorKind>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HostHealthStatus {
    Online,
    Offline,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HostHealthErrorKind {
    Timeout,
    Refused,
    Dns,
    InvalidPort,
    Network,
    Unknown,
}

#[tauri::command]
pub async fn hosts_list(state: State<'_, AppState>) -> AppResult<Vec<HostView>> {
    Ok(host_repo::list(&state.db)
        .await?
        .into_iter()
        .map(HostView::from)
        .collect())
}

#[tauri::command]
pub async fn hosts_get(state: State<'_, AppState>, id: String) -> AppResult<HostView> {
    Ok(host_repo::get(&state.db, &id).await?.into())
}

#[tauri::command]
pub async fn hosts_reveal_password(state: State<'_, AppState>, id: String) -> AppResult<String> {
    host_repo::get(&state.db, &id)
        .await?
        .password
        .filter(|password| !password.is_empty())
        .ok_or_else(|| AppError::NotFound(format!("password for host {id}")))
}

#[tauri::command]
pub async fn hosts_create(state: State<'_, AppState>, input: HostInput) -> AppResult<HostView> {
    Ok(host_repo::create(&state.db, input).await?.into())
}

#[tauri::command]
pub async fn hosts_update(
    state: State<'_, AppState>,
    id: String,
    input: HostInput,
) -> AppResult<HostView> {
    Ok(host_repo::update(&state.db, &id, input).await?.into())
}

#[tauri::command]
pub async fn hosts_set_os_hint(
    state: State<'_, AppState>,
    id: String,
    os_hint: String,
) -> AppResult<HostView> {
    Ok(host_repo::set_os_hint(&state.db, &id, os_hint)
        .await?
        .into())
}

#[tauri::command]
pub async fn hosts_move(
    state: State<'_, AppState>,
    id: String,
    group_id: Option<String>,
) -> AppResult<HostView> {
    Ok(host_repo::move_to_group(&state.db, &id, group_id)
        .await?
        .into())
}

#[tauri::command]
pub async fn hosts_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    host_repo::delete(&state.db, &id).await
}

#[tauri::command]
pub async fn hosts_check_health(
    state: State<'_, AppState>,
    host_ids: Option<Vec<String>>,
    on_result: tauri::ipc::Channel<HostHealthCheck>,
) -> AppResult<Vec<HostHealthCheck>> {
    let hosts = host_repo::list(&state.db).await?;
    let selected: Vec<Host> = match host_ids {
        Some(ids) => {
            let ids: HashSet<String> = ids.into_iter().collect();
            hosts
                .into_iter()
                .filter(|host| ids.contains(&host.id))
                .collect()
        }
        None => hosts,
    };

    let limit = Arc::new(Semaphore::new(HEALTH_CONCURRENCY));
    let mut tasks = JoinSet::new();
    for host in selected {
        let limit = limit.clone();
        tasks.spawn(async move {
            let _permit = limit
                .acquire_owned()
                .await
                .map_err(|err| AppError::Other(format!("health check failed: {err}")))?;

            Ok::<_, AppError>(check_host_health(host).await)
        });
    }

    let mut results = Vec::new();
    while let Some(task) = tasks.join_next().await {
        let result = task.map_err(|err| AppError::Other(format!("health check failed: {err}")))?;
        let result = result?;
        let _ = on_result.send(result.clone());
        results.push(result);
    }
    Ok(results)
}

async fn check_host_health(host: Host) -> HostHealthCheck {
    let checked_at = crate::domain::now();

    let port = match u16::try_from(host.port) {
        Ok(port) => port,
        Err(_) => {
            return HostHealthCheck {
                host_id: host.id,
                status: HostHealthStatus::Offline,
                latency_ms: None,
                checked_at,
                error_kind: Some(HostHealthErrorKind::InvalidPort),
                error: Some(format!("invalid port {}", host.port)),
            };
        }
    };

    match time::timeout(HEALTH_TIMEOUT, probe_host(&host.address, port)).await {
        Ok(Ok(elapsed)) => HostHealthCheck {
            host_id: host.id,
            status: HostHealthStatus::Online,
            latency_ms: Some(elapsed.as_millis()),
            checked_at,
            error_kind: None,
            error: None,
        },
        Ok(Err(err)) => offline_health(
            host.id,
            checked_at,
            classify_health_error(&err),
            err.to_string(),
        ),
        Err(_) => offline_health(
            host.id,
            checked_at,
            HostHealthErrorKind::Timeout,
            "health check timed out".to_string(),
        ),
    }
}

fn offline_health(
    host_id: String,
    checked_at: String,
    error_kind: HostHealthErrorKind,
    error: String,
) -> HostHealthCheck {
    HostHealthCheck {
        host_id,
        status: HostHealthStatus::Offline,
        latency_ms: None,
        checked_at,
        error_kind: Some(error_kind),
        error: Some(error),
    }
}

async fn probe_host(address: &str, port: u16) -> Result<Duration, io::Error> {
    let addrs = net::lookup_host((address, port))
        .await?
        .take(4)
        .collect::<Vec<_>>();
    if addrs.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "no address resolved",
        ));
    }
    let mut last_error = None;
    for addr in addrs {
        let started = Instant::now();
        match net::TcpStream::connect(addr).await {
            Ok(stream) => {
                drop(stream);
                return Ok(started.elapsed());
            }
            Err(err) => last_error = Some(err),
        }
    }

    Err(last_error.unwrap_or_else(|| io::Error::other("connection failed")))
}

fn classify_health_error(err: &io::Error) -> HostHealthErrorKind {
    match err.kind() {
        io::ErrorKind::TimedOut => HostHealthErrorKind::Timeout,
        io::ErrorKind::ConnectionRefused => HostHealthErrorKind::Refused,
        io::ErrorKind::AddrNotAvailable | io::ErrorKind::NotFound => HostHealthErrorKind::Dns,
        io::ErrorKind::NetworkUnreachable
        | io::ErrorKind::HostUnreachable
        | io::ErrorKind::ConnectionAborted
        | io::ErrorKind::ConnectionReset => HostHealthErrorKind::Network,
        _ => HostHealthErrorKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(address: String, port: i64) -> Host {
        Host {
            id: "health-host".to_string(),
            label: "Health host".to_string(),
            address,
            port,
            group_id: None,
            identity_id: None,
            username: Some("root".to_string()),
            auth_type: Some("agent".to_string()),
            key_id: None,
            os_hint: None,
            notes: None,
            password: None,
            jump_host_id: None,
            startup_command: None,
            last_used_at: None,
            created_at: crate::domain::now(),
            updated_at: crate::domain::now(),
            deleted_at: None,
            revision: 1,
        }
    }

    #[tokio::test]
    async fn health_check_rejects_an_invalid_port_without_network_io() {
        let result = check_host_health(host("127.0.0.1".to_string(), 70_000)).await;
        assert!(matches!(result.status, HostHealthStatus::Offline));
        assert!(matches!(
            result.error_kind,
            Some(HostHealthErrorKind::InvalidPort)
        ));
    }
}
