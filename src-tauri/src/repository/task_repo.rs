use sqlx::SqlitePool;

use crate::domain::{new_id, now, Task, TaskInput, TaskStep};
use crate::error::{AppError, AppResult};

const MAX_ID_BYTES: usize = 128;
const MAX_NAME_CHARS: usize = 255;
const MAX_DESCRIPTION_CHARS: usize = 4 * 1024;
const MAX_COMMAND_CHARS: usize = 32 * 1024;
const MAX_PATH_CHARS: usize = 4 * 1024;
const MAX_STEPS: usize = 50;

pub struct NormalizedTask {
    pub name: String,
    pub description: Option<String>,
    pub host_id: Option<String>,
    pub steps_json: String,
}

fn require_field(value: &str, empty_msg: &str, max: usize, too_long_msg: &str) -> AppResult<()> {
    if value.is_empty() {
        return Err(AppError::Invalid(empty_msg.into()));
    }
    if value.chars().count() > max || value.contains('\0') {
        return Err(AppError::Invalid(too_long_msg.into()));
    }
    Ok(())
}

fn normalize_optional(
    value: Option<String>,
    max: usize,
    too_long_msg: &str,
) -> AppResult<Option<String>> {
    let value = value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if let Some(value) = &value {
        if value.chars().count() > max || value.contains('\0') {
            return Err(AppError::Invalid(too_long_msg.into()));
        }
    }
    Ok(value)
}

fn normalize_step(step: TaskStep) -> AppResult<TaskStep> {
    let step = match step {
        TaskStep::LocalCommand {
            cwd,
            command,
            continue_on_error,
        } => {
            let command = command.trim().to_string();
            require_field(
                &command,
                "task command is required",
                MAX_COMMAND_CHARS,
                "task command is too long",
            )?;
            TaskStep::LocalCommand {
                cwd: normalize_optional(cwd, MAX_PATH_CHARS, "task working directory is too long")?,
                command,
                continue_on_error,
            }
        }
        TaskStep::RemoteCommand {
            cwd,
            command,
            continue_on_error,
        } => {
            let command = command.trim().to_string();
            require_field(
                &command,
                "task command is required",
                MAX_COMMAND_CHARS,
                "task command is too long",
            )?;
            TaskStep::RemoteCommand {
                cwd: normalize_optional(cwd, MAX_PATH_CHARS, "task working directory is too long")?,
                command,
                continue_on_error,
            }
        }
        TaskStep::Upload {
            local_path,
            remote_path,
            incremental,
            continue_on_error,
        } => {
            let local_path = local_path.trim().to_string();
            let remote_path = remote_path.trim().to_string();
            require_field(
                &local_path,
                "upload source is required",
                MAX_PATH_CHARS,
                "task path is too long",
            )?;
            require_field(
                &remote_path,
                "upload destination is required",
                MAX_PATH_CHARS,
                "task path is too long",
            )?;
            TaskStep::Upload {
                local_path,
                remote_path,
                incremental,
                continue_on_error,
            }
        }
        TaskStep::Download {
            remote_path,
            local_path,
            continue_on_error,
        } => {
            let remote_path = remote_path.trim().to_string();
            let local_path = local_path.trim().to_string();
            require_field(
                &remote_path,
                "download source is required",
                MAX_PATH_CHARS,
                "task path is too long",
            )?;
            require_field(
                &local_path,
                "download destination is required",
                MAX_PATH_CHARS,
                "task path is too long",
            )?;
            TaskStep::Download {
                remote_path,
                local_path,
                continue_on_error,
            }
        }
    };
    Ok(step)
}

pub(crate) fn normalize(input: TaskInput) -> AppResult<NormalizedTask> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("task name is required".into()));
    }
    if name.chars().count() > MAX_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(AppError::Invalid(format!(
            "task name exceeds {MAX_NAME_CHARS} characters"
        )));
    }
    let description = normalize_optional(
        input.description,
        MAX_DESCRIPTION_CHARS,
        "task description is too long",
    )?;
    let host_id = normalize_optional(input.host_id, MAX_ID_BYTES, "invalid task host id")?;

    if input.steps.is_empty() {
        return Err(AppError::Invalid("a task needs at least one step".into()));
    }
    if input.steps.len() > MAX_STEPS {
        return Err(AppError::Invalid(format!(
            "a task can have at most {MAX_STEPS} steps"
        )));
    }
    let steps = input
        .steps
        .into_iter()
        .map(normalize_step)
        .collect::<AppResult<Vec<_>>>()?;
    let steps_json = serde_json::to_string(&steps)
        .map_err(|e| AppError::Invalid(format!("task steps are not serializable: {e}")))?;

    Ok(NormalizedTask {
        name,
        description,
        host_id,
        steps_json,
    })
}

