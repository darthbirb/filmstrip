//! What the queue can be asked to do, and in which order: a walk outranks everything, since
//! nothing else is known until it runs, thumbnails follow it, and scrub frames come last, the
//! dearest per file and the least missed.

use serde::{Deserialize, Serialize};

pub const INDEX: &str = "index";
pub const INDEX_FOLDER: &str = "index_folder";
pub const THUMB: &str = "thumb";
pub const SCRUB: &str = "scrub";
/// Files copied in from outside the library, which counts itself rather than in the walk's line.
pub const COPY_IN: &str = "copy_in";
/// A zip written outside the library, which counts itself too.
pub const EXPORT: &str = "export";

/// The kinds that walk the disk. Only one runs at a time: each retires what it did not see, so a
/// second walk alongside would retire what the first had just found.
pub const WALKS: [&str; 2] = [INDEX, INDEX_FOLDER];

pub const PRIORITY_INDEX: i64 = 100;
/// A copy or an export was asked for and is watched while it runs, so it starts before any
/// thumbnail.
pub const PRIORITY_COPY: i64 = 50;
pub const PRIORITY_THUMB: i64 = 20;
pub const PRIORITY_SCRUB: i64 = 1;

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

/// What a copy brings in, where, and the batch its journal rows go under: the same batch when it
/// goes on after a restart, which is how it knows what already came in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyPayload {
    pub batch_id: String,
    pub folder_id: i64,
    pub paths: Vec<String>,
    /// Every file it carries, for its line while it waits.
    #[serde(default)]
    pub whole: u32,
}

/// What an export writes, how it names the files, the zip it goes to, and where it is written
/// until it is whole.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPayload {
    pub scope: crate::fs::export::Scope,
    pub naming: crate::fs::export::Naming,
    pub dest: String,
    pub part: String,
    pub whole: u32,
}
