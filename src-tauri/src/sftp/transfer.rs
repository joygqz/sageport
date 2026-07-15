use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tauri::AppHandle;
use tokio::fs;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::path::{
    base_name, clean_local_path, dest_join, join_remote, normalize_local_path,
    normalize_remote_path, parent_remote, remote_is_child_path, sh_quote,
};
use super::{emit_transfer_event, ops, SftpManager, TransferCancel};
use crate::error::{connection_lost, AppError, AppResult};

const CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);
const PHASE_COMPRESS: &str = "compressing";
const PHASE_PREPARE: &str = "preparing";
const PHASE_TRANSFER: &str = "transferring";
const PHASE_EXTRACT: &str = "extracting";

pub struct Endpoint {
    pub connection_id: Option<String>,
    pub path: String,
}

pub struct TransferOutcome {
    pub transferred: u64,
    pub total: u64,
    pub status: &'static str,
    pub message: Option<String>,
}

#[derive(Clone)]
struct ProgressCtx {
    transfer_id: String,
    base: u64,
    total: u64,
    label: String,
    silent: bool,
    phase: Option<String>,
    cancel: Arc<TransferCancel>,
    last_emit: Arc<Mutex<Instant>>,
}

fn map_stream_error(e: io::Error, remote: bool) -> AppError {
    if remote {
        match e.kind() {
            io::ErrorKind::TimedOut
            | io::ErrorKind::ConnectionAborted
            | io::ErrorKind::ConnectionReset
            | io::ErrorKind::BrokenPipe
            | io::ErrorKind::UnexpectedEof => connection_lost(e),
            _ => AppError::Io(e),
        }
    } else {
        AppError::Io(e)
    }
}

fn emit(app: &AppHandle, p: &ProgressCtx, done: u64, status: &str, message: Option<String>) {
    emit_transfer_event(
        app,
        &p.transfer_id,
        done,
        p.total,
        &p.label,
        status,
        p.phase.clone(),
        message,
        None,
    );
}

fn should_emit_progress(p: &ProgressCtx, done: u64) -> bool {
    if p.total > 0 && done >= p.total {
        return true;
    }
    let now = Instant::now();
    let mut last = p.last_emit.lock();
    if now.duration_since(*last) < PROGRESS_INTERVAL {
        return false;
    }
    *last = now;
    true
}

pub async fn transfer(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    source: &Endpoint,
    dest_dir: &Endpoint,
    cancel: Arc<TransferCancel>,
) -> TransferOutcome {
    let name = base_name(&source.path);
    emit_transfer_event(
        app,
        transfer_id,
        0,
        0,
        &name,
        "active",
        Some(PHASE_PREPARE.into()),
        None,
        None,
    );
    let validation = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(AppError::Cancelled),
        result = validate_transfer_target(mgr, source, dest_dir, &name) => result,
    };
    if let Err(e) = validation {
        let is_cancelled = matches!(&e, AppError::Cancelled);
        let status = if is_cancelled { "cancelled" } else { "error" };
        let message = (!is_cancelled).then(|| e.to_string());
        let code = (status == "error").then(|| e.code().to_string());
        emit_transfer_event(
            app,
            transfer_id,
            0,
            0,
            &name,
            status,
            None,
            message.clone(),
            code,
        );
        return outcome(0, 0, status, message);
    }

    let crosses_network = source.connection_id.is_some() || dest_dir.connection_id.is_some();
    let source_is_dir = tokio::select! {
        biased;
        _ = cancel.cancelled() => return cancelled(app, transfer_id, &name, 0, 0),
        result = is_dir(mgr, source) => result.unwrap_or(false),
    };
    let compress = if crosses_network && source_is_dir {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => return cancelled(app, transfer_id, &name, 0, 0),
            available = compression_available(mgr, source, dest_dir) => available,
        }
    } else {
        false
    };
    if compress {
        return transfer_compressed(app, mgr, transfer_id, source, dest_dir, cancel).await;
    }

    let total = tokio::select! {
        biased;
        _ = cancel.cancelled() => return cancelled(app, transfer_id, &name, 0, 0),
        result = source_size(mgr, source) => result.unwrap_or(0),
    };
    let progress = ProgressCtx {
        transfer_id: transfer_id.to_string(),
        base: 0,
        total,
        label: name.clone(),
        silent: false,
        phase: Some(PHASE_TRANSFER.to_string()),
        cancel,
        last_emit: Arc::new(Mutex::new(Instant::now())),
    };

    let staged_name = format!(".sageport-transfer-{}", uuid::Uuid::new_v4());
    let mut done = 0u64;
    let copy_result = tokio::select! {
        biased;
        _ = progress.cancel.cancelled() => Err(AppError::Cancelled),
        result = transfer_node(app, mgr, source, dest_dir, &staged_name, &progress, &mut done) => result,
    };
    let result = match copy_result {
        Ok(()) if progress.cancel.is_cancelled() => Err(AppError::Cancelled),
        Ok(()) => commit_staged(mgr, dest_dir, &staged_name, &name).await,
        Err(error) => Err(error),
    };
    if result.is_err() {
        cleanup_staged(mgr, dest_dir, &staged_name, source_is_dir).await;
    }
    match result {
        Ok(()) => {
            emit(app, &at(&progress, &name), done, "done", None);
            outcome(done, done, "done", None)
        }
        Err(AppError::Cancelled) => {
            emit(app, &at(&progress, &name), done, "cancelled", None);
            outcome(done, total, "cancelled", None)
        }
        Err(e) => {
            let message = e.to_string();
            emit_transfer_event(
                app,
                transfer_id,
                done,
                total,
                &name,
                "error",
                progress.phase.clone(),
                Some(message.clone()),
                Some(e.code().to_string()),
            );
            outcome(done, total, "error", Some(message))
        }
    }
}

