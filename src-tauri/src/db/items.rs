//! Items. Every item is a real file in a real folder, so a row is only ever
//! a description of something on disk.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::folders::{self, Crumb};
use crate::db::now;
use crate::db::sources::SourceKind;
use crate::error::Result;
use crate::media::probe::Probe;

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
              WHERE folder_id = ?1 AND disk_name = ?2 COLLATE NOCASE AND trashed_at IS NULL",
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
/// and thumbnail — and a retired one comes back. A trashed one has given its name up.
pub fn upsert(conn: &Connection, item: &NewItem) -> Result<i64> {
    if let Some(found) = existing_by_disk_name(conn, item.folder_id, &item.disk_name)? {
        conn.execute(
            "UPDATE item
                SET ext = ?1, hash = ?2, size_bytes = ?3, mtime = ?4, kind = ?5,
                    width = ?6, height = ?7, duration_ms = ?8, codec = ?9, bitrate = ?10,
                    captured_at = ?11, captured_src = ?12, probed_at = NULL, deleted_at = NULL
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

/// An item as the grid lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ItemRow {
    pub id: i64,
    pub uuid: String,
    pub folder_id: i64,
    pub disk_name: String,
    pub ext: String,
    #[ts(type = "\"image\" | \"video\" | \"other\"")]
    pub kind: String,
    pub size_bytes: i64,
    pub mtime: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub favorite: bool,
    /// The thumbnail's path, once one has been made.
    pub thumb: Option<String>,
}

/// The columns [`row`] reads, in its order, from `item` named `i`.
const ROW: &str = "i.id, i.uuid, i.folder_id, i.disk_name, i.ext, i.kind, i.size_bytes, i.mtime,
                   i.width, i.height, i.duration_ms, i.favorite";

fn row(r: &rusqlite::Row) -> rusqlite::Result<ItemRow> {
    Ok(ItemRow {
        id: r.get(0)?,
        uuid: r.get(1)?,
        folder_id: r.get(2)?,
        disk_name: r.get(3)?,
        ext: r.get(4)?,
        kind: r.get(5)?,
        size_bytes: r.get(6)?,
        mtime: r.get(7)?,
        width: r.get(8)?,
        height: r.get(9)?,
        duration_ms: r.get(10)?,
        favorite: r.get(11)?,
        thumb: None,
    })
}

/// The live items directly in a folder, by name whatever the case.
pub fn in_folder(conn: &Connection, folder_id: i64) -> Result<Vec<ItemRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ROW} FROM item i
          WHERE i.folder_id = ?1 AND i.deleted_at IS NULL
          ORDER BY i.disk_name COLLATE NOCASE"
    ))?;
    let rows = stmt
        .query_map(params![folder_id], row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Whether the item is in the index and not retired.
pub fn is_live(conn: &Connection, id: i64) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM item WHERE id = ?1 AND deleted_at IS NULL)",
        params![id],
        |r| r.get(0),
    )?)
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

/// Records a rename; the caller renames the file. The extension follows the name.
pub fn set_name(conn: &Connection, id: i64, disk_name: &str) -> Result<()> {
    conn.execute(
        "UPDATE item SET disk_name = ?1, ext = ?2 WHERE id = ?3",
        params![disk_name, crate::fs::paths::extension_of(disk_name), id],
    )?;
    Ok(())
}

/// Removes a retired row outright: one whose file a walk found gone, holding a name another file
/// is now arriving at.
pub fn forget_retired(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM item WHERE id = ?1 AND deleted_at IS NOT NULL AND trashed_at IS NULL",
        params![id],
    )?;
    Ok(())
}

/// Retires an item whose file is gone. It keeps its name, so the file coming back is the same item.
pub fn retire(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE item SET deleted_at = ?1 WHERE id = ?2",
        params![now(), id],
    )?;
    Ok(())
}

/// Records an item as in the trash: out of its folder, its name there free for another file.
pub fn send_to_trash(conn: &Connection, id: i64) -> Result<()> {
    let at = now();
    conn.execute(
        "UPDATE item SET deleted_at = ?1, trashed_at = ?1 WHERE id = ?2",
        params![at, id],
    )?;
    Ok(())
}

/// Records an item as back from the trash, in the folder it left.
pub fn take_from_trash(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE item SET deleted_at = NULL, trashed_at = NULL WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn is_trashed(conn: &Connection, id: i64) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM item WHERE id = ?1 AND trashed_at IS NOT NULL)",
        params![id],
        |r| r.get(0),
    )?)
}

