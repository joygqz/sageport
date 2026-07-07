mod group;
mod host;
mod identity;
mod key;
mod snippet;

pub use group::*;
pub use host::*;
pub use identity::*;
pub use key::*;
pub use snippet::*;

use chrono::Utc;
use uuid::Uuid;

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

pub fn now() -> String {
    Utc::now().to_rfc3339()
}

pub mod auth {
    pub const PASSWORD: &str = "password";
    pub const KEY: &str = "key";
    pub const AGENT: &str = "agent";
}
