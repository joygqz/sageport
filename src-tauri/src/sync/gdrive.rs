//! Google Drive provider.
//!
//! Backups live in the app-scoped `appDataFolder` (hidden from the user's
//! normal Drive view, only reachable with the `drive.appdata` scope), one
//! timestamped object per push. Access tokens are refreshed transparently;
//! the updated token set surfaces through [`SyncProvider::config`].

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

const FILES_API: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3/files";

pub struct GdriveProvider {
    http: reqwest::Client,
    tokens: OAuthTokens,
}

#[derive(Deserialize)]
struct FileList {
    #[serde(default)]
    files: Vec<DriveFile>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Deserialize, Clone)]
struct DriveFile {
    id: String,
    name: String,
    #[serde(default)]
    size: Option<String>,
}

impl GdriveProvider {
    pub fn new(tokens: OAuthTokens) -> Self {
        Self {
            http: reqwest::Client::new(),
            tokens,
        }
    }

    async fn token(&mut self) -> AppResult<String> {
        if self.tokens.needs_refresh() {
            self.tokens = oauth::refresh_google(&self.tokens).await?;
        }
        Ok(self.tokens.access_token.clone())
    }

    /// All vault objects in `appDataFolder`, newest first (by embedded
    /// timestamp — Drive file ids are opaque, so names carry the ordering).
    async fn list_files(&mut self) -> AppResult<Vec<DriveFile>> {
        let token = self.token().await?;
        let mut files: Vec<DriveFile> = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut req = self
                .http
                .get(FILES_API)
                .bearer_auth(&token)
                .query(&[
                    ("spaces", "appDataFolder"),
                    ("fields", "nextPageToken,files(id,name,size)"),
                    ("pageSize", "1000"),
                ]);
            if let Some(t) = &page_token {
                req = req.query(&[("pageToken", t.as_str())]);
            }
            let body = send_json(req).await?;
            let page: FileList = serde_json::from_value(body)?;
            files.extend(page.files.into_iter().filter(|f| is_vault_filename(&f.name)));
            match page.next_page_token {
                Some(t) => page_token = Some(t),
                None => break,
            }
        }
        files.sort_by(|a, b| b.name.cmp(&a.name));
        Ok(files)
    }

    async fn download(&mut self, file_id: &str) -> AppResult<EncryptedEnvelope> {
        let token = self.token().await?;
        let resp = self
            .http
            .get(format!("{FILES_API}/{file_id}"))
            .bearer_auth(&token)
            .query(&[("alt", "media")])
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        let bytes = resp.bytes().await.map_err(net_err)?;
        if !status.is_success() {
            return Err(api_err("Google Drive download", status, &bytes));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn upload(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        let token = self.token().await?;
        let name = version_filename();
        // Drive's multipart upload is `multipart/related` (metadata part +
        // content part), which reqwest's form-data helper can't produce —
        // build the body by hand.
        let boundary = "sageport-vault-upload";
        let metadata =
            serde_json::to_string(&serde_json::json!({ "name": name, "parents": ["appDataFolder"] }))?;
        let content = serde_json::to_string_pretty(envelope)?;
        let body = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n\
             --{boundary}\r\nContent-Type: application/json\r\n\r\n{content}\r\n--{boundary}--"
        );
        let req = self
            .http
            .post(UPLOAD_API)
            .bearer_auth(&token)
            .query(&[("uploadType", "multipart"), ("fields", "id")])
            .header(
                "Content-Type",
                format!("multipart/related; boundary={boundary}"),
            )
            .body(body);
        send_json(req).await?;
        Ok(())
    }

    async fn delete(&mut self, file_id: &str) -> AppResult<()> {
        let token = self.token().await?;
        let resp = self
            .http
            .delete(format!("{FILES_API}/{file_id}"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        let bytes = resp.bytes().await.unwrap_or_default();
        Err(api_err("Google Drive delete", status, &bytes))
    }

    async fn prune(&mut self) -> AppResult<()> {
        let files = self.list_files().await?;
        for file in files.into_iter().skip(KEEP_VERSIONS) {
            self.delete(&file.id).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl SyncProvider for GdriveProvider {
    async fn pull_latest(&mut self) -> AppResult<Option<EncryptedEnvelope>> {
        match self.list_files().await?.first() {
            Some(latest) => Ok(Some(self.download(&latest.id.clone()).await?)),
            None => Ok(None),
        }
    }

    async fn push(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        self.upload(envelope).await?;
        self.prune().await
    }

    async fn list_versions(&mut self) -> AppResult<Vec<SyncVersion>> {
        Ok(self
            .list_files()
            .await?
            .into_iter()
            .filter_map(|f| {
                Some(SyncVersion {
                    created_at: version_time_from_name(&f.name)?,
                    id: f.id,
                    size_bytes: f.size.and_then(|s| s.parse().ok()),
                })
            })
            .collect())
    }

    async fn pull_version(&mut self, id: &str) -> AppResult<EncryptedEnvelope> {
        self.download(id).await
    }

    async fn reset(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        for file in self.list_files().await? {
            self.delete(&file.id).await?;
        }
        self.upload(envelope).await
    }

    fn config(&self) -> ProviderConfig {
        ProviderConfig::Gdrive {
            tokens: self.tokens.clone(),
        }
    }
}

fn net_err(e: reqwest::Error) -> AppError {
    AppError::Other(format!("Google Drive request failed: {e}"))
}

fn api_err(what: &str, status: reqwest::StatusCode, bytes: &[u8]) -> AppError {
    let detail = serde_json::from_slice::<Value>(bytes)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| format!("status {status}"));
    match status.as_u16() {
        401 => AppError::Invalid("Google authorization expired — reconnect sync".into()),
        _ => AppError::Other(format!("{what} failed: {detail}")),
    }
}

async fn send_json(req: reqwest::RequestBuilder) -> AppResult<Value> {
    let resp = req.send().await.map_err(net_err)?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(net_err)?;
    if !status.is_success() {
        return Err(api_err("Google Drive request", status, &bytes));
    }
    Ok(serde_json::from_slice(&bytes)?)
}
