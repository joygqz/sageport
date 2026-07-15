use std::collections::HashMap;

use async_trait::async_trait;
use reqwest::{Client, Method, Response};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::json;

use crate::crypto::EncryptedEnvelope;
use crate::error::{AppError, AppResult};

use super::provider::{
    http_client, read_response_limited, request_error, ProviderConfig, SyncProvider, SyncVersion,
    KEEP_VERSIONS, MAX_API_RESPONSE_BYTES, MAX_ENVELOPE_RESPONSE_BYTES,
};

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
    description: String,
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
    pub fn new(token: String, gist_id: Option<String>) -> AppResult<Self> {
        Ok(Self {
            http: http_client()?,
            token,
            gist_id,
        })
    }

    fn request(&self, method: Method, url: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, url)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", USER_AGENT)
            .header("X-GitHub-Api-Version", API_VERSION)
    }

    async fn resolve_gist_id(&mut self) -> AppResult<Option<String>> {
        if self.gist_id.is_some() {
            return Ok(self.gist_id.clone());
        }
        let mut page = 1u32;
        loop {
            let url = format!("{API}/gists?per_page=100&page={page}");
            let resp = self.send(self.request(Method::GET, &url)).await?;
            let list: Vec<GistResponse> = read_json(resp).await?;
            if let Some(found) = list
                .iter()
                .find(|g| g.description == DESCRIPTION && g.files.contains_key(FILENAME))
            {
                self.gist_id = Some(found.id.clone());
                return Ok(self.gist_id.clone());
            }

            if list.len() < 100 || page >= 20 {
                return Ok(None);
            }
            page += 1;
        }
    }

    async fn send(&self, req: reqwest::RequestBuilder) -> AppResult<Response> {
        req.send()
            .await
            .map_err(|e| request_error("gist request", e))
    }

    async fn fetch_envelope(&self, url: &str) -> AppResult<EncryptedEnvelope> {
        let resp = self.send(self.request(Method::GET, url)).await?;
        let parsed: GistResponse = read_json(resp).await?;
        let file = parsed
            .files
            .get(FILENAME)
            .ok_or_else(|| AppError::NotFound(format!("gist has no {FILENAME} file")))?;

        let content = if file.truncated {
            let raw = file
                .raw_url
                .as_deref()
                .ok_or_else(|| AppError::Other("truncated gist without raw_url".into()))?;
            let raw = trusted_raw_url(raw)?;
            let response = self.send(self.http.get(raw)).await?;
            let status = response.status();
            let bytes =
                read_response_limited(response, MAX_ENVELOPE_RESPONSE_BYTES, "gist backup").await?;
            if !status.is_success() {
                return Err(error_from(status, &bytes));
            }
            String::from_utf8(bytes).map_err(|_| {
                AppError::Serde(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "gist backup is not UTF-8",
                )))
            })?
        } else {
            file.content.clone()
        };

        Ok(serde_json::from_str(&content)?)
    }

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

        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        let bytes = read_response_limited(resp, MAX_API_RESPONSE_BYTES, "gist response").await?;
        Err(error_from(status, &bytes))
    }
}

#[async_trait]
impl SyncProvider for GistProvider {
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

    async fn clear(&mut self) -> AppResult<()> {
        if let Some(id) = self.resolve_gist_id().await? {
            self.delete_gist(&id).await?;
        }
        self.gist_id = None;
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

async fn read_json<T: DeserializeOwned>(resp: Response) -> AppResult<T> {
    let status = resp.status();
    let bytes = read_response_limited(resp, MAX_API_RESPONSE_BYTES, "gist response").await?;
    if !status.is_success() {
        return Err(error_from(status, &bytes));
    }
    Ok(serde_json::from_slice::<T>(&bytes)?)
}

fn trusted_raw_url(raw: &str) -> AppResult<url::Url> {
    let url = url::Url::parse(raw)
        .map_err(|e| AppError::Invalid(format!("invalid gist raw URL: {e}")))?;
    if url.scheme() != "https"
        || url.host_str() != Some("gist.githubusercontent.com")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(AppError::Invalid("untrusted gist raw URL".into()));
    }
    Ok(url)
}
