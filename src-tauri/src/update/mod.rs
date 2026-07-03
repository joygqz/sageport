//! App-update orchestration.
//!
//! Every "dialog" in this app (see [`crate::state`]) is a real OS window, and
//! Settings in particular gets fully destroyed when closed and rebuilt from
//! scratch when reopened. So update state cannot live in per-window frontend
//! state without being lost the moment the user closes Settings mid-download.
//! Instead this module is the single source of truth, held for the lifetime
//! of the app process in [`crate::state::AppState`]. Every status change is
//! broadcast to all windows (present or future) over [`EVENT`], and any
//! window can pull the current snapshot on mount via the `update_status`
//! command — so reopening Settings after a download finished shows "ready to
//! restart" again instead of restarting the whole check from scratch.
//!
//! The outcome of each check is also persisted to the `settings` table
//! (`update.*` keys) purely as a record — it is per-device and deliberately
//! excluded from vault sync/backup (see `sync::EXCLUDED_SETTINGS_PREFIXES`).

use std::sync::Mutex;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::domain::now;
use crate::repository::settings_repo;
use crate::state::AppState;

/// Emitted to every window whenever the update status changes.
pub const EVENT: &str = "sageport://update-status";

const LAST_CHECKED_AT_KEY: &str = "update.last_checked_at";
const LAST_KNOWN_VERSION_KEY: &str = "update.last_known_version";
const LAST_KNOWN_BODY_KEY: &str = "update.last_known_body";

/// Mirrors the lifecycle the Settings UI renders. Business-level failures
/// (offline, bad signature, ...) are carried as `Error` data rather than a
/// command `Err`, since they're an expected outcome, not a transport fault.
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
        message: String,
    },
}

/// Process-lifetime update state, shared across every window.
pub struct UpdateManager {
    status: Mutex<UpdateStatus>,
    /// The update found by the last successful check, kept so `install` can
    /// download it without re-checking.
    pending: Mutex<Option<Update>>,
}

impl UpdateManager {
    pub fn new() -> Self {
        Self {
            status: Mutex::new(UpdateStatus::Idle),
            pending: Mutex::new(None),
        }
    }

    pub fn snapshot(&self) -> UpdateStatus {
        self.status.lock().unwrap().clone()
    }
}

fn set_status(app: &AppHandle, mgr: &UpdateManager, status: UpdateStatus) {
    *mgr.status.lock().unwrap() = status.clone();
    let _ = app.emit(EVENT, status);
}

/// Best-effort record of a check's outcome; failure to persist never fails
/// the check itself.
async fn persist_check(pool: &SqlitePool, update: Option<&Update>) {
    let _ = settings_repo::set(pool, LAST_CHECKED_AT_KEY, &now()).await;
    let (version, body) = match update {
        Some(u) => (u.version.as_str(), u.body.as_deref().unwrap_or("")),
        None => ("", ""),
    };
    let _ = settings_repo::set(pool, LAST_KNOWN_VERSION_KEY, version).await;
    let _ = settings_repo::set(pool, LAST_KNOWN_BODY_KEY, body).await;
}

/// Check the update endpoint, update shared state, persist the outcome, and
/// notify every window. Safe to call repeatedly — any previously pending
/// update is replaced.
pub async fn check(app: &AppHandle) -> UpdateStatus {
    let state = app.state::<AppState>();
    set_status(app, &state.update, UpdateStatus::Checking);

    let outcome = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };

    let status = match outcome {
        Ok(Some(update)) => {
            persist_check(&state.db, Some(&update)).await;
            let status = UpdateStatus::Available {
                version: update.version.clone(),
                body: update.body.clone(),
            };
            *state.update.pending.lock().unwrap() = Some(update);
            status
        }
        Ok(None) => {
            persist_check(&state.db, None).await;
            *state.update.pending.lock().unwrap() = None;
            UpdateStatus::UpToDate
        }
        Err(e) => UpdateStatus::Error {
            message: e.to_string(),
        },
    };

    set_status(app, &state.update, status.clone());
    status
}

/// Download and install whatever update the last [`check`] found, emitting
/// live progress under [`EVENT`] as it goes.
pub async fn install(app: &AppHandle) -> UpdateStatus {
    let state = app.state::<AppState>();
    let update = state.update.pending.lock().unwrap().clone();
    let Some(update) = update else {
        let status = UpdateStatus::Error {
            message: "no update available to install".to_string(),
        };
        set_status(app, &state.update, status.clone());
        return status;
    };

    let version = update.version.clone();
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
                downloaded += chunk_len as u64;
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
            message: e.to_string(),
        },
    };
    set_status(app, &state.update, status.clone());
    status
}
