//! The undo journal: what the app changed on disk, and what reverses it.
//! DECISIONS.md "Undo".

use std::collections::{BTreeMap, HashSet};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::db::now;
use crate::error::Result;
use crate::jobs::kinds::ACTS;

pub const FOLDER_CREATE: &str = "folder_create";
pub const FOLDER_RENAME: &str = "folder_rename";
pub const FOLDER_MOVE: &str = "folder_move";
pub const ITEM_MOVE: &str = "item_move";
pub const ITEM_TRASH: &str = "item_trash";
pub const ITEM_RENAME: &str = "item_rename";
pub const FOLDER_DELETE: &str = "folder_delete";
pub const ITEM_RESTORE: &str = "item_restore";
pub const ITEMS_TAG: &str = "items_tag";
pub const ITEMS_UNTAG: &str = "items_untag";
pub const RETAG: &str = "retag";
pub const ITEM_COPY: &str = "item_copy";
pub const FOLDER_COPY: &str = "folder_copy";

/// A file copied in from outside the library, and the folder the copy was made into, which is
/// its own folder or one above it. Its inverse is itself: undoing it sends the file to the trash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCopied {
    pub item_id: i64,
    pub folder_id: i64,
    pub into: i64,
}

/// A folder made by a copy, to hold what came in under it. Its inverse is itself: undoing it
/// takes the folder away again once what came into it has gone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCopied {
    pub folder_id: i64,
    pub parent_id: i64,
    pub into: i64,
}

/// A folder the app made. Its inverse is itself: undoing it removes that folder again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCreated {
    pub folder_id: i64,
    pub parent_id: i64,
}

/// A folder renamed on disk. The inverse swaps `from` and `to`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRenamed {
    pub folder_id: i64,
    pub from: String,
    pub to: String,
}

/// A folder moved into another. The inverse swaps the two parents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMoved {
    pub folder_id: i64,
    pub from_parent_id: i64,
    pub to_parent_id: i64,
}

/// An item moved into another folder. The inverse swaps the two folders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemMoved {
    pub item_id: i64,
    pub from_folder_id: i64,
    pub to_folder_id: i64,
}

/// A file renamed on disk. The inverse swaps `from` and `to`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRenamed {
    pub item_id: i64,
    pub from: String,
    pub to: String,
}

/// An item sent to the trash. Its inverse is itself: undoing it brings the item back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTrashed {
    pub item_id: i64,
}

/// An item taken out of the trash into a folder, the one it left or another. Its inverse is itself:
/// undoing it sends the item back as it was, from the folder it left and at the moment it went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRestored {
    pub item_id: i64,
    pub left_folder_id: i64,
    pub to_folder_id: i64,
    pub trashed_at: i64,
}

/// A folder deleted, and every folder under it retired with the same stamp, which is how undo
/// finds them again. Its inverse is itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDeleted {
    pub folder_id: i64,
    pub retired_at: i64,
}

/// A tag given to every file in a set that lacked it, and exactly those. Its inverse is itself:
/// undoing it takes the tag off those files again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemsTagged {
    pub tag_id: i64,
    pub value: String,
    pub item_ids: Vec<i64>,
}

/// One file a tag was taken off, and when it had been given, so an undo puts it back in its place.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Untagged {
    pub item_id: i64,
    pub added_at: i64,
}

/// A file's own tag taken off every file in a set that had it. Its inverse is itself: undoing it
/// gives the tag back to exactly those files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemsUntagged {
    pub tag_id: i64,
    pub value: String,
    pub items: Vec<Untagged>,
}

/// What the tags screen did to the library's vocabulary, in the terms its line names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Change {
    RenameTag {
        from: String,
        to: String,
    },
    MergeTags {
        from: String,
        into: String,
    },
    DeleteTag {
        tag: String,
    },
    RenameKey {
        from: String,
        to: String,
    },
    MergeKeys {
        from: String,
        into: String,
    },
    DeleteKey {
        key: String,
    },
    RenameValue {
        key: String,
        from: String,
        to: String,
    },
    MergeValues {
        key: String,
        from: String,
        into: String,
    },
    DeleteValue {
        key: String,
        value: String,
    },
}

/// A term as the `tag` table held it, under its own id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Term {
    pub id: i64,
    pub key: Option<String>,
    pub value: String,
}

/// A term whose text changed where it stands, keeping its id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reworded {
    pub id: i64,
    pub from: Term,
    pub to: Term,
}

/// One `folder_tag` row the act moved onto another term, or took away when `to` is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderUse {
    pub folder_id: i64,
    pub rowid: i64,
    pub source: String,
    pub from: i64,
    pub to: Option<i64>,
}

/// One `item_tag` row the act moved onto another term, or took away when `to` is `None`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUse {
    pub item_id: i64,
    pub rowid: i64,
    pub added_at: i64,
    pub from: i64,
    pub to: Option<i64>,
}

/// A rename, merge or delete of a tag, a key or a value, with every row it touched, so an undo
/// puts each back under its own id. Its inverse is itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Retagged {
    pub change: Change,
    /// What the line counts: the files that carried it and the folders that held it.
    pub files: u32,
    pub folders: u32,
    pub reworded: Vec<Reworded>,
    /// Terms the act made, which an undo takes away again once nothing holds them.
    pub made: Vec<Term>,
    /// Terms the act took away once nothing held them, which an undo makes again.
    pub removed: Vec<Term>,
    pub folder_uses: Vec<FolderUse>,
    pub item_uses: Vec<ItemUse>,
}

/// One row, as undo reads it back. Both halves stay JSON until its op says what they are.
#[derive(Debug, Clone)]
pub struct Entry {
    pub id: i64,
    pub op: String,
    pub forward: Value,
    pub inverse: Value,
}

/// A fresh id for one act: a single folder made, or a whole selection moved.
pub fn new_batch() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn record<T: Serialize>(
    conn: &Connection,
    batch_id: &str,
    op: &str,
    forward: &T,
    inverse: &T,
) -> Result<()> {
    conn.execute(
        "DELETE FROM journal
          WHERE undone IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM journal j WHERE j.batch_id = ?1 AND j.undone IS NOT NULL)",
        params![batch_id],
    )?;
    conn.execute(
        "INSERT INTO journal (batch_id, op, forward, inverse, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            batch_id,
            op,
            serde_json::to_string(forward)?,
            serde_json::to_string(inverse)?,
            now()
        ],
    )?;
    Ok(())
}

pub fn record_folder_create(
    conn: &Connection,
    batch_id: &str,
    folder_id: i64,
    parent_id: i64,
) -> Result<()> {
    let made = FolderCreated {
        folder_id,
        parent_id,
    };
    record(conn, batch_id, FOLDER_CREATE, &made, &made)
}

