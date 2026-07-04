//! The transport abstraction every sync backend implements.
//!
//! A provider stores opaque [`EncryptedEnvelope`]s and keeps a linear version
//! history of them. Exactly one provider is active at a time; switching means
//! disconnecting and connecting the new one from scratch.
//!
//! Except for GitHub Gist (which rides the gist's native revision history),
//! every backend is a plain object store: it only implements [`ObjectStore`]
//! (list/get/put/delete), and the shared [`Versioned`] wrapper turns that
//! into the full [`SyncProvider`] contract — timestamped object names,
//! newest-first ordering, and pruning down to [`KEEP_VERSIONS`].

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

/// How many backup revisions the object-store providers keep before pruning
/// the oldest on push. Gist history is capped by GitHub itself.
pub const KEEP_VERSIONS: usize = 10;

const FILE_PREFIX: &str = "sageport-vault-";
const FILE_SUFFIX: &str = ".json";
const NAME_TIME_FORMAT: &str = "%Y%m%dT%H%M%S%3fZ";

/// The five supported remote backends. (Local file backup is a separate
/// one-shot export/import feature, not a connected provider.)
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

/// Full (secret-bearing) configuration of the active provider, persisted as
/// one JSON blob in the settings table. Never serialized to the frontend.
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

    /// Non-secret one-liner shown next to the account in the UI (bucket,
    /// server host, folder path, linked gist id, ...).
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

/// One historical backup revision, uniform across providers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncVersion {
    /// Provider-scoped opaque id (gist revision sha, Drive file id, object
    /// name, ...). Feed back into `pull_version`.
    pub id: String,
    /// RFC3339 creation time.
    pub created_at: String,
    pub size_bytes: Option<u64>,
}

/// A connected sync backend. All methods take `&mut self` because providers
/// mutate their own config while working (OAuth token refresh, gist id
/// discovery); callers persist [`Self::config`] after each operation.
#[async_trait]
pub trait SyncProvider: Send {
    /// The latest backup, or `None` when the target holds none yet. A stale
    /// pointer to a remote that has since been deleted must also yield
    /// `None`, not an error, so the next push can recreate it.
    async fn pull_latest(&mut self) -> AppResult<Option<EncryptedEnvelope>>;

    /// Store a new backup revision (pruning old history where applicable).
    async fn push(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()>;

    /// Backup history, newest first.
    async fn list_versions(&mut self) -> AppResult<Vec<SyncVersion>>;

    /// Fetch one specific revision from `list_versions`.
    async fn pull_version(&mut self, id: &str) -> AppResult<EncryptedEnvelope>;

    /// Destroy the entire remote history without creating a new backup. Used
    /// by force-connect so only a later explicit `sync_push` writes data.
    async fn clear(&mut self) -> AppResult<()>;

    /// Current config snapshot for persistence (may differ from the config
    /// the provider was built with — refreshed tokens, discovered ids).
    fn config(&self) -> ProviderConfig;
}

/// One backup object as an [`ObjectStore`] backend reports it.
pub struct RemoteObject {
    /// Store-scoped handle for get/delete (Drive file id, object key name...).
    pub id: String,
    /// The [`version_filename`] the object was stored under.
    pub name: String,
    pub size: Option<u64>,
}

/// Minimal contract for object-store backends (Drive, OneDrive, WebDAV, S3).
/// Implementations only move bytes; all versioning semantics live in
/// [`Versioned`].
#[async_trait]
pub trait ObjectStore: Send {
    /// Every object in the backup location, in any order; [`Versioned`]
    /// filters foreign names and sorts.
    async fn list(&mut self) -> AppResult<Vec<RemoteObject>>;
    async fn get(&mut self, id: &str) -> AppResult<Vec<u8>>;
    async fn put(&mut self, name: &str, body: String) -> AppResult<()>;
    /// Deleting an object that is already gone must succeed.
    async fn delete(&mut self, id: &str) -> AppResult<()>;
    fn config(&self) -> ProviderConfig;
}

/// Adapter turning any [`ObjectStore`] into a [`SyncProvider`]: one
/// timestamped object per push, newest-first listing by embedded timestamp,
/// history pruned to [`KEEP_VERSIONS`].
pub struct Versioned<S>(pub S);

impl<S: ObjectStore> Versioned<S> {
    /// Vault objects, newest first (names embed the creation time and sort
    /// lexicographically in chronological order).
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
        // Pretty JSON so a backup stays inspectable on the remote.
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

/// Instantiate the provider for a stored config.
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

// --- Shared timestamped-object naming ---

/// Fresh object name for a push, e.g. `sageport-vault-20260704T093000123Z.json`.
/// Millisecond precision keeps names unique and lexicographically time-ordered.
pub fn version_filename() -> String {
    format!(
        "{FILE_PREFIX}{}{FILE_SUFFIX}",
        Utc::now().format(NAME_TIME_FORMAT)
    )
}

pub fn is_vault_filename(name: &str) -> bool {
    name.starts_with(FILE_PREFIX) && name.ends_with(FILE_SUFFIX)
}

/// Recover the RFC3339 creation time embedded in a [`version_filename`].
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
        // Lexicographic name order must match chronological order.
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
