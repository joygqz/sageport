use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const VERSION: u32 = 1;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    pub version: u32,
    pub kdf: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

fn derive_key(passphrase: &str, salt: &[u8]) -> AppResult<[u8; KEY_LEN]> {
    let mut key = [0u8; KEY_LEN];
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    Ok(key)
}

pub fn encrypt(plaintext: &[u8], passphrase: &str) -> AppResult<EncryptedEnvelope> {
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    Ok(EncryptedEnvelope {
        version: VERSION,
        kdf: "argon2id".to_string(),
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce_bytes),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

pub fn decrypt(envelope: &EncryptedEnvelope, passphrase: &str) -> AppResult<Vec<u8>> {
    if envelope.version != VERSION {
        return Err(AppError::Crypto(format!(
            "unsupported vault version {}",
            envelope.version
        )));
    }
    let salt = STANDARD
        .decode(&envelope.salt)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    let nonce_bytes = STANDARD
        .decode(&envelope.nonce)
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    let key = derive_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| AppError::Crypto("decryption failed (wrong passphrase?)".into()))
}