async fn compression_available(mgr: &SftpManager, source: &Endpoint, dest_dir: &Endpoint) -> bool {
    let source_ready = match &source.connection_id {
        Some(id) => mgr.supports_tar(id).await,
        None => true,
    };
    if !source_ready {
        return false;
    }
    match &dest_dir.connection_id {
        Some(id) => mgr.supports_tar(id).await,
        None => true,
    }
}

fn cancelled(
    app: &AppHandle,
    transfer_id: &str,
    name: &str,
    transferred: u64,
    total: u64,
) -> TransferOutcome {
    emit_transfer_event(
        app,
        transfer_id,
        transferred,
        total,
        name,
        "cancelled",
        None,
        None,
        None,
    );
    outcome(transferred, total, "cancelled", None)
}

fn outcome(
    transferred: u64,
    total: u64,
    status: &'static str,
    message: Option<String>,
) -> TransferOutcome {
    TransferOutcome {
        transferred,
        total,
        status,
        message,
    }
}

fn at(p: &ProgressCtx, label: &str) -> ProgressCtx {
    ProgressCtx {
        label: label.to_string(),
        ..p.clone()
    }
}

async fn transfer_node(
    app: &AppHandle,
    mgr: &SftpManager,
    source: &Endpoint,
    dest_dir: &Endpoint,
    name: &str,
    progress: &ProgressCtx,
    done: &mut u64,
) -> AppResult<()> {
    if progress.cancel.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    if is_symlink(mgr, source).await? {
        return Err(AppError::Invalid(
            "symbolic link transfer requires archive support".into(),
        ));
    }
    let dest_path = dest_join(dest_dir.connection_id.as_deref(), &dest_dir.path, name);

    if is_dir(mgr, source).await? {
        make_dir(mgr, dest_dir, name).await?;
        let dest_child = Endpoint {
            connection_id: dest_dir.connection_id.clone(),
            path: dest_path,
        };
        for child in list(mgr, source).await? {
            let child_src = Endpoint {
                connection_id: source.connection_id.clone(),
                path: child.path,
            };
            Box::pin(transfer_node(
                app,
                mgr,
                &child_src,
                &dest_child,
                &child.name,
                progress,
                done,
            ))
            .await?;
        }
        copy_permissions(mgr, source, &dest_child).await?;
        Ok(())
    } else {
        let dest = Endpoint {
            connection_id: dest_dir.connection_id.clone(),
            path: dest_path,
        };
        copy_file(app, mgr, source, &dest, progress, done, name).await
    }
}

