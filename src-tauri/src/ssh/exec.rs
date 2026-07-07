use russh::client::Handle;
use russh::ChannelMsg;

use super::handler::ClientHandler;
use crate::error::AppResult;

pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

pub async fn exec_capture(handle: &Handle<ClientHandler>, command: &str) -> AppResult<ExecOutput> {
    let channel = handle.channel_open_session().await?;
    channel.exec(true, command).await?;

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut code = 0i32;
    let mut channel = channel;
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => stdout.extend_from_slice(&data),
            Some(ChannelMsg::ExtendedData { data, ext: 1 }) => stderr.extend_from_slice(&data),
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
