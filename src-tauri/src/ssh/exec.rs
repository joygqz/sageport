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
    let mut code = 0i32;
    let mut channel = channel;
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => {
                append_limited(&mut stdout, &stderr, &data, max_output_bytes)?
            }
            Some(ChannelMsg::ExtendedData { data, ext: 1 }) => {
                append_limited(&mut stderr, &stdout, &data, max_output_bytes)?
            }
            Some(ChannelMsg::ExitStatus { exit_status }) => code = exit_status as i32,
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }

    Ok(ExecOutput {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        code,
    })
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
    use super::append_limited;

    #[test]
    fn limits_combined_command_output() {
        let mut stdout = b"1234".to_vec();
        let stderr = b"56".to_vec();

        append_limited(&mut stdout, &stderr, b"78", 8).unwrap();
        assert_eq!(stdout, b"123478");
        assert!(append_limited(&mut stdout, &stderr, b"9", 8).is_err());
    }
}