async fn copy_file(
    app: &AppHandle,
    mgr: &SftpManager,
    source: &Endpoint,
    dest: &Endpoint,
    progress: &ProgressCtx,
    done: &mut u64,
    _dest_name: &str,
) -> AppResult<()> {
    let size = file_size(mgr, source).await?;
    let ctx = ProgressCtx {
        base: *done,
        label: base_name(&source.path),
        ..progress.clone()
    };

    match (&source.connection_id, &dest.connection_id) {
        (None, None) => {
            let mut reader = fs::File::open(&source.path).await?;
            let mut writer = fs::File::create(&dest.path).await?;
            copy_stream(app, &mut reader, false, &mut writer, false, &ctx).await?;
        }
        (None, Some(dst_id)) => {
            let mut reader = fs::File::open(&source.path).await?;
            let conn = mgr.get(dst_id)?;
            let mut writer = conn.session().create(&dest.path).await?;
            copy_stream(app, &mut reader, false, &mut writer, true, &ctx).await?;
            writer.sync_all().await?;
        }
        (Some(src_id), None) => {
            let conn = mgr.get(src_id)?;
            let mut reader = conn.session().open(&source.path).await?;
            let mut writer = fs::File::create(&dest.path).await?;
            copy_stream(app, &mut reader, true, &mut writer, false, &ctx).await?;
        }
        (Some(src_id), Some(dst_id)) => {
            let src_conn = mgr.get(src_id)?;
            let dst_conn = mgr.get(dst_id)?;
            let mut reader = src_conn.session().open(&source.path).await?;
            let mut writer = dst_conn.session().create(&dest.path).await?;
            copy_stream(app, &mut reader, true, &mut writer, true, &ctx).await?;
            writer.sync_all().await?;
        }
    }

    copy_permissions(mgr, source, dest).await?;
    *done += size;
    Ok(())
}

async fn copy_permissions(mgr: &SftpManager, source: &Endpoint, dest: &Endpoint) -> AppResult<()> {
    let mode = match &source.connection_id {
        None => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                Some(fs::metadata(&source.path).await?.permissions().mode() & 0o7777)
            }
            #[cfg(not(unix))]
            None
        }
        Some(id) => mgr
            .get(id)?
            .session()
            .metadata(&source.path)
            .await?
            .permissions
            .map(|permissions| permissions & 0o7777),
    };
    let Some(mode) = mode else {
        return Ok(());
    };
    match &dest.connection_id {
        None => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&dest.path, std::fs::Permissions::from_mode(mode)).await?;
            }
            #[cfg(not(unix))]
            let _ = mode;
            Ok(())
        }
        Some(id) => mgr.chmod(id, &dest.path, mode).await,
    }
}

async fn copy_stream<R, W>(
    app: &AppHandle,
    reader: &mut R,
    remote_read: bool,
    writer: &mut W,
    remote_write: bool,
    progress: &ProgressCtx,
) -> AppResult<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buf = vec![0u8; CHUNK_SIZE];
    let mut done = progress.base;
    loop {
        if progress.cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        let n = tokio::select! {
            biased;
            _ = progress.cancel.cancelled() => return Err(AppError::Cancelled),
            result = reader.read(&mut buf) => result.map_err(|e| map_stream_error(e, remote_read))?,
        };
        if n == 0 {
            break;
        }
        tokio::select! {
            biased;
            _ = progress.cancel.cancelled() => return Err(AppError::Cancelled),
            result = writer.write_all(&buf[..n]) => result.map_err(|e| map_stream_error(e, remote_write))?,
        };
        done += n as u64;
        if !progress.silent && should_emit_progress(progress, done) {
            emit(app, progress, done, "active", None);
        }
    }
    tokio::select! {
        biased;
        _ = progress.cancel.cancelled() => return Err(AppError::Cancelled),
        result = writer.flush() => result.map_err(|e| map_stream_error(e, remote_write))?,
    };
    Ok(())
}

