use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use argon2::Argon2;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const KDF_ARGON2ID: &str = "argon2id";
const CIPHER_AES256_GCM: &str = "aes-256-gcm";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEnvelope {
    pub kdf: String,
    #[serde(default = "default_cipher")]
    pub cipher: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

fn default_cipher() -> String {
    CIPHER_AES256_GCM.to_string()
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
        kdf: KDF_ARGON2ID.to_string(),
        cipher: CIPHER_AES256_GCM.to_string(),
        salt: STANDARD.encode(salt),
        nonce: STANDARD.encode(nonce_bytes),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

pub fn decrypt(envelope: &EncryptedEnvelope, passphrase: &str) -> AppResult<Vec<u8>> {
    if envelope.kdf != KDF_ARGON2ID {
        return Err(AppError::Crypto(format!(
            "unsupported kdf {}",
            envelope.kdf
        )));
    }
    if envelope.cipher != CIPHER_AES256_GCM {
        return Err(AppError::Crypto(format!(
            "unsupported cipher {}",
            envelope.cipher
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let envelope = encrypt(b"vault data", "passphrase").unwrap();
        assert_eq!(decrypt(&envelope, "passphrase").unwrap(), b"vault data");
    }

    #[test]
    fn legacy_envelope_with_version_and_no_cipher_decrypts() {
        let envelope = encrypt(b"vault data", "passphrase").unwrap();
        let mut json: serde_json::Value = serde_json::to_value(&envelope).unwrap();
        json.as_object_mut().unwrap().remove("cipher");
        json["version"] = serde_json::json!(1);
        let legacy: EncryptedEnvelope = serde_json::from_value(json).unwrap();
        assert_eq!(decrypt(&legacy, "passphrase").unwrap(), b"vault data");
    }

    #[test]
    fn unknown_config_is_rejected() {
        let mut envelope = encrypt(b"vault data", "passphrase").unwrap();
        envelope.cipher = "xchacha20-poly1305".into();
        assert!(decrypt(&envelope, "passphrase").is_err());
    }
}
