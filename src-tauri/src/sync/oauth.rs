//! OAuth flows for the cloud sync providers — no manual token entry.
//!
//! * GitHub — device flow: the app shows a short user code, the user enters
//!   it at github.com/login/device, and we poll for the grant. Needs only a
//!   public client id (device flow enabled on the OAuth app), no secret.
//! * Google / Microsoft — authorization-code flow for installed apps: we
//!   bind a loopback listener, open the system browser, and catch the
//!   redirect. PKCE (S256) protects the exchange; no confidential secret is
//!   involved (Google issues a "desktop app" client secret but explicitly
//!   documents it as non-confidential).
//!
//! Client ids are baked in at build time from `SAGEPORT_*` env vars — see
//! `docs/sync-oauth-setup.md` for how to register the three apps. A provider
//! whose id is missing is reported as unavailable to the UI instead of
//! failing at runtime.

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

use crate::error::{AppError, AppResult};

pub const GITHUB_CLIENT_ID: Option<&str> = option_env!("SAGEPORT_GITHUB_CLIENT_ID");
pub const GOOGLE_CLIENT_ID: Option<&str> = option_env!("SAGEPORT_GOOGLE_CLIENT_ID");
/// Google "desktop app" clients are issued a secret that is not treated as
/// confidential, but the token endpoint still requires it.
pub const GOOGLE_CLIENT_SECRET: Option<&str> = option_env!("SAGEPORT_GOOGLE_CLIENT_SECRET");
pub const MS_CLIENT_ID: Option<&str> = option_env!("SAGEPORT_MS_CLIENT_ID");

const GITHUB_SCOPE: &str = "gist";
const GOOGLE_SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata openid email";
const MS_SCOPE: &str = "Files.ReadWrite.AppFolder offline_access User.Read";

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const MS_AUTH_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL: &str = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/// How long we wait for the user to finish in the browser.
const LOOPBACK_TIMEOUT: Duration = Duration::from_secs(300);

/// Refresh when the access token has less than this much life left.
const REFRESH_LEEWAY_SECS: i64 = 60;

/// Refreshable OAuth token set stored inside the provider config.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// RFC3339 expiry of `access_token`.
    pub expires_at: String,
}

impl OAuthTokens {
    fn from_grant(access_token: String, refresh_token: String, expires_in: i64) -> Self {
        Self {
            access_token,
            refresh_token,
            expires_at: (chrono::Utc::now() + chrono::Duration::seconds(expires_in)).to_rfc3339(),
        }
    }

    pub fn needs_refresh(&self) -> bool {
        chrono::DateTime::parse_from_rfc3339(&self.expires_at)
            .map(|t| (t.with_timezone(&chrono::Utc) - chrono::Utc::now()).num_seconds() < REFRESH_LEEWAY_SECS)
            .unwrap_or(true)
    }
}

/// Progress events streamed to the UI while a flow is in flight.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum OAuthEvent {
    /// GitHub device flow: show this code and link to the user.
    DeviceCode {
        user_code: String,
        verification_uri: String,
    },
    /// Loopback flow: the browser has been opened, waiting for the redirect.
    Browser,
}

/// What a completed flow hands back: enough to build a provider config plus
/// a human-readable account label for the UI.
#[derive(Debug, Clone)]
pub struct OAuthOutcome {
    pub credential: OAuthCredential,
    pub account: String,
}

#[derive(Debug, Clone)]
pub enum OAuthCredential {
    /// GitHub device-flow tokens don't expire and need no refresh.
    GithubToken(String),
    Tokens(OAuthTokens),
}

fn require(id: Option<&'static str>, provider: &str, var: &str) -> AppResult<&'static str> {
    id.filter(|v| !v.is_empty()).ok_or_else(|| {
        AppError::Invalid(format!(
            "{provider} OAuth is not configured in this build (set {var} at compile time — see docs/sync-oauth-setup.md)"
        ))
    })
}

fn http() -> reqwest::Client {
    reqwest::Client::new()
}

async fn post_form_json(url: &str, form: &[(&str, &str)]) -> AppResult<Value> {
    let resp = http()
        .post(url)
        .header("Accept", "application/json")
        .form(form)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("oauth request failed: {e}")))?;
    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Other(format!("oauth response unreadable: {e}")))?;
    if !status.is_success() {
        let detail = body["error_description"]
            .as_str()
            .or(body["error"].as_str())
            .unwrap_or("unknown error");
        return Err(AppError::Other(format!("oauth token request failed: {detail}")));
    }
    Ok(body)
}

