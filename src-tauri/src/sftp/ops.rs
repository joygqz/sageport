use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use russh_sftp::client::fs::Metadata;
use russh_sftp::client::SftpSession;

use super::path::sort_entries;
use super::{FileEntry, MAX_EDIT_BYTES};
#[cfg(not(unix))]
use crate::error::AppError;
use crate::error::AppResult;

fn file_entry(name: String, path: String, meta: &Metadata) -> FileEntry {
    let file_type = meta.file_type();
    let is_symlink = file_type.is_symlink();
    let kind = if is_symlink {
        "symlink"
    } else if file_type.is_dir() {
        "dir"
    } else {
        "file"
    };
    FileEntry {
        name,
        path,
        kind: kind.to_string(),
        size: meta.size.unwrap_or(0),
        modified: meta.mtime.map(|m| m as i64),
        permissions: meta.permissions,
        is_symlink,
    }
}

pub async fn remote_list(session: &SftpSession, path: &str) -> AppResult<Vec<FileEntry>> {
    let mut entries = Vec::new();
    for entry in session.read_dir(path).await? {
        let name = entry.file_name();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        entries.push(file_entry(name, entry.path(), &entry.metadata()));
    }
    sort_entries(&mut entries);
    Ok(entries)
}

pub async fn remote_realpath(session: &SftpSession, path: &str) -> AppResult<String> {
    Ok(session.canonicalize(path).await?)
}

pub async fn remote_mkdir(session: &SftpSession, path: &str) -> AppResult<()> {
    session.create_dir(path).await?;
    Ok(())
}

pub async fn remote_rename(session: &SftpSession, from: &str, to: &str) -> AppResult<()> {
    session.rename(from, to).await?;
    Ok(())
}

pub async fn remote_remove(session: &SftpSession, path: &str, is_dir: bool) -> AppResult<()> {
    if !is_dir {
        session.remove_file(path).await?;
        return Ok(());
    }
    for entry in session.read_dir(path).await? {
        let name = entry.file_name();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let file_type = entry.file_type();
        let child_is_dir = file_type.is_dir() && !file_type.is_symlink();
        Box::pin(remote_remove(session, &entry.path(), child_is_dir)).await?;
    }
    session.remove_dir(path).await?;
    Ok(())
}

pub async fn remote_read(session: &SftpSession, path: &str) -> AppResult<Vec<u8>> {
    let meta = session.metadata(path).await?;
    if meta.size.unwrap_or(0) > MAX_EDIT_BYTES {
        return Err(super::edit_too_large_error());
    }
    Ok(session.read(path).await?)
}

pub async fn remote_write(session: &SftpSession, path: &str, data: &[u8]) -> AppResult<()> {
    session.write(path, data).await?;
    Ok(())
}

pub async fn remote_chmod(session: &SftpSession, path: &str, mode: u32) -> AppResult<()> {
    let current = session.metadata(path).await?;
    let type_bits = current.permissions.unwrap_or(0) & 0o170000;
    let meta = Metadata {
        size: None,
        uid: None,
        user: None,
        gid: None,
        group: None,
        permissions: Some(type_bits | (mode & 0o7777)),
        atime: None,
        mtime: None,
    };
    session.set_metadata(path, meta).await?;
    Ok(())
}

pub async fn remote_file_size(session: &SftpSession, path: &str) -> AppResult<u64> {
    Ok(session.metadata(path).await?.size.unwrap_or(0))
}

pub fn local_list(path: &str) -> AppResult<Vec<FileEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let file_type = entry.file_type()?;
        let is_symlink = file_type.is_symlink();
        let kind = if is_symlink {
            "symlink"
        } else if meta.is_dir() {
            "dir"
        } else {
            "file"
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        #[cfg(unix)]
        let permissions = {
            use std::os::unix::fs::PermissionsExt;
            Some(meta.permissions().mode())
        };
        #[cfg(not(unix))]
        let permissions = None;
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            kind: kind.to_string(),
            size: meta.len(),
            modified,
            permissions,
            is_symlink,
        });
    }
    sort_entries(&mut entries);
    Ok(entries)
}

pub fn local_chmod(path: &str, mode: u32) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode & 0o7777))?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
        Err(AppError::Invalid(
            "changing permissions is not supported on this platform".into(),
        ))
    }
}

pub fn local_size(path: &Path) -> AppResult<u64> {
    let meta = fs::symlink_metadata(path)?;
    if meta.is_dir() {
        let mut total = 0;
        for entry in fs::read_dir(path)? {
            total += local_size(&entry?.path())?;
        }
        Ok(total)
    } else {
        Ok(meta.len())
    }
}
