use std::path::Path;

use rand::rngs::OsRng;
use serde::Serialize;
use ssh_key::private::RsaKeypair;
use ssh_key::{Algorithm, EcdsaCurve, HashAlg, LineEnding, PrivateKey};

use crate::domain::KeyAlgorithm;
use crate::error::{AppError, AppResult};

#[derive(Debug)]
pub struct KeyInsight {
    pub public_key: String,
}

pub fn inspect(private_key: &str, passphrase: Option<&str>) -> AppResult<Option<KeyInsight>> {
    let key = match PrivateKey::from_openssh(private_key.trim()) {
        Ok(key) => key,
        Err(_) => return Ok(None),
    };

    let key = if key.is_encrypted() {
        match passphrase.filter(|p| !p.is_empty()) {
            Some(pass) => key
                .decrypt(pass)
                .map_err(|_| AppError::Invalid("incorrect passphrase for this key".into()))?,
            None => key,
        }
    } else {
        key
    };

    let public_key = key
        .public_key()
        .to_openssh()
        .map_err(|e| AppError::Crypto(e.to_string()))?;
    Ok(Some(KeyInsight { public_key }))
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
    let private_key = std::fs::read_to_string(path)?.trim().to_string();
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("imported-key")
        .to_string();

    let pub_path = path.with_file_name(format!("{name}.pub"));
    let mut public_key = std::fs::read_to_string(&pub_path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let mut fingerprint = None;
    let mut algorithm = None;
    if let Ok(key) = PrivateKey::from_openssh(&private_key) {
        let public = key.public_key();
        if public_key.is_none() {
            public_key = public.to_openssh().ok();
        }
        fingerprint = Some(public.fingerprint(HashAlg::Sha256).to_string());
        algorithm = Some(key.algorithm().to_string());
    }

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

        let insight = inspect(&generated.private_key, None)
            .expect("inspect without passphrase")
            .expect("should still parse the public part");
        let key_blob = |s: &str| s.split(' ').take(2).collect::<Vec<_>>().join(" ");
        assert_eq!(
            key_blob(&insight.public_key),
            key_blob(&generated.public_key)
        );
        assert!(!insight.public_key.contains("test@sageport"));
    }

    #[test]
    fn unparseable_key_material_is_passed_through_without_error() {
        let result = inspect("not a real ssh key", None).expect("should not error");
        assert!(result.is_none());
    }

    #[test]
    fn read_file_picks_up_sibling_pub_file() {
        let dir = std::env::temp_dir().join(format!("sageport-keytest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let priv_path = dir.join("id_test");
        let pub_path = dir.join("id_test.pub");

        let generated = generate(KeyAlgorithm::Ed25519, None, "test@sageport").unwrap();
        std::fs::write(&priv_path, &generated.private_key).unwrap();
        std::fs::write(&pub_path, &generated.public_key).unwrap();

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
}
