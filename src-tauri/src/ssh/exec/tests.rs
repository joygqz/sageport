use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use russh::server::{ChannelOpenHandle, Session};
use russh::{Channel, ChannelId};

use super::exec_stream;
use crate::error::AppError;
use crate::sftp::TransferCancel;

struct TestServer {
    command: String,
    signaled: Arc<AtomicBool>,
}

impl russh::server::Handler for TestServer {
    type Error = russh::Error;

    async fn auth_password(
        &mut self,
        _user: &str,
        _password: &str,
    ) -> Result<russh::server::Auth, Self::Error> {
        Ok(russh::server::Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<russh::server::Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.command = String::from_utf8_lossy(data).into_owned();
        if self.command == "reject" {
            session.channel_failure(channel)?;
            session.close(channel)?;
        } else {
            session.channel_success(channel)?;
            if self.command == "missing" {
                session.close(channel)?;
            }
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        if self.command == "eof" {
            session.data(channel, vec![0xe4])?;
            session.data(channel, vec![0xb8, 0xad, 0xe6])?;
            session.data(channel, vec![0x96, 0x87])?;
            session.exit_status_request(channel, 0)?;
            session.close(channel)?;
        }
        Ok(())
    }

    async fn signal(
        &mut self,
        channel: ChannelId,
        _signal: russh::Sig,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.signaled.store(true, Ordering::SeqCst);
        session.close(channel)?;
        Ok(())
    }
}

struct TestClient;

impl russh::client::Handler for TestClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn ssh_pair() -> (
    russh::client::Handle<TestClient>,
    russh::server::Handle,
    Arc<AtomicBool>,
) {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let address = listener.local_addr().unwrap();
    let signaled = Arc::new(AtomicBool::new(false));
    let server_signaled = signaled.clone();
    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let config = russh::server::Config {
            keys: vec![russh::keys::decode_secret_key(
                include_str!("../../../tests/test_host_key"),
                None,
            )
            .unwrap()],
            ..Default::default()
        };
        russh::server::run_stream(
            Arc::new(config),
            stream,
            TestServer {
                command: String::new(),
                signaled: server_signaled,
            },
        )
        .await
        .unwrap()
        .handle()
    });
    let mut client = russh::client::connect(
        Arc::new(russh::client::Config::default()),
        address,
        TestClient,
    )
    .await
    .unwrap();
    assert!(client
        .authenticate_password("tester", "pw")
        .await
        .unwrap()
        .success());
    (client, server.await.unwrap(), signaled)
}

#[tokio::test]
async fn runs_without_sftp_closes_stdin_and_decodes_split_characters() {
    let (client, _server, _) = ssh_pair().await;
    let mut output = String::new();
    let result = exec_stream(
        &client,
        "eof",
        |chunk| output.push_str(&chunk),
        &TransferCancel::new(),
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    assert_eq!(result, 0);
    assert_eq!(output, "中文");
}

#[tokio::test]
async fn rejects_missing_exit_status_and_refused_commands() {
    for command in ["missing", "reject"] {
        let (client, _server, _) = ssh_pair().await;
        assert!(exec_stream(
            &client,
            command,
            |_| {},
            &TransferCancel::new(),
            Duration::from_secs(2)
        )
        .await
        .is_err());
    }
}

async fn wait_for_signal(signaled: &AtomicBool) {
    tokio::time::timeout(Duration::from_secs(1), async {
        while !signaled.load(Ordering::SeqCst) {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn sends_a_kill_signal_on_timeout_and_cancellation() {
    for cancelled in [false, true] {
        let (client, _server, signaled) = ssh_pair().await;
        let cancel = Arc::new(TransferCancel::new());
        if cancelled {
            let trigger = cancel.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(50)).await;
                trigger.cancel();
            });
        }
        let result =
            exec_stream(&client, "wait", |_| {}, &cancel, Duration::from_millis(150)).await;
        if cancelled {
            assert!(matches!(result, Err(AppError::Cancelled)));
        } else {
            assert!(matches!(result, Err(AppError::Timeout(_))));
        }
        wait_for_signal(&signaled).await;
    }
}
