use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use sqlx::{SqliteConnection, SqlitePool};
use tauri::State;

use crate::domain::{auth, Host, HostInput, SshKeyInput};
use crate::error::{AppError, AppResult};
use crate::repository::{host_repo, key_repo};
use crate::ssh::config_file::{
    self, expand_tilde, SshConfigHost, WARNING_IDENTITY_UNREADABLE, WARNING_PROXY_UNRESOLVED,
    WARNING_USERNAME_MISSING,
};
use crate::ssh::JUMP_DEPTH_LIMIT;
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

fn normalized_target(address: &str, port: i64, username: Option<&str>) -> (String, i64, String) {
    (
        address.trim().to_ascii_lowercase(),
        port,
        username.unwrap_or("").trim().to_string(),
    )
}

fn jump_token(proxy: &str) -> String {
    let after_user = proxy.rsplit('@').next().unwrap_or(proxy);
    after_user
        .split(':')
        .next()
        .unwrap_or(after_user)
        .trim()
        .to_ascii_lowercase()
}

fn push_warning(host: &mut SshConfigHost, warning: &str) {
    if !host.warnings.iter().any(|current| current == warning) {
        host.warnings.push(warning.to_string());
        host.warnings.sort();
    }
}

async fn preview_hosts(pool: &SqlitePool, home: &Path) -> AppResult<Vec<SshConfigHost>> {
    let config_path = home.join(".ssh").join("config");
    if !config_path.exists() {
        return Ok(Vec::new());
    }
    let mut parsed = config_file::load(&config_path, home);
    let existing_hosts = host_repo::list(pool).await?;
    let existing_targets = existing_hosts
        .iter()
        .map(|host| normalized_target(&host.address, host.port, host.username.as_deref()))
        .collect::<HashSet<_>>();
    let mut resolvable_jumps = parsed
        .iter()
        .map(|host| host.alias.trim().to_ascii_lowercase())
        .collect::<HashSet<_>>();
    for host in &existing_hosts {
        resolvable_jumps.insert(host.label.trim().to_ascii_lowercase());
    }

    for host in &mut parsed {
        host.existing = existing_targets.contains(&normalized_target(
            &host.host_name,
            i64::from(host.port),
            host.user.as_deref(),
        ));
        if host
            .user
            .as_deref()
            .is_none_or(|user| user.trim().is_empty())
        {
            push_warning(host, WARNING_USERNAME_MISSING);
        }
        if let Some(identity) = &host.identity_file {
            let path = expand_tilde(identity, home);
            if std::fs::read_to_string(path).is_err() {
                push_warning(host, WARNING_IDENTITY_UNREADABLE);
            }
        }
        if let Some(proxy) = &host.proxy_jump {
            if !resolvable_jumps.contains(&jump_token(proxy)) {
                push_warning(host, WARNING_PROXY_UNRESOLVED);
            }
        }
    }
    Ok(parsed)
}

#[tauri::command]
pub async fn ssh_config_import_preview(
    state: State<'_, AppState>,
) -> AppResult<Vec<SshConfigHost>> {
    let home = home_dir().ok_or_else(|| AppError::Other("home directory unavailable".into()))?;
    preview_hosts(&state.db, &home).await
}

