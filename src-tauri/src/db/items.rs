//! Items. Every item is a real file in a real folder, so a row is only ever
//! a description of something on disk.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
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
    /// A video's scrub frames, once they have been made.
    pub scrub: Option<Scrub>,
}

/// A strip of frames through a video, side by side, left to right through the clip.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Scrub {
    pub path: String,
    pub frames: u32,
}

/// The columns [`row`] reads, in its order, from `item` named `i`.
pub(crate) const ROW: &str =
    "i.id, i.uuid, i.folder_id, i.disk_name, i.ext, i.kind, i.size_bytes, i.mtime,
                   i.width, i.height, i.duration_ms, i.favorite";

/// How many columns [`ROW`] is, so a query can read what it selects after them.
pub(crate) const ROW_WIDTH: usize = 12;

pub(crate) fn row(r: &rusqlite::Row) -> rusqlite::Result<ItemRow> {
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
        scrub: None,
    })
}

/// What a place's grid is ordered by. DECISIONS.md "Sorting a place".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SortKey {
    /// When it was taken, or else when it was modified, as `year:` reads it.
    #[default]
    Taken,
    Added,
    Size,
    /// A video's running time; whatever has none comes after, either way.
    Length,
    /// A shuffle drawn from the seed, which has no direction.
    Random,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SortDir {
    Asc,
    #[default]
    Desc,
}

/// A key, its direction, and the seed a random order is drawn from, so it holds until shuffled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Sort {
    pub key: SortKey,
    pub dir: SortDir,
    pub seed: u32,
}

/// 2^31 - 1, a prime, so each step of the shuffle's hash stays inside SQLite's 64-bit integers.
const SHUFFLE_PRIME: i64 = 2_147_483_647;

impl Sort {
    /// The `ORDER BY` terms for `item` named `i`. Every key ends on the id, so a tie holds still.
    pub(crate) fn order(&self) -> String {
        let dir = match self.dir {
            SortDir::Asc => "ASC",
            SortDir::Desc => "DESC",
        };
        match self.key {
            SortKey::Taken => format!("COALESCE(i.captured_at, i.mtime) {dir}, i.id {dir}"),
            SortKey::Added => format!("i.added_at {dir}, i.id {dir}"),
            SortKey::Size => format!("i.size_bytes {dir}, i.id {dir}"),
            SortKey::Length => {
                format!("i.duration_ms IS NULL, i.duration_ms {dir}, i.id {dir}")
            }
            SortKey::Random => format!("{}, i.id", self.shuffled()),
        }
    }

    /// Each item's place in the shuffle the seed draws.
    fn shuffled(&self) -> String {
        let p = SHUFFLE_PRIME;
        let (low, high) = (self.seed & 0xFFFF, self.seed >> 16);
        let spread = format!("((i.id * 48271 + {low}) % {p})");
        let once = format!("(({spread} * {spread} + {high}) % {p})");
        format!("(({once} * {once} + {}) % {p})", low + high + 1)
    }
}

