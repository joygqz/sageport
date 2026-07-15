use std::collections::HashSet;

use tauri::{AppHandle, State};

use crate::domain::{auth, Host};
use crate::error::{AppError, AppResult};
use crate::repository::{host_repo, identity_repo, key_repo};
use crate::ssh::{
    pending_host_key_prompts, pending_password_prompts, resolve_host_key, resolve_password,
    AuthMethod, ConnectParams, Hop, HostKeyDecision, HostKeyEvent, PasswordPromptEvent,
    JUMP_DEPTH_LIMIT,
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

fn validate_connection_input(session_id: &str, cols: u32, rows: u32) -> AppResult<()> {
    if session_id.trim().is_empty() || session_id.len() > 128 {
        return Err(AppError::Invalid("invalid SSH session id".into()));
    }
    if !(1..=10_000).contains(&cols) || !(1..=10_000).contains(&rows) {
        return Err(AppError::Invalid(
            "terminal dimensions must be between 1 and 10000".into(),
        ));
    }
    Ok(())
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
    validate_connection_input(&session_id, cols, rows)?;
    let Some(reservation) = state.ssh.reserve(session_id.clone(), attempt) else {
        return Ok(());
    };
    let prepared = async {
        let host = host_repo::get(&state.db, &host_id).await?;
        let hops = build_hops(&state, &host).await?;
        host_repo::touch_last_used(&state.db, &host_id).await?;
        Ok::<_, AppError>((hops, host.startup_command))
    }
    .await;
    let (hops, startup_command) = match prepared {
        Ok(prepared) => prepared,
        Err(error) => {
            state.ssh.abandon(&session_id, attempt);
            return Err(error);
        }
    };

    let params = ConnectParams {
        session_id: session_id.clone(),
        attempt,
        hops,
        cols,
        rows,
        startup_command,
    };

    state
        .ssh
        .start(app, state.connection_prompts.clone(), params, reservation);
    Ok(())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ssh_connect_adhoc(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
    host: String,
    port: i64,
    username: String,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    validate_connection_input(&session_id, cols, rows)?;
    let Some(reservation) = state.ssh.reserve(session_id.clone(), attempt) else {
        return Ok(());
    };
    let host = host.trim();
    let host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host)
        .to_string();
    let username = username.trim().to_string();
    if host.is_empty()
        || host.len() > 1024
        || host.chars().any(char::is_whitespace)
        || host.contains(['@', '[', ']'])
    {
        state.ssh.abandon(&session_id, attempt);
        return Err(AppError::Invalid("host is required".into()));
    }
    if username.is_empty()
        || username.len() > 256
        || username.chars().any(char::is_whitespace)
        || username.contains(['@', ':'])
    {
        state.ssh.abandon(&session_id, attempt);
        return Err(AppError::Invalid("username is required".into()));
    }
    let port = match valid_port(port) {
        Ok(port) => port,
        Err(error) => {
            state.ssh.abandon(&session_id, attempt);
            return Err(error);
        }
    };
    let hop = Hop {
        host,
        port,
        username,
        auth: AuthMethod::Automatic,
    };
    let params = ConnectParams {
        session_id: session_id.clone(),
        attempt,
        hops: vec![hop],
        cols,
        rows,
        startup_command: None,
    };
    state
        .ssh
        .start(app, state.connection_prompts.clone(), params, reservation);
    Ok(())
}

#[tauri::command]
pub async fn ssh_send(
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
    data: String,
) -> AppResult<()> {
    state
        .ssh
        .send_input(&session_id, attempt, data.into_bytes())
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    attempt: u32,
    cols: u32,
    rows: u32,
) -> AppResult<()> {
    state.ssh.resize(&session_id, attempt, cols, rows)
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
    attempt: Option<u32>,
) -> AppResult<()> {
    state.ssh.close(&session_id, attempt)
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
    resolve_host_key(&state.connection_prompts.host_keys, &prompt_id, decision);
    Ok(())
}

#[tauri::command]
pub async fn ssh_password_respond(
    state: State<'_, AppState>,
    prompt_id: String,
    password: Option<String>,
) -> AppResult<()> {
    if password
        .as_ref()
        .is_some_and(|value| value.len() > 64 * 1024)
    {
        return Err(AppError::Invalid(
            "authentication response is too large".into(),
        ));
    }
    resolve_password(&state.connection_prompts.passwords, &prompt_id, password);
    Ok(())
}

#[tauri::command]
pub async fn ssh_password_pending(
    state: State<'_, AppState>,
) -> AppResult<Vec<PasswordPromptEvent>> {
    Ok(pending_password_prompts(
        &state.connection_prompts.passwords,
    ))
}

#[tauri::command]
pub async fn ssh_host_key_pending(state: State<'_, AppState>) -> AppResult<Vec<HostKeyEvent>> {
    Ok(pending_host_key_prompts(
        &state.connection_prompts.host_keys,
    ))
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
        auth::PASSWORD => AuthMethod::Password(password.filter(|p| !p.is_empty())),
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
