use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};

use super::oauth::{self, OAuthTokens};
use super::provider::{
    http_client, read_response_limited, request_error, ObjectStore, ProviderConfig, RemoteObject,
    MAX_API_RESPONSE_BYTES, MAX_ENVELOPE_RESPONSE_BYTES,
};

const APPROOT: &str = "https://graph.microsoft.com/v1.0/me/drive/special/approot";

const SIMPLE_UPLOAD_LIMIT: usize = 4 * 1024 * 1024;

pub struct OnedriveStore {
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

impl OnedriveStore {
    pub fn new(tokens: OAuthTokens) -> AppResult<Self> {
        Ok(Self {
            http: http_client()?,
            tokens,
        })
    }

    async fn token(&mut self) -> AppResult<String> {
        if self.tokens.needs_refresh() {
            self.tokens = oauth::refresh_microsoft(&self.tokens).await?;
        }
        Ok(self.tokens.access_token.clone())
    }
}

#[async_trait]
impl ObjectStore for OnedriveStore {
    async fn list(&mut self) -> AppResult<Vec<RemoteObject>> {
        let token = self.token().await?;
        let mut objects = Vec::new();
        let mut url = format!("{APPROOT}/children?$select=name,size&$top=200");
        for page_index in 0..100 {
            let resp = self
                .http
                .get(&url)
                .bearer_auth(&token)
                .send()
                .await
                .map_err(net_err)?;
            let status = resp.status();

            if status.as_u16() == 404 {
                return Ok(Vec::new());
            }
            let bytes =
                read_response_limited(resp, MAX_API_RESPONSE_BYTES, "OneDrive list response")
                    .await?;
            if !status.is_success() {
                return Err(api_err("OneDrive list", status, &bytes));
            }
            let page: Children = serde_json::from_slice(&bytes)?;
            objects.extend(page.value.into_iter().map(|item| RemoteObject {
                id: item.name.clone(),
                name: item.name,
                size: item.size,
            }));
            match page.next_link {
                Some(next) => {
                    let parsed = reqwest::Url::parse(&next).map_err(|_| {
                        AppError::Other("OneDrive returned an invalid pagination URL".into())
                    })?;
                    if parsed.scheme() != "https"
                        || parsed.host_str() != Some("graph.microsoft.com")
                    {
                        return Err(AppError::Other(
                            "OneDrive returned an untrusted pagination URL".into(),
                        ));
                    }
                    url = next;
                }
                None => return Ok(objects),
            }
            if page_index == 99 {
                return Err(AppError::Invalid(
                    "OneDrive backup listing exceeds the supported page limit".into(),
                ));
            }
        }
        unreachable!("page loop returns on its final iteration")
    }

    async fn get(&mut self, id: &str) -> AppResult<Vec<u8>> {
        let token = self.token().await?;

        let resp = self
            .http
            .get(format!("{APPROOT}:/{id}:/content"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        let bytes =
            read_response_limited(resp, MAX_ENVELOPE_RESPONSE_BYTES, "OneDrive backup").await?;
        if !status.is_success() {
            return Err(api_err("OneDrive download", status, &bytes));
        }
        Ok(bytes)
    }

    async fn put(&mut self, name: &str, body: String) -> AppResult<()> {
        let token = self.token().await?;
        if body.len() > SIMPLE_UPLOAD_LIMIT {
            return Err(AppError::Invalid(
                "the vault exceeds OneDrive's 4 MB simple-upload limit".into(),
            ));
        }
        let resp = self
            .http
            .put(format!("{APPROOT}:/{name}:/content"))
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        if !status.is_success() {
            let bytes =
                read_response_limited(resp, MAX_API_RESPONSE_BYTES, "OneDrive error response")
                    .await?;
            return Err(api_err("OneDrive upload", status, &bytes));
        }
        Ok(())
    }

    async fn delete(&mut self, id: &str) -> AppResult<()> {
        let token = self.token().await?;
        let resp = self
            .http
            .delete(format!("{APPROOT}:/{id}:"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        let bytes =
            read_response_limited(resp, MAX_API_RESPONSE_BYTES, "OneDrive error response").await?;
        Err(api_err("OneDrive delete", status, &bytes))
    }

    fn config(&self) -> ProviderConfig {
        ProviderConfig::Onedrive {
            tokens: self.tokens.clone(),
        }
    }
}

fn net_err(e: reqwest::Error) -> AppError {
    request_error("OneDrive request", e)
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
