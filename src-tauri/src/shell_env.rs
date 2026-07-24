use std::collections::HashMap;
use std::process::Stdio;
use std::time::Duration;

use tokio::sync::OnceCell;

const CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);
const ENV_MARKER: &str = "__sageport_env__";
const SESSION_VARS: [&str; 4] = ["PWD", "OLDPWD", "SHLVL", "_"];

static LOGIN_ENV: OnceCell<HashMap<String, String>> = OnceCell::const_new();

pub async fn prime() {
    LOGIN_ENV.get_or_init(capture).await;
}

pub async fn apply(builder: &mut tokio::process::Command) {
    for (key, value) in LOGIN_ENV.get_or_init(capture).await {
        builder.env(key, value);
    }
}

#[cfg(unix)]
async fn capture() -> HashMap<String, String> {
    let mut builder = tokio::process::Command::new(user_shell());
    builder
        .arg("-i")
        .arg("-l")
        .arg("-c")
        .arg(format!("printf %s {ENV_MARKER}; env -0"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    unsafe {
        builder.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    match tokio::time::timeout(CAPTURE_TIMEOUT, builder.output()).await {
        Ok(Ok(output)) if output.status.success() => parse_env(&output.stdout),
        _ => HashMap::new(),
    }
}

#[cfg(not(unix))]
async fn capture() -> HashMap<String, String> {
    HashMap::new()
}

#[cfg(unix)]
fn user_shell() -> std::ffi::OsString {
    if let Some(shell) = std::env::var_os("SHELL").filter(|value| !value.is_empty()) {
        return shell;
    }
    passwd_shell().unwrap_or_else(|| "/bin/sh".into())
}

#[cfg(unix)]
fn passwd_shell() -> Option<std::ffi::OsString> {
    use std::os::unix::ffi::OsStringExt;
    unsafe {
        let entry = libc::getpwuid(libc::getuid());
        if entry.is_null() || (*entry).pw_shell.is_null() {
            return None;
        }
        let shell = std::ffi::CStr::from_ptr((*entry).pw_shell)
            .to_bytes()
            .to_vec();
        (!shell.is_empty()).then(|| std::ffi::OsString::from_vec(shell))
    }
}

fn parse_env(stdout: &[u8]) -> HashMap<String, String> {
    let Some(start) = marker_end(stdout) else {
        return HashMap::new();
    };
    stdout[start..]
        .split(|byte| *byte == 0)
        .filter_map(|entry| std::str::from_utf8(entry).ok())
        .filter_map(|entry| entry.split_once('='))
        .filter(|(key, _)| !key.is_empty() && !SESSION_VARS.contains(key))
        .map(|(key, value)| (key.to_owned(), value.to_owned()))
        .collect()
}

fn marker_end(stdout: &[u8]) -> Option<usize> {
    stdout
        .windows(ENV_MARKER.len())
        .rposition(|window| window == ENV_MARKER.as_bytes())
        .map(|index| index + ENV_MARKER.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_entries_after_the_marker() {
        let stdout = format!("rc noise\n{ENV_MARKER}PATH=/opt/bin\0HOME=/Users/me\0");
        let parsed = parse_env(stdout.as_bytes());
        assert_eq!(parsed.get("PATH").unwrap(), "/opt/bin");
        assert_eq!(parsed.get("HOME").unwrap(), "/Users/me");
        assert_eq!(parsed.len(), 2);
    }

    #[test]
    fn keeps_values_containing_newlines_and_equals() {
        let stdout = format!("{ENV_MARKER}PROMPT=a=b\nc\0LANG=en_US.UTF-8\0");
        let parsed = parse_env(stdout.as_bytes());
        assert_eq!(parsed.get("PROMPT").unwrap(), "a=b\nc");
        assert_eq!(parsed.get("LANG").unwrap(), "en_US.UTF-8");
    }

    #[test]
    fn drops_session_scoped_variables() {
        let stdout =
            format!("{ENV_MARKER}PWD=/tmp\0OLDPWD=/\0SHLVL=1\0_=/usr/bin/env\0PATH=/bin\0");
        let parsed = parse_env(stdout.as_bytes());
        assert_eq!(parsed.keys().collect::<Vec<_>>(), vec!["PATH"]);
    }

    #[test]
    fn yields_nothing_without_a_marker() {
        assert!(parse_env(b"PATH=/bin\0").is_empty());
        assert!(parse_env(b"").is_empty());
    }
}