async fn validate_transfer_target(
    mgr: &SftpManager,
    source: &Endpoint,
    dest_dir: &Endpoint,
    name: &str,
) -> AppResult<()> {
    if target_exists(mgr, dest_dir, name).await? {
        return Err(AppError::Conflict(format!(
            "destination already contains {name}"
        )));
    }
    if source.connection_id != dest_dir.connection_id {
        return Ok(());
    }
    let source_is_dir = is_dir(mgr, source).await?;
    match &source.connection_id {
        None => {
            let source_path = normalize_local_path(Path::new(&source.path));
            let target_path =
                clean_local_path(&normalize_local_path(Path::new(&dest_dir.path)).join(name));
            if source_path == target_path {
                return Err(AppError::Invalid(
                    "cannot copy a file or folder onto itself".into(),
                ));
            }
            if source_is_dir && target_path.starts_with(&source_path) {
                return Err(AppError::Invalid(
                    "cannot copy a folder into itself or one of its subfolders".into(),
                ));
            }
        }
        Some(_) => {
            let source_path = normalize_remote_path(&source.path);
            let target_path = normalize_remote_path(&join_remote(&dest_dir.path, name));
            if source_path == target_path {
                return Err(AppError::Invalid(
                    "cannot copy a file or folder onto itself".into(),
                ));
            }
            if source_is_dir && remote_is_child_path(&source_path, &target_path) {
                return Err(AppError::Invalid(
                    "cannot copy a folder into itself or one of its subfolders".into(),
                ));
            }
        }
    }
    Ok(())
}

async fn source_size(mgr: &SftpManager, ep: &Endpoint) -> AppResult<u64> {
    if !is_dir(mgr, ep).await? {
        return file_size(mgr, ep).await;
    }
    match &ep.connection_id {
        None => {
            let path = ep.path.clone();
            tokio::task::spawn_blocking(move || ops::local_size(Path::new(&path)))
                .await
                .map_err(|e| AppError::Other(format!("task join error: {e}")))?
        }
        Some(id) => remote_size(mgr, id, &ep.path).await,
    }
}

async fn remote_size(mgr: &SftpManager, id: &str, path: &str) -> AppResult<u64> {
    let mut total: u64 = 0;
    for entry in mgr.list(id, path).await? {
        if entry.is_symlink {
            return Err(AppError::Invalid(
                "symbolic link transfer requires archive support".into(),
            ));
        }
        let size = if entry.kind == "dir" {
            Box::pin(remote_size(mgr, id, &entry.path)).await?
        } else {
            entry.size
        };
        total = total
            .checked_add(size)
            .ok_or_else(|| AppError::Invalid("transfer is too large".into()))?;
    }
    Ok(total)
}

async fn target_exists(mgr: &SftpManager, dest_dir: &Endpoint, name: &str) -> AppResult<bool> {
    match &dest_dir.connection_id {
        None => Ok(fs::try_exists(Path::new(&dest_dir.path).join(name)).await?),
        Some(id) => Ok(mgr
            .list(id, &dest_dir.path)
            .await?
            .iter()
            .any(|entry| entry.name == name)),
    }
}

async fn commit_staged(
    mgr: &SftpManager,
    dest_dir: &Endpoint,
    staged_name: &str,
    final_name: &str,
) -> AppResult<()> {
    if target_exists(mgr, dest_dir, final_name).await? {
        return Err(AppError::Conflict(format!(
            "destination already contains {final_name}"
        )));
    }
    let from = dest_join(
        dest_dir.connection_id.as_deref(),
        &dest_dir.path,
        staged_name,
    );
    let to = dest_join(
        dest_dir.connection_id.as_deref(),
        &dest_dir.path,
        final_name,
    );
    match &dest_dir.connection_id {
        None => Ok(fs::rename(from, to).await?),
        Some(id) => mgr.rename(id, &from, &to).await,
    }
}

async fn cleanup_staged(mgr: &SftpManager, dest_dir: &Endpoint, staged_name: &str, is_dir: bool) {
    let path = dest_join(
        dest_dir.connection_id.as_deref(),
        &dest_dir.path,
        staged_name,
    );
    let cleanup = async {
        match &dest_dir.connection_id {
            None if is_dir => fs::remove_dir_all(&path).await.map_err(AppError::from),
            None => fs::remove_file(&path).await.map_err(AppError::from),
            Some(id) => mgr.remove(id, &path, is_dir).await,
        }
    };
    let _ = tokio::time::timeout(Duration::from_secs(5), cleanup).await;
}

