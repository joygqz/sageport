//! WebDAV provider (Nextcloud, Synology, rclone serve, ...).
//!
//! The user points the config at a collection URL; backups are timestamped
//! objects directly inside it. Listing is a depth-1 PROPFIND parsed
//! namespace-agnostically (servers disagree wildly on prefixes), and the
//! collection is created with MKCOL on demand.

use async_trait::async_trait;
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::{Method, StatusCode};
use url::Url;

use crate::crypto::EncryptedEnvelope;
use crate::error::{AppError, AppResult};

use super::provider::{
    is_vault_filename, version_filename, version_time_from_name, ProviderConfig, SyncProvider,
    SyncVersion, KEEP_VERSIONS,
};

pub struct WebdavProvider {
    http: reqwest::Client,
    /// Collection URL, normalized to end with `/` so joins stay inside it.
    base: Url,
    /// Original user-supplied URL, echoed back into the config unchanged.
    raw_url: String,
    username: String,
    password: String,
}

impl WebdavProvider {
    pub fn new(url: String, username: String, password: String) -> AppResult<Self> {
        let normalized = if url.ends_with('/') {
            url.clone()
        } else {
            format!("{url}/")
        };
        let base = Url::parse(&normalized)
            .map_err(|e| AppError::Invalid(format!("invalid WebDAV URL: {e}")))?;
        if !matches!(base.scheme(), "http" | "https") {
            return Err(AppError::Invalid("WebDAV URL must be http(s)".into()));
        }
        Ok(Self {
            http: reqwest::Client::new(),
            base,
            raw_url: url,
            username,
            password,
        })
    }

    fn request(&self, method: Method, url: Url) -> reqwest::RequestBuilder {
        self.http
            .request(method, url)
            .basic_auth(&self.username, Some(&self.password))
    }

    fn file_url(&self, name: &str) -> AppResult<Url> {
        self.base
            .join(name)
            .map_err(|e| AppError::Invalid(format!("invalid backup name: {e}")))
    }

    /// Create the collection if missing. 405 (exists) and 301 are fine; some
    /// servers also want intermediate collections, which we don't attempt —
    /// the parent must exist.
    async fn ensure_collection(&self) -> AppResult<()> {
        let resp = self
            .request(Method::from_bytes(b"MKCOL").expect("valid method"), self.base.clone())
            .send()
            .await
            .map_err(net_err)?;
        match resp.status().as_u16() {
            201 | 301 | 405 => Ok(()),
            409 => Err(AppError::Invalid(
                "WebDAV parent folder does not exist — create it on the server first".into(),
            )),
            401 => Err(unauthorized()),
            s if resp.status().is_success() => {
                let _ = s;
                Ok(())
            }
            s => Err(AppError::Other(format!("WebDAV MKCOL failed (status {s})"))),
        }
    }

    /// Vault file names inside the collection, newest first.
    async fn list_names(&self) -> AppResult<Vec<String>> {
        let body = r#"<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>"#;
        let resp = self
            .request(
                Method::from_bytes(b"PROPFIND").expect("valid method"),
                self.base.clone(),
            )
            .header("Depth", "1")
            .header("Content-Type", "application/xml")
            .body(body)
            .send()
            .await
            .map_err(net_err)?;
        match resp.status().as_u16() {
            401 => return Err(unauthorized()),
            404 => return Ok(Vec::new()),
            s if !resp.status().is_success() && s != 207 => {
                return Err(AppError::Other(format!("WebDAV PROPFIND failed (status {s})")));
            }
            _ => {}
        }
        let text = resp.text().await.map_err(net_err)?;
        let mut names = parse_hrefs(&text)?
            .into_iter()
            .filter(|n| is_vault_filename(n))
            .collect::<Vec<_>>();
        names.sort_by(|a, b| b.cmp(a));
        names.dedup();
        Ok(names)
    }

