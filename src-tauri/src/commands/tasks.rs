use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::io::AsyncReadExt;
use tokio::task::JoinSet;

use crate::domain::{Task, TaskInput, TaskShell, TaskStep};
use crate::error::{AppError, AppResult};
use crate::repository::task_repo;
use crate::repository::task_run_repo::{self, TaskRunRow};
use crate::sftp::path::{parent_remote, sh_quote};
use crate::sftp::{self, base_name, Endpoint, TransferCancel, TransferRequest};
use crate::state::AppState;

const MAX_ID_BYTES: usize = 128;

const KILL_DRAIN_GRACE: Duration = Duration::from_secs(3);
const CONNECT_ATTEMPTS: usize = 2;
const CONNECT_RETRY_BACKOFF: Duration = Duration::from_millis(500);
const STEP_RETRY_BACKOFF: Duration = Duration::from_secs(2);
const STEP_OUTPUT_CAP: usize = 200 * 1024;
const OUTPUT_INTERVAL: Duration = Duration::from_millis(100);
const MAX_MESSAGE_CHARS: usize = 2000;

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunHistoryEntry {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    pub host_id: Option<String>,
    pub host_label: Option<String>,
    pub steps: String,
    pub total_steps: i64,
    pub status: String,
    pub message: Option<String>,
    pub started_at: String,
    pub finished_at: Option<String>,
}

impl From<TaskRunRow> for TaskRunHistoryEntry {
    fn from(row: TaskRunRow) -> Self {
        Self {
            id: row.id,
            task_id: row.task_id,
            task_name: row.task_name,
            host_id: row.host_id,
            host_label: row.host_label,
            steps: row.steps,
            total_steps: row.total_steps,
            status: row.status,
            message: row.message,
            started_at: row.started_at,
            finished_at: row.finished_at,
        }
    }
}

#[tauri::command]
pub async fn tasks_runs_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> AppResult<Vec<TaskRunHistoryEntry>> {
    let rows = task_run_repo::list(&state.db, limit.unwrap_or(200).clamp(1, 1000)).await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

#[tauri::command]
pub async fn tasks_runs_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    validate_id(&id, "task run")?;
    task_run_repo::delete(&state.db, &id).await
}

