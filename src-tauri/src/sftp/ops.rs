use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use std::time::UNIX_EPOCH;

use russh_sftp::client::fs::Metadata;
use russh_sftp::client::SftpSession;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::path::{join_remote, parent_remote, sort_entries};
use super::{FileEntry, MAX_EDIT_BYTES};
#[cfg(not(unix))]
use crate::error::AppError;
use crate::error::AppResult;

fn file_entry(name: String, path: String, meta: &Metadata, is_symlink: bool) -> FileEntry {
    let hidden = name.starts_with('.');
    let kind = if meta.file_type().is_dir() {
        "dir"
    } else if is_symlink && meta.file_type().is_symlink() {
        "symlink"
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
        hidden,
    }
}

pub async fn remote_list(session: &SftpSession, path: &str) -> AppResult<Vec<FileEntry>> {
    let mut entries = Vec::new();
    for entry in session.read_dir(path).await? {
        let name = entry.file_name();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }
        let path = entry.path();
        let link_meta = entry.metadata();
        let is_symlink = link_meta.file_type().is_symlink();
        let meta = if is_symlink {
            session.metadata(&path).await.unwrap_or(link_meta)
        } else {
            link_meta
        };
        entries.push(file_entry(name, path, &meta, is_symlink));
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

pub async fn remote_remove(session: &SftpSession, path: &str, _is_dir: bool) -> AppResult<()> {
    remote_remove_node(session, path, None).await
}

fn remote_remove_node<'a>(
    session: &'a SftpSession,
    path: &'a str,
    known_metadata: Option<Metadata>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = AppResult<()>> + Send + 'a>> {
    Box::pin(async move {
        let meta = match known_metadata {
            Some(meta) if meta.file_type().is_file() || meta.file_type().is_symlink() => meta,
            _ => session.symlink_metadata(path).await?,
        };
        if !meta.file_type().is_dir() || meta.file_type().is_symlink() {
            session.remove_file(path).await?;
            return Ok(());
        }
        for entry in session.read_dir(path).await? {
            let name = entry.file_name();
            if name.is_empty() || name == "." || name == ".." {
                continue;
            }
            let entry_path = entry.path();
            remote_remove_node(session, &entry_path, Some(entry.metadata())).await?;
        }
        session.remove_dir(path).await?;
        Ok(())
    })
}

pub async fn remote_read(session: &SftpSession, path: &str) -> AppResult<Vec<u8>> {
    let meta = session.metadata(path).await?;
    if meta.size.unwrap_or(0) > MAX_EDIT_BYTES {
        return Err(super::edit_too_large_error());
    }
    let file = session.open(path).await?;
    let mut bytes = Vec::with_capacity(meta.size.unwrap_or(0) as usize);
    file.take(MAX_EDIT_BYTES + 1)
        .read_to_end(&mut bytes)
        .await?;
    if bytes.len() as u64 > MAX_EDIT_BYTES {
        return Err(super::edit_too_large_error());
    }
    Ok(bytes)
}

pub async fn remote_write(
    session: &SftpSession,
    path: &str,
    data: &[u8],
    expected: Option<&[u8]>,
) -> AppResult<()> {
    if data.len() as u64 > MAX_EDIT_BYTES {
        return Err(super::edit_too_large_error());
    }
    if let Some(expected) = expected {
        if remote_read(session, path).await? != expected {
            return Err(edit_conflict_error());
        }
    }

    let existed = session.try_exists(path).await?;
    let permissions = if existed {
        session.metadata(path).await?.permissions
    } else {
        None
    };
    let parent = parent_remote(path);
    let temp = join_remote(&parent, &format!(".sageport-save-{}", uuid::Uuid::new_v4()));
    let backup = join_remote(
        &parent,
        &format!(".sageport-backup-{}", uuid::Uuid::new_v4()),
    );

    let write_result = async {
        let mut file = session.create(&temp).await?;
        file.write_all(data).await?;
        file.flush().await?;
        file.sync_all().await?;
        file.shutdown().await?;
        if let Some(permissions) = permissions {
            session
                .set_metadata(
                    &temp,
                    Metadata {
                        permissions: Some(permissions),
                        ..Metadata::default()
                    },
                )
                .await?;
        }
        Ok::<(), crate::error::AppError>(())
    }
    .await;
    if let Err(error) = write_result {
        let _ = session.remove_file(&temp).await;
        return Err(error);
    }

    if existed {
        if let Err(error) = session.rename(path, &backup).await {
            let _ = session.remove_file(&temp).await;
            return Err(error.into());
        }
        if let Err(error) = session.rename(&temp, path).await {
            let _ = session.rename(&backup, path).await;
            let _ = session.remove_file(&temp).await;
            return Err(error.into());
        }
        let _ = session.remove_file(&backup).await;
    } else if let Err(error) = session.rename(&temp, path).await {
        let _ = session.remove_file(&temp).await;
        return Err(error.into());
    }
    Ok(())
}

fn edit_conflict_error() -> crate::error::AppError {
    crate::error::AppError::Conflict(
        "file changed since it was opened; reload it before saving".into(),
    )
}

