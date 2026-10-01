//! Folders. A folder's path is never stored — it is derived from ancestry, so
//! renaming a directory costs one row. DECISIONS.md "Places, not queries".

use std::collections::HashMap;

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

/// The folder itself while it is live; once it has gone, a live folder at the same place, found
/// title by title from its source's own folder, as one made again under the same name is.
pub fn live_at(conn: &Connection, folder_id: i64) -> Result<Option<i64>> {
    if is_live(conn, folder_id)? {
        return Ok(Some(folder_id));
    }
    let at = location(conn, folder_id)?;
    let Ok(mut here) = source_root_folder(conn, at.source_id) else {
        return Ok(None);
    };
    for title in &at.titles {
        match child_id(conn, here, title)? {
            Some(child) => here = child,
            None => return Ok(None),
        }
    }
    Ok(Some(here))
}

/// A folder as the navigation lists it. Counts are of live contents: its own, then everything at
/// or below it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderNode {
    pub id: i64,
    pub title: String,
    pub child_count: i64,
    pub item_count: i64,
    pub all_count: i64,
    pub favorite: bool,
}

pub fn children(conn: &Connection, parent_id: i64) -> Result<Vec<FolderNode>> {
    let all = branch_counts(conn, parent_id)?;
    let mut stmt = conn.prepare(
        "SELECT f.id, f.title,
                (SELECT COUNT(*) FROM folder c WHERE c.parent_id = f.id AND c.deleted_at IS NULL),
                (SELECT COUNT(*) FROM item i WHERE i.folder_id = f.id AND i.deleted_at IS NULL),
                f.favorite
           FROM folder f
          WHERE f.parent_id = ?1 AND f.deleted_at IS NULL
          ORDER BY f.title COLLATE NOCASE",
    )?;
    let rows = stmt
        .query_map(params![parent_id], |r| {
            let id = r.get(0)?;
            Ok(FolderNode {
                id,
                title: r.get(1)?,
                child_count: r.get(2)?,
                item_count: r.get(3)?,
                all_count: all.get(&id).copied().unwrap_or(0),
                favorite: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Each live child of a folder, and the live files at or below it, in one walk.
fn branch_counts(conn: &Connection, parent_id: i64) -> Result<HashMap<i64, i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE below(top, id) AS (
             SELECT id, id FROM folder WHERE parent_id = ?1 AND deleted_at IS NULL
           UNION ALL
             SELECT b.top, f.id FROM folder f JOIN below b ON f.parent_id = b.id
              WHERE f.deleted_at IS NULL
         )
         SELECT b.top, COUNT(i.id) FROM below b
           LEFT JOIN item i ON i.folder_id = b.id AND i.deleted_at IS NULL
          GROUP BY b.top",
    )?;
    let counts = stmt
        .query_map(params![parent_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(counts)
}

/// The live files directly in one folder.
pub fn own_count(conn: &Connection, folder_id: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM item WHERE folder_id = ?1 AND deleted_at IS NULL",
        params![folder_id],
        |r| r.get(0),
    )?)
}

/// The live files at or below one folder.
pub fn subtree_count(conn: &Connection, folder_id: i64) -> Result<i64> {
    Ok(conn.query_row(
        "WITH RECURSIVE below(id) AS (
             SELECT ?1
           UNION ALL
             SELECT f.id FROM folder f JOIN below b ON f.parent_id = b.id
              WHERE f.deleted_at IS NULL
         )
         SELECT COUNT(*) FROM item i JOIN below b ON i.folder_id = b.id
          WHERE i.deleted_at IS NULL",
        params![folder_id],
        |r| r.get(0),
    )?)
}

/// Marks a folder a favourite, or not. Nothing on disk changes, so it is not journalled, as a
/// file's favourite is not.
pub fn set_favorite(conn: &Connection, folder_id: i64, favorite: bool) -> Result<()> {
    conn.execute(
        "UPDATE folder SET favorite = ?1 WHERE id = ?2",
        params![favorite, folder_id],
    )?;
    Ok(())
}

pub fn is_favorite(conn: &Connection, folder_id: i64) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT favorite FROM folder WHERE id = ?1",
            params![folder_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

/// Every live favourite folder, with the files directly in it. A retired folder keeps its flag,
/// so undoing its delete brings it back as a favourite.
pub fn favourites(conn: &Connection) -> Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT f.id,
                (SELECT COUNT(*) FROM item i WHERE i.folder_id = f.id AND i.deleted_at IS NULL)
           FROM folder f
          WHERE f.favorite = 1 AND f.deleted_at IS NULL",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// A live folder anywhere in the library, as a picker lays out the whole tree at once.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderEntry {
    pub id: i64,
    /// `None` for a source's own folder.
    pub parent_id: Option<i64>,
    pub source_id: i64,
    /// A source's own folder goes by the source's title, as navigation shows it.
    pub title: String,
    /// Live files directly in it, then at or below it.
    pub item_count: i64,
    pub all_count: i64,
}

/// Every live folder in every source, parents before their children.
pub fn every_live(conn: &Connection) -> Result<Vec<FolderEntry>> {
    let mut own = conn.prepare(
        "SELECT folder_id, COUNT(*) FROM item WHERE deleted_at IS NULL GROUP BY folder_id",
    )?;
    let own: HashMap<i64, i64> = own
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut stmt = conn.prepare(
        "WITH RECURSIVE tree(id, parent_id, source_id, title, depth) AS (
             SELECT f.id, f.parent_id, f.source_id, s.title, 0
               FROM folder f JOIN source s ON s.id = f.source_id
              WHERE f.parent_id IS NULL AND f.deleted_at IS NULL
           UNION ALL
             SELECT f.id, f.parent_id, t.source_id, f.title, t.depth + 1
               FROM folder f JOIN tree t ON f.parent_id = t.id
              WHERE f.deleted_at IS NULL
         )
         SELECT id, parent_id, source_id, title FROM tree ORDER BY depth, title COLLATE NOCASE",
    )?;
    let mut rows: Vec<FolderEntry> = stmt
        .query_map([], |r| {
            let id = r.get(0)?;
            let item_count = own.get(&id).copied().unwrap_or(0);
            Ok(FolderEntry {
                id,
                parent_id: r.get(1)?,
                source_id: r.get(2)?,
                title: r.get(3)?,
                item_count,
                all_count: item_count,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    // Children come after their parents, so walking back up adds each branch into its parent once.
    let at: HashMap<i64, usize> = rows.iter().enumerate().map(|(i, f)| (f.id, i)).collect();
    for i in (0..rows.len()).rev() {
        if let Some(&parent) = rows[i].parent_id.as_ref().and_then(|p| at.get(p)) {
            rows[parent].all_count += rows[i].all_count;
        }
    }
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

/// The folder a folder sits in; `None` for a source's own folder, or for no such folder.
pub fn parent(conn: &Connection, folder_id: i64) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT parent_id FROM folder WHERE id = ?1",
            params![folder_id],
            |r| r.get(0),
        )
        .optional()?
        .flatten())
}

/// A new title, with the title tag it carries kept in step.
pub fn set_title(conn: &Connection, folder_id: i64, title: &str) -> Result<()> {
    conn.execute(
        "UPDATE folder SET title = ?1 WHERE id = ?2",
        params![title, folder_id],
    )?;
    tags::sync_title_tag(conn, folder_id, title)
}

/// Moves a folder's row under another; its items follow into the new parent's source.
pub fn set_parent(conn: &Connection, folder_id: i64, parent_id: i64) -> Result<()> {
    conn.execute(
        "UPDATE folder SET parent_id = ?1 WHERE id = ?2",
        params![parent_id, folder_id],
    )?;
    let source_id = location(conn, parent_id)?.source_id;
    conn.execute(
        "WITH RECURSIVE subtree(id) AS (
             SELECT ?1
           UNION ALL
             SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
         )
         UPDATE item SET source_id = ?2 WHERE folder_id IN (SELECT id FROM subtree)",
        params![folder_id, source_id],
    )?;
    Ok(())
}

/// Whether `candidate` is `folder_id` itself or anywhere beneath it.
pub fn is_within(conn: &Connection, candidate: i64, folder_id: i64) -> Result<bool> {
    Ok(conn.query_row(
        "WITH RECURSIVE ancestry(id) AS (
             SELECT ?1
           UNION ALL
             SELECT f.parent_id FROM folder f JOIN ancestry a ON f.id = a.id
              WHERE f.parent_id IS NOT NULL
         )
         SELECT EXISTS(SELECT 1 FROM ancestry WHERE id = ?2)",
        params![candidate, folder_id],
        |r| r.get(0),
    )?)
}

/// Whether anything live, folder or item, sits directly in the folder.
pub fn holds_anything(conn: &Connection, folder_id: i64) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM folder WHERE parent_id = ?1 AND deleted_at IS NULL)
             OR EXISTS(SELECT 1 FROM item WHERE folder_id = ?1 AND deleted_at IS NULL)",
        params![folder_id],
        |r| r.get(0),
    )?)
}