#[tauri::command]
pub async fn tasks_runs_clear(state: State<'_, AppState>) -> AppResult<()> {
    task_run_repo::clear(&state.db).await
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

#[derive(Default)]
struct StepOutput {
    tail: String,
    dirty: bool,
    last_emit: Option<Instant>,
}

#[derive(Clone)]
struct TaskEvents {
    channel: Channel<TaskRunEvent>,
    logs: Arc<parking_lot::Mutex<Vec<String>>>,
    outputs: Arc<parking_lot::Mutex<Vec<StepOutput>>>,
}

struct OutputPump(tokio::task::JoinHandle<()>);

impl Drop for OutputPump {
    fn drop(&mut self) {
        self.0.abort();
    }
}

impl TaskEvents {
    fn new(channel: Channel<TaskRunEvent>, count: usize) -> Self {
        Self {
            channel,
            logs: Arc::new(parking_lot::Mutex::new(vec![String::new(); count])),
            outputs: Arc::new(parking_lot::Mutex::new(
                (0..count).map(|_| StepOutput::default()).collect(),
            )),
        }
    }

    fn pump(&self) -> OutputPump {
        let events = self.clone();
        OutputPump(tokio::spawn(async move {
            let mut timer = tokio::time::interval(OUTPUT_INTERVAL);
            loop {
                timer.tick().await;
                let count = events.outputs.lock().len();
                for index in 0..count {
                    let _ = events.flush(index);
                }
            }
        }))
    }

    fn flush(&self, index: usize) -> tauri::Result<()> {
        let event = {
            let mut outputs = self.outputs.lock();
            let Some(output) = outputs.get_mut(index) else {
                return Ok(());
            };
            if !output.dirty {
                return Ok(());
            }
            output.dirty = false;
            output.last_emit = Some(Instant::now());
            TaskRunEvent {
                step_index: index,
                status: "output".into(),
                chunk: Some(output.tail.clone()),
                exit_code: None,
                message: None,
            }
        };
        self.channel.send(event)
    }

    fn send(&self, event: TaskRunEvent) -> tauri::Result<()> {
        if let Some(chunk) = &event.chunk {
            if let Some(log) = self.logs.lock().get_mut(event.step_index) {
                crate::command_output::append_tail(log, chunk, 8192);
            }
            let due = {
                let mut outputs = self.outputs.lock();
                let Some(output) = outputs.get_mut(event.step_index) else {
                    return Ok(());
                };
                crate::command_output::append_tail(&mut output.tail, chunk, STEP_OUTPUT_CAP);
                output.dirty = true;
                output
                    .last_emit
                    .is_none_or(|last| last.elapsed() >= OUTPUT_INTERVAL)
            };
            return if due {
                self.flush(event.step_index)
            } else {
                Ok(())
            };
        }
        self.flush(event.step_index)?;
        self.channel.send(event)
    }
}

enum StepResult {
    Success(Option<i32>),
    Failed { exit: Option<i32>, message: String },
    Cancelled,
}

#[derive(Clone)]
struct StepOutcome {
    status: &'static str,
    exit_code: Option<i32>,
    message: Option<String>,
}

impl StepOutcome {
    fn skipped() -> Self {
        Self {
            status: "skipped",
            exit_code: None,
            message: None,
        }
    }

    fn done(exit_code: Option<i32>) -> Self {
        Self {
            status: "done",
            exit_code,
            message: None,
        }
    }

    fn error(exit_code: Option<i32>, message: String) -> Self {
        Self {
            status: "error",
            exit_code,
            message: Some(truncate_message(message)),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskRunStepRecord<'a> {
    step: &'a TaskStep,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    log: String,
}

fn all_skipped(len: usize) -> Vec<StepOutcome> {
    vec![StepOutcome::skipped(); len]
}

fn steps_json(steps: &[TaskStep], outcomes: &[StepOutcome], logs: &[String]) -> String {
    let records: Vec<TaskRunStepRecord> = steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let outcome = outcomes.get(index);
            TaskRunStepRecord {
                step,
                status: outcome.map_or("pending", |o| o.status),
                exit_code: outcome.and_then(|o| o.exit_code),
                message: outcome.and_then(|o| o.message.clone()),
                log: logs.get(index).cloned().unwrap_or_default(),
            }
        })
        .collect();
    serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
}

fn truncate_message(message: String) -> String {
    if message.chars().count() <= MAX_MESSAGE_CHARS {
        return message;
    }
    message.chars().take(MAX_MESSAGE_CHARS).collect()
}

async fn resolve_host_label(state: &AppState, host_id: &str) -> Option<String> {
    let host_id = host_id.trim();
    if host_id.is_empty() {
        return None;
    }
    crate::repository::host_repo::get(&state.db, host_id)
        .await
        .ok()
        .map(|host| host.label)
}

fn validate_id(id: &str, label: &str) -> AppResult<()> {
    if id.trim().is_empty() || id.len() > MAX_ID_BYTES || id.contains('\0') {
        return Err(AppError::Invalid(format!("invalid {label} id")));
    }
    Ok(())
}

struct ActiveTaskRun<'a> {
    state: &'a AppState,
    task_id: String,
    request_id: String,
}

impl Drop for ActiveTaskRun<'_> {
    fn drop(&mut self) {
        self.state.task_cancels.lock().remove(&self.request_id);
        self.state.active_tasks.lock().remove(&self.task_id);
    }
}

fn register_run<'a>(
    state: &'a AppState,
    id: &str,
    request_id: &str,
    cancel: Arc<TransferCancel>,
) -> AppResult<ActiveTaskRun<'a>> {
    let mut active = state.active_tasks.lock();
    let mut cancels = state.task_cancels.lock();
    if active.contains_key(id) || cancels.contains_key(request_id) {
        return Err(AppError::Conflict("this task is already running".into()));
    }
    active.insert(id.to_string(), request_id.to_string());
    cancels.insert(request_id.to_string(), cancel);
    Ok(ActiveTaskRun {
        state,
        task_id: id.to_string(),
        request_id: request_id.to_string(),
    })
}

