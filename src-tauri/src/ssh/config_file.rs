use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const INCLUDE_DEPTH_LIMIT: usize = 8;

pub const WARNING_INCLUDE_UNREADABLE: &str = "include_unreadable";
pub const WARNING_INCLUDE_DEPTH: &str = "include_depth";
pub const WARNING_MATCH_UNSUPPORTED: &str = "match_unsupported";
pub const WARNING_INVALID_PORT: &str = "invalid_port";
pub const WARNING_UNSUPPORTED_TOKEN: &str = "unsupported_token";
pub const WARNING_IDENTITY_UNREADABLE: &str = "identity_unreadable";
pub const WARNING_PROXY_UNRESOLVED: &str = "proxy_unresolved";
pub const WARNING_USERNAME_MISSING: &str = "username_missing";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshConfigHost {
    pub alias: String,
    pub host_name: String,
    pub user: Option<String>,
    pub port: u16,
    pub identity_file: Option<String>,
    pub proxy_jump: Option<String>,
    #[serde(default)]
    pub existing: bool,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Default)]
struct ConfigBlock {
    patterns: Vec<String>,
    directives: Vec<(String, String)>,
}

fn split_directive(line: &str) -> Option<(String, String)> {
    let line = line.split('#').next().unwrap_or("").trim();
    if line.is_empty() {
        return None;
    }
    let (keyword, rest) = match line.split_once([' ', '\t', '=']) {
        Some((key, value)) => (key, value),
        None => (line, ""),
    };
    Some((keyword.to_ascii_lowercase(), rest.trim().to_string()))
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.to_ascii_lowercase().into_bytes();
    let value = value.to_ascii_lowercase().into_bytes();
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;
    for token in pattern {
        let mut current = vec![false; value.len() + 1];
        match token {
            b'*' => {
                current[0] = previous[0];
                for index in 1..=value.len() {
                    current[index] = previous[index] || current[index - 1];
                }
            }
            b'?' => {
                current[1..].copy_from_slice(&previous[..value.len()]);
            }
            literal => {
                for index in 1..=value.len() {
                    current[index] = previous[index - 1] && value[index - 1] == literal;
                }
            }
        }
        previous = current;
    }
    previous[value.len()]
}

fn block_matches(patterns: &[String], alias: &str) -> bool {
    let mut positive = false;
    for pattern in patterns {
        if let Some(negative) = pattern.strip_prefix('!') {
            if wildcard_match(negative, alias) {
                return false;
            }
        } else if wildcard_match(pattern, alias) {
            positive = true;
        }
    }
    positive
}

fn first_value(target: &mut Option<String>, value: &str) {
    if target.is_none() {
        *target = Some(value.to_string());
    }
}

fn parse_config_with_warnings(text: &str, inherited_warnings: &[String]) -> Vec<SshConfigHost> {
    let mut aliases = Vec::new();
    let mut seen_aliases = HashSet::new();
    let mut blocks = vec![ConfigBlock {
        patterns: vec!["*".to_string()],
        directives: Vec::new(),
    }];
    let mut current_block = Some(0usize);
    let mut unsupported_match = false;

    for line in text.lines() {
        let Some((keyword, value)) = split_directive(line) else {
            continue;
        };
        match keyword.as_str() {
            "host" => {
                let patterns = value
                    .split_whitespace()
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                for pattern in &patterns {
                    if pattern.starts_with('!') || pattern.contains(['*', '?']) {
                        continue;
                    }
                    let key = pattern.to_ascii_lowercase();
                    if seen_aliases.insert(key) {
                        aliases.push(pattern.clone());
                    }
                }
                blocks.push(ConfigBlock {
                    patterns,
                    directives: Vec::new(),
                });
                current_block = Some(blocks.len() - 1);
            }
            "match" => {
                unsupported_match = true;
                current_block = None;
            }
            _ => {
                if let Some(index) = current_block {
                    blocks[index].directives.push((keyword, value));
                }
            }
        }
    }

    aliases
        .into_iter()
        .map(|alias| {
            let mut host_name = None;
            let mut user = None;
            let mut port = None;
            let mut identity_file = None;
            let mut proxy_jump = None;
            let mut warnings = inherited_warnings.to_vec();
            if unsupported_match {
                warnings.push(WARNING_MATCH_UNSUPPORTED.to_string());
            }

            for block in &blocks {
                if !block_matches(&block.patterns, &alias) {
                    continue;
                }
                for (keyword, value) in &block.directives {
                    match keyword.as_str() {
                        "hostname" => first_value(&mut host_name, value),
                        "user" => first_value(&mut user, value),
                        "port" => first_value(&mut port, value),
                        "identityfile" => first_value(&mut identity_file, value),
                        "proxyjump" => first_value(&mut proxy_jump, value),
                        _ => {}
                    }
                }
            }

            let host_name = host_name
                .unwrap_or_else(|| alias.clone())
                .replace("%h", &alias)
                .replace("%n", &alias);
            if host_name.contains('%') {
                warnings.push(WARNING_UNSUPPORTED_TOKEN.to_string());
            }
            let port = match port {
                Some(value) => match value.parse::<u16>() {
                    Ok(value) if value > 0 => value,
                    _ => {
                        warnings.push(WARNING_INVALID_PORT.to_string());
                        22
                    }
                },
                None => 22,
            };
            let identity_file = identity_file
                .and_then(|value| (!value.trim().eq_ignore_ascii_case("none")).then_some(value));
            let proxy_jump = proxy_jump.and_then(|value| {
                let first = value.split(',').next().unwrap_or(&value).trim();
                (!first.is_empty() && first != "none").then(|| first.to_string())
            });
            warnings.sort();
            warnings.dedup();

            SshConfigHost {
                alias,
                host_name,
                user,
                port,
                identity_file,
                proxy_jump,
                existing: false,
                warnings,
            }
        })
        .collect()
}

