use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, Config, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg};
use russh::MethodKind;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::oneshot;

use super::agent;
use super::handler::ClientHandler;
use super::{
    AuthMethod, ConnectionPrompts, Hop, PasswordPromptClosedEvent, PasswordPromptEvent,
    PasswordPrompts, PendingPasswordPrompt, EVENT_PASSWORD, EVENT_PASSWORD_CLOSED,
    JUMP_DEPTH_LIMIT,
};
use crate::error::{AppError, AppResult};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PASSWORD_PROMPT_TIMEOUT: Duration = Duration::from_secs(15 * 60);
// Detect a vanished network in roughly 30 seconds instead of leaving the UI
// looking connected for up to a minute and a half.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);

pub struct SshConnection {
    pub handle: Handle<ClientHandler>,
    _jumps: Vec<Handle<ClientHandler>>,
}

struct PasswordPromptGuard {
    app: AppHandle,
    prompts: PasswordPrompts,
    prompt_id: String,
}

impl Drop for PasswordPromptGuard {
    fn drop(&mut self) {
        self.prompts.lock().remove(&self.prompt_id);
        let _ = self.app.emit(
            EVENT_PASSWORD_CLOSED,
            PasswordPromptClosedEvent {
                prompt_id: self.prompt_id.clone(),
            },
        );
    }
}

fn client_config() -> Arc<Config> {
    Arc::new(Config {
        inactivity_timeout: None,
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: 2,
        ..Default::default()
    })
}

pub async fn establish(
    app: &AppHandle,
    prompts: &ConnectionPrompts,
    session_id: &str,
    hops: &[Hop],
) -> AppResult<SshConnection> {
    if hops.is_empty() {
        return Err(AppError::Invalid("no host to connect to".into()));
    }
    if hops.len() > JUMP_DEPTH_LIMIT {
        return Err(AppError::Invalid("jump chain is too deep".into()));
    }

    let config = client_config();
    let mut jumps: Vec<Handle<ClientHandler>> = Vec::new();
    let mut current: Option<Handle<ClientHandler>> = None;

    for hop in hops {
        let handler = ClientHandler {
            app: app.clone(),
            prompts: prompts.host_keys.clone(),
            session_id: session_id.to_string(),
            host: hop.host.clone(),
            port: hop.port,
        };

        let mut next = match current.take() {
            None => {
                let stream = connect_tcp(&hop.host, hop.port).await?;
                with_ssh_timeout(client::connect_stream(config.clone(), stream, handler)).await?
            }
            Some(prev) => {
                let channel = prev
                    .channel_open_direct_tcpip(hop.host.clone(), hop.port as u32, "127.0.0.1", 0)
                    .await?;
                jumps.push(prev);
                with_ssh_timeout(client::connect_stream(
                    config.clone(),
                    channel.into_stream(),
                    handler,
                ))
                .await?
            }
        };

        authenticate(app, &prompts.passwords, session_id, &mut next, hop).await?;
        current = Some(next);
    }

    let handle = current.ok_or_else(|| AppError::Invalid("no host to connect to".into()))?;
    Ok(SshConnection {
        handle,
        _jumps: jumps,
    })
}

async fn with_ssh_timeout<T>(
    future: impl Future<Output = Result<T, russh::Error>>,
) -> AppResult<T> {
    tokio::time::timeout(CONNECT_TIMEOUT, future)
        .await
        .map_err(|_| AppError::Ssh(russh::Error::ConnectionTimeout))?
        .map_err(AppError::from)
}

async fn authenticate_with_agent(handle: &mut Handle<ClientHandler>, username: &str) -> bool {
    tokio::time::timeout(CONNECT_TIMEOUT, agent::try_authenticate(handle, username))
        .await
        .unwrap_or(false)
}

async fn connect_tcp(host: &str, port: u16) -> AppResult<TcpStream> {
    let addrs: Vec<_> = tokio::net::lookup_host((host, port)).await?.collect();
    if addrs.is_empty() {
        return Err(AppError::NotFound(format!(
            "no address resolved for {host}"
        )));
    }
    let mut last_error = None;
    for addr in addrs {
        match tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => {
                let _ = stream.set_nodelay(true);
                return Ok(stream);
            }
            Ok(Err(e)) => last_error = Some(AppError::Io(e)),
            Err(_) => last_error = Some(AppError::Other(format!("connection to {host} timed out"))),
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::Other(format!("could not reach {host}"))))
}

async fn request_password(
    app: &AppHandle,
    prompts: &PasswordPrompts,
    session_id: &str,
    hop: &Hop,
) -> AppResult<String> {
    let prompt_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    let event = PasswordPromptEvent {
        prompt_id: prompt_id.clone(),
        session_id: session_id.to_string(),
        host: hop.host.clone(),
        port: hop.port,
        username: hop.username.clone(),
    };
    prompts.lock().insert(
        prompt_id.clone(),
        PendingPasswordPrompt {
            event: event.clone(),
            response: tx,
        },
    );
    let _guard = PasswordPromptGuard {
        app: app.clone(),
        prompts: prompts.clone(),
        prompt_id,
    };

    let _ = app.emit(EVENT_PASSWORD, event);

    let password = match tokio::time::timeout(PASSWORD_PROMPT_TIMEOUT, rx).await {
        Ok(Ok(Some(password))) if !password.is_empty() => Ok(password),
        Ok(Ok(Some(_))) => Err(AppError::Invalid("password cannot be empty".into())),
        _ => Err(AppError::Cancelled),
    };
    password
}