/// Every live item at or below a folder, deepest folders last.
pub fn live_under(conn: &Connection, folder_id: i64) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE subtree(id) AS (
             SELECT ?1
           UNION ALL
             SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
              WHERE f.deleted_at IS NULL
         )
         SELECT i.id FROM item i JOIN subtree s ON i.folder_id = s.id
          WHERE i.deleted_at IS NULL
          ORDER BY i.id",
    )?;
    let ids = stmt
        .query_map(params![folder_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

/// Favourite is binary and acts on a whole selection, so one call covers any number of items.
pub fn set_favorite(conn: &Connection, ids: &[i64], favorite: bool) -> Result<()> {
    let mut set = conn.prepare("UPDATE item SET favorite = ?1 WHERE id = ?2")?;
    for id in ids {
        set.execute(params![favorite, id])?;
    }
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
/// As `finish_sweep`, for a walk that read only one folder's subtree.
pub fn finish_sweep_under(conn: &Connection, folder_id: i64) -> Result<usize> {
    conn.execute_batch("CREATE INDEX IF NOT EXISTS temp.idx_seen ON seen(uuid);")?;
    let gone = conn.execute(
        "WITH RECURSIVE subtree(id) AS (
             SELECT ?2
           UNION ALL
             SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
         )
         UPDATE item SET deleted_at = ?1
          WHERE deleted_at IS NULL
            AND folder_id IN (SELECT id FROM subtree)
            AND NOT EXISTS (SELECT 1 FROM temp.seen s WHERE s.uuid = item.uuid)",
        params![now(), folder_id],
    )?;
    conn.execute_batch("DROP TABLE IF EXISTS temp.seen;")?;
    Ok(gone)
}

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

/// The live items in every sorting source, which the Sorting Box shows as one place.
pub fn in_sorting(conn: &Connection) -> Result<Vec<ItemRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ROW} FROM item i
           JOIN source s ON s.id = i.source_id
          WHERE s.kind = 'sorting' AND i.deleted_at IS NULL
          ORDER BY i.disk_name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map([], row)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// One item in full, as the pane shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ItemDetail {
    #[serde(flatten)]
    pub row: ItemRow,
    pub codec: Option<String>,
    pub bitrate: Option<i64>,
    /// Seconds since 1970; from EXIF, the camera's clock read as UTC. DECISIONS.md "Capture dates".
    pub captured_at: Option<i64>,
    #[ts(type = "\"exif\" | \"container\" | null")]
    pub captured_src: Option<String>,
    pub added_at: i64,
    pub source_id: i64,
    pub source_kind: SourceKind,
    /// From the source's own folder down to the item's.
    pub folders: Vec<Crumb>,
    /// The file, for the window to load. Empty until the command layer fills it in.
    pub path: String,
}

/// The live item with this id, in full, or `None` once it is gone.
pub fn detail(conn: &Connection, id: i64) -> Result<Option<ItemDetail>> {
    let found = conn
        .query_row(
            &format!(
                "SELECT {ROW}, i.codec, i.bitrate, i.captured_at, i.captured_src, i.added_at,
                        s.id, s.kind
                   FROM item i JOIN source s ON s.id = i.source_id
                  WHERE i.id = ?1 AND i.deleted_at IS NULL"
            ),
            params![id],
            |r| {
                Ok(ItemDetail {
                    row: row(r)?,
                    codec: r.get(12)?,
                    bitrate: r.get(13)?,
                    captured_at: r.get(14)?,
                    captured_src: r.get(15)?,
                    added_at: r.get(16)?,
                    source_id: r.get(17)?,
                    source_kind: SourceKind::parse(&r.get::<_, String>(18)?),
                    folders: Vec::new(),
                    path: String::new(),
                })
            },
        )
        .optional()?;
    let Some(mut detail) = found else {
        return Ok(None);
    };
    detail.folders = folders::ancestry(conn, detail.row.folder_id)?;
    Ok(Some(detail))
}

/// Where an item's file is, what kind it is, and the uuid its thumbnail is named by.
#[derive(Debug, Clone)]
pub struct ItemFile {
    pub folder_id: i64,
    pub disk_name: String,
    pub uuid: String,
    pub kind: String,
}

pub fn file_of(conn: &Connection, id: i64) -> Result<Option<ItemFile>> {
    Ok(conn
        .query_row(
            "SELECT folder_id, disk_name, uuid, kind FROM item WHERE id = ?1",
            params![id],
            |r| {
                Ok(ItemFile {
                    folder_id: r.get(0)?,
                    disk_name: r.get(1)?,
                    uuid: r.get(2)?,
                    kind: r.get(3)?,
                })
            },
        )
        .optional()?)
}

