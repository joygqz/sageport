use std::time::Duration;

use async_trait::async_trait;
use rusty_s3::actions::ListObjectsV2;
use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use url::Url;

use crate::error::{AppError, AppResult};

use super::provider::{ObjectStore, ProviderConfig, RemoteObject};

const SIGN_TTL: Duration = Duration::from_secs(300);

pub struct S3Store {
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

impl S3Store {
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
}

#[async_trait]
impl ObjectStore for S3Store {
    async fn list(&mut self) -> AppResult<Vec<RemoteObject>> {
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
        Ok(parsed
            .contents
            .into_iter()
            .filter_map(|obj| {
                let name = obj.key.strip_prefix(&self.prefix)?.to_string();
                Some(RemoteObject {
                    id: name.clone(),
                    name,
                    size: Some(obj.size),
                })
            })
            .collect())
    }

    async fn get(&mut self, id: &str) -> AppResult<Vec<u8>> {
        let key = self.key(id);
        let action = self.bucket.get_object(Some(&self.credentials), &key);
        let url = action.sign(SIGN_TTL);
        let resp = self.http.get(url).send().await.map_err(net_err)?;
        let status = resp.status();
        if status.as_u16() == 404 {
            return Err(AppError::NotFound(format!("backup {id} not found")));
        }
        let bytes = resp.bytes().await.map_err(net_err)?;
        if !status.is_success() {
            return Err(api_err(
                "download",
                status,
                &String::from_utf8_lossy(&bytes),
            ));
        }
        Ok(bytes.to_vec())
    }

    async fn put(&mut self, name: &str, body: String) -> AppResult<()> {
        let key = self.key(name);
        let action = self.bucket.put_object(Some(&self.credentials), &key);
        let url = action.sign(SIGN_TTL);
        let resp = self
            .http
            .put(url)
            .header("Content-Type", "application/json")
            .body(body)
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

    async fn delete(&mut self, id: &str) -> AppResult<()> {
        let key = self.key(id);
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