fn allows(result: &AuthResult, method: MethodKind) -> bool {
    matches!(
        result,
        AuthResult::Failure {
            remaining_methods,
            ..
        } if remaining_methods.contains(&method)
    )
}

async fn keyboard_interactive(
    app: &AppHandle,
    prompts: &PasswordPrompts,
    session_id: &str,
    handle: &mut Handle<ClientHandler>,
    hop: &Hop,
    mut password: Option<String>,
) -> AppResult<bool> {
    let mut response = with_ssh_timeout(
        handle.authenticate_keyboard_interactive_start(&hop.username, None::<String>),
    )
    .await?;
    let mut answered_password = false;

    for _ in 0..8 {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure { .. } => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest {
                prompts: questions, ..
            } => {
                let answers = if questions.is_empty() {
                    Vec::new()
                } else if questions.len() == 1
                    && questions.first().is_some_and(|question| !question.echo)
                    && !answered_password
                {
                    let password = match password.take() {
                        Some(password) => password,
                        None => request_password(app, prompts, session_id, hop).await?,
                    };
                    answered_password = true;
                    vec![password]
                } else {
                    return Err(AppError::Auth(
                        "unsupported keyboard-interactive challenge".into(),
                    ));
                };
                response =
                    with_ssh_timeout(handle.authenticate_keyboard_interactive_respond(answers))
                        .await?;
            }
        }
    }

    Err(AppError::Auth(
        "too many keyboard-interactive challenges".into(),
    ))
}

async fn authenticate_without_saved_password(
    app: &AppHandle,
    prompts: &PasswordPrompts,
    session_id: &str,
    handle: &mut Handle<ClientHandler>,
    hop: &Hop,
    methods: &AuthResult,
) -> AppResult<bool> {
    if allows(methods, MethodKind::Password) {
        let password = request_password(app, prompts, session_id, hop).await?;
        return Ok(
            with_ssh_timeout(handle.authenticate_password(&hop.username, password))
                .await?
                .success(),
        );
    }
    if allows(methods, MethodKind::KeyboardInteractive) {
        return keyboard_interactive(app, prompts, session_id, handle, hop, None).await;
    }
    Err(AppError::Auth(
        "the server does not allow password authentication".into(),
    ))
}

async fn authenticate(
    app: &AppHandle,
    prompts: &PasswordPrompts,
    session_id: &str,
    handle: &mut Handle<ClientHandler>,
    hop: &Hop,
) -> AppResult<()> {
    let ok = match &hop.auth {
        AuthMethod::Password(Some(password)) => {
            let result =
                with_ssh_timeout(handle.authenticate_password(&hop.username, password)).await?;
            if result.success() {
                true
            } else if allows(&result, MethodKind::KeyboardInteractive) {
                keyboard_interactive(
                    app,
                    prompts,
                    session_id,
                    handle,
                    hop,
                    Some(password.clone()),
                )
                .await?
            } else {
                false
            }
        }
        AuthMethod::Password(None) => {
            let none = with_ssh_timeout(handle.authenticate_none(&hop.username)).await?;
            if none.success() {
                true
            } else {
                authenticate_without_saved_password(app, prompts, session_id, handle, hop, &none)
                    .await?
            }
        }
        AuthMethod::Key {
            private_key,
            passphrase,
        } => {
            let key = decode_secret_key(private_key, passphrase.as_deref())
                .map_err(|e| AppError::Auth(format!("could not read the private key: {e}")))?;
            let rsa_hash = handle
                .best_supported_rsa_hash()
                .await
                .ok()
                .flatten()
                .flatten();
            let hash = if key.algorithm().is_rsa() {
                rsa_hash
            } else {
                None
            };
            with_ssh_timeout(handle.authenticate_publickey(
                &hop.username,
                PrivateKeyWithHashAlg::new(Arc::new(key), hash),
            ))
            .await?
            .success()
        }
        AuthMethod::Agent => authenticate_with_agent(handle, &hop.username).await,
        AuthMethod::Automatic => {
            let none = with_ssh_timeout(handle.authenticate_none(&hop.username)).await?;
            if none.success()
                || (allows(&none, MethodKind::PublicKey)
                    && authenticate_with_agent(handle, &hop.username).await)
            {
                true
            } else {
                authenticate_without_saved_password(app, prompts, session_id, handle, hop, &none)
                    .await?
            }
        }
    };

    if !ok {
        return Err(AppError::Auth(
            "the server rejected these credentials".into(),
        ));
    }
    Ok(())
}
