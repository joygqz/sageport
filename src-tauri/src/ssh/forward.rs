use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{watch, Mutex};

use super::connect::{establish, SshConnection};
use super::{ConnectionPrompts, Hop};
use crate::error::{AppError, AppResult};

pub const EVENT_STATUS: &str = "forward://status";

pub mod kind {
    pub const DYNAMIC: &str = "dynamic";
}

#[derive(Clone)]
pub struct ForwardSpec {
    pub id: String,
    pub kind: String,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: Option<String>,
    pub target_port: Option<u16>,
    pub hops: Vec<Hop>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    forward_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Default)]
pub struct ForwardManager {
    active: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl ForwardManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn active_ids(&self) -> Vec<String> {
        self.active.lock().await.keys().cloned().collect()
    }

    pub async fn stop(&self, id: &str) {
        if let Some(tx) = self.active.lock().await.remove(id) {
            let _ = tx.send(true);
        }
    }

    pub async fn start(&self, app: AppHandle, prompts: ConnectionPrompts, spec: ForwardSpec) {
        let (tx, rx) = watch::channel(false);
        {
            let mut active = self.active.lock().await;
            if active.contains_key(&spec.id) {
                return;
            }
            active.insert(spec.id.clone(), tx);
        }
        let active = self.active.clone();
        tokio::spawn(async move {
            run_forward(app, prompts, spec.clone(), rx).await;
            active.lock().await.remove(&spec.id);
        });
    }
}

fn emit(app: &AppHandle, id: &str, status: &str, message: Option<String>) {
    let _ = app.emit(
        EVENT_STATUS,
        StatusEvent {
            forward_id: id.to_string(),
            status: status.to_string(),
            message,
        },
    );
}

async fn run_forward(
    app: AppHandle,
    prompts: ConnectionPrompts,
    spec: ForwardSpec,
    mut shutdown: watch::Receiver<bool>,
) {
    emit(&app, &spec.id, "starting", None);

    let conn = tokio::select! {
        result = establish(&app, &prompts, &spec.id, &spec.hops) => match result {
            Ok(conn) => Arc::new(conn),
            Err(e) => {
                emit(&app, &spec.id, "error", Some(e.to_string()));
                return;
            }
        },
        _ = shutdown.changed() => {
            emit(&app, &spec.id, "stopped", None);
            return;
        }
    };

    let listener = match TcpListener::bind((spec.bind_host.as_str(), spec.bind_port)).await {
        Ok(listener) => listener,
        Err(e) => {
            emit(&app, &spec.id, "error", Some(bind_message(&spec, e)));
            return;
        }
    };

    emit(&app, &spec.id, "active", None);

    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((stream, _peer)) = accepted else { continue };
                let conn = conn.clone();
                let spec = spec.clone();
                let child = shutdown.clone();
                tokio::spawn(async move {
                    let _ = serve_connection(conn, spec, stream, child).await;
                });
            }
            _ = shutdown.changed() => break,
        }
    }

    emit(&app, &spec.id, "stopped", None);
}

fn bind_message(spec: &ForwardSpec, e: std::io::Error) -> String {
    if spec.bind_port < 1024 {
        format!(
            "could not bind {}:{} ({e}). Ports below 1024 usually need elevated privileges.",
            spec.bind_host, spec.bind_port
        )
    } else {
        format!("could not bind {}:{} ({e})", spec.bind_host, spec.bind_port)
    }
}

async fn serve_connection(
    conn: Arc<SshConnection>,
    spec: ForwardSpec,
    mut stream: TcpStream,
    mut shutdown: watch::Receiver<bool>,
) -> AppResult<()> {
    let (target_host, target_port) = if spec.kind == kind::DYNAMIC {
        socks5_handshake(&mut stream).await?
    } else {
        (
            spec.target_host.clone().unwrap_or_default(),
            spec.target_port.unwrap_or(0),
        )
    };

    let channel = conn
        .handle
        .channel_open_direct_tcpip(target_host, target_port as u32, "127.0.0.1", 0)
        .await?;
    let mut channel_stream = channel.into_stream();

    tokio::select! {
        result = tokio::io::copy_bidirectional(&mut stream, &mut channel_stream) => {
            result?;
        }
        _ = shutdown.changed() => {}
    }
    Ok(())
}

pub async fn socks5_handshake<S>(stream: &mut S) -> AppResult<(String, u16)>
where
    S: AsyncReadExt + AsyncWriteExt + Unpin,
{
    let mut header = [0u8; 2];
    stream.read_exact(&mut header).await?;
    if header[0] != 0x05 {
        return Err(AppError::Invalid("unsupported SOCKS version".into()));
    }
    let mut methods = vec![0u8; header[1] as usize];
    stream.read_exact(&mut methods).await?;
    stream.write_all(&[0x05, 0x00]).await?;

    let mut request = [0u8; 4];
    stream.read_exact(&mut request).await?;
    if request[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Err(AppError::Invalid("only SOCKS CONNECT is supported".into()));
    }

    let host = match request[3] {
        0x01 => {
            let mut addr = [0u8; 4];
            stream.read_exact(&mut addr).await?;
            std::net::Ipv4Addr::from(addr).to_string()
        }
        0x03 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            let mut name = vec![0u8; len[0] as usize];
            stream.read_exact(&mut name).await?;
            String::from_utf8_lossy(&name).into_owned()
        }
        0x04 => {
            let mut addr = [0u8; 16];
            stream.read_exact(&mut addr).await?;
            std::net::Ipv6Addr::from(addr).to_string()
        }
        _ => {
            stream
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Err(AppError::Invalid("unsupported SOCKS address type".into()));
        }
    };

    let mut port = [0u8; 2];
    stream.read_exact(&mut port).await?;
    let port = u16::from_be_bytes(port);

    stream
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;

    Ok((host, port))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn socks5_parses_domain_connect() {
        let (mut client, mut server) = tokio::io::duplex(256);

        let client_task = tokio::spawn(async move {
            client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
            let mut method_reply = [0u8; 2];
            client.read_exact(&mut method_reply).await.unwrap();
            assert_eq!(method_reply, [0x05, 0x00]);

            let host = b"example.com";
            let mut req = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
            req.extend_from_slice(host);
            req.extend_from_slice(&8080u16.to_be_bytes());
            client.write_all(&req).await.unwrap();

            let mut reply = [0u8; 10];
            client.read_exact(&mut reply).await.unwrap();
            assert_eq!(reply[0], 0x05);
            assert_eq!(reply[1], 0x00);
        });

        let (host, port) = socks5_handshake(&mut server).await.unwrap();
        assert_eq!(host, "example.com");
        assert_eq!(port, 8080);
        client_task.await.unwrap();
    }

    #[tokio::test]
    async fn socks5_rejects_non_connect() {
        let (mut client, mut server) = tokio::io::duplex(256);
        tokio::spawn(async move {
            client.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
            let mut method_reply = [0u8; 2];
            let _ = client.read_exact(&mut method_reply).await;
            let _ = client
                .write_all(&[0x05, 0x02, 0x00, 0x01, 127, 0, 0, 1, 0, 80])
                .await;
            let mut reply = [0u8; 10];
            let _ = client.read_exact(&mut reply).await;
        });
        assert!(socks5_handshake(&mut server).await.is_err());
    }
}