async fn validate_jump_graph(connection: &mut SqliteConnection) -> AppResult<()> {
    let hosts = sqlx::query_as::<_, Host>("SELECT * FROM hosts WHERE deleted_at IS NULL")
        .fetch_all(&mut *connection)
        .await?;
    let jumps = hosts
        .iter()
        .map(|host| (host.id.clone(), host.jump_host_id.clone()))
        .collect::<HashMap<_, _>>();
    for host in hosts {
        let mut visited = HashSet::new();
        let mut current = Some(host.id);
        let mut depth = 0usize;
        while let Some(id) = current {
            if !visited.insert(id.clone()) {
                return Err(AppError::Invalid("the jump host chain has a loop".into()));
            }
            depth += 1;
            if depth > JUMP_DEPTH_LIMIT {
                return Err(AppError::Invalid("the jump host chain is too deep".into()));
            }
            current = jumps
                .get(&id)
                .ok_or_else(|| AppError::Invalid("jump host does not exist".into()))?
                .clone();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_config_import_apply(
    state: State<'_, AppState>,
    hosts: Vec<SshConfigHost>,
) -> AppResult<usize> {
    let home = home_dir().ok_or_else(|| AppError::Other("home directory unavailable".into()))?;
    apply_import(&state.db, &home, hosts).await
}

async fn apply_import(
    pool: &SqlitePool,
    home: &Path,
    hosts: Vec<SshConfigHost>,
) -> AppResult<usize> {
    let requested = hosts
        .into_iter()
        .map(|host| host.alias.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    if requested.is_empty() {
        return Ok(0);
    }

    // Reload and validate the local file so callers cannot bypass preview warnings
    // or submit modified host data.
    let preview = preview_hosts(pool, home).await?;
    let selected = preview
        .into_iter()
        .filter(|host| requested.contains(&host.alias.to_ascii_lowercase()))
        .collect::<Vec<_>>();
    if selected.len() != requested.len() {
        return Err(AppError::Invalid(
            "one or more selected SSH config hosts no longer exist".into(),
        ));
    }
    for host in &selected {
        if host.existing {
            return Err(AppError::Invalid(format!(
                "host {} has already been imported",
                host.alias
            )));
        }
        if !host.warnings.is_empty() {
            return Err(AppError::Invalid(format!(
                "host {} cannot be imported until its warnings are resolved: {}",
                host.alias,
                host.warnings.join(", ")
            )));
        }
    }

    let existing_hosts = host_repo::list(pool).await?;
    let mut alias_to_id = existing_hosts
        .iter()
        .map(|host| (host.label.trim().to_ascii_lowercase(), host.id.clone()))
        .collect::<HashMap<_, _>>();
    let selected_aliases = selected
        .iter()
        .map(|host| host.alias.trim().to_ascii_lowercase())
        .collect::<HashSet<_>>();
    for host in &selected {
        if let Some(proxy) = &host.proxy_jump {
            let jump = jump_token(proxy);
            if !alias_to_id.contains_key(&jump) && !selected_aliases.contains(&jump) {
                return Err(AppError::Invalid(format!(
                    "jump host {jump} must be imported together with {}",
                    host.alias
                )));
            }
        }
    }

    // Complete all filesystem reads before opening the database transaction.
    let mut key_contents_by_path = HashMap::new();
    for host in &selected {
        if let Some(identity) = &host.identity_file {
            if !key_contents_by_path.contains_key(identity) {
                let path = expand_tilde(identity, home);
                let contents = std::fs::read_to_string(&path).map_err(|error| {
                    AppError::Invalid(format!(
                        "cannot read identity file {}: {error}",
                        path.display()
                    ))
                })?;
                key_contents_by_path.insert(identity.clone(), contents);
            }
        }
    }

    let mut key_by_content = key_repo::list(pool)
        .await?
        .into_iter()
        .filter_map(|key| {
            key.private_key
                .map(|private_key| (private_key.trim().to_string(), key.id))
        })
        .collect::<HashMap<_, _>>();
    let mut key_by_path: HashMap<String, String> = HashMap::new();
    let mut pending_jumps = Vec::new();
    let mut tx = pool.begin().await?;

    for entry in &selected {
        let mut key_id = None;
        if let Some(identity) = &entry.identity_file {
            if let Some(id) = key_by_path.get(identity) {
                key_id = Some(id.clone());
            } else {
                let contents = key_contents_by_path
                    .get(identity)
                    .expect("identity files are preloaded");
                let normalized = contents.trim().to_string();
                let id = if let Some(id) = key_by_content.get(&normalized) {
                    id.clone()
                } else {
                    let key = key_repo::create_in(
                        &mut tx,
                        SshKeyInput {
                            name: format!("{} (imported)", entry.alias),
                            public_key: None,
                            private_key: Some(contents.clone()),
                            passphrase: None,
                        },
                    )
                    .await?;
                    key_by_content.insert(normalized, key.id.clone());
                    key.id
                };
                key_by_path.insert(identity.clone(), id.clone());
                key_id = Some(id);
            }
        }

        let auth_type = if key_id.is_some() {
            auth::KEY
        } else {
            auth::AGENT
        };
        let host = host_repo::create_in(
            &mut tx,
            HostInput {
                label: entry.alias.clone(),
                address: entry.host_name.clone(),
                port: i64::from(entry.port),
                group_id: None,
                identity_id: None,
                username: entry.user.clone(),
                auth_type: Some(auth_type.to_string()),
                key_id,
                os_hint: None,
                requires_approval: false,
                notes: None,
                jump_host_id: None,
                startup_command: None,
                password: None,
            },
        )
        .await?;
        alias_to_id.insert(entry.alias.trim().to_ascii_lowercase(), host.id.clone());
        if let Some(proxy) = &entry.proxy_jump {
            pending_jumps.push((host.id, jump_token(proxy)));
        }
    }

    for (host_id, jump_alias) in pending_jumps {
        let jump_id = alias_to_id
            .get(&jump_alias)
            .ok_or_else(|| AppError::Invalid(format!("jump host {jump_alias} was not imported")))?;
        sqlx::query(
            "UPDATE hosts
             SET jump_host_id = ?, updated_at = ?, revision = revision + 1
             WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(jump_id)
        .bind(crate::domain::now())
        .bind(host_id)
        .execute(&mut *tx)
        .await?;
    }
    validate_jump_graph(&mut tx).await?;
    tx.commit().await?;
    Ok(selected.len())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn test_home(config: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("sageport-{}", crate::domain::new_id()));
        let ssh = home.join(".ssh");
        std::fs::create_dir_all(&ssh).unwrap();
        std::fs::write(ssh.join("config"), config).unwrap();
        home
    }

    #[tokio::test]
    async fn cyclic_proxy_jump_import_rolls_back_every_host() {
        let pool = test_pool().await;
        let home = test_home(
            "Host first\n  User root\n  ProxyJump second\n\nHost second\n  User root\n  ProxyJump first\n",
        );
        let preview = preview_hosts(&pool, &home).await.unwrap();
        assert!(preview.iter().all(|host| host.warnings.is_empty()));

        assert!(matches!(
            apply_import(&pool, &home, preview).await,
            Err(AppError::Invalid(_))
        ));
        assert!(host_repo::list(&pool).await.unwrap().is_empty());
        assert!(key_repo::list(&pool).await.unwrap().is_empty());
        std::fs::remove_dir_all(home).unwrap();
    }

    #[tokio::test]
    async fn duplicate_detection_distinguishes_users_on_the_same_endpoint() {
        let pool = test_pool().await;
        host_repo::create(
            &pool,
            HostInput {
                label: "root-login".to_string(),
                address: "server.example.com".to_string(),
                port: 22,
                group_id: None,
                identity_id: None,
                username: Some("root".to_string()),
                auth_type: Some(auth::AGENT.to_string()),
                key_id: None,
                os_hint: None,
                requires_approval: false,
                notes: None,
                jump_host_id: None,
                startup_command: None,
                password: None,
            },
        )
        .await
        .unwrap();
        let home = test_home(
            "Host deploy-login\n  HostName server.example.com\n  User deploy\n\nHost root-copy\n  HostName server.example.com\n  User root\n",
        );
        let preview = preview_hosts(&pool, &home).await.unwrap();
        assert!(!preview[0].existing);
        assert!(preview[1].existing);
        std::fs::remove_dir_all(home).unwrap();
    }
}
