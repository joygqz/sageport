use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::io::AsyncReadExt;
use tokio::task::JoinSet;

use crate::domain::{Task, TaskInput, TaskStep};
use crate::error::{AppError, AppResult};
use crate::repository::task_repo;
use crate::sftp::path::{parent_remote, sh_quote};
use crate::sftp::{self, base_name, Endpoint, SftpConnectParams, TransferCancel, TransferRequest};
use crate::state::AppState;

const MAX_ID_BYTES: usize = 128;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const KILL_DRAIN_GRACE: Duration = Duration::from_secs(3);
const CONNECT_ATTEMPTS: usize = 2;
const CONNECT_RETRY_BACKOFF: Duration = Duration::from_millis(500);
const STEP_RETRY_BACKOFF: Duration = Duration::from_secs(2);
const STEP_OUTPUT_CAP: usize = 512 * 1024;

#[tauri::command]
pub async fn tasks_list(state: State<'_, AppState>) -> AppResult<Vec<Task>> {
    task_repo::list(&state.db).await
}

#[tauri::command]
pub async fn tasks_create(state: State<'_, AppState>, input: TaskInput) -> AppResult<Task> {
    task_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn tasks_update(
    state: State<'_, AppState>,
    id: String,
    input: TaskInput,
) -> AppResult<Task> {
    task_repo::update(&state.db, &id, input).await
}

#[tauri::command]
pub async fn tasks_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    task_repo::delete(&state.db, &id).await
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunEvent {
    step_index: usize,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

impl TaskRunEvent {
    fn simple(step_index: usize, status: &str) -> Self {
        Self {
            step_index,
            status: status.into(),
            chunk: None,
            exit_code: None,
            message: None,
        }
    }

    fn log(step_index: usize, chunk: String) -> Self {
        Self {
            step_index,
            status: "log".into(),
            chunk: Some(chunk),
            exit_code: None,
            message: None,
        }
    }
}

enum StepResult {
    Success(Option<i32>),
    Failed { exit: Option<i32>, message: String },
    Cancelled,
}

fn validate_id(id: &str, label: &str) -> AppResult<()> {
    if id.trim().is_empty() || id.len() > MAX_ID_BYTES || id.contains('\0') {
        return Err(AppError::Invalid(format!("invalid {label} id")));
    }
    Ok(())
}

#[tauri::command]
pub async fn tasks_run(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    host_id: String,
    variables: HashMap<String, String>,
    request_id: String,
    on_event: Channel<TaskRunEvent>,
) -> AppResult<()> {
    validate_id(&id, "task")?;
    validate_id(&request_id, "task request")?;

    let task = task_repo::get(&state.db, &id).await?;
    let steps: Vec<TaskStep> = task
        .parse_steps()
        .map_err(|e| AppError::Invalid(format!("stored task steps are invalid: {e}")))?
        .iter()
        .map(|step| step.substitute(&variables))
        .collect();

    let cancel = Arc::new(TransferCancel::new());
    {
        let mut cancels = state.task_cancels.lock();
        if cancels.contains_key(&request_id) {
            return Err(AppError::Invalid("this task run is already active".into()));
        }
        cancels.insert(request_id.clone(), cancel.clone());
    }

    let outcome = run_all(
        &app,
        &state,
        &host_id,
        &steps,
        &request_id,
        &cancel,
        &on_event,
    )
    .await;

    state.task_cancels.lock().remove(&request_id);
    outcome
}

#[tauri::command]
pub async fn tasks_cancel(state: State<'_, AppState>, request_id: String) -> AppResult<()> {
    validate_id(&request_id, "task request")?;
    if let Some(cancel) = state.task_cancels.lock().get(&request_id) {
        cancel.cancel();
    }
    Ok(())
}

async fn run_all(
    app: &AppHandle,
    state: &AppState,
    host_id: &str,
    steps: &[TaskStep],
    request_id: &str,
    cancel: &Arc<TransferCancel>,
    on_event: &Channel<TaskRunEvent>,
) -> AppResult<()> {
    let needs_remote = steps.iter().any(TaskStep::needs_remote);
    let conn_id = format!("task-run-{request_id}");

    if needs_remote {
        validate_id(host_id, "host")?;
        let host = crate::repository::host_repo::get(&state.db, host_id).await?;
        let hops = super::ssh::build_hops(state, &host).await?;
        connect_task_session(app, state, &conn_id, host.label, hops, cancel).await?;
    }

    let result = execute_steps(app, state, &conn_id, steps, request_id, cancel, on_event).await;

    if needs_remote {
        state.sftp.disconnect(app, &conn_id);
    }
    result
}

/// Establish the task's SFTP session, retrying a transient connection failure once.
/// SSH handshakes occasionally fail spuriously — a raced key-exchange extension, a
/// dropped packet, a momentary auth rejection — and succeed right away on a retry.
/// A small bounded retry absorbs that without masking a genuinely wrong credential
/// or risking a lockout. Only automated task runs retry; interactive sessions still
/// fail fast so the user is prompted immediately.
async fn connect_task_session(
    app: &AppHandle,
    state: &AppState,
    conn_id: &str,
    host_label: String,
    hops: Vec<crate::ssh::Hop>,
    cancel: &Arc<TransferCancel>,
) -> AppResult<()> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let params = SftpConnectParams {
            connection_id: conn_id.to_string(),
            host_label: host_label.clone(),
            hops: hops.clone(),
        };
        match state
            .sftp
            .connect_now(app, &state.connection_prompts, params, cancel)
            .await
        {
            Ok(()) => return Ok(()),
            Err(err) => {
                if attempt >= CONNECT_ATTEMPTS
                    || cancel.is_cancelled()
                    || !is_retryable_connect(&err)
                {
                    return Err(err);
                }
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return Err(AppError::Cancelled),
                    _ = tokio::time::sleep(CONNECT_RETRY_BACKOFF) => {}
                }
            }
        }
    }
}