#[cfg(test)]
fn parse_config(text: &str) -> Vec<SshConfigHost> {
    parse_config_with_warnings(text, &[])
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
    let mut warnings = Vec::new();
    inline_includes(config_path, home, 0, &mut text, &mut warnings);
    parse_config_with_warnings(&text, &warnings)
}

fn inline_includes(
    path: &Path,
    home: &Path,
    depth: usize,
    out: &mut String,
    warnings: &mut Vec<String>,
) {
    if depth > INCLUDE_DEPTH_LIMIT {
        warnings.push(WARNING_INCLUDE_DEPTH.to_string());
        return;
    }
    let Ok(contents) = std::fs::read_to_string(path) else {
        warnings.push(WARNING_INCLUDE_UNREADABLE.to_string());
        return;
    };
    let base = path.parent().unwrap_or_else(|| Path::new("."));
    for line in contents.lines() {
        if let Some((keyword, value)) = split_directive(line) {
            if keyword == "include" {
                for token in value.split_whitespace() {
                    let pattern = resolve_include(token, base, home);
                    let Some(pattern) = pattern.to_str() else {
                        warnings.push(WARNING_INCLUDE_UNREADABLE.to_string());
                        continue;
                    };
                    let Ok(paths) = glob::glob(pattern) else {
                        warnings.push(WARNING_INCLUDE_UNREADABLE.to_string());
                        continue;
                    };
                    for included in paths {
                        match included {
                            Ok(included) => {
                                inline_includes(&included, home, depth + 1, out, warnings);
                            }
                            Err(_) => warnings.push(WARNING_INCLUDE_UNREADABLE.to_string()),
                        }
                    }
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
    fn applies_wildcard_defaults_after_specific_blocks() {
        let text = "\
Host bastion prod-*
  HostName bastion.example.com

Host *
  User root
  IdentityFile ~/.ssh/default_key
";
        let hosts = parse_config(text);
        assert_eq!(hosts.len(), 1);
        assert_eq!(hosts[0].alias, "bastion");
        assert_eq!(hosts[0].user.as_deref(), Some("root"));
        assert_eq!(
            hosts[0].identity_file.as_deref(),
            Some("~/.ssh/default_key")
        );
    }

    #[test]
    fn parses_every_explicit_alias() {
        let hosts = parse_config("Host web web-backup *.internal\n  User deploy\n");
        assert_eq!(hosts.len(), 2);
        assert_eq!(hosts[0].alias, "web");
        assert_eq!(hosts[1].alias, "web-backup");
    }

    #[test]
    fn warns_instead_of_applying_match_directives_to_the_previous_host() {
        let hosts = parse_config("Host web\n  User deploy\nMatch user root\n  Port 2200\n");
        assert_eq!(hosts[0].port, 22);
        assert!(hosts[0]
            .warnings
            .contains(&WARNING_MATCH_UNSUPPORTED.to_string()));
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
