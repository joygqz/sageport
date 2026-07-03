//! GitHub Gist transport for the encrypted vault.
//!
//! The vault is stored as a single file inside a **secret** gist. Only the
//! sealed [`EncryptedEnvelope`] (ciphertext + KDF params) ever leaves the
//! device, so GitHub never sees plaintext or the passphrase. The gist id is
//! persisted locally so subsequent pushes update the same gist in place.
//!
//! Every push is a gist edit, and GitHub keeps prior edits as revisions with
//! their own sha — [`GistClient::list_versions`] surfaces that history and
//! [`GistClient::pull_at`] fetches any one of them, which is what backs the
//! UI's "restore an older backup" flow.

use std::collections::HashMap;

use reqwest::{Client, Method, Response};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::json;

use crate::crypto::EncryptedEnvelope;
use crate::error::{AppError, AppResult};

const API: &str = "https://api.github.com";
const FILENAME: &str = "sageport-vault.json";
const DESCRIPTION: &str = "Sageport encrypted vault — managed by the app, do not edit by hand.";
const USER_AGENT: &str = "sageport";
const API_VERSION: &str = "2022-11-28";

/// Authenticated GitHub Gist client scoped to a single personal access token.
pub struct GistClient {
    http: Client,
    token: String,
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

/// One historical revision of the vault gist, as shown in the UI's version
/// list. `sha` identifies the revision and is what [`GistClient::pull_at`]
/// expects.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GistVersion {
    pub sha: String,
    pub committed_at: String,
    pub additions: i64,
    pub deletions: i64,
}

#[derive(Deserialize)]
struct CommitEntry {
    version: String,
    committed_at: String,
    #[serde(default)]
    change_status: ChangeStatus,
}

#[derive(Deserialize, Default)]
struct ChangeStatus {
    #[serde(default)]
    additions: i64,
    #[serde(default)]
    deletions: i64,
}

impl GistClient {
    pub fn new(token: impl Into<String>) -> Self {
        Self {
            http: Client::new(),
            token: token.into(),
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

    /// Create the vault gist when `gist_id` is `None`, otherwise update the
    /// existing one. Returns the gist id so the caller can persist it.
    pub async fn push(
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

        let resp = self
            .request(method, &url)
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("gist request failed: {e}")))?;

        let parsed: GistResponse = read_json(resp).await?;
        Ok(parsed.id)
    }

    /// Find the vault gist among the authenticated user's gists, so a device
    /// that only has the token (e.g. a freshly installed second device) can
    /// discover the gist created elsewhere without the user copying a gist id
    /// around by hand. Returns `None` when no vault gist exists yet.
    pub async fn find_vault_gist(&self) -> AppResult<Option<String>> {
        let mut page = 1u32;
        loop {
            let url = format!("{API}/gists?per_page=100&page={page}");
            let resp = self
                .request(Method::GET, &url)
                .send()
                .await
                .map_err(|e| AppError::Other(format!("gist request failed: {e}")))?;
            let list: Vec<GistResponse> = read_json(resp).await?;
            if let Some(found) = list.iter().find(|g| g.files.contains_key(FILENAME)) {
                return Ok(Some(found.id.clone()));
            }
            // GitHub returns full pages until the last one; stop once a page
            // comes back short (or after a sane cap, so a token with an
            // enormous number of gists can't spin this loop forever).
            if list.len() < 100 || page >= 20 {
                return Ok(None);
            }
            page += 1;
        }
    }

    /// Fetch and parse the encrypted envelope from the vault gist's current
    /// (latest) revision.
    pub async fn pull(&self, gist_id: &str) -> AppResult<EncryptedEnvelope> {
        self.fetch_envelope(&format!("{API}/gists/{gist_id}")).await
    }

    /// Fetch and parse the encrypted envelope from one specific historical
    /// revision of the vault gist (as returned by [`Self::list_versions`]).
    pub async fn pull_at(&self, gist_id: &str, sha: &str) -> AppResult<EncryptedEnvelope> {
        self.fetch_envelope(&format!("{API}/gists/{gist_id}/{sha}"))
            .await
    }

