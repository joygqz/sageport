use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub label: String,
    pub address: String,
    pub port: i64,
    pub group_id: Option<String>,
    pub identity_id: Option<String>,

    pub username: Option<String>,
    pub auth_type: Option<String>,
    pub key_id: Option<String>,
    pub os_hint: Option<String>,
    pub color: Option<String>,
    pub notes: Option<String>,

    pub password: Option<String>,
    pub jump_host_id: Option<String>,
    pub startup_command: Option<String>,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostView {
    pub id: String,
    pub label: String,
    pub address: String,
    pub port: i64,
    pub group_id: Option<String>,
    pub identity_id: Option<String>,
    pub username: Option<String>,
    pub auth_type: Option<String>,
    pub key_id: Option<String>,
    pub os_hint: Option<String>,
    pub color: Option<String>,
    pub notes: Option<String>,
    pub has_password: bool,
    pub jump_host_id: Option<String>,
    pub startup_command: Option<String>,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

impl From<Host> for HostView {
    fn from(host: Host) -> Self {
        Self {
            id: host.id,
            label: host.label,
            address: host.address,
            port: host.port,
            group_id: host.group_id,
            identity_id: host.identity_id,
            username: host.username,
            auth_type: host.auth_type,
            key_id: host.key_id,
            os_hint: host.os_hint,
            color: host.color,
            notes: host.notes,
            has_password: host
                .password
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
            jump_host_id: host.jump_host_id,
            startup_command: host.startup_command,
            last_used_at: host.last_used_at,
            created_at: host.created_at,
            updated_at: host.updated_at,
            deleted_at: host.deleted_at,
            revision: host.revision,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInput {
    pub label: String,
    pub address: String,
    #[serde(default = "default_port")]
    pub port: i64,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub identity_id: Option<String>,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub auth_type: Option<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub os_hint: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub jump_host_id: Option<String>,
    #[serde(default)]
    pub startup_command: Option<String>,

    #[serde(default)]
    pub password: Option<String>,
}

fn default_port() -> i64 {
    22
}
