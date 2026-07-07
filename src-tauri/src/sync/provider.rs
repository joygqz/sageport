use async_trait::async_trait;
use chrono::{DateTime, NaiveDateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::crypto::EncryptedEnvelope;
use crate::error::{AppError, AppResult};

use super::gdrive::GdriveStore;
use super::gist::GistProvider;
use super::oauth::OAuthTokens;
use super::onedrive::OnedriveStore;
use super::s3::S3Store;
use super::webdav::WebdavStore;

pub const KEEP_VERSIONS: usize = 10;

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
    async fn pull_latest(&mut self) -> AppResult<Option<EncryptedEnvelope>>;

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
            .filter(|o| is_vault_filename(&o.name))
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
    async fn pull_latest(&mut self) -> AppResult<Option<EncryptedEnvelope>> {
        match self.objects().await?.first() {
            Some(latest) => Ok(Some(self.fetch(&latest.id.clone()).await?)),
            None => Ok(None),
        }
    }

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
        ProviderConfig::Gist { token, gist_id } => Box::new(GistProvider::new(token, gist_id)),
        ProviderConfig::Gdrive { tokens } => Box::new(Versioned(GdriveStore::new(tokens))),
        ProviderConfig::Onedrive { tokens } => Box::new(Versioned(OnedriveStore::new(tokens))),
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

pub fn version_filename() -> String {
    format!(
        "{FILE_PREFIX}{}{FILE_SUFFIX}",
        Utc::now().format(NAME_TIME_FORMAT)
    )
}

pub fn is_vault_filename(name: &str) -> bool {
    name.starts_with(FILE_PREFIX) && name.ends_with(FILE_SUFFIX)
}

pub fn version_time_from_name(name: &str) -> Option<String> {
    let ts = name.strip_prefix(FILE_PREFIX)?.strip_suffix(FILE_SUFFIX)?;
    let naive = NaiveDateTime::parse_from_str(ts, NAME_TIME_FORMAT).ok()?;
    Some(
        DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)
            .to_rfc3339_opts(SecondsFormat::Millis, true),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_filename_roundtrips_through_name_parsing() {
        let name = version_filename();
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
}
