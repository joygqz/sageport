use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

const MAX_IMAGE_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_RGBA_BYTES: usize = 64 * 1024 * 1024;

fn validated_rgba_len(width: u32, height: u32, actual: usize) -> AppResult<bool> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| AppError::Invalid("clipboard image dimensions are too large".into()))?;
    if expected > MAX_RGBA_BYTES {
        return Err(AppError::Invalid(format!(
            "clipboard image exceeds the {} MiB limit",
            MAX_RGBA_BYTES / 1024 / 1024
        )));
    }
    Ok(width > 0 && height > 0 && actual == expected)
}

fn prepare_private_dir(dir: &Path) -> AppResult<()> {
    match fs::symlink_metadata(dir) {
        Ok(metadata) if !metadata.file_type().is_dir() => {
            return Err(AppError::Invalid(
                "clipboard image cache path is not a directory".into(),
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(dir)?;
        }
        Err(error) => return Err(error.into()),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn write_private_png(dir: &Path, rgba: &[u8], width: u32, height: u32) -> AppResult<PathBuf> {
    let path = dir.join(format!("image-{}.png", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> AppResult<()> {
        let mut file = options.open(&path)?;
        {
            let mut encoder = png::Encoder::new(&mut file, width, height);
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
        file.flush()?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&path);
    }
    result?;
    Ok(path)
}

fn prune_stale(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with("image-") || !name.ends_with(".png") {
            continue;
        }
        let stale = entry
            .path()
            .symlink_metadata()
            .ok()
            .filter(|metadata| metadata.file_type().is_file())
            .and_then(|metadata| metadata.modified().ok())
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
        if !validated_rgba_len(width, height, rgba.len())? {
            return Ok(None);
        }
        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| AppError::Other(format!("clipboard cache path: {error}")))?
            .join("clipboard-images");
        prepare_private_dir(&dir)?;
        prune_stale(&dir);
        let path = write_private_png(&dir, rgba, width, height)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| AppError::Other(format!("clipboard worker failed: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_clipboard_image_dimensions_and_size() {
        assert!(validated_rgba_len(1, 1, 4).unwrap());
        assert!(!validated_rgba_len(1, 1, 3).unwrap());
        assert!(validated_rgba_len(u32::MAX, u32::MAX, 0).is_err());
        assert!(validated_rgba_len(4096, 4097, 0).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn clipboard_cache_and_images_use_private_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!("sageport-clipboard-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        prepare_private_dir(&root).unwrap();
        let path = write_private_png(&root, &[0, 0, 0, 255], 1, 1).unwrap();

        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        fs::remove_dir_all(root).unwrap();
    }
}
