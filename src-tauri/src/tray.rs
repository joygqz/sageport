use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::commands::tray::TrayMenuData;
use crate::repository::settings_repo;
use crate::state::AppState;

const TASK_ID_PREFIX: &str = "tray-task:";

const FORWARD_ID_PREFIX: &str = "tray-forward:";

#[cfg(target_os = "macos")]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon-template.png");
#[cfg(not(target_os = "macos"))]
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon.png");

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

pub fn hide_main_window(window: &tauri::Window) {
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window
        .app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory);
}

fn prefers_zh(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    tauri::async_runtime::block_on(settings_repo::get(&state.db, "general.locale"))
        .ok()
        .flatten()
        .is_some_and(|value| value.starts_with("zh"))
}

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

fn build_menu(app: &AppHandle, data: &TrayMenuData) -> tauri::Result<Menu<Wry>> {
    let has_content = !data.tasks.is_empty() || !data.forwards.is_empty();

    let mut builder = MenuBuilder::new(app).text("tray-show", &data.open_label);

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

pub fn update_menu(app: &AppHandle, data: TrayMenuData) -> tauri::Result<()> {
    let menu = build_menu(app, &data)?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu))?;
    }
    Ok(())
}

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