async fn file_size(mgr: &SftpManager, ep: &Endpoint) -> AppResult<u64> {
    match &ep.connection_id {
        None => Ok(fs::symlink_metadata(&ep.path).await?.len()),
        Some(id) => {
            let name = base_name(&ep.path);
            let parent = parent_remote(&ep.path);
            for e in mgr.list(id, &parent).await? {
                if e.name == name {
                    return Ok(e.size);
                }
            }
            Ok(0)
        }
    }
}

async fn is_dir(mgr: &SftpManager, ep: &Endpoint) -> AppResult<bool> {
    match &ep.connection_id {
        None => Ok(fs::symlink_metadata(&ep.path).await?.is_dir()),
        Some(id) => {
            let name = base_name(&ep.path);
            let parent = parent_remote(&ep.path);
            for e in mgr.list(id, &parent).await? {
                if e.name == name {
                    return Ok(e.kind == "dir");
                }
            }
            Ok(false)
        }
    }
}

async fn is_symlink(mgr: &SftpManager, ep: &Endpoint) -> AppResult<bool> {
    match &ep.connection_id {
        None => Ok(fs::symlink_metadata(&ep.path)
            .await?
            .file_type()
            .is_symlink()),
        Some(id) => {
            let name = base_name(&ep.path);
            let parent = parent_remote(&ep.path);
            Ok(mgr
                .list(id, &parent)
                .await?
                .iter()
                .find(|entry| entry.name == name)
                .is_some_and(|entry| entry.is_symlink))
        }
    }
}

async fn list(mgr: &SftpManager, ep: &Endpoint) -> AppResult<Vec<super::FileEntry>> {
    match &ep.connection_id {
        None => {
            let path = ep.path.clone();
            tokio::task::spawn_blocking(move || ops::local_list(&path))
                .await
                .map_err(|e| AppError::Other(format!("task join error: {e}")))?
        }
        Some(id) => mgr.list(id, &ep.path).await,
    }
}

async fn make_dir(mgr: &SftpManager, dest_dir: &Endpoint, name: &str) -> AppResult<()> {
    let path = dest_join(dest_dir.connection_id.as_deref(), &dest_dir.path, name);
    match &dest_dir.connection_id {
        None => {
            fs::create_dir_all(&path).await?;
            Ok(())
        }
        Some(id) => {
            if mgr.list(id, &path).await.is_ok() {
                return Ok(());
            }
            mgr.mkdir(id, &path).await
        }
    }
}

async fn transfer_compressed(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    source: &Endpoint,
    dest_dir: &Endpoint,
    cancel: Arc<TransferCancel>,
) -> TransferOutcome {
    let name = base_name(&source.path);
    let notify =
        |transferred: u64, total: u64, status: &str, phase: Option<&str>, msg: Option<String>| {
            emit_transfer_event(
                app,
                transfer_id,
                transferred,
                total,
                &name,
                status,
                phase.map(str::to_string),
                msg,
                None,
            );
        };

    if cancel.is_cancelled() {
        notify(0, 0, "cancelled", None, None);
        return outcome(0, 0, "cancelled", None);
    }
    notify(0, 0, "active", Some(PHASE_COMPRESS), None);

    let result: AppResult<u64> = match (&source.connection_id, &dest_dir.connection_id) {
        (None, Some(dst)) => {
            compressed_local_to_remote(
                app,
                mgr,
                transfer_id,
                &name,
                &source.path,
                dst,
                &dest_dir.path,
                cancel,
            )
            .await
        }
        (Some(src), None) => {
            compressed_remote_to_local(
                app,
                mgr,
                transfer_id,
                &name,
                src,
                &source.path,
                &dest_dir.path,
                cancel,
            )
            .await
        }
        (Some(src), Some(dst)) => {
            compressed_remote_to_remote(
                app,
                mgr,
                transfer_id,
                &name,
                src,
                &source.path,
                dst,
                &dest_dir.path,
                cancel,
            )
            .await
        }
        (None, None) => Ok(0),
    };

    match result {
        Ok(size) => {
            notify(size, size, "done", None, None);
            outcome(size, size, "done", None)
        }
        Err(AppError::Cancelled) => {
            notify(0, 0, "cancelled", None, None);
            outcome(0, 0, "cancelled", None)
        }
        Err(e) => {
            let message = e.to_string();
            emit_transfer_event(
                app,
                transfer_id,
                0,
                0,
                &name,
                "error",
                None,
                Some(message.clone()),
                Some(e.code().to_string()),
            );
            outcome(0, 0, "error", Some(message))
        }
    }
}