/// Records what reading the file taught, and that it has been read.
pub fn record_media(conn: &Connection, id: i64, media: &Probe) -> Result<()> {
    conn.execute(
        "UPDATE item SET width = ?1, height = ?2, duration_ms = ?3, codec = ?4, bitrate = ?5,
                         captured_at = ?6, captured_src = ?7, probed_at = ?8
          WHERE id = ?9",
        params![
            media.width,
            media.height,
            media.duration_ms,
            media.codec,
            media.bitrate,
            media.captured_at,
            media.captured_src,
            now(),
            id,
        ],
    )?;
    Ok(())
}

/// A live picture or video, and whether its file has been read since it last changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveMedia {
    pub id: i64,
    pub uuid: String,
    pub read: bool,
}

/// Every live picture, and every live video too when `videos` is set.
pub fn live_media(conn: &Connection, videos: bool) -> Result<Vec<LiveMedia>> {
    let mut stmt = conn.prepare(
        "SELECT id, uuid, probed_at IS NOT NULL FROM item
          WHERE deleted_at IS NULL AND (kind = 'image' OR (?1 AND kind = 'video'))
          ORDER BY id",
    )?;
    let rows = stmt
        .query_map(params![videos], |r| {
            Ok(LiveMedia {
                id: r.get(0)?,
                uuid: r.get(1)?,
                read: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
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
    fn a_retired_file_that_comes_back_is_the_same_item() {
        let (conn, root) = library();
        let id = upsert(&conn, &sample(1, root, "a.jpg")).unwrap();
        retire(&conn, id).unwrap();

        assert_eq!(upsert(&conn, &sample(1, root, "a.jpg")).unwrap(), id);
        let deleted: Option<i64> = conn
            .query_row("SELECT deleted_at FROM item WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(deleted.is_none(), "it is not retired any more");
    }

    #[test]
    fn a_folder_lists_its_live_items_by_name_whatever_the_case() {
        let (conn, root) = library();
        upsert(&conn, &sample(1, root, "b.jpg")).unwrap();
        upsert(&conn, &sample(1, root, "A.jpg")).unwrap();
        let gone = upsert(&conn, &sample(1, root, "c.jpg")).unwrap();
        retire(&conn, gone).unwrap();

        let names: Vec<_> = in_folder(&conn, root)
            .unwrap()
            .into_iter()
            .map(|item| item.disk_name)
            .collect();
        assert_eq!(names, ["A.jpg", "b.jpg"]);
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

    #[test]
    fn the_sorting_box_lists_every_sorting_source_and_no_library() {
        let (conn, library_root) = library();
        upsert(&conn, &sample(1, library_root, "kept.jpg")).unwrap();
        for (root, name) in [("D:/incoming", "b.jpg"), ("D:/camera", "a.jpg")] {
            let source = sources::add(&conn, Path::new(root), root, SourceKind::Sorting).unwrap();
            let folder = folders::source_root_folder(&conn, source.id).unwrap();
            upsert(&conn, &sample(source.id, folder, name)).unwrap();
        }

        let names: Vec<_> = in_sorting(&conn)
            .unwrap()
            .into_iter()
            .map(|item| item.disk_name)
            .collect();
        assert_eq!(names, ["a.jpg", "b.jpg"]);
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

    #[test]
    fn a_file_changed_on_disk_must_be_read_again() {
        let (conn, root) = library();
        let picture = upsert(&conn, &sample(1, root, "a.jpg")).unwrap();
        let clip = upsert(
            &conn,
            &NewItem {
                kind: "video".into(),
                ..sample(1, root, "b.mp4")
            },
        )
        .unwrap();
        let notes = NewItem {
            kind: "other".into(),
            ..sample(1, root, "c.txt")
        };
        upsert(&conn, &notes).unwrap();
        let unread = |videos| -> Vec<i64> {
            live_media(&conn, videos)
                .unwrap()
                .into_iter()
                .filter(|media| !media.read)
                .map(|media| media.id)
                .collect()
        };

        assert_eq!(
            unread(false),
            [picture],
            "videos wait for ffmpeg; other files are never read"
        );
        assert_eq!(unread(true), [picture, clip]);

        let learned = Probe {
            width: Some(4),
            height: Some(3),
            ..Probe::default()
        };
        record_media(&conn, picture, &learned).unwrap();
        assert!(unread(false).is_empty());

        let changed = NewItem {
            size_bytes: 5,
            ..sample(1, root, "a.jpg")
        };
        upsert(&conn, &changed).unwrap();
        assert_eq!(
            unread(false),
            [picture],
            "a refreshed row forgets it was read"
        );
    }
}
