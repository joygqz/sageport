use crate::paths;

#[tauri::command]
pub fn app_is_portable() -> bool {
    paths::is_portable()
}
