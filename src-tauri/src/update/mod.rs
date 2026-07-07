use std::sync::Mutex;

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::domain::now;
use crate::repository::settings_repo;
use crate::state::AppState;

pub const EVENT: &str = "sageport://update-status";

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
        message: String,
    },
}

pub struct UpdateManager {
    status: Mutex<UpdateStatus>,

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

async fn persist_check(pool: &SqlitePool, update: Option<&Update>) {
    let _ = settings_repo::set(pool, LAST_CHECKED_AT_KEY, &now()).await;
    let (version, body) = match update {
        Some(u) => (u.version.as_str(), u.body.as_deref().unwrap_or("")),
        None => ("", ""),
    };
    let _ = settings_repo::set(pool, LAST_KNOWN_VERSION_KEY, version).await;
    let _ = settings_repo::set(pool, LAST_KNOWN_BODY_KEY, body).await;
}

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
