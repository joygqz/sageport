use std::collections::HashMap;

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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TaskStep {
    LocalCommand {
        #[serde(default)]
        cwd: Option<String>,
        command: String,
        #[serde(default)]
        continue_on_error: bool,
    },
    Upload {
        local_path: String,
        remote_path: String,
        #[serde(default)]
        incremental: bool,
        #[serde(default)]
        continue_on_error: bool,
    },
    Download {
        remote_path: String,
        local_path: String,
        #[serde(default)]
        continue_on_error: bool,
    },
    RemoteCommand {
        #[serde(default)]
        cwd: Option<String>,
        command: String,
        #[serde(default)]
        continue_on_error: bool,
    },
}

impl TaskStep {
    pub fn continue_on_error(&self) -> bool {
        match self {
            TaskStep::LocalCommand {
                continue_on_error, ..
            }
            | TaskStep::Upload {
                continue_on_error, ..
            }
            | TaskStep::Download {
                continue_on_error, ..
            }
            | TaskStep::RemoteCommand {
                continue_on_error, ..
            } => *continue_on_error,
        }
    }

    pub fn needs_remote(&self) -> bool {
        !matches!(self, TaskStep::LocalCommand { .. })
    }

    pub fn substitute(&self, values: &HashMap<String, String>) -> TaskStep {
        let sub = |text: &str| substitute_variables(text, values);
        let sub_opt = |text: &Option<String>| text.as_deref().map(sub);
        match self {
            TaskStep::LocalCommand {
                cwd,
                command,
                continue_on_error,
            } => TaskStep::LocalCommand {
                cwd: sub_opt(cwd),
                command: sub(command),
                continue_on_error: *continue_on_error,
            },
            TaskStep::Upload {
                local_path,
                remote_path,
                incremental,
                continue_on_error,
            } => TaskStep::Upload {
                local_path: sub(local_path),
                remote_path: sub(remote_path),
                incremental: *incremental,
                continue_on_error: *continue_on_error,
            },
            TaskStep::Download {
                remote_path,
                local_path,
                continue_on_error,
            } => TaskStep::Download {
                remote_path: sub(remote_path),
                local_path: sub(local_path),
                continue_on_error: *continue_on_error,
            },
            TaskStep::RemoteCommand {
                cwd,
                command,
                continue_on_error,
            } => TaskStep::RemoteCommand {
                cwd: sub_opt(cwd),
                command: sub(command),
                continue_on_error: *continue_on_error,
            },
        }
    }
}

pub fn substitute_variables(text: &str, values: &HashMap<String, String>) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' && i + 1 < bytes.len() && bytes[i + 1] == b'{' {
            if let Some((name, default, end)) = parse_placeholder(text, i) {
                let provided = values.get(&name).map(String::as_str).unwrap_or("");
                if !provided.trim().is_empty() {
                    out.push_str(provided);
                } else {
                    out.push_str(default.trim());
                }
                i = end;
                continue;
            }
        }
        let ch_len = utf8_char_len(bytes[i]);
        out.push_str(&text[i..i + ch_len]);
        i += ch_len;
    }
    out
}

fn parse_placeholder(text: &str, start: usize) -> Option<(String, String, usize)> {
    let rest = &text[start + 2..];
    let close = rest.find("}}")?;
    let inner = &rest[..close];
    if inner.contains('{') {
        return None;
    }
    let (name_raw, default) = match inner.split_once(':') {
        Some((name, default)) => (name.trim(), default),
        None => (inner.trim(), ""),
    };
    if name_raw.is_empty()
        || !name_raw
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return None;
    }
    Some((name_raw.to_string(), default.to_string(), start + 2 + close + 2))
}

fn utf8_char_len(first: u8) -> usize {
    match first {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        _ => 4,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn substitutes_provided_defaults_and_empty() {
        let vals = values(&[("env", "prod"), ("blank", "  ")]);
        assert_eq!(
            substitute_variables("deploy {{env}} now", &vals),
            "deploy prod now"
        );
        assert_eq!(
            substitute_variables("scale {{count:3}}", &vals),
            "scale 3"
        );
        assert_eq!(
            substitute_variables("{{blank:fallback}}", &vals),
            "fallback"
        );
        assert_eq!(substitute_variables("[{{missing}}]", &vals), "[]");
    }

    #[test]
    fn leaves_malformed_and_unicode_intact() {
        let vals = values(&[]);
        assert_eq!(substitute_variables("brace {{ only", &vals), "brace {{ only");
        assert_eq!(substitute_variables("{{bad name}}", &vals), "{{bad name}}");
        assert_eq!(
            substitute_variables("备份 {{env}} 完成", &values(&[("env", "生产")])),
            "备份 生产 完成"
        );
    }

    #[test]
    fn round_trips_step_tags_as_camel_case() {
        let step = TaskStep::RemoteCommand {
            cwd: Some("/srv".into()),
            command: "reload {{svc}}".into(),
            continue_on_error: true,
        };
        let json = serde_json::to_string(&step).unwrap();
        assert!(json.contains("\"type\":\"remoteCommand\""));
        assert!(json.contains("\"continueOnError\":true"));
        let parsed: TaskStep = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, step);

        let resolved = step.substitute(&values(&[("svc", "nginx")]));
        if let TaskStep::RemoteCommand { command, .. } = resolved {
            assert_eq!(command, "reload nginx");
        } else {
            panic!("variant changed");
        }
    }
}
