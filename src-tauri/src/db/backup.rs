//! The index copied whole by SQLite's own online backup, checked before it is trusted, and copied
//! back over the live one. DECISIONS.md "Backing up the index".

use std::collections::HashSet;
use std::path::Path;
use std::time::Duration;

use rusqlite::backup::{Backup, StepResult};
use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params, params_from_iter};

use crate::db::{folders, journal, now, search, tags};
use crate::error::{AppError, Result};

/// Pages copied back per step, so a restore can say how far it has got.
const PAGES_PER_STEP: i32 = 256;
/// How many times a step waits on a lock before the copy gives up.
const BUSY_TRIES: u32 = 50;
const BUSY_WAIT: Duration = Duration::from_millis(100);

fn read_only(path: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

/// Copies the index whole into a new file at `to`, in one step that reads it as of one moment, so
/// the copy is consistent however busy the index is. The copy keeps its own rollback journal, so
/// it stands as one file.
pub fn copy(conn: &Connection, to: &Path) -> Result<()> {
    let mut copy = Connection::open(to)?;
    {
        let backup = Backup::new(conn, &mut copy)?;
        if backup.step(-1)? != StepResult::Done {
            return Err(AppError::invalid("the index was too busy to copy"));
        }
    }
    let _: String = copy.query_row("PRAGMA journal_mode=DELETE", [], |r| r.get(0))?;
    Ok(())
}

/// Copies a backup on disk into a new file at `to`, as [`copy`] does the index.
pub fn copy_file(from: &Path, to: &Path) -> Result<()> {
    copy(&read_only(from)?, to)
}

/// Whether a file is an index this build can open, every page of it read and found whole.
pub fn is_whole(path: &Path) -> bool {
    let Ok(conn) = read_only(path) else {
        return false;
    };
    let whole = conn
        .query_row("PRAGMA integrity_check(1)", [], |r| r.get::<_, String>(0))
        .is_ok_and(|verdict| verdict == "ok");
    let known = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| {
            r.get::<_, Option<i64>>(0)
        })
        .ok()
        .flatten()
        .is_some_and(|version| version <= crate::db::latest_schema());
    whole && known
}

/// Copies `from` over the live index in one write, so one that fails part way leaves the index as
/// it was. `progress` hears how much of it has been copied, from 0 to 1.
pub fn copy_back(from: &Path, live: &mut Connection, progress: &dyn Fn(f64)) -> Result<()> {
    let source = read_only(from)?;
    let backup = Backup::new(&source, live)?;
    let mut waits = 0;
    loop {
        match backup.step(PAGES_PER_STEP)? {
            StepResult::Done => break,
            StepResult::More => {
                let at = backup.progress();
                if at.pagecount > 0 {
                    progress(f64::from(at.pagecount - at.remaining) / f64::from(at.pagecount));
                }
            }
            _ => {
                waits += 1;
                if waits > BUSY_TRIES {
                    return Err(AppError::invalid("the index stayed busy"));
                }
                std::thread::sleep(BUSY_WAIT);
            }
        }
    }
    progress(1.0);
    Ok(())
}

/// A file in the live index's Trash, and where it left from: its source's root and the titles
/// below it, which is how a restored index finds the same place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InTrash {
    pub id: i64,
    pub uuid: String,
    pub disk_name: String,
    pub root: String,
    pub titles: Vec<String>,
    pub source_id: i64,
    pub source: String,
}

/// Everything in the live index's Trash.
pub fn in_trash(conn: &Connection) -> Result<Vec<InTrash>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.uuid, i.disk_name, i.folder_id, s.root, s.id, s.title
           FROM item i JOIN source s ON s.id = i.source_id
          WHERE i.trashed_at IS NOT NULL ORDER BY i.id",
    )?;
    let rows: Vec<(i64, String, String, i64, String, i64, String)> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    rows.into_iter()
        .map(
            |(id, uuid, disk_name, folder_id, root, source_id, source)| {
                Ok(InTrash {
                    id,
                    uuid,
                    disk_name,
                    root,
                    titles: folders::location(conn, folder_id)?.titles,
                    source_id,
                    source,
                })
            },
        )
        .collect()
}

/// What in `trash` a restore of the backup at `path` would forget: each whose source's root it
/// has no folder for, so [`settle`] finds no place for it.
pub fn unplaced<'a>(path: &Path, trash: &'a [InTrash]) -> Result<Vec<&'a InTrash>> {
    let backup = read_only(path)?;
    let mut stmt = backup.prepare(
        "SELECT EXISTS(SELECT 1 FROM source s JOIN folder f ON f.source_id = s.id
                        WHERE s.root = ?1 AND f.parent_id IS NULL AND f.deleted_at IS NULL)",
    )?;
    let mut lost = Vec::new();
    for one in trash {
        if !stmt.query_row(params![one.root], |r| r.get::<_, bool>(0))? {
            lost.push(one);
        }
    }
    Ok(lost)
}

