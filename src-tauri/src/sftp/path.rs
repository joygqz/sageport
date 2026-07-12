use std::path::{Component, Path, PathBuf};

use super::FileEntry;

pub fn base_name(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .to_string()
}

pub fn parent_remote(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) => "/".to_string(),
        Some(i) => trimmed[..i].to_string(),
        None => ".".to_string(),
    }
}

pub fn join_remote(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

pub fn normalize_remote_path(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    let body = parts.join("/");
    if absolute {
        if body.is_empty() {
            "/".to_string()
        } else {
            format!("/{body}")
        }
    } else if body.is_empty() {
        ".".to_string()
    } else {
        body
    }
}

pub fn remote_is_child_path(parent: &str, child: &str) -> bool {
    if parent == "/" {
        return child != "/";
    }
    child
        .strip_prefix(parent)
        .is_some_and(|rest| rest.starts_with('/'))
}

pub fn clean_local_path(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                out.push(component.as_os_str());
            }
        }
    }
    out
}

pub fn normalize_local_path(path: &Path) -> PathBuf {
    let absolute = dunce::canonicalize(path).unwrap_or_else(|_| {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(path)
        }
    });
    clean_local_path(&absolute)
}

pub fn dest_join(dest_dir_conn: Option<&str>, dest_dir_path: &str, name: &str) -> String {
    match dest_dir_conn {
        None => Path::new(dest_dir_path)
            .join(name)
            .to_string_lossy()
            .into_owned(),
        Some(_) => join_remote(dest_dir_path, name),
    }
}

pub fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|a, b| {
        let a_dir = a.kind == "dir";
        let b_dir = b.kind == "dir";
        b_dir
            .cmp(&a_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
}

pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_path_normalization_preserves_root_boundaries() {
        assert_eq!(normalize_remote_path("/srv/app/../app/."), "/srv/app");
        assert!(remote_is_child_path("/srv/app", "/srv/app/logs"));
        assert!(!remote_is_child_path("/srv/app", "/srv/application"));
        assert!(!remote_is_child_path("/srv/app", "/srv/app"));
    }

    #[test]
    fn local_path_cleaning_removes_dot_segments() {
        let cleaned = clean_local_path(Path::new("/tmp/sageport/../sageport/./file"));
        assert!(cleaned.ends_with(Path::new("sageport/file")));
    }

    #[test]
    fn base_name_handles_trailing_slashes() {
        assert_eq!(base_name("/srv/app/"), "app");
        assert_eq!(base_name("/srv/app"), "app");
        assert_eq!(base_name("file.txt"), "file.txt");
    }

    #[test]
    fn parent_remote_resolves_root() {
        assert_eq!(parent_remote("/etc/hosts"), "/etc");
        assert_eq!(parent_remote("/etc"), "/");
        assert_eq!(parent_remote("name"), ".");
    }

    #[test]
    fn sh_quote_escapes_single_quotes() {
        assert_eq!(sh_quote("a'b"), "'a'\\''b'");
    }
}
