use russh::client::{AuthResult, Handle};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use russh::MethodKind;
use tokio::io::{AsyncRead, AsyncWrite};

use super::connect::dropped_during_auth;
use super::handler::ClientHandler;

pub enum AgentAuth {
    Success,
    KeyboardInteractive,
    Disconnected,
    Failure,
}

pub async fn try_authenticate(handle: &mut Handle<ClientHandler>, username: &str) -> AgentAuth {
    #[cfg(not(windows))]
    {
        match AgentClient::connect_env().await {
            Ok(agent) => run(handle, username, agent).await,
            Err(_) => AgentAuth::Failure,
        }
    }
    #[cfg(windows)]
    {
        match AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
            Ok(agent) => run(handle, username, agent).await,
            Err(_) => AgentAuth::Failure,
        }
    }
}

async fn run<S>(
    handle: &mut Handle<ClientHandler>,
    username: &str,
    mut agent: AgentClient<S>,
) -> AgentAuth
where
    S: AgentStream + AsyncRead + AsyncWrite + Unpin + Send,
{
    let identities = match agent.request_identities().await {
        Ok(ids) => ids,
        Err(_) => return AgentAuth::Failure,
    };
    let rsa_hash = handle
        .best_supported_rsa_hash()
        .await
        .ok()
        .flatten()
        .flatten();

    for identity in identities {
        let AgentIdentity::PublicKey { key, .. } = identity else {
            continue;
        };
        let hash = if key.algorithm().is_rsa() {
            rsa_hash
        } else {
            None
        };
        match handle
            .authenticate_publickey_with(username, key, hash, &mut agent)
            .await
        {
            Ok(result) => {
                if result.success() {
                    return AgentAuth::Success;
                }
                if matches!(
                    &result,
                    AuthResult::Failure {
                        remaining_methods,
                        partial_success: true,
                    } if remaining_methods.contains(&MethodKind::KeyboardInteractive)
                ) {
                    return AgentAuth::KeyboardInteractive;
                }
                if dropped_during_auth(&result, handle) {
                    return AgentAuth::Disconnected;
                }
            }
            Err(_) => {
                if handle.is_closed() {
                    return AgentAuth::Disconnected;
                }
            }
        }
    }
    AgentAuth::Failure
}
