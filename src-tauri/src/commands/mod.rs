//! Tauri command handlers. These are thin: they validate/marshal input and
//! delegate to repositories, the SSH manager, or the sync engine.

pub mod ai;
pub mod groups;
pub mod hosts;
pub mod identities;
pub mod keys;
pub mod settings;
pub mod sftp;
pub mod snippets;
pub mod ssh;
pub mod sync;
pub mod update;
pub mod window;
