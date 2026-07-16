use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

const MAX_IMAGE_AGE: Duration = Duration::from_secs(24 * 60 * 60);

fn encode_png(rgba: &[u8], width: u32, height: u32) -> AppResult<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| AppError::Other(format!("png header: {error}")))?;
        writer
            .write_image_data(rgba)
            .map_err(|error| AppError::Other(format!("png data: {error}")))?;
        writer
            .finish()
            .map_err(|error| AppError::Other(format!("png finish: {error}")))?;
    }
    Ok(out)
}

fn prune_stale(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > MAX_IMAGE_AGE);
        if stale {
            let _ = fs::remove_file(entry.path());
        }
    }
}

#[tauri::command]
pub async fn clipboard_save_image(app: AppHandle) -> AppResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let image = match app.clipboard().read_image() {
            Ok(image) => image,
            Err(_) => return Ok(None),
        };
        let width = image.width();
        let height = image.height();
        let rgba = image.rgba();
        if width == 0 || height == 0 || rgba.len() != width as usize * height as usize * 4 {
            return Ok(None);
        }
        let png = encode_png(rgba, width, height)?;
        let dir = std::env::temp_dir().join("sageport-clipboard");
        fs::create_dir_all(&dir)?;
        prune_stale(&dir);
        let path = dir.join(format!("image-{}.png", Uuid::new_v4()));
        fs::write(&path, &png)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| AppError::Other(format!("clipboard worker failed: {error}")))?
}
