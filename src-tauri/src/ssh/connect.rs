use std::sync::Arc;
use std::time::Duration;

use russh::client::{self, Config, Handle};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg};
use tauri::AppHandle;
use tokio::net::TcpStream;

use super::agent;
use super::handler::ClientHandler;
use super::{AuthMethod, Hop, HostKeyPrompts, JUMP_DEPTH_LIMIT};
use crate::error::{AppError, AppResult};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);

pub struct SshConnection {
    pub handle: Handle<ClientHandler>,
    _jumps: Vec<Handle<ClientHandler>>,
}

fn client_config() -> Arc<Config> {
    Arc::new(Config {
        inactivity_timeout: None,
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: 3,
        ..Default::default()
    })
}

pub async fn establish(
    app: &AppHandle,
    prompts: &HostKeyPrompts,
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
            prompts: prompts.clone(),
            session_id: session_id.to_string(),
            host: hop.host.clone(),
            port: hop.port,
        };

        let mut next = match current.take() {
            None => {
                let stream = connect_tcp(&hop.host, hop.port).await?;
                client::connect_stream(config.clone(), stream, handler).await?
            }
            Some(prev) => {
                let channel = prev
                    .channel_open_direct_tcpip(hop.host.clone(), hop.port as u32, "127.0.0.1", 0)
                    .await?;
                jumps.push(prev);
                client::connect_stream(config.clone(), channel.into_stream(), handler).await?
            }
        };

        authenticate(&mut next, hop).await?;
        current = Some(next);
    }

    let handle = current.ok_or_else(|| AppError::Invalid("no host to connect to".into()))?;
    Ok(SshConnection {
        handle,
        _jumps: jumps,
    })
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

async fn authenticate(handle: &mut Handle<ClientHandler>, hop: &Hop) -> AppResult<()> {
    let ok = match &hop.auth {
        AuthMethod::Password(password) => handle
            .authenticate_password(&hop.username, password)
            .await?
            .success(),
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
            handle
                .authenticate_publickey(
                    &hop.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await?
                .success()
        }
        AuthMethod::Agent => agent::try_authenticate(handle, &hop.username).await,
    };

    if !ok {
        return Err(AppError::Auth(
            "the server rejected these credentials".into(),
        ));
    }
    Ok(())
}
