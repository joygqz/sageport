mod ai;
mod commands;
mod crypto;
mod db;
mod domain;
mod error;
mod pty;
mod repository;
mod secrets;
mod sftp;
mod ssh;
mod sshkey;
mod state;
mod sync;
mod update;

use tauri::webview::PageLoadEvent;
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use error::{AppError, AppResult};
use state::AppState;
#[cfg(test)]
use state::CancelEntry;

fn cleanup_orphaned_sessions(state: &AppState) {
    state.ssh.close_all();
    state.pty.close_all();
    state.sftp.disconnect_all();
    state.monitor.stop_all();
    state.forwards.stop_all();
    state.connection_prompts.host_keys.lock().clear();
    state.connection_prompts.passwords.lock().clear();
    state.ai_cancels.lock().clear();
    state.batch_cancels.lock().clear();
    let mut oauth = state.sync_oauth.lock();
    oauth.generation = oauth.generation.wrapping_add(1);
    if let Some(cancel) = oauth.cancel.take() {
        let _ = cancel.send(());
    }
    oauth.pending = None;
}

fn initialize_app(app: &mut tauri::App) -> AppResult<()> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Other(format!("cannot locate application data: {error}")))?;
    let db_path = data_dir.join("sageport.db");
    let requires_existing_key =
        tauri::async_runtime::block_on(secrets::database_requires_existing_key(&db_path))?;
    secrets::initialize(&data_dir, !requires_existing_key)?;
    let pool = tauri::async_runtime::block_on(db::init(&db_path))?;
    tauri::async_runtime::block_on(secrets::migrate_plaintext(&pool))?;
    tauri::async_runtime::block_on(repository::transfer_repo::mark_interrupted(&pool))?;
    app.manage(AppState::new(pool));
    Ok(())
}

fn report_startup_failure(app: &mut tauri::App, error: AppError) {
    eprintln!("Sageport startup failed: {error}");
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let handle = app.handle().clone();
    app.dialog()
        .message(format!(
            "Sageport 无法安全读取本地数据，未对现有数据做任何修改。\n\n如果刚才拒绝了钥匙串访问，请重新打开 Sageport 并选择“允许”或“始终允许”。\n\nSageport could not safely read its local data. No existing data was modified.\n\nIf Keychain access was denied, reopen Sageport and choose Allow or Always Allow.\n\n详细信息 / Details:\n{error}"
        ))
        .title("Sageport 启动失败 / Startup failed")
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build());
    let app = builder
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Started {
                if let Some(state) = webview.try_state::<AppState>() {
                    cleanup_orphaned_sessions(&state);
                }
            } else if payload.event() == PageLoadEvent::Finished {
                let handle = webview.app_handle().clone();
                if handle.try_state::<AppState>().is_some() {
                    tauri::async_runtime::spawn(async move {
                        commands::forwards::start_auto_forwards(&handle).await;
                    });
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if let Err(error) = initialize_app(app) {
                report_startup_failure(app, error);
                return Ok(());
            }

            if let Some(window) = app.get_webview_window("main") {
                commands::window::preset_traffic_light_inset(&window);
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(update::run_periodic(handle));
            commands::sync::run_periodic(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::groups::groups_list,
            commands::groups::groups_create,
            commands::groups::groups_update,
            commands::groups::groups_delete,
            commands::hosts::hosts_list,
            commands::hosts::hosts_get,
            commands::hosts::hosts_reveal_password,
            commands::hosts::hosts_create,
            commands::hosts::hosts_update,
            commands::hosts::hosts_set_os_hint,
            commands::hosts::hosts_move,
            commands::hosts::hosts_delete,
            commands::hosts::hosts_check_health,
            commands::identities::identities_list,
            commands::identities::identities_reveal_password,
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
            commands::ssh::ssh_connect,
            commands::ssh::ssh_connect_adhoc,
            commands::ssh::ssh_send,
            commands::ssh::ssh_resize,
            commands::ssh::ssh_disconnect,
            commands::ssh::ssh_host_key_respond,
            commands::ssh::ssh_host_key_pending,
            commands::ssh::ssh_password_respond,
            commands::ssh::ssh_password_pending,
            commands::ssh_config::ssh_config_import_preview,
            commands::ssh_config::ssh_config_import_apply,
            commands::forwards::forwards_list,
            commands::forwards::forwards_active,
            commands::forwards::forwards_runtime,
            commands::forwards::forwards_create,
            commands::forwards::forwards_update,
            commands::forwards::forwards_delete,
            commands::forwards::forward_start,
            commands::forwards::forward_stop,
            commands::bookmarks::bookmarks_list,
            commands::bookmarks::bookmarks_create,
            commands::bookmarks::bookmarks_delete,
            commands::monitor::monitor_start,
            commands::monitor::monitor_stop,
            commands::pty::pty_open,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_close,
            commands::clipboard::clipboard_save_image,
            commands::batch::hosts_run_command,
            commands::batch::hosts_cancel_run,
            commands::history::history_add,
            commands::history::history_list,
            commands::history::history_search,
            commands::history::history_clear,
            commands::sftp::fs_connect,
            commands::sftp::fs_disconnect,
            commands::sftp::fs_home,
            commands::sftp::fs_list,
            commands::sftp::fs_mkdir,
            commands::sftp::fs_rename,
            commands::sftp::fs_delete,
            commands::sftp::fs_chmod,
            commands::sftp::fs_read_text,
            commands::sftp::fs_write_text,
            commands::sftp::fs_transfer,
            commands::sftp::fs_transfer_cancel,
            commands::sftp::fs_history_list,
            commands::sftp::fs_history_delete,
            commands::sftp::fs_history_clear,
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
            commands::update::update_can_self_update,
            commands::update::update_check,
            commands::update::update_install,
            commands::ai::ai_get_config,
            commands::ai::ai_set_config,
            commands::ai::ai_set_model,
            commands::ai::ai_list_models,
            commands::ai::ai_model_limits,
            commands::ai::ai_chat,
            commands::ai::ai_chat_cancel,
            commands::ai::ai_session_list,
            commands::ai::ai_session_create,
            commands::ai::ai_session_get,
            commands::ai::ai_session_save,
            commands::ai::ai_session_delete,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            if let Some(state) = handle.try_state::<AppState>() {
                cleanup_orphaned_sessions(&state);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn page_reload_cleanup_cancels_running_batch_commands() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let state = AppState::new(pool);

        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
        state.batch_cancels.lock().insert(
            "request-1".into(),
            CancelEntry {
                generation: 1,
                sender: Some(cancel_tx),
            },
        );

        cleanup_orphaned_sessions(&state);

        assert!(state.batch_cancels.lock().is_empty());
        assert!(matches!(
            cancel_rx.try_recv(),
            Err(tokio::sync::oneshot::error::TryRecvError::Closed)
        ));
    }
}