/// Makes a restored index fit what is true now: the live Trash, its folders retired where missing;
/// the rest of its own Trash retired in place, or dropped where the name is taken; no jobs; undo
/// ending here. DECISIONS.md "Backing up the index".
pub fn settle(
    restored: &mut Connection,
    live: &Connection,
    trash: &[InTrash],
    kept: &dyn Fn(&InTrash) -> bool,
) -> Result<()> {
    let tx = super::begin(restored)?;
    let at = now();
    let mut placed = HashSet::new();
    for one in trash.iter().filter(|one| kept(one)) {
        let Some(folder_id) = place(&tx, &one.root, &one.titles, at)? else {
            continue;
        };
        let id = match item_by_uuid(&tx, &one.uuid)? {
            Some(id) => {
                let (trashed_at, deleted_at): (i64, i64) = live.query_row(
                    "SELECT trashed_at, deleted_at FROM item WHERE id = ?1",
                    params![one.id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )?;
                tx.execute(
                    "UPDATE item SET folder_id = ?2, source_id = ?3, disk_name = ?4, ext = ?5,
                                     deleted_at = ?6, trashed_at = ?7
                      WHERE id = ?1",
                    params![
                        id,
                        folder_id,
                        source_of(&tx, folder_id)?,
                        one.disk_name,
                        crate::fs::paths::extension_of(&one.disk_name),
                        deleted_at,
                        trashed_at
                    ],
                )?;
                id
            }
            None => carry(&tx, live, one.id, folder_id)?,
        };
        tags::rebuild_item(&tx, id)?;
        placed.insert(id);
    }

    let mut stmt = tx.prepare("SELECT id FROM item WHERE trashed_at IS NOT NULL")?;
    let trashed: Vec<i64> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    for id in trashed.into_iter().filter(|id| !placed.contains(id)) {
        let retired = tx.execute(
            "UPDATE item SET trashed_at = NULL, deleted_at = COALESCE(deleted_at, ?2)
              WHERE id = ?1
                AND NOT EXISTS (
                    SELECT 1 FROM item other
                     WHERE other.folder_id = item.folder_id AND other.id <> item.id
                       AND other.disk_name = item.disk_name COLLATE NOCASE
                       AND other.trashed_at IS NULL)",
            params![id, at],
        )?;
        if retired == 0 {
            tx.execute(
                "UPDATE folder SET cover_item_id = NULL WHERE cover_item_id = ?1",
                params![id],
            )?;
            tx.execute("DELETE FROM item WHERE id = ?1", params![id])?;
        }
        search::index_item(&tx, id)?;
    }
    tx.execute("DELETE FROM job", [])?;
    journal::set_floor(&tx)?;
    tx.commit()?;
    Ok(())
}

/// The folder at a place in the restored index: the live one there, or else one retired there,
/// or else one made retired. `None` when the restored index has no such source.
fn place(conn: &Connection, root: &str, titles: &[String], at: i64) -> Result<Option<i64>> {
    let source: Option<i64> = conn
        .query_row(
            "SELECT id FROM source WHERE root = ?1",
            params![root],
            |r| r.get(0),
        )
        .optional()?;
    let Some(source) = source else {
        return Ok(None);
    };
    let Ok(mut here) = folders::source_root_folder(conn, source) else {
        return Ok(None);
    };
    for title in titles {
        here = match folders::child_id(conn, here, title)? {
            Some(live) => live,
            None => match folders::retired_child(conn, here, title)? {
                Some(retired) => retired,
                None => folders::create_retired(conn, here, title, at)?,
            },
        };
    }
    Ok(Some(here))
}

fn source_of(conn: &Connection, folder_id: i64) -> Result<i64> {
    Ok(folders::location(conn, folder_id)?.source_id)
}

fn item_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row("SELECT id FROM item WHERE uuid = ?1", params![uuid], |r| {
            r.get(0)
        })
        .optional()?)
}

/// Copies a live item's row into the restored index under a new id, in the folder found for it,
/// with the tags it carries itself. Every column is carried, whatever the schema has grown.
fn carry(restored: &Connection, live: &Connection, id: i64, folder_id: i64) -> Result<i64> {
    let mut stmt = live.prepare("SELECT * FROM item WHERE id = ?1")?;
    let names: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
    let values: Vec<Value> = stmt.query_row(params![id], |r| {
        (0..names.len()).map(|at| r.get::<_, Value>(at)).collect()
    })?;
    drop(stmt);

    let source_id = source_of(restored, folder_id)?;
    let mut columns = Vec::new();
    let mut row = Vec::new();
    for (name, value) in names.iter().zip(values) {
        match name.as_str() {
            "id" => continue,
            "folder_id" => row.push(Value::Integer(folder_id)),
            "source_id" => row.push(Value::Integer(source_id)),
            _ => row.push(value),
        }
        columns.push(name.as_str());
    }
    let marks = vec!["?"; columns.len()].join(", ");
    restored.execute(
        &format!("INSERT INTO item ({}) VALUES ({marks})", columns.join(", ")),
        params_from_iter(row),
    )?;
    let carried = restored.last_insert_rowid();

    let mut stmt = live.prepare(
        "SELECT t.value, it.added_at FROM item_tag it JOIN tag t ON t.id = it.tag_id
          WHERE it.item_id = ?1 AND t.key IS NULL",
    )?;
    let own: Vec<(String, i64)> = stmt
        .query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    for (value, added_at) in own {
        let tag_id = tags::get_or_create_tag(restored, None, &value)?;
        restored.execute(
            "INSERT OR IGNORE INTO item_tag (item_id, tag_id, added_at) VALUES (?1, ?2, ?3)",
            params![carried, tag_id, added_at],
        )?;
    }
    Ok(carried)
}
