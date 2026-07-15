use std::io::Read;
use std::path::Path;

use russh::keys::{decode_secret_key, HashAlg as RusshHashAlg};
use serde::Serialize;
use ssh_key::private::RsaKeypair;
use ssh_key::rand_core::OsRng;
use ssh_key::{Algorithm, EcdsaCurve, HashAlg, LineEnding, PrivateKey};

use crate::domain::KeyAlgorithm;
use crate::error::{AppError, AppResult};

const MAX_PRIVATE_KEY_FILE_SIZE: u64 = 1024 * 1024;

#[derive(Debug)]
pub struct KeyInsight {
    pub public_key: String,
    pub encrypted: bool,
}

fn is_encrypted_format(private_key: &str) -> bool {
    if let Ok(key) = PrivateKey::from_openssh(private_key.trim()) {
        return key.is_encrypted();
    }

    private_key.contains("-----BEGIN ENCRYPTED PRIVATE KEY-----")
        || private_key.contains("DEK-Info:")
        || private_key.lines().any(|line| {
            line.strip_prefix("Encryption:")
                .is_some_and(|value| !value.trim().eq_ignore_ascii_case("none"))
        })
}

pub fn inspect(private_key: &str, passphrase: Option<&str>) -> AppResult<Option<KeyInsight>> {
    let encrypted = is_encrypted_format(private_key);
    let passphrase = passphrase.filter(|value| !value.is_empty());
    let key = match decode_secret_key(private_key.trim(), passphrase) {
        Ok(key) => key,
        Err(_) if encrypted && passphrase.is_none() => {
            return Err(AppError::Invalid(
                "passphrase is required for this key".into(),
            ));
        }
        Err(_) if encrypted => {
            return Err(AppError::Invalid(
                "incorrect passphrase for this key".into(),
            ));
        }
        Err(_) => return Ok(None),
    };

    let public_key = key
        .public_key()
        .to_openssh()
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    Ok(Some(KeyInsight {
        public_key,
        encrypted,
    }))
}

pub struct GeneratedKey {
    pub private_key: String,
    pub public_key: String,
    pub fingerprint: String,
    pub algorithm: String,
}

