//! Tags, labels, and what an item carries once inheritance is resolved.
//! PRODUCT.md "Tags and labels"; the rules the data keeps are in SCHEMA.md.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::{fold, now};
use crate::error::Result;

pub fn get_or_create_tag(conn: &Connection, key: Option<&str>, value: &str) -> Result<i64> {
    let key = key.map(fold);
    let value = fold(value);
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM tag WHERE key IS ?1 AND value = ?2",
            params![key, value],
            |r| r.get(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO tag (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Keeps the tag a folder derives from its own title in step with that title.
/// The caller rebuilds the subtree afterwards when items already exist.
pub fn sync_title_tag(conn: &Connection, folder_id: i64, title: &str) -> Result<()> {
    let tag_id = get_or_create_tag(conn, None, title)?;
    let current: Option<i64> = conn
        .query_row(
            "SELECT tag_id FROM folder_tag WHERE folder_id = ?1 AND source = 'title'",
            params![folder_id],
            |r| r.get(0),
        )
        .optional()?;
    if current == Some(tag_id) {
        return Ok(());
    }
    conn.execute(
        "DELETE FROM folder_tag WHERE folder_id = ?1 AND source = 'title'",
        params![folder_id],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO folder_tag (folder_id, tag_id, source) VALUES (?1, ?2, 'title')",
        params![folder_id, tag_id],
    )?;
    Ok(())
}

pub fn set_folder_label(conn: &Connection, folder_id: i64, key: &str, value: &str) -> Result<()> {
    let tag_id = get_or_create_tag(conn, Some(key), value)?;
    conn.execute(
        "INSERT OR IGNORE INTO folder_tag (folder_id, tag_id, source) VALUES (?1, ?2, 'manual')",
        params![folder_id, tag_id],
    )?;
    rebuild_subtree(conn, folder_id)
}

pub fn add_folder_tag(conn: &Connection, folder_id: i64, value: &str) -> Result<()> {
    let tag_id = get_or_create_tag(conn, None, value)?;
    conn.execute(
        "INSERT OR IGNORE INTO folder_tag (folder_id, tag_id, source) VALUES (?1, ?2, 'manual')",
        params![folder_id, tag_id],
    )?;
    rebuild_subtree(conn, folder_id)
}

pub fn remove_folder_tag(conn: &Connection, folder_id: i64, tag_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM folder_tag WHERE folder_id = ?1 AND tag_id = ?2",
        params![folder_id, tag_id],
    )?;
    rebuild_subtree(conn, folder_id)
}

/// An item takes tags, never labels — a label describes a folder, and an item
/// inherits it from one. The signature is where that rule is kept.
pub fn add_item_tag(conn: &Connection, item_id: i64, value: &str) -> Result<()> {
    let tag_id = get_or_create_tag(conn, None, value)?;
    conn.execute(
        "INSERT OR IGNORE INTO item_tag (item_id, tag_id, added_at) VALUES (?1, ?2, ?3)",
        params![item_id, tag_id, now()],
    )?;
    rebuild_item(conn, item_id)
}

pub fn remove_item_tag(conn: &Connection, item_id: i64, tag_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM item_tag WHERE item_id = ?1 AND tag_id = ?2",
        params![item_id, tag_id],
    )?;
    rebuild_item(conn, item_id)
}

/// Every tag on the folder and its ancestors, as `(tag_id, the folder it came
/// from)`, nearest first.
pub fn ancestor_tags(conn: &Connection, folder_id: i64) -> Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE ancestry(id, depth) AS (
             SELECT ?1, 0
           UNION ALL
             SELECT f.parent_id, a.depth + 1
               FROM folder f JOIN ancestry a ON f.id = a.id
              WHERE f.parent_id IS NOT NULL
         )
         SELECT ft.tag_id, ft.folder_id
           FROM folder_tag ft JOIN ancestry a ON a.id = ft.folder_id
          ORDER BY a.depth",
    )?;
    Ok(stmt
        .query_map(params![folder_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Recomputes what one item carries: its ancestry's tags, then its own.
pub fn rebuild_item(conn: &Connection, item_id: i64) -> Result<()> {
    let folder_id: i64 = conn.query_row(
        "SELECT folder_id FROM item WHERE id = ?1",
        params![item_id],
        |r| r.get(0),
    )?;

    conn.execute(
        "DELETE FROM item_effective_tag WHERE item_id = ?1",
        params![item_id],
    )?;
    for (tag_id, origin_id) in ancestor_tags(conn, folder_id)? {
        conn.execute(
            "INSERT OR IGNORE INTO item_effective_tag (item_id, tag_id, origin_id)
             VALUES (?1, ?2, ?3)",
            params![item_id, tag_id, origin_id],
        )?;
    }
    conn.execute(
        "INSERT OR IGNORE INTO item_effective_tag (item_id, tag_id, origin_id)
           SELECT ?1, tag_id, NULL FROM item_tag WHERE item_id = ?1",
        params![item_id],
    )?;
    Ok(())
}

/// Recomputes every live item at or below a folder — what a folder's tags
/// changing means for the items under it.
pub fn rebuild_subtree(conn: &Connection, folder_id: i64) -> Result<()> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE subtree(id) AS (
             SELECT ?1
           UNION ALL
             SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
         )
         SELECT i.id FROM item i JOIN subtree s ON i.folder_id = s.id
          WHERE i.deleted_at IS NULL",
    )?;
    let ids: Vec<i64> = stmt
        .query_map(params![folder_id], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    for id in ids {
        rebuild_item(conn, id)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EffectiveTag {
    pub tag_id: i64,
    pub key: Option<String>,
    pub value: String,
    /// The folder it came from, or `None` when the item carries it itself.
    pub origin_id: Option<i64>,
    pub origin_title: Option<String>,
}

/// What an item carries, and where each part came from — a result can say it
/// matched the label `Location: Cairo` rather than only that it matched.
pub fn item_effective_tags(conn: &Connection, item_id: i64) -> Result<Vec<EffectiveTag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.key, t.value, e.origin_id, f.title
           FROM item_effective_tag e
           JOIN tag t ON t.id = e.tag_id
           LEFT JOIN folder f ON f.id = e.origin_id
          WHERE e.item_id = ?1
          ORDER BY t.key IS NULL DESC, t.key, t.value",
    )?;
    Ok(stmt
        .query_map(params![item_id], |r| {
            Ok(EffectiveTag {
                tag_id: r.get(0)?,
                key: r.get(1)?,
                value: r.get(2)?,
                origin_id: r.get(3)?,
                origin_title: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::{self, NewItem};
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, folders};
    use std::path::Path;

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

    fn item(conn: &Connection, folder_id: i64, name: &str) -> i64 {
        let id = items::upsert(
            conn,
            &NewItem {
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
        .unwrap();
        rebuild_item(conn, id).unwrap();
        id
    }

    #[test]
    fn one_term_whatever_case_it_arrives_in() {
        let (conn, _) = library();
        let first = get_or_create_tag(&conn, None, "Beach").unwrap();
        let again = get_or_create_tag(&conn, None, "beach").unwrap();
        assert_eq!(first, again);
    }

    #[test]
    fn a_key_and_a_value_are_a_different_term_from_the_value_alone() {
        let (conn, _) = library();
        let label = get_or_create_tag(&conn, Some("Location"), "Cairo").unwrap();
        let tag = get_or_create_tag(&conn, None, "Cairo").unwrap();
        assert_ne!(label, tag);
    }

    #[test]
    fn an_item_inherits_from_every_folder_above_it_and_remembers_which() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        let id = item(&conn, cairo, "a.jpg");

        set_folder_label(&conn, trips, "Location", "Egypt").unwrap();
        add_folder_tag(&conn, cairo, "Film").unwrap();
        add_item_tag(&conn, id, "Favourite").unwrap();

        let carried = item_effective_tags(&conn, id).unwrap();
        let label = carried.iter().find(|t| t.key.is_some()).unwrap();
        assert_eq!(
            (label.key.as_deref(), label.value.as_str()),
            (Some("location"), "egypt")
        );
        assert_eq!(
            label.origin_title.as_deref(),
            Some("Trips"),
            "the folder it came from"
        );

        let own = carried.iter().find(|t| t.value == "favourite").unwrap();
        assert!(own.origin_id.is_none(), "the item carries this one itself");

        let inherited = carried.iter().find(|t| t.value == "film").unwrap();
        assert_eq!(inherited.origin_id, Some(cairo));
    }

    #[test]
    fn a_folders_title_becomes_a_tag_its_items_inherit() {
        let (conn, root) = library();
        let cairo = folders::create(&conn, root, "Cairo").unwrap();
        let id = item(&conn, cairo, "a.jpg");

        let carried = item_effective_tags(&conn, id).unwrap();
        assert!(
            carried
                .iter()
                .any(|t| t.value == "cairo" && t.origin_id == Some(cairo)),
            "the title tag is folded and inherited: {carried:?}"
        );
    }

    #[test]
    fn tagging_a_folder_reaches_items_already_beneath_it() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let deep = folders::create(&conn, trips, "2024").unwrap();
        let id = item(&conn, deep, "a.jpg");

        add_folder_tag(&conn, trips, "Holiday").unwrap();
        assert!(
            item_effective_tags(&conn, id)
                .unwrap()
                .iter()
                .any(|t| t.value == "holiday")
        );

        let tag_id = get_or_create_tag(&conn, None, "Holiday").unwrap();
        remove_folder_tag(&conn, trips, tag_id).unwrap();
        assert!(
            !item_effective_tags(&conn, id)
                .unwrap()
                .iter()
                .any(|t| t.value == "holiday")
        );
    }
}
