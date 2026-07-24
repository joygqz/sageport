use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::repository::settings_repo;
use crate::state::AppState;

/// Bundled PNG for the menu-bar icon. Embedded explicitly rather than reusing
/// `default_window_icon()`, which is `None` in dev builds and would leave a
/// zero-width, unclickable status item on macOS.
const TRAY_ICON: &[u8] = include_bytes!("../icons/32x32.png");

/// Bring the main window back to the foreground and, on macOS, restore the dock
/// icon that hide-to-tray removed. Shared by the tray icon, the tray menu, and
/// the single-instance relaunch handler so every "reopen" path behaves the same.
pub fn show_main_window(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        #[cfg(debug_assertions)]
        reapply_dev_dock_icon();
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Dev builds run a bare binary with no .app bundle, so coming back from
/// Accessory re-creates the dock tile with the generic "exec" icon. Re-apply
/// the bundled icon the same way Tauri does on startup. Packaged builds take
/// the icon from the bundle and don't need this.
#[cfg(all(debug_assertions, target_os = "macos"))]
fn reapply_dev_dock_icon() {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    const DOCK_ICON: &[u8] = include_bytes!("../icons/128x128@2x.png");
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let data = NSData::with_bytes(DOCK_ICON);
    if let Some(icon) = NSImage::initWithData(NSImage::alloc(), &data) {
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&icon)) };
    }
}

/// Hide the main window instead of destroying it so the in-webview task
/// scheduler keeps ticking in the background. On macOS also drop to Accessory so
/// the app leaves the dock and lives only in the menu bar.
pub fn hide_main_window(window: &tauri::Window) {
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window
        .app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// Pick tray labels from the persisted UI language. The tray is built once at
/// startup, so switching language in-app only relabels it after a restart.
fn prefers_zh(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    tauri::async_runtime::block_on(settings_repo::get(&state.db, "general.locale"))
        .ok()
        .flatten()
        .is_some_and(|value| value.starts_with("zh"))
}

/// Install the menu-bar / system-tray icon: a click opens the menu with Show and
/// Quit, and double-click reveals the window. Quit is the only path that exits.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let (show_label, quit_label) = if prefers_zh(app) {
        ("显示 Sageport", "退出 Sageport")
    } else {
        ("Show Sageport", "Quit Sageport")
    };
    let show_item = MenuItem::with_id(app, "tray-show", show_label, true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "tray-quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(TRAY_ICON)?)
        .tooltip("Sageport")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "tray-show" => show_main_window(app),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
