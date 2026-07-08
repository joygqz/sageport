use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SftpBookmark {
    pub id: String,
    pub host_id: Option<String>,
    pub label: String,
    pub path: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpBookmarkInput {
    #[serde(default)]
    pub host_id: Option<String>,
    pub label: String,
    pub path: String,
}
