pub mod ai_session_repo;
pub mod bookmark_repo;
pub mod forward_repo;
pub mod group_repo;
pub mod history_repo;
pub mod host_repo;
pub mod identity_repo;
pub mod key_repo;
pub mod settings_repo;
pub mod snippet_repo;
pub mod transfer_repo;

pub(crate) fn none_if_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|v| !v.is_empty())
}