pub fn local_read(path: &str) -> AppResult<Vec<u8>> {
    let file = fs::File::open(path)?;
    if file.metadata()?.len() > MAX_EDIT_BYTES {
        return Err(super::edit_too_large_error());
    }
    let mut bytes = Vec::new();
    file.take(MAX_EDIT_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_EDIT_BYTES {
        return Err(super::edit_too_large_error());
    }
    Ok(bytes)
}

pub fn local_write(path: &str, data: &[u8], expected: Option<&[u8]>) -> AppResult<()> {
    if data.len() as u64 > MAX_EDIT_BYTES {
        return Err(super::edit_too_large_error());
    }
    if let Some(expected) = expected {
        if local_read(path)? != expected {
            return Err(edit_conflict_error());
        }
    }

    let target = Path::new(path);
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let temp = parent.join(format!(".sageport-save-{}", uuid::Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp)?;
    let result = (|| -> AppResult<()> {
        file.write_all(data)?;
        file.sync_all()?;
        if let Ok(metadata) = fs::metadata(target) {
            fs::set_permissions(&temp, metadata.permissions())?;
        }
        #[cfg(not(windows))]
        fs::rename(&temp, target)?;
        #[cfg(windows)]
        {
            if target.exists() {
                let backup = parent.join(format!(".sageport-backup-{}", uuid::Uuid::new_v4()));
                fs::rename(target, &backup)?;
                if let Err(error) = fs::rename(&temp, target) {
                    let _ = fs::rename(&backup, target);
                    return Err(error.into());
                }
                let _ = fs::remove_file(backup);
            } else {
                fs::rename(&temp, target)?;
            }
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
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
        let link_meta = match fs::symlink_metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_symlink = link_meta.file_type().is_symlink();
        let meta = if is_symlink {
            fs::metadata(entry.path()).unwrap_or(link_meta)
        } else {
            link_meta
        };
        let kind = if meta.is_dir() {
            "dir"
        } else if is_symlink && meta.file_type().is_symlink() {
            "symlink"
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
        let name = entry.file_name().to_string_lossy().into_owned();
        #[cfg(windows)]
        let hidden = {
            use std::os::windows::fs::MetadataExt;
            name.starts_with('.') || meta.file_attributes() & 0x2 != 0
        };
        #[cfg(not(windows))]
        let hidden = name.starts_with('.');
        entries.push(FileEntry {
            name,
            path: entry.path().to_string_lossy().into_owned(),
            kind: kind.to_string(),
            size: meta.len(),
            modified,
            permissions,
            is_symlink,
            hidden,
        });
    }
    sort_entries(&mut entries);
    Ok(entries)
}

pub fn local_remove(path: &str) -> AppResult<()> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() {
        #[cfg(windows)]
        {
            if fs::metadata(path).is_ok_and(|target| target.is_dir()) {
                fs::remove_dir(path)?;
            } else {
                fs::remove_file(path)?;
            }
        }
        #[cfg(not(windows))]
        fs::remove_file(path)?;
    } else if meta.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
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
    if meta.file_type().is_symlink() {
        return Err(crate::error::AppError::Invalid(
            "symbolic link transfer requires archive support".into(),
        ));
    }
    if meta.is_dir() {
        let mut total: u64 = 0;
        for entry in fs::read_dir(path)? {
            total = total
                .checked_add(local_size(&entry?.path())?)
                .ok_or_else(|| crate::error::AppError::Invalid("transfer is too large".into()))?;
        }
        Ok(total)
    } else {
        Ok(meta.len())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{local_list, local_read, local_remove, local_size, local_write};
    use crate::error::AppError;
    use std::fs;
    use std::os::unix::fs::symlink;

    #[test]
    fn directory_symlinks_are_browsable_but_delete_does_not_follow_them() {
        let root = std::env::temp_dir().join(format!(
            "sageport-sftp-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        let _ = fs::remove_dir_all(&root);
        let target = root.join("target");
        fs::create_dir_all(&target).expect("create target");
        fs::write(target.join("keep.txt"), b"keep").expect("write target file");
        fs::write(root.join(".hidden"), b"hidden").expect("write hidden file");
        symlink(&target, root.join("link")).expect("create symlink");

        let entries = local_list(root.to_str().expect("utf-8 temp path")).expect("list root");
        let link = entries
            .iter()
            .find(|entry| entry.name == "link")
            .expect("symlink entry");
        assert_eq!(link.kind, "dir");
        assert!(link.is_symlink);
        assert!(entries
            .iter()
            .find(|entry| entry.name == ".hidden")
            .is_some_and(|entry| entry.hidden));
        assert!(matches!(
            local_size(&root.join("link")),
            Err(AppError::Invalid(_))
        ));

        local_remove(link.path.as_str()).expect("remove symlink");
        assert!(target.join("keep.txt").exists());
        assert!(!root.join("link").exists());
        fs::remove_dir_all(root).expect("clean temp tree");
    }

    #[test]
    fn text_writes_replace_shorter_content_and_detect_external_changes() {
        let root = std::env::temp_dir().join(format!(
            "sageport-edit-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp tree");
        let path = root.join("config.txt");
        fs::write(&path, b"original content").expect("seed file");

        local_write(
            path.to_str().expect("utf-8 path"),
            b"short",
            Some(b"original content"),
        )
        .expect("replace content");
        assert_eq!(
            local_read(path.to_str().expect("utf-8 path")).expect("read replacement"),
            b"short"
        );

        fs::write(&path, b"external edit").expect("external edit");
        let error = local_write(
            path.to_str().expect("utf-8 path"),
            b"editor edit",
            Some(b"short"),
        )
        .expect_err("stale editor content must not overwrite the file");
        assert!(matches!(error, AppError::Conflict(_)));
        assert_eq!(
            fs::read(&path).expect("preserve external edit"),
            b"external edit"
        );

        let oversized = vec![b'x'; super::MAX_EDIT_BYTES as usize + 1];
        let error = local_write(path.to_str().expect("utf-8 path"), &oversized, None)
            .expect_err("oversized editor writes must be rejected");
        assert!(matches!(error, AppError::Invalid(_)));
        assert_eq!(
            fs::read(&path).expect("preserve content after oversized write"),
            b"external edit"
        );

        fs::remove_dir_all(root).expect("clean temp tree");
    }
}
