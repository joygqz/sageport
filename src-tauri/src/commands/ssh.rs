use std::collections::HashSet;

use tauri::{AppHandle, State};

use crate::domain::{auth, Host};
use crate::error::{AppError, AppResult};
use crate::repository::{host_repo, identity_repo, key_repo};
use crate::ssh::{
    resolve_host_key, AuthMethod, ConnectParams, Hop, HostKeyDecision, JUMP_DEPTH_LIMIT,
};
use crate::state::AppState;

fn valid_port(port: i64) -> AppResult<u16> {
    let port = u16::try_from(port)
        .map_err(|_| AppError::Invalid("port must be between 1 and 65535".into()))?;
    if port == 0 {
        return Err(AppError::Invalid("port must be between 1 and 65535".into()));
    }
    Ok(port)
}

#[tauri::command]
pub async fn ssh_connect(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
    host_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    let host = host_repo::get(&state.db, &host_id).await?;
    let hops = build_hops(&state, &host).await?;

    let params = ConnectParams {
        session_id,
        attempt,
        hops,
        cols,
        rows,
        startup_command: host.startup_command.clone(),
    };

    state
        .ssh
        .connect(app, state.host_key_prompts.clone(), params);
    host_repo::touch_last_used(&state.db, &host_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn ssh_send(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> AppResult<()> {
    state.ssh.send_input(&session_id, data.into_bytes())
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state.ssh.resize(&session_id, cols, rows)
}

#[tauri::command]
pub async fn ssh_disconnect(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    state.ssh.close(&session_id)
}

#[tauri::command]
pub async fn ssh_host_key_respond(
    state: State<'_, AppState>,
    prompt_id: String,
    decision: String,
) -> AppResult<()> {
    let decision = match decision.as_str() {
        "reject" => HostKeyDecision::Reject,
        "once" => HostKeyDecision::AcceptOnce,
        "remember" => HostKeyDecision::AcceptRemember,
        other => return Err(AppError::Invalid(format!("unknown decision: {other}"))),
    };
    resolve_host_key(&state.host_key_prompts, &prompt_id, decision);
    Ok(())
}

pub(crate) async fn build_hops(state: &State<'_, AppState>, host: &Host) -> AppResult<Vec<Hop>> {
    let mut chain = Vec::new();
    let mut visited = HashSet::new();
    let mut current = host.clone();
    loop {
        if !visited.insert(current.id.clone()) {
            return Err(AppError::Invalid("the jump host chain has a loop".into()));
        }
        let (username, auth) = resolve_credentials(state, &current).await?;
        chain.push(Hop {
            host: current.address.clone(),
            port: valid_port(current.port)?,
            username,
            auth,
        });
        match current.jump_host_id.clone() {
            Some(jump_id) => current = host_repo::get(&state.db, &jump_id).await?,
            None => break,
        }
        if chain.len() >= JUMP_DEPTH_LIMIT {
            return Err(AppError::Invalid("the jump host chain is too deep".into()));
        }
    }
    chain.reverse();
    Ok(chain)
}

pub(crate) async fn resolve_credentials(
    state: &State<'_, AppState>,
    host: &Host,
) -> AppResult<(String, AuthMethod)> {
    let (username, auth_type, key_id, password) = if let Some(identity_id) = &host.identity_id {
        let identity = identity_repo::get(&state.db, identity_id).await?;
        (
            identity.username,
            identity.auth_type,
            identity.key_id,
            identity.password,
        )
    } else {
        let username = host
            .username
            .clone()
            .ok_or_else(|| AppError::Invalid("host has no username".into()))?;
        (
            username,
            host.auth_type
                .clone()
                .unwrap_or_else(|| auth::PASSWORD.to_string()),
            host.key_id.clone(),
            host.password.clone(),
        )
    };

    let method = match auth_type.as_str() {
        auth::PASSWORD => {
            let password = password
                .filter(|p| !p.is_empty())
                .ok_or_else(|| AppError::Invalid("no password stored for this host".into()))?;
            AuthMethod::Password(password)
        }
        auth::KEY => {
            let key_id = key_id
                .ok_or_else(|| AppError::Invalid("key auth selected but no key set".into()))?;
            let key = key_repo::get(&state.db, &key_id).await?;
            let private_key = key
                .private_key
                .filter(|k| !k.is_empty())
                .ok_or_else(|| AppError::Invalid("no private key stored".into()))?;
            AuthMethod::Key {
                private_key,
                passphrase: key.passphrase.filter(|p| !p.is_empty()),
            }
        }
        auth::AGENT => AuthMethod::Agent,
        other => return Err(AppError::Invalid(format!("unknown auth type: {other}"))),
    };

    Ok((username, method))
}
