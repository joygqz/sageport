use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::AppHandle;
use tokio::fs;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::path::{
    base_name, clean_local_path, dest_join, join_remote, normalize_local_path,
    normalize_remote_path, parent_remote, remote_is_child_path, sh_quote,
};
use super::{emit_transfer_event, ops, SftpManager};
use crate::error::{connection_lost, AppError, AppResult};

const CHUNK_SIZE: usize = 64 * 1024;
const PHASE_COMPRESS: &str = "compressing";
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
    cancel: Arc<AtomicBool>,
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
    );
}

pub async fn transfer(
    app: &AppHandle,
    mgr: &SftpManager,
    transfer_id: &str,
    source: &Endpoint,
    dest_dir: &Endpoint,
    compress: bool,
    cancel: Arc<AtomicBool>,
) -> TransferOutcome {
    let name = base_name(&source.path);
    if let Err(e) = validate_transfer_target(mgr, source, dest_dir, &name).await {
        emit_transfer_event(
            app,
            transfer_id,
            0,
            0,
            &name,
            "error",
            None,
            Some(e.to_string()),
        );
        return outcome(0, 0, "error", Some(e.to_string()));
    }

    let crosses_network = source.connection_id.is_some() || dest_dir.connection_id.is_some();
    if compress && crosses_network && is_dir(mgr, source).await.unwrap_or(false) {
        return transfer_compressed(app, mgr, transfer_id, source, dest_dir, cancel).await;
    }

    let total = source_size(mgr, source).await.unwrap_or(0);
    let progress = ProgressCtx {
        transfer_id: transfer_id.to_string(),
        base: 0,
        total,
        label: name.clone(),
        silent: false,
        phase: None,
        cancel,
    };

    let mut done = 0u64;
    match transfer_node(app, mgr, source, dest_dir, &name, &progress, &mut done).await {
        Ok(()) => {
            emit(app, &at(&progress, &name), total, "done", None);
            outcome(total, total, "done", None)
        }
        Err(AppError::Cancelled) => {
            emit(app, &at(&progress, &name), done, "cancelled", None);
            outcome(done, total, "cancelled", None)
        }
        Err(e) => {
            emit(
                app,
                &at(&progress, &name),
                done,
                "error",
                Some(e.to_string()),
            );
            outcome(done, total, "error", Some(e.to_string()))
        }
    }
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
    if progress.cancel.load(Ordering::Relaxed) {
        return Err(AppError::Cancelled);
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
    label: &str,
) -> AppResult<()> {
    let size = file_size(mgr, source).await?;
    let ctx = ProgressCtx {
        base: *done,
        label: label.to_string(),
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

    *done += size;
    Ok(())
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
        if progress.cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let n = reader
            .read(&mut buf)
            .await
            .map_err(|e| map_stream_error(e, remote_read))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .await
            .map_err(|e| map_stream_error(e, remote_write))?;
        done += n as u64;
        if !progress.silent {
            emit(app, progress, done, "active", None);
        }
    }
    writer
        .flush()
        .await
        .map_err(|e| map_stream_error(e, remote_write))?;
    Ok(())
}

async fn validate_transfer_target(
    mgr: &SftpManager,
    source: &Endpoint,
    dest_dir: &Endpoint,
    name: &str,
) -> AppResult<()> {
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
    let mut total = 0;
    for entry in mgr.list(id, path).await? {
        if entry.kind == "dir" {
            total += Box::pin(remote_size(mgr, id, &entry.path)).await?;
        } else {
            total += entry.size;
        }
    }
    Ok(total)
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
    cancel: Arc<AtomicBool>,
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
            );
        };

    if cancel.load(Ordering::Relaxed) {
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
            notify(0, 0, "error", None, Some(e.to_string()));
            outcome(0, 0, "error", Some(e.to_string()))
        }
    }
}