/// Removes a folder's row outright, for a folder the app made and has now unmade.
pub fn forget(conn: &Connection, folder_id: i64) -> Result<()> {
    conn.execute("DELETE FROM folder WHERE id = ?1", params![folder_id])?;
    Ok(())
}

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

/// Soft-deletes a folder and everything beneath it; returns how many folders.
pub fn trash_subtree(conn: &Connection, folder_id: i64) -> Result<i64> {
    retire_subtree_at(conn, folder_id, now())
}

/// Retires a folder and everything live beneath it with one stamp, which is what brings exactly
/// those back again.
pub fn retire_subtree_at(conn: &Connection, folder_id: i64, at: i64) -> Result<i64> {
    let count = conn.execute(
        "WITH RECURSIVE subtree(id) AS (
             SELECT ?1
           UNION ALL
             SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
         )
         UPDATE folder SET deleted_at = ?2
          WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL",
        params![folder_id, at],
    )?;
    Ok(count as i64)
}

/// The folders at or below `folder_id` retired with the stamp `at`, parents before children.
pub fn retired_with(conn: &Connection, folder_id: i64, at: i64) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE subtree(id, depth) AS (
             SELECT ?1, 0
           UNION ALL
             SELECT f.id, s.depth + 1 FROM folder f JOIN subtree s ON f.parent_id = s.id
              WHERE f.deleted_at = ?2
         )
         SELECT s.id FROM subtree s JOIN folder f ON f.id = s.id
          WHERE f.deleted_at = ?2
          ORDER BY s.depth, s.id",
    )?;
    let ids = stmt
        .query_map(params![folder_id, at], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
}