fn is_retryable_connect(err: &AppError) -> bool {
    matches!(err.code(), "network" | "timeout" | "ssh" | "dns" | "auth")
}

async fn execute_steps(
    app: &AppHandle,
    state: &AppState,
    conn_id: &str,
    steps: &[TaskStep],
    request_id: &str,
    cancel: &Arc<TransferCancel>,
    on_event: &Channel<TaskRunEvent>,
) -> AppResult<()> {
    let mut cancelled = false;
    let mut skip_from: Option<usize> = None;

    for (index, step) in steps.iter().enumerate() {
        if cancel.is_cancelled() {
            cancelled = true;
            skip_from = Some(index);
            break;
        }
        let _ = on_event.send(TaskRunEvent::simple(index, "start"));

        let result = run_step_with_retries(
            app, state, conn_id, request_id, index, step, cancel, on_event,
        )
        .await;
        match result {
            StepResult::Success(exit) => {
                let _ = on_event.send(TaskRunEvent {
                    step_index: index,
                    status: "done".into(),
                    chunk: None,
                    exit_code: exit,
                    message: None,
                });
            }
            StepResult::Failed { exit, message } => {
                let _ = on_event.send(TaskRunEvent {
                    step_index: index,
                    status: "error".into(),
                    chunk: None,
                    exit_code: exit,
                    message: Some(message),
                });
                // A step that still fails after exhausting its retries stops the
                // run; every later step is reported as skipped.
                skip_from = Some(index + 1);
                break;
            }
            StepResult::Cancelled => {
                cancelled = true;
                skip_from = Some(index);
                break;
            }
        }
    }

    if let Some(start) = skip_from {
        for index in start..steps.len() {
            let _ = on_event.send(TaskRunEvent::simple(index, "skipped"));
        }
    }

    if cancelled {
        Err(AppError::Cancelled)
    } else {
        Ok(())
    }
}