fn xfer_ctx(
    transfer_id: &str,
    label: &str,
    total: u64,
    silent: bool,
    cancel: Arc<AtomicBool>,
) -> ProgressCtx {
    ProgressCtx {
        transfer_id: transfer_id.to_string(),
        base: 0,
        total,
        label: label.to_string(),
        silent,
        phase: Some(PHASE_TRANSFER.to_string()),
        cancel,
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
    let mut writer = conn.session().create(remote).await?;
    copy_stream(app, &mut reader, false, &mut writer, true, ctx).await?;
    writer.sync_all().await?;
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
    let mut reader = conn.session().open(remote).await?;
    let mut writer = fs::File::create(local).await?;
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
    cancel: Arc<AtomicBool>,
) -> AppResult<u64> {
    let tmp = local_temp_archive();
    let src = PathBuf::from(src_path);
    let archive = tmp.clone();
    tokio::task::spawn_blocking(move || create_local_archive(&src, &archive))
        .await
        .map_err(|e| AppError::Other(format!("task join error: {e}")))??;
    let size = fs::metadata(&tmp).await?.len();

    let remote_archive = join_remote(dst_dir, &remote_archive_name());
    let res = async {
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let ctx = xfer_ctx(transfer_id, name, size, false, cancel.clone());
        upload_archive(app, mgr, dst_id, &tmp, &remote_archive, &ctx).await?;

        if cancel.load(Ordering::Relaxed) {
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
        );
        mgr.exec(
            dst_id,
            &format!(
                "tar -xzf {} -C {}",
                sh_quote(&remote_archive),
                sh_quote(dst_dir)
            ),
        )
        .await?;
        Ok(())
    }
    .await;

    let _ = mgr
        .exec(dst_id, &format!("rm -f {}", sh_quote(&remote_archive)))
        .await;
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
    cancel: Arc<AtomicBool>,
) -> AppResult<u64> {
    let parent = parent_remote(src_path);
    let remote_archive = remote_temp_archive();
    mgr.exec(
        src_id,
        &format!(
            "tar -czf {} -C {} {}",
            sh_quote(&remote_archive),
            sh_quote(&parent),
            sh_quote(name)
        ),
    )
    .await?;

    let tmp = local_temp_archive();
    let dst = PathBuf::from(dst_dir);
    let res = async {
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let src_conn = mgr.get(src_id)?;
        let size = ops::remote_file_size(src_conn.session(), &remote_archive).await?;
        let ctx = xfer_ctx(transfer_id, name, size, false, cancel.clone());
        download_archive(app, mgr, src_id, &remote_archive, &tmp, &ctx).await?;

        if cancel.load(Ordering::Relaxed) {
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
        );
        let archive = tmp.clone();
        tokio::task::spawn_blocking(move || extract_local_archive(&archive, &dst))
            .await
            .map_err(|e| AppError::Other(format!("task join error: {e}")))??;
        Ok(size)
    }
    .await;

    let _ = mgr
        .exec(src_id, &format!("rm -f {}", sh_quote(&remote_archive)))
        .await;
    let _ = fs::remove_file(&tmp).await;
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
    cancel: Arc<AtomicBool>,
) -> AppResult<u64> {
    let parent = parent_remote(src_path);
    let src_archive = remote_temp_archive();
    mgr.exec(
        src_id,
        &format!(
            "tar -czf {} -C {} {}",
            sh_quote(&src_archive),
            sh_quote(&parent),
            sh_quote(name)
        ),
    )
    .await?;

    let tmp = local_temp_archive();
    let dst_archive = join_remote(dst_dir, &remote_archive_name());
    let res = async {
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::Cancelled);
        }
        let src_conn = mgr.get(src_id)?;
        let size = ops::remote_file_size(src_conn.session(), &src_archive).await?;
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

        if cancel.load(Ordering::Relaxed) {
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
        );
        mgr.exec(
            dst_id,
            &format!(
                "tar -xzf {} -C {}",
                sh_quote(&dst_archive),
                sh_quote(dst_dir)
            ),
        )
        .await?;
        Ok(size)
    }
    .await;

    let _ = mgr
        .exec(src_id, &format!("rm -f {}", sh_quote(&src_archive)))
        .await;
    let _ = mgr
        .exec(dst_id, &format!("rm -f {}", sh_quote(&dst_archive)))
        .await;
    let _ = fs::remove_file(&tmp).await;
    res
}

fn create_local_archive(src_dir: &Path, archive: &Path) -> AppResult<()> {
    let name = src_dir
        .file_name()
        .map(|n| n.to_owned())
        .ok_or_else(|| AppError::Other("source has no directory name".into()))?;
    let file = std::fs::File::create(archive)?;
    let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
    let mut builder = tar::Builder::new(encoder);
    builder.append_dir_all(&name, src_dir)?;
    builder.into_inner()?.finish()?;
    Ok(())
}

fn extract_local_archive(archive: &Path, dest_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dest_dir)?;
    let file = std::fs::File::open(archive)?;
    let decoder = flate2::read::GzDecoder::new(file);
    tar::Archive::new(decoder).unpack(dest_dir)?;
    Ok(())
}

fn local_temp_archive() -> PathBuf {
    std::env::temp_dir().join(format!("sageport-{}.tar.gz", uuid::Uuid::new_v4()))
}

fn remote_temp_archive() -> String {
    format!("/tmp/sageport-{}.tar.gz", uuid::Uuid::new_v4())
}

fn remote_archive_name() -> String {
    format!(".sageport-{}.tar.gz", uuid::Uuid::new_v4())
}
