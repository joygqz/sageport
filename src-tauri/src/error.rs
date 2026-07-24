use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("ssh error: {0}")]
    Ssh(#[from] russh::Error),

    #[error("sftp error: {0}")]
    Sftp(#[from] russh_sftp::client::error::Error),

    #[error("authentication failed: {0}")]
    Auth(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("crypto error: {0}")]
    Crypto(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    Invalid(String),

    #[error("in use: {message}")]
    InUse {
        kind: &'static str,
        count: i64,
        message: String,
    },

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("{0}")]
    Network(String),

    #[error("{0}")]
    Dns(String),

    #[error("{0}")]
    Timeout(String),

    #[error("{0}")]
    ContextLength(String),

    #[error("cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

pub mod in_use_kind {
    pub const HOST_JUMP: &str = "hostJump";
    pub const HOST_FORWARD: &str = "hostForward";
    pub const HOST_TASK: &str = "hostTask";
    pub const KEY: &str = "key";
    pub const IDENTITY: &str = "identity";
    pub const TASK_RUN: &str = "taskRun";
    pub const TRANSFER: &str = "transfer";
}

impl AppError {
    pub fn in_use(kind: &'static str, count: i64, message: impl Into<String>) -> Self {
        AppError::InUse {
            kind,
            count,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            AppError::Database(_) | AppError::Migration(_) => "database",
            AppError::Ssh(russh::Error::UnknownKey) => "host_key",
            AppError::Ssh(russh::Error::ConnectionTimeout) => "timeout",
            AppError::Ssh(
                russh::Error::Disconnect
                | russh::Error::HUP
                | russh::Error::KeepaliveTimeout
                | russh::Error::InactivityTimeout
                | russh::Error::SendError
                | russh::Error::RecvError
                | russh::Error::IO(_),
            ) => "network",
            AppError::Ssh(_) => "ssh",
            AppError::Sftp(
                russh_sftp::client::error::Error::IO(_)
                | russh_sftp::client::error::Error::Timeout
                | russh_sftp::client::error::Error::UnexpectedBehavior(_),
            ) => "network",
            AppError::Sftp(russh_sftp::client::error::Error::Status(status))
                if status.status_code == russh_sftp::protocol::StatusCode::NoSuchFile =>
            {
                "not_found"
            }
            AppError::Sftp(_) => "sftp",
            AppError::Auth(_) => "auth",
            AppError::Io(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::TimedOut
                        | std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::ConnectionRefused
                        | std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::NotConnected
                        | std::io::ErrorKind::AddrNotAvailable
                        | std::io::ErrorKind::BrokenPipe
                        | std::io::ErrorKind::UnexpectedEof
                ) =>
            {
                "network"
            }
            AppError::Io(e) if e.kind() == std::io::ErrorKind::NotFound => "not_found",
            AppError::Io(_) => "io",
            AppError::Serde(_) => "serde",
            AppError::Crypto(_) => "crypto",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::InUse { .. } => "in_use",
            AppError::Conflict(_) => "conflict",
            AppError::Network(_) => "network",
            AppError::Dns(_) => "dns",
            AppError::Timeout(_) => "timeout",
            AppError::ContextLength(_) => "context_length",
            AppError::Cancelled => "cancelled",
            AppError::Other(_) => "other",
        }
    }
}

pub fn connection_lost(e: impl std::fmt::Display) -> AppError {
    AppError::Network(format!("connection lost: {e}"))
}

#[derive(Serialize)]
struct InUseDetails<'a> {
    kind: &'a str,
    count: i64,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 3)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        if let AppError::InUse { kind, count, .. } = self {
            state.serialize_field(
                "details",
                &InUseDetails {
                    kind,
                    count: *count,
                },
            )?;
        } else {
            state.skip_field("details")?;
        }
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_transport_failures_as_network_errors() {
        let io = AppError::Io(std::io::Error::from(std::io::ErrorKind::ConnectionReset));
        assert_eq!(io.code(), "network");
        assert_eq!(
            AppError::Ssh(russh::Error::ConnectionTimeout).code(),
            "timeout"
        );
        assert_eq!(
            AppError::Ssh(russh::Error::KeepaliveTimeout).code(),
            "network"
        );
        assert_eq!(AppError::Dns("lookup failed".into()).code(), "dns");
        assert_eq!(
            AppError::Sftp(russh_sftp::client::error::Error::Timeout).code(),
            "network"
        );
    }

    #[test]
    fn serializes_in_use_errors_with_structured_details() {
        let err = AppError::in_use(in_use_kind::HOST_FORWARD, 2, "this host is still in use");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "in_use");
        assert_eq!(json["message"], "in use: this host is still in use");
        assert_eq!(json["details"]["kind"], "hostForward");
        assert_eq!(json["details"]["count"], 2);

        let plain = serde_json::to_value(AppError::NotFound("host x".into())).unwrap();
        assert!(plain.get("details").is_none());
    }

    #[test]
    fn classifies_missing_paths_as_not_found_errors() {
        let io = AppError::Io(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert_eq!(io.code(), "not_found");

        let sftp = AppError::Sftp(russh_sftp::client::error::Error::Status(
            russh_sftp::protocol::Status {
                id: 1,
                status_code: russh_sftp::protocol::StatusCode::NoSuchFile,
                error_message: "missing".into(),
                language_tag: "en".into(),
            },
        ));
        assert_eq!(sftp.code(), "not_found");
    }
}