fn xfer_ctx(
    transfer_id: &str,
    label: &str,
    total: u64,
    silent: bool,
    cancel: Arc<TransferCancel>,
) -> ProgressCtx {
    ProgressCtx {
        transfer_id: transfer_id.to_string(),
        base: 0,
        total,
        label: label.to_string(),
        silent,
        phase: Some(PHASE_TRANSFER.to_string()),
        cancel,
        last_emit: Arc::new(Mutex::new(Instant::now())),
    }
}

async fn upload_archive(
    app: &AppHandle,
    mgr: &SftpManager,
    dst_id: &str,
    local: &Path,
    remote: &str,
    ctx: &ProgressCtx,
) -> AppResult<()> {
    let mut reader = fs::File::open(local).await?;
    let conn = mgr.get(dst_id)?;
    let mut writer = tokio::select! {
        biased;
        _ = ctx.cancel.cancelled() => return Err(AppError::Cancelled),
        result = conn.session().create(remote) => result?,
    };
    mgr.chmod(dst_id, remote, 0o600).await?;
    copy_stream(app, &mut reader, false, &mut writer, true, ctx).await?;
    tokio::select! {
        biased;
        _ = ctx.cancel.cancelled() => return Err(AppError::Cancelled),
        result = writer.sync_all() => result?,
    }
    Ok(())
}

async fn download_archive(
    app: &AppHandle,
    mgr: &SftpManager,
    src_id: &str,
    remote: &str,
    local: &Path,
    ctx: &ProgressCtx,
) -> AppResult<()> {
    let conn = mgr.get(src_id)?;
    let mut reader = tokio::select! {
        biased;
        _ = ctx.cancel.cancelled() => return Err(AppError::Cancelled),
        result = conn.session().open(remote) => result?,
    };
    let mut writer = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(local)
        .await?;
    set_private_local_permissions(local).await?;
    copy_stream(app, &mut reader, true, &mut writer, false, ctx).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn compressed_local_to_remote(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    name: &str,
    src_path: &str,
    dst_id: &str,
    dst_dir: &str,
    cancel: Arc<TransferCancel>,
) -> AppResult<u64> {
    let tmp = local_temp_archive();
    let src = PathBuf::from(src_path);
    let archive = tmp.clone();
    let archive_cancel = cancel.clone();
    tokio::task::spawn_blocking(move || create_local_archive(&src, &archive, &archive_cancel))
        .await
        .map_err(|e| AppError::Other(format!("task join error: {e}")))??;
    let size = fs::metadata(&tmp).await?.len();

    let remote_archive = join_remote(dst_dir, &remote_archive_name());
    let stage = join_remote(
        dst_dir,
        &format!(".sageport-transfer-{}", uuid::Uuid::new_v4()),
    );
    let res = async {
        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        let ctx = xfer_ctx(transfer_id, name, size, false, cancel.clone());
        upload_archive(app, mgr, dst_id, &tmp, &remote_archive, &ctx).await?;

        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        emit_transfer_event(
            app,
            transfer_id,
            size,
            size,
            name,
            "active",
            Some(PHASE_EXTRACT.into()),
            None,
            None,
        );
        mgr.mkdir(dst_id, &stage).await?;
        mgr.chmod(dst_id, &stage, 0o700).await?;
        exec_with_cancel(
            mgr,
            dst_id,
            &format!(
                "tar -xzf {} -C {}",
                sh_quote(&remote_archive),
                sh_quote(&stage)
            ),
            &cancel,
        )
        .await?;
        commit_remote_stage(mgr, dst_id, &stage, name, dst_dir).await?;
        Ok(())
    }
    .await;

    cleanup_remote(mgr, dst_id, &remote_archive).await;
    cleanup_remote_tree(mgr, dst_id, &stage).await;
    let _ = fs::remove_file(&tmp).await;
    res.map(|()| size)
}

#[allow(clippy::too_many_arguments)]
async fn compressed_remote_to_local(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    name: &str,
    src_id: &str,
    src_path: &str,
    dst_dir: &str,
    cancel: Arc<TransferCancel>,
) -> AppResult<u64> {
    let parent = parent_remote(src_path);
    let remote_archive = remote_temp_archive();
    exec_with_cancel(
        mgr,
        src_id,
        &format!(
            "umask 077 && tar -czf {} -C {} {}",
            sh_quote(&remote_archive),
            sh_quote(&parent),
            sh_quote(name)
        ),
        &cancel,
    )
    .await?;

    let tmp = local_temp_archive();
    let dst = PathBuf::from(dst_dir);
    let stage = dst.join(format!(".sageport-transfer-{}", uuid::Uuid::new_v4()));
    let res = async {
        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        let src_conn = mgr.get(src_id)?;
        let size = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(AppError::Cancelled),
            result = ops::remote_file_size(src_conn.session(), &remote_archive) => result?,
        };
        let ctx = xfer_ctx(transfer_id, name, size, false, cancel.clone());
        download_archive(app, mgr, src_id, &remote_archive, &tmp, &ctx).await?;

        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        emit_transfer_event(
            app,
            transfer_id,
            size,
            size,
            name,
            "active",
            Some(PHASE_EXTRACT.into()),
            None,
            None,
        );
        let archive = tmp.clone();
        let extract_dir = stage.clone();
        let extract_cancel = cancel.clone();
        tokio::task::spawn_blocking(move || {
            extract_local_archive(&archive, &extract_dir, &extract_cancel)
        })
        .await
        .map_err(|e| AppError::Other(format!("task join error: {e}")))??;
        commit_local_stage(&stage, name, &dst).await?;
        Ok(size)
    }
    .await;

    cleanup_remote(mgr, src_id, &remote_archive).await;
    let _ = fs::remove_file(&tmp).await;
    let _ = fs::remove_dir_all(&stage).await;
    res
}

