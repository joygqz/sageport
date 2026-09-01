use std::time::Duration;

use base64::Engine;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::domain::{proxy_kind, ProxyProfile};
use crate::error::{AppError, AppResult};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

pub async fn connect(host: &str, port: u16, proxy: Option<&ProxyProfile>) -> AppResult<TcpStream> {
    if host.is_empty() || host.len() > 255 || host.chars().any(char::is_control) {
        return Err(AppError::Invalid("invalid SSH target host".into()));
    }
    let connect = async {
        match proxy {
            Some(proxy) => {
                let mut stream = connect_direct(&proxy.host, proxy.port as u16).await?;
                match proxy.kind.as_str() {
                    proxy_kind::SOCKS5 => socks5_connect(&mut stream, host, port, proxy).await?,
                    proxy_kind::HTTP => http_connect(&mut stream, host, port, proxy).await?,
                    kind => return Err(AppError::Invalid(format!("unknown proxy kind: {kind}"))),
                }
                Ok(stream)
            }
            None => connect_direct(host, port).await,
        }
    };

    tokio::time::timeout(CONNECT_TIMEOUT, connect)
        .await
        .map_err(|_| AppError::Timeout(format!("connection to {host} timed out")))?
}

async fn connect_direct(host: &str, port: u16) -> AppResult<TcpStream> {
    let addrs: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|error| AppError::Dns(format!("could not resolve {host}: {error}")))?
        .collect();
    if addrs.is_empty() {
        return Err(AppError::Dns(format!("no address resolved for {host}")));
    }
    let mut last_error = None;
    for addr in addrs {
        match TcpStream::connect(addr).await {
            Ok(stream) => {
                let _ = stream.set_nodelay(true);
                return Ok(stream);
            }
            Err(error) => last_error = Some(AppError::Io(error)),
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::Network(format!("could not reach {host}"))))
}

async fn socks5_connect<S>(
    stream: &mut S,
    host: &str,
    port: u16,
    proxy: &ProxyProfile,
) -> AppResult<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let authenticated = proxy.username.is_some();
    let method = if authenticated { 0x02 } else { 0x00 };
    stream.write_all(&[0x05, 0x01, method]).await?;
    stream.flush().await?;

    let mut selection = [0_u8; 2];
    stream.read_exact(&mut selection).await?;
    if selection[0] != 0x05 || selection[1] != method {
        return Err(AppError::Auth(
            "SOCKS5 proxy rejected the requested authentication method".into(),
        ));
    }

    if authenticated {
        let username = proxy.username.as_deref().unwrap_or_default().as_bytes();
        let password = proxy.password.as_deref().unwrap_or_default().as_bytes();
        let mut request = Vec::with_capacity(username.len() + password.len() + 3);
        request.extend([0x01, username.len() as u8]);
        request.extend(username);
        request.push(password.len() as u8);
        request.extend(password);
        stream.write_all(&request).await?;
        stream.flush().await?;

        let mut response = [0_u8; 2];
        stream.read_exact(&mut response).await?;
        if response != [0x01, 0x00] {
            return Err(AppError::Auth("SOCKS5 proxy authentication failed".into()));
        }
    }

    let mut request = vec![0x05, 0x01, 0x00];
    append_socks_address(&mut request, host)?;
    request.extend(port.to_be_bytes());
    stream.write_all(&request).await?;
    stream.flush().await?;

    let mut header = [0_u8; 4];
    stream.read_exact(&mut header).await?;
    if header[0] != 0x05 || header[2] != 0x00 {
        return Err(AppError::Network(
            "SOCKS5 proxy returned an invalid response".into(),
        ));
    }
    if header[1] != 0x00 {
        return Err(AppError::Network(format!(
            "SOCKS5 proxy could not connect to {host}:{port}: {}",
            socks5_status(header[1])
        )));
    }
    read_socks_address(stream, header[3]).await?;
    let mut bound_port = [0_u8; 2];
    stream.read_exact(&mut bound_port).await?;
    Ok(())
}

fn append_socks_address(request: &mut Vec<u8>, host: &str) -> AppResult<()> {
    let normalized = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    if let Ok(address) = normalized.parse::<std::net::Ipv4Addr>() {
        request.push(0x01);
        request.extend(address.octets());
    } else if let Ok(address) = normalized.parse::<std::net::Ipv6Addr>() {
        request.push(0x04);
        request.extend(address.octets());
    } else {
        let bytes = normalized.as_bytes();
        if bytes.is_empty() || bytes.len() > u8::MAX as usize {
            return Err(AppError::Invalid(
                "SOCKS5 target host must be between 1 and 255 bytes".into(),
            ));
        }
        request.extend([0x03, bytes.len() as u8]);
        request.extend(bytes);
    }
    Ok(())
}

async fn read_socks_address<S>(stream: &mut S, kind: u8) -> AppResult<()>
where
    S: AsyncRead + Unpin,
{
    let length = match kind {
        0x01 => 4,
        0x04 => 16,
        0x03 => stream.read_u8().await? as usize,
        _ => {
            return Err(AppError::Network(
                "SOCKS5 proxy returned an unsupported address type".into(),
            ))
        }
    };
    let mut address = vec![0_u8; length];
    stream.read_exact(&mut address).await?;
    Ok(())
}

fn socks5_status(status: u8) -> &'static str {
    match status {
        0x01 => "general failure",
        0x02 => "connection not allowed",
        0x03 => "network unreachable",
        0x04 => "host unreachable",
        0x05 => "connection refused",
        0x06 => "TTL expired",
        0x07 => "command not supported",
        0x08 => "address type not supported",
        _ => "unknown error",
    }
}