/// Run a step, retrying it up to `step.retries()` extra times when it fails.
/// A transient failure — a dropped transfer, a flaky remote command — often
/// succeeds on a second attempt, so a bounded retry avoids aborting the whole
/// run over a momentary hiccup. Cancellation and success short-circuit the loop.
#[allow(clippy::too_many_arguments)]
async fn run_step_with_retries(
    app: &AppHandle,
    state: &AppState,
    conn_id: &str,
    request_id: &str,
    index: usize,
    step: &TaskStep,
    cancel: &Arc<TransferCancel>,
    on_event: &Channel<TaskRunEvent>,
) -> StepResult {
    let max_retries = step.retries();
    let mut attempt: u32 = 0;
    loop {
        match run_step(
            app, state, conn_id, request_id, index, step, cancel, on_event,
        )
        .await
        {
            StepResult::Failed { exit, message } => {
                if attempt >= max_retries || cancel.is_cancelled() {
                    return StepResult::Failed { exit, message };
                }
                attempt += 1;
                let _ = on_event.send(TaskRunEvent::log(
                    index,
                    format!(
                        "\n[retry {attempt}/{max_retries}] {message}; retrying in {}s\n",
                        STEP_RETRY_BACKOFF.as_secs()
                    ),
                ));
                tokio::select! {
                    biased;
                    _ = cancel.cancelled() => return StepResult::Cancelled,
                    _ = tokio::time::sleep(STEP_RETRY_BACKOFF) => {}
                }
            }
            other => return other,
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_step(
    app: &AppHandle,
    state: &AppState,
    conn_id: &str,
    request_id: &str,
    index: usize,
    step: &TaskStep,
    cancel: &Arc<TransferCancel>,
    on_event: &Channel<TaskRunEvent>,
) -> StepResult {
    match step {
        TaskStep::LocalCommand { cwd, command, .. } => command_result(
            run_local_command(index, cwd.as_deref(), command, cancel, on_event).await,
        ),
        TaskStep::RemoteCommand { cwd, command, .. } => command_result(
            run_remote_command(
                state,
                conn_id,
                index,
                cwd.as_deref(),
                command,
                cancel,
                on_event,
            )
            .await,
        ),
        TaskStep::Upload { .. } | TaskStep::Download { .. } => {
            match run_transfer(app, state, conn_id, request_id, index, step, cancel).await {
                Ok(()) => StepResult::Success(None),
                Err(AppError::Cancelled) => StepResult::Cancelled,
                Err(error) => StepResult::Failed {
                    exit: None,
                    message: error.to_string(),
                },
            }
        }
    }
}

fn command_result(result: AppResult<i32>) -> StepResult {
    match result {
        Ok(0) => StepResult::Success(Some(0)),
        Ok(code) => StepResult::Failed {
            exit: Some(code),
            message: format!("exited with code {code}"),
        },
        Err(AppError::Cancelled) => StepResult::Cancelled,
        Err(error) => StepResult::Failed {
            exit: None,
            message: error.to_string(),
        },
    }
}

fn shell_command(command: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let mut cmd = tokio::process::Command::new("cmd");
        cmd.arg("/C").arg(command);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd
    }
}

async fn run_local_command(
    index: usize,
    cwd: Option<&str>,
    command: &str,
    cancel: &Arc<TransferCancel>,
    on_event: &Channel<TaskRunEvent>,
) -> AppResult<i32> {
    let mut builder = shell_command(command);
    if let Some(dir) = cwd {
        builder.current_dir(expand_local_tilde(dir));
    }
    builder
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    set_process_group(&mut builder);
    let mut child = builder
        .spawn()
        .map_err(|e| AppError::Other(format!("could not start local command: {e}")))?;

    let mut readers = JoinSet::new();
    if let Some(stdout) = child.stdout.take() {
        readers.spawn(forward_reader(stdout, index, on_event.clone()));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.spawn(forward_reader(stderr, index, on_event.clone()));
    }

    enum Stop {
        Cancelled,
        TimedOut,
        Done(std::io::Result<std::process::ExitStatus>),
    }
    let outcome = tokio::select! {
        biased;
        _ = cancel.cancelled() => Stop::Cancelled,
        _ = tokio::time::sleep(COMMAND_TIMEOUT) => Stop::TimedOut,
        status = child.wait() => Stop::Done(status),
    };
    match outcome {
        Stop::Cancelled => {
            kill_process_tree(&mut child).await;
            let _ = child.wait().await;
            drain_bounded(&mut readers).await;
            Err(AppError::Cancelled)
        }
        Stop::TimedOut => {
            kill_process_tree(&mut child).await;
            let _ = child.wait().await;
            drain_bounded(&mut readers).await;
            Err(AppError::Timeout("local command timed out".into()))
        }
        Stop::Done(status) => {
            let status = status?;
            drain(&mut readers).await;
            Ok(exit_code(status))
        }
    }
}

fn set_process_group(builder: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Group id 0 makes the child the leader of a fresh group whose id equals
        // its pid, so `kill(-pid, …)` later reaches every descendant.
        builder.as_std_mut().process_group(0);
    }
    #[cfg(not(unix))]
    {
        let _ = builder;
    }
}

/// Kill the local command and every process it spawned. Killing only the direct
/// child leaves build-tool grandchildren holding the stdout/stderr pipes open,
/// which would wedge the reader tasks — and the whole run — indefinitely.
async fn kill_process_tree(child: &mut tokio::process::Child) {
    let pid = child.id();
    #[cfg(unix)]
    if let Some(pid) = pid {
        // Negative target = the process group created by `set_process_group`.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    if let Some(pid) = pid {
        let _ = tokio::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
    let _ = child.start_kill();
}

/// Drain reader tasks without ever blocking forever. After a kill the pipes close
/// promptly once descendants exit; the timeout is a safety net for a stray process
/// that escaped the group (the JoinSet aborts leftovers when dropped).
async fn drain_bounded(readers: &mut JoinSet<()>) {
    let _ = tokio::time::timeout(KILL_DRAIN_GRACE, drain(readers)).await;
}

fn exit_code(status: std::process::ExitStatus) -> i32 {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status
            .code()
            .or_else(|| status.signal().map(|s| 128 + s))
            .unwrap_or(-1)
    }
    #[cfg(not(unix))]
    {
        status.code().unwrap_or(-1)
    }
}

async fn drain(readers: &mut JoinSet<()>) {
    while readers.join_next().await.is_some() {}
}

async fn forward_reader<R>(mut reader: R, index: usize, on_event: Channel<TaskRunEvent>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = [0u8; 8 * 1024];
    let mut forwarded = 0usize;
    let mut truncated = false;
    loop {
        match reader.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if forwarded >= STEP_OUTPUT_CAP {
                    if !truncated {
                        truncated = true;
                        let _ = on_event
                            .send(TaskRunEvent::log(index, "\n…(output truncated)…\n".into()));
                    }
                    continue;
                }
                let take = (STEP_OUTPUT_CAP - forwarded).min(n);
                forwarded += take;
                let chunk = String::from_utf8_lossy(&buf[..take]).into_owned();
                let _ = on_event.send(TaskRunEvent::log(index, chunk));
            }
        }
    }
}