/// Brings back the folders `retired_with` names.
pub fn restore_retired_with(conn: &Connection, folder_id: i64, at: i64) -> Result<()> {
    for id in retired_with(conn, folder_id, at)? {
        conn.execute(
            "UPDATE folder SET deleted_at = NULL WHERE id = ?1",
            params![id],
        )?;
    }
    Ok(())
}

/// The live folders directly inside one.
pub fn live_children(conn: &Connection, folder_id: i64) -> Result<Vec<i64>> {
    let mut stmt = conn
        .prepare("SELECT id FROM folder WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY id")?;
    let ids = stmt
        .query_map(params![folder_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(ids)
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
    fn every_live_folder_comes_parents_first_and_a_retired_one_not_at_all() {
        let (conn, root) = library();
        let trips = create(&conn, root, "Trips").unwrap();
        let cairo = create(&conn, trips, "Cairo").unwrap();
        let gone = create(&conn, root, "Gone").unwrap();
        retire_subtree_at(&conn, gone, 1).unwrap();

        let every = every_live(&conn).unwrap();
        let seen: Vec<(i64, Option<i64>, &str)> = every
            .iter()
            .map(|folder| (folder.id, folder.parent_id, folder.title.as_str()))
            .collect();
        assert_eq!(
            seen,
            [
                (root, None, "Library"),
                (trips, Some(root), "Trips"),
                (cairo, Some(trips), "Cairo")
            ]
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

    fn file(conn: &Connection, folder_id: i64, name: &str) -> i64 {
        crate::db::items::upsert(
            conn,
            &crate::db::items::NewItem {
                uuid: format!("uuid-{folder_id}-{name}"),
                source_id: 1,
                folder_id,
                disk_name: name.into(),
                ext: "jpg".into(),
                orig_name: name.into(),
                hash: None,
                size_bytes: 1,
                mtime: 0,
                kind: "image".into(),
                width: None,
                height: None,
                duration_ms: None,
                codec: None,
                bitrate: None,
                captured_at: None,
                captured_src: None,
            },
        )
        .unwrap()
    }

    /// Library holds a.jpg; Trips holds two and Cairo one; People holds only Ana, who holds one.
    /// One of Trips' files is in the Trash.
    fn counted() -> (Connection, [i64; 5]) {
        let (conn, root) = library();
        let trips = create(&conn, root, "Trips").unwrap();
        let cairo = create(&conn, trips, "Cairo").unwrap();
        let people = create(&conn, root, "People").unwrap();
        let ana = create(&conn, people, "Ana").unwrap();
        file(&conn, root, "a.jpg");
        file(&conn, trips, "t1.jpg");
        file(&conn, trips, "t2.jpg");
        let gone = file(&conn, trips, "gone.jpg");
        crate::db::items::send_to_trash(&conn, gone).unwrap();
        file(&conn, cairo, "c.jpg");
        file(&conn, ana, "ana.jpg");
        (conn, [root, trips, cairo, people, ana])
    }

    #[test]
    fn a_folder_counts_its_own_files_and_everything_at_or_below_it() {
        let (conn, [root, trips, cairo, people, ana]) = counted();
        let counts: Vec<_> = children(&conn, root)
            .unwrap()
            .into_iter()
            .map(|f| (f.title, f.item_count, f.all_count))
            .collect();
        assert_eq!(
            counts,
            [("People".into(), 0, 1), ("Trips".into(), 2, 3)],
            "a folder of folders counts 0 of its own; the trashed file counts nowhere"
        );
        assert_eq!(own_count(&conn, root).unwrap(), 1);
        assert_eq!(subtree_count(&conn, root).unwrap(), 5);
        assert_eq!(subtree_count(&conn, cairo).unwrap(), 1);

        let every: Vec<_> = every_live(&conn)
            .unwrap()
            .into_iter()
            .map(|f| (f.id, f.item_count, f.all_count))
            .collect();
        assert_eq!(
            every,
            [
                (root, 1, 5),
                (people, 0, 1),
                (trips, 2, 3),
                (ana, 1, 1),
                (cairo, 1, 1)
            ]
        );
    }

    #[test]
    fn a_second_root_for_one_source_is_refused() {
        let (conn, _) = library();
        assert!(create_root(&conn, 1, "Second").is_err());
    }
}