#[allow(clippy::too_many_arguments)]
async fn compressed_remote_to_remote(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    name: &str,
    src_id: &str,
    src_path: &str,
    dst_id: &str,
    dst_dir: &str,
    cancel: Arc<TransferCancel>,
) -> AppResult<u64> {
    let parent = parent_remote(src_path);
    let src_archive = remote_temp_archive();
    exec_with_cancel(
        mgr,
        src_id,
        &format!(
            "umask 077 && tar -czf {} -C {} {}",
            sh_quote(&src_archive),
            sh_quote(&parent),
            sh_quote(name)
        ),
        &cancel,
    )
    .await?;

    let tmp = local_temp_archive();
    let dst_archive = join_remote(dst_dir, &remote_archive_name());
    let stage = join_remote(
        dst_dir,
        &format!(".sageport-transfer-{}", uuid::Uuid::new_v4()),
    );
    let res = async {
        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        let src_conn = mgr.get(src_id)?;
        let size = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(AppError::Cancelled),
            result = ops::remote_file_size(src_conn.session(), &src_archive) => result?,
        };
        download_archive(
            app,
            mgr,
            src_id,
            &src_archive,
            &tmp,
            &xfer_ctx(transfer_id, name, size, false, cancel.clone()),
        )
        .await?;
        upload_archive(
            app,
            mgr,
            dst_id,
            &tmp,
            &dst_archive,
            &xfer_ctx(transfer_id, name, size, true, cancel.clone()),
        )
        .await?;

        if cancel.is_cancelled() {
            return Err(AppError::Cancelled);
        }
        emit_transfer_event(
            app,
            transfer_id,
            size,
            size,
            name,
            "active",
            Some(PHASE_EXTRACT.into()),
            None,
            None,
        );
        mgr.mkdir(dst_id, &stage).await?;
        mgr.chmod(dst_id, &stage, 0o700).await?;
        exec_with_cancel(
            mgr,
            dst_id,
            &format!(
                "tar -xzf {} -C {}",
                sh_quote(&dst_archive),
                sh_quote(&stage)
            ),
            &cancel,
        )
        .await?;
        commit_remote_stage(mgr, dst_id, &stage, name, dst_dir).await?;
        Ok(size)
    }
    .await;

    tokio::join!(
        cleanup_remote(mgr, src_id, &src_archive),
        cleanup_remote(mgr, dst_id, &dst_archive),
    );
    let _ = fs::remove_file(&tmp).await;
    cleanup_remote_tree(mgr, dst_id, &stage).await;
    res
}

