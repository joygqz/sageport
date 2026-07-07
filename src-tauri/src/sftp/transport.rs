use std::fmt;
use std::io;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::error::{AppError, AppResult};
use crate::ssh::AuthMethod;

pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);

const LIBSSH2_EAGAIN: i32 = -37;
const LIBSSH2_SOCKET_SEND: i32 = -7;
const LIBSSH2_TIMEOUT: i32 = -9;
const LIBSSH2_SOCKET_DISCONNECT: i32 = -13;
const LIBSSH2_SOCKET_TIMEOUT: i32 = -30;
const LIBSSH2_SOCKET_RECV: i32 = -43;
const LIBSSH2_BAD_SOCKET: i32 = -45;
const LIBSSH2_FX_NO_CONNECTION: i32 = 6;
const LIBSSH2_FX_CONNECTION_LOST: i32 = 7;
const AUTH_REJECTED_CODES: [i32; 4] = [-15, -18, -19, -48];

pub fn connection_lost(e: impl fmt::Display) -> AppError {
    AppError::Other(format!("connection lost: {e}"))
}

pub fn is_ssh_would_block(e: &ssh2::Error) -> bool {
    e.code() == ssh2::ErrorCode::Session(LIBSSH2_EAGAIN)
}

fn is_ssh_transport_error(e: &ssh2::Error) -> bool {
    matches!(
        e.code(),
        ssh2::ErrorCode::Session(
            LIBSSH2_SOCKET_SEND
                | LIBSSH2_TIMEOUT
                | LIBSSH2_SOCKET_DISCONNECT
                | LIBSSH2_SOCKET_TIMEOUT
                | LIBSSH2_SOCKET_RECV
                | LIBSSH2_BAD_SOCKET,
        ) | ssh2::ErrorCode::SFTP(LIBSSH2_FX_NO_CONNECTION | LIBSSH2_FX_CONNECTION_LOST)
    )
}

pub fn map_ssh_error(e: ssh2::Error) -> AppError {
    if is_ssh_transport_error(&e) {
        connection_lost(e)
    } else {
        AppError::Ssh(e)
    }
}

fn map_auth_error(e: ssh2::Error) -> AppError {
    match e.code() {
        ssh2::ErrorCode::Session(code) if AUTH_REJECTED_CODES.contains(&code) => {
            AppError::Auth("the server rejected these credentials".into())
        }
        _ => AppError::Ssh(e),
    }
}

pub fn connect_tcp(host: &str, port: u16) -> AppResult<TcpStream> {
    let mut last_error = None;
    for addr in (host, port).to_socket_addrs()? {
        match TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT) {
            Ok(tcp) => {
                let _ = tcp.set_nodelay(true);
                return Ok(tcp);
            }
            Err(e) => last_error = Some(e),
        }
    }

    Err(AppError::Io(last_error.unwrap_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            format!("no address resolved for {host}:{port}"),
        )
    })))
}

pub fn authenticate(session: &ssh2::Session, username: &str, auth: &AuthMethod) -> AppResult<()> {
    match auth {
        AuthMethod::Password(password) => session.userauth_password(username, password),
        AuthMethod::Key {
            private_key,
            public_key,
            passphrase,
        } => session.userauth_pubkey_memory(
            username,
            public_key.as_deref(),
            private_key,
            passphrase.as_deref(),
        ),
        AuthMethod::Agent => session.userauth_agent(username),
    }
    .map_err(map_auth_error)?;

    if !session.authenticated() {
        return Err(AppError::Auth(
            "the server rejected these credentials".into(),
        ));
    }
    Ok(())
}
