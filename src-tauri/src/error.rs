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

    #[error("in use: {0}")]
    InUse(String),

    #[error("{0}")]
    Network(String),

    #[error("{0}")]
    ContextLength(String),

    #[error("cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Database(_) | AppError::Migration(_) => "database",
            AppError::Ssh(russh::Error::UnknownKey) => "host_key",
            AppError::Ssh(
                russh::Error::Disconnect
                | russh::Error::HUP
                | russh::Error::ConnectionTimeout
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
            AppError::Io(_) => "io",
            AppError::Serde(_) => "serde",
            AppError::Crypto(_) => "crypto",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::InUse(_) => "in_use",
            AppError::Network(_) => "network",
            AppError::ContextLength(_) => "context_length",
            AppError::Cancelled => "cancelled",
            AppError::Other(_) => "other",
        }
    }
}

pub fn connection_lost(e: impl std::fmt::Display) -> AppError {
    AppError::Network(format!("connection lost: {e}"))
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
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
            AppError::Ssh(russh::Error::KeepaliveTimeout).code(),
            "network"
        );
        assert_eq!(
            AppError::Sftp(russh_sftp::client::error::Error::Timeout).code(),
            "network"
        );
    }

    #[test]
    fn keeps_local_file_errors_separate_from_network_errors() {
        let io = AppError::Io(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert_eq!(io.code(), "io");
    }
}
