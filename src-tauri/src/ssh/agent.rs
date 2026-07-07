use russh::client::Handle;
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::agent::AgentIdentity;
use tokio::io::{AsyncRead, AsyncWrite};

use super::handler::ClientHandler;

pub async fn try_authenticate(handle: &mut Handle<ClientHandler>, username: &str) -> bool {
    #[cfg(not(windows))]
    {
        match AgentClient::connect_env().await {
            Ok(agent) => run(handle, username, agent).await,
            Err(_) => false,
        }
    }
    #[cfg(windows)]
    {
        match AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent").await {
            Ok(agent) => run(handle, username, agent).await,
            Err(_) => false,
        }
    }
}

async fn run<S>(
    handle: &mut Handle<ClientHandler>,
    username: &str,
    mut agent: AgentClient<S>,
) -> bool
where
    S: AgentStream + AsyncRead + AsyncWrite + Unpin + Send,
{
    let identities = match agent.request_identities().await {
        Ok(ids) => ids,
        Err(_) => return false,
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
        if let Ok(result) = handle
            .authenticate_publickey_with(username, key, hash, &mut agent)
            .await
        {
            if result.success() {
                return true;
            }
        }
    }
    false
}