async fn http_connect<S>(
    stream: &mut S,
    host: &str,
    port: u16,
    proxy: &ProxyProfile,
) -> AppResult<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let authority = format_authority(host, port);
    let authorization = proxy.username.as_deref().map(|username| {
        let credentials = format!(
            "{username}:{}",
            proxy.password.as_deref().unwrap_or_default()
        );
        let encoded = base64::engine::general_purpose::STANDARD.encode(credentials);
        format!("Proxy-Authorization: Basic {encoded}\r\n")
    });
    let request = format!(
        "CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\nProxy-Connection: Keep-Alive\r\n{}\r\n",
        authorization.as_deref().unwrap_or_default()
    );
    stream.write_all(request.as_bytes()).await?;
    stream.flush().await?;

    let mut response = Vec::with_capacity(512);
    while !response.ends_with(b"\r\n\r\n") {
        if response.len() >= 16 * 1024 {
            return Err(AppError::Network(
                "HTTP proxy response headers are too large".into(),
            ));
        }
        response.push(stream.read_u8().await?);
    }
    let response = std::str::from_utf8(&response)
        .map_err(|_| AppError::Network("HTTP proxy returned an invalid response".into()))?;
    let status_line = response
        .lines()
        .next()
        .filter(|line| line.starts_with("HTTP/1.0 ") || line.starts_with("HTTP/1.1 "))
        .ok_or_else(|| AppError::Network("HTTP proxy returned an invalid response".into()))?;
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| AppError::Network("HTTP proxy returned an invalid response".into()))?;
    match status {
        200..=299 => Ok(()),
        407 => Err(AppError::Auth("HTTP proxy authentication failed".into())),
        _ => Err(AppError::Network(format!(
            "HTTP proxy could not connect to {authority}: status {status}"
        ))),
    }
}

fn format_authority(host: &str, port: u16) -> String {
    let normalized = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    if normalized.parse::<std::net::Ipv6Addr>().is_ok() {
        format!("[{normalized}]:{port}")
    } else {
        format!("{normalized}:{port}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proxy(kind: &str, username: Option<&str>, password: Option<&str>) -> ProxyProfile {
        ProxyProfile {
            id: "proxy-1".into(),
            name: "Test proxy".into(),
            kind: kind.into(),
            host: "127.0.0.1".into(),
            port: 1080,
            username: username.map(str::to_string),
            password: password.map(str::to_string),
            created_at: crate::domain::now(),
            updated_at: crate::domain::now(),
            deleted_at: None,
            revision: 1,
        }
    }

    #[tokio::test]
    async fn socks5_uses_proxy_dns_and_username_password_authentication() {
        let (mut client, mut server) = tokio::io::duplex(1024);
        let server_task = tokio::spawn(async move {
            let mut greeting = [0_u8; 3];
            server.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting, [0x05, 0x01, 0x02]);
            server.write_all(&[0x05, 0x02]).await.unwrap();

            let mut auth = [0_u8; 14];
            server.read_exact(&mut auth).await.unwrap();
            assert_eq!(&auth, b"\x01\x05alice\x06secret");
            server.write_all(&[0x01, 0x00]).await.unwrap();

            let mut request = [0_u8; 22];
            server.read_exact(&mut request).await.unwrap();
            assert_eq!(&request[..5], b"\x05\x01\x00\x03\x0f");
            assert_eq!(&request[5..20], b"ssh.example.com");
            assert_eq!(&request[20..], &22_u16.to_be_bytes());
            server
                .write_all(&[0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 22])
                .await
                .unwrap();
        });

        socks5_connect(
            &mut client,
            "ssh.example.com",
            22,
            &proxy(proxy_kind::SOCKS5, Some("alice"), Some("secret")),
        )
        .await
        .unwrap();
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn http_connect_sends_basic_auth_and_preserves_tunneled_bytes() {
        let (mut client, mut server) = tokio::io::duplex(2048);
        let server_task = tokio::spawn(async move {
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                request.push(server.read_u8().await.unwrap());
            }
            let request = String::from_utf8(request).unwrap();
            assert!(request.starts_with(
                "CONNECT ssh.example.com:22 HTTP/1.1\r\nHost: ssh.example.com:22\r\n"
            ));
            assert!(request.contains("Proxy-Authorization: Basic YWxpY2U6c2VjcmV0\r\n"));
            server
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-test\r\n")
                .await
                .unwrap();
        });

        http_connect(
            &mut client,
            "ssh.example.com",
            22,
            &proxy(proxy_kind::HTTP, Some("alice"), Some("secret")),
        )
        .await
        .unwrap();
        let mut banner = [0_u8; 14];
        client.read_exact(&mut banner).await.unwrap();
        assert_eq!(&banner, b"SSH-2.0-test\r\n");
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn proxy_authentication_failures_are_classified_as_auth_errors() {
        let (mut client, mut server) = tokio::io::duplex(1024);
        tokio::spawn(async move {
            let mut greeting = [0_u8; 3];
            server.read_exact(&mut greeting).await.unwrap();
            server.write_all(&[0x05, 0xff]).await.unwrap();
        });

        let error = socks5_connect(
            &mut client,
            "ssh.example.com",
            22,
            &proxy(proxy_kind::SOCKS5, None, None),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code(), "auth");
    }

    #[test]
    fn http_connect_formats_ipv6_authorities() {
        assert_eq!(format_authority("2001:db8::1", 22), "[2001:db8::1]:22");
        assert_eq!(format_authority("example.com", 22), "example.com:22");
    }

    #[tokio::test]
    async fn rejects_target_hosts_that_could_inject_http_headers() {
        assert!(matches!(
            connect("ssh.example.com\r\nInjected: true", 22, None).await,
            Err(AppError::Invalid(_))
        ));
    }
}
