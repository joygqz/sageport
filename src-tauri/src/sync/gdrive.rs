use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};

use super::oauth::{self, OAuthTokens};
use super::provider::{
    http_client, read_response_limited, request_error, ObjectStore, ProviderConfig, RemoteObject,
    MAX_API_RESPONSE_BYTES, MAX_ENVELOPE_RESPONSE_BYTES,
};

const FILES_API: &str = "https://www.googleapis.com/drive/v3/files";
const UPLOAD_API: &str = "https://www.googleapis.com/upload/drive/v3/files";

pub struct GdriveStore {
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

#[derive(Deserialize)]
struct DriveFile {
    id: String,
    name: String,
    #[serde(default)]
    size: Option<String>,
}

impl GdriveStore {
    pub fn new(tokens: OAuthTokens) -> AppResult<Self> {
        Ok(Self {
            http: http_client()?,
            tokens,
        })
    }

    async fn token(&mut self) -> AppResult<String> {
        if self.tokens.needs_refresh() {
            self.tokens = oauth::refresh_google(&self.tokens).await?;
        }
        Ok(self.tokens.access_token.clone())
    }
}

#[async_trait]
impl ObjectStore for GdriveStore {
    async fn list(&mut self) -> AppResult<Vec<RemoteObject>> {
        let token = self.token().await?;
        let mut objects = Vec::new();
        let mut page_token: Option<String> = None;
        for page_index in 0..100 {
            let mut req = self.http.get(FILES_API).bearer_auth(&token).query(&[
                ("spaces", "appDataFolder"),
                ("fields", "nextPageToken,files(id,name,size)"),
                ("pageSize", "1000"),
            ]);
            if let Some(t) = &page_token {
                req = req.query(&[("pageToken", t.as_str())]);
            }
            let body = send_json(req).await?;
            let page: FileList = serde_json::from_value(body)?;
            objects.extend(page.files.into_iter().map(|f| RemoteObject {
                id: f.id,
                name: f.name,
                size: f.size.and_then(|s| s.parse().ok()),
            }));
            match page.next_page_token {
                Some(t) if page_token.as_deref() != Some(t.as_str()) => page_token = Some(t),
                Some(_) => {
                    return Err(AppError::Other(
                        "Google Drive returned a repeated page token".into(),
                    ))
                }
                None => return Ok(objects),
            }
            if page_index == 99 {
                return Err(AppError::Invalid(
                    "Google Drive backup listing exceeds the supported page limit".into(),
                ));
            }
        }
        unreachable!("page loop returns on its final iteration")
    }

    async fn get(&mut self, id: &str) -> AppResult<Vec<u8>> {
        let token = self.token().await?;
        let resp = self
            .http
            .get(format!("{FILES_API}/{id}"))
            .bearer_auth(&token)
            .query(&[("alt", "media")])
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        let bytes =
            read_response_limited(resp, MAX_ENVELOPE_RESPONSE_BYTES, "Google Drive backup").await?;
        if !status.is_success() {
            return Err(api_err("Google Drive download", status, &bytes));
        }
        Ok(bytes)
    }

    async fn put(&mut self, name: &str, body: String) -> AppResult<()> {
        let token = self.token().await?;

        let boundary = "sageport-vault-upload";
        let metadata = serde_json::to_string(
            &serde_json::json!({ "name": name, "parents": ["appDataFolder"] }),
        )?;
        let payload = format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata}\r\n\
             --{boundary}\r\nContent-Type: application/json\r\n\r\n{body}\r\n--{boundary}--"
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
            .body(payload);
        send_json(req).await?;
        Ok(())
    }

    async fn delete(&mut self, id: &str) -> AppResult<()> {
        let token = self.token().await?;
        let resp = self
            .http
            .delete(format!("{FILES_API}/{id}"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        let bytes =
            read_response_limited(resp, MAX_API_RESPONSE_BYTES, "Google Drive error response")
                .await?;
        Err(api_err("Google Drive delete", status, &bytes))
    }

    fn config(&self) -> ProviderConfig {
        ProviderConfig::Gdrive {
            tokens: self.tokens.clone(),
        }
    }
}

fn net_err(e: reqwest::Error) -> AppError {
    request_error("Google Drive request", e)
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
    let bytes =
        read_response_limited(resp, MAX_API_RESPONSE_BYTES, "Google Drive response").await?;
    if !status.is_success() {
        return Err(api_err("Google Drive request", status, &bytes));
    }
    Ok(serde_json::from_slice(&bytes)?)
}
