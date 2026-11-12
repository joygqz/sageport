use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub host_id: Option<String>,
    pub steps: String,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub schedule_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

impl Task {
    pub fn parse_steps(&self) -> Result<Vec<TaskStep>, serde_json::Error> {
        serde_json::from_str(&self.steps)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub host_id: Option<String>,
    pub steps: Vec<TaskStep>,
    #[serde(default)]
    pub schedule: Option<String>,
    #[serde(default)]
    pub schedule_enabled: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskShell {
    Sh,
    Bash,
    Zsh,
    Cmd,
    Powershell,
}

impl TaskShell {
    pub fn executable(self) -> &'static str {
        match self {
            Self::Sh => "sh",
            Self::Bash => "bash",
            Self::Zsh => "zsh",
            Self::Cmd => "cmd",
            Self::Powershell => "powershell",
        }
    }

    pub fn is_posix(self) -> bool {
        matches!(self, Self::Sh | Self::Bash | Self::Zsh)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TaskStep {
    LocalCommand {
        #[serde(default)]
        cwd: Option<String>,
        command: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shell: Option<TaskShell>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout_seconds: Option<u64>,
        #[serde(default)]
        retries: u32,
    },
    Upload {
        local_path: String,
        remote_path: String,
        #[serde(default)]
        retries: u32,
    },
    Download {
        remote_path: String,
        local_path: String,
        #[serde(default)]
        retries: u32,
    },
    RemoteCommand {
        #[serde(default)]
        cwd: Option<String>,
        command: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        shell: Option<TaskShell>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout_seconds: Option<u64>,
        #[serde(default)]
        retries: u32,
    },
}

impl TaskStep {
    pub fn command_options(&self) -> (Option<TaskShell>, u64) {
        match self {
            Self::LocalCommand {
                shell,
                timeout_seconds,
                ..
            }
            | Self::RemoteCommand {
                shell,
                timeout_seconds,
                ..
            } => (*shell, timeout_seconds.unwrap_or(300)),
            _ => (None, 300),
        }
    }

    pub fn retries(&self) -> u32 {
        match self {
            TaskStep::LocalCommand { retries, .. }
            | TaskStep::Upload { retries, .. }
            | TaskStep::Download { retries, .. }
            | TaskStep::RemoteCommand { retries, .. } => *retries,
        }
    }

    pub fn needs_remote(&self) -> bool {
        !matches!(self, TaskStep::LocalCommand { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_step_tags_as_camel_case() {
        let step = TaskStep::RemoteCommand {
            cwd: Some("/srv".into()),
            command: "systemctl reload nginx".into(),
            shell: None,
            timeout_seconds: None,
            retries: 3,
        };
        let json = serde_json::to_string(&step).unwrap();
        assert!(json.contains("\"type\":\"remoteCommand\""));
        assert!(json.contains("\"retries\":3"));
        let parsed: TaskStep = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, step);
    }
}
