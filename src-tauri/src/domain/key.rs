use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    pub id: String,
    pub name: String,
    pub public_key: Option<String>,

    pub private_key: Option<String>,

    pub passphrase: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyView {
    pub id: String,
    pub name: String,
    pub public_key: Option<String>,
    pub has_private_key: bool,
    pub has_passphrase: bool,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub revision: i64,
}

impl From<SshKey> for SshKeyView {
    fn from(key: SshKey) -> Self {
        Self {
            id: key.id,
            name: key.name,
            public_key: key.public_key,
            has_private_key: key
                .private_key
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
            has_passphrase: key
                .passphrase
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
            created_at: key.created_at,
            updated_at: key.updated_at,
            deleted_at: key.deleted_at,
            revision: key.revision,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInput {
    pub name: String,
    #[serde(default)]
    pub public_key: Option<String>,

    #[serde(default)]
    pub private_key: Option<String>,

    #[serde(default)]
    pub passphrase: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyAlgorithm {
    Ed25519,
    EcdsaP256,
    EcdsaP384,
    EcdsaP521,
    Rsa2048,
    Rsa4096,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyGenerateInput {
    pub name: String,
    pub algorithm: KeyAlgorithm,
    #[serde(default)]
    pub passphrase: Option<String>,
}