/// The live items directly in a folder, in the order the grid shows them.
pub fn in_folder_sorted(conn: &Connection, folder_id: i64, sort: &Sort) -> Result<Vec<ItemRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ROW} FROM item i
          WHERE i.folder_id = ?1 AND i.deleted_at IS NULL
          ORDER BY {}",
        sort.order()
    ))?;
    let rows = stmt
        .query_map(params![folder_id], row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// The live items directly in a folder, by name whatever the case.
pub fn in_folder(conn: &Connection, folder_id: i64) -> Result<Vec<ItemRow>> {
    let mut stmt = conn.prepare(&branch_query(ROW, false))?;
    let rows = stmt
        .query_map(params![folder_id], row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// The live ids directly in a folder, or when `deep` everywhere beneath it too, in
/// [`branch_query`]'s order, without reading the rest of each row.
pub fn branch_ids(conn: &Connection, folder_id: i64, deep: bool) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(&branch_query("i.id", deep))?;
    let ids = stmt
        .query_map(params![folder_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

/// A file of a checked branch, as the selection bar counts it and its verbs take it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BranchFile {
    pub id: i64,
    pub folder_id: i64,
    pub size_bytes: i64,
    pub favorite: bool,
}

/// Every live file at or below a folder, in [`branch_query`]'s order, with only what the bar reads.
pub fn branch_files(conn: &Connection, folder_id: i64) -> Result<Vec<BranchFile>> {
    let mut stmt = conn.prepare(&branch_query(
        "i.id, i.folder_id, i.size_bytes, i.favorite",
        true,
    ))?;
    let files = stmt
        .query_map(params![folder_id], |r| {
            Ok(BranchFile {
                id: r.get(0)?,
                folder_id: r.get(1)?,
                size_bytes: r.get(2)?,
                favorite: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(files)
}

/// By name whatever the case, then by id where two folders of a branch share a name.
fn branch_query(columns: &str, deep: bool) -> String {
    let (subtree, within) = if deep {
        (
            "WITH RECURSIVE subtree(id) AS (
                 SELECT ?1
               UNION ALL
                 SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
                  WHERE f.deleted_at IS NULL
             )",
            "i.folder_id IN (SELECT id FROM subtree)",
        )
    } else {
        ("", "i.folder_id = ?1")
    };
    format!(
        "{subtree}
         SELECT {columns} FROM item i
          WHERE {within} AND i.deleted_at IS NULL
          ORDER BY i.disk_name COLLATE NOCASE, i.id"
    )
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
    crate::db::search::index_item(conn, id)
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

/// Forgets a trashed item outright, once its file has left the trash for the Recycle Bin. Covers
/// point in from outside the cascade, so go first.
pub fn forget_trashed(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE folder SET cover_item_id = NULL WHERE cover_item_id = ?1",
        params![id],
    )?;
    conn.execute(
        "DELETE FROM item WHERE id = ?1 AND trashed_at IS NOT NULL",
        params![id],
    )?;
    crate::db::search::index_item(conn, id)
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

/// When an item went to the trash, for one that is there.
pub fn trashed_at(conn: &Connection, id: i64) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT trashed_at FROM item WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?
        .flatten())
}

/// Puts back the moment an item went to the trash, as undoing its restore does.
pub fn set_trashed_at(conn: &Connection, id: i64, at: i64) -> Result<()> {
    conn.execute(
        "UPDATE item SET deleted_at = ?1, trashed_at = ?1 WHERE id = ?2 AND trashed_at IS NOT NULL",
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
pub fn in_sorting(conn: &Connection, sort: &Sort) -> Result<Vec<ItemRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ROW} FROM item i
           JOIN source s ON s.id = i.source_id
          WHERE s.kind = 'sorting' AND i.deleted_at IS NULL
          ORDER BY {}",
        sort.order()
    ))?;
    let rows = stmt.query_map([], row)?.collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Every item in the trash with the moment it went, the most recent first.
pub fn in_trash(conn: &Connection) -> Result<Vec<(ItemRow, i64)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ROW}, i.trashed_at FROM item i
          WHERE i.trashed_at IS NOT NULL
          ORDER BY i.trashed_at DESC, i.id DESC"
    ))?;
    let rows = stmt
        .query_map([], |r| Ok((row(r)?, r.get(12)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// How many files, and their bytes together.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Tally {
    pub count: i64,
    pub bytes: i64,
}

impl Tally {
    fn add(&mut self, count: i64, bytes: i64) {
        self.count += count;
        self.bytes += bytes;
    }
}

/// What the library sources hold by kind and in all, what waits in the Sorting Box and what the
/// trash holds, read off the index, a source that is away included. DECISIONS.md "Navigation".
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct LibraryTotals {
    pub pictures: Tally,
    pub videos: Tally,
    /// Files the walk keeps that are neither.
    pub other: Tally,
    pub all: Tally,
    pub sorting: Tally,
    pub trash: Tally,
}

pub fn totals(conn: &Connection) -> Result<LibraryTotals> {
    let mut stmt = conn.prepare(
        "SELECT i.trashed_at IS NOT NULL, s.kind, i.kind, COUNT(*), COALESCE(SUM(i.size_bytes), 0)
           FROM item i
           JOIN source s ON s.id = i.source_id
          WHERE i.deleted_at IS NULL OR i.trashed_at IS NOT NULL
          GROUP BY 1, 2, 3",
    )?;
    let mut totals = LibraryTotals::default();
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let (trashed, source, kind): (bool, String, String) = (r.get(0)?, r.get(1)?, r.get(2)?);
        let (count, bytes) = (r.get(3)?, r.get(4)?);
        let tally = if trashed {
            &mut totals.trash
        } else if SourceKind::parse(&source) == SourceKind::Sorting {
            &mut totals.sorting
        } else {
            totals.all.add(count, bytes);
            match kind.as_str() {
                "image" => &mut totals.pictures,
                "video" => &mut totals.videos,
                _ => &mut totals.other,
            }
        };
        tally.add(count, bytes);
    }
    Ok(totals)
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
    /// When it went to the trash, for one that is there; its folders are then the ones it left.
    pub trashed_at: Option<i64>,
    pub source_id: i64,
    pub source_kind: SourceKind,
    /// From the source's own folder down to the item's.
    pub folders: Vec<Crumb>,
    /// The file, for the window to load. Empty until the command layer fills it in.
    pub path: String,
}

/// The item with this id in full, live or in the trash, or `None` once it is gone.
pub fn detail(conn: &Connection, id: i64) -> Result<Option<ItemDetail>> {
    let found = conn
        .query_row(
            &format!(
                "SELECT {ROW}, i.codec, i.bitrate, i.captured_at, i.captured_src, i.added_at,
                        i.trashed_at, s.id, s.kind
                   FROM item i JOIN source s ON s.id = i.source_id
                  WHERE i.id = ?1 AND (i.deleted_at IS NULL OR i.trashed_at IS NOT NULL)"
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
                    trashed_at: r.get(17)?,
                    source_id: r.get(18)?,
                    source_kind: SourceKind::parse(&r.get::<_, String>(19)?),
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
    pub duration_ms: Option<i64>,
}

pub fn file_of(conn: &Connection, id: i64) -> Result<Option<ItemFile>> {
    Ok(conn
        .query_row(
            "SELECT folder_id, disk_name, uuid, kind, duration_ms FROM item WHERE id = ?1",
            params![id],
            |r| {
                Ok(ItemFile {
                    folder_id: r.get(0)?,
                    disk_name: r.get(1)?,
                    uuid: r.get(2)?,
                    kind: r.get(3)?,
                    duration_ms: r.get(4)?,
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
    /// A video with a length, which gets scrub frames.
    pub scrubs: bool,
}

/// Every live picture, and every live video too when `videos` is set.
pub fn live_media(conn: &Connection, videos: bool) -> Result<Vec<LiveMedia>> {
    let mut stmt = conn.prepare(
        "SELECT id, uuid, probed_at IS NOT NULL, kind = 'video' AND COALESCE(duration_ms, 0) > 0 FROM item
          WHERE deleted_at IS NULL AND (kind = 'image' OR (?1 AND kind = 'video'))
          ORDER BY id",
    )?;
    let rows = stmt
        .query_map(params![videos], |r| {
            Ok(LiveMedia {
                id: r.get(0)?,
                uuid: r.get(1)?,
                read: r.get(2)?,
                scrubs: r.get(3)?,
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
    use std::collections::BTreeSet;
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
    fn a_branch_lists_its_own_files_or_everything_beneath_it_in_the_folder_order() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let egypt = folders::create(&conn, trips, "Egypt").unwrap();
        let cairo = folders::create(&conn, egypt, "Cairo").unwrap();
        let gone = folders::create(&conn, trips, "Gone").unwrap();
        upsert(&conn, &sample(1, root, "above.jpg")).unwrap();
        let ticket = upsert(&conn, &sample(1, trips, "ticket.jpg")).unwrap();
        let map = upsert(&conn, &sample(1, trips, "Map.jpg")).unwrap();
        let pyramid = upsert(&conn, &sample(1, cairo, "pyramid.jpg")).unwrap();
        let ticket_too = upsert(&conn, &sample(1, cairo, "TICKET.jpg")).unwrap();
        let nile = upsert(&conn, &sample(1, egypt, "nile.jpg")).unwrap();
        let retired = upsert(&conn, &sample(1, cairo, "blurred.jpg")).unwrap();
        retire(&conn, retired).unwrap();
        upsert(&conn, &sample(1, gone, "lost.jpg")).unwrap();
        folders::trash_subtree(&conn, gone).unwrap();

        assert_eq!(branch_ids(&conn, trips, false).unwrap(), [map, ticket]);
        assert_eq!(
            branch_ids(&conn, trips, true).unwrap(),
            [map, nile, pyramid, ticket, ticket_too],
            "by name whatever the case, a shared name by id, nothing retired or gone"
        );
        let rows: Vec<i64> = in_folder(&conn, trips)
            .unwrap()
            .into_iter()
            .map(|row| row.id)
            .collect();
        assert_eq!(rows, branch_ids(&conn, trips, false).unwrap());
        let files: Vec<(i64, i64)> = branch_files(&conn, trips)
            .unwrap()
            .into_iter()
            .map(|file| (file.id, file.folder_id))
            .collect();
        assert_eq!(
            files,
            [
                (map, trips),
                (nile, egypt),
                (pyramid, cairo),
                (ticket, trips),
                (ticket_too, cairo)
            ]
        );
    }

    #[test]
    fn an_empty_folder_has_nothing_in_its_branch() {
        let (conn, root) = library();
        let empty = folders::create(&conn, root, "Empty").unwrap();
        folders::create(&conn, empty, "Also empty").unwrap();
        upsert(&conn, &sample(1, root, "beside.jpg")).unwrap();

        assert!(branch_ids(&conn, empty, false).unwrap().is_empty());
        assert!(branch_ids(&conn, empty, true).unwrap().is_empty());
    }

    #[test]
    fn a_source_that_is_away_still_answers_for_its_branch_from_the_index() {
        let (conn, _) = library();
        let away = sources::add(
            &conn,
            Path::new("Z:/unplugged"),
            "Unplugged",
            SourceKind::Library,
        )
        .unwrap();
        let root = folders::source_root_folder(&conn, away.id).unwrap();
        let scans = folders::create(&conn, root, "Scans").unwrap();
        let a = upsert(&conn, &sample(away.id, root, "a.jpg")).unwrap();
        let b = upsert(&conn, &sample(away.id, scans, "b.jpg")).unwrap();

        assert_eq!(branch_ids(&conn, root, true).unwrap(), [a, b]);
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

    fn sorted(conn: &Connection, folder_id: i64, key: SortKey, dir: SortDir) -> Vec<String> {
        in_folder_sorted(conn, folder_id, &Sort { key, dir, seed: 0 })
            .unwrap()
            .into_iter()
            .map(|item| item.disk_name)
            .collect()
    }

    /// a and b were taken at the same moment, a and c weigh the same, a and d arrived together.
    fn four_to_sort(conn: &Connection, root: i64) {
        let one = |name: &str, kind: &str, taken, mtime, size, length, added: i64| {
            let item = NewItem {
                kind: kind.into(),
                captured_at: taken,
                mtime,
                size_bytes: size,
                duration_ms: length,
                ..sample(1, root, name)
            };
            let id = upsert(conn, &item).unwrap();
            conn.execute(
                "UPDATE item SET added_at = ?1 WHERE id = ?2",
                params![added, id],
            )
            .unwrap();
        };
        one("a.jpg", "image", Some(300), 10, 50, None, 1000);
        one("b.mp4", "video", None, 300, 20, Some(5000), 3000);
        one("c.mp4", "video", Some(100), 999, 50, Some(9000), 2000);
        one("d.jpg", "image", Some(200), 10, 10, None, 1000);
        let gone = upsert(conn, &sample(1, root, "gone.jpg")).unwrap();
        retire(conn, gone).unwrap();
    }

    #[test]
    fn each_key_orders_a_folder_either_way_and_a_tie_falls_to_the_id_run_the_same_way() {
        let (conn, root) = library();
        four_to_sort(&conn, root);

        for (key, newest_first) in [
            (SortKey::Taken, ["b.mp4", "a.jpg", "d.jpg", "c.mp4"]),
            (SortKey::Added, ["b.mp4", "c.mp4", "d.jpg", "a.jpg"]),
            (SortKey::Size, ["c.mp4", "a.jpg", "b.mp4", "d.jpg"]),
        ] {
            assert_eq!(
                sorted(&conn, root, key, SortDir::Desc),
                newest_first,
                "{key:?}"
            );
            let mut reversed = newest_first.to_vec();
            reversed.reverse();
            assert_eq!(
                sorted(&conn, root, key, SortDir::Asc),
                reversed,
                "{key:?} reversed is the first order read backwards"
            );
        }
    }

    #[test]
    fn by_length_whatever_has_none_comes_last_either_way() {
        let (conn, root) = library();
        four_to_sort(&conn, root);

        assert_eq!(
            sorted(&conn, root, SortKey::Length, SortDir::Desc),
            ["c.mp4", "b.mp4", "d.jpg", "a.jpg"]
        );
        assert_eq!(
            sorted(&conn, root, SortKey::Length, SortDir::Asc),
            ["b.mp4", "c.mp4", "a.jpg", "d.jpg"]
        );
    }

    #[test]
    fn a_random_order_holds_for_its_seed_and_a_new_seed_draws_another() {
        let (conn, root) = library();
        let tx = crate::db::begin(&conn).unwrap();
        for n in 0..300 {
            upsert(&tx, &sample(1, root, &format!("{n:03}.jpg"))).unwrap();
        }
        tx.commit().unwrap();
        let shuffle = |seed, dir| -> Vec<i64> {
            in_folder_sorted(
                &conn,
                root,
                &Sort {
                    key: SortKey::Random,
                    dir,
                    seed,
                },
            )
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect()
        };
        let first = shuffle(1, SortDir::Desc);
        let mut ids = first.clone();
        ids.sort_unstable();

        assert_eq!(first.len(), 300);
        assert_eq!(
            shuffle(1, SortDir::Desc),
            first,
            "the same seed, the same order"
        );
        assert_eq!(
            shuffle(1, SortDir::Asc),
            first,
            "a random order has no direction"
        );
        assert_ne!(first, ids, "not the order the files arrived in");
        let pairs = |order: &[i64]| -> BTreeSet<(i64, i64)> {
            order.windows(2).map(|pair| (pair[0], pair[1])).collect()
        };
        for seed in [2, 3, u32::MAX] {
            let next = shuffle(seed, SortDir::Desc);
            assert_ne!(next, first, "seed {seed}");
            let kept = pairs(&first).intersection(&pairs(&next)).count();
            assert!(
                kept < 30,
                "seed {seed} keeps {kept} of the first order's neighbours, so it is not a new order"
            );
        }
    }

    #[test]
    fn a_sort_reads_as_the_interface_writes_it() {
        let sort: Sort =
            serde_json::from_value(serde_json::json!({ "key": "length", "dir": "asc", "seed": 7 }))
                .unwrap();
        assert_eq!(
            sort,
            Sort {
                key: SortKey::Length,
                dir: SortDir::Asc,
                seed: 7
            }
        );
        assert_eq!(
            Sort::default(),
            Sort {
                key: SortKey::Taken,
                dir: SortDir::Desc,
                seed: 0
            },
            "newest taken first, for every kind of place"
        );
    }

    #[test]
    fn the_sorting_box_takes_the_order_chosen() {
        let (conn, _) = library();
        for (root, name, size) in [
            ("D:/incoming", "small.jpg", 5),
            ("D:/camera", "large.jpg", 900),
        ] {
            let source = sources::add(&conn, Path::new(root), root, SourceKind::Sorting).unwrap();
            let folder = folders::source_root_folder(&conn, source.id).unwrap();
            let item = NewItem {
                size_bytes: size,
                ..sample(source.id, folder, name)
            };
            upsert(&conn, &item).unwrap();
        }
        let names = |dir| -> Vec<String> {
            in_sorting(
                &conn,
                &Sort {
                    key: SortKey::Size,
                    dir,
                    seed: 0,
                },
            )
            .unwrap()
            .into_iter()
            .map(|item| item.disk_name)
            .collect()
        };

        assert_eq!(names(SortDir::Desc), ["large.jpg", "small.jpg"]);
        assert_eq!(names(SortDir::Asc), ["small.jpg", "large.jpg"]);
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

        let names: Vec<_> = in_sorting(&conn, &Sort::default())
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

    #[test]
    fn the_totals_count_the_library_by_kind_apart_from_what_waits_and_what_is_thrown_away() {
        let (conn, root) = library();
        let sorting = sources::add(
            &conn,
            Path::new("D:/incoming"),
            "Incoming",
            SourceKind::Sorting,
        )
        .unwrap();
        let waiting = folders::source_root_folder(&conn, sorting.id).unwrap();
        let one = |source: i64, folder: i64, name: &str, kind: &str, size: i64| {
            let item = NewItem {
                kind: kind.into(),
                size_bytes: size,
                ..sample(source, folder, name)
            };
            upsert(&conn, &item).unwrap()
        };
        one(1, root, "a.jpg", "image", 10);
        one(1, root, "b.jpg", "image", 20);
        one(1, root, "c.mp4", "video", 300);
        one(1, root, "notes.txt", "other", 4);
        let thrown = one(1, root, "d.jpg", "image", 50);
        send_to_trash(&conn, thrown).unwrap();
        let gone = one(1, root, "e.jpg", "image", 70);
        retire(&conn, gone).unwrap();
        one(sorting.id, waiting, "f.jpg", "image", 5);
        let tossed = one(sorting.id, waiting, "g.mp4", "video", 6);
        send_to_trash(&conn, tossed).unwrap();

        assert_eq!(
            totals(&conn).unwrap(),
            LibraryTotals {
                pictures: Tally {
                    count: 2,
                    bytes: 30
                },
                videos: Tally {
                    count: 1,
                    bytes: 300
                },
                other: Tally { count: 1, bytes: 4 },
                all: Tally {
                    count: 4,
                    bytes: 334
                },
                sorting: Tally { count: 1, bytes: 5 },
                trash: Tally {
                    count: 2,
                    bytes: 56
                },
            },
            "a retired file is counted nowhere"
        );
    }

    #[test]
    fn an_empty_library_totals_nothing() {
        let (conn, _) = library();
        assert_eq!(totals(&conn).unwrap(), LibraryTotals::default());
    }

    mod timing {
        use super::*;

        /// An eight-level branch of 40,000 files, five side folders at each level; its top folder.
        fn forty_thousand_deep(conn: &Connection, root: i64) -> i64 {
            let tx = crate::db::begin(conn).unwrap();
            let mut parent = root;
            let mut at = Vec::new();
            for depth in 0..8 {
                parent = folders::create(&tx, parent, &format!("level {depth}")).unwrap();
                for side in 0..5 {
                    at.push(folders::create(&tx, parent, &format!("side {side}")).unwrap());
                }
                at.push(parent);
            }
            for n in 0..40_000 {
                let folder = at[n % at.len()];
                upsert(&tx, &sample(1, folder, &format!("IMG_{n:05}.jpg"))).unwrap();
            }
            tx.commit().unwrap();
            folders::child_id(conn, root, "level 0").unwrap().unwrap()
        }

        #[test]
        #[ignore = "timing: runs alone, one test at a time"]
        fn forty_thousand_ids_come_back_well_inside_a_second() {
            let (conn, root) = library();
            let top = forty_thousand_deep(&conn, root);

            let started = std::time::Instant::now();
            let ids = branch_ids(&conn, top, true).unwrap();
            let took = started.elapsed();

            assert_eq!(ids.len(), 40_000);
            assert!(
                took < std::time::Duration::from_millis(500),
                "took {took:?}"
            );
        }

        #[test]
        #[ignore = "timing: runs alone, one test at a time"]
        fn forty_thousand_branch_files_are_read_and_written_out_well_inside_a_second() {
            let (conn, root) = library();
            let top = forty_thousand_deep(&conn, root);

            let started = std::time::Instant::now();
            let files = branch_files(&conn, top).unwrap();
            let json = serde_json::to_vec(&files).unwrap();
            let took = started.elapsed();

            assert_eq!(files.len(), 40_000);
            assert!(json.len() < 4_000_000, "{} bytes", json.len());
            assert!(
                took < std::time::Duration::from_millis(500),
                "took {took:?}"
            );
        }

        #[test]
        #[ignore = "timing: runs alone, one test at a time"]
        fn forty_thousand_in_one_folder_reorder_by_every_key_well_inside_a_second() {
            let (conn, root) = library();
            let tx = crate::db::begin(&conn).unwrap();
            for n in 0..40_000_i64 {
                let item = NewItem {
                    captured_at: (n % 3 != 0).then_some(n * 7 % 40_000),
                    size_bytes: n * 31 % 9_973,
                    duration_ms: (n % 5 == 0).then_some(n % 600_000),
                    ..sample(1, root, &format!("IMG_{n:05}.jpg"))
                };
                upsert(&tx, &item).unwrap();
            }
            tx.commit().unwrap();

            for key in [
                SortKey::Taken,
                SortKey::Added,
                SortKey::Size,
                SortKey::Length,
                SortKey::Random,
            ] {
                for dir in [SortDir::Desc, SortDir::Asc] {
                    let started = std::time::Instant::now();
                    let rows = in_folder_sorted(&conn, root, &Sort { key, dir, seed: 9 }).unwrap();
                    let took = started.elapsed();
                    assert_eq!(rows.len(), 40_000);
                    assert!(
                        took < std::time::Duration::from_millis(500),
                        "{key:?} {dir:?} took {took:?}"
                    );
                }
            }
        }

        #[test]
        #[ignore = "timing: runs alone, one test at a time"]
        fn the_totals_of_a_hundred_thousand_files_come_back_in_one_quick_read() {
            let (conn, root) = library();
            conn.execute(
                "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 100000)
                 INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, size_bytes, mtime,
                                   kind, added_at)
                 SELECT 'u' || i, 1, ?1, i || '.jpg', 'jpg', 1000, 1,
                        CASE WHEN i % 10 = 0 THEN 'video' ELSE 'image' END, 1
                   FROM n",
                params![root],
            )
            .unwrap();

            let started = std::time::Instant::now();
            let read = totals(&conn).unwrap();
            let took = started.elapsed();
            assert_eq!(read.pictures.count, 90_000);
            assert_eq!(read.videos.count, 10_000);
            assert_eq!(read.all.bytes, 100_000_000);
            assert!(took.as_millis() < 1000, "took {took:?}");
        }
    }
}
