use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct PortForward {
    pub id: String,
    pub host_id: String,
    pub label: String,
    pub kind: String,
    pub bind_host: String,
    pub bind_port: i64,
    pub target_host: Option<String>,
    pub target_port: Option<i64>,
    pub auto_start: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardInput {
    pub host_id: String,
    pub label: String,
    pub kind: String,
    #[serde(default = "default_bind_host")]
    pub bind_host: String,
    pub bind_port: i64,
    #[serde(default)]
    pub target_host: Option<String>,
    #[serde(default)]
    pub target_port: Option<i64>,
    #[serde(default)]
    pub auto_start: bool,
}

fn default_bind_host() -> String {
    "127.0.0.1".to_string()
}

pub mod forward_kind {
    pub const LOCAL: &str = "local";
    pub const DYNAMIC: &str = "dynamic";
}