    /// Permanently delete the vault gist, including its entire revision
    /// history. GitHub has no way to remove a single revision, so this is the
    /// only way to purge stale history (e.g. revisions encrypted with an
    /// abandoned passphrase) rather than leaving it to accumulate underneath
    /// a patch. A gist that's already gone (404) is treated as success.
    pub async fn delete(&self, gist_id: &str) -> AppResult<()> {
        let url = format!("{API}/gists/{gist_id}");
        let resp = self
            .request(Method::DELETE, &url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("gist request failed: {e}")))?;

        let status = resp.status();
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| AppError::Other(format!("failed to read gist response: {e}")))?;
        let detail = serde_json::from_slice::<GistErr>(&bytes)
            .map(|e| e.message)
            .unwrap_or_else(|_| format!("GitHub API error (status {status})"));
        Err(match status.as_u16() {
            401 => AppError::Invalid("GitHub token is invalid or expired".into()),
            403 | 429 => AppError::Invalid(format!("GitHub denied the request: {detail}")),
            _ => AppError::Other(detail),
        })
    }

    /// List the vault gist's revision history, newest first. GitHub keeps at
    /// most the last ~100 revisions per gist, which is what a single page
    /// covers, so no further pagination is needed.
    pub async fn list_versions(&self, gist_id: &str) -> AppResult<Vec<GistVersion>> {
        let url = format!("{API}/gists/{gist_id}/commits?per_page=100");
        let resp = self
            .request(Method::GET, &url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("gist request failed: {e}")))?;

        let entries: Vec<CommitEntry> = read_json(resp).await?;
        let mut versions: Vec<GistVersion> = entries
            .into_iter()
            .map(|e| GistVersion {
                sha: e.version,
                committed_at: e.committed_at,
                additions: e.change_status.additions,
                deletions: e.change_status.deletions,
            })
            .collect();
        // Don't rely on the API's ordering — sort explicitly so the newest
        // revision is always first.
        versions.sort_by(|a, b| b.committed_at.cmp(&a.committed_at));
        Ok(versions)
    }

    async fn fetch_envelope(&self, url: &str) -> AppResult<EncryptedEnvelope> {
        let resp = self
            .request(Method::GET, url)
            .send()
            .await
            .map_err(|e| AppError::Other(format!("gist request failed: {e}")))?;

        let parsed: GistResponse = read_json(resp).await?;
        let file = parsed
            .files
            .get(FILENAME)
            .ok_or_else(|| AppError::NotFound(format!("gist has no {FILENAME} file")))?;

        // GitHub inlines file content up to ~1MB; beyond that it sets
        // `truncated` and we have to fetch the raw blob instead.
        let content = if file.truncated {
            let raw = file
                .raw_url
                .as_deref()
                .ok_or_else(|| AppError::Other("truncated gist without raw_url".into()))?;
            self.request(Method::GET, raw)
                .send()
                .await
                .map_err(|e| AppError::Other(format!("gist raw fetch failed: {e}")))?
                .text()
                .await
                .map_err(|e| AppError::Other(format!("gist raw read failed: {e}")))?
        } else {
            file.content.clone()
        };

        Ok(serde_json::from_str(&content)?)
    }
}

/// Read a GitHub API response body, translating common HTTP failures into
/// friendly [`AppError`]s before deserializing the success payload.
async fn read_json<T: DeserializeOwned>(resp: Response) -> AppResult<T> {
    let status = resp.status();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("failed to read gist response: {e}")))?;

    if !status.is_success() {
        let detail = serde_json::from_slice::<GistErr>(&bytes)
            .map(|e| e.message)
            .unwrap_or_else(|_| format!("GitHub API error (status {status})"));
        return Err(match status.as_u16() {
            401 => AppError::Invalid("GitHub token is invalid or expired".into()),
            403 | 429 => AppError::Invalid(format!("GitHub denied the request: {detail}")),
            404 => AppError::NotFound("vault gist not found (it may have been deleted)".into()),
            _ => AppError::Other(detail),
        });
    }

    Ok(serde_json::from_slice::<T>(&bytes)?)
}
