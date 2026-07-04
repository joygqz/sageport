//! GitHub Gist provider.
//!
//! The vault is a single file inside a **secret** gist; GitHub's native
//! revision history doubles as the backup history, so unlike the other
//! providers there is no timestamped-object layout and nothing to prune.
//! The gist id is discovered from the account when unknown (fresh second
//! device) and cached in the provider config.

use std::collections::HashMap;

use async_trait::async_trait;
use reqwest::{Client, Method, Response};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::json;

use crate::crypto::EncryptedEnvelope;
use crate::error::{AppError, AppResult};

use super::provider::{ProviderConfig, SyncProvider, SyncVersion, KEEP_VERSIONS};

const API: &str = "https://api.github.com";
const FILENAME: &str = "sageport-vault.json";
const DESCRIPTION: &str = "Sageport encrypted vault — managed by the app, do not edit by hand.";
const USER_AGENT: &str = "sageport";
const API_VERSION: &str = "2022-11-28";

pub struct GistProvider {
    http: Client,
    token: String,
    gist_id: Option<String>,
}

#[derive(Deserialize)]
struct GistResponse {
    id: String,
    #[serde(default)]
    files: HashMap<String, GistFile>,
}

#[derive(Deserialize)]
struct GistFile {
    #[serde(default)]
    content: String,
    #[serde(default)]
    truncated: bool,
    #[serde(default)]
    raw_url: Option<String>,
}

#[derive(Deserialize)]
struct GistErr {
    message: String,
}

#[derive(Deserialize)]
struct CommitEntry {
    version: String,
    committed_at: String,
}

impl GistProvider {
    pub fn new(token: String, gist_id: Option<String>) -> Self {
        Self {
            http: Client::new(),
            token,
            gist_id,
        }
    }

    fn request(&self, method: Method, url: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", USER_AGENT)
            .header("X-GitHub-Api-Version", API_VERSION)
    }

    /// Resolve the vault gist id, discovering it from the account's gists
    /// when not cached yet. `None` when no vault gist exists.
    async fn resolve_gist_id(&mut self) -> AppResult<Option<String>> {
        if self.gist_id.is_some() {
            return Ok(self.gist_id.clone());
        }
        let mut page = 1u32;
        loop {
            let url = format!("{API}/gists?per_page=100&page={page}");
            let resp = self.send(self.request(Method::GET, &url)).await?;
            let list: Vec<GistResponse> = read_json(resp).await?;
            if let Some(found) = list.iter().find(|g| g.files.contains_key(FILENAME)) {
                self.gist_id = Some(found.id.clone());
                return Ok(self.gist_id.clone());
            }
            // Full pages until the last; a cap keeps a gist-heavy account
            // from spinning forever.
            if list.len() < 100 || page >= 20 {
                return Ok(None);
            }
            page += 1;
        }
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> AppResult<Response> {
        req.send()
            .await
            .map_err(|e| AppError::Other(format!("gist request failed: {e}")))
    }

    async fn fetch_envelope(&self, url: &str) -> AppResult<EncryptedEnvelope> {
        let resp = self.send(self.request(Method::GET, url)).await?;
        let parsed: GistResponse = read_json(resp).await?;
        let file = parsed
            .files
            .get(FILENAME)
            .ok_or_else(|| AppError::NotFound(format!("gist has no {FILENAME} file")))?;

        // GitHub inlines content up to ~1MB; beyond that fetch the raw blob.
        let content = if file.truncated {
            let raw = file
                .raw_url
                .as_deref()
                .ok_or_else(|| AppError::Other("truncated gist without raw_url".into()))?;
            self.send(self.request(Method::GET, raw))
                .await?
                .text()
                .await
                .map_err(|e| AppError::Other(format!("gist raw read failed: {e}")))?
        } else {
            file.content.clone()
        };

        Ok(serde_json::from_str(&content)?)
    }

    /// Create (id `None`) or update the vault gist; returns the gist id.
    async fn upload(
        &self,
        gist_id: Option<&str>,
        envelope: &EncryptedEnvelope,
    ) -> AppResult<String> {
        let content = serde_json::to_string_pretty(envelope)?;
        let body = json!({
            "description": DESCRIPTION,
            "public": false,
            "files": { FILENAME: { "content": content } },
        });
        let (method, url) = match gist_id {
            Some(id) => (Method::PATCH, format!("{API}/gists/{id}")),
            None => (Method::POST, format!("{API}/gists")),
        };
        let resp = self.send(self.request(method, &url).json(&body)).await?;
        let parsed: GistResponse = read_json(resp).await?;
        Ok(parsed.id)
    }

    async fn delete_gist(&self, gist_id: &str) -> AppResult<()> {
        let url = format!("{API}/gists/{gist_id}");
        let resp = self.send(self.request(Method::DELETE, &url)).await?;
        let status = resp.status();
        // Already gone is fine.
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        Err(error_from(status, &resp.bytes().await.unwrap_or_default()))
    }
}

#[async_trait]
impl SyncProvider for GistProvider {
    async fn pull_latest(&mut self) -> AppResult<Option<EncryptedEnvelope>> {
        let Some(id) = self.resolve_gist_id().await? else {
            return Ok(None);
        };
        match self.fetch_envelope(&format!("{API}/gists/{id}")).await {
            Ok(envelope) => Ok(Some(envelope)),
            // The cached id points at a deleted gist: forget it so the next
            // push recreates the vault instead of failing forever.
            Err(AppError::NotFound(_)) => {
                self.gist_id = None;
                Ok(None)
            }
            Err(err) => Err(err),
        }
    }

