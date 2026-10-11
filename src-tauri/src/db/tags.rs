//! Tags, labels, and what an item carries once inheritance is resolved.
//! PRODUCT.md "Tags and labels"; the rules the data keeps are in SCHEMA.md.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::{fold, now, search};
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
    search::index_folder(conn, folder_id)
}

/// Gives a folder a label, or a new value for the key it has: a folder holds one value per key,
/// and a changed one keeps its place among the folder's labels. SCHEMA.md "Tags and labels".
pub fn set_folder_label(conn: &Connection, folder_id: i64, key: &str, value: &str) -> Result<()> {
    let tag_id = get_or_create_tag(conn, Some(key), value)?;
    let held: Option<i64> = conn
        .query_row(
            "SELECT ft.rowid FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
              WHERE ft.folder_id = ?1 AND t.key = ?2",
            params![folder_id, fold(key)],
            |r| r.get(0),
        )
        .optional()?;
    match held {
        Some(rowid) => conn.execute(
            "UPDATE folder_tag SET tag_id = ?1 WHERE rowid = ?2",
            params![tag_id, rowid],
        )?,
        None => conn.execute(
            "INSERT INTO folder_tag (folder_id, tag_id, source) VALUES (?1, ?2, 'manual')",
            params![folder_id, tag_id],
        )?,
    };
    search::index_folder(conn, folder_id)?;
    rebuild_subtree(conn, folder_id)
}

/// A label's key or a value of one the library already has, with how many folders carry it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LabelOffer {
    pub text: String,
    pub folders: i64,
}

/// The keys labels already use that begin with what was typed, the most used first.
pub fn label_key_offers(conn: &Connection, typed: &str) -> Result<Vec<LabelOffer>> {
    let like = format!("{}%", search::escape_like(&fold(typed.trim())));
    label_offers(
        conn,
        "SELECT t.key, COUNT(DISTINCT ft.folder_id) AS folders
           FROM tag t JOIN folder_tag ft ON ft.tag_id = t.id
          WHERE t.key LIKE ?1 ESCAPE '\\'
          GROUP BY t.key ORDER BY folders DESC, t.key LIMIT ?2",
        params![like, OFFERS],
    )
}

/// The values one key already has elsewhere that begin with what was typed.
pub fn label_value_offers(conn: &Connection, key: &str, typed: &str) -> Result<Vec<LabelOffer>> {
    let like = format!("{}%", search::escape_like(&fold(typed.trim())));
    label_offers(
        conn,
        "SELECT t.value, COUNT(DISTINCT ft.folder_id) AS folders
           FROM tag t JOIN folder_tag ft ON ft.tag_id = t.id
          WHERE t.key = ?1 AND t.value LIKE ?2 ESCAPE '\\'
          GROUP BY t.id ORDER BY folders DESC, t.value LIMIT ?3",
        params![fold(key.trim()), like, OFFERS],
    )
}

