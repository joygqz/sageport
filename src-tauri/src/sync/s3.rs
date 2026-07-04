//! S3-compatible object storage provider (AWS S3, MinIO, Cloudflare R2,
//! Backblaze B2, ...).
//!
//! Requests are presigned with SigV4 via `rusty-s3` and executed with the
//! app's shared reqwest stack, so no AWS SDK is pulled in. Backups are
//! timestamped objects under an optional key prefix.

use std::time::Duration;

use async_trait::async_trait;
use rusty_s3::actions::ListObjectsV2;
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use url::Url;

use crate::crypto::EncryptedEnvelope;
use crate::error::{AppError, AppResult};

use super::provider::{
    is_vault_filename, version_filename, version_time_from_name, ProviderConfig, SyncProvider,
    SyncVersion, KEEP_VERSIONS,
};

/// Presigned URLs only need to outlive the single request they authorize.
const SIGN_TTL: Duration = Duration::from_secs(300);

pub struct S3Provider {
    http: reqwest::Client,
    bucket: Bucket,
    credentials: Credentials,
    endpoint: String,
    region: String,
    bucket_name: String,
    prefix: String,
    access_key: String,
    secret_key: String,
    path_style: bool,
}

impl S3Provider {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        endpoint: String,
        region: String,
        bucket_name: String,
        prefix: String,
        access_key: String,
        secret_key: String,
        path_style: bool,
    ) -> AppResult<Self> {
        let endpoint_url = Url::parse(&endpoint)
            .map_err(|e| AppError::Invalid(format!("invalid S3 endpoint: {e}")))?;
        let style = if path_style {
            UrlStyle::Path
        } else {
            UrlStyle::VirtualHost
        };
        let bucket = Bucket::new(endpoint_url, style, bucket_name.clone(), region.clone())
            .map_err(|e| AppError::Invalid(format!("invalid S3 bucket config: {e}")))?;
        // Normalize the prefix into "folder/" form once so keys join cleanly.
        let prefix_norm = match prefix.trim().trim_matches('/') {
            "" => String::new(),
            p => format!("{p}/"),
        };
        Ok(Self {
            http: reqwest::Client::new(),
            bucket,
            credentials: Credentials::new(access_key.clone(), secret_key.clone()),
            endpoint,
            region,
            bucket_name,
            prefix: prefix_norm,
            access_key,
            secret_key,
            path_style,
        })
    }

    fn key(&self, name: &str) -> String {
        format!("{}{name}", self.prefix)
    }

    /// Vault object names (basenames, prefix stripped), newest first.
    async fn list_names(&self) -> AppResult<Vec<(String, Option<u64>)>> {
        let mut action = self.bucket.list_objects_v2(Some(&self.credentials));
        action.query_mut().insert("prefix", self.prefix.clone());
        let url = action.sign(SIGN_TTL);
        let resp = self.http.get(url).send().await.map_err(net_err)?;
        let status = resp.status();
        let text = resp.text().await.map_err(net_err)?;
        if !status.is_success() {
            return Err(api_err("list", status, &text));
        }
        let parsed = ListObjectsV2::parse_response(&text)
            .map_err(|e| AppError::Other(format!("could not parse the S3 list response: {e}")))?;
        let mut names: Vec<(String, Option<u64>)> = parsed
            .contents
            .into_iter()
            .filter_map(|obj| {
                let name = obj.key.strip_prefix(&self.prefix)?.to_string();
                is_vault_filename(&name).then_some((name, Some(obj.size)))
            })
            .collect();
        names.sort_by(|a, b| b.0.cmp(&a.0));
        Ok(names)
    }

    async fn download(&self, name: &str) -> AppResult<EncryptedEnvelope> {
        let key = self.key(name);
        let action = self.bucket.get_object(Some(&self.credentials), &key);
        let url = action.sign(SIGN_TTL);
        let resp = self.http.get(url).send().await.map_err(net_err)?;
        let status = resp.status();
        if status.as_u16() == 404 {
            return Err(AppError::NotFound(format!("backup {name} not found")));
        }
        let bytes = resp.bytes().await.map_err(net_err)?;
        if !status.is_success() {
            return Err(api_err(
                "download",
                status,
                &String::from_utf8_lossy(&bytes),
            ));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn upload(&self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        let key = self.key(&version_filename());
        let action = self.bucket.put_object(Some(&self.credentials), &key);
        let url = action.sign(SIGN_TTL);
        let resp = self
            .http
            .put(url)
            .header("Content-Type", "application/json")
            .body(serde_json::to_string_pretty(envelope)?)
            .send()
            .await
            .map_err(net_err)?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(api_err("upload", status, &text));
        }
        Ok(())
    }

    async fn delete(&self, name: &str) -> AppResult<()> {
        let key = self.key(name);
        let action = self.bucket.delete_object(Some(&self.credentials), &key);
        let url = action.sign(SIGN_TTL);
        let resp = self.http.delete(url).send().await.map_err(net_err)?;
        let status = resp.status();
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        let text = resp.text().await.unwrap_or_default();
        Err(api_err("delete", status, &text))
    }

    async fn prune(&self) -> AppResult<()> {
        for (name, _) in self.list_names().await?.into_iter().skip(KEEP_VERSIONS) {
            self.delete(&name).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl SyncProvider for S3Provider {
    async fn pull_latest(&mut self) -> AppResult<Option<EncryptedEnvelope>> {
        match self.list_names().await?.first() {
            Some((name, _)) => Ok(Some(self.download(name).await?)),
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
        ProviderConfig::S3 {
            endpoint: self.endpoint.clone(),
            region: self.region.clone(),
            bucket: self.bucket_name.clone(),
            prefix: self.prefix.clone(),
            access_key: self.access_key.clone(),
            secret_key: self.secret_key.clone(),
            path_style: self.path_style,
        }
    }
}

fn net_err(e: reqwest::Error) -> AppError {
    AppError::Other(format!("S3 request failed: {e}"))
}

fn api_err(what: &str, status: reqwest::StatusCode, body: &str) -> AppError {
    // S3 errors are XML; surface the <Message> when present.
    let detail = body
        .split("<Message>")
        .nth(1)
        .and_then(|s| s.split("</Message>").next())
        .unwrap_or("")
        .to_string();
    let detail = if detail.is_empty() {
        format!("status {status}")
    } else {
        detail
    };
    match status.as_u16() {
        401 | 403 => AppError::Invalid(format!("S3 rejected the credentials: {detail}")),
        _ => AppError::Other(format!("S3 {what} failed: {detail}")),
    }
}
