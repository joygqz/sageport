use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use russh_sftp::client::fs::Metadata;
use tauri::AppHandle;
use tokio::task::JoinSet;

use super::{emit_delete_event, ops, Conn, SftpManager, TransferCancel};
use crate::error::{AppError, AppResult};

const PHASE_DELETING: &str = "deleting";
const PHASE_SCANNING: &str = "scanning";
const MAX_REMOTE_DELETE_ENTRIES: u64 = 250_000;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

pub struct DeleteRequest {
    pub operation_id: String,
    pub connection_id: Option<String>,
    pub paths: Vec<String>,
}

#[derive(Default)]
struct DeletePlan {
    files: Vec<String>,
    directories: Vec<(usize, String)>,
}

impl DeletePlan {
    fn total(&self) -> u64 {
        (self.files.len() + self.directories.len()) as u64
    }
}

#[derive(Default)]
struct DeleteFailures {
    count: u64,
    first_message: Option<String>,
}

impl DeleteFailures {
    fn push(&mut self, path: &str, error: AppError) {
        self.count += 1;
        if self.first_message.is_none() {
            self.first_message = Some(format!("{path}: {error}"));
        }
    }

    fn result(self) -> AppResult<()> {
        if self.count == 0 {
            return Ok(());
        }
        let first = self.first_message.unwrap_or_default();
        Err(AppError::Other(format!(
            "{} items could not be deleted; first error: {first}",
            self.count
        )))
    }
}

#[derive(Clone)]
struct ProgressReporter {
    app: AppHandle,
    operation_id: String,
    connection_id: Option<String>,
    last_emit: Instant,
}

impl ProgressReporter {
    fn new(app: &AppHandle, request: &DeleteRequest) -> Self {
        Self {
            app: app.clone(),
            operation_id: request.operation_id.clone(),
            connection_id: request.connection_id.clone(),
            last_emit: Instant::now(),
        }
    }

    fn active(&mut self, completed: u64, total: u64, current_path: &str, phase: &str, force: bool) {
        let now = Instant::now();
        if !force && now.duration_since(self.last_emit) < PROGRESS_INTERVAL {
            return;
        }
        self.last_emit = now;
        emit_delete_event(
            &self.app,
            &self.operation_id,
            self.connection_id.as_deref(),
            completed,
            total,
            current_path,
            "active",
            Some(phase.to_string()),
            None,
            None,
        );
    }

    fn terminal(
        &self,
        completed: u64,
        total: u64,
        current_path: &str,
        status: &str,
        error: Option<&AppError>,
    ) {
        emit_delete_event(
            &self.app,
            &self.operation_id,
            self.connection_id.as_deref(),
            completed,
            total,
            current_path,
            status,
            None,
            error.map(ToString::to_string),
            error.map(|value| value.code().to_string()),
        );
    }
}

pub async fn delete(
    app: &AppHandle,
    manager: &SftpManager,
    request: DeleteRequest,
    cancel: Arc<TransferCancel>,
) {
    let mut reporter = ProgressReporter::new(app, &request);
    let first_path = request.paths.first().map(String::as_str).unwrap_or("");
    reporter.active(0, 0, first_path, PHASE_SCANNING, true);
    let outcome = match request.connection_id.as_deref() {
        Some(connection_id) => {
            delete_remote(
                manager,
                connection_id,
                &request.paths,
                &cancel,
                &mut reporter,
            )
            .await
        }
        None => {
            let paths = request.paths.clone();
            let cancel = cancel.clone();
            let mut worker_reporter = reporter.clone();
            match tauri::async_runtime::spawn_blocking(move || {
                delete_local(&paths, &cancel, &mut worker_reporter)
            })
            .await
            {
                Ok(result) => result,
                Err(error) => DeleteOutcome {
                    completed: 0,
                    total: 0,
                    current_path: first_path.to_string(),
                    result: Err(AppError::Other(format!("task join error: {error}"))),
                },
            }
        }
    };
    let completed = outcome.completed;
    let total = outcome.total;
    let current_path = outcome.current_path;
    match outcome.result {
        Ok(()) if cancel.is_cancelled() => {
            reporter.terminal(completed, total, &current_path, "cancelled", None)
        }
        Ok(()) => reporter.terminal(completed, total, &current_path, "done", None),
        Err(AppError::Cancelled) => {
            reporter.terminal(completed, total, &current_path, "cancelled", None)
        }
        Err(error) => reporter.terminal(completed, total, &current_path, "error", Some(&error)),
    }
}

