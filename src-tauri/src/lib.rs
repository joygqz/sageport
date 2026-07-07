mod ai;
mod commands;
mod crypto;
mod db;
mod domain;
mod error;
mod repository;
mod sftp;
mod ssh;
mod sshkey;
mod state;
mod sync;
mod update;

use tauri::Manager;

use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db_path = data_dir.join("sageport.db");
            let pool = tauri::async_runtime::block_on(db::init(&db_path))?;
            app.manage(AppState::new(pool));

            if let Some(window) = app.get_webview_window("main") {
                commands::window::preset_traffic_light_inset(&window);
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                update::check(&handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::groups::groups_list,
            commands::groups::groups_create,
            commands::groups::groups_update,
            commands::groups::groups_delete,
            commands::hosts::hosts_list,
            commands::hosts::hosts_get,
            commands::hosts::hosts_create,
            commands::hosts::hosts_update,
            commands::hosts::hosts_delete,
            commands::hosts::hosts_check_health,
            commands::identities::identities_list,
            commands::identities::identities_create,
            commands::identities::identities_update,
            commands::identities::identities_delete,
            commands::keys::keys_list,
            commands::keys::keys_create,
            commands::keys::keys_update,
            commands::keys::keys_delete,
            commands::keys::keys_generate,
            commands::keys::keys_import_file,
            commands::snippets::snippets_list,
            commands::snippets::snippets_create,
            commands::snippets::snippets_update,
            commands::snippets::snippets_delete,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_all,
            commands::ssh::ssh_connect,
            commands::ssh::ssh_send,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_disconnect,
            commands::sftp::sftp_connect,
            commands::sftp::sftp_disconnect,
            commands::sftp::fs_home,
            commands::sftp::fs_list,
            commands::sftp::fs_mkdir,
            commands::sftp::fs_rename,
            commands::sftp::fs_delete,
            commands::sftp::fs_read_text,
            commands::sftp::fs_write_text,
            commands::sftp::fs_transfer,
            commands::sftp::fs_transfer_cancel,
            commands::sftp::sftp_transfer_history_list,
            commands::sftp::sftp_transfer_history_delete,
            commands::sftp::sftp_transfer_history_clear,
            commands::sync::sync_get_status,
            commands::sync::sync_oauth_start,
            commands::sync::sync_oauth_cancel,
            commands::sync::sync_connect,
            commands::sync::sync_disconnect,
            commands::sync::sync_push,
            commands::sync::sync_list_versions,
            commands::sync::sync_restore_version,
            commands::sync::sync_file_export,
            commands::sync::sync_file_import,
            commands::window::window_set_traffic_light_inset,
            commands::update::update_status,
            commands::update::update_check,
            commands::update::update_install,
            commands::ai::ai_get_config,
            commands::ai::ai_set_config,
            commands::ai::ai_set_model,
            commands::ai::ai_list_models,
            commands::ai::ai_chat,
            commands::ai::ai_chat_cancel,
            commands::ai::ai_session_list,
            commands::ai::ai_session_create,
            commands::ai::ai_session_get,
            commands::ai::ai_session_save,
            commands::ai::ai_session_rename,
            commands::ai::ai_session_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
