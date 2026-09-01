use sqlx::SqlitePool;

use crate::domain::{new_id, now, proxy_kind, ProxyProfile, ProxyProfileInput};
use crate::error::{AppError, AppResult};
use crate::repository::{none_if_empty, settings_repo};

pub const ACTIVE_PROXY_KEY: &str = "proxy.active_id";
const MAX_NAME_BYTES: usize = 255;
const MAX_HOST_BYTES: usize = 255;
const MAX_USERNAME_BYTES: usize = 255;
const MAX_PASSWORD_BYTES: usize = 1024;

fn normalize_host(value: String) -> String {
    let value = value.trim();
    if value.starts_with('[')
        && value.ends_with(']')
        && value[1..value.len() - 1]
            .parse::<std::net::Ipv6Addr>()
            .is_ok()
    {
        value[1..value.len() - 1].to_string()
    } else {
        value.to_string()
    }
}

pub(crate) fn normalize(mut input: ProxyProfileInput) -> AppResult<ProxyProfileInput> {
    input.name = input.name.trim().to_string();
    input.kind = input.kind.trim().to_ascii_lowercase();
    input.host = normalize_host(input.host);
    input.username = input
        .username
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if input.name.is_empty() {
        return Err(AppError::Invalid("proxy name is required".into()));
    }
    if input.name.len() > MAX_NAME_BYTES || input.name.chars().any(char::is_control) {
        return Err(AppError::Invalid("invalid or oversized proxy name".into()));
    }
    if !matches!(input.kind.as_str(), proxy_kind::SOCKS5 | proxy_kind::HTTP) {
        return Err(AppError::Invalid(format!(
            "unknown proxy kind: {}",
            input.kind
        )));
    }
    if input.kind == proxy_kind::HTTP
        && input
            .username
            .as_deref()
            .is_some_and(|value| value.contains(':'))
    {
        return Err(AppError::Invalid(
            "HTTP proxy username cannot contain a colon".into(),
        ));
    }
    if input.host.is_empty()
        || input.host.len() > MAX_HOST_BYTES
        || input.host.chars().any(char::is_control)
    {
        return Err(AppError::Invalid("invalid proxy host".into()));
    }
    if !(1..=65535).contains(&input.port) {
        return Err(AppError::Invalid(
            "proxy port must be between 1 and 65535".into(),
        ));
    }
    if input.username.as_deref().is_some_and(|value| {
        value.len() > MAX_USERNAME_BYTES || value.chars().any(char::is_control)
    }) {
        return Err(AppError::Invalid("invalid proxy username".into()));
    }
    if input.password.as_deref().is_some_and(|value| {
        value.len() > MAX_PASSWORD_BYTES || value.chars().any(char::is_control)
    }) {
        return Err(AppError::Invalid(
            "invalid or oversized proxy password".into(),
        ));
    }
    if input
        .password
        .as_deref()
        .is_some_and(|value| !value.is_empty())
        && input.username.is_none()
    {
        return Err(AppError::Invalid(
            "proxy username is required when a password is set".into(),
        ));
    }
    if input.username.is_none() {
        input.password = Some(String::new());
    }
    if input.kind == proxy_kind::SOCKS5
        && (input
            .username
            .as_deref()
            .is_some_and(|value| value.len() > u8::MAX as usize)
            || input
                .password
                .as_deref()
                .is_some_and(|value| value.len() > u8::MAX as usize))
    {
        return Err(AppError::Invalid(
            "SOCKS5 credentials cannot exceed 255 bytes".into(),
        ));
    }
    Ok(input)
}

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<ProxyProfile>> {
    Ok(sqlx::query_as::<_, ProxyProfile>(
        "SELECT * FROM proxy_profiles WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<ProxyProfile> {
    get_in(pool, id).await
}

async fn get_in<'e, E>(executor: E, id: &str) -> AppResult<ProxyProfile>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    sqlx::query_as::<_, ProxyProfile>(
        "SELECT * FROM proxy_profiles WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(executor)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("proxy profile {id}")))
}

pub async fn active(pool: &SqlitePool) -> AppResult<Option<ProxyProfile>> {
    let Some(id) = settings_repo::get(pool, ACTIVE_PROXY_KEY).await? else {
        return Ok(None);
    };
    Ok(sqlx::query_as::<_, ProxyProfile>(
        "SELECT * FROM proxy_profiles WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

pub async fn active_id(pool: &SqlitePool) -> AppResult<Option<String>> {
    Ok(active(pool).await?.map(|profile| profile.id))
}

pub async fn set_active(pool: &SqlitePool, id: Option<&str>) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    if let Some(id) = id {
        get_in(&mut *tx, id).await?;
        settings_repo::set_in(&mut tx, ACTIVE_PROXY_KEY, id).await?;
    } else {
        sqlx::query("DELETE FROM settings WHERE key = ?")
            .bind(ACTIVE_PROXY_KEY)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn create(pool: &SqlitePool, input: ProxyProfileInput) -> AppResult<ProxyProfile> {
    let input = normalize(input)?;
    let id = new_id();
    let ts = now();
    let password = none_if_empty(input.password.as_deref());
    sqlx::query(
        "INSERT INTO proxy_profiles
           (id, name, kind, host, port, username, password, created_at, updated_at, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.kind)
    .bind(&input.host)
    .bind(input.port)
    .bind(&input.username)
    .bind(password)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    get(pool, &id).await
}

pub async fn update(
    pool: &SqlitePool,
    id: &str,
    input: ProxyProfileInput,
) -> AppResult<ProxyProfile> {
    let input = normalize(input)?;
    let mut tx = pool.begin().await?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE proxy_profiles SET
           name = ?, kind = ?, host = ?, port = ?, username = ?,
           updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&input.name)
    .bind(&input.kind)
    .bind(&input.host)
    .bind(input.port)
    .bind(&input.username)
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("proxy profile {id}")));
    }
    if input.password.is_some() {
        let password = none_if_empty(input.password.as_deref());
        sqlx::query("UPDATE proxy_profiles SET password = ? WHERE id = ?")
            .bind(password)
            .bind(id)
            .execute(&mut *tx)
            .await?;
    }
    let profile = get_in(&mut *tx, id).await?;
    tx.commit().await?;
    Ok(profile)
}

pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let mut tx = pool.begin().await?;
    let ts = now();
    let affected = sqlx::query(
        "UPDATE proxy_profiles
         SET deleted_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(id)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if affected == 0 {
        return Err(AppError::NotFound(format!("proxy profile {id}")));
    }
    sqlx::query("DELETE FROM settings WHERE key = ? AND value = ?")
        .bind(ACTIVE_PROXY_KEY)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::sqlite::SqlitePoolOptions;

    use super::*;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn input(kind: &str) -> ProxyProfileInput {
        ProxyProfileInput {
            name: " Office ".into(),
            kind: kind.into(),
            host: " proxy.example.com ".into(),
            port: 1080,
            username: Some(" alice ".into()),
            password: Some("secret".into()),
        }
    }

    #[test]
    fn validates_proxy_profiles_and_socks_credentials() {
        let normalized = normalize(input(proxy_kind::SOCKS5)).unwrap();
        assert_eq!(normalized.name, "Office");
        assert_eq!(normalized.host, "proxy.example.com");
        assert_eq!(normalized.username.as_deref(), Some("alice"));

        let mut invalid = input("ftp");
        assert!(matches!(normalize(invalid), Err(AppError::Invalid(_))));

        invalid = input(proxy_kind::HTTP);
        invalid.port = 0;
        assert!(matches!(normalize(invalid), Err(AppError::Invalid(_))));

        invalid = input(proxy_kind::HTTP);
        invalid.host = "proxy.example.com\r\nInjected: true".into();
        assert!(matches!(normalize(invalid), Err(AppError::Invalid(_))));

        invalid = input(proxy_kind::HTTP);
        invalid.username = Some("alice:admin".into());
        assert!(matches!(normalize(invalid), Err(AppError::Invalid(_))));

        invalid = input(proxy_kind::SOCKS5);
        invalid.username = Some("x".repeat(256));
        assert!(matches!(normalize(invalid), Err(AppError::Invalid(_))));
    }

    #[tokio::test]
    async fn active_proxy_is_validated_and_cleared_on_delete() {
        let pool = test_pool().await;
        let profile = create(&pool, input(proxy_kind::SOCKS5)).await.unwrap();
        set_active(&pool, Some(&profile.id)).await.unwrap();
        assert_eq!(
            active_id(&pool).await.unwrap().as_deref(),
            Some(profile.id.as_str())
        );

        delete(&pool, &profile.id).await.unwrap();
        assert!(active(&pool).await.unwrap().is_none());
        assert!(settings_repo::get(&pool, ACTIVE_PROXY_KEY)
            .await
            .unwrap()
            .is_none());
        assert!(matches!(
            set_active(&pool, Some(&profile.id)).await,
            Err(AppError::NotFound(_))
        ));
    }

    #[tokio::test]
    async fn password_updates_distinguish_keep_replace_and_clear() {
        let pool = test_pool().await;
        let profile = create(&pool, input(proxy_kind::HTTP)).await.unwrap();
        let public =
            serde_json::to_value(crate::domain::ProxyProfileView::from(profile.clone())).unwrap();
        assert_eq!(public["hasPassword"], true);
        assert!(public.get("password").is_none());

        let mut kept = input(proxy_kind::HTTP);
        kept.password = None;
        assert_eq!(
            update(&pool, &profile.id, kept)
                .await
                .unwrap()
                .password
                .as_deref(),
            Some("secret")
        );

        let mut cleared = input(proxy_kind::HTTP);
        cleared.password = Some(String::new());
        assert!(update(&pool, &profile.id, cleared)
            .await
            .unwrap()
            .password
            .is_none());

        let profile = create(&pool, input(proxy_kind::HTTP)).await.unwrap();
        let mut unauthenticated = input(proxy_kind::HTTP);
        unauthenticated.username = None;
        unauthenticated.password = None;
        assert!(update(&pool, &profile.id, unauthenticated)
            .await
            .unwrap()
            .password
            .is_none());
    }
}
