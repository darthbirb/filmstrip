//! Folders. A folder's path is never stored — it is derived from ancestry, so
//! renaming a directory costs one row. DECISIONS.md "Places, not queries".

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::{now, tags};
use crate::error::{AppError, Result};

/// A folder's source, and the titles from that source's root down to it.
/// **The root folder contributes no title** — it is the source's `root` path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderLocation {
    pub source_id: i64,
    pub titles: Vec<String>,
}

pub fn location(conn: &Connection, folder_id: i64) -> Result<FolderLocation> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE ancestry(id, title, parent_id, source_id, depth) AS (
             SELECT id, title, parent_id, source_id, 0 FROM folder WHERE id = ?1
           UNION ALL
             SELECT f.id, f.title, f.parent_id, f.source_id, a.depth + 1
               FROM folder f JOIN ancestry a ON f.id = a.parent_id
         )
         SELECT title, source_id, parent_id FROM ancestry ORDER BY depth DESC",
    )?;
    let rows: Vec<(String, Option<i64>, Option<i64>)> = stmt
        .query_map(params![folder_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?
        .collect::<rusqlite::Result<_>>()?;

    let titles = rows
        .iter()
        .filter(|(_, _, parent_id)| parent_id.is_some())
        .map(|(title, ..)| title.clone())
        .collect();
    let source_id = rows
        .iter()
        .find_map(|(_, source_id, _)| *source_id)
        .ok_or_else(|| {
            AppError::invalid(format!("folder {folder_id} has no source in its ancestry"))
        })?;
    Ok(FolderLocation { source_id, titles })
}

/// A folder on the way down from a source's own folder, as the breadcrumb takes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Crumb {
    pub id: i64,
    pub title: String,
}

/// Every folder from the source's own down to this one. The source's own goes by the source's
/// title, as navigation shows it.
pub fn ancestry(conn: &Connection, folder_id: i64) -> Result<Vec<Crumb>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE ancestry(id, title, parent_id, source_id, depth) AS (
             SELECT id, title, parent_id, source_id, 0 FROM folder WHERE id = ?1
           UNION ALL
             SELECT f.id, f.title, f.parent_id, f.source_id, a.depth + 1
               FROM folder f JOIN ancestry a ON f.id = a.parent_id
         )
         SELECT a.id, COALESCE(s.title, a.title)
           FROM ancestry a LEFT JOIN source s ON a.parent_id IS NULL AND s.id = a.source_id
          ORDER BY a.depth DESC",
    )?;
    let crumbs = stmt
        .query_map(params![folder_id], |r| {
            Ok(Crumb {
                id: r.get(0)?,
                title: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(crumbs)
}

pub fn source_root_folder(conn: &Connection, source_id: i64) -> Result<i64> {
    conn.query_row(
        "SELECT id FROM folder WHERE source_id = ?1 AND parent_id IS NULL AND deleted_at IS NULL",
        params![source_id],
        |r| r.get(0),
    )
    .map_err(|_| AppError::invalid(format!("source {source_id} has no folder of its own")))
}

pub fn title(conn: &Connection, id: i64) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT title FROM folder WHERE id = ?1", params![id], |r| {
            r.get(0)
        })
        .optional()?)
}

/// The live child with this title, compared exactly as `idx_folder_sibling` compares.
pub fn child_id(conn: &Connection, parent_id: i64, title: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM folder
              WHERE parent_id = ?1 AND title = ?2 COLLATE NOCASE AND deleted_at IS NULL",
            params![parent_id, title],
            |r| r.get(0),
        )
        .optional()?)
}

/// A folder as the navigation lists it. Counts are of live, direct contents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderNode {
    pub id: i64,
    pub title: String,
    pub child_count: i64,
    pub item_count: i64,
}