async fn commit_local_stage(stage: &Path, name: &str, dest_dir: &Path) -> AppResult<()> {
    let source = stage.join(name);
    let target = dest_dir.join(name);
    if fs::try_exists(&target).await? {
        return Err(AppError::Conflict(format!(
            "destination already contains {name}"
        )));
    }
    fs::rename(source, target).await?;
    Ok(())
}

async fn commit_remote_stage(
    mgr: &SftpManager,
    connection_id: &str,
    stage: &str,
    name: &str,
    dest_dir: &str,
) -> AppResult<()> {
    let source = join_remote(stage, name);
    let target = join_remote(dest_dir, name);
    if mgr
        .list(connection_id, dest_dir)
        .await?
        .iter()
        .any(|entry| entry.name == name)
    {
        return Err(AppError::Conflict(format!(
            "destination already contains {name}"
        )));
    }
    mgr.rename(connection_id, &source, &target).await
}

async fn exec_with_cancel(
    mgr: &SftpManager,
    connection_id: &str,
    command: &str,
    cancel: &TransferCancel,
) -> AppResult<String> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(AppError::Cancelled),
        result = mgr.exec(connection_id, command) => result,
    }
}

async fn cleanup_remote(mgr: &SftpManager, connection_id: &str, path: &str) {
    let command = format!("rm -f {}", sh_quote(path));
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        mgr.exec(connection_id, &command),
    )
    .await;
}

async fn cleanup_remote_tree(mgr: &SftpManager, connection_id: &str, path: &str) {
    let _ = tokio::time::timeout(
        Duration::from_secs(5),
        mgr.remove(connection_id, path, true),
    )
    .await;
}

struct CancelReader<R> {
    inner: R,
    cancel: Arc<TransferCancel>,
}

impl<R: Read> Read for CancelReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.cancel.is_cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        self.inner.read(buf)
    }
}

struct CancelWriter<W> {
    inner: W,
    cancel: Arc<TransferCancel>,
}

impl<W: Write> Write for CancelWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.cancel.is_cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        self.inner.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn create_local_archive(
    src_dir: &Path,
    archive: &Path,
    cancel: &Arc<TransferCancel>,
) -> AppResult<()> {
    let name = src_dir
        .file_name()
        .map(|n| n.to_owned())
        .ok_or_else(|| AppError::Other("source has no directory name".into()))?;
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(archive)?;
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
    let writer = CancelWriter {
        inner: encoder,
        cancel: cancel.clone(),
    };
    let result = (|| -> io::Result<()> {
        let mut builder = tar::Builder::new(writer);
        builder.append_dir_all(&name, src_dir)?;
        builder.into_inner()?.inner.finish()?;
        Ok(())
    })();
    if cancel.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    result?;
    Ok(())
}

fn extract_local_archive(
    archive: &Path,
    dest_dir: &Path,
    cancel: &Arc<TransferCancel>,
) -> AppResult<()> {
    std::fs::create_dir_all(dest_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dest_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let file = std::fs::File::open(archive)?;
    let reader = CancelReader {
        inner: file,
        cancel: cancel.clone(),
    };
    let decoder = flate2::read::GzDecoder::new(reader);
    let result = tar::Archive::new(decoder).unpack(dest_dir);
    if cancel.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    result?;
    Ok(())
}

fn local_temp_archive() -> PathBuf {
    std::env::temp_dir().join(format!("sageport-{}.tar.gz", uuid::Uuid::new_v4()))
}

async fn set_private_local_permissions(path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn remote_temp_archive() -> String {
    format!("/tmp/sageport-{}.tar.gz", uuid::Uuid::new_v4())
}

fn remote_archive_name() -> String {
    format!(".sageport-{}.tar.gz", uuid::Uuid::new_v4())
}
