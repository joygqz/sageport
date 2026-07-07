use std::sync::Arc;

use russh::client::{self, AuthResult};
use russh::keys::{decode_secret_key, ssh_key, PrivateKeyWithHashAlg};
use russh::server::{self, Auth, Handler as ServerHandler, Msg, Session};
use russh::{Channel, ChannelId, ChannelMsg};
use tokio::net::TcpListener;

const HOST_KEY: &str = include_str!("test_host_key");
const USER: &str = "tester";
const PASSWORD: &str = "pw";

struct EchoServer;

impl server::Server for EchoServer {
    type Handler = EchoHandler;
    fn new_client(&mut self, _peer: Option<std::net::SocketAddr>) -> EchoHandler {
        EchoHandler
    }
}

struct EchoHandler;

impl ServerHandler for EchoHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        if user == USER && password == PASSWORD {
            Ok(Auth::Accept)
        } else {
            Ok(Auth::reject())
        }
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: server::ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.data(channel, data.to_vec())?;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        _data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.channel_success(channel)?;
        session.data(channel, b"hello-exec\n".to_vec())?;
        session.exit_status_request(channel, 0)?;
        session.eof(channel)?;
        session.close(channel)?;
        Ok(())
    }
}

struct AcceptAllClient;

impl client::Handler for AcceptAllClient {
    type Error = russh::Error;
    async fn check_server_key(&mut self, _key: &ssh_key::PublicKey) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn start_server() -> u16 {
    let key = decode_secret_key(HOST_KEY, None).expect("host key");
    let config = Arc::new(server::Config {
        keys: vec![key],
        ..Default::default()
    });
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
    let port = listener.local_addr().expect("addr").port();

    tokio::spawn(async move {
        let mut server = EchoServer;
        if let Ok((stream, _)) = listener.accept().await {
            let handler = server::Server::new_client(&mut server, None);
            let _ = server::run_stream(config, stream, handler).await;
        }
    });

    port
}

#[tokio::test]
async fn password_auth_shell_echo_and_exec_roundtrip() {
    let port = start_server().await;
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, ("127.0.0.1", port), AcceptAllClient)
        .await
        .expect("connect");

    let result = handle
        .authenticate_password(USER, PASSWORD)
        .await
        .expect("auth call");
    assert!(
        matches!(result, AuthResult::Success),
        "password auth failed"
    );

    let mut channel = handle.channel_open_session().await.expect("open session");
    channel
        .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
        .await
        .expect("pty");
    channel.request_shell(true).await.expect("shell");

    channel.data(&b"ping\n"[..]).await.expect("send");
    let mut echoed = Vec::new();
    while echoed.len() < 5 {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => echoed.extend_from_slice(&data),
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }
    assert_eq!(&echoed[..5], b"ping\n", "shell did not echo input");

    let exec = client::connect(
        Arc::new(client::Config::default()),
        ("127.0.0.1", start_server().await),
        AcceptAllClient,
    )
    .await
    .expect("connect exec");
    let mut exec = exec;
    exec.authenticate_password(USER, PASSWORD)
        .await
        .expect("exec auth");
    let channel = exec.channel_open_session().await.expect("exec channel");
    channel.exec(true, "whoami").await.expect("exec");
    let mut out = Vec::new();
    let mut code = None;
    let mut channel = channel;
    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { data }) => out.extend_from_slice(&data),
            Some(ChannelMsg::ExitStatus { exit_status }) => code = Some(exit_status),
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }
    assert_eq!(String::from_utf8_lossy(&out), "hello-exec\n");
    assert_eq!(code, Some(0));
}

#[tokio::test]
async fn key_decode_and_publickey_auth_shape() {
    let key = decode_secret_key(HOST_KEY, None).expect("decode");
    let with_hash = PrivateKeyWithHashAlg::new(Arc::new(key), None);
    assert!(!with_hash.algorithm().to_string().is_empty());
}
