use parking_lot::Mutex;
use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::domain::now;
use crate::repository::settings_repo;
use crate::state::AppState;

pub const EVENT: &str = "update://status";

const CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(4 * 60 * 60);
const CHECK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const DOWNLOAD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30 * 60);
const MAX_RELEASE_NOTES_BYTES: usize = 16 * 1024;

const LAST_CHECKED_AT_KEY: &str = "update.last_checked_at";
const LAST_KNOWN_VERSION_KEY: &str = "update.last_known_version";
const LAST_KNOWN_BODY_KEY: &str = "update.last_known_body";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum UpdateStatus {
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
        body: Option<String>,
    },
    Downloading {
        version: String,
        downloaded: u64,
        total: Option<u64>,
    },
    Ready {
        version: String,
    },
    Error {
        operation: UpdateOperation,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateOperation {
    Check,
    Install,
}

pub struct UpdateManager {
    status: Mutex<UpdateStatus>,
    pending: Mutex<Option<Update>>,
    /// Prevents a periodic check, a manual check, and repeated install clicks
    /// from racing and replacing each other's status or pending package.
    operation: tokio::sync::Mutex<()>,
}

impl UpdateManager {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(UpdateStatus::Idle),
            pending: Mutex::new(None),
            operation: tokio::sync::Mutex::new(()),
        }
    }

    pub fn snapshot(&self) -> UpdateStatus {
        self.status.lock().clone()
    }
}

pub fn can_self_update() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("APPIMAGE")
            .filter(|path| !path.is_empty())
            .is_some_and(|path| std::path::Path::new(&path).is_file())
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

fn release_notes(body: Option<&str>) -> Option<String> {
    let body = body?.trim();
    if body.is_empty() {
        return None;
    }

    let mut end = body.len().min(MAX_RELEASE_NOTES_BYTES);
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    let mut notes = body[..end].to_string();
    if end < body.len() {
        notes.push('…');
    }
    Some(notes)
}

fn set_status(app: &AppHandle, mgr: &UpdateManager, status: UpdateStatus) {
    *mgr.status.lock() = status.clone();
    let _ = app.emit(EVENT, status);
}

async fn persist_check(pool: &SqlitePool, update: Option<(&str, Option<&str>)>) {
    let _ = settings_repo::set(pool, LAST_CHECKED_AT_KEY, &now()).await;
    let (version, body) = match update {
        Some((version, body)) => (version, body.unwrap_or("")),
        None => ("", ""),
    };
    let _ = settings_repo::set(pool, LAST_KNOWN_VERSION_KEY, version).await;
    let _ = settings_repo::set(pool, LAST_KNOWN_BODY_KEY, body).await;
}

pub async fn run_periodic(app: AppHandle) {
    loop {
        let busy = matches!(
            app.state::<AppState>().update.snapshot(),
            UpdateStatus::Checking | UpdateStatus::Downloading { .. } | UpdateStatus::Ready { .. }
        );
        if !busy {
            check(&app).await;
        }
        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}

pub async fn check(app: &AppHandle) -> UpdateStatus {
    let state = app.state::<AppState>();
    let Ok(_operation) = state.update.operation.try_lock() else {
        return state.update.snapshot();
    };

    let current = state.update.snapshot();
    if matches!(
        current,
        UpdateStatus::Downloading { .. } | UpdateStatus::Ready { .. }
    ) {
        return current;
    }
    set_status(app, &state.update, UpdateStatus::Checking);

    let outcome = match app.updater_builder().timeout(CHECK_TIMEOUT).build() {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };

    let status = match outcome {
        Ok(Some(update)) => {
            let body = release_notes(update.body.as_deref());
            persist_check(&state.db, Some((&update.version, body.as_deref()))).await;
            let status = UpdateStatus::Available {
                version: update.version.clone(),
                body,
            };
            *state.update.pending.lock() = Some(update);
            status
        }
        Ok(None) => {
            persist_check(&state.db, None).await;
            *state.update.pending.lock() = None;
            UpdateStatus::UpToDate
        }
        Err(e) => UpdateStatus::Error {
            operation: UpdateOperation::Check,
            message: e.to_string(),
        },
    };

    set_status(app, &state.update, status.clone());
    status
}

pub async fn install(app: &AppHandle) -> UpdateStatus {
    let state = app.state::<AppState>();

    if !can_self_update() {
        let status = UpdateStatus::Error {
            operation: UpdateOperation::Install,
            message: "self-update is unavailable for this installation".to_string(),
        };
        set_status(app, &state.update, status.clone());
        return status;
    }

    let Ok(_operation) = state.update.operation.try_lock() else {
        return state.update.snapshot();
    };

    let Some(mut update) = state.update.pending.lock().clone() else {
        let status = UpdateStatus::Error {
            operation: UpdateOperation::Install,
            message: "no update available to install".to_string(),
        };
        set_status(app, &state.update, status.clone());
        return status;
    };

    let version = update.version.clone();
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    set_status(
        app,
        &state.update,
        UpdateStatus::Downloading {
            version: version.clone(),
            downloaded: 0,
            total: None,
        },
    );

    let app_progress = app.clone();
    let version_progress = version.clone();
    let mut downloaded: u64 = 0;
    let result = update
        .download_and_install(
            move |chunk_len, total| {
                downloaded = downloaded.saturating_add(chunk_len as u64);
                let state = app_progress.state::<AppState>();
                set_status(
                    &app_progress,
                    &state.update,
                    UpdateStatus::Downloading {
                        version: version_progress.clone(),
                        downloaded,
                        total,
                    },
                );
            },
            || {},
        )
        .await;

    let status = match result {
        Ok(()) => UpdateStatus::Ready { version },
        Err(e) => UpdateStatus::Error {
            operation: UpdateOperation::Install,
            message: e.to_string(),
        },
    };
    set_status(app, &state.update, status.clone());
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_notes_trim_empty_and_bound_utf8() {
        assert_eq!(release_notes(None), None);
        assert_eq!(release_notes(Some(" \n\t ")), None);
        assert_eq!(release_notes(Some("  fixes  ")).as_deref(), Some("fixes"));

        let long = "界".repeat(MAX_RELEASE_NOTES_BYTES);
        let notes = release_notes(Some(&long)).unwrap();
        assert!(notes.len() <= MAX_RELEASE_NOTES_BYTES + '…'.len_utf8());
        assert!(notes.ends_with('…'));
        assert!(notes.is_char_boundary(notes.len()));
    }

    #[tokio::test]
    async fn update_operations_are_exclusive() {
        let manager = UpdateManager::new();
        let first = manager.operation.try_lock().unwrap();
        assert!(manager.operation.try_lock().is_err());
        drop(first);
        assert!(manager.operation.try_lock().is_ok());
    }
}
