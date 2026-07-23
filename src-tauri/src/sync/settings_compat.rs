use chrono::DateTime;

use super::SettingEntry;

const MAX_API_KEY_BYTES: usize = 16 * 1024;
const MAX_BASE_URL_BYTES: usize = 8 * 1024;
const MAX_FONT_FAMILY_BYTES: usize = 1024;
const MAX_MODEL_BYTES: usize = 1024;
const MAX_ENABLED_TOOLS: usize = 256;
const MAX_TOOL_NAME_BYTES: usize = 128;

pub(super) fn sanitize(entry: &SettingEntry) -> Option<SettingEntry> {
    if DateTime::parse_from_rfc3339(&entry.updated_at).is_err() {
        return None;
    }

    let value = match entry.key.as_str() {
        "general.theme" => sanitize_general_value(&entry.key, &entry.value)?,
        "general.locale" => one_of(&entry.value, &["en", "zh-CN"])?,
        "general.zoomLevel" => sanitize_general_value(&entry.key, &entry.value)?,
        "general.fontFamily" => sanitize_general_value(&entry.key, &entry.value)?,
        "ai.protocol" => one_of(&entry.value, &["openai", "anthropic"])?,
        "ai.base_url" => sanitize_base_url(&entry.value)?,
        "ai.api_key" => bounded_text(&entry.value, MAX_API_KEY_BYTES)?.to_string(),
        "ai.model" => bounded_text(&entry.value, MAX_MODEL_BYTES)?.to_string(),
        "ai.auto_approve" => one_of(&entry.value, &["true", "false"])?,
        "ai.enabled_tools" => sanitize_enabled_tools(&entry.value)?,
        "ai.max_history_tokens" => sanitize_max_history_tokens(&entry.value)?,
        _ => return None,
    };

    Some(SettingEntry {
        key: entry.key.clone(),
        value,
        updated_at: entry.updated_at.clone(),
    })
}

fn sanitize_theme(value: &str) -> Option<String> {
    let canonical = match value {
        "github-dark" | "dark-modern" | "tokyo-night" => "midnight:dark",
        "github-light" | "light-modern" => "midnight:light",
        "one-dark-pro" | "one-dark" => "graphite:dark",
        "dracula" => "dracula:dark",
        "catppuccin-latte" | "solarized-light" => "dracula:light",
        value if is_current_theme(value) => value,
        _ => return None,
    };
    Some(canonical.to_string())
}

fn is_current_theme(value: &str) -> bool {
    let Some((family, mode)) = value.split_once(':') else {
        return false;
    };
    matches!(family, "midnight" | "graphite" | "dracula")
        && matches!(mode, "system" | "light" | "dark")
}

fn sanitize_zoom(value: &str) -> Option<String> {
    let level = value.parse::<i32>().ok()?;
    (-3..=5).contains(&level).then(|| level.to_string())
}

pub(crate) fn sanitize_general_value(key: &str, value: &str) -> Option<String> {
    match key {
        "general.theme" => sanitize_theme(value),
        "general.locale" => one_of(value, &["en", "zh-CN"]),
        "general.zoomLevel" => sanitize_zoom(value),
        "general.fontFamily" => bounded_text(value, MAX_FONT_FAMILY_BYTES).map(str::to_string),
        _ => None,
    }
}

fn sanitize_base_url(value: &str) -> Option<String> {
    let value = bounded_text(value, MAX_BASE_URL_BYTES)?;
    if value.is_empty() {
        return Some(String::new());
    }
    let parsed = url::Url::parse(value).ok()?;
    (matches!(parsed.scheme(), "http" | "https")
        && parsed.host_str().is_some()
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && crate::network::secure_transport(&parsed))
    .then(|| value.to_string())
}

fn sanitize_enabled_tools(value: &str) -> Option<String> {
    let mut names = serde_json::from_str::<Vec<String>>(value).ok()?;
    if names.len() > MAX_ENABLED_TOOLS
        || names
            .iter()
            .any(|name| bounded_text(name, MAX_TOOL_NAME_BYTES).is_none() || name.is_empty())
    {
        return None;
    }
    names.sort();
    names.dedup();
    serde_json::to_string(&names).ok()
}

