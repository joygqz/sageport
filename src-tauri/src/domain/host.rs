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
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
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
    pub password: Option<String>,
}

fn default_port() -> i64 {
    22
}
