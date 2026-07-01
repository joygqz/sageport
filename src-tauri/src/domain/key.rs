use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub id: String,
    pub name: String,
    pub public_key: Option<String>,
    /// PEM/OpenSSH private key material (plaintext column).
    pub private_key: Option<String>,
    /// Optional passphrase protecting the private key (plaintext column).
    pub passphrase: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInput {
    pub name: String,
    #[serde(default)]
    pub public_key: Option<String>,
    /// PEM/OpenSSH private key material; stored inline on the key row.
    #[serde(default)]
    pub private_key: Option<String>,
    /// Optional passphrase protecting the private key; stored on the key row.
    #[serde(default)]
    pub passphrase: Option<String>,
}
