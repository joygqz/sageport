use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

const PORTABLE_DIR: &str = "data";
const DATA_DIR_ENV: &str = "SAGEPORT_DATA_DIR";

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn initialize(app: &AppHandle) -> AppResult<PathBuf> {
    if let Some(dir) = DATA_DIR.get() {
        return Ok(dir.clone());
    }
    let dir = match resolve_override() {
        Some(dir) => dir,
        None => app
            .path()
            .app_data_dir()
            .map_err(|error| AppError::Other(format!("cannot locate application data: {error}")))?,
    };
    let _ = DATA_DIR.set(dir.clone());
    Ok(dir)
}

pub fn data_dir() -> Option<&'static Path> {
    DATA_DIR.get().map(PathBuf::as_path)
}

pub fn is_portable() -> bool {
    portable_dir().is_some()
}

fn resolve_override() -> Option<PathBuf> {
    if let Some(value) = std::env::var_os(DATA_DIR_ENV).filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(value));
    }
    portable_dir()
}

fn portable_dir() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let dir = executable.parent()?.join(PORTABLE_DIR);
    dir.is_dir().then_some(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_data_directory_overrides_every_other_location() {
        let dir = std::env::temp_dir().join(format!("sageport-data-{}", uuid::Uuid::new_v4()));
        std::env::set_var(DATA_DIR_ENV, &dir);
        assert_eq!(resolve_override(), Some(dir));

        std::env::set_var(DATA_DIR_ENV, "");
        assert_eq!(resolve_override(), portable_dir());
        std::env::remove_var(DATA_DIR_ENV);
    }

    #[test]
    fn a_portable_build_is_detected_by_the_data_directory_beside_the_executable() {
        let executable = std::env::current_exe().unwrap();
        let beside = executable.parent().unwrap().join(PORTABLE_DIR);
        assert_eq!(portable_dir().is_some(), beside.is_dir());
        assert_eq!(is_portable(), beside.is_dir());
    }
}
