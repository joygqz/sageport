//! Microsoft OneDrive provider.
//!
//! Backups live in the app's own folder (`special/approot`, i.e.
//! `Apps/<app name>` in the user's OneDrive), one timestamped object per
//! push. Versions are addressed by file name — Graph supports path
//! addressing, so no id bookkeeping is needed. Access tokens refresh
//! transparently; Microsoft rotates refresh tokens, so the updated set is
//! persisted via [`SyncProvider::config`] after every operation.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;

use crate::crypto::EncryptedEnvelope;
use crate::error::{AppError, AppResult};

use super::oauth::{self, OAuthTokens};
use super::provider::{
    is_vault_filename, version_filename, version_time_from_name, ProviderConfig, SyncProvider,
    SyncVersion, KEEP_VERSIONS,
};

const APPROOT: &str = "https://graph.microsoft.com/v1.0/me/drive/special/approot";

/// Graph's simple-PUT upload cap; the vault would need thousands of hosts to
/// get anywhere near it, so exceeding it is reported instead of chunked.
const SIMPLE_UPLOAD_LIMIT: usize = 4 * 1024 * 1024;

pub struct OnedriveProvider {
    http: reqwest::Client,
    tokens: OAuthTokens,
}

#[derive(Deserialize)]
struct Children {
    #[serde(default)]
    value: Vec<DriveItem>,
    #[serde(rename = "@odata.nextLink")]
    next_link: Option<String>,
}

#[derive(Deserialize)]
struct DriveItem {
    name: String,
    #[serde(default)]
    size: Option<u64>,
}

impl OnedriveProvider {
    pub fn new(tokens: OAuthTokens) -> Self {
        Self {
            http: reqwest::Client::new(),
            tokens,
        }
    }

    async fn token(&mut self) -> AppResult<String> {
        if self.tokens.needs_refresh() {
            self.tokens = oauth::refresh_microsoft(&self.tokens).await?;
        }
        Ok(self.tokens.access_token.clone())
    }

    /// Vault file names in the app folder, newest first.
    async fn list_names(&mut self) -> AppResult<Vec<(String, Option<u64>)>> {
        let token = self.token().await?;
        let mut names: Vec<(String, Option<u64>)> = Vec::new();
        let mut url = format!("{APPROOT}/children?$select=name,size&$top=200");
        loop {
            let resp = self
                .http
                .get(&url)
                .bearer_auth(&token)
                .send()
                .await
                .map_err(net_err)?;
            let status = resp.status();
            // A brand-new app folder doesn't exist until the first upload.
            if status.as_u16() == 404 {
                return Ok(Vec::new());
            }
            let bytes = resp.bytes().await.map_err(net_err)?;
            if !status.is_success() {
                return Err(api_err("OneDrive list", status, &bytes));
            }
            let page: Children = serde_json::from_slice(&bytes)?;
            names.extend(
                page.value
                    .into_iter()
                    .filter(|item| is_vault_filename(&item.name))
                    .map(|item| (item.name, item.size)),
            );
            match page.next_link {
                Some(next) => url = next,
                None => break,
            }
        }
        names.sort_by(|a, b| b.0.cmp(&a.0));
        Ok(names)
    }

    async fn download(&mut self, name: &str) -> AppResult<EncryptedEnvelope> {
        let token = self.token().await?;
        // Graph answers with a 302 to a pre-authenticated download URL;
        // reqwest follows it (and drops the auth header cross-origin).
        let resp = self
            .http
            .get(format!("{APPROOT}:/{name}:/content"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        let bytes = resp.bytes().await.map_err(net_err)?;
        if !status.is_success() {
            return Err(api_err("OneDrive download", status, &bytes));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn upload(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        let token = self.token().await?;
        let name = version_filename();
        let content = serde_json::to_string_pretty(envelope)?;
        if content.len() > SIMPLE_UPLOAD_LIMIT {
            return Err(AppError::Invalid(
                "the vault exceeds OneDrive's 4 MB simple-upload limit".into(),
            ));
        }
        let resp = self
            .http
            .put(format!("{APPROOT}:/{name}:/content"))
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .body(content)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        if !status.is_success() {
            let bytes = resp.bytes().await.unwrap_or_default();
            return Err(api_err("OneDrive upload", status, &bytes));
        }
        Ok(())
    }

    async fn delete(&mut self, name: &str) -> AppResult<()> {
        let token = self.token().await?;
        let resp = self
            .http
            .delete(format!("{APPROOT}:/{name}:"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        let bytes = resp.bytes().await.unwrap_or_default();
        Err(api_err("OneDrive delete", status, &bytes))
    }

    async fn prune(&mut self) -> AppResult<()> {
        let names = self.list_names().await?;
        for (name, _) in names.into_iter().skip(KEEP_VERSIONS) {
            self.delete(&name).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl SyncProvider for OnedriveProvider {
    async fn pull_latest(&mut self) -> AppResult<Option<EncryptedEnvelope>> {
        match self.list_names().await?.first() {
            Some((name, _)) => Ok(Some(self.download(&name.clone()).await?)),
            None => Ok(None),
        }
    }

    async fn push(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        self.upload(envelope).await?;
        self.prune().await
    }

    async fn list_versions(&mut self) -> AppResult<Vec<SyncVersion>> {
        Ok(self
            .list_names()
            .await?
            .into_iter()
            .filter_map(|(name, size)| {
                Some(SyncVersion {
                    created_at: version_time_from_name(&name)?,
                    id: name,
                    size_bytes: size,
                })
            })
            .collect())
    }

    async fn pull_version(&mut self, id: &str) -> AppResult<EncryptedEnvelope> {
        self.download(id).await
    }

    async fn reset(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        for (name, _) in self.list_names().await? {
            self.delete(&name).await?;
        }
        self.upload(envelope).await
    }

    fn config(&self) -> ProviderConfig {
        ProviderConfig::Onedrive {
            tokens: self.tokens.clone(),
        }
    }
}

fn net_err(e: reqwest::Error) -> AppError {
    AppError::Other(format!("OneDrive request failed: {e}"))
}

fn api_err(what: &str, status: reqwest::StatusCode, bytes: &[u8]) -> AppError {
    let detail = serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| format!("status {status}"));
    match status.as_u16() {
        401 => AppError::Invalid("Microsoft authorization expired — reconnect sync".into()),
        _ => AppError::Other(format!("{what} failed: {detail}")),
    }
}