pub fn record_folder_rename(
    conn: &Connection,
    batch_id: &str,
    folder_id: i64,
    from: &str,
    to: &str,
) -> Result<()> {
    let forward = FolderRenamed {
        folder_id,
        from: from.to_string(),
        to: to.to_string(),
    };
    let inverse = FolderRenamed {
        folder_id,
        from: to.to_string(),
        to: from.to_string(),
    };
    record(conn, batch_id, FOLDER_RENAME, &forward, &inverse)
}

pub fn record_folder_move(
    conn: &Connection,
    batch_id: &str,
    folder_id: i64,
    from_parent_id: i64,
    to_parent_id: i64,
) -> Result<()> {
    let forward = FolderMoved {
        folder_id,
        from_parent_id,
        to_parent_id,
    };
    let inverse = FolderMoved {
        folder_id,
        from_parent_id: to_parent_id,
        to_parent_id: from_parent_id,
    };
    record(conn, batch_id, FOLDER_MOVE, &forward, &inverse)
}

pub fn record_item_move(
    conn: &Connection,
    batch_id: &str,
    item_id: i64,
    from_folder_id: i64,
    to_folder_id: i64,
) -> Result<()> {
    let forward = ItemMoved {
        item_id,
        from_folder_id,
        to_folder_id,
    };
    let inverse = ItemMoved {
        item_id,
        from_folder_id: to_folder_id,
        to_folder_id: from_folder_id,
    };
    record(conn, batch_id, ITEM_MOVE, &forward, &inverse)
}

pub fn record_item_rename(
    conn: &Connection,
    batch_id: &str,
    item_id: i64,
    from: &str,
    to: &str,
) -> Result<()> {
    let forward = ItemRenamed {
        item_id,
        from: from.to_string(),
        to: to.to_string(),
    };
    let inverse = ItemRenamed {
        item_id,
        from: to.to_string(),
        to: from.to_string(),
    };
    record(conn, batch_id, ITEM_RENAME, &forward, &inverse)
}

pub fn record_item_trash(conn: &Connection, batch_id: &str, item_id: i64) -> Result<()> {
    let trashed = ItemTrashed { item_id };
    record(conn, batch_id, ITEM_TRASH, &trashed, &trashed)
}

pub fn record_item_restore(
    conn: &Connection,
    batch_id: &str,
    restored: &ItemRestored,
) -> Result<()> {
    record(conn, batch_id, ITEM_RESTORE, restored, restored)
}

pub fn record_folder_delete(
    conn: &Connection,
    batch_id: &str,
    folder_id: i64,
    retired_at: i64,
) -> Result<()> {
    let deleted = FolderDeleted {
        folder_id,
        retired_at,
    };
    record(conn, batch_id, FOLDER_DELETE, &deleted, &deleted)
}

pub fn record_items_tag(conn: &Connection, batch_id: &str, tagged: &ItemsTagged) -> Result<()> {
    record(conn, batch_id, ITEMS_TAG, tagged, tagged)
}

pub fn record_items_untag(
    conn: &Connection,
    batch_id: &str,
    untagged: &ItemsUntagged,
) -> Result<()> {
    record(conn, batch_id, ITEMS_UNTAG, untagged, untagged)
}

pub fn record_retag(conn: &Connection, batch_id: &str, retagged: &Retagged) -> Result<()> {
    record(conn, batch_id, RETAG, retagged, retagged)
}

pub fn record_item_copy(conn: &Connection, batch_id: &str, copied: &ItemCopied) -> Result<i64> {
    record(conn, batch_id, ITEM_COPY, copied, copied)?;
    Ok(conn.last_insert_rowid())
}

pub fn record_folder_copy(conn: &Connection, batch_id: &str, made: &FolderCopied) -> Result<i64> {
    record(conn, batch_id, FOLDER_COPY, made, made)?;
    Ok(conn.last_insert_rowid())
}

/// Every row in a batch, newest first: the order an undo applies them in, since a later row can
/// depend on an earlier one. Rows an undo took back are the redo's, not the batch's.
pub fn batch(conn: &Connection, batch_id: &str) -> Result<Vec<Entry>> {
    entries(
        conn,
        "SELECT id, op, forward, inverse FROM journal
          WHERE batch_id = ?1 AND undone IS NULL ORDER BY id DESC",
        batch_id,
    )
}

/// The rows of a batch an undo took back, oldest first: the order a redo applies them in.
pub fn undone_batch(conn: &Connection, batch_id: &str) -> Result<Vec<Entry>> {
    entries(
        conn,
        "SELECT id, op, forward, inverse FROM journal
          WHERE batch_id = ?1 AND undone IS NOT NULL ORDER BY id",
        batch_id,
    )
}

fn entries(conn: &Connection, sql: &str, batch_id: &str) -> Result<Vec<Entry>> {
    let mut stmt = conn.prepare(sql)?;
    let json = |raw: String| serde_json::from_str(&raw).unwrap_or(Value::Null);
    let rows = stmt
        .query_map(params![batch_id], |r| {
            Ok(Entry {
                id: r.get(0)?,
                op: r.get(1)?,
                forward: json(r.get(2)?),
                inverse: json(r.get(3)?),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Removes one row that can never be undone or redone.
pub fn drop_entry(conn: &Connection, entry_id: i64) -> Result<()> {
    conn.execute("DELETE FROM journal WHERE id = ?1", params![entry_id])?;
    Ok(())
}

/// What a row's redo needs that the undo took away with it: the title of a folder made, whose row
/// went, and when a folder a copy made was retired.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Kept {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retired_at: Option<i64>,
}

/// The number the next undo marks its rows with, above every row the redo holds.
pub fn next_undo(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(undone), 0) + 1 FROM journal WHERE undone IS NOT NULL",
        [],
        |r| r.get(0),
    )?)
}

/// Takes a row out of its batch once it has been reversed, and keeps it as the redo: a reversed
/// act is not history to reverse again, and a batch that came back only in part keeps exactly
/// what stayed.
pub fn set_undone(conn: &Connection, entry_id: i64, undo: i64, kept: &Kept) -> Result<()> {
    conn.execute(
        "UPDATE journal SET undone = ?2, forward = json_set(forward, '$.redo', json(?3))
          WHERE id = ?1",
        params![entry_id, undo, serde_json::to_string(kept)?],
    )?;
    Ok(())
}

/// What an undo kept on a row for its redo.
pub fn kept(entry: &Entry) -> Kept {
    entry
        .forward
        .get("redo")
        .and_then(|kept| serde_json::from_value(kept.clone()).ok())
        .unwrap_or_default()
}

/// Journals a row its redo carried out again, as the newest, so an undo takes it back once more;
/// `as_now` is the row as it reads after the redo, when that changed.
pub fn redone(conn: &Connection, entry_id: i64, as_now: Option<&Value>) -> Result<()> {
    let as_now = as_now.map(serde_json::to_string).transpose()?;
    conn.execute(
        "INSERT INTO journal (batch_id, op, forward, inverse, created_at)
         SELECT batch_id, op, json_remove(COALESCE(?2, forward), '$.redo'), COALESCE(?2, inverse), ?3
           FROM journal WHERE id = ?1",
        params![entry_id, as_now, now()],
    )?;
    drop_entry(conn, entry_id)
}

/// The batch the last undo took back, while the redo holds anything of it.
pub fn latest_undone(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT batch_id FROM journal WHERE undone IS NOT NULL
              ORDER BY undone DESC, id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?)
}

