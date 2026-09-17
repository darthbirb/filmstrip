//! Registered roots, each a library or a sorting source. PRODUCT.md "The Sorting Box".

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::{folders, now};
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum SourceKind {
    Library,
    Sorting,
}

impl SourceKind {
    fn as_str(self) -> &'static str {
        match self {
            SourceKind::Library => "library",
            SourceKind::Sorting => "sorting",
        }
    }

    pub(crate) fn parse(text: &str) -> Self {
        match text {
            "sorting" => SourceKind::Sorting,
            _ => SourceKind::Library,
        }
    }
}

/// Why a folder was not taken as a source. The words belong to the band that says
/// so; this only says which of the four it was. DESIGN.md "Shapes".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Refusal {
    /// The folder is already a source under its own name.
    Same,
    /// The folder sits inside a source.
    Inside,
    /// The folder holds a source somewhere within it.
    Contains,
    /// The folder is the app's own, where nothing of the user's belongs.
    AppFolder,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Source {
    pub id: i64,
    pub root: String,
    pub title: String,
    pub kind: SourceKind,
    pub added_at: i64,
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Source> {
    Ok(Source {
        id: row.get(0)?,
        root: row.get(1)?,
        title: row.get(2)?,
        kind: SourceKind::parse(&row.get::<_, String>(3)?),
        added_at: row.get(4)?,
    })
}

/// Registers a root, together with the folder that stands for it. The caller
/// checks [`nesting_conflict`] first; this layer only writes.
pub fn add(conn: &Connection, root: &Path, title: &str, kind: SourceKind) -> Result<Source> {
    let added_at = now();
    conn.execute(
        "INSERT INTO source (root, title, kind, added_at) VALUES (?1, ?2, ?3, ?4)",
        params![root.to_string_lossy(), title, kind.as_str(), added_at],
    )?;
    let id = conn.last_insert_rowid();
    folders::create_root(conn, id, title)?;
    Ok(Source {
        id,
        root: root.to_string_lossy().into_owned(),
        title: title.into(),
        kind,
        added_at,
    })
}

pub fn get(conn: &Connection, id: i64) -> Result<Option<Source>> {
    Ok(conn
        .query_row(
            "SELECT id, root, title, kind, added_at FROM source WHERE id = ?1",
            params![id],
            read,
        )
        .optional()?)
}

pub fn list(conn: &Connection) -> Result<Vec<Source>> {
    let mut stmt =
        conn.prepare("SELECT id, root, title, kind, added_at FROM source ORDER BY id")?;
    Ok(stmt.query_map([], read)?.collect::<rusqlite::Result<_>>()?)
}

pub fn list_of_kind(conn: &Connection, kind: SourceKind) -> Result<Vec<Source>> {
    let mut stmt = conn.prepare(
        "SELECT id, root, title, kind, added_at FROM source WHERE kind = ?1 ORDER BY id",
    )?;
    Ok(stmt
        .query_map(params![kind.as_str()], read)?
        .collect::<rusqlite::Result<_>>()?)
}

/// Live item count and total size, for the per-source row in Settings.
pub fn item_stats(conn: &Connection, id: i64) -> Result<(i64, i64)> {
    Ok(conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(size_bytes), 0)
           FROM item WHERE source_id = ?1 AND deleted_at IS NULL",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?)
}

/// The app's own label for a source, not the folder's name on disk. Its root folder
/// carries the same words, so navigation and Settings never disagree.
pub fn rename(conn: &Connection, id: i64, title: &str) -> Result<()> {
    let title = title.trim();
    if title.is_empty() {
        return Ok(());
    }
    conn.execute(
        "UPDATE source SET title = ?2 WHERE id = ?1",
        params![id, title],
    )?;
    let root = folders::source_root_folder(conn, id)?;
    conn.execute(
        "UPDATE folder SET title = ?2 WHERE id = ?1",
        params![root, title],
    )?;
    crate::db::tags::sync_title_tag(conn, root, title)?;
    Ok(())
}

/// Moves a source between the tree and the Sorting Box. Nothing on disk moves.
pub fn set_kind(conn: &Connection, id: i64, kind: SourceKind) -> Result<()> {
    conn.execute(
        "UPDATE source SET kind = ?2 WHERE id = ?1",
        params![id, kind.as_str()],
    )?;
    Ok(())
}

/// Forgets a source outright; **its directory is never touched**, and adding it
/// again re-reads it. Covers point in from outside the cascade, so go first.
pub fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE folder SET cover_item_id = NULL
          WHERE cover_item_id IN (SELECT id FROM item WHERE source_id = ?1)",
        params![id],
    )?;
    conn.execute("DELETE FROM item WHERE source_id = ?1", params![id])?;
    // Only the source's own folder needs naming: `parent_id ON DELETE CASCADE`
    // takes every descendant with it.
    conn.execute("DELETE FROM folder WHERE source_id = ?1", params![id])?;
    conn.execute("DELETE FROM source WHERE id = ?1", params![id])?;
    Ok(())
}

