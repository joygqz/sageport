use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, AuthResult, Config, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg};
use russh::MethodKind;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, watch};

use super::agent;
use super::agent::AgentAuth;
use super::handler::ClientHandler;
use super::{
    AuthMethod, ConnectionPrompts, Hop, PasswordPromptClosedEvent, PasswordPromptEvent,
    PasswordPrompts, PendingPasswordPrompt, EVENT_PASSWORD, EVENT_PASSWORD_CLOSED,
    JUMP_DEPTH_LIMIT,
};
use crate::error::{AppError, AppResult};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const PASSWORD_PROMPT_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_KEYBOARD_INTERACTIVE_QUESTIONS: usize = 16;
const MAX_PROMPT_CHARS: usize = 1024;
const MAX_INSTRUCTIONS_CHARS: usize = 4096;
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
        keepalive_max: 0,
        ..Default::default()
    })
}

pub async fn establish(
    app: &AppHandle,
    prompts: &ConnectionPrompts,
    session_id: &str,
    hops: &[Hop],
) -> AppResult<SshConnection> {
    establish_with_forwarded_tcpip(app, prompts, session_id, hops, None).await
}

pub async fn establish_with_forwarded_tcpip(
    app: &AppHandle,
    prompts: &ConnectionPrompts,
    session_id: &str,
    hops: &[Hop],
    forwarded_tcpip: Option<mpsc::Sender<russh::Channel<client::Msg>>>,
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

    for (index, hop) in hops.iter().enumerate() {
        let (host_key_activity, activity_rx) = watch::channel(false);
        let handler = ClientHandler {
            app: app.clone(),
            prompts: prompts.host_keys.clone(),
            session_id: session_id.to_string(),
            host: hop.host.clone(),
            port: hop.port,
            host_key_activity,
            forwarded_tcpip: (index + 1 == hops.len())
                .then(|| forwarded_tcpip.clone())
                .flatten(),
        };

        let mut next = match current.take() {
            None => {
                let stream = connect_tcp(&hop.host, hop.port).await?;
                with_host_key_aware_timeout(
                    client::connect_stream(config.clone(), stream, handler),
                    activity_rx,
                )
                .await?
            }
            Some(prev) => {
                let channel = with_ssh_timeout(prev.channel_open_direct_tcpip(
                    hop.host.clone(),
                    hop.port as u32,
                    "127.0.0.1",
                    0,
                ))
                .await?;
                jumps.push(prev);
                with_host_key_aware_timeout(
                    client::connect_stream(config.clone(), channel.into_stream(), handler),
                    activity_rx,
                )
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

async fn with_host_key_aware_timeout<T>(
    future: impl Future<Output = Result<T, russh::Error>>,
    activity: watch::Receiver<bool>,
) -> AppResult<T> {
    with_host_key_aware_timeout_for(future, activity, CONNECT_TIMEOUT).await
}

async fn with_host_key_aware_timeout_for<T>(
    future: impl Future<Output = Result<T, russh::Error>>,
    mut activity: watch::Receiver<bool>,
    timeout: Duration,
) -> AppResult<T> {
    let mut remaining = timeout;
    tokio::pin!(future);
    loop {
        if *activity.borrow() {
            tokio::select! {
                result = &mut future => return result.map_err(AppError::from),
                changed = activity.changed() => {
                    if changed.is_err() {
                        return future.await.map_err(AppError::from);
                    }
                }
            }
            continue;
        }

        let started = tokio::time::Instant::now();
        tokio::select! {
            result = &mut future => return result.map_err(AppError::from),
            changed = activity.changed() => {
                remaining = remaining.saturating_sub(started.elapsed());
                if remaining.is_zero() {
                    return Err(AppError::Timeout("SSH handshake timed out".into()));
                }
                if changed.is_err() {
                    return future.await.map_err(AppError::from);
                }
            }
            _ = tokio::time::sleep(remaining) => {
                return Err(AppError::Timeout("SSH handshake timed out".into()));
            }
        }
    }
}

async fn authenticate_with_agent(handle: &mut Handle<ClientHandler>, username: &str) -> AgentAuth {
    tokio::time::timeout(CONNECT_TIMEOUT, agent::try_authenticate(handle, username))
        .await
        .unwrap_or(AgentAuth::Failure)
}

async fn connect_tcp(host: &str, port: u16) -> AppResult<TcpStream> {
    let connect = async {
        let addrs: Vec<_> = tokio::net::lookup_host((host, port))
            .await
            .map_err(|error| AppError::Dns(format!("could not resolve {host}: {error}")))?
            .collect();
        if addrs.is_empty() {
            return Err(AppError::Dns(format!("no address resolved for {host}")));
        }
        let mut last_error = None;
        for addr in addrs {
            match TcpStream::connect(addr).await {
                Ok(stream) => {
                    let _ = stream.set_nodelay(true);
                    return Ok(stream);
                }
                Err(error) => last_error = Some(AppError::Io(error)),
            }
        }
        Err(last_error.unwrap_or_else(|| AppError::Network(format!("could not reach {host}"))))
    };

    tokio::time::timeout(CONNECT_TIMEOUT, connect)
        .await
        .map_err(|_| AppError::Timeout(format!("connection to {host} timed out")))?
}

#[allow(clippy::too_many_arguments)]
async fn request_auth_response(
    app: &AppHandle,
    prompts: &PasswordPrompts,
    session_id: &str,
    hop: &Hop,
    prompt: Option<String>,
    instructions: Option<String>,
    echo: bool,
    allow_empty: bool,
) -> AppResult<String> {
    let prompt_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();
    let event = PasswordPromptEvent {
        prompt_id: prompt_id.clone(),
        session_id: session_id.to_string(),
        host: hop.host.clone(),
        port: hop.port,
        username: hop.username.clone(),
        prompt,
        instructions,
        echo,
        allow_empty,
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

    match tokio::time::timeout(PASSWORD_PROMPT_TIMEOUT, rx).await {
        Ok(Ok(Some(response))) if allow_empty || !response.is_empty() => Ok(response),
        Ok(Ok(Some(_))) => Err(AppError::Invalid(
            "authentication response cannot be empty".into(),
        )),
        _ => Err(AppError::Cancelled),
    }
}

async fn request_password(
    app: &AppHandle,
    prompts: &PasswordPrompts,
    session_id: &str,
    hop: &Hop,
) -> AppResult<String> {
    request_auth_response(app, prompts, session_id, hop, None, None, false, false).await
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

fn is_partial(result: &AuthResult) -> bool {
    matches!(
        result,
        AuthResult::Failure {
            partial_success: true,
            ..
        }
    )
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
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
                name,
                instructions,
                prompts: questions,
            } => {
                if questions.len() > MAX_KEYBOARD_INTERACTIVE_QUESTIONS {
                    return Err(AppError::Auth(
                        "too many keyboard-interactive questions".into(),
                    ));
                }
                let name = truncate_chars(name.trim(), MAX_PROMPT_CHARS);
                let instructions = truncate_chars(instructions.trim(), MAX_INSTRUCTIONS_CHARS);
                let details = [name.as_str(), instructions.as_str()]
                    .into_iter()
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n");
                let details = (!details.is_empty()).then_some(details);
                let mut answers = Vec::with_capacity(questions.len());
                for question in questions {
                    let answer = if !question.echo && !answered_password {
                        match password.take() {
                            Some(password) => {
                                answered_password = true;
                                password
                            }
                            None => {
                                answered_password = true;
                                request_auth_response(
                                    app,
                                    prompts,
                                    session_id,
                                    hop,
                                    Some(truncate_chars(&question.prompt, MAX_PROMPT_CHARS)),
                                    details.clone(),
                                    false,
                                    true,
                                )
                                .await?
                            }
                        }
                    } else {
                        request_auth_response(
                            app,
                            prompts,
                            session_id,
                            hop,
                            Some(truncate_chars(&question.prompt, MAX_PROMPT_CHARS)),
                            details.clone(),
                            question.echo,
                            true,
                        )
                        .await?
                    };
                    answers.push(answer);
                }
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
        let result =
            with_ssh_timeout(handle.authenticate_password(&hop.username, password.clone())).await?;
        if result.success() {
            return Ok(true);
        }
        if allows(&result, MethodKind::KeyboardInteractive) {
            let password = (!is_partial(&result)).then_some(password);
            return keyboard_interactive(app, prompts, session_id, handle, hop, password).await;
        }
        return Ok(false);
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
                let password = (!is_partial(&result)).then(|| password.clone());
                keyboard_interactive(app, prompts, session_id, handle, hop, password).await?
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
            let rsa_hash = with_ssh_timeout(handle.best_supported_rsa_hash())
                .await
                .ok()
                .flatten()
                .flatten();
            let hash = if key.algorithm().is_rsa() {
                rsa_hash
            } else {
                None
            };
            let result = with_ssh_timeout(handle.authenticate_publickey(
                &hop.username,
                PrivateKeyWithHashAlg::new(Arc::new(key), hash),
            ))
            .await?;
            if result.success() {
                true
            } else if is_partial(&result) && allows(&result, MethodKind::KeyboardInteractive) {
                keyboard_interactive(app, prompts, session_id, handle, hop, None).await?
            } else {
                false
            }
        }
        AuthMethod::Agent => match authenticate_with_agent(handle, &hop.username).await {
            AgentAuth::Success => true,
            AgentAuth::KeyboardInteractive => {
                keyboard_interactive(app, prompts, session_id, handle, hop, None).await?
            }
            AgentAuth::Failure => false,
        },
        AuthMethod::Automatic => {
            let none = with_ssh_timeout(handle.authenticate_none(&hop.username)).await?;
            let agent = if allows(&none, MethodKind::PublicKey) {
                authenticate_with_agent(handle, &hop.username).await
            } else {
                AgentAuth::Failure
            };
            if none.success() || matches!(agent, AgentAuth::Success) {
                true
            } else if matches!(agent, AgentAuth::KeyboardInteractive) {
                keyboard_interactive(app, prompts, session_id, handle, hop, None).await?
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

#[cfg(test)]
mod tests {
    use super::{client_config, with_host_key_aware_timeout_for, KEEPALIVE_INTERVAL};
    use std::time::Duration;

    #[test]
    fn keepalives_do_not_close_compatible_servers_that_ignore_replies() {
        let config = client_config();

        assert_eq!(config.keepalive_interval, Some(KEEPALIVE_INTERVAL));
        assert_eq!(config.keepalive_max, 0);
    }

    #[tokio::test]
    async fn handshake_timeout_pauses_while_a_host_key_prompt_is_open() {
        let (activity, receiver) = tokio::sync::watch::channel(true);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            let _ = activity.send(false);
        });
        let handshake = async {
            tokio::time::sleep(Duration::from_millis(40)).await;
            Ok::<_, russh::Error>(())
        };

        let result =
            with_host_key_aware_timeout_for(handshake, receiver, Duration::from_millis(20)).await;

        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn handshake_timeout_still_applies_without_a_prompt() {
        let (_activity, receiver) = tokio::sync::watch::channel(false);
        let handshake = std::future::pending::<Result<(), russh::Error>>();

        let result =
            with_host_key_aware_timeout_for(handshake, receiver, Duration::from_millis(10)).await;

        assert!(matches!(result, Err(crate::error::AppError::Timeout(_))));
    }
}
