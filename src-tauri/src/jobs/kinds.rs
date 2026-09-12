//! What the queue can be asked to do, and in which order: a walk outranks everything, since
//! nothing else is known until it runs, and thumbnails follow it.

use serde::{Deserialize, Serialize};

pub const INDEX: &str = "index";
pub const THUMB: &str = "thumb";

pub const PRIORITY_INDEX: i64 = 100;
pub const PRIORITY_THUMB: i64 = 20;

/// A locked or half-written file rarely fails twice; one that fails twice will fail every time.
pub const MAX_ATTEMPTS: i64 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPayload {
    pub item_id: i64,
}
