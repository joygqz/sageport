use async_trait::async_trait;
use quick_xml::escape::resolve_predefined_entity;
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::{Method, StatusCode};
use url::Url;

use crate::error::{AppError, AppResult};

use super::provider::{
    http_client, read_response_limited, request_error, ObjectStore, ProviderConfig, RemoteObject,
    MAX_API_RESPONSE_BYTES, MAX_ENVELOPE_RESPONSE_BYTES,
};

pub struct WebdavStore {
    http: reqwest::Client,

    base: Url,

    raw_url: String,
    username: String,
    password: String,
}

impl WebdavStore {
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
        if base.host_str().is_none()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
        {
            return Err(AppError::Invalid(
                "WebDAV URL must have a host and no credentials, query, or fragment".into(),
            ));
        }
        Ok(Self {
            http: http_client()?,
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

    async fn ensure_collection(&self) -> AppResult<()> {
        let resp = self
            .request(
                Method::from_bytes(b"MKCOL").expect("valid method"),
                self.base.clone(),
            )
            .send()
            .await
            .map_err(net_err)?;
        match resp.status().as_u16() {
            201 | 301 | 405 => Ok(()),
            409 => Err(AppError::Invalid(
                "WebDAV parent folder does not exist — create it on the server first".into(),
            )),
            401 => Err(unauthorized()),
            _ if resp.status().is_success() => Ok(()),
            s => Err(AppError::Other(format!("WebDAV MKCOL failed (status {s})"))),
        }
    }
}

#[async_trait]
impl ObjectStore for WebdavStore {
    async fn list(&mut self) -> AppResult<Vec<RemoteObject>> {
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
                return Err(AppError::Other(format!(
                    "WebDAV PROPFIND failed (status {s})"
                )));
            }
            _ => {}
        }
        let text = String::from_utf8(
            read_response_limited(resp, MAX_API_RESPONSE_BYTES, "WebDAV list response").await?,
        )
        .map_err(|_| AppError::Other("WebDAV list response is not UTF-8".into()))?;
        let mut names = parse_hrefs(&text)?;
        names.sort_unstable();
        names.dedup();
        Ok(names
            .into_iter()
            .map(|name| RemoteObject {
                id: name.clone(),
                name,
                size: None,
            })
            .collect())
    }

    async fn get(&mut self, id: &str) -> AppResult<Vec<u8>> {
        let resp = self
            .request(Method::GET, self.file_url(id)?)
            .send()
            .await
            .map_err(net_err)?;
        match resp.status() {
            StatusCode::UNAUTHORIZED => return Err(unauthorized()),
            StatusCode::NOT_FOUND => {
                return Err(AppError::NotFound(format!("backup {id} not found")))
            }
            s if !s.is_success() => {
                return Err(AppError::Other(format!(
                    "WebDAV download failed (status {s})"
                )))
            }
            _ => {}
        }
        read_response_limited(resp, MAX_ENVELOPE_RESPONSE_BYTES, "WebDAV backup").await
    }

    async fn put(&mut self, name: &str, body: String) -> AppResult<()> {
        self.ensure_collection().await?;
        let resp = self
            .request(Method::PUT, self.file_url(name)?)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await
            .map_err(net_err)?;
        match resp.status() {
            StatusCode::UNAUTHORIZED => Err(unauthorized()),
            s if !s.is_success() => Err(AppError::Other(format!(
                "WebDAV upload failed (status {s})"
            ))),
            _ => Ok(()),
        }
    }

    async fn delete(&mut self, id: &str) -> AppResult<()> {
        let resp = self
            .request(Method::DELETE, self.file_url(id)?)
            .send()
            .await
            .map_err(net_err)?;
        match resp.status() {
            StatusCode::UNAUTHORIZED => Err(unauthorized()),
            StatusCode::NOT_FOUND => Ok(()),
            s if !s.is_success() => Err(AppError::Other(format!(
                "WebDAV delete failed (status {s})"
            ))),
            _ => Ok(()),
        }
    }

    fn config(&self) -> ProviderConfig {
        ProviderConfig::Webdav {
            url: self.raw_url.clone(),
            username: self.username.clone(),
            password: self.password.clone(),
        }
    }
}

fn parse_hrefs(xml: &str) -> AppResult<Vec<String>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut names = Vec::new();
    let mut href: Option<String> = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.local_name().as_ref() == b"href" => {
                href = Some(String::new());
            }
            Ok(Event::End(e)) if e.local_name().as_ref() == b"href" => {
                if let Some(href) = href.take() {
                    let basename = href.trim_end_matches('/').rsplit('/').next().unwrap_or("");
                    let decoded = percent_decode(basename);
                    if !decoded.is_empty() {
                        names.push(decoded);
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(href) = href.as_mut() {
                    href.push_str(&t.decode().map_err(xml_err)?);
                }
            }
            Ok(Event::GeneralRef(r)) => {
                if let Some(href) = href.as_mut() {
                    if let Some(ch) = r.resolve_char_ref().map_err(xml_err)? {
                        href.push(ch);
                    } else {
                        let name = r.decode().map_err(xml_err)?;
                        let resolved = resolve_predefined_entity(&name)
                            .ok_or_else(|| xml_err(format!("unknown entity &{name};")))?;
                        href.push_str(resolved);
                    }
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
    request_error("WebDAV request", e)
}

fn xml_err(e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("could not parse the WebDAV server response: {e}"))
}

fn unauthorized() -> AppError {
    AppError::Invalid("WebDAV credentials were rejected".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_urls_that_can_hide_or_leak_credentials() {
        assert!(WebdavStore::new(
            "https://user:secret@example.com/vault".into(),
            String::new(),
            String::new()
        )
        .is_err());
        assert!(
            WebdavStore::new("file:///tmp/vault".into(), String::new(), String::new()).is_err()
        );
        assert!(WebdavStore::new(
            "https://example.com/vault?token=secret".into(),
            String::new(),
            String::new()
        )
        .is_err());
    }

    #[test]
    fn decodes_webdav_hrefs_without_treating_collections_as_vaults() {
        let xml = r#"<d:multistatus xmlns:d="DAV:"><d:response><d:href>/vault/</d:href></d:response><d:response><d:href>/vault/sageport-vault-20260101T000000000Z.json</d:href></d:response></d:multistatus>"#;
        let names = parse_hrefs(xml).unwrap();
        assert!(names.contains(&"vault".to_string()));
        assert!(names.contains(&"sageport-vault-20260101T000000000Z.json".to_string()));
    }
}