struct DeleteOutcome {
    completed: u64,
    total: u64,
    current_path: String,
    result: AppResult<()>,
}

async fn delete_remote(
    manager: &SftpManager,
    connection_id: &str,
    paths: &[String],
    cancel: &Arc<TransferCancel>,
    reporter: &mut ProgressReporter,
) -> DeleteOutcome {
    let conn = match manager.get(connection_id) {
        Ok(conn) => conn,
        Err(error) => {
            return DeleteOutcome {
                completed: 0,
                total: 0,
                current_path: paths.first().cloned().unwrap_or_default(),
                result: Err(error),
            };
        }
    };
    let mut plan = DeletePlan::default();
    let mut discovered = 0;
    for path in paths {
        if let Err(error) = scan_remote_node(
            &conn,
            path.clone(),
            None,
            0,
            &mut plan,
            &mut discovered,
            reporter,
            cancel,
        )
        .await
        {
            return DeleteOutcome {
                completed: 0,
                total: plan.total(),
                current_path: path.clone(),
                result: Err(error),
            };
        }
    }

    let total = plan.total();
    let current_path = paths.first().cloned().unwrap_or_default();
    reporter.active(0, total, &current_path, PHASE_DELETING, true);
    let mut completed = 0;
    let mut failures = DeleteFailures::default();
    if let Err(error) = delete_remote_paths(
        conn.clone(),
        plan.files,
        false,
        total,
        &mut completed,
        &mut failures,
        reporter,
        cancel,
    )
    .await
    {
        return DeleteOutcome {
            completed,
            total,
            current_path,
            result: Err(error),
        };
    }

    plan.directories
        .sort_by_key(|(depth, _)| std::cmp::Reverse(*depth));
    let mut start = 0;
    while start < plan.directories.len() {
        let depth = plan.directories[start].0;
        let mut end = start + 1;
        while end < plan.directories.len() && plan.directories[end].0 == depth {
            end += 1;
        }
        let directories = plan.directories[start..end]
            .iter()
            .map(|(_, path)| path.clone())
            .collect();
        if let Err(error) = delete_remote_paths(
            conn.clone(),
            directories,
            true,
            total,
            &mut completed,
            &mut failures,
            reporter,
            cancel,
        )
        .await
        {
            return DeleteOutcome {
                completed,
                total,
                current_path,
                result: Err(error),
            };
        }
        start = end;
    }

    DeleteOutcome {
        completed,
        total,
        current_path,
        result: failures.result(),
    }
}

#[allow(clippy::too_many_arguments)]
fn scan_remote_node<'a>(
    conn: &'a Arc<Conn>,
    path: String,
    known_metadata: Option<Metadata>,
    depth: usize,
    plan: &'a mut DeletePlan,
    discovered: &'a mut u64,
    reporter: &'a mut ProgressReporter,
    cancel: &'a Arc<TransferCancel>,
) -> Pin<Box<dyn Future<Output = AppResult<()>> + Send + 'a>> {
    Box::pin(async move {
        let metadata = match known_metadata {
            Some(metadata)
                if metadata.file_type().is_file() || metadata.file_type().is_symlink() =>
            {
                metadata
            }
            _ => {
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return Err(AppError::Cancelled),
                    result = conn.session().symlink_metadata(&path) => result?,
                }
            }
        };
        record_discovery(discovered)?;
        reporter.active(*discovered, 0, &path, PHASE_SCANNING, false);
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            plan.files.push(path);
            return Ok(());
        }

        let entries = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(AppError::Cancelled),
            result = conn.session().read_dir(&path) => result?,
        };
        for entry in entries {
            let name = entry.file_name();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }
            scan_remote_node(
                conn,
                entry.path(),
                Some(entry.metadata()),
                depth + 1,
                plan,
                discovered,
                reporter,
                cancel,
            )
            .await?;
        }
        plan.directories.push((depth, path));
        Ok(())
    })
}

