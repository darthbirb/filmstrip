//! The undo journal: what the app changed on disk, and what reverses it.
//! DECISIONS.md "Undo".

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::now;
use crate::error::Result;

pub const FOLDER_CREATE: &str = "folder_create";
pub const FOLDER_RENAME: &str = "folder_rename";
pub const FOLDER_MOVE: &str = "folder_move";
pub const ITEM_MOVE: &str = "item_move";
pub const ITEM_TRASH: &str = "item_trash";
pub const FOLDER_DELETE: &str = "folder_delete";

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

/// An item sent to the trash. Its inverse is itself: undoing it brings the item back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTrashed {
    pub item_id: i64,
}

/// A folder deleted, and every folder under it retired with the same stamp, which is how undo
/// finds them again. Its inverse is itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDeleted {
    pub folder_id: i64,
    pub retired_at: i64,
}

/// One row, as undo reads it back. The inverse stays JSON until its op says what it is.
#[derive(Debug, Clone)]
pub struct Entry {
    pub id: i64,
    pub op: String,
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

pub fn record_item_trash(conn: &Connection, batch_id: &str, item_id: i64) -> Result<()> {
    let trashed = ItemTrashed { item_id };
    record(conn, batch_id, ITEM_TRASH, &trashed, &trashed)
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

/// Every row in a batch, newest first: the order an undo applies them in, since a later row can
/// depend on an earlier one.
pub fn batch(conn: &Connection, batch_id: &str) -> Result<Vec<Entry>> {
    let mut stmt =
        conn.prepare("SELECT id, op, inverse FROM journal WHERE batch_id = ?1 ORDER BY id DESC")?;
    let rows = stmt
        .query_map(params![batch_id], |r| {
            let raw: String = r.get(2)?;
            Ok(Entry {
                id: r.get(0)?,
                op: r.get(1)?,
                inverse: serde_json::from_str(&raw).unwrap_or(Value::Null),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Removes a batch once all of it has been reversed; a reversed act is not history to reverse again.
pub fn drop_batch(conn: &Connection, batch_id: &str) -> Result<()> {
    conn.execute("DELETE FROM journal WHERE batch_id = ?1", params![batch_id])?;
    Ok(())
}

/// The batch written last, whenever that was, or nothing when there is nothing left to undo.
pub fn latest_batch(conn: &Connection) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT batch_id FROM journal ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()?)
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

        drop_batch(&conn, &second).unwrap();
        assert_eq!(latest_batch(&conn).unwrap(), Some(first));
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
