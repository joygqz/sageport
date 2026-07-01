//! Domain models. These map 1:1 to database rows and are serialized to the
//! frontend in camelCase. Secrets (passwords, private keys, passphrases) are
//! stored inline as ordinary columns, just like any other field.

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

/// Generate a fresh entity id.
pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

/// Current timestamp as an RFC3339 UTC string (our sortable sync clock).
pub fn now() -> String {
    Utc::now().to_rfc3339()
}

/// Authentication method shared by hosts and identities.
pub mod auth {
    pub const PASSWORD: &str = "password";
    pub const KEY: &str = "key";
    pub const AGENT: &str = "agent";
}
