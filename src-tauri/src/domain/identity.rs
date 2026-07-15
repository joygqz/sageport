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

    pub password: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityView {
    pub id: String,
    pub name: String,
    pub username: String,
    pub auth_type: String,
    pub key_id: Option<String>,
    pub has_password: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

impl From<Identity> for IdentityView {
    fn from(identity: Identity) -> Self {
        Self {
            id: identity.id,
            name: identity.name,
            username: identity.username,
            auth_type: identity.auth_type,
            key_id: identity.key_id,
            has_password: identity
                .password
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
            created_at: identity.created_at,
            updated_at: identity.updated_at,
            deleted_at: identity.deleted_at,
            revision: identity.revision,
        }
    }
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

    #[serde(default)]
    pub password: Option<String>,
}

fn default_auth() -> String {
    crate::domain::auth::PASSWORD.to_string()
}
