use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::error::{AppError, AppResult};

pub struct TerminalOutput(Channel);

#[derive(Serialize)]
struct Status<'a> {
    status: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'a str>,
}

impl TerminalOutput {
    pub fn new(channel: Channel) -> Self {
        Self(channel)
    }

    pub fn write(&self, bytes: &[u8]) -> AppResult<()> {
        if bytes.is_empty() {
            return Ok(());
        }
        self.send(InvokeResponseBody::Raw(bytes.to_vec()))
    }

    pub fn status(&self, status: &str, error: Option<&AppError>) -> AppResult<()> {
        self.send(InvokeResponseBody::Json(serde_json::to_string(&Status {
            status,
            message: error.map(ToString::to_string),
            code: error.map(AppError::code),
        })?))
    }

    fn send(&self, body: InvokeResponseBody) -> AppResult<()> {
        self.0
            .send(body)
            .map_err(|error| AppError::Other(format!("terminal output failed: {error}")))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use parking_lot::Mutex;

    use super::*;

    #[test]
    fn sends_binary_output_before_the_final_status() {
        let messages = Arc::new(Mutex::new(Vec::new()));
        let received = messages.clone();
        let output = TerminalOutput::new(Channel::new(move |body| {
            received.lock().push(body);
            Ok(())
        }));

        output.status("connected", None).unwrap();
        output.write(&[0, 255, 0xe4, 0xb8, 0xad]).unwrap();
        output.write(&[]).unwrap();
        output.status("closed", None).unwrap();

        let messages = messages.lock();
        assert_eq!(messages.len(), 3);
        assert!(
            matches!(&messages[0], InvokeResponseBody::Json(json) if json == r#"{"status":"connected"}"#)
        );
        assert!(
            matches!(&messages[1], InvokeResponseBody::Raw(bytes) if bytes == &[0, 255, 0xe4, 0xb8, 0xad])
        );
        assert!(
            matches!(&messages[2], InvokeResponseBody::Json(json) if json == r#"{"status":"closed"}"#)
        );
    }

    #[test]
    fn reports_delivery_failures_to_the_producer() {
        let output =
            TerminalOutput::new(Channel::new(|_| Err(tauri::Error::FailedToReceiveMessage)));
        assert!(output.write(b"output").is_err());
    }
}
