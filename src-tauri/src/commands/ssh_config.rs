use std::collections::HashMap;
use std::path::PathBuf;

use tauri::State;

use crate::domain::{auth, HostInput, SshKeyInput};
use crate::error::{AppError, AppResult};
use crate::repository::{host_repo, key_repo};
use crate::ssh::config_file::{self, expand_tilde, SshConfigHost};
use crate::state::AppState;

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

#[tauri::command]
pub async fn ssh_config_import_preview() -> AppResult<Vec<SshConfigHost>> {
    let home = home_dir().ok_or_else(|| AppError::Other("home directory unavailable".into()))?;
    let config_path = home.join(".ssh").join("config");
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    Ok(config_file::load(&config_path, &home))
}

fn jump_token(proxy: &str) -> String {
    let after_user = proxy.rsplit('@').next().unwrap_or(proxy);
    after_user
        .split(':')
        .next()
        .unwrap_or(after_user)
        .to_string()
}

#[tauri::command]
pub async fn ssh_config_import_apply(
    state: State<'_, AppState>,
    hosts: Vec<SshConfigHost>,
) -> AppResult<usize> {
    let home = home_dir().ok_or_else(|| AppError::Other("home directory unavailable".into()))?;

    let mut key_by_path: HashMap<String, String> = HashMap::new();
    let mut alias_to_id: HashMap<String, String> = HashMap::new();
    let mut pending_jumps: Vec<(String, String)> = Vec::new();
    let mut created = 0usize;

    for entry in &hosts {
        let mut key_id = None;
        if let Some(identity) = &entry.identity_file {
            if let Some(id) = key_by_path.get(identity) {
                key_id = Some(id.clone());
            } else {
                let path = expand_tilde(identity, &home);
                if let Ok(contents) = std::fs::read_to_string(&path) {
                    let key = key_repo::create(
                        &state.db,
                        SshKeyInput {
                            name: format!("{} (imported)", entry.alias),
                            public_key: None,
                            private_key: Some(contents),
                            passphrase: None,
                        },
                    )
                    .await?;
                    key_by_path.insert(identity.clone(), key.id.clone());
                    key_id = Some(key.id);
                }
            }
        }

        let auth_type = if key_id.is_some() {
            auth::KEY
        } else {
            auth::AGENT
        };

        let host = host_repo::create(
            &state.db,
            HostInput {
                label: entry.alias.clone(),
                address: entry.host_name.clone(),
                port: entry.port as i64,
                group_id: None,
                identity_id: None,
                username: entry.user.clone(),
                auth_type: Some(auth_type.to_string()),
                key_id,
                os_hint: None,
                color: None,
                notes: None,
                jump_host_id: None,
                startup_command: None,
                password: None,
            },
        )
        .await?;

        alias_to_id.insert(entry.alias.clone(), host.id.clone());
        if let Some(proxy) = &entry.proxy_jump {
            pending_jumps.push((host.id.clone(), jump_token(proxy)));
        }
        created += 1;
    }

    for (host_id, jump_alias) in pending_jumps {
        if let Some(jump_id) = alias_to_id.get(&jump_alias) {
            let host = host_repo::get(&state.db, &host_id).await?;
            host_repo::update(
                &state.db,
                &host_id,
                HostInput {
                    label: host.label,
                    address: host.address,
                    port: host.port,
                    group_id: host.group_id,
                    identity_id: host.identity_id,
                    username: host.username,
                    auth_type: host.auth_type,
                    key_id: host.key_id,
                    os_hint: host.os_hint,
                    color: host.color,
                    notes: host.notes,
                    jump_host_id: Some(jump_id.clone()),
                    startup_command: host.startup_command,
                    password: None,
                },
            )
            .await?;
        }
    }

    Ok(created)
}
