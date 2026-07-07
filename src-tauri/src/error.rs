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

    #[error("cancelled")]
    Cancelled,

    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Database(_) | AppError::Migration(_) => "database",
            AppError::Ssh(_) => "ssh",
            AppError::Sftp(_) => "sftp",
            AppError::Auth(_) => "auth",
            AppError::Io(_) => "io",
            AppError::Serde(_) => "serde",
            AppError::Crypto(_) => "crypto",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::InUse(_) => "in_use",
            AppError::Cancelled => "cancelled",
            AppError::Other(_) => "other",
        }
    }
}

pub fn connection_lost(e: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("connection lost: {e}"))
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
