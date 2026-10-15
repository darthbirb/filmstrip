//! The undo journal: what the app changed on disk, and what reverses it.
//! DECISIONS.md "Undo".

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::db::now;
use crate::error::Result;
use crate::jobs::kinds::COPY_IN;

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
/// depend on an earlier one.
pub fn batch(conn: &Connection, batch_id: &str) -> Result<Vec<Entry>> {
    let mut stmt = conn.prepare(
        "SELECT id, op, forward, inverse FROM journal WHERE batch_id = ?1 ORDER BY id DESC",
    )?;
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

/// Removes one row once it has been reversed: a reversed act is not history to reverse again, and
/// a batch that came back only in part keeps exactly what stayed.
pub fn drop_entry(conn: &Connection, entry_id: i64) -> Result<()> {
    conn.execute("DELETE FROM journal WHERE id = ?1", params![entry_id])?;
    Ok(())
}

/// The batch written last, whenever that was, or nothing when there is nothing left to undo. A
/// copy still waiting or running is passed over: its batch is not an act until the copy has ended.
pub fn latest_batch(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT batch_id FROM journal
              WHERE batch_id NOT IN (SELECT json_extract(payload, '$.batchId') FROM job
                                      WHERE kind = ?1 AND status IN ('pending', 'running')
                                        AND json_extract(payload, '$.batchId') IS NOT NULL)
                AND id > ?2
              ORDER BY id DESC LIMIT 1",
            params![COPY_IN, floor(conn)?],
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

/// Ends the way back at the journal as it stands, as a restore does: what it holds describes a
/// disk the walk has read again since. DECISIONS.md "Backing up the index".
pub fn set_floor(conn: &Connection) -> Result<()> {
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

/// Whether a copy still waiting or running writes under this batch.
pub fn copying(conn: &Connection, batch_id: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM job
                        WHERE kind = ?1 AND status IN ('pending', 'running')
                          AND json_extract(payload, '$.batchId') = ?2)",
        params![COPY_IN, batch_id],
        |r| r.get(0),
    )?)
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
}
