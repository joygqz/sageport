use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryEntry {
    pub id: String,
    pub host_id: String,
    pub host_label: Option<String>,
    pub command: String,
    pub used_at: String,
    pub use_count: i64,
}
