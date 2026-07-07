use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const INCLUDE_DEPTH_LIMIT: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    pub host_name: String,
    pub user: Option<String>,
    pub port: u16,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
}

fn is_wildcard(pattern: &str) -> bool {
    pattern.contains(['*', '?', '!'])
}

fn split_directive(line: &str) -> Option<(String, String)> {
    let line = line.split('#').next().unwrap_or("").trim();
    if line.is_empty() {
        return None;
    }
    let (keyword, rest) = match line.split_once([' ', '\t', '=']) {
        Some((k, r)) => (k, r),
        None => (line, ""),
    };
    Some((keyword.to_ascii_lowercase(), rest.trim().to_string()))
}

pub fn parse_config(text: &str) -> Vec<SshConfigHost> {
    let mut hosts = Vec::new();
    let mut current: Option<SshConfigHost> = None;

    for line in text.lines() {
        let Some((keyword, value)) = split_directive(line) else {
            continue;
        };

        if keyword == "host" {
            if let Some(host) = current.take() {
                hosts.push(host);
            }
            let alias = value.split_whitespace().find(|p| !is_wildcard(p));
            current = alias.map(|alias| SshConfigHost {
                alias: alias.to_string(),
                host_name: alias.to_string(),
                user: None,
                port: 22,
                identity_file: None,
                proxy_jump: None,
            });
            continue;
        }

        let Some(host) = current.as_mut() else {
            continue;
        };
        match keyword.as_str() {
            "hostname" => host.host_name = value,
            "user" => host.user = Some(value),
            "port" => {
                if let Ok(port) = value.parse() {
                    host.port = port;
                }
            }
            "identityfile" => host.identity_file = Some(value),
            "proxyjump" => {
                let first = value.split(',').next().unwrap_or(&value).trim();
                if !first.is_empty() && first != "none" {
                    host.proxy_jump = Some(first.to_string());
                }
            }
            _ => {}
        }
    }

    if let Some(host) = current.take() {
        hosts.push(host);
    }
    hosts
}

pub fn expand_tilde(path: &str, home: &Path) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        home.join(rest)
    } else if path == "~" {
        home.to_path_buf()
    } else {
        PathBuf::from(path)
    }
}

pub fn load(config_path: &Path, home: &Path) -> Vec<SshConfigHost> {
    let mut text = String::new();
    inline_includes(config_path, home, 0, &mut text);
    parse_config(&text)
}

fn inline_includes(path: &Path, home: &Path, depth: usize, out: &mut String) {
    if depth > INCLUDE_DEPTH_LIMIT {
        return;
    }
    let Ok(contents) = std::fs::read_to_string(path) else {
        return;
    };
    let base = path.parent().unwrap_or_else(|| Path::new("."));
    for line in contents.lines() {
        if let Some((keyword, value)) = split_directive(line) {
            if keyword == "include" {
                for token in value.split_whitespace() {
                    let included = resolve_include(token, base, home);
                    inline_includes(&included, home, depth + 1, out);
                }
                continue;
            }
        }
        out.push_str(line);
        out.push('\n');
    }
}

fn resolve_include(token: &str, base: &Path, home: &Path) -> PathBuf {
    if token.starts_with("~/") || token == "~" {
        expand_tilde(token, home)
    } else if Path::new(token).is_absolute() {
        PathBuf::from(token)
    } else {
        base.join(token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_blocks() {
        let text = "\
Host web
  HostName 10.0.0.4
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_ed25519

Host db
  HostName db.internal
";
        let hosts = parse_config(text);
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].alias, "web");
        assert_eq!(hosts[0].host_name, "10.0.0.4");
        assert_eq!(hosts[0].user.as_deref(), Some("deploy"));
        assert_eq!(hosts[0].port, 2222);
        assert_eq!(hosts[0].identity_file.as_deref(), Some("~/.ssh/id_ed25519"));
        assert_eq!(hosts[1].alias, "db");
        assert_eq!(hosts[1].host_name, "db.internal");
        assert_eq!(hosts[1].port, 22);
    }

    #[test]
    fn skips_wildcard_and_defaults_blocks() {
        let text = "\
Host *
  User root

Host bastion prod-*
  HostName bastion.example.com
";
        let hosts = parse_config(text);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "bastion");
        assert_eq!(hosts[0].host_name, "bastion.example.com");
    }

    #[test]
    fn parses_proxy_jump_first_hop() {
        let text = "\
Host target
  HostName 10.0.0.9
  ProxyJump admin@bastion:22, other
";
        let hosts = parse_config(text);
        assert_eq!(hosts[0].proxy_jump.as_deref(), Some("admin@bastion:22"));
    }

    #[test]
    fn handles_equals_and_tab_separators() {
        let text = "Host=api\n\tHostName=api.example.com\n";
        let hosts = parse_config(text);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "api");
        assert_eq!(hosts[0].host_name, "api.example.com");
    }

    #[test]
    fn expands_tilde() {
        let home = Path::new("/home/alex");
        assert_eq!(
            expand_tilde("~/.ssh/key", home),
            PathBuf::from("/home/alex/.ssh/key")
        );
        assert_eq!(expand_tilde("/abs/key", home), PathBuf::from("/abs/key"));
    }
}