    async fn download(&self, name: &str) -> AppResult<EncryptedEnvelope> {
        let resp = self
            .request(Method::GET, self.file_url(name)?)
            .send()
            .await
            .map_err(net_err)?;
        match resp.status() {
            StatusCode::UNAUTHORIZED => return Err(unauthorized()),
            StatusCode::NOT_FOUND => {
                return Err(AppError::NotFound(format!("backup {name} not found")))
            }
            s if !s.is_success() => {
                return Err(AppError::Other(format!("WebDAV download failed (status {s})")))
            }
            _ => {}
        }
        let bytes = resp.bytes().await.map_err(net_err)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    async fn upload(&self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        self.ensure_collection().await?;
        let name = version_filename();
        let resp = self
            .request(Method::PUT, self.file_url(&name)?)
            .header("Content-Type", "application/json")
            .body(serde_json::to_string_pretty(envelope)?)
            .send()
            .await
            .map_err(net_err)?;
        match resp.status() {
            StatusCode::UNAUTHORIZED => Err(unauthorized()),
            s if !s.is_success() => {
                Err(AppError::Other(format!("WebDAV upload failed (status {s})")))
            }
            _ => Ok(()),
        }
    }

    async fn delete(&self, name: &str) -> AppResult<()> {
        let resp = self
            .request(Method::DELETE, self.file_url(name)?)
            .send()
            .await
            .map_err(net_err)?;
        match resp.status() {
            StatusCode::UNAUTHORIZED => Err(unauthorized()),
            StatusCode::NOT_FOUND => Ok(()),
            s if !s.is_success() => {
                Err(AppError::Other(format!("WebDAV delete failed (status {s})")))
            }
            _ => Ok(()),
        }
    }

    async fn prune(&self) -> AppResult<()> {
        for name in self.list_names().await?.into_iter().skip(KEEP_VERSIONS) {
            self.delete(&name).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl SyncProvider for WebdavProvider {
    async fn pull_latest(&mut self) -> AppResult<Option<EncryptedEnvelope>> {
        match self.list_names().await?.first() {
            Some(name) => Ok(Some(self.download(name).await?)),
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
            .filter_map(|name| {
                Some(SyncVersion {
                    created_at: version_time_from_name(&name)?,
                    id: name,
                    size_bytes: None,
                })
            })
            .collect())
    }

    async fn pull_version(&mut self, id: &str) -> AppResult<EncryptedEnvelope> {
        self.download(id).await
    }

    async fn reset(&mut self, envelope: &EncryptedEnvelope) -> AppResult<()> {
        for name in self.list_names().await? {
            self.delete(&name).await?;
        }
        self.upload(envelope).await
    }

    fn config(&self) -> ProviderConfig {
        ProviderConfig::Webdav {
            url: self.raw_url.clone(),
            username: self.username.clone(),
            password: self.password.clone(),
        }
    }
}

/// Pull every `<*:href>` text out of a multistatus body and reduce it to a
/// percent-decoded file basename. Namespace prefixes vary by server, so we
/// match on local names only.
fn parse_hrefs(xml: &str) -> AppResult<Vec<String>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut names = Vec::new();
    let mut in_href = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.local_name().as_ref() == b"href" => in_href = true,
            Ok(Event::End(e)) if e.local_name().as_ref() == b"href" => in_href = false,
            Ok(Event::Text(t)) if in_href => {
                let href = t.unescape().map_err(xml_err)?.into_owned();
                let basename = href.trim_end_matches('/').rsplit('/').next().unwrap_or("");
                let decoded = percent_decode(basename);
                if !decoded.is_empty() {
                    names.push(decoded);
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(xml_err(e)),
            _ => {}
        }
    }
    Ok(names)
}

fn percent_decode(s: &str) -> String {
    // Our filenames are plain ASCII, but decode defensively anyway.
    let mut out = Vec::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn net_err(e: reqwest::Error) -> AppError {
    AppError::Other(format!("WebDAV request failed: {e}"))
}

fn xml_err(e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("could not parse the WebDAV server response: {e}"))
}

fn unauthorized() -> AppError {
    AppError::Invalid("WebDAV credentials were rejected".into())
}
