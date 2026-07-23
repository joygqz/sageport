use serde::Serialize;
use tauri::State;

use crate::domain::{SshKeyGenerateInput, SshKeyInput, SshKeyView};
use crate::error::{AppError, AppResult};
use crate::repository::key_repo;
use crate::sshkey::{self, KeyFile};
use crate::state::AppState;

#[tauri::command]
pub async fn keys_list(state: State<'_, AppState>) -> AppResult<Vec<SshKeyView>> {
    Ok(key_repo::list(&state.db)
        .await?
        .into_iter()
        .map(SshKeyView::from)
        .collect())
}

#[tauri::command]
pub async fn keys_reveal_passphrase(state: State<'_, AppState>, id: String) -> AppResult<String> {
    key_repo::get(&state.db, &id)
        .await?
        .passphrase
        .filter(|passphrase| !passphrase.is_empty())
        .ok_or_else(|| AppError::NotFound(format!("passphrase for key {id}")))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSshKey {
    #[serde(flatten)]
    pub key: SshKeyView,
    pub fingerprint: String,
    pub algorithm: String,
}

#[tauri::command]
pub async fn keys_generate(
    state: State<'_, AppState>,
    input: SshKeyGenerateInput,
) -> AppResult<GeneratedSshKey> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(crate::error::AppError::Invalid(
            "key name is required".into(),
        ));
    }
    if name.len() > 255 {
        return Err(crate::error::AppError::Invalid(
            "key name exceeds 255 bytes".into(),
        ));
    }
    if input
        .passphrase
        .as_deref()
        .is_some_and(|passphrase| passphrase.len() > 64 * 1024)
    {
        return Err(crate::error::AppError::Invalid(
            "passphrase exceeds 65536 bytes".into(),
        ));
    }
    let generation_name = name.clone();
    let generation_passphrase = input.passphrase.clone();
    let generated = tokio::task::spawn_blocking(move || {
        sshkey::generate(
            input.algorithm,
            generation_passphrase.as_deref(),
            &generation_name,
        )
    })
    .await
    .map_err(|error| crate::error::AppError::Other(format!("key generation failed: {error}")))??;
    let key = key_repo::create(
        &state.db,
        SshKeyInput {
            name,
            public_key: Some(generated.public_key),
            private_key: Some(generated.private_key),
            passphrase: input.passphrase,
        },
    )
    .await?;
    Ok(GeneratedSshKey {
        key: key.into(),
        fingerprint: generated.fingerprint,
        algorithm: generated.algorithm,
    })
}

#[tauri::command]
pub async fn keys_import_file(path: String) -> AppResult<KeyFile> {
    tokio::task::spawn_blocking(move || sshkey::read_file(&path))
        .await
        .map_err(|error| crate::error::AppError::Other(format!("key import failed: {error}")))?
}

#[tauri::command]
pub async fn keys_create(state: State<'_, AppState>, input: SshKeyInput) -> AppResult<SshKeyView> {
    Ok(key_repo::create(&state.db, input).await?.into())
}

#[tauri::command]
pub async fn keys_update(
    state: State<'_, AppState>,
    id: String,
    input: SshKeyInput,
) -> AppResult<SshKeyView> {
    Ok(key_repo::update(&state.db, &id, input).await?.into())
}

#[tauri::command]
pub async fn keys_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    key_repo::delete(&state.db, &id).await
}