// --- GitHub device flow ---

pub async fn github_device_flow(
    on_event: &tauri::ipc::Channel<OAuthEvent>,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
) -> AppResult<OAuthOutcome> {
    let client_id = require(GITHUB_CLIENT_ID, "GitHub", "SAGEPORT_GITHUB_CLIENT_ID")?;

    let init = post_form_json(
        "https://github.com/login/device/code",
        &[("client_id", client_id), ("scope", GITHUB_SCOPE)],
    )
    .await?;
    let device_code = json_str(&init, "device_code")?;
    let user_code = json_str(&init, "user_code")?;
    let verification_uri = json_str(&init, "verification_uri")?;
    let expires_in = init["expires_in"].as_i64().unwrap_or(900);
    let mut interval = init["interval"].as_i64().unwrap_or(5).max(1) as u64;

    on_event
        .send(OAuthEvent::DeviceCode {
            user_code,
            verification_uri,
        })
        .ok();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(expires_in as u64);
    loop {
        tokio::select! {
            _ = &mut cancel => return Err(AppError::Cancelled),
            _ = tokio::time::sleep(Duration::from_secs(interval)) => {}
        }
        if tokio::time::Instant::now() > deadline {
            return Err(AppError::Invalid("the device code expired — try again".into()));
        }

        let resp = post_form_json(
            "https://github.com/login/oauth/access_token",
            &[
                ("client_id", client_id),
                ("device_code", &device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ],
        )
        .await?;

        match resp["error"].as_str() {
            Some("authorization_pending") => continue,
            Some("slow_down") => {
                interval += 5;
                continue;
            }
            Some("expired_token") => {
                return Err(AppError::Invalid("the device code expired — try again".into()))
            }
            Some("access_denied") => {
                return Err(AppError::Invalid("authorization was denied on GitHub".into()))
            }
            Some(other) => return Err(AppError::Other(format!("GitHub OAuth failed: {other}"))),
            None => {
                let token = json_str(&resp, "access_token")?;
                let account = github_login(&token).await.unwrap_or_else(|_| "GitHub".into());
                return Ok(OAuthOutcome {
                    credential: OAuthCredential::GithubToken(token),
                    account,
                });
            }
        }
    }
}

async fn github_login(token: &str) -> AppResult<String> {
    let body: Value = http()
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "sageport")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
        .json()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    json_str(&body, "login")
}

// --- Loopback authorization-code flow (Google & Microsoft) ---

struct Pkce {
    verifier: String,
    challenge: String,
}

fn pkce() -> Pkce {
    let mut raw = [0u8; 48];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    let verifier = URL_SAFE_NO_PAD.encode(raw);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Pkce { verifier, challenge }
}

fn random_state() -> String {
    let mut raw = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    URL_SAFE_NO_PAD.encode(raw)
}

pub async fn google_flow(
    app: &tauri::AppHandle,
    on_event: &tauri::ipc::Channel<OAuthEvent>,
    cancel: tokio::sync::oneshot::Receiver<()>,
) -> AppResult<OAuthOutcome> {
    let client_id = require(GOOGLE_CLIENT_ID, "Google", "SAGEPORT_GOOGLE_CLIENT_ID")?;
    let client_secret = require(GOOGLE_CLIENT_SECRET, "Google", "SAGEPORT_GOOGLE_CLIENT_SECRET")?;

    let listener = bind_loopback().await?;
    let redirect_uri = format!("http://127.0.0.1:{}", listener_port(&listener)?);
    let pkce = pkce();
    let state = random_state();

    let mut auth = Url::parse(GOOGLE_AUTH_URL).map_err(|e| AppError::Other(e.to_string()))?;
    auth.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", GOOGLE_SCOPE)
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        // Always re-consent so a refresh token is issued even on re-link.
        .append_pair("prompt", "consent")
        .append_pair("state", &state);

    let code = run_loopback(app, on_event, listener, auth, &state, cancel).await?;

    let resp = post_form_json(
        GOOGLE_TOKEN_URL,
        &[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("code", &code),
            ("code_verifier", &pkce.verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect_uri),
        ],
    )
    .await?;

    let access_token = json_str(&resp, "access_token")?;
    let refresh_token = json_str(&resp, "refresh_token").map_err(|_| {
        AppError::Other("Google did not return a refresh token — try again".into())
    })?;
    let expires_in = resp["expires_in"].as_i64().unwrap_or(3600);

    let account = google_email(&access_token).await.unwrap_or_else(|_| "Google".into());
    Ok(OAuthOutcome {
        credential: OAuthCredential::Tokens(OAuthTokens::from_grant(
            access_token,
            refresh_token,
            expires_in,
        )),
        account,
    })
}

