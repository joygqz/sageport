use russh::client::Handle;
use russh::ChannelMsg;

use super::handler::ClientHandler;
use crate::error::{AppError, AppResult};

pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

pub async fn exec_capture(handle: &Handle<ClientHandler>, command: &str) -> AppResult<ExecOutput> {
    exec_capture_limited(handle, command, usize::MAX).await
}

pub async fn exec_capture_limited(
    handle: &Handle<ClientHandler>,
    command: &str,
    max_output_bytes: usize,
) -> AppResult<ExecOutput> {
    let channel = handle.channel_open_session().await?;
    channel.exec(true, command).await?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut code = None;
    let mut channel = channel;
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                append_limited(&mut stdout, &stderr, &data, max_output_bytes)?
            }
            Some(ChannelMsg::ExtendedData { data, ext: 1 }) => {
                append_limited(&mut stderr, &stdout, &data, max_output_bytes)?
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => code = Some(exit_status as i32),
            Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                return Err(AppError::Other(format!(
                    "remote command terminated by signal {signal_name:?}"
                )));
            }
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }

    Ok(ExecOutput {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        code: require_exit_status(code)?,
    })
}

pub async fn exec_stream<F>(
    handle: &Handle<ClientHandler>,
    command: &str,
    max_output_bytes: usize,
    mut on_chunk: F,
    cancel: &crate::sftp::TransferCancel,
    timeout: std::time::Duration,
) -> AppResult<i32>
where
    F: FnMut(String),
{
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    let mut channel = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(AppError::Cancelled),
        _ = &mut deadline => return Err(AppError::Timeout("remote command timed out".into())),
        channel = handle.channel_open_session() => channel?,
    };
    let started = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(AppError::Cancelled),
        _ = &mut deadline => Err(AppError::Timeout("remote command timed out".into())),
        result = channel.exec(true, command) => result.map_err(AppError::from),
    };
    if let Err(error) = started {
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            channel.signal(russh::Sig::KILL),
        )
        .await;
        let _ = tokio::time::timeout(std::time::Duration::from_secs(1), channel.close()).await;
        return Err(error);
    }
    let mut code = None;
    let mut forwarded = 0usize;
    let mut truncated = false;
    loop {
        let message = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(1), channel.signal(russh::Sig::KILL)).await;
                let _ = tokio::time::timeout(std::time::Duration::from_secs(1), channel.close()).await;
                return Err(AppError::Cancelled);
            }
            _ = &mut deadline => {
                let _ = tokio::time::timeout(std::time::Duration::from_secs(1), channel.signal(russh::Sig::KILL)).await;
                let _ = tokio::time::timeout(std::time::Duration::from_secs(1), channel.close()).await;
                return Err(AppError::Timeout("remote command timed out".into()));
            }
            message = channel.wait() => message,
        };
        match message {
            Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, ext: 1 }) => {
                forward_chunk(
                    &mut on_chunk,
                    &data,
                    max_output_bytes,
                    &mut forwarded,
                    &mut truncated,
                );
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => code = Some(exit_status as i32),
            Some(ChannelMsg::ExitSignal { signal_name, .. }) => {
                return Err(AppError::Other(format!(
                    "remote command terminated by signal {signal_name:?}"
                )));
            }
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }
    require_exit_status(code)
}

fn require_exit_status(code: Option<i32>) -> AppResult<i32> {
    code.ok_or_else(|| AppError::Other("remote command closed without an exit status".into()))
}

fn forward_chunk<F>(
    on_chunk: &mut F,
    data: &[u8],
    max_output_bytes: usize,
    forwarded: &mut usize,
    truncated: &mut bool,
) where
    F: FnMut(String),
{
    if *forwarded >= max_output_bytes {
        if !*truncated {
            *truncated = true;
            on_chunk("\n…(output truncated)…\n".to_string());
        }
        return;
    }
    let remaining = max_output_bytes - *forwarded;
    let slice = if data.len() > remaining {
        &data[..remaining]
    } else {
        data
    };
    *forwarded += slice.len();
    on_chunk(String::from_utf8_lossy(slice).into_owned());
}

fn append_limited(
    target: &mut Vec<u8>,
    other: &[u8],
    data: &[u8],
    max_output_bytes: usize,
) -> AppResult<()> {
    if target
        .len()
        .checked_add(other.len())
        .and_then(|size| size.checked_add(data.len()))
        .is_none_or(|size| size > max_output_bytes)
    {
        return Err(AppError::Invalid("command output is too large".into()));
    }
    target.extend_from_slice(data);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{append_limited, require_exit_status};

    #[test]
    fn requires_an_explicit_remote_exit_status() {
        assert!(require_exit_status(None).is_err());
        assert_eq!(require_exit_status(Some(0)).unwrap(), 0);
        assert_eq!(require_exit_status(Some(7)).unwrap(), 7);
    }

    #[test]
    fn limits_combined_command_output() {
        let mut stdout = b"1234".to_vec();
        let stderr = b"56".to_vec();

        append_limited(&mut stdout, &stderr, b"78", 8).unwrap();
        assert_eq!(stdout, b"123478");
        assert!(append_limited(&mut stdout, &stderr, b"9", 8).is_err());
    }
}
