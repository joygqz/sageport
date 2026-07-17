use tauri::State;

use crate::domain::{IdentityInput, IdentityView};
use crate::error::{AppError, AppResult};
use crate::repository::identity_repo;
use crate::state::AppState;

#[tauri::command]
pub async fn identities_list(state: State<'_, AppState>) -> AppResult<Vec<IdentityView>> {
    Ok(identity_repo::list(&state.db)
        .await?
        .into_iter()
        .map(IdentityView::from)
        .collect())
}

#[tauri::command]
pub async fn identities_reveal_password(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<String> {
    identity_repo::get(&state.db, &id)
        .await?
        .password
        .filter(|password| !password.is_empty())
        .ok_or_else(|| AppError::NotFound(format!("password for identity {id}")))
}

#[tauri::command]
pub async fn identities_create(
    state: State<'_, AppState>,
    input: IdentityInput,
) -> AppResult<IdentityView> {
    Ok(identity_repo::create(&state.db, input).await?.into())
}

#[tauri::command]
pub async fn identities_update(
    state: State<'_, AppState>,
    id: String,
    input: IdentityInput,
) -> AppResult<IdentityView> {
    Ok(identity_repo::update(&state.db, &id, input).await?.into())
}

#[tauri::command]
pub async fn identities_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    identity_repo::delete(&state.db, &id).await
}