fn validate_run_snapshot(
    task: &Task,
    host_id: &str,
    expected_revision: i64,
    expected_steps: &str,
) -> AppResult<()> {
    if task.revision != expected_revision
        || task.steps != expected_steps
        || task.host_id.as_deref().unwrap_or("") != host_id
    {
        return Err(AppError::Conflict(
            "task changed before execution; review the task and run it again".into(),
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunExpectation {
    revision: i64,
    steps: String,
    host_updated_at: Option<String>,
}

#[tauri::command]
pub async fn tasks_run(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    host_id: String,
    request_id: String,
    on_event: Channel<TaskRunEvent>,
    expected: TaskRunExpectation,
) -> AppResult<()> {
    validate_id(&id, "task")?;
    validate_id(&request_id, "task request")?;

    let cancel = Arc::new(TransferCancel::new());
    let _active_run = register_run(&state, &id, &request_id, cancel.clone())?;
    let task = task_repo::get(&state.db, &id).await?;
    validate_run_snapshot(&task, &host_id, expected.revision, &expected.steps)?;
    let steps: Vec<TaskStep> = task
        .parse_steps()
        .map_err(|e| AppError::Invalid(format!("stored task steps are invalid: {e}")))?;
    task_repo::normalize(TaskInput {
        name: task.name.clone(),
        description: task.description.clone(),
        host_id: task.host_id.clone(),
        steps: steps.clone(),
        schedule: task.schedule.clone(),
        schedule_enabled: task.schedule_enabled,
    })?;
    if cancel.is_cancelled() {
        return Err(AppError::Cancelled);
    }

    let host_label = resolve_host_label(&state, &host_id).await;
    let host_ref = Some(host_id.trim()).filter(|value| !value.is_empty());
    task_run_repo::create(
        &state.db,
        &request_id,
        &id,
        &task.name,
        host_ref,
        host_label.as_deref(),
        &steps_json(&steps, &[], &[]),
        steps.len() as i64,
    )
    .await?;

    let on_event = TaskEvents::new(on_event, steps.len());
    let _output_pump = on_event.pump();
    let mut outcomes = all_skipped(steps.len());
    let outcome = run_all(
        &app,
        &state,
        &host_id,
        &steps,
        &request_id,
        &cancel,
        &on_event,
        &mut outcomes,
        expected.host_updated_at.as_deref(),
    )
    .await;

    let (status, message) = match &outcome {
        Err(AppError::Cancelled) => ("cancelled", None),
        Err(err) => ("error", Some(truncate_message(err.to_string()))),
        Ok(()) if outcomes.iter().any(|o| o.status == "error") => ("error", None),
        Ok(()) => ("done", None),
    };
    let history_steps = steps_json(&steps, &outcomes, &on_event.logs.lock());
    let history_result = task_run_repo::finish(
        &state.db,
        &request_id,
        status,
        message.as_deref(),
        &history_steps,
    )
    .await;

    outcome.and(history_result)
}

#[tauri::command]
pub async fn tasks_cancel(state: State<'_, AppState>, request_id: String) -> AppResult<()> {
    validate_id(&request_id, "task request")?;
    if let Some(cancel) = state.task_cancels.lock().get(&request_id) {
        cancel.cancel();
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn run_all(
    app: &AppHandle,
    state: &AppState,
    host_id: &str,
    steps: &[TaskStep],
    request_id: &str,
    cancel: &Arc<TransferCancel>,
    on_event: &TaskEvents,
    outcomes: &mut [StepOutcome],
    expected_host_updated_at: Option<&str>,
) -> AppResult<()> {
    let conn_id = format!("task-run-{request_id}");
    let target = if steps.iter().any(TaskStep::needs_remote) {
        validate_id(host_id, "host")?;
        let host = crate::repository::host_repo::get(&state.db, host_id).await?;
        if expected_host_updated_at != Some(host.updated_at.as_str()) {
            return Err(AppError::Conflict(
                "target host changed before execution; review the task and run it again".into(),
            ));
        }
        Some(TaskTarget {
            label: host.label.clone(),
            hops: super::ssh::build_hops(state, &host).await?,
        })
    } else {
        None
    };
    let mut session = TaskSession {
        id: conn_id.clone(),
        target,
        ssh: None,
        sftp_ready: false,
    };
    let _cleanup = TaskSessionCleanup {
        app,
        state,
        id: conn_id,
    };
    execute_steps(
        app,
        state,
        &mut session,
        steps,
        request_id,
        cancel,
        on_event,
        outcomes,
    )
    .await
}

struct TaskTarget {
    label: String,
    hops: Vec<crate::ssh::Hop>,
}

struct TaskSession {
    id: String,
    target: Option<TaskTarget>,
    ssh: Option<Arc<crate::ssh::SshConnection>>,
    sftp_ready: bool,
}

struct TaskSessionCleanup<'a> {
    app: &'a AppHandle,
    state: &'a AppState,
    id: String,
}

impl Drop for TaskSessionCleanup<'_> {
    fn drop(&mut self) {
        self.state.sftp.disconnect(self.app, &self.id);
    }
}

impl TaskSession {
    async fn ensure_ssh(
        &mut self,
        app: &AppHandle,
        state: &AppState,
        cancel: &Arc<TransferCancel>,
    ) -> AppResult<Arc<crate::ssh::SshConnection>> {
        if self.ssh.as_ref().is_some_and(|ssh| ssh.handle.is_closed()) {
            state.sftp.disconnect(app, &self.id);
            self.ssh = None;
            self.sftp_ready = false;
        }
        if let Some(ssh) = &self.ssh {
            return Ok(ssh.clone());
        }
        let target = self
            .target
            .as_ref()
            .ok_or_else(|| AppError::Invalid("task has no remote target".into()))?;
        let ssh = connect_task_session(app, state, &self.id, &target.hops, cancel).await?;
        self.ssh = Some(ssh.clone());
        Ok(ssh)
    }

    async fn ensure_sftp(
        &mut self,
        app: &AppHandle,
        state: &AppState,
        cancel: &Arc<TransferCancel>,
    ) -> AppResult<()> {
        let ssh = self.ensure_ssh(app, state, cancel).await?;
        if !self.sftp_ready {
            let target = self
                .target
                .as_ref()
                .ok_or_else(|| AppError::Invalid("task has no remote target".into()))?;
            state
                .sftp
                .attach_ssh(app, &self.id, &target.label, ssh, cancel)
                .await?;
            self.sftp_ready = true;
        }
        Ok(())
    }
}

async fn connect_task_session(
    app: &AppHandle,
    state: &AppState,
    conn_id: &str,
    hops: &[crate::ssh::Hop],
    cancel: &Arc<TransferCancel>,
) -> AppResult<Arc<crate::ssh::SshConnection>> {
    let mut attempt = 0;
    loop {
        attempt += 1;
        let result = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(AppError::Cancelled),
            result = crate::ssh::establish(app, &state.connection_prompts, conn_id, hops) => result,
        };
        match result {
            Ok(ssh) => return Ok(Arc::new(ssh)),
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
    matches!(err.code(), "network" | "timeout" | "ssh" | "dns")
}

#[allow(clippy::too_many_arguments)]
async fn execute_steps(
    app: &AppHandle,
    state: &AppState,
    session: &mut TaskSession,
    steps: &[TaskStep],
    request_id: &str,
    cancel: &Arc<TransferCancel>,
    on_event: &TaskEvents,
    outcomes: &mut [StepOutcome],
) -> AppResult<()> {
    let mut cancelled = false;
    let mut failure = None;
    let mut skip_from: Option<usize> = None;

    for (index, step) in steps.iter().enumerate() {
        if cancel.is_cancelled() {
            cancelled = true;
            skip_from = Some(index);
            break;
        }
        let _ = on_event.send(TaskRunEvent::simple(index, "start"));

        let result = run_step_with_retries(
            app, state, session, request_id, index, step, cancel, on_event,
        )
        .await;
        match result {
            StepResult::Success(exit) => {
                if let Some(slot) = outcomes.get_mut(index) {
                    *slot = StepOutcome::done(exit);
                }
                let _ = on_event.send(TaskRunEvent {
                    step_index: index,
                    status: "done".into(),
                    chunk: None,
                    exit_code: exit,
                    message: None,
                });
            }
            StepResult::Failed { exit, message } => {
                if let Some(slot) = outcomes.get_mut(index) {
                    *slot = StepOutcome::error(exit, message.clone());
                }
                let _ = on_event.send(TaskRunEvent {
                    step_index: index,
                    status: "error".into(),
                    chunk: None,
                    exit_code: exit,
                    message: Some(message.clone()),
                });
                failure = Some(message);
                skip_from = Some(index + 1);
                break;
            }
            StepResult::Cancelled => {
                outcomes[index].status = "cancelled";
                let _ = on_event.send(TaskRunEvent::simple(index, "cancelled"));
                cancelled = true;
                skip_from = Some(index + 1);
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
    } else if let Some(message) = failure {
        Err(AppError::Other(message))
    } else {
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_step_with_retries(
    app: &AppHandle,
    state: &AppState,
    session: &mut TaskSession,
    request_id: &str,
    index: usize,
    step: &TaskStep,
    cancel: &Arc<TransferCancel>,
    on_event: &TaskEvents,
) -> StepResult {
    let max_retries = step.retries();
    let mut attempt: u32 = 0;
    loop {
        match run_step(
            app, state, session, request_id, index, step, cancel, on_event,
        )
        .await
        {
            StepResult::Failed { exit, message } => {
                if cancel.is_cancelled() {
                    return StepResult::Cancelled;
                }
                if attempt >= max_retries {
                    return StepResult::Failed { exit, message };
                }
                attempt += 1;
                let _ = on_event.send(TaskRunEvent::simple(index, "start"));
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
    session: &mut TaskSession,
    request_id: &str,
    index: usize,
    step: &TaskStep,
    cancel: &Arc<TransferCancel>,
    on_event: &TaskEvents,
) -> StepResult {
    match step {
        TaskStep::LocalCommand { cwd, command, .. } => command_result(
            run_local_command(
                index,
                cwd.as_deref(),
                command,
                CommandOptions::from(step),
                cancel,
                on_event,
            )
            .await,
        ),
        TaskStep::RemoteCommand { cwd, command, .. } => {
            match session.ensure_ssh(app, state, cancel).await {
                Ok(ssh) => command_result(
                    run_remote_command(
                        &ssh,
                        index,
                        cwd.as_deref(),
                        command,
                        CommandOptions::from(step),
                        cancel,
                        on_event,
                    )
                    .await,
                ),
                Err(error) => command_result(Err(error)),
            }
        }
        TaskStep::Upload { .. } | TaskStep::Download { .. } => {
            let result = async {
                session.ensure_sftp(app, state, cancel).await?;
                run_transfer(app, state, &session.id, request_id, index, step, cancel).await
            }
            .await;
            match result {
                Ok(()) => StepResult::Success(None),
                Err(AppError::Cancelled) => StepResult::Cancelled,
                Err(error) => {
                    state.sftp.disconnect(app, &session.id);
                    session.sftp_ready = false;
                    StepResult::Failed {
                        exit: None,
                        message: error.to_string(),
                    }
                }
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

#[derive(Clone, Copy)]
struct CommandOptions {
    shell: Option<TaskShell>,
    timeout: Duration,
}

impl Default for CommandOptions {
    fn default() -> Self {
        Self {
            shell: None,
            timeout: Duration::from_secs(300),
        }
    }
}

impl From<&TaskStep> for CommandOptions {
    fn from(step: &TaskStep) -> Self {
        let (shell, seconds) = step.command_options();
        Self {
            shell,
            timeout: Duration::from_secs(seconds),
        }
    }
}

fn shell_command(command: &str, shell: Option<TaskShell>) -> AppResult<tokio::process::Command> {
    let shell = shell.unwrap_or(if cfg!(windows) {
        TaskShell::Cmd
    } else {
        TaskShell::Sh
    });
    if !cfg!(windows) && !shell.is_posix() {
        return Err(AppError::Invalid(
            "this shell is only available on Windows; choose sh, bash, or zsh".into(),
        ));
    }
    let executable = if shell == TaskShell::Sh && cfg!(unix) {
        "/bin/sh"
    } else {
        shell.executable()
    };
    let mut cmd = tokio::process::Command::new(executable);
    match shell {
        TaskShell::Sh => {
            cmd.args(["-e", "-c", command]);
        }
        TaskShell::Bash | TaskShell::Zsh => {
            cmd.args(["-e", "-o", "pipefail", "-c", command]);
        }
        TaskShell::Cmd => {
            cmd.args(["/D", "/S", "/C", command]);
        }
        TaskShell::Powershell => {
            cmd.args(["-NoProfile", "-NonInteractive", "-Command", &format!("$ErrorActionPreference = 'Stop'; & {{\n{command}\n}}; if (-not $?) {{ exit 1 }}")]);
        }
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }
    Ok(cmd)
}

async fn run_local_command(
    index: usize,
    cwd: Option<&str>,
    command: &str,
    options: CommandOptions,
    cancel: &Arc<TransferCancel>,
    on_event: &TaskEvents,
) -> AppResult<i32> {
    let mut builder = shell_command(command, options.shell)?;
    builder.kill_on_drop(true);
    builder.current_dir(resolve_local_path(cwd.unwrap_or("~"))?);
    crate::shell_env::apply(&mut builder).await;
    builder
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    set_process_group(&mut builder);
    let mut child = builder
        .spawn()
        .map_err(|e| AppError::Other(format!("could not start local command: {e}")))?;

    let process_group = child.id();
    let mut process_guard = LocalProcessGroup(process_group);
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
        _ = tokio::time::sleep(options.timeout) => Stop::TimedOut,
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
            let drained = tokio::select! {
                biased;
                _ = cancel.cancelled() => Err(AppError::Cancelled),
                result = tokio::time::timeout(KILL_DRAIN_GRACE, drain(&mut readers)) => {
                    result.map_err(|_| AppError::Timeout("local command output did not close; redirect background process output".into())).and_then(|result| result)
                }
            };
            if drained.is_err() {
                kill_process_group(process_group);
                readers.abort_all();
            }
            drained?;
            if status.success() {
                process_guard.0 = None;
            }
            Ok(exit_code(status))
        }
    }
}

struct LocalProcessGroup(Option<u32>);

impl Drop for LocalProcessGroup {
    fn drop(&mut self) {
        kill_process_group(self.0);
    }
}

fn set_process_group(builder: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        builder.as_std_mut().process_group(0);
    }
    #[cfg(not(unix))]
    {
        let _ = builder;
    }
}

fn kill_process_group(pid: Option<u32>) {
    #[cfg(unix)]
    if let Some(pid) = pid {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    let _ = pid;
}

async fn kill_process_tree(child: &mut tokio::process::Child) {
    let pid = child.id();
    kill_process_group(pid);
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

async fn drain_bounded(readers: &mut JoinSet<AppResult<()>>) {
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

async fn drain(readers: &mut JoinSet<AppResult<()>>) -> AppResult<()> {
    let mut failure = None;
    while let Some(result) = readers.join_next().await {
        let error = match result {
            Ok(Ok(())) => None,
            Ok(Err(error)) => Some(error),
            Err(error) => Some(AppError::Other(format!(
                "command output reader failed: {error}"
            ))),
        };
        if failure.is_none() {
            failure = error;
        }
    }
    failure.map_or(Ok(()), Err)
}

async fn forward_reader<R>(mut reader: R, index: usize, on_event: TaskEvents) -> AppResult<()>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut buf = [0u8; 8 * 1024];
    let mut decoder = crate::command_output::Utf8Decoder::default();
    loop {
        let count = reader.read(&mut buf).await?;
        if count == 0 {
            break;
        }
        let chunk = decoder.push(&buf[..count]);
        if !chunk.is_empty() {
            let _ = on_event.send(TaskRunEvent::log(index, chunk));
        }
    }
    let remaining = decoder.finish();
    if !remaining.is_empty() {
        let _ = on_event.send(TaskRunEvent::log(index, remaining));
    }
    Ok(())
}

fn wrap_remote_command(cwd: Option<&str>, command: &str) -> String {
    match cwd {
        Some(dir) => {
            let quoted = if dir == "~" {
                "\"$HOME\"".to_string()
            } else if let Some(relative) = dir.strip_prefix("~/") {
                format!("\"$HOME\"/{}", sh_quote(relative))
            } else {
                sh_quote(dir)
            };
            format!("cd -- {quoted} && {{\n{command}\n}}")
        }
        None => command.to_string(),
    }
}

async fn run_remote_command(
    ssh: &crate::ssh::SshConnection,
    index: usize,
    cwd: Option<&str>,
    command: &str,
    options: CommandOptions,
    cancel: &Arc<TransferCancel>,
    on_event: &TaskEvents,
) -> AppResult<i32> {
    let script = wrap_remote_command(cwd, command);
    let shell = options.shell.unwrap_or(TaskShell::Sh);
    let flags = if matches!(shell, TaskShell::Bash | TaskShell::Zsh) {
        "-e -o pipefail"
    } else {
        "-e"
    };
    let wrapped = format!("{} {flags} -c {}", shell.executable(), sh_quote(&script));
    let channel = on_event.clone();
    crate::ssh::exec::exec_stream(
        &ssh.handle,
        &wrapped,
        move |chunk| {
            let _ = channel.send(TaskRunEvent::log(index, chunk));
        },
        cancel,
        options.timeout,
    )
    .await
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
    let remote_path = match step {
        TaskStep::Upload { remote_path, .. } | TaskStep::Download { remote_path, .. } => {
            if remote_path == "~" || remote_path.starts_with("~/") {
                let home = state.sftp.realpath(conn_id, ".").await?;
                if remote_path == "~" {
                    home
                } else {
                    crate::sftp::path::join_remote(&home, &remote_path[2..])
                }
            } else {
                remote_path.clone()
            }
        }
        _ => return Err(AppError::Invalid("not a transfer step".into())),
    };
    let (source, dest_dir, target_name) = match step {
        TaskStep::Upload { local_path, .. } => {
            let name = base_name(&remote_path);
            let source = Endpoint {
                connection_id: None,
                path: resolve_local_path(local_path)?
                    .to_string_lossy()
                    .into_owned(),
            };
            let dest_dir = Endpoint {
                connection_id: Some(conn_id.to_string()),
                path: parent_remote(&remote_path),
            };
            (source, dest_dir, name)
        }
        TaskStep::Download {
            remote_path,
            local_path,
            ..
        } => {
            let (dir, name) = split_local_path(&resolve_local_path(local_path)?.to_string_lossy())?;
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

fn resolve_local_path(path: &str) -> AppResult<std::path::PathBuf> {
    let expanded = std::path::PathBuf::from(expand_local_tilde(path));
    if expanded.is_absolute() {
        return Ok(expanded);
    }
    let home = home_dir().ok_or_else(|| {
        AppError::Invalid("could not find the home folder; use an absolute path".into())
    })?;
    if path == "~" || path.starts_with("~/") {
        return Err(AppError::Invalid("could not expand the home folder".into()));
    }
    Ok(std::path::PathBuf::from(home).join(expanded))
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

    fn events() -> TaskEvents {
        TaskEvents::new(Channel::new(|_| Ok(())), 1)
    }

    #[tokio::test]
    async fn rejects_overlapping_tasks_and_releases_registration() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect_lazy("sqlite::memory:")
            .unwrap();
        let state = AppState::new(pool);
        let first =
            register_run(&state, "task-1", "run-1", Arc::new(TransferCancel::new())).unwrap();
        assert!(register_run(&state, "task-1", "run-2", Arc::new(TransferCancel::new())).is_err());
        assert!(register_run(&state, "task-2", "run-1", Arc::new(TransferCancel::new())).is_err());
        drop(first);
        assert!(state.task_cancels.lock().is_empty());
        assert!(register_run(&state, "task-1", "run-2", Arc::new(TransferCancel::new())).is_ok());
    }

    #[test]
    fn rejects_changed_execution_snapshots() {
        let task: Task = serde_json::from_value(serde_json::json!({
            "id": "t1", "name": "Task", "hostId": "h1", "steps": "[]",
            "createdAt": "", "updatedAt": "", "revision": 2
        }))
        .unwrap();
        assert!(validate_run_snapshot(&task, "h1", 2, "[]").is_ok());
        assert!(validate_run_snapshot(&task, "h1", 1, "[]").is_err());
        assert!(validate_run_snapshot(&task, "h2", 2, "[]").is_err());
        assert!(validate_run_snapshot(&task, "h1", 2, "changed").is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bounds_output_drain_after_shell_exit() {
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            run_local_command(
                0,
                None,
                "sleep 30 &",
                CommandOptions::default(),
                &Arc::new(TransferCancel::new()),
                &events(),
            ),
        )
        .await
        .unwrap();
        assert!(matches!(result, Err(AppError::Timeout(_))));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancels_local_process_and_captures_failure_output() {
        let cancel = Arc::new(TransferCancel::new());
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            trigger.cancel();
        });
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            run_local_command(
                0,
                None,
                "sleep 30",
                CommandOptions::default(),
                &cancel,
                &events(),
            ),
        )
        .await
        .unwrap();
        assert!(matches!(result, Err(AppError::Cancelled)));
        let output = events();
        let code = run_local_command(
            0,
            None,
            "printf failure >&2; exit 7",
            CommandOptions::default(),
            &Arc::new(TransferCancel::new()),
            &output,
        )
        .await
        .unwrap();
        assert_eq!(code, 7);
        assert_eq!(output.logs.lock()[0], "failure");
    }

    #[test]
    fn caps_history_logs_at_utf8_boundaries() {
        let output = events();
        output
            .send(TaskRunEvent::log(0, "中文".repeat(5000)))
            .unwrap();
        let logs = output.logs.lock();
        assert!(logs[0].len() <= 8192);
        assert!(!logs[0].contains('\u{fffd}'));
    }

    #[cfg(unix)]
    #[test]
    fn failed_remote_directory_change_prevents_every_command() {
        let wrapped = wrap_remote_command(
            Some("/sageport-nonexistent-directory"),
            "printf unexpected; true\nprintf unexpected",
        );
        let output = std::process::Command::new("sh")
            .args(["-c", &wrapped])
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        assert!(wrap_remote_command(Some("~/project dir"), "true")
            .starts_with("cd -- \"$HOME\"/'project dir' && {"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn commands_stop_on_errors_and_support_pipeline_checks() {
        for (shell, command) in [
            (None, "false; printf unexpected"),
            (Some(TaskShell::Bash), "false | cat; printf unexpected"),
        ] {
            let output = events();
            let result = run_local_command(
                0,
                None,
                command,
                CommandOptions {
                    shell,
                    ..Default::default()
                },
                &Arc::new(TransferCancel::new()),
                &output,
            )
            .await
            .unwrap();
            assert_ne!(result, 0);
            assert!(output.logs.lock()[0].is_empty());
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn command_timeout_is_configurable() {
        let result = run_local_command(
            0,
            None,
            "sleep 30",
            CommandOptions {
                timeout: Duration::from_millis(50),
                ..Default::default()
            },
            &Arc::new(TransferCancel::new()),
            &events(),
        )
        .await;
        assert!(matches!(result, Err(AppError::Timeout(_))));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn preserves_error_tail_after_large_output() {
        let output = events();
        let code = run_local_command(
            0,
            None,
            "head -c 600000 /dev/zero | tr '\\0' x; printf final-error; exit 9",
            CommandOptions::default(),
            &Arc::new(TransferCancel::new()),
            &output,
        )
        .await
        .unwrap();
        output.flush(0).unwrap();
        assert_eq!(code, 9);
        assert!(output.logs.lock()[0].ends_with("final-error"));
        let outputs = output.outputs.lock();
        assert!(outputs[0].tail.ends_with("final-error"));
        assert!(outputs[0].tail.len() <= STEP_OUTPUT_CAP);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn uses_the_home_folder_and_closes_command_input() {
        let output = events();
        let code = run_local_command(
            0,
            None,
            "pwd; cat",
            CommandOptions::default(),
            &Arc::new(TransferCancel::new()),
            &output,
        )
        .await
        .unwrap();
        assert_eq!(code, 0);
        assert_eq!(
            std::path::PathBuf::from(output.logs.lock()[0].trim()),
            std::path::PathBuf::from(home_dir().unwrap())
        );
        assert_eq!(
            resolve_local_path("project/dist").unwrap(),
            std::path::PathBuf::from(home_dir().unwrap()).join("project/dist")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn allows_explicitly_redirected_background_processes() {
        let output = events();
        let code = run_local_command(
            0,
            None,
            "sleep 30 >/dev/null 2>&1 & printf '%s' \"$!\"",
            CommandOptions::default(),
            &Arc::new(TransferCancel::new()),
            &output,
        )
        .await
        .unwrap();
        assert_eq!(code, 0);
        let pid: i32 = output.logs.lock()[0].parse().unwrap();
        let alive = unsafe { libc::kill(pid, 0) == 0 };
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
        assert!(alive);
    }

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
