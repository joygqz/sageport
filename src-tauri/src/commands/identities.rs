use tauri::State;

use crate::domain::{Identity, IdentityInput};
use crate::error::AppResult;
use crate::repository::identity_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn identities_list(state: State<'_, AppState>) -> AppResult<Vec<Identity>> {
    identity_repo::list(&state.db).await
}

#[tauri::command]
pub async fn identities_create(
    state: State<'_, AppState>,
    input: IdentityInput,
) -> AppResult<Identity> {
    identity_repo::create(&state.db, input).await
}

#[tauri::command]
pub async fn identities_update(
    state: State<'_, AppState>,
    id: String,
    input: IdentityInput,
) -> AppResult<Identity> {
    identity_repo::update(&state.db, &id, input).await
}

#[tauri::command]
pub async fn identities_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    identity_repo::delete(&state.db, &id).await
}
