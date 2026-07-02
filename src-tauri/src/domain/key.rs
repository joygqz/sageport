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

/// Algorithm choice for `keys_generate`. Variant names serialize to the exact
/// strings the frontend's `SshKeyAlgorithm` union uses (`rename_all =
/// "camelCase"` turns `EcdsaP256` into `"ecdsaP256"`, `Rsa4096` into
/// `"rsa4096"`, etc.).
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
