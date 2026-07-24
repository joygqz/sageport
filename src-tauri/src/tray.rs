use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::commands::tray::TrayMenuData;
use crate::repository::settings_repo;
use crate::state::AppState;

/// Menu id prefix for a scheduled-task entry; the suffix is the task id. Clicking
/// one reopens the app and asks the webview to focus that task.
const TASK_ID_PREFIX: &str = "tray-task:";

/// Menu id prefix for a running port-forward entry; the suffix is the forward id.
/// Clicking one reopens the app and asks the webview to reveal the Forwards view.
const FORWARD_ID_PREFIX: &str = "tray-forward:";

/// Bundled PNG for the menu-bar icon. Embedded explicitly rather than reusing
/// `default_window_icon()`, which is `None` in dev builds and would leave a
/// zero-width, unclickable status item on macOS. macOS gets a monochrome
/// template image so the system tints it to match the menu bar; other
/// platforms get the colored glyph without the background plate.
#[cfg(target_os = "macos")]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon-template.png");
#[cfg(not(target_os = "macos"))]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon.png");

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

/// Pick tray labels from the persisted UI language. Used only for the menu the
/// tray starts with; once the webview loads it pushes fully localized labels via
/// [`update_menu`], so an in-app language switch relabels the tray live.
fn prefers_zh(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    tauri::async_runtime::block_on(settings_repo::get(&state.db, "general.locale"))
        .ok()
        .flatten()
        .is_some_and(|value| value.starts_with("zh"))
}

/// The menu shown before the webview has pushed its data — just Open and Quit, in
/// the persisted language. The task and forward sections fill in once it loads.
fn initial_data(app: &AppHandle) -> TrayMenuData {
    let (open, quit, section, forwards_section) = if prefers_zh(app) {
        ("打开 Sageport", "退出", "定时任务", "端口转发")
    } else {
        (
            "Open Sageport",
            "Quit",
            "Scheduled tasks",
            "Port forwarding",
        )
    };
    TrayMenuData {
        open_label: open.into(),
        quit_label: quit.into(),
        section_label: section.into(),
        tasks: Vec::new(),
        forwards_section_label: forwards_section.into(),
        forwards: Vec::new(),
    }
}

/// Lay out the tray menu: Open, then a scheduled-task section and a
/// running-forwards section (each shown only when it has entries), then Quit. The
/// disabled section headers act as inert labels. The separators that fence the
/// sections are dropped entirely when both are empty, leaving a bare Open / Quit.
fn build_menu(app: &AppHandle, data: &TrayMenuData) -> tauri::Result<Menu<Wry>> {
    let has_content = !data.tasks.is_empty() || !data.forwards.is_empty();

    let mut builder = MenuBuilder::new(app).text("tray-show", &data.open_label);

    // These disabled items must outlive `build()`; building them is harmless.
    let section = MenuItem::with_id(
        app,
        "tray-section",
        &data.section_label,
        false,
        None::<&str>,
    )?;
    let forwards_section = MenuItem::with_id(
        app,
        "tray-forwards-section",
        &data.forwards_section_label,
        false,
        None::<&str>,
    )?;

    if has_content {
        builder = builder.separator();
    }

    if !data.tasks.is_empty() {
        builder = builder.item(&section);
        for task in &data.tasks {
            builder = builder.text(format!("{TASK_ID_PREFIX}{}", task.id), &task.label);
        }
    }

    if !data.forwards.is_empty() {
        builder = builder.item(&forwards_section);
        for forward in &data.forwards {
            builder = builder.text(format!("{FORWARD_ID_PREFIX}{}", forward.id), &forward.label);
        }
    }

    if has_content {
        builder = builder.separator();
    }

    builder.text("tray-quit", &data.quit_label).build()
}

/// Dispatch a tray menu selection. Task rows reopen the app and hand the task id
/// to the webview, which switches to the Tasks view and focuses it; forward rows
/// do the same for the Forwards view.
fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        "tray-show" => show_main_window(app),
        "tray-quit" => app.exit(0),
        _ => {
            if let Some(task_id) = id.strip_prefix(TASK_ID_PREFIX) {
                show_main_window(app);
                let _ = app.emit("tray://open-task", task_id.to_string());
            } else if let Some(forward_id) = id.strip_prefix(FORWARD_ID_PREFIX) {
                show_main_window(app);
                let _ = app.emit("tray://open-forward", forward_id.to_string());
            }
        }
    }
}

/// Rebuild the tray menu from the webview's current tasks and running forwards.
/// Called on every push so the entries and their next-run times stay current. Must
/// run on the main thread (the caller ensures this).
pub fn update_menu(app: &AppHandle, data: TrayMenuData) -> tauri::Result<()> {
    let menu = build_menu(app, &data)?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

/// Install the menu-bar / system-tray icon: a click opens the menu, and
/// double-click reveals the window. Quit is the only path that exits. The menu
/// starts minimal and is refreshed by [`update_menu`] once the webview loads.
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, &initial_data(app))?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(TRAY_ICON)?)
        .icon_as_template(true)
        .tooltip("Sageport")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| on_menu_event(app, event.id.as_ref()))
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
