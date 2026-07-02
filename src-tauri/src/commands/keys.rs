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

/// `keys_generate`'s response: the persisted row plus the fingerprint/
/// algorithm the frontend shows as a one-time "here's what was created"
/// confirmation (mirroring `ssh-keygen`'s own summary line).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedSshKey {
    #[serde(flatten)]
    pub key: SshKey,
    pub fingerprint: String,
    pub algorithm: String,
}

/// Generate a brand-new keypair and persist it in one step — there's nothing
/// for the user to review beforehand, unlike import.
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

/// Read a private key file (and its sibling `.pub`, if any) the user picked
/// via the native file dialog, for prefilling the "import" form. Doesn't
/// persist anything — the caller still confirms via `keys_create`.
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