pub fn children(conn: &Connection, parent_id: i64) -> Result<Vec<FolderNode>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.title,
                (SELECT COUNT(*) FROM folder c WHERE c.parent_id = f.id AND c.deleted_at IS NULL),
                (SELECT COUNT(*) FROM item i WHERE i.folder_id = f.id AND i.deleted_at IS NULL)
           FROM folder f
          WHERE f.parent_id = ?1 AND f.deleted_at IS NULL
          ORDER BY f.title COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map(params![parent_id], |r| {
            Ok(FolderNode {
                id: r.get(0)?,
                title: r.get(1)?,
                child_count: r.get(2)?,
                item_count: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// A source's own folder. Created with the source, so nothing can observe one
/// without the other.
pub fn create_root(conn: &Connection, source_id: i64, title: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO folder (source_id, title, parent_id, created_at) VALUES (?1, ?2, NULL, ?3)",
        params![source_id, title, now()],
    )?;
    let id = conn.last_insert_rowid();
    tags::sync_title_tag(conn, id, title)?;
    Ok(id)
}

pub fn create(conn: &Connection, parent_id: i64, title: &str) -> Result<i64> {
    if child_id(conn, parent_id, title)?.is_some() {
        return Err(AppError::invalid(format!(
            "a folder named '{title}' already exists here"
        )));
    }
    conn.execute(
        "INSERT INTO folder (title, parent_id, created_at) VALUES (?1, ?2, ?3)",
        params![title, parent_id, now()],
    )?;
    let id = conn.last_insert_rowid();
    tags::sync_title_tag(conn, id, title)?;
    Ok(id)
}

/// Soft-deletes a folder and everything beneath it; returns how many folders.
/// Whether the folder is in the index and not retired.
pub fn is_live(conn: &Connection, folder_id: i64) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM folder WHERE id = ?1 AND deleted_at IS NULL)",
        params![folder_id],
        |r| r.get(0),
    )?)
}

/// Every live folder below this one, parents before their children.
pub fn descendants(conn: &Connection, folder_id: i64) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE subtree(id, depth) AS (
             SELECT id, 1 FROM folder WHERE parent_id = ?1 AND deleted_at IS NULL
           UNION ALL
             SELECT f.id, s.depth + 1 FROM folder f JOIN subtree s ON f.parent_id = s.id
              WHERE f.deleted_at IS NULL
         )
         SELECT id FROM subtree ORDER BY depth, id",
    )?;
    let ids = stmt
        .query_map(params![folder_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

pub fn trash_subtree(conn: &Connection, folder_id: i64) -> Result<i64> {
    let count = conn.execute(
        "WITH RECURSIVE subtree(id) AS (
             SELECT ?1
           UNION ALL
             SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
         )
         UPDATE folder SET deleted_at = ?2
          WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL",
        params![folder_id, now()],
    )?;
    Ok(count as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::sources::{self, SourceKind};

    fn library() -> (Connection, i64) {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let source =
            sources::add(&conn, "D:/library".as_ref(), "Library", SourceKind::Library).unwrap();
        let root = source_root_folder(&conn, source.id).unwrap();
        (conn, root)
    }

    #[test]
    fn a_sources_own_folder_contributes_no_title() {
        let (conn, root) = library();
        assert_eq!(
            location(&conn, root).unwrap(),
            FolderLocation {
                source_id: 1,
                titles: vec![]
            }
        );
    }

    #[test]
    fn location_reads_the_whole_ancestry_in_order() {
        let (conn, root) = library();
        let people = create(&conn, root, "People").unwrap();
        let ana = create(&conn, people, "Ana").unwrap();

        let location = location(&conn, ana).unwrap();
        assert_eq!(location.source_id, 1);
        assert_eq!(location.titles, ["People", "Ana"]);
    }

    #[test]
    fn one_name_per_spot_whatever_the_case() {
        let (conn, root) = library();
        create(&conn, root, "Beach").unwrap();

        assert!(
            create(&conn, root, "beach").is_err(),
            "the same name in another case"
        );
        assert!(
            create(&conn, root, "Beach").is_err(),
            "the same name exactly"
        );
    }

    #[test]
    fn the_same_name_under_different_parents_is_two_folders() {
        let (conn, root) = library();
        let a = create(&conn, root, "2024").unwrap();
        let b = create(&conn, root, "2025").unwrap();

        let one = create(&conn, a, "Trips").unwrap();
        let two = create(&conn, b, "Trips").unwrap();
        assert_ne!(one, two);
    }

    #[test]
    fn children_come_sorted_whatever_the_case_and_count_only_live_folders() {
        let (conn, root) = library();
        let trips = create(&conn, root, "trips").unwrap();
        create(&conn, root, "Archive").unwrap();
        create(&conn, trips, "Cairo").unwrap();
        let old = create(&conn, trips, "Old").unwrap();
        trash_subtree(&conn, old).unwrap();

        let listed = children(&conn, root).unwrap();
        let titles: Vec<_> = listed.iter().map(|f| f.title.as_str()).collect();
        assert_eq!(titles, ["Archive", "trips"]);
        assert_eq!(listed[1].child_count, 1, "the trashed child is not counted");
    }

    #[test]
    fn a_second_root_for_one_source_is_refused() {
        let (conn, _) = library();
        assert!(create_root(&conn, 1, "Second").is_err());
    }
}