fn label_offers(
    conn: &Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> Result<Vec<LabelOffer>> {
    let mut stmt = conn.prepare(sql)?;
    Ok(stmt
        .query_map(params, |r| {
            Ok(LabelOffer {
                text: r.get(0)?,
                folders: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?)
}

pub fn add_folder_tag(conn: &Connection, folder_id: i64, value: &str) -> Result<()> {
    let tag_id = get_or_create_tag(conn, None, value)?;
    conn.execute(
        "INSERT OR IGNORE INTO folder_tag (folder_id, tag_id, source) VALUES (?1, ?2, 'manual')",
        params![folder_id, tag_id],
    )?;
    search::index_folder(conn, folder_id)?;
    rebuild_subtree(conn, folder_id)
}

/// Takes a tag or a label off a folder. Its name is not one it can lose: only a rename changes it.
pub fn remove_folder_tag(conn: &Connection, folder_id: i64, tag_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM folder_tag WHERE folder_id = ?1 AND tag_id = ?2 AND source <> 'title'",
        params![folder_id, tag_id],
    )?;
    search::index_folder(conn, folder_id)?;
    rebuild_subtree(conn, folder_id)
}

/// The most offers a field lists under itself, before the row that adds what was typed.
pub const OFFERS: i64 = 7;

/// A tag the library already has, offered while one is typed, with how many files carry it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TagOffer {
    pub value: String,
    pub files: i64,
}

/// The tags whose value begins with what was typed, the most carried first. A term nothing
/// carries any more, on no folder and no file, is not offered.
pub fn tag_offers(conn: &Connection, typed: &str) -> Result<Vec<TagOffer>> {
    let like = format!("{}%", search::escape_like(&fold(typed.trim())));
    let mut stmt = conn.prepare(
        "SELECT t.value,
                (SELECT COUNT(*) FROM item_effective_tag e JOIN item i ON i.id = e.item_id
                  WHERE e.tag_id = t.id AND i.deleted_at IS NULL) AS files
           FROM tag t
          WHERE t.key IS NULL AND t.value LIKE ?1 ESCAPE '\\'
            AND (EXISTS (SELECT 1 FROM folder_tag ft WHERE ft.tag_id = t.id)
                 OR EXISTS (SELECT 1 FROM item_tag it WHERE it.tag_id = t.id))
          ORDER BY files DESC, t.value
          LIMIT ?2",
    )?;
    Ok(stmt
        .query_map(params![like, OFFERS], |r| {
            Ok(TagOffer {
                value: r.get(0)?,
                files: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?)
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
    search::index_item(conn, item_id)
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
    fn offers_begin_with_what_was_typed_the_most_carried_first() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        item(&conn, cairo, "a.jpg");
        item(&conn, cairo, "b.jpg");
        let lone = item(&conn, trips, "c.jpg");
        add_folder_tag(&conn, cairo, "Felucca").unwrap();
        add_item_tag(&conn, lone, "fennel").unwrap();
        get_or_create_tag(&conn, None, "fell").unwrap();

        let offered = tag_offers(&conn, " Fe").unwrap();
        assert_eq!(
            offered,
            [
                TagOffer {
                    value: "felucca".into(),
                    files: 2
                },
                TagOffer {
                    value: "fennel".into(),
                    files: 1
                },
            ],
            "a term nothing carries is not offered"
        );
        assert_eq!(
            tag_offers(&conn, "f_").unwrap(),
            [],
            "the typed text is literal"
        );
    }

    #[test]
    fn a_folder_holds_one_value_per_key_and_a_changed_one_keeps_its_place() {
        let (conn, root) = library();
        let cairo = folders::create(&conn, root, "Cairo").unwrap();
        let id = item(&conn, cairo, "a.jpg");
        set_folder_label(&conn, cairo, "Location", "Giza").unwrap();
        set_folder_label(&conn, cairo, "Season", "Winter").unwrap();
        set_folder_label(&conn, cairo, "location", "Cairo").unwrap();

        let labels: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT t.key, t.value FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                      WHERE ft.folder_id = ?1 AND t.key IS NOT NULL ORDER BY ft.rowid",
                )
                .unwrap();
            stmt.query_map(params![cairo], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert_eq!(
            labels,
            [
                ("location".into(), "cairo".into()),
                ("season".into(), "winter".into())
            ]
        );
        let carried = item_effective_tags(&conn, id).unwrap();
        assert!(
            !carried.iter().any(|t| t.value == "giza"),
            "the old value went from below"
        );
    }

    #[test]
    fn label_offers_count_the_folders_that_use_them() {
        let (conn, root) = library();
        let a = folders::create(&conn, root, "A").unwrap();
        let b = folders::create(&conn, root, "B").unwrap();
        set_folder_label(&conn, a, "Season", "Winter").unwrap();
        set_folder_label(&conn, b, "Season", "Winter").unwrap();
        set_folder_label(&conn, b, "Seat", "Window").unwrap();

        assert_eq!(
            label_key_offers(&conn, "Sea").unwrap(),
            [
                LabelOffer {
                    text: "season".into(),
                    folders: 2
                },
                LabelOffer {
                    text: "seat".into(),
                    folders: 1
                },
            ]
        );
        assert_eq!(
            label_value_offers(&conn, "Season", "wi").unwrap(),
            [LabelOffer {
                text: "winter".into(),
                folders: 2
            }]
        );
    }

    #[test]
    fn a_folder_cannot_lose_its_name() {
        let (conn, root) = library();
        let cairo = folders::create(&conn, root, "Cairo").unwrap();
        let name = get_or_create_tag(&conn, None, "Cairo").unwrap();
        remove_folder_tag(&conn, cairo, name).unwrap();
        let kept: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM folder_tag WHERE folder_id = ?1 AND tag_id = ?2",
                params![cairo, name],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(kept, 1);
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