#[allow(clippy::too_many_arguments)]
async fn delete_remote_paths(
    conn: Arc<Conn>,
    paths: Vec<String>,
    directories: bool,
    total: u64,
    completed: &mut u64,
    failures: &mut DeleteFailures,
    reporter: &mut ProgressReporter,
    cancel: &Arc<TransferCancel>,
) -> AppResult<()> {
    let mut paths = paths.into_iter();
    let mut tasks = JoinSet::new();
    loop {
        while tasks.len() < super::MAX_CONCURRENT_DELETE_REQUESTS {
            let Some(path) = paths.next() else {
                break;
            };
            let task_conn = conn.clone();
            let task_cancel = cancel.clone();
            tasks.spawn(async move {
                let display_path = path.clone();
                let permit = tokio::select! {
                    biased;
                    _ = task_cancel.cancelled() => {
                        return (display_path, Err(AppError::Cancelled));
                    }
                    permit = task_conn.delete_slots.clone().acquire_owned() => {
                        permit.expect("delete semaphore must stay open")
                    }
                };
                let result = tokio::select! {
                    biased;
                    _ = task_cancel.cancelled() => Err(AppError::Cancelled),
                    result = async {
                        if directories {
                            task_conn.session().remove_dir(path).await?;
                        } else {
                            task_conn.session().remove_file(path).await?;
                        }
                        Ok(())
                    } => result,
                };
                drop(permit);
                (display_path, result)
            });
        }
        let Some(joined) = tasks.join_next().await else {
            break;
        };
        let (path, result) =
            joined.map_err(|error| AppError::Other(format!("task join error: {error}")))?;
        match result {
            Ok(()) => {}
            Err(error) if error.code() == "not_found" => {}
            Err(AppError::Cancelled) => {
                tasks.abort_all();
                return Err(AppError::Cancelled);
            }
            Err(error) if error.code() == "network" => {
                tasks.abort_all();
                return Err(error);
            }
            Err(error) => failures.push(&path, error),
        }
        *completed += 1;
        reporter.active(*completed, total, &path, PHASE_DELETING, false);
    }
    Ok(())
}

fn delete_local(
    paths: &[String],
    cancel: &Arc<TransferCancel>,
    reporter: &mut ProgressReporter,
) -> DeleteOutcome {
    let total = paths.len() as u64;
    let current_path = paths.first().cloned().unwrap_or_default();
    reporter.active(0, total, &current_path, PHASE_DELETING, true);
    let mut completed = 0;
    let mut failures = DeleteFailures::default();
    for path in paths {
        if cancel.is_cancelled() {
            return DeleteOutcome {
                completed,
                total,
                current_path: path.clone(),
                result: Err(AppError::Cancelled),
            };
        }
        match ops::local_remove(path) {
            Ok(()) => {}
            Err(error) if error.code() == "not_found" => {}
            Err(error) => failures.push(path, error),
        }
        completed += 1;
        reporter.active(completed, total, path, PHASE_DELETING, false);
    }
    DeleteOutcome {
        completed,
        total,
        current_path,
        result: failures.result(),
    }
}

fn record_discovery(discovered: &mut u64) -> AppResult<()> {
    if *discovered >= MAX_REMOTE_DELETE_ENTRIES {
        return Err(AppError::Invalid(format!(
            "directory contains more than {MAX_REMOTE_DELETE_ENTRIES} items. Delete smaller sections"
        )));
    }
    *discovered += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{record_discovery, MAX_REMOTE_DELETE_ENTRIES};

    #[test]
    fn bounds_remote_delete_plans() {
        let mut discovered = MAX_REMOTE_DELETE_ENTRIES - 1;

        assert!(record_discovery(&mut discovered).is_ok());
        assert!(record_discovery(&mut discovered).is_err());
        assert_eq!(discovered, MAX_REMOTE_DELETE_ENTRIES);
    }
}
