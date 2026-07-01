use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub name: String,
    pub username: String,
    pub auth_type: String,
    pub key_id: Option<String>,
    /// Inline password (plaintext column), used when `auth_type` is `password`.
    pub password: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityInput {
    pub name: String,
    pub username: String,
    #[serde(default = "default_auth")]
    pub auth_type: String,
    #[serde(default)]
    pub key_id: Option<String>,
    /// Optional password; stored on the identity row when provided.
    #[serde(default)]
    pub password: Option<String>,
}

fn default_auth() -> String {
    crate::domain::auth::PASSWORD.to_string()
}