/// Drops the redo, as an act that cannot be undone does: what it would put back no longer follows
/// from what is there.
pub fn drop_redo(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM journal WHERE undone IS NOT NULL", [])?;
    Ok(())
}

/// The batch written last, whenever that was, or nothing when there is nothing left to undo. A
/// copy or a move still waiting or running is passed over: its batch is not an act until it has
/// ended.
pub fn latest_batch(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT batch_id FROM journal
              WHERE undone IS NULL
                AND batch_id NOT IN (SELECT json_extract(payload, '$.batchId') FROM job
                                      WHERE kind IN (SELECT value FROM json_each(?1))
                                        AND status IN ('pending', 'running')
                                        AND json_extract(payload, '$.batchId') IS NOT NULL)
                AND id > ?2
              ORDER BY id DESC LIMIT 1",
            params![serde_json::to_string(&ACTS)?, floor(conn)?],
            |r| r.get(0),
        )
        .optional()?)
}

const FLOOR: &str = "undo_floor";

/// The newest row written before the index was last restored; undo goes no further back.
pub fn floor(conn: &Connection) -> Result<i64> {
    Ok(conn
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM setting WHERE key = ?1",
            params![FLOOR],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0))
}

/// Ends the way back at the journal as it stands, and the redo with it, as a restore does: what it
/// holds describes a disk the walk has read again since. DECISIONS.md "Backing up the index".
pub fn set_floor(conn: &Connection) -> Result<()> {
    drop_redo(conn)?;
    conn.execute(
        "INSERT INTO setting (key, value) SELECT ?1, COALESCE(MAX(id), 0) FROM journal WHERE true
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![FLOOR],
    )?;
    Ok(())
}

/// Whether a batch was written before the index was last restored.
pub fn below_floor(conn: &Connection, batch_id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM journal WHERE batch_id = ?1 AND id <= ?2)",
        params![batch_id, floor(conn)?],
        |r| r.get(0),
    )?)
}

/// Whether a copy or a move still waiting or running writes under this batch.
pub fn unended(conn: &Connection, batch_id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM job
                        WHERE kind IN (SELECT value FROM json_each(?1))
                          AND status IN ('pending', 'running')
                          AND json_extract(payload, '$.batchId') = ?2)",
        params![serde_json::to_string(&ACTS)?, batch_id],
        |r| r.get(0),
    )?)
}

/// The file or folder a row is about, once the row can no longer be undone: its name, the folder
/// it was in, and why. A mark written before folders were marked names a file by `itemId`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gone {
    #[serde(alias = "itemId")]
    pub id: i64,
    pub name: String,
    pub folder_id: i64,
    #[serde(default)]
    pub why: Forgot,
    #[serde(default)]
    pub folder: bool,
    /// The removed folders the row names, by id, as they were titled.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub places: BTreeMap<i64, String>,
}

impl Gone {
    pub fn file(id: i64, name: String, folder_id: i64, why: Forgot) -> Self {
        Gone {
            id,
            name,
            folder_id,
            why,
            folder: false,
            places: BTreeMap::new(),
        }
    }
}

/// Why a row can no longer be undone. A mark written before marks said why is the default, since
/// a file emptied from the Recycle Bin was the only one then.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Forgot {
    /// Emptied from the Recycle Bin outside the app.
    #[default]
    EmptiedFromBin,
    /// Gone from disk, its name since taken by a file the app put there or one put back from the
    /// Recycle Bin in Explorer.
    NotOnDisk,
    /// Its source was removed; the file or folder itself is untouched.
    SourceRemoved { source: String },
    /// A folder the row names was in a source since removed; the file or folder it is about stays
    /// where it is.
    PlaceRemoved { source: String },
}

/// The rows about one file alone, which name it by `itemId`.
const ONE_FILE: [&str; 5] = [ITEM_MOVE, ITEM_TRASH, ITEM_RENAME, ITEM_RESTORE, ITEM_COPY];

/// The rows about one folder alone, which name it by `folderId`.
const ONE_FOLDER: [&str; 5] = [
    FOLDER_CREATE,
    FOLDER_RENAME,
    FOLDER_MOVE,
    FOLDER_DELETE,
    FOLDER_COPY,
];

/// Every key a row names a folder by.
const PLACES: [&str; 8] = [
    "folderId",
    "parentId",
    "fromParentId",
    "toParentId",
    "fromFolderId",
    "toFolderId",
    "leftFolderId",
    "into",
];

/// Prunes a forgotten file from the journal: each row about it alone is marked with what it was,
/// for an undo to report and drop, and its id leaves every row about several, so an id the index
/// may give another file is never acted on. SCHEMA.md "The undo journal".
pub fn forget_item(conn: &Connection, gone: &Gone) -> Result<()> {
    let id = gone.id;
    let mark = serde_json::to_string(gone)?;
    conn.execute(
        &format!(
            "UPDATE journal SET forward = json_set(forward, '$.gone', {mark}),
                                inverse = json_set(inverse, '$.gone', {mark})
              WHERE id IN (SELECT entry_id FROM journal_subject WHERE item_id = ?1)
                AND op IN ({})
                AND (json_type(inverse, '$.gone') IS NULL
                     OR json_extract(inverse, '$.gone.why.kind') = 'placeRemoved')",
            quoted(&ONE_FILE),
            mark = "json_patch(json(?2), json_object('places', json(COALESCE(
                      json_extract(inverse, '$.gone.places'), '{}'))))"
        ),
        params![id, mark],
    )?;
    leave_several(conn, &[id], &[])
}

