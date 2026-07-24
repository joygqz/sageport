use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

const HIDE_ID: &str = "app-hide";
const QUIT_ID: &str = "app-quit";

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let (hide_label, quit_label) = if crate::tray::prefers_zh(app) {
        ("关闭窗口", "退出 Sageport")
    } else {
        ("Close window", "Quit Sageport")
    };

    let package = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|p| vec![p]),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        &package.name,
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, HIDE_ID, hide_label, true, Some("CmdOrCtrl+Q"))?,
            &MenuItem::with_id(app, QUIT_ID, quit_label, true, None::<&str>)?,
        ],
    )?;

    let menu = Menu::default(app)?;
    menu.remove_at(0)?;
    menu.prepend(&app_menu)?;
    app.set_menu(menu)?;

    Ok(())
}

pub fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        HIDE_ID => crate::tray::hide_main_window(app),
        QUIT_ID => app.exit(0),
        _ => {}
    }
}
