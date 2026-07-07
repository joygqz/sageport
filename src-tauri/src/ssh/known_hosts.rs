use std::path::PathBuf;

use russh::keys::ssh_key::{HashAlg, PublicKey};
use tauri::{AppHandle, Manager};

pub enum KnownHostStatus {
    Trusted,
    Unknown,
    Changed,
}

pub fn app_known_hosts_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    Some(dir.join("known_hosts"))
}

fn user_known_hosts_path() -> Option<PathBuf> {
    dirs_home().map(|home| home.join(".ssh").join("known_hosts"))
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

pub fn evaluate(app: &AppHandle, host: &str, port: u16, key: &PublicKey) -> KnownHostStatus {
    let mut changed = false;
    for path in [app_known_hosts_path(app), user_known_hosts_path()]
        .into_iter()
        .flatten()
    {
        if !path.exists() {
            continue;
        }
        match russh::keys::check_known_hosts_path(host, port, key, &path) {
            Ok(true) => return KnownHostStatus::Trusted,
            Ok(false) => {}
            Err(_) => changed = true,
        }
    }
    if changed {
        KnownHostStatus::Changed
    } else {
        KnownHostStatus::Unknown
    }
}

pub fn learn(app: &AppHandle, host: &str, port: u16, key: &PublicKey) {
    if let Some(path) = app_known_hosts_path(app) {
        let _ = russh::keys::known_hosts::learn_known_hosts_path(host, port, key, &path);
    }
}

pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}
