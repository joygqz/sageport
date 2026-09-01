use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub host: String,
    pub port: i64,
    pub username: Option<String>,
    pub password: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfileView {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub host: String,
    pub port: i64,
    pub username: Option<String>,
    pub has_password: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

impl From<ProxyProfile> for ProxyProfileView {
    fn from(profile: ProxyProfile) -> Self {
        Self {
            id: profile.id,
            name: profile.name,
            kind: profile.kind,
            host: profile.host,
            port: profile.port,
            username: profile.username,
            has_password: profile
                .password
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
            created_at: profile.created_at,
            updated_at: profile.updated_at,
            deleted_at: profile.deleted_at,
            revision: profile.revision,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfileInput {
    pub name: String,
    pub kind: String,
    pub host: String,
    pub port: i64,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

pub mod proxy_kind {
    pub const SOCKS5: &str = "socks5";
    pub const HTTP: &str = "http";
}