/// Prunes every file and folder of a source being removed at once, as [`forget_item`] prunes one
/// file, and marks every row that names one of its folders. SCHEMA.md "The undo journal".
pub fn forget_source(conn: &Connection, source_id: i64) -> Result<()> {
    let folders: Vec<i64> = conn
        .prepare(
            "WITH RECURSIVE removed(id) AS (
                 SELECT id FROM folder WHERE source_id = ?1
               UNION ALL
                 SELECT f.id FROM folder f JOIN removed r ON f.parent_id = r.id
             )
             SELECT id FROM removed",
        )?
        .query_map(params![source_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let removed = serde_json::to_string(&folders)?;
    let files =
        "SELECT id, disk_name AS name, folder_id AS at, source_id = ?1 AS removed FROM item";
    mark_removed(conn, source_id, &removed, &ONE_FILE, "itemId", files, false)?;
    let folder_rows = "SELECT id, title AS name, COALESCE(parent_id, id) AS at,
                              id IN (SELECT value FROM json_each(?2)) AS removed FROM folder";
    mark_removed(
        conn,
        source_id,
        &removed,
        &ONE_FOLDER,
        "folderId",
        folder_rows,
        true,
    )?;
    let ids: Vec<i64> = conn
        .prepare("SELECT id FROM item WHERE source_id = ?1")?
        .query_map(params![source_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    leave_several(conn, &ids, &folders)
}

/// Marks, in one statement, every row of `ops` whose file or folder, read from `subjects` by
/// `key`, is in the removed source, or which names one of its folders: `sourceRemoved` for the
/// one, overriding an earlier `placeRemoved`, and `placeRemoved` for the other, on rows unmarked.
fn mark_removed(
    conn: &Connection,
    source_id: i64,
    removed: &str,
    ops: &[&str],
    key: &str,
    subjects: &str,
    folder: bool,
) -> Result<()> {
    let names_removed = format!(
        "EXISTS (SELECT 1 FROM json_each(j.inverse) e
                  WHERE e.key IN ({}) AND e.value IN (SELECT value FROM json_each(?2)))",
        quoted(&PLACES)
    );
    conn.execute(
        &format!(
            "UPDATE journal SET forward = json_set(forward, '$.gone', json(marks.mark)),
                                inverse = json_set(inverse, '$.gone', json(marks.mark))
               FROM (SELECT j.id AS row,
                            json_object(
                              'id', t.id, 'name', t.name, 'folderId', t.at,
                              'why', json_object(
                                'kind', CASE WHEN t.removed THEN 'sourceRemoved'
                                             ELSE 'placeRemoved' END,
                                'source', (SELECT title FROM source WHERE id = ?1)),
                              'folder', json('{folder}'),
                              'places', json_patch(
                                COALESCE(json_extract(j.inverse, '$.gone.places'), '{{}}'),
                                (SELECT json_group_object(f.id, f.title)
                                   FROM (SELECT t.at AS id
                                         UNION SELECT e.value FROM json_each(j.inverse) e
                                                WHERE e.key IN ({places})) n
                                   JOIN folder f ON f.id = n.id
                                  WHERE f.id IN (SELECT value FROM json_each(?2))))) AS mark
                       FROM journal j JOIN ({subjects}) t
                         ON t.id = json_extract(j.inverse, '$.{key}')
                      WHERE j.op IN ({ops})
                        AND CASE WHEN t.removed
                                 THEN json_type(j.inverse, '$.gone') IS NULL
                                      OR json_extract(j.inverse, '$.gone.why.kind')
                                         = 'placeRemoved'
                                 ELSE json_type(j.inverse, '$.gone') IS NULL AND {names_removed}
                            END) AS marks
              WHERE journal.id = marks.row",
            places = quoted(&PLACES),
            ops = quoted(ops),
        ),
        params![source_id, removed],
    )?;
    Ok(())
}

/// Drops an emptied file from the journal: rows about it alone, a folder delete they leave alone in
/// its batch, and its id from every row about several, so an undo passes over it.
/// SCHEMA.md "The undo journal".
pub fn drop_item(conn: &Connection, item_id: i64) -> Result<()> {
    drop_items(conn, &[item_id])
}

/// Drops many emptied files from the journal at once, as [`drop_item`] drops one.
pub fn drop_items(conn: &Connection, item_ids: &[i64]) -> Result<()> {
    if item_ids.is_empty() {
        return Ok(());
    }
    let ids = serde_json::to_string(item_ids)?;
    let about = format!(
        "op IN ({}) AND id IN (SELECT entry_id FROM journal_subject
                                 WHERE item_id IN (SELECT value FROM json_each(?1)))",
        quoted(&ONE_FILE)
    );
    let batches: Vec<String> = conn
        .prepare(&format!(
            "SELECT DISTINCT batch_id FROM journal WHERE {about}"
        ))?
        .query_map(params![ids], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    conn.execute(&format!("DELETE FROM journal WHERE {about}"), params![ids])?;
    conn.execute(
        "DELETE FROM journal
          WHERE op = ?2 AND batch_id IN (SELECT value FROM json_each(?1))
            AND NOT EXISTS (SELECT 1 FROM journal other
                             WHERE other.batch_id = journal.batch_id AND other.op <> ?2)",
        params![serde_json::to_string(&batches)?, FOLDER_DELETE],
    )?;
    leave_several(conn, item_ids, &[])
}

/// Takes files' and folders' ids out of every row about several, a tag's row left about none
/// going with it.
fn leave_several(conn: &Connection, ids: &[i64], folders: &[i64]) -> Result<()> {
    let leaving: HashSet<i64> = ids.iter().copied().collect();
    let folders_leaving: HashSet<i64> = folders.iter().copied().collect();
    let mut stmt = conn.prepare(
        "SELECT id, op, inverse FROM journal
          WHERE op IN (?2, ?3, ?4)
            AND id IN (SELECT entry_id FROM journal_subject
                        WHERE item_id IN (SELECT value FROM json_each(?1))
                       UNION
                       SELECT entry_id FROM journal_subject
                        WHERE folder_id IN (SELECT value FROM json_each(?5)))",
    )?;
    let (ids, folders) = (serde_json::to_string(ids)?, serde_json::to_string(folders)?);
    let several: Vec<(i64, String, String)> = stmt
        .query_map(params![ids, ITEMS_TAG, ITEMS_UNTAG, RETAG, folders], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut rewrite =
        conn.prepare_cached("UPDATE journal SET forward = ?2, inverse = ?2 WHERE id = ?1")?;
    let mut remove = conn.prepare_cached("DELETE FROM journal WHERE id = ?1")?;
    let mut rewritten = Vec::new();
    for (row, op, inverse) in several {
        let left = match op.as_str() {
            ITEMS_TAG => {
                let mut tagged: ItemsTagged = serde_json::from_str(&inverse)?;
                tagged.item_ids.retain(|one| !leaving.contains(one));
                (!tagged.item_ids.is_empty()).then(|| serde_json::to_string(&tagged))
            }
            ITEMS_UNTAG => {
                let mut untagged: ItemsUntagged = serde_json::from_str(&inverse)?;
                untagged.items.retain(|one| !leaving.contains(&one.item_id));
                (!untagged.items.is_empty()).then(|| serde_json::to_string(&untagged))
            }
            _ => {
                let mut retagged: Retagged = serde_json::from_str(&inverse)?;
                retagged
                    .item_uses
                    .retain(|one| !leaving.contains(&one.item_id));
                retagged
                    .folder_uses
                    .retain(|one| !folders_leaving.contains(&one.folder_id));
                Some(serde_json::to_string(&retagged))
            }
        };
        match left.transpose()? {
            Some(json) => {
                rewrite.execute(params![row, json])?;
                rewritten.push(row);
            }
            None => {
                remove.execute(params![row])?;
            }
        }
    }
    // No trigger follows a rewrite of `inverse`: the subjects it took out go here.
    conn.execute(
        "DELETE FROM journal_subject
          WHERE entry_id IN (SELECT value FROM json_each(?1))
            AND (item_id IN (SELECT value FROM json_each(?2))
                 OR folder_id IN (SELECT value FROM json_each(?3)))",
        params![serde_json::to_string(&rewritten)?, ids, folders],
    )?;
    Ok(())
}

/// The file a row is about, when the index has forgotten it since.
pub fn gone(entry: &Entry) -> Option<Gone> {
    serde_json::from_value(entry.inverse.get("gone")?.clone()).ok()
}

/// A journal grown to 200,000 rows: each of `trashed` sent to the Trash, a hundred to an act that
/// also deleted a folder, and the rest moves and tags of other files, every fiftieth row tagging
/// ten of `trashed` among them.
#[cfg(test)]
pub(crate) fn grow_to_two_hundred_thousand(conn: &Connection, trashed: &[i64]) {
    let tx = crate::db::begin(conn).unwrap();
    let mut rows = 0;
    for chunk in trashed.chunks(100) {
        let batch = new_batch();
        for &id in chunk {
            record_item_trash(&tx, &batch, id).unwrap();
        }
        record_folder_delete(&tx, &batch, 1, 1).unwrap();
        rows += chunk.len() + 1;
    }
    let mut other = 1_000_000_i64;
    while rows < 200_000 {
        let batch = new_batch();
        if rows % 50 == 0 && !trashed.is_empty() {
            let from = rows % trashed.len();
            let mut item_ids: Vec<i64> = trashed
                .iter()
                .cycle()
                .skip(from)
                .take(10)
                .copied()
                .collect();
            item_ids.extend(other..other + 10);
            let tagged = ItemsTagged {
                tag_id: 1,
                value: "dusk".into(),
                item_ids,
            };
            record_items_tag(&tx, &batch, &tagged).unwrap();
        } else {
            record_item_move(&tx, &batch, other, 1, 2).unwrap();
        }
        other += 1;
        rows += 1;
    }
    tx.commit().unwrap();
}

fn quoted(ops: &[&str]) -> String {
    ops.iter()
        .map(|op| format!("'{op}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    #[test]
    fn the_latest_batch_is_the_one_written_last_and_falls_back_as_batches_go() {
        let conn = conn();
        assert_eq!(latest_batch(&conn).unwrap(), None);

        let first = new_batch();
        record_folder_create(&conn, &first, 7, 1).unwrap();
        let second = new_batch();
        record_folder_rename(&conn, &second, 7, "Cairo", "Giza").unwrap();
        assert_eq!(latest_batch(&conn).unwrap(), Some(second.clone()));

        for entry in batch(&conn, &second).unwrap() {
            drop_entry(&conn, entry.id).unwrap();
        }
        assert_eq!(latest_batch(&conn).unwrap(), Some(first));
    }

    #[test]
    fn undo_goes_no_further_back_than_the_floor_a_restore_sets() {
        let conn = conn();
        let before = new_batch();
        record_folder_create(&conn, &before, 7, 1).unwrap();
        set_floor(&conn).unwrap();
        assert_eq!(latest_batch(&conn).unwrap(), None);
        assert!(below_floor(&conn, &before).unwrap());

        let after = new_batch();
        record_folder_rename(&conn, &after, 7, "Cairo", "Giza").unwrap();
        assert_eq!(latest_batch(&conn).unwrap(), Some(after.clone()));
        assert!(!below_floor(&conn, &after).unwrap());
        for entry in batch(&conn, &after).unwrap() {
            drop_entry(&conn, entry.id).unwrap();
        }
        assert_eq!(latest_batch(&conn).unwrap(), None, "and stops there again");

        set_floor(&conn).unwrap();
        assert_eq!(floor(&conn).unwrap(), 1, "a second restore moves it");
    }

    #[test]
    fn a_forgotten_file_is_marked_on_its_own_rows_and_taken_out_of_every_set() {
        let conn = conn();
        let both = new_batch();
        let tag = |item_ids| ItemsTagged {
            tag_id: 1,
            value: "dusk".into(),
            item_ids,
        };
        record_items_tag(&conn, &both, &tag(vec![5, 6])).unwrap();
        let alone = new_batch();
        record_items_tag(&conn, &alone, &tag(vec![5])).unwrap();
        let untagged = new_batch();
        let untag = |item_id| Untagged {
            item_id,
            added_at: 1,
        };
        let items = vec![untag(5), untag(6)];
        let untag_row = ItemsUntagged {
            tag_id: 1,
            value: "dusk".into(),
            items,
        };
        record_items_untag(&conn, &untagged, &untag_row).unwrap();
        let retagged = new_batch();
        let using = |item_id| ItemUse {
            item_id,
            rowid: item_id,
            added_at: 1,
            from: 1,
            to: None,
        };
        let retag_row = Retagged {
            change: Change::DeleteTag { tag: "dusk".into() },
            files: 2,
            folders: 0,
            reworded: vec![],
            made: vec![],
            removed: vec![],
            folder_uses: vec![],
            item_uses: vec![using(5), using(6)],
        };
        record_retag(&conn, &retagged, &retag_row).unwrap();
        let renamed = new_batch();
        record_item_rename(&conn, &renamed, 5, "a.jpg", "pyramid.jpg").unwrap();
        record_item_rename(&conn, &renamed, 6, "b.jpg", "sphinx.jpg").unwrap();

        let pyramid = Gone::file(5, "pyramid.jpg".into(), 3, Forgot::NotOnDisk);
        forget_item(&conn, &pyramid).unwrap();
        let reused = Gone {
            name: "another.jpg".into(),
            ..pyramid.clone()
        };
        forget_item(&conn, &reused).unwrap();

        let only = |batch_id: &str| {
            let rows = batch(&conn, batch_id).unwrap();
            assert_eq!(rows.len(), 1);
            rows[0].inverse.clone()
        };
        let tagged: ItemsTagged = serde_json::from_value(only(&both)).unwrap();
        assert_eq!(tagged.item_ids, [6]);
        assert!(batch(&conn, &alone).unwrap().is_empty());
        let untagged: ItemsUntagged = serde_json::from_value(only(&untagged)).unwrap();
        assert_eq!(untagged.items, [untag(6)]);
        let retagged: Retagged = serde_json::from_value(only(&retagged)).unwrap();
        assert_eq!(retagged.item_uses, [using(6)]);
        let marks: Vec<Option<Gone>> = batch(&conn, &renamed).unwrap().iter().map(gone).collect();
        assert_eq!(marks, [None, Some(pyramid)]);
        assert_subjects_whole(&conn);
    }

    #[test]
    fn a_removed_source_s_files_are_marked_and_taken_out_of_every_set_at_once() {
        let conn = conn();
        let mut folder_of = vec![];
        for (root, title) in [("D:/library", "Library"), ("E:/phone", "Phone")] {
            let source = db::sources::add(
                &conn,
                std::path::Path::new(root),
                title,
                db::sources::SourceKind::Library,
            )
            .unwrap();
            folder_of.push((
                source.id,
                db::folders::source_root_folder(&conn, source.id).unwrap(),
            ));
        }
        for (id, (source, folder), name) in [
            (5, folder_of[0], "pyramid.jpg"),
            (6, folder_of[1], "beach.jpg"),
            (7, folder_of[0], "sphinx.jpg"),
        ] {
            conn.execute(
                "INSERT INTO item (id, uuid, source_id, folder_id, disk_name, ext, size_bytes,
                                   mtime, kind, added_at)
                 VALUES (?1, ?1, ?2, ?3, ?4, 'jpg', 1, 1, 'image', 1)",
                params![id, source, folder, name],
            )
            .unwrap();
        }
        let all = new_batch();
        let tagged = ItemsTagged {
            tag_id: 1,
            value: "dusk".into(),
            item_ids: vec![5, 6, 7],
        };
        record_items_tag(&conn, &all, &tagged).unwrap();
        let theirs = new_batch();
        let only_theirs = ItemsTagged {
            item_ids: vec![5, 7],
            ..tagged.clone()
        };
        record_items_tag(&conn, &theirs, &only_theirs).unwrap();
        let untagged = new_batch();
        let untag = |item_id| Untagged {
            item_id,
            added_at: 1,
        };
        let untag_row = ItemsUntagged {
            tag_id: 1,
            value: "dusk".into(),
            items: vec![untag(5), untag(6), untag(7)],
        };
        record_items_untag(&conn, &untagged, &untag_row).unwrap();
        let retagged = new_batch();
        let using = |item_id| ItemUse {
            item_id,
            rowid: item_id,
            added_at: 1,
            from: 1,
            to: None,
        };
        let retag_row = Retagged {
            change: Change::DeleteTag { tag: "dusk".into() },
            files: 3,
            folders: 0,
            reworded: vec![],
            made: vec![],
            removed: vec![],
            folder_uses: vec![],
            item_uses: vec![using(5), using(6), using(7)],
        };
        record_retag(&conn, &retagged, &retag_row).unwrap();
        let renamed = new_batch();
        for id in [5, 6, 7] {
            record_item_rename(&conn, &renamed, id, "a.jpg", "b.jpg").unwrap();
        }

        forget_source(&conn, folder_of[0].0).unwrap();

        let only = |batch_id: &str| {
            let rows = batch(&conn, batch_id).unwrap();
            assert_eq!(rows.len(), 1);
            rows[0].inverse.clone()
        };
        let tagged: ItemsTagged = serde_json::from_value(only(&all)).unwrap();
        assert_eq!(tagged.item_ids, [6]);
        assert!(batch(&conn, &theirs).unwrap().is_empty());
        let untagged: ItemsUntagged = serde_json::from_value(only(&untagged)).unwrap();
        assert_eq!(untagged.items, [untag(6)]);
        let retagged: Retagged = serde_json::from_value(only(&retagged)).unwrap();
        assert_eq!(retagged.item_uses, [using(6)]);
        let removed = |item_id, name: &str| {
            Some(Gone {
                places: BTreeMap::from([(folder_of[0].1, "Library".to_string())]),
                ..Gone::file(
                    item_id,
                    name.into(),
                    folder_of[0].1,
                    Forgot::SourceRemoved {
                        source: "Library".into(),
                    },
                )
            })
        };
        let marks: Vec<Option<Gone>> = batch(&conn, &renamed).unwrap().iter().map(gone).collect();
        assert_eq!(
            marks,
            [removed(7, "sphinx.jpg"), None, removed(5, "pyramid.jpg")]
        );
        assert_subjects_whole(&conn);
    }

    #[test]
    fn a_removed_source_s_folders_and_every_row_naming_them_are_marked_at_once() {
        let conn = conn();
        let mut tops = vec![];
        for (root, title) in [("D:/library", "Library"), ("E:/phone", "Phone")] {
            let source = db::sources::add(
                &conn,
                std::path::Path::new(root),
                title,
                db::sources::SourceKind::Library,
            )
            .unwrap();
            tops.push((
                source.id,
                db::folders::source_root_folder(&conn, source.id).unwrap(),
            ));
        }
        let (library, phone) = (tops[0], tops[1]);
        let trips = db::folders::create(&conn, library.1, "Trips").unwrap();
        let beach = db::folders::create(&conn, phone.1, "Beach").unwrap();
        conn.execute(
            "INSERT INTO item (id, uuid, source_id, folder_id, disk_name, ext, size_bytes,
                               mtime, kind, added_at)
             VALUES (6, 6, ?1, ?2, 'sand.jpg', 'jpg', 1, 1, 'image', 1),
                    (7, 7, ?1, ?2, 'shell.jpg', 'jpg', 1, 1, 'image', 1)",
            params![phone.0, beach],
        )
        .unwrap();
        let renamed = new_batch();
        record_folder_rename(&conn, &renamed, trips, "Cairo", "Trips").unwrap();
        let moved = new_batch();
        record_item_move(&conn, &moved, 6, trips, beach).unwrap();
        record_folder_move(&conn, &moved, beach, trips, phone.1).unwrap();
        let shell_moved = new_batch();
        record_item_move(&conn, &shell_moved, 7, trips, beach).unwrap();
        let elsewhere = new_batch();
        record_folder_rename(&conn, &elsewhere, beach, "Sea", "Beach").unwrap();
        let retagged = new_batch();
        let held = |folder_id| FolderUse {
            folder_id,
            rowid: folder_id,
            source: "manual".into(),
            from: 1,
            to: None,
        };
        let retag_row = Retagged {
            change: Change::DeleteTag { tag: "dusk".into() },
            files: 0,
            folders: 2,
            reworded: vec![],
            made: vec![],
            removed: vec![],
            folder_uses: vec![held(trips), held(beach)],
            item_uses: vec![],
        };
        record_retag(&conn, &retagged, &retag_row).unwrap();

        forget_source(&conn, library.0).unwrap();

        let marks = |batch_id: &str| -> Vec<Option<Gone>> {
            batch(&conn, batch_id).unwrap().iter().map(gone).collect()
        };
        let why = |source: &str, gone: bool| {
            let source = source.to_string();
            if gone {
                Forgot::SourceRemoved { source }
            } else {
                Forgot::PlaceRemoved { source }
            }
        };
        let trips_place = (trips, "Trips".to_string());
        assert_eq!(
            marks(&renamed),
            [Some(Gone {
                folder: true,
                places: BTreeMap::from([trips_place.clone(), (library.1, "Library".into())]),
                ..Gone::file(trips, "Trips".into(), library.1, why("Library", true))
            })]
        );
        let sand = Gone {
            places: BTreeMap::from([trips_place.clone()]),
            ..Gone::file(6, "sand.jpg".into(), beach, why("Library", false))
        };
        assert_eq!(
            marks(&moved),
            [
                Some(Gone {
                    folder: true,
                    places: BTreeMap::from([trips_place.clone()]),
                    ..Gone::file(beach, "Beach".into(), phone.1, why("Library", false))
                }),
                Some(sand.clone()),
            ]
        );
        assert_eq!(marks(&elsewhere), [None]);
        let left: Retagged =
            serde_json::from_value(batch(&conn, &retagged).unwrap()[0].inverse.clone()).unwrap();
        assert_eq!(left.folder_uses, [held(beach)]);

        let shell = Gone::file(7, "shell.jpg".into(), beach, Forgot::NotOnDisk);
        forget_item(&conn, &shell).unwrap();
        assert_eq!(
            marks(&shell_moved),
            [Some(Gone {
                places: BTreeMap::from([trips_place.clone()]),
                ..shell
            })],
            "a file forgotten since is reported as forgotten, by the places named before"
        );

        forget_source(&conn, phone.0).unwrap();
        let [_, sand_now] = &marks(&moved)[..] else {
            panic!("the batch keeps both rows");
        };
        assert_eq!(
            sand_now.as_ref(),
            Some(&Gone {
                why: why("Phone", true),
                places: BTreeMap::from([trips_place, (beach, "Beach".into())]),
                ..sand
            }),
            "removing its own source too says so, and keeps the places named before"
        );
        assert_subjects_whole(&conn);
    }

    fn about(conn: &Connection, column: &str, id: i64) -> Vec<String> {
        conn.prepare(&format!(
            "SELECT j.op FROM journal_subject s JOIN journal j ON j.id = s.entry_id
              WHERE s.{column} = ?1 ORDER BY j.id"
        ))
        .unwrap()
        .query_map(params![id], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
    }

    /// Every subject read again from the journal as it stands, beside the ones kept.
    fn assert_subjects_whole(conn: &Connection) {
        let read = |sql: &str| -> Vec<(i64, Option<i64>, Option<i64>)> {
            conn.prepare(sql)
                .unwrap()
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        let kept = read(
            "SELECT entry_id, item_id, folder_id FROM journal_subject
              ORDER BY entry_id, item_id, folder_id",
        );
        let derived = read(&format!(
            "SELECT * FROM (
                 SELECT j.id, json_extract(j.inverse, '$.itemId') AS item, NULL AS folder
                   FROM journal j WHERE j.op IN ({one_file})
               UNION ALL
                 SELECT j.id, NULL, json_extract(j.inverse, '$.folderId')
                   FROM journal j WHERE j.op IN ({one_folder})
               UNION ALL
                 SELECT j.id, e.value, NULL FROM journal j, json_each(j.inverse, '$.itemIds') e
                  WHERE j.op = 'items_tag'
               UNION ALL
                 SELECT j.id, json_extract(e.value, '$.itemId'), NULL
                   FROM journal j, json_each(j.inverse, '$.items') e WHERE j.op = 'items_untag'
               UNION ALL
                 SELECT j.id, json_extract(e.value, '$.itemId'), NULL
                   FROM journal j, json_each(j.inverse, '$.itemUses') e WHERE j.op = 'retag'
               UNION ALL
                 SELECT j.id, NULL, json_extract(e.value, '$.folderId')
                   FROM journal j, json_each(j.inverse, '$.folderUses') e WHERE j.op = 'retag'
             ) ORDER BY 1, 2, 3",
            one_file = quoted(&ONE_FILE),
            one_folder = quoted(&ONE_FOLDER),
        ));
        assert_eq!(kept, derived);
    }

    #[test]
    fn every_file_and_folder_a_row_is_about_is_indexed_and_follows_the_row() {
        let conn = conn();
        let moved = new_batch();
        record_item_move(&conn, &moved, 5, 30, 31).unwrap();
        record_folder_rename(&conn, &new_batch(), 40, "Cairo", "Giza").unwrap();
        let tagged = ItemsTagged {
            tag_id: 1,
            value: "dusk".into(),
            item_ids: vec![5, 6],
        };
        record_items_tag(&conn, &new_batch(), &tagged).unwrap();
        let untag = |item_id| Untagged {
            item_id,
            added_at: 1,
        };
        let untagged = ItemsUntagged {
            tag_id: 1,
            value: "dusk".into(),
            items: vec![untag(6), untag(7)],
        };
        record_items_untag(&conn, &new_batch(), &untagged).unwrap();
        let retagged = Retagged {
            change: Change::DeleteTag { tag: "dusk".into() },
            files: 1,
            folders: 1,
            reworded: vec![],
            made: vec![],
            removed: vec![],
            folder_uses: vec![FolderUse {
                folder_id: 41,
                rowid: 1,
                source: "manual".into(),
                from: 1,
                to: None,
            }],
            item_uses: vec![ItemUse {
                item_id: 8,
                rowid: 1,
                added_at: 1,
                from: 1,
                to: None,
            }],
        };
        record_retag(&conn, &new_batch(), &retagged).unwrap();

        assert_eq!(about(&conn, "item_id", 5), [ITEM_MOVE, ITEMS_TAG]);
        assert_eq!(about(&conn, "item_id", 6), [ITEMS_TAG, ITEMS_UNTAG]);
        assert_eq!(about(&conn, "item_id", 7), [ITEMS_UNTAG]);
        assert_eq!(about(&conn, "item_id", 8), [RETAG]);
        assert_eq!(about(&conn, "folder_id", 40), [FOLDER_RENAME]);
        assert_eq!(about(&conn, "folder_id", 41), [RETAG]);
        assert!(about(&conn, "folder_id", 30).is_empty());

        forget_item(&conn, &Gone::file(6, "b.jpg".into(), 3, Forgot::NotOnDisk)).unwrap();
        assert!(about(&conn, "item_id", 6).is_empty());
        assert_eq!(about(&conn, "item_id", 7), [ITEMS_UNTAG]);

        for entry in batch(&conn, &moved).unwrap() {
            drop_entry(&conn, entry.id).unwrap();
        }
        assert_eq!(about(&conn, "item_id", 5), [ITEMS_TAG]);
        assert_subjects_whole(&conn);
        let orphaned: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM journal_subject
                  WHERE entry_id NOT IN (SELECT id FROM journal)",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(orphaned, 0);
    }

    #[test]
    fn a_row_of_every_op_about_one_file_or_one_folder_is_indexed_by_it() {
        let conn = conn();
        for op in ONE_FILE {
            let about = serde_json::json!({ "itemId": 5 });
            record(&conn, &new_batch(), op, &about, &about).unwrap();
        }
        for op in ONE_FOLDER {
            let about = serde_json::json!({ "folderId": 9 });
            record(&conn, &new_batch(), op, &about, &about).unwrap();
        }

        assert_eq!(about(&conn, "item_id", 5), ONE_FILE);
        assert_eq!(about(&conn, "folder_id", 9), ONE_FOLDER);
    }

    #[test]
    fn many_files_dropped_at_once_leave_the_journal_as_one_at_a_time_would() {
        let conn = conn();
        let both_gone = new_batch();
        record_item_trash(&conn, &both_gone, 1).unwrap();
        record_item_trash(&conn, &both_gone, 2).unwrap();
        record_folder_delete(&conn, &both_gone, 50, 9).unwrap();
        let one_stays = new_batch();
        record_item_trash(&conn, &one_stays, 3).unwrap();
        record_item_trash(&conn, &one_stays, 4).unwrap();
        record_folder_delete(&conn, &one_stays, 51, 9).unwrap();
        let no_file = new_batch();
        record_folder_delete(&conn, &no_file, 52, 9).unwrap();
        let tag = |item_ids| ItemsTagged {
            tag_id: 1,
            value: "dusk".into(),
            item_ids,
        };
        let some_tagged = new_batch();
        record_items_tag(&conn, &some_tagged, &tag(vec![1, 3, 4])).unwrap();
        let all_tagged = new_batch();
        record_items_tag(&conn, &all_tagged, &tag(vec![1, 2])).unwrap();
        let renamed = new_batch();
        record_item_rename(&conn, &renamed, 1, "a.jpg", "b.jpg").unwrap();

        drop_items(&conn, &[1, 2, 3]).unwrap();

        let ops = |batch_id: &str| -> Vec<String> {
            batch(&conn, batch_id)
                .unwrap()
                .into_iter()
                .map(|entry| entry.op)
                .collect()
        };
        assert!(ops(&both_gone).is_empty());
        assert_eq!(ops(&one_stays), [FOLDER_DELETE, ITEM_TRASH]);
        assert_eq!(ops(&no_file), [FOLDER_DELETE]);
        let left: ItemsTagged =
            serde_json::from_value(batch(&conn, &some_tagged).unwrap()[0].inverse.clone()).unwrap();
        assert_eq!(left.item_ids, [4]);
        assert!(ops(&all_tagged).is_empty());
        assert!(ops(&renamed).is_empty());
        for id in [1, 2, 3] {
            assert!(about(&conn, "item_id", id).is_empty(), "{id}");
        }
        assert_subjects_whole(&conn);
    }

    #[test]
    fn a_mark_written_before_marks_said_why_reads_as_emptied_from_the_bin() {
        let old: Gone =
            serde_json::from_str(r#"{"itemId":5,"name":"a.jpg","folderId":3}"#).unwrap();
        assert_eq!(old.why, Forgot::EmptiedFromBin);
        assert_eq!((old.id, old.folder), (5, false));
    }

    #[test]
    fn a_batch_reads_back_newest_first_with_each_inverse_ready_to_apply() {
        let conn = conn();
        let batch_id = new_batch();
        record_folder_create(&conn, &batch_id, 7, 1).unwrap();
        record_folder_rename(&conn, &batch_id, 7, "Untitled", "Cairo").unwrap();

        let rows = batch(&conn, &batch_id).unwrap();
        assert_eq!(
            rows.iter().map(|row| row.op.as_str()).collect::<Vec<_>>(),
            [FOLDER_RENAME, FOLDER_CREATE]
        );
        let back: FolderRenamed = serde_json::from_value(rows[0].inverse.clone()).unwrap();
        assert_eq!(
            (back.from.as_str(), back.to.as_str()),
            ("Cairo", "Untitled")
        );
    }

    mod timing {
        use super::*;

        #[test]
        #[ignore = "timing: runs alone, one test at a time"]
        fn ten_thousand_files_leave_a_journal_of_two_hundred_thousand_rows_well_inside_a_second() {
            let conn = conn();
            let trashed: Vec<i64> = (1..=10_000).collect();
            grow_to_two_hundred_thousand(&conn, &trashed);

            let started = std::time::Instant::now();
            drop_items(&conn, &trashed).unwrap();
            let took = started.elapsed();

            let left: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM journal_subject WHERE item_id <= 10000",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(left, 0);
            assert!(took < std::time::Duration::from_secs(1), "took {took:?}");
        }

        #[test]
        #[ignore = "timing: runs alone, one test at a time"]
        fn removing_a_source_of_four_hundred_folders_marks_four_thousand_rows_well_inside_a_second()
        {
            let conn = conn();
            let mut tops = vec![];
            for (root, title) in [("D:/library", "Library"), ("E:/phone", "Phone")] {
                let source = db::sources::add(
                    &conn,
                    std::path::Path::new(root),
                    title,
                    db::sources::SourceKind::Library,
                )
                .unwrap();
                tops.push((
                    source.id,
                    db::folders::source_root_folder(&conn, source.id).unwrap(),
                ));
            }
            let (library, phone) = (tops[0], tops[1]);
            let tx = db::begin(&conn).unwrap();
            let removed: Vec<i64> = (0..400)
                .map(|n| db::folders::create(&tx, library.1, &format!("Day {n}")).unwrap())
                .collect();
            let batch_id = new_batch();
            for n in 0..4_000_i64 {
                let (source, folder) = if n % 2 == 0 {
                    phone
                } else {
                    (library.0, removed[n as usize % removed.len()])
                };
                tx.execute(
                    "INSERT INTO item (id, uuid, source_id, folder_id, disk_name, ext, size_bytes,
                                       mtime, kind, added_at)
                     VALUES (?1, ?1, ?2, ?3, ?1 || '.jpg', 'jpg', 1, 1, 'image', 1)",
                    params![n + 1, source, folder],
                )
                .unwrap();
                let left = removed[(n as usize * 7) % removed.len()];
                record_item_move(&tx, &batch_id, n + 1, left, folder).unwrap();
            }
            tx.commit().unwrap();

            let started = std::time::Instant::now();
            forget_source(&conn, library.0).unwrap();
            let took = started.elapsed();

            let marked = batch(&conn, &batch_id)
                .unwrap()
                .iter()
                .filter(|entry| gone(entry).is_some_and(|mark| !mark.places.is_empty()))
                .count();
            assert_eq!(marked, 4_000);
            assert!(took < std::time::Duration::from_secs(1), "took {took:?}");
        }
    }
}
