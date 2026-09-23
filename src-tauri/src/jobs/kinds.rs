//! What the queue can be asked to do, and in which order: a walk outranks everything, since
//! nothing else is known until it runs, and thumbnails follow it.

use serde::{Deserialize, Serialize};

pub const INDEX: &str = "index";
pub const INDEX_FOLDER: &str = "index_folder";
pub const THUMB: &str = "thumb";

/// The kinds that walk the disk. Only one runs at a time: each retires what it did not see, so a
/// second walk alongside would retire what the first had just found.
pub const WALKS: [&str; 2] = [INDEX, INDEX_FOLDER];

pub const PRIORITY_INDEX: i64 = 100;
pub const PRIORITY_THUMB: i64 = 20;

/// A locked or half-written file rarely fails twice; one that fails twice will fail every time.
pub const MAX_ATTEMPTS: i64 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPayload {
    pub item_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPayload {
    pub folder_id: i64,
}