fn sanitize_max_history_tokens(value: &str) -> Option<String> {
    if value.is_empty() {
        return Some(String::new());
    }
    let limit = value.parse::<u32>().ok()?;
    (limit > 0).then(|| limit.to_string())
}

fn one_of(value: &str, allowed: &[&str]) -> Option<String> {
    allowed.contains(&value).then(|| value.to_string())
}

fn bounded_text(value: &str, max_bytes: usize) -> Option<&str> {
    (value.len() <= max_bytes && !value.chars().any(char::is_control)).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const UPDATED_AT: &str = "2026-07-13T15:27:55.369595+00:00";

    fn setting(key: &str, value: &str) -> SettingEntry {
        SettingEntry {
            key: key.to_string(),
            value: value.to_string(),
            updated_at: UPDATED_AT.to_string(),
        }
    }

    #[test]
    fn migrates_legacy_theme_values() {
        let migrated = sanitize(&setting("general.theme", "dark-modern")).unwrap();
        assert_eq!(migrated.value, "midnight:dark");

        let migrated = sanitize(&setting("general.theme", "dracula")).unwrap();
        assert_eq!(migrated.value, "dracula:dark");
    }

    #[test]
    fn keeps_valid_current_settings() {
        assert_eq!(
            sanitize(&setting("general.theme", "graphite:system"))
                .unwrap()
                .value,
            "graphite:system"
        );
        assert!(sanitize(&setting("general.locale", "zh-CN")).is_some());
        assert!(sanitize(&setting("general.zoomLevel", "-3")).is_some());
        assert!(sanitize(&setting("ai.protocol", "anthropic")).is_some());
        assert!(sanitize(&setting("ai.base_url", "http://localhost:11434/v1")).is_some());
        assert!(sanitize(&setting("ai.auto_approve", "false")).is_some());
        assert!(sanitize(&setting("ai.max_history_tokens", "200000")).is_some());
    }

    #[test]
    fn drops_incompatible_or_unknown_settings() {
        assert!(sanitize(&setting("general.theme", "removed-theme")).is_none());
        assert!(sanitize(&setting("general.locale", "invalid")).is_none());
        assert!(sanitize(&setting("general.zoomLevel", "99")).is_none());
        assert!(sanitize(&setting("appearance.theme", "midnight:dark")).is_none());
        assert!(sanitize(&setting("ai.protocol", "removed-protocol")).is_none());
        assert!(sanitize(&setting("ai.base_url", "not a url")).is_none());
        assert!(sanitize(&setting("ai.base_url", "https://user:pass@example.com")).is_none());
        assert!(sanitize(&setting(
            "ai.base_url",
            "https://example.com/v1?token=secret"
        ))
        .is_none());
        assert!(sanitize(&setting("ai.auto_approve", "1")).is_none());
        assert!(sanitize(&setting("future.setting", "value")).is_none());
        assert!(sanitize(&setting("sync.connection", "secret")).is_none());
    }

    #[test]
    fn drops_structurally_invalid_values() {
        assert!(sanitize(&setting("ai.enabled_tools", "not-json")).is_none());
        assert!(sanitize(&setting("ai.enabled_tools", r#"[1,2]"#)).is_none());
        assert!(sanitize(&setting("ai.max_history_tokens", "-1")).is_none());

        let mut invalid_timestamp = setting("general.locale", "en");
        invalid_timestamp.updated_at = "yesterday".to_string();
        assert!(sanitize(&invalid_timestamp).is_none());
    }

    #[test]
    fn canonicalizes_enabled_tools() {
        let sanitized = sanitize(&setting(
            "ai.enabled_tools",
            r#"["write_file","read_file","write_file"]"#,
        ))
        .unwrap();
        assert_eq!(sanitized.value, r#"["read_file","write_file"]"#);
    }
}
