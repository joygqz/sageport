//! Data-access layer. Each repository owns the SQL for one aggregate and
//! returns domain models. Commands depend on these functions, never on raw SQL.

pub mod ai_session_repo;
pub mod group_repo;
pub mod host_repo;
pub mod identity_repo;
pub mod key_repo;
pub mod settings_repo;
pub mod snippet_repo;
pub mod transfer_repo;

/// Normalize an optional secret to `None` when blank, so a clear/delete writes
/// SQL `NULL` rather than an empty string.
pub(crate) fn none_if_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|v| !v.is_empty())
}
