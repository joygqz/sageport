use url::{Host, Url};

use crate::error::{AppError, AppResult};

pub fn secure_transport(url: &Url) -> bool {
    if url.scheme() == "https" {
        return true;
    }
    if url.scheme() != "http" {
        return false;
    }
    match url.host() {
        Some(Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

pub fn require_secure_transport(url: &Url, field: &str) -> AppResult<()> {
    if secure_transport(url) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "{field} must use HTTPS unless it targets localhost"
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permits_https_and_loopback_http_only() {
        for allowed in [
            "https://example.com",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "http://[::1]:8080",
        ] {
            assert!(secure_transport(&Url::parse(allowed).unwrap()));
        }
        for denied in [
            "http://example.com",
            "http://192.168.1.4",
            "ftp://localhost",
        ] {
            assert!(!secure_transport(&Url::parse(denied).unwrap()));
        }
    }
}
