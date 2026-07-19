use async_trait::async_trait;
use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::crypto::EncryptedEnvelope;
use crate::error::{AppError, AppResult};

use super::gdrive::GdriveStore;
use super::gist::GistProvider;
use super::oauth::OAuthTokens;
use super::onedrive::OnedriveStore;
use super::s3::S3Store;
use super::webdav::WebdavStore;

pub const KEEP_VERSIONS: usize = 10;
pub(crate) const MAX_ENVELOPE_RESPONSE_BYTES: usize = 100 * 1024 * 1024;
pub(crate) const MAX_API_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

const FILE_PREFIX: &str = "sageport-vault-";
const FILE_SUFFIX: &str = ".json";
const NAME_TIME_FORMAT: &str = "%Y%m%dT%H%M%S%3fZ";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    Gist,
    Gdrive,
    Onedrive,
    Webdav,
    S3,
}

impl ProviderKind {
    pub fn parse(s: &str) -> AppResult<Self> {
        serde_json::from_value(serde_json::Value::String(s.to_string()))
            .map_err(|_| AppError::Invalid(format!("unknown sync provider: {s}")))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ProviderConfig {
    Gist {
        token: String,
        #[serde(default)]
        gist_id: Option<String>,
    },
    Gdrive {
        tokens: OAuthTokens,
    },
    Onedrive {
        tokens: OAuthTokens,
    },
    Webdav {
        url: String,
        username: String,
        password: String,
    },
    S3 {
        endpoint: String,
        region: String,
        bucket: String,
        #[serde(default)]
        prefix: String,
        access_key: String,
        secret_key: String,
        #[serde(default)]
        path_style: bool,
    },
}

impl ProviderConfig {
    pub fn kind(&self) -> ProviderKind {
        match self {
            ProviderConfig::Gist { .. } => ProviderKind::Gist,
            ProviderConfig::Gdrive { .. } => ProviderKind::Gdrive,
            ProviderConfig::Onedrive { .. } => ProviderKind::Onedrive,
            ProviderConfig::Webdav { .. } => ProviderKind::Webdav,
            ProviderConfig::S3 { .. } => ProviderKind::S3,
        }
    }

    pub fn detail(&self) -> Option<String> {
        match self {
            ProviderConfig::Gist { gist_id, .. } => gist_id.clone(),
            ProviderConfig::Gdrive { .. } | ProviderConfig::Onedrive { .. } => None,
            ProviderConfig::Webdav { url, .. } => Some(url.clone()),
            ProviderConfig::S3 {
                bucket, endpoint, ..
            } => Some(format!("{bucket} @ {endpoint}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncVersion {
    pub id: String,

    pub created_at: String,
    pub size_bytes: Option<u64>,
}

#[async_trait]
pub trait SyncProvider: Send {
    async fn push(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()>;

    async fn list_versions(&mut self) -> AppResult<Vec<SyncVersion>>;

    async fn pull_version(&mut self, id: &str) -> AppResult<EncryptedEnvelope>;

    async fn clear(&mut self) -> AppResult<()>;

    fn config(&self) -> ProviderConfig;
}

pub struct RemoteObject {
    pub id: String,

    pub name: String,
    pub size: Option<u64>,
}

#[async_trait]
pub trait ObjectStore: Send {
    async fn list(&mut self) -> AppResult<Vec<RemoteObject>>;
    async fn get(&mut self, id: &str) -> AppResult<Vec<u8>>;
    async fn put(&mut self, name: &str, body: String) -> AppResult<()>;

    async fn delete(&mut self, id: &str) -> AppResult<()>;
    fn config(&self) -> ProviderConfig;
}

pub struct Versioned<S>(pub S);

impl<S: ObjectStore> Versioned<S> {
    async fn objects(&mut self) -> AppResult<Vec<RemoteObject>> {
        let mut objects: Vec<RemoteObject> = self
            .0
            .list()
            .await?
            .into_iter()
            .filter(|o| version_time_from_name(&o.name).is_some())
            .collect();
        objects.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(objects)
    }

    async fn fetch(&mut self, id: &str) -> AppResult<EncryptedEnvelope> {
        let bytes = self.0.get(id).await?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}

#[async_trait]
impl<S: ObjectStore> SyncProvider for Versioned<S> {
    async fn push(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        let body = serde_json::to_string_pretty(envelope)?;
        self.0.put(&version_filename(), body).await?;
        for stale in self.objects().await?.into_iter().skip(KEEP_VERSIONS) {
            self.0.delete(&stale.id).await?;
        }
        Ok(())
    }

    async fn list_versions(&mut self) -> AppResult<Vec<SyncVersion>> {
        Ok(self
            .objects()
            .await?
            .into_iter()
            .filter_map(|o| {
                Some(SyncVersion {
                    created_at: version_time_from_name(&o.name)?,
                    id: o.id,
                    size_bytes: o.size,
                })
            })
            .collect())
    }

    async fn pull_version(&mut self, id: &str) -> AppResult<EncryptedEnvelope> {
        self.fetch(id).await
    }

    async fn clear(&mut self) -> AppResult<()> {
        for object in self.objects().await? {
            self.0.delete(&object.id).await?;
        }
        Ok(())
    }

    fn config(&self) -> ProviderConfig {
        self.0.config()
    }
}

pub fn make_provider(config: ProviderConfig) -> AppResult<Box<dyn SyncProvider>> {
    Ok(match config {
        ProviderConfig::Gist { token, gist_id } => Box::new(GistProvider::new(token, gist_id)?),
        ProviderConfig::Gdrive { tokens } => Box::new(Versioned(GdriveStore::new(tokens)?)),
        ProviderConfig::Onedrive { tokens } => Box::new(Versioned(OnedriveStore::new(tokens)?)),
        ProviderConfig::Webdav {
            url,
            username,
            password,
        } => Box::new(Versioned(WebdavStore::new(url, username, password)?)),
        ProviderConfig::S3 {
            endpoint,
            region,
            bucket,
            prefix,
            access_key,
            secret_key,
            path_style,
        } => Box::new(Versioned(S3Store::new(
            endpoint, region, bucket, prefix, access_key, secret_key, path_style,
        )?)),
    })
}

pub(crate) fn http_client() -> AppResult<Client> {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| AppError::Other(format!("could not initialize sync HTTP client: {e}")))
}

pub(crate) fn request_error(context: &str, error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Timeout(format!("{context} timed out"))
    } else {
        AppError::Network(format!("{context} failed: {}", error.without_url()))
    }
}

pub(crate) async fn read_response_limited(
    mut response: Response,
    limit: usize,
    context: &str,
) -> AppResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(AppError::Invalid(format!(
            "{context} exceeds the supported size limit"
        )));
    }
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(limit as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| request_error(&format!("reading {context}"), error))?
    {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(AppError::Invalid(format!(
                "{context} exceeds the supported size limit"
            )));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn version_filename() -> String {
    format!(
        "{FILE_PREFIX}{}-{}{FILE_SUFFIX}",
        Utc::now().format(NAME_TIME_FORMAT),
        uuid::Uuid::new_v4()
    )
}

#[cfg(test)]
pub fn is_vault_filename(name: &str) -> bool {
    name.starts_with(FILE_PREFIX) && name.ends_with(FILE_SUFFIX)
}

pub fn version_time_from_name(name: &str) -> Option<String> {
    let ts = name.strip_prefix(FILE_PREFIX)?.strip_suffix(FILE_SUFFIX)?;
    let ts = match ts.split_once('-') {
        Some((timestamp, suffix)) if uuid::Uuid::parse_str(suffix).is_ok() => timestamp,
        Some(_) => return None,
        None => ts,
    };
    let naive = NaiveDateTime::parse_from_str(ts, NAME_TIME_FORMAT).ok()?;
    Some(
        DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)
            .to_rfc3339_opts(SecondsFormat::Millis, true),
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    struct MemoryStore {
        objects: Vec<RemoteObject>,
        bodies: HashMap<String, Vec<u8>>,
    }

    #[async_trait]
    impl ObjectStore for MemoryStore {
        async fn list(&mut self) -> AppResult<Vec<RemoteObject>> {
            Ok(self
                .objects
                .iter()
                .map(|value| RemoteObject {
                    id: value.id.clone(),
                    name: value.name.clone(),
                    size: value.size,
                })
                .collect())
        }

        async fn get(&mut self, id: &str) -> AppResult<Vec<u8>> {
            self.bodies
                .get(id)
                .cloned()
                .ok_or_else(|| AppError::NotFound(id.into()))
        }

        async fn put(&mut self, _name: &str, _body: String) -> AppResult<()> {
            Ok(())
        }

        async fn delete(&mut self, _id: &str) -> AppResult<()> {
            Ok(())
        }

        fn config(&self) -> ProviderConfig {
            ProviderConfig::Webdav {
                url: "https://example.com/vault".into(),
                username: String::new(),
                password: String::new(),
            }
        }
    }

    #[test]
    fn version_filename_roundtrips_through_name_parsing() {
        let name = version_filename();
        assert_ne!(name, version_filename());
        assert!(is_vault_filename(&name));
        let rfc3339 = version_time_from_name(&name).expect("name embeds a parseable timestamp");
        assert!(rfc3339.ends_with('Z'));

        let earlier = "sageport-vault-20200101T000000000Z.json";
        assert!(earlier < name.as_str());
        assert!(version_time_from_name(earlier).unwrap() < rfc3339);
    }

    #[test]
    fn foreign_names_are_ignored() {
        assert!(version_time_from_name("sageport-vault-garbage.json").is_none());
        assert!(!is_vault_filename("notes.txt"));
    }

    #[tokio::test]
    async fn malformed_vault_names_cannot_shadow_the_latest_backup() {
        let envelope = crate::crypto::encrypt(b"snapshot", "passphrase").unwrap();
        let body = serde_json::to_vec(&envelope).unwrap();
        let valid_name = "sageport-vault-20260101T000000000Z.json";
        let invalid_name = "sageport-vault-zzzz.json";
        let mut provider = Versioned(MemoryStore {
            objects: vec![
                RemoteObject {
                    id: "invalid".into(),
                    name: invalid_name.into(),
                    size: None,
                },
                RemoteObject {
                    id: "valid".into(),
                    name: valid_name.into(),
                    size: Some(body.len() as u64),
                },
            ],
            bodies: HashMap::from([("valid".into(), body)]),
        });

        assert_eq!(provider.objects().await.unwrap()[0].id, "valid");
        let versions = provider.list_versions().await.unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].id, "valid");
    }
}
