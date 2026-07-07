use serde::Serialize;
use tauri::State;

use crate::domain::{SshKey, SshKeyGenerateInput, SshKeyInput};
use crate::error::AppResult;
use crate::repository::key_repo;
use crate::sshkey::{self, KeyFile};
use crate::state::AppState;

#[tauri::command]
pub async fn keys_list(state: State<'_, AppState>) -> AppResult<Vec<SshKey>> {
    key_repo::list(&state.db).await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSshKey {
    #[serde(flatten)]
    pub key: SshKey,
    pub fingerprint: String,
    pub algorithm: String,
}

#[tauri::command]
pub async fn keys_generate(
    state: State<'_, AppState>,
    input: SshKeyGenerateInput,
) -> AppResult<GeneratedSshKey> {
    let generated = sshkey::generate(input.algorithm, input.passphrase.as_deref(), &input.name)?;
    let key = key_repo::create(
        &state.db,
        SshKeyInput {
            name: input.name,
            public_key: Some(generated.public_key),
            private_key: Some(generated.private_key),
            passphrase: input.passphrase,
        },
    )
    .await?;
    Ok(GeneratedSshKey {
        key,
        fingerprint: generated.fingerprint,
        algorithm: generated.algorithm,
    })
}

#[tauri::command]
pub async fn keys_import_file(path: String) -> AppResult<KeyFile> {
    sshkey::read_file(&path)
}

#[tauri::command]
pub async fn keys_create(state: State<'_, AppState>, input: SshKeyInput) -> AppResult<SshKey> {
    key_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn keys_update(
    state: State<'_, AppState>,
    id: String,
    input: SshKeyInput,
) -> AppResult<SshKey> {
    key_repo::update(&state.db, &id, input).await
}

#[tauri::command]
pub async fn keys_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    key_repo::delete(&state.db, &id).await
}