pub fn generate(
    algorithm: KeyAlgorithm,
    passphrase: Option<&str>,
    comment: &str,
) -> AppResult<GeneratedKey> {
    let mut rng = OsRng;

    let mut key = match algorithm {
        KeyAlgorithm::Ed25519 => PrivateKey::random(&mut rng, Algorithm::Ed25519),
        KeyAlgorithm::EcdsaP256 => PrivateKey::random(
            &mut rng,
            Algorithm::Ecdsa {
                curve: EcdsaCurve::NistP256,
            },
        ),
        KeyAlgorithm::EcdsaP384 => PrivateKey::random(
            &mut rng,
            Algorithm::Ecdsa {
                curve: EcdsaCurve::NistP384,
            },
        ),
        KeyAlgorithm::EcdsaP521 => PrivateKey::random(
            &mut rng,
            Algorithm::Ecdsa {
                curve: EcdsaCurve::NistP521,
            },
        ),
        KeyAlgorithm::Rsa2048 => RsaKeypair::random(&mut rng, 2048).map(PrivateKey::from),
        KeyAlgorithm::Rsa4096 => RsaKeypair::random(&mut rng, 4096).map(PrivateKey::from),
    }
    .map_err(|e| AppError::Crypto(format!("key generation failed: {e}")))?;

    key.set_comment(comment);

    let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
    let algorithm_name = key.algorithm().to_string();
    let public_key = key
        .public_key()
        .to_openssh()
        .map_err(|e| AppError::Crypto(e.to_string()))?;

    let sealed = match passphrase.filter(|p| !p.is_empty()) {
        Some(pass) => key
            .encrypt(&mut rng, pass)
            .map_err(|e| AppError::Crypto(e.to_string()))?,
        None => key,
    };
    let private_key = sealed
        .to_openssh(LineEnding::LF)
        .map_err(|e| AppError::Crypto(e.to_string()))?
        .to_string();

    Ok(GeneratedKey {
        private_key,
        public_key,
        fingerprint,
        algorithm: algorithm_name,
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyFile {
    pub name: String,
    pub private_key: String,
    pub public_key: Option<String>,

    pub fingerprint: Option<String>,
    pub algorithm: Option<String>,
}

pub fn read_file(path: &str) -> AppResult<KeyFile> {
    let path = Path::new(path);
    let file = std::fs::File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(AppError::Invalid(
            "the selected key path is not a regular file".into(),
        ));
    }
    if metadata.len() > MAX_PRIVATE_KEY_FILE_SIZE {
        return Err(AppError::Invalid(format!(
            "private key file exceeds the {} byte limit",
            MAX_PRIVATE_KEY_FILE_SIZE
        )));
    }
    let mut private_key = String::new();
    file.take(MAX_PRIVATE_KEY_FILE_SIZE + 1)
        .read_to_string(&mut private_key)?;
    if private_key.len() as u64 > MAX_PRIVATE_KEY_FILE_SIZE {
        return Err(AppError::Invalid(format!(
            "private key file exceeds the {} byte limit",
            MAX_PRIVATE_KEY_FILE_SIZE
        )));
    }
    let private_key = private_key.trim().to_string();
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("imported-key")
        .to_string();

    let decoded = decode_secret_key(&private_key, None).ok();
    if decoded.is_none() && !is_encrypted_format(&private_key) {
        return Err(AppError::Invalid(
            "invalid or unsupported SSH private key file".into(),
        ));
    }
    let (public_key, fingerprint, algorithm) = if let Some(key) = decoded.as_ref() {
        let public = key.public_key();
        (
            public.to_openssh().ok(),
            Some(public.fingerprint(RusshHashAlg::Sha256).to_string()),
            Some(public.algorithm().to_string()),
        )
    } else if let Ok(key) = PrivateKey::from_openssh(&private_key) {
        // OpenSSH encrypted keys carry their public half in plaintext, so it
        // can still be displayed before the user supplies the passphrase.
        let public = key.public_key();
        (
            public.to_openssh().ok(),
            Some(public.fingerprint(HashAlg::Sha256).to_string()),
            Some(public.algorithm().to_string()),
        )
    } else {
        (None, None, None)
    };

    Ok(KeyFile {
        name,
        private_key,
        public_key,
        fingerprint,
        algorithm,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_and_inspects_every_algorithm() {
        for algo in [
            KeyAlgorithm::Ed25519,
            KeyAlgorithm::EcdsaP256,
            KeyAlgorithm::EcdsaP384,
            KeyAlgorithm::EcdsaP521,
            KeyAlgorithm::Rsa2048,
        ] {
            let generated = generate(algo, None, "test@sageport").expect("generate");
            assert!(generated
                .private_key
                .starts_with("-----BEGIN OPENSSH PRIVATE KEY-----"));
            assert!(generated.public_key.starts_with(&generated.algorithm));

            let insight = inspect(&generated.private_key, None)
                .expect("inspect")
                .expect("should parse a freshly generated key");
            assert_eq!(insight.public_key, generated.public_key);
        }
    }

    #[test]
    fn encrypted_key_requires_correct_passphrase() {
        let generated =
            generate(KeyAlgorithm::Ed25519, Some("hunter2"), "test@sageport").expect("generate");

        let insight = inspect(&generated.private_key, Some("hunter2"))
            .expect("inspect with correct passphrase")
            .expect("should parse");
        assert_eq!(insight.public_key, generated.public_key);

        let err = inspect(&generated.private_key, Some("wrong")).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));

        let err = inspect(&generated.private_key, None).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn unparseable_key_material_is_passed_through_without_error() {
        let result = inspect("not a real ssh key", None).expect("should not error");
        assert!(result.is_none());
    }

    #[test]
    fn read_file_derives_public_key_instead_of_trusting_sibling_file() {
        let dir = std::env::temp_dir().join(format!("sageport-keytest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let priv_path = dir.join("id_test");
        let pub_path = dir.join("id_test.pub");

        let generated = generate(KeyAlgorithm::Ed25519, None, "test@sageport").unwrap();
        std::fs::write(&priv_path, &generated.private_key).unwrap();
        std::fs::write(&pub_path, "ssh-ed25519 mismatched sibling").unwrap();

        let file = read_file(priv_path.to_str().unwrap()).unwrap();
        assert_eq!(file.name, "id_test");
        assert_eq!(
            file.public_key.as_deref(),
            Some(generated.public_key.as_str())
        );
        assert_eq!(
            file.fingerprint.as_deref(),
            Some(generated.fingerprint.as_str())
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_file_rejects_non_private_key_content() {
        let path =
            std::env::temp_dir().join(format!("sageport-invalid-keytest-{}", std::process::id()));
        std::fs::write(&path, "ssh-ed25519 not-a-private-key").unwrap();

        assert!(matches!(
            read_file(path.to_str().unwrap()),
            Err(AppError::Invalid(_))
        ));

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn read_file_accepts_encrypted_openssh_key_before_passphrase_entry() {
        let path =
            std::env::temp_dir().join(format!("sageport-encrypted-keytest-{}", std::process::id()));
        let generated = generate(KeyAlgorithm::Ed25519, Some("secret"), "encrypted-file")
            .expect("generate encrypted key");
        std::fs::write(&path, &generated.private_key).unwrap();

        let file = read_file(path.to_str().unwrap()).expect("read encrypted key");
        let key_blob = |value: &str| {
            value
                .split_whitespace()
                .take(2)
                .collect::<Vec<_>>()
                .join(" ")
        };
        assert_eq!(
            file.public_key.as_deref().map(key_blob),
            Some(key_blob(&generated.public_key))
        );

        std::fs::remove_file(path).ok();
    }
}