async fn run_remote_command(
    state: &AppState,
    conn_id: &str,
    index: usize,
    cwd: Option<&str>,
    command: &str,
    cancel: &Arc<TransferCancel>,
    on_event: &Channel<TaskRunEvent>,
) -> AppResult<i32> {
    let wrapped = match cwd {
        Some(dir) => format!("cd -- {} && {}", sh_quote(dir), command),
        None => command.to_string(),
    };
    let channel = on_event.clone();
    let stream = state
        .sftp
        .exec_stream(conn_id, &wrapped, STEP_OUTPUT_CAP, move |chunk| {
            let _ = channel.send(TaskRunEvent::log(index, chunk));
        });
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(AppError::Cancelled),
        result = tokio::time::timeout(COMMAND_TIMEOUT, stream) => {
            result.map_err(|_| AppError::Timeout("remote command timed out".into()))?
        }
    }
}

async fn run_transfer(
    app: &AppHandle,
    state: &AppState,
    conn_id: &str,
    request_id: &str,
    index: usize,
    step: &TaskStep,
    cancel: &Arc<TransferCancel>,
) -> AppResult<()> {
    let (source, dest_dir, target_name) = match step {
        TaskStep::Upload {
            local_path,
            remote_path,
            ..
        } => {
            let name = base_name(remote_path);
            let source = Endpoint {
                connection_id: None,
                path: expand_local_tilde(local_path),
            };
            let dest_dir = Endpoint {
                connection_id: Some(conn_id.to_string()),
                path: parent_remote(remote_path),
            };
            (source, dest_dir, name)
        }
        TaskStep::Download {
            remote_path,
            local_path,
            ..
        } => {
            let (dir, name) = split_local_path(&expand_local_tilde(local_path))?;
            let source = Endpoint {
                connection_id: Some(conn_id.to_string()),
                path: remote_path.clone(),
            };
            let dest_dir = Endpoint {
                connection_id: None,
                path: dir,
            };
            (source, dest_dir, name)
        }
        _ => return Err(AppError::Invalid("not a transfer step".into())),
    };

    if target_name.is_empty() || matches!(target_name.as_str(), "." | "..") {
        return Err(AppError::Invalid("transfer path has no file name".into()));
    }

    // The `task:` prefix marks this as an orchestrated transfer so the SFTP panel
    // can ignore it — task runs show their own progress and are not file-manager
    // transfers, so they stay out of that panel's status bar and history.
    let transfer_id = format!("task:{request_id}-s{index}");
    let outcome = sftp::transfer(
        app,
        &state.sftp,
        TransferRequest {
            transfer_id: &transfer_id,
            source: &source,
            dest_dir: &dest_dir,
            target_name: &target_name,
            overwrite: true,
        },
        cancel.clone(),
    )
    .await;

    match outcome.status {
        "done" => Ok(()),
        "cancelled" => Err(AppError::Cancelled),
        _ => Err(AppError::Other(
            outcome.message.unwrap_or_else(|| "transfer failed".into()),
        )),
    }
}