async fn google_email(access_token: &str) -> AppResult<String> {
    let body: Value = http()
        .get("https://openidconnect.googleapis.com/v1/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
        .json()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    json_str(&body, "email")
}

pub async fn microsoft_flow(
    app: &tauri::AppHandle,
    on_event: &tauri::ipc::Channel<OAuthEvent>,
    cancel: tokio::sync::oneshot::Receiver<()>,
) -> AppResult<OAuthOutcome> {
    let client_id = require(MS_CLIENT_ID, "Microsoft", "SAGEPORT_MS_CLIENT_ID")?;

    let listener = bind_loopback().await?;
    // Entra ID special-cases http://localhost (any port) for desktop clients.
    let redirect_uri = format!("http://localhost:{}", listener_port(&listener)?);
    let pkce = pkce();
    let state = random_state();

    let mut auth = Url::parse(MS_AUTH_URL).map_err(|e| AppError::Other(e.to_string()))?;
    auth.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("response_mode", "query")
        .append_pair("scope", MS_SCOPE)
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);

    let code = run_loopback(app, on_event, listener, auth, &state, cancel).await?;

    let resp = post_form_json(
        MS_TOKEN_URL,
        &[
            ("client_id", client_id),
            ("code", &code),
            ("code_verifier", &pkce.verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", &redirect_uri),
            ("scope", MS_SCOPE),
        ],
    )
    .await?;

    let access_token = json_str(&resp, "access_token")?;
    let refresh_token = json_str(&resp, "refresh_token")?;
    let expires_in = resp["expires_in"].as_i64().unwrap_or(3600);

    let account = microsoft_account(&access_token).await.unwrap_or_else(|_| "Microsoft".into());
    Ok(OAuthOutcome {
        credential: OAuthCredential::Tokens(OAuthTokens::from_grant(
            access_token,
            refresh_token,
            expires_in,
        )),
        account,
    })
}

async fn microsoft_account(access_token: &str) -> AppResult<String> {
    let body: Value = http()
        .get("https://graph.microsoft.com/v1.0/me")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?
        .json()
        .await
        .map_err(|e| AppError::Other(e.to_string()))?;
    body["mail"]
        .as_str()
        .or(body["userPrincipalName"].as_str())
        .map(str::to_string)
        .ok_or_else(|| AppError::Other("no account name in Graph response".into()))
}

// --- Token refresh ---

pub async fn refresh_google(tokens: &OAuthTokens) -> AppResult<OAuthTokens> {
    let client_id = require(GOOGLE_CLIENT_ID, "Google", "SAGEPORT_GOOGLE_CLIENT_ID")?;
    let client_secret = require(GOOGLE_CLIENT_SECRET, "Google", "SAGEPORT_GOOGLE_CLIENT_SECRET")?;
    let resp = post_form_json(
        GOOGLE_TOKEN_URL,
        &[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", &tokens.refresh_token),
            ("grant_type", "refresh_token"),
        ],
    )
    .await?;
    Ok(OAuthTokens::from_grant(
        json_str(&resp, "access_token")?,
        // Google normally keeps the original refresh token.
        resp["refresh_token"]
            .as_str()
            .unwrap_or(&tokens.refresh_token)
            .to_string(),
        resp["expires_in"].as_i64().unwrap_or(3600),
    ))
}

pub async fn refresh_microsoft(tokens: &OAuthTokens) -> AppResult<OAuthTokens> {
    let client_id = require(MS_CLIENT_ID, "Microsoft", "SAGEPORT_MS_CLIENT_ID")?;
    let resp = post_form_json(
        MS_TOKEN_URL,
        &[
            ("client_id", client_id),
            ("refresh_token", &tokens.refresh_token),
            ("grant_type", "refresh_token"),
            ("scope", MS_SCOPE),
        ],
    )
    .await?;
    Ok(OAuthTokens::from_grant(
        json_str(&resp, "access_token")?,
        // Microsoft rotates refresh tokens; keep the new one when present.
        resp["refresh_token"]
            .as_str()
            .unwrap_or(&tokens.refresh_token)
            .to_string(),
        resp["expires_in"].as_i64().unwrap_or(3600),
    ))
}

// --- Loopback redirect plumbing ---

async fn bind_loopback() -> AppResult<TcpListener> {
    TcpListener::bind(("127.0.0.1", 0))
        .await
        .map_err(|e| AppError::Other(format!("could not bind the OAuth redirect listener: {e}")))
}

fn listener_port(listener: &TcpListener) -> AppResult<u16> {
    Ok(listener
        .local_addr()
        .map_err(|e| AppError::Other(e.to_string()))?
        .port())
}

/// Open `auth_url` in the system browser and wait for the provider to
/// redirect back with `?code=...`. Verifies `state`, answers the browser
/// with a small "you can close this tab" page, and enforces both a timeout
/// and user cancellation.
async fn run_loopback(
    app: &tauri::AppHandle,
    on_event: &tauri::ipc::Channel<OAuthEvent>,
    listener: TcpListener,
    auth_url: Url,
    expected_state: &str,
    mut cancel: tokio::sync::oneshot::Receiver<()>,
) -> AppResult<String> {
    use tauri_plugin_opener::OpenerExt;

    app.opener()
        .open_url(auth_url.as_str(), None::<&str>)
        .map_err(|e| AppError::Other(format!("could not open the browser: {e}")))?;
    on_event.send(OAuthEvent::Browser).ok();

    let deadline = tokio::time::Instant::now() + LOOPBACK_TIMEOUT;
    loop {
        let accept = tokio::select! {
            _ = &mut cancel => return Err(AppError::Cancelled),
            _ = tokio::time::sleep_until(deadline) => {
                return Err(AppError::Invalid("timed out waiting for browser authorization".into()));
            }
            accepted = listener.accept() => accepted,
        };
        let (mut stream, _) = accept.map_err(|e| AppError::Other(e.to_string()))?;

        // Read just the request head; the redirect is a bare GET.
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]);
        let Some(target) = head.split_whitespace().nth(1) else {
            respond(&mut stream, 400, "Bad request").await;
            continue;
        };

        // Stray requests (favicon, health checks) just get a 404 and we keep
        // waiting for the real redirect.
        let url = match Url::parse(&format!("http://localhost{target}")) {
            Ok(u) => u,
            Err(_) => {
                respond(&mut stream, 400, "Bad request").await;
                continue;
            }
        };
        let mut code = None;
        let mut state = None;
        let mut error = None;
        for (k, v) in url.query_pairs() {
            match k.as_ref() {
                "code" => code = Some(v.into_owned()),
                "state" => state = Some(v.into_owned()),
                "error" => error = Some(v.into_owned()),
                _ => {}
            }
        }

        if let Some(err) = error {
            respond(&mut stream, 200, "Authorization failed — you can close this tab.").await;
            return Err(AppError::Invalid(format!("authorization was denied: {err}")));
        }
        let Some(code) = code else {
            respond(&mut stream, 404, "Not found").await;
            continue;
        };
        if state.as_deref() != Some(expected_state) {
            respond(&mut stream, 400, "State mismatch").await;
            return Err(AppError::Invalid("OAuth state mismatch — try again".into()));
        }

        respond(
            &mut stream,
            200,
            "Sageport is connected — you can close this tab and return to the app.",
        )
        .await;
        return Ok(code);
    }
}

async fn respond(stream: &mut tokio::net::TcpStream, status: u16, message: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Sageport</title>\
         <body style=\"font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0\">\
         <p>{message}</p></body>"
    );
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn json_str(v: &Value, key: &str) -> AppResult<String> {
    v[key]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| AppError::Other(format!("missing `{key}` in oauth response")))
}
