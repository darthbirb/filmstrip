//! Items. Every item is a real file in a real folder, so a row is only ever
//! a description of something on disk.

use rusqlite::{Connection, OptionalExtension, params};

use crate::db::{folders, now};
use crate::error::Result;

#[derive(Debug, Clone)]
pub struct NewItem {
    pub uuid: String,
    /// Must match the folder's ancestry. [`set_folder`] derives it; other
    /// writers pass what they already resolved.
    pub source_id: i64,
    pub folder_id: i64,
    pub disk_name: String,
    pub ext: String,
    pub orig_name: String,
    /// Hashing is its own pass. `None` means "not hashed yet", not "empty".
    pub hash: Option<String>,
    pub size_bytes: i64,
    pub mtime: i64,
    pub kind: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub codec: Option<String>,
    pub bitrate: Option<i64>,
    pub captured_at: Option<i64>,
    pub captured_src: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ExistingItem {
    pub id: i64,
    pub uuid: String,
    pub size_bytes: i64,
    pub mtime: i64,
    pub deleted: bool,
}

/// The item already recorded at this name in this folder, whatever its case —
/// the same comparison `idx_item_disk` uses.
pub fn existing_by_disk_name(
    conn: &Connection,
    folder_id: i64,
    disk_name: &str,
) -> Result<Option<ExistingItem>> {
    Ok(conn
        .query_row(
            "SELECT id, uuid, size_bytes, mtime, deleted_at
               FROM item
              WHERE folder_id = ?1 AND disk_name = ?2 COLLATE NOCASE",
            params![folder_id, disk_name],
            |r| {
                let deleted: Option<i64> = r.get(4)?;
                Ok(ExistingItem {
                    id: r.get(0)?,
                    uuid: r.get(1)?,
                    size_bytes: r.get(2)?,
                    mtime: r.get(3)?,
                    deleted: deleted.is_some(),
                })
            },
        )
        .optional()?)
}

/// Records what is on disk. A known name keeps its id and uuid — so its tags
/// and thumbnail — and a trashed one comes back.
pub fn upsert(conn: &Connection, item: &NewItem) -> Result<i64> {
    if let Some(found) = existing_by_disk_name(conn, item.folder_id, &item.disk_name)? {
        conn.execute(
            "UPDATE item
                SET ext = ?1, hash = ?2, size_bytes = ?3, mtime = ?4, kind = ?5,
                    width = ?6, height = ?7, duration_ms = ?8, codec = ?9, bitrate = ?10,
                    captured_at = ?11, captured_src = ?12, deleted_at = NULL
              WHERE id = ?13",
            params![
                item.ext,
                item.hash,
                item.size_bytes,
                item.mtime,
                item.kind,
                item.width,
                item.height,
                item.duration_ms,
                item.codec,
                item.bitrate,
                item.captured_at,
                item.captured_src,
                found.id,
            ],
        )?;
        return Ok(found.id);
    }

    conn.execute(
        "INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, orig_name, hash,
                           size_bytes, mtime, kind, width, height, duration_ms, codec,
                           bitrate, captured_at, captured_src, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            item.uuid,
            item.source_id,
            item.folder_id,
            item.disk_name,
            item.ext,
            item.orig_name,
            item.hash,
            item.size_bytes,
            item.mtime,
            item.kind,
            item.width,
            item.height,
            item.duration_ms,
            item.codec,
            item.bitrate,
            item.captured_at,
            item.captured_src,
            now(),
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn folder_of(conn: &Connection, id: i64) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT folder_id FROM item WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Records a move; the caller moves the file. `source_id` is derived, never
/// passed, because a cross-source move is where a stale copy would hide.
pub fn set_folder(conn: &Connection, id: i64, folder_id: i64, disk_name: &str) -> Result<()> {
    let source_id = folders::location(conn, folder_id)?.source_id;
    conn.execute(
        "UPDATE item SET source_id = ?1, folder_id = ?2, disk_name = ?3 WHERE id = ?4",
        params![source_id, folder_id, disk_name, id],
    )?;
    Ok(())
}

pub fn trash(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE item SET deleted_at = ?1 WHERE id = ?2",
        params![now(), id],
    )?;
    Ok(())
}

pub fn restore(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE item SET deleted_at = NULL WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Starts a sweep: a walk marks what it finds, and [`finish_sweep`] trashes
/// whatever it never saw.
pub fn begin_sweep(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.seen;
         CREATE TEMP TABLE seen (uuid TEXT NOT NULL);",
    )?;
    Ok(())
}

pub fn mark_seen(conn: &Connection, uuid: &str) -> Result<()> {
    conn.execute("INSERT INTO temp.seen (uuid) VALUES (?1)", params![uuid])?;
    Ok(())
}

/// Trashes what the sweep did not see, **in this source only**, and returns how
/// many. DECISIONS.md "A walk only judges what it read".
pub fn finish_sweep(conn: &Connection, source_id: i64) -> Result<usize> {
    conn.execute_batch("CREATE INDEX IF NOT EXISTS temp.idx_seen ON seen(uuid);")?;
    let gone = conn.execute(
        "UPDATE item SET deleted_at = ?1
          WHERE deleted_at IS NULL
            AND source_id = ?2
            AND NOT EXISTS (SELECT 1 FROM temp.seen s WHERE s.uuid = item.uuid)",
        params![now(), source_id],
    )?;
    conn.execute_batch("DROP TABLE IF EXISTS temp.seen;")?;
    Ok(gone)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::sources::{self, SourceKind};
    use std::path::Path;

    fn sample(source_id: i64, folder_id: i64, disk_name: &str) -> NewItem {
        NewItem {
            uuid: format!("uuid-{folder_id}-{disk_name}"),
            source_id,
            folder_id,
            disk_name: disk_name.to_string(),
            ext: "jpg".into(),
            orig_name: disk_name.to_string(),
            hash: None,
            size_bytes: 100,
            mtime: 1,
            kind: "image".into(),
            width: None,
            height: None,
            duration_ms: None,
            codec: None,
            bitrate: None,
            captured_at: None,
            captured_src: None,
        }
    }

    fn library() -> (Connection, i64) {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let source = sources::add(
            &conn,
            Path::new("D:/library"),
            "Library",
            SourceKind::Library,
        )
        .unwrap();
        let root = folders::source_root_folder(&conn, source.id).unwrap();
        (conn, root)
    }

    #[test]
    fn seeing_a_file_again_keeps_its_identity_and_refreshes_its_measurements() {
        let (conn, root) = library();
        let first = upsert(&conn, &sample(1, root, "a.jpg")).unwrap();

        let mut changed = sample(1, root, "a.jpg");
        changed.uuid = "a-different-uuid".into();
        changed.size_bytes = 999;
        let second = upsert(&conn, &changed).unwrap();

        assert_eq!(first, second, "the same file, not a second row");
        let (uuid, size): (String, i64) = conn
            .query_row(
                "SELECT uuid, size_bytes FROM item WHERE id = ?1",
                [first],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            uuid, "uuid-1-a.jpg",
            "identity survives, so tags and thumbnails do"
        );
        assert_eq!(size, 999, "measurements are refreshed");
    }

    #[test]
    fn two_folders_may_each_hold_the_same_file_name() {
        let (conn, root) = library();
        let a = folders::create(&conn, root, "2024").unwrap();
        let b = folders::create(&conn, root, "2025").unwrap();

        let one = upsert(&conn, &sample(1, a, "IMG_0031.jpg")).unwrap();
        let two = upsert(&conn, &sample(1, b, "IMG_0031.jpg")).unwrap();
        assert_ne!(one, two);
    }

    #[test]
    fn a_trashed_file_that_comes_back_is_the_same_item() {
        let (conn, root) = library();
        let id = upsert(&conn, &sample(1, root, "a.jpg")).unwrap();
        trash(&conn, id).unwrap();

        assert_eq!(upsert(&conn, &sample(1, root, "a.jpg")).unwrap(), id);
        let deleted: Option<i64> = conn
            .query_row("SELECT deleted_at FROM item WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(deleted.is_none(), "it is not in the trash any more");
    }

    #[test]
    fn a_move_recomputes_which_source_the_item_belongs_to() {
        let (conn, library_root) = library();
        let archive = sources::add(
            &conn,
            Path::new("E:/archive"),
            "Archive",
            SourceKind::Library,
        )
        .unwrap();
        let archive_root = folders::source_root_folder(&conn, archive.id).unwrap();

        let id = upsert(&conn, &sample(1, library_root, "a.jpg")).unwrap();
        set_folder(&conn, id, archive_root, "a.jpg").unwrap();

        let source_id: i64 = conn
            .query_row("SELECT source_id FROM item WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(
            source_id, archive.id,
            "derived from the new folder, not carried over"
        );
    }

    /// A walk reads one root, so it can only speak for that root. Sweeping the
    /// library must not touch what is sitting in a sorting source.
    #[test]
    fn a_sweep_only_retires_the_source_it_walked() {
        let (conn, library_root) = library();
        let incoming = sources::add(
            &conn,
            Path::new("D:/incoming"),
            "Incoming",
            SourceKind::Sorting,
        )
        .unwrap();
        let incoming_root = folders::source_root_folder(&conn, incoming.id).unwrap();

        let in_library = upsert(&conn, &sample(1, library_root, "kept.jpg")).unwrap();
        let gone_from_library = upsert(&conn, &sample(1, library_root, "gone.jpg")).unwrap();
        let in_incoming =
            upsert(&conn, &sample(incoming.id, incoming_root, "waiting.jpg")).unwrap();

        begin_sweep(&conn).unwrap();
        mark_seen(&conn, "uuid-1-kept.jpg").unwrap();
        let retired = finish_sweep(&conn, 1).unwrap();

        assert_eq!(retired, 1);
        let deleted = |id: i64| -> bool {
            conn.query_row(
                "SELECT deleted_at IS NOT NULL FROM item WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(!deleted(in_library), "seen, so kept");
        assert!(
            deleted(gone_from_library),
            "unseen in the walked source, so retired"
        );
        assert!(!deleted(in_incoming), "another source was never walked");
    }
}