    async fn push(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        let gist_id = self.resolve_gist_id().await?;
        let new_id = self.upload(gist_id.as_deref(), envelope).await?;
        self.gist_id = Some(new_id);
        Ok(())
    }

    async fn list_versions(&mut self) -> AppResult<Vec<SyncVersion>> {
        let Some(id) = self.resolve_gist_id().await? else {
            return Ok(Vec::new());
        };
        // GitHub keeps at most ~100 revisions per gist — one page covers it.
        let url = format!("{API}/gists/{id}/commits?per_page=100");
        let resp = self.send(self.request(Method::GET, &url)).await?;
        let entries: Vec<CommitEntry> = read_json(resp).await?;
        let mut versions: Vec<SyncVersion> = entries
            .into_iter()
            .map(|e| SyncVersion {
                id: e.version,
                created_at: e.committed_at,
                size_bytes: None,
            })
            .collect();
        versions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        versions.truncate(KEEP_VERSIONS);
        Ok(versions)
    }

    async fn pull_version(&mut self, sha: &str) -> AppResult<EncryptedEnvelope> {
        let id = self
            .resolve_gist_id()
            .await?
            .ok_or_else(|| AppError::NotFound("no vault gist linked yet".into()))?;
        self.fetch_envelope(&format!("{API}/gists/{id}/{sha}"))
            .await
    }

    async fn reset(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        // Delete rather than patch: GitHub can't drop individual revisions,
        // so patching would leave the old, undecryptable history visible in
        // the version list forever.
        if let Some(id) = self.resolve_gist_id().await? {
            self.delete_gist(&id).await?;
        }
        let new_id = self.upload(None, envelope).await?;
        self.gist_id = Some(new_id);
        Ok(())
    }

    fn config(&self) -> ProviderConfig {
        ProviderConfig::Gist {
            token: self.token.clone(),
            gist_id: self.gist_id.clone(),
        }
    }
}

fn error_from(status: reqwest::StatusCode, bytes: &[u8]) -> AppError {
    let detail = serde_json::from_slice::<GistErr>(bytes)
        .map(|e| e.message)
        .unwrap_or_else(|_| format!("GitHub API error (status {status})"));
    match status.as_u16() {
        401 => AppError::Invalid("GitHub authorization is invalid or expired".into()),
        403 | 429 => AppError::Invalid(format!("GitHub denied the request: {detail}")),
        404 => AppError::NotFound("vault gist not found (it may have been deleted)".into()),
        _ => AppError::Other(detail),
    }
}

/// Read a GitHub API response, translating HTTP failures into friendly errors.
async fn read_json<T: DeserializeOwned>(resp: Response) -> AppResult<T> {
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("failed to read gist response: {e}")))?;
    if !status.is_success() {
        return Err(error_from(status, &bytes));
    }
    Ok(serde_json::from_slice::<T>(&bytes)?)
}