fn home_dir() -> Option<std::ffi::OsString> {
    #[cfg(windows)]
    let key = "USERPROFILE";
    #[cfg(not(windows))]
    let key = "HOME";
    std::env::var_os(key).filter(|value| !value.is_empty())
}

/// Expand a leading `~` / `~/` in a *local* path to the user's home directory.
///
/// Local command working directories and upload/download local paths are typed
/// by hand — and shipped in templates — as `~/…`. Unlike a remote command, which
/// runs through a shell that expands the tilde, these paths are handed straight
/// to the OS (`chdir`, file open), which treats `~` as a literal directory name.
/// Only a leading tilde is touched; `~user` and every other path pass through.
fn expand_local_tilde(path: &str) -> String {
    if path == "~" || path.starts_with("~/") {
        if let Some(home) = home_dir() {
            return crate::ssh::config_file::expand_tilde(path, std::path::Path::new(&home))
                .to_string_lossy()
                .into_owned();
        }
    }
    path.to_string()
}

fn split_local_path(path: &str) -> AppResult<(String, String)> {
    let p = std::path::Path::new(path);
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Invalid("download destination has no file name".into()))?;
    let parent = p
        .parent()
        .filter(|value| !value.as_os_str().is_empty())
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| ".".to_string());
    Ok((parent, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_run_ids() {
        assert!(validate_id("", "task").is_err());
        assert!(validate_id("bad\0id", "task").is_err());
        assert!(validate_id(&"x".repeat(MAX_ID_BYTES + 1), "task").is_err());
        assert!(validate_id("task-1", "task").is_ok());
    }

    #[test]
    fn splits_local_destination_paths() {
        assert_eq!(
            split_local_path("/var/backups/db.sql").unwrap(),
            ("/var/backups".into(), "db.sql".into())
        );
        assert_eq!(
            split_local_path("db.sql").unwrap(),
            (".".into(), "db.sql".into())
        );
    }

    #[test]
    fn expands_only_leading_local_tilde() {
        let home = home_dir().map(|h| h.to_string_lossy().into_owned());
        if let Some(home) = home {
            assert_eq!(expand_local_tilde("~"), home);
            assert_eq!(
                expand_local_tilde("~/project/dist"),
                format!("{home}/project/dist")
            );
        }
        // Absolute, relative, and `~user` paths must pass through untouched.
        assert_eq!(expand_local_tilde("/var/www/app"), "/var/www/app");
        assert_eq!(expand_local_tilde("./dist"), "./dist");
        assert_eq!(expand_local_tilde("~backup/x"), "~backup/x");
    }

    #[test]
    fn command_result_maps_exit_codes() {
        assert!(matches!(
            command_result(Ok(0)),
            StepResult::Success(Some(0))
        ));
        assert!(matches!(
            command_result(Ok(2)),
            StepResult::Failed { exit: Some(2), .. }
        ));
        assert!(matches!(
            command_result(Err(AppError::Cancelled)),
            StepResult::Cancelled
        ));
    }
}
