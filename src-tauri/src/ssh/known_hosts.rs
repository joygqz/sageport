use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

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

pub fn learn(
    app: &AppHandle,
    host: &str,
    port: u16,
    key: &PublicKey,
) -> Result<(), russh::keys::Error> {
    let path = app_known_hosts_path(app).ok_or(russh::keys::Error::NoHomeDir)?;
    remember_path(&path, host, port, key)
}

pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

fn remember_path(
    path: &Path,
    host: &str,
    port: u16,
    key: &PublicKey,
) -> Result<(), russh::keys::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
        }
    }
    let previous = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.into()),
    };
    let host_token = if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    };
    let public_key = key.to_openssh()?;
    let contents = replace_host_entry(&previous, &host_token, &public_key);
    write_atomic_private(path, contents.as_bytes())?;

    Ok(())
}

fn write_atomic_private(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if path
        .symlink_metadata()
        .is_ok_and(|metadata| !metadata.file_type().is_file())
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "known_hosts path must be a regular file",
        ));
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let name = path.file_name().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "known_hosts path must include a file name",
        )
    })?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        name.to_string_lossy(),
        uuid::Uuid::new_v4()
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| -> std::io::Result<()> {
        let mut file = options.open(&temp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);

        #[cfg(not(windows))]
        fs::rename(&temp, path)?;
        #[cfg(windows)]
        if path.exists() {
            let backup = parent.join(format!(
                ".{}.{}.bak",
                name.to_string_lossy(),
                uuid::Uuid::new_v4()
            ));
            fs::rename(path, &backup)?;
            if let Err(error) = fs::rename(&temp, path) {
                let _ = fs::rename(&backup, path);
                return Err(error);
            }
            fs::remove_file(backup)?;
        } else {
            fs::rename(&temp, path)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn replace_host_entry(contents: &str, host: &str, public_key: &str) -> String {
    let mut output = String::new();
    let algorithm = public_key.split_whitespace().next();
    for line in contents.lines() {
        let mut fields = line.split_whitespace();
        let Some(token) = fields.next() else {
            output.push('\n');
            continue;
        };
        if token.starts_with('#') {
            output.push_str(line);
            output.push('\n');
            continue;
        }
        let replace = fields.next() == algorithm;
        let hosts = token
            .split(',')
            .filter(|candidate| !replace || *candidate != host)
            .collect::<Vec<_>>();
        if hosts.len() == token.split(',').count() {
            output.push_str(line);
            output.push('\n');
        } else if !hosts.is_empty() {
            output.push_str(&hosts.join(","));
            output.push_str(&line[token.len()..]);
            output.push('\n');
        }
    }
    output.push_str(host);
    output.push(' ');
    output.push_str(public_key);
    output.push('\n');
    output
}

#[cfg(test)]
mod tests {
    use super::{replace_host_entry, write_atomic_private};
    use std::fs;

    #[test]
    fn remembered_key_replaces_the_previous_entry_for_that_host() {
        let contents = concat!(
            "# keep this comment\n",
            "example.com ssh-ed25519 OLD\n",
            "alias,example.com ssh-rsa SHARED\n",
            "alias2,example.com ssh-ed25519 SHARED-OLD\n",
            "other.example ssh-ed25519 OTHER\n",
        );

        let replaced = replace_host_entry(contents, "example.com", "ssh-ed25519 NEW");

        assert_eq!(
            replaced,
            concat!(
                "# keep this comment\n",
                "alias,example.com ssh-rsa SHARED\n",
                "alias2 ssh-ed25519 SHARED-OLD\n",
                "other.example ssh-ed25519 OTHER\n",
                "example.com ssh-ed25519 NEW\n",
            )
        );
    }

    #[test]
    fn remembered_nonstandard_port_only_replaces_its_bracketed_entry() {
        let contents = concat!(
            "example.com ssh-ed25519 DEFAULT\n",
            "[example.com]:2222 ssh-ed25519 OLD\n",
        );

        let replaced = replace_host_entry(contents, "[example.com]:2222", "ssh-ed25519 NEW");

        assert!(replaced.contains("example.com ssh-ed25519 DEFAULT\n"));
        assert!(!replaced.contains("ssh-ed25519 OLD"));
        assert!(replaced.ends_with("[example.com]:2222 ssh-ed25519 NEW\n"));
    }

    #[test]
    #[cfg(unix)]
    fn known_hosts_replacement_is_private_and_rejects_symlinks() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let dir = std::env::temp_dir().join(format!("sageport-known-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("known_hosts");
        write_atomic_private(&path, b"first\n").unwrap();
        write_atomic_private(&path, b"second\n").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second\n");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let link = dir.join("linked");
        symlink(&path, &link).unwrap();
        assert!(write_atomic_private(&link, b"overwrite\n").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"second\n");
        fs::remove_dir_all(dir).unwrap();
    }
}
