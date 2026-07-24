use serde::Deserialize;

use crate::error::{AppError, AppResult};

const MAX_ROWS: usize = 100;
const MAX_LABEL_CHARS: usize = 256;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayTaskItem {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayForwardItem {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuData {
    pub open_label: String,
    pub quit_label: String,
    pub section_label: String,
    pub tasks: Vec<TrayTaskItem>,
    pub forwards_section_label: String,
    pub forwards: Vec<TrayForwardItem>,
}

fn clamp_label(value: String) -> String {
    if value.chars().count() <= MAX_LABEL_CHARS {
        return value;
    }
    value.chars().take(MAX_LABEL_CHARS).collect()
}

fn sanitize(mut data: TrayMenuData) -> TrayMenuData {
    data.open_label = clamp_label(data.open_label);
    data.quit_label = clamp_label(data.quit_label);
    data.section_label = clamp_label(data.section_label);
    data.forwards_section_label = clamp_label(data.forwards_section_label);
    data.tasks.truncate(MAX_ROWS);
    for task in &mut data.tasks {
        task.label = clamp_label(std::mem::take(&mut task.label));
    }
    data.forwards.truncate(MAX_ROWS);
    for forward in &mut data.forwards {
        forward.label = clamp_label(std::mem::take(&mut forward.label));
    }
    data
}

#[tauri::command]
pub fn tray_set_tasks(app: tauri::AppHandle, data: TrayMenuData) -> AppResult<()> {
    #[cfg(desktop)]
    {
        let data = sanitize(data);
        let handle = app.clone();
        app.run_on_main_thread(move || {
            if let Err(err) = crate::tray::update_menu(&handle, data) {
                eprintln!("failed to update tray menu: {err}");
            }
        })
        .map_err(|e| AppError::Other(e.to_string()))?;
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, sanitize(data));
    }
    Ok(())
}