/// The registered source `candidate` collides with, and how: the same directory,
/// or one inside the other — which would give one directory two identities.
pub fn nesting_conflict<'a>(
    existing: &'a [Source],
    candidate: &Path,
) -> Option<(Refusal, &'a Source)> {
    use crate::fs::paths::{contains, same_dir};
    existing.iter().find_map(|source| {
        let root = Path::new(&source.root);
        let why = if same_dir(root, candidate) {
            Refusal::Same
        } else if contains(root, candidate) {
            Refusal::Inside
        } else if contains(candidate, root) {
            Refusal::Contains
        } else {
            return None;
        };
        Some((why, source))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::path::PathBuf;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    #[test]
    fn a_source_comes_with_a_folder_of_its_own() {
        let conn = conn();
        let source = add(
            &conn,
            &PathBuf::from("D:/library"),
            "Library",
            SourceKind::Library,
        )
        .unwrap();

        let root = folders::source_root_folder(&conn, source.id).unwrap();
        assert_eq!(
            folders::title(&conn, root).unwrap().as_deref(),
            Some("Library")
        );
    }

    #[test]
    fn the_sorting_box_is_several_sources_and_the_library_is_not_among_them() {
        let conn = conn();
        add(
            &conn,
            &PathBuf::from("D:/library"),
            "Library",
            SourceKind::Library,
        )
        .unwrap();
        add(
            &conn,
            &PathBuf::from("D:/incoming"),
            "Incoming",
            SourceKind::Sorting,
        )
        .unwrap();
        add(
            &conn,
            &PathBuf::from("D:/camera"),
            "Camera",
            SourceKind::Sorting,
        )
        .unwrap();

        let sorting = list_of_kind(&conn, SourceKind::Sorting).unwrap();
        assert_eq!(sorting.len(), 2, "the Sorting Box is plural");
        assert!(sorting.iter().all(|s| s.kind == SourceKind::Sorting));
        assert_eq!(list_of_kind(&conn, SourceKind::Library).unwrap().len(), 1);
    }

    #[test]
    fn one_root_may_not_sit_inside_another() {
        let conn = conn();
        add(
            &conn,
            &PathBuf::from("D:/library/photos"),
            "Photos",
            SourceKind::Library,
        )
        .unwrap();
        let existing = list(&conn).unwrap();

        // Which of the three it is decides which sentence the band says.
        for (candidate, why) in [
            ("D:/library/photos/2024", Refusal::Inside),
            ("D:/library", Refusal::Contains),
            ("D:/library/photos", Refusal::Same),
        ] {
            let clash = nesting_conflict(&existing, &PathBuf::from(candidate));
            assert_eq!(
                clash.map(|(why, source)| (why, source.title.clone())),
                Some((why, "Photos".to_string())),
                "{candidate} should collide as {why:?}"
            );
        }
        assert!(
            nesting_conflict(&existing, &PathBuf::from("D:/library/videos")).is_none(),
            "a sibling directory is fine"
        );
    }

    #[test]
    fn removing_a_source_leaves_the_others_alone() {
        let conn = conn();
        let library = add(
            &conn,
            &PathBuf::from("D:/library"),
            "Library",
            SourceKind::Library,
        )
        .unwrap();
        let archive = add(
            &conn,
            &PathBuf::from("E:/archive"),
            "Archive",
            SourceKind::Library,
        )
        .unwrap();
        let archive_root = folders::source_root_folder(&conn, archive.id).unwrap();
        folders::create(&conn, archive_root, "Trips").unwrap();

        remove(&conn, archive.id).unwrap();

        assert_eq!(list(&conn).unwrap().len(), 1);
        assert!(
            folders::source_root_folder(&conn, archive.id).is_err(),
            "its folders are gone"
        );
        assert!(
            folders::source_root_folder(&conn, library.id).is_ok(),
            "the other survives"
        );
    }
}