fn validate_id(id: &str) -> AppResult<()> {
    if id.trim().is_empty() || id.len() > MAX_ID_BYTES {
        return Err(AppError::Invalid("invalid task id".into()));
    }
    Ok(())
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Task>> {
    let rows = sqlx::query_as::<_, Task>(
        "SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Task> {
    validate_id(id)?;
    sqlx::query_as::<_, Task>("SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("task {id}")))
}

pub async fn create(pool: &SqlitePool, input: TaskInput) -> AppResult<Task> {
    let task = normalize(input)?;
    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO tasks (id, name, description, host_id, steps, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&task.name)
    .bind(&task.description)
    .bind(&task.host_id)
    .bind(&task.steps_json)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn update(pool: &SqlitePool, id: &str, input: TaskInput) -> AppResult<Task> {
    validate_id(id)?;
    let task = normalize(input)?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE tasks
         SET name = ?, description = ?, host_id = ?, steps = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&task.name)
    .bind(&task.description)
    .bind(&task.host_id)
    .bind(&task.steps_json)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("task {id}")));
    }
    get(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    validate_id(id)?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE tasks
         SET deleted_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(id)
    .execute(pool)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("task {id}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    fn step_command(command: &str) -> TaskStep {
        TaskStep::LocalCommand {
            cwd: Some("  ~/proj  ".into()),
            command: command.into(),
            continue_on_error: false,
        }
    }

    fn input(name: &str) -> TaskInput {
        TaskInput {
            name: name.into(),
            description: Some("  build and ship  ".into()),
            host_id: Some("  host-1  ".into()),
            steps: vec![
                step_command("  pnpm build  "),
                TaskStep::Upload {
                    local_path: "  ./dist  ".into(),
                    remote_path: "  /var/www/app  ".into(),
                    incremental: true,
                    continue_on_error: false,
                },
            ],
        }
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    #[test]
    fn normalizes_and_bounds_task_input() {
        let normalized = normalize(input("  Deploy web  ")).unwrap();
        assert_eq!(normalized.name, "Deploy web");
        assert_eq!(normalized.description.as_deref(), Some("build and ship"));
        assert_eq!(normalized.host_id.as_deref(), Some("host-1"));
        let steps: Vec<TaskStep> = serde_json::from_str(&normalized.steps_json).unwrap();
        assert!(
            matches!(&steps[0], TaskStep::LocalCommand { cwd, command, .. }
            if cwd.as_deref() == Some("~/proj") && command == "pnpm build")
        );

        let mut empty_name = input("   ");
        assert!(normalize(std::mem::replace(&mut empty_name, input("x"))).is_err());

        let mut no_steps = input("Deploy");
        no_steps.steps.clear();
        assert!(normalize(no_steps).is_err());

        let mut blank_command = input("Deploy");
        blank_command.steps = vec![step_command("   ")];
        assert!(normalize(blank_command).is_err());

        assert!(validate_id("").is_err());
        assert!(validate_id(&"x".repeat(MAX_ID_BYTES + 1)).is_err());
    }

    #[tokio::test]
    async fn creates_updates_and_soft_deletes_tasks() {
        let pool = test_pool().await;
        let created = create(&pool, input("Deploy web")).await.unwrap();
        assert_eq!(created.parse_steps().unwrap().len(), 2);

        let mut changed = input("Deploy web now");
        changed.host_id = None;
        let updated = update(&pool, &created.id, changed).await.unwrap();
        assert_eq!(updated.name, "Deploy web now");
        assert_eq!(updated.host_id, None);
        assert_eq!(updated.revision, 2);

        delete(&pool, &created.id).await.unwrap();
        assert!(get(&pool, &created.id).await.is_err());
        assert!(list(&pool).await.unwrap().is_empty());
        assert!(delete(&pool, &created.id).await.is_err());
    }
}
