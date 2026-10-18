//! Tags, labels, and what an item carries once inheritance is resolved.
//! PRODUCT.md "Tags and labels"; the rules the data keeps are in SCHEMA.md.

use std::collections::{BTreeSet, HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::folders::{self, Crumb};
use crate::db::journal::{self, ItemsTagged, ItemsUntagged, Untagged};
use crate::db::{fold, in_transaction, now, search};
use crate::error::{AppError, Result};

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
/// and a changed one keeps its place among the folder's labels. A key it does not have yet is
/// refused while a folder above or below holds it. SCHEMA.md "Tags and labels".
pub fn set_folder_label(conn: &Connection, folder_id: i64, key: &str, value: &str) -> Result<()> {
    let key = fold(key);
    let held: Option<i64> = conn
        .query_row(
            "SELECT ft.rowid FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
              WHERE ft.folder_id = ?1 AND t.key = ?2",
            params![folder_id, key],
            |r| r.get(0),
        )
        .optional()?;
    if held.is_none() {
        refuse_key_held_elsewhere(conn, folder_id, &key)?;
    }
    let tag_id = get_or_create_tag(conn, Some(&key), value)?;
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

/// A folder may not take a key one above it gives it, nor one a folder below it already holds.
/// DECISIONS.md "A folder's details".
fn refuse_key_held_elsewhere(conn: &Connection, folder_id: i64, key: &str) -> Result<()> {
    if let Some(above) = holding_above(conn, folder_id, key)? {
        let from = folders::ancestry(conn, folder_id)?
            .into_iter()
            .find(|crumb| crumb.id == above)
            .map(|crumb| crumb.title)
            .unwrap_or_default();
        return Err(AppError::invalid(format!("{key} comes from {from}")));
    }
    if let Some(below) = holding_below(conn, folder_id, Some(key))?
        .into_iter()
        .next()
    {
        return Err(AppError::invalid(format!(
            "{} below already holds {key}",
            below.folder.title
        )));
    }
    Ok(())
}

/// The nearest folder above one that holds a label of the key.
pub(crate) fn holding_above(conn: &Connection, folder_id: i64, key: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "WITH RECURSIVE above(id, depth) AS (
                 SELECT parent_id, 1 FROM folder WHERE id = ?1 AND parent_id IS NOT NULL
               UNION ALL
                 SELECT f.parent_id, a.depth + 1 FROM folder f JOIN above a ON f.id = a.id
                  WHERE f.parent_id IS NOT NULL
             )
             SELECT a.id FROM above a
               JOIN folder_tag ft ON ft.folder_id = a.id
               JOIN tag t ON t.id = ft.tag_id
              WHERE t.key = ?2
              ORDER BY a.depth LIMIT 1",
            params![folder_id, key],
            |r| r.get(0),
        )
        .optional()?)
}

/// A label's key a folder below holds, and the nearest folder that holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct KeyBelow {
    pub key: String,
    pub folder: Crumb,
}

/// Each key the live folders below one hold, once, with the nearest holding it; of two as near,
/// the first by name.
pub fn keys_below(conn: &Connection, folder_id: i64) -> Result<Vec<KeyBelow>> {
    let mut keys = HashSet::new();
    Ok(holding_below(conn, folder_id, None)?
        .into_iter()
        .filter(|one| keys.insert(one.key.clone()))
        .collect())
}

/// Every label the live folders below one hold, of one key or of all, the nearest first.
pub(crate) fn holding_below(
    conn: &Connection,
    folder_id: i64,
    key: Option<&str>,
) -> Result<Vec<KeyBelow>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE below(id, title, depth) AS (
             SELECT id, title, 1 FROM folder WHERE parent_id = ?1 AND deleted_at IS NULL
           UNION ALL
             SELECT f.id, f.title, b.depth + 1 FROM folder f JOIN below b ON f.parent_id = b.id
              WHERE f.deleted_at IS NULL
         )
         SELECT t.key, b.id, b.title FROM below b
           JOIN folder_tag ft ON ft.folder_id = b.id
           JOIN tag t ON t.id = ft.tag_id
          WHERE t.key IS NOT NULL AND (?2 IS NULL OR t.key = ?2)
          ORDER BY b.depth, b.title COLLATE NOCASE, b.id",
    )?;
    let rows = stmt
        .query_map(params![folder_id, key], |r| {
            Ok(KeyBelow {
                key: r.get(0)?,
                folder: Crumb {
                    id: r.get(1)?,
                    title: r.get(2)?,
                },
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
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
/// from)`, nearest first. A label whose key a nearer folder holds is left out:
/// the nearest value of a key is the one that reaches below. DECISIONS.md "A folder's details".
pub fn ancestor_tags(conn: &Connection, folder_id: i64) -> Result<Vec<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE ancestry(id, depth) AS (
             SELECT ?1, 0
           UNION ALL
             SELECT f.parent_id, a.depth + 1
               FROM folder f JOIN ancestry a ON f.id = a.id
              WHERE f.parent_id IS NOT NULL
         )
         SELECT ft.tag_id, ft.folder_id, t.key
           FROM folder_tag ft
           JOIN ancestry a ON a.id = ft.folder_id
           JOIN tag t ON t.id = ft.tag_id
          ORDER BY a.depth",
    )?;
    let rows = stmt
        .query_map(params![folder_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get::<_, Option<String>>(2)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut keys = HashSet::new();
    Ok(rows
        .into_iter()
        .filter(|(_, _, key)| key.as_ref().is_none_or(|key| keys.insert(key.clone())))
        .map(|(tag_id, origin, _)| (tag_id, origin))
        .collect())
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

/// A tag or a label something carries: its own, or one a folder above it holds, which says whose.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EffectiveTag {
    pub tag_id: i64,
    pub key: Option<String>,
    pub value: String,
    /// The folder above that carries it, or `None` when it is its own.
    pub from: Option<Crumb>,
    /// A folder's name, which only renaming that folder changes.
    pub name: bool,
}

/// What an item carries and where each part came from: its own in the order they were added, then
/// each folder's from the source down, that folder's name first. DECISIONS.md "A folder's details".
pub fn item_effective_tags(conn: &Connection, item_id: i64) -> Result<Vec<EffectiveTag>> {
    let mut own = conn.prepare(
        "SELECT t.id, t.key, t.value FROM item_effective_tag e
           JOIN tag t ON t.id = e.tag_id
           JOIN item_tag it ON it.item_id = e.item_id AND it.tag_id = e.tag_id
          WHERE e.item_id = ?1 AND e.origin_id IS NULL
          ORDER BY it.added_at, it.rowid",
    )?;
    let mut carried = own
        .query_map(params![item_id], |r| {
            Ok(EffectiveTag {
                tag_id: r.get(0)?,
                key: r.get(1)?,
                value: r.get(2)?,
                from: None,
                name: false,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let folder_id: Option<i64> = conn
        .query_row(
            "SELECT folder_id FROM item WHERE id = ?1",
            params![item_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(folder_id) = folder_id else {
        return Ok(carried);
    };
    let mut held = conn.prepare(
        "SELECT t.id, t.key, t.value, ft.source = 'title' FROM item_effective_tag e
           JOIN tag t ON t.id = e.tag_id
           JOIN folder_tag ft ON ft.folder_id = e.origin_id AND ft.tag_id = e.tag_id
          WHERE e.item_id = ?1 AND e.origin_id = ?2
          ORDER BY ft.source = 'title' DESC, ft.rowid",
    )?;
    for crumb in folders::ancestry(conn, folder_id)? {
        let level = held
            .query_map(params![item_id, crumb.id], |r| {
                Ok(EffectiveTag {
                    tag_id: r.get(0)?,
                    key: r.get(1)?,
                    value: r.get(2)?,
                    from: Some(crumb.clone()),
                    name: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        carried.extend(level);
    }
    Ok(carried)
}

/// One tag or label across a set of files: on how many of them, and whether it is a folder's name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Covered {
    pub tag_id: i64,
    pub key: Option<String>,
    pub value: String,
    pub name: bool,
    pub files: i64,
}

/// What one folder gives some of a set, and how many of the set are below it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderCovers {
    pub folder: Crumb,
    pub under: i64,
    /// Its name first, then its tags, then its labels, each in the order the folder took them.
    pub tags: Vec<Covered>,
}

/// What a set of files carries: the files found, the tags they hold themselves, the most carried
/// first, then each folder's, in path order from the source down. Artboards › Tagging a set.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Coverage {
    pub files: i64,
    pub own: Vec<Covered>,
    pub folders: Vec<FolderCovers>,
}

/// One grouped read of `item_effective_tag` for the whole set, however many files are in it.
pub fn selection_tag_coverage(conn: &Connection, item_ids: &[i64]) -> Result<Coverage> {
    let ids = serde_json::to_string(item_ids)?;
    let files: i64 = conn.query_row(
        "SELECT COUNT(*) FROM item WHERE id IN (SELECT value FROM json_each(?1))",
        params![ids],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "SELECT e.tag_id, t.key, t.value, e.origin_id, COALESCE(MAX(ft.source = 'title'), 0),
                MIN(ft.rowid), COUNT(*)
           FROM item_effective_tag e
           JOIN tag t ON t.id = e.tag_id
           LEFT JOIN folder_tag ft ON ft.folder_id = e.origin_id AND ft.tag_id = e.tag_id
          WHERE e.item_id IN (SELECT value FROM json_each(?1))
          GROUP BY e.tag_id, e.origin_id",
    )?;
    let rows = stmt
        .query_map(params![ids], |r| {
            Ok((
                Covered {
                    tag_id: r.get(0)?,
                    key: r.get(1)?,
                    value: r.get(2)?,
                    name: r.get(4)?,
                    files: r.get(6)?,
                },
                r.get::<_, Option<i64>>(3)?,
                r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut own = Vec::new();
    let mut given: HashMap<i64, Vec<(Covered, i64)>> = HashMap::new();
    for (covered, origin, held_at) in rows {
        match origin {
            None => own.push(covered),
            Some(folder) => given.entry(folder).or_default().push((covered, held_at)),
        }
    }
    own.sort_by(|a, b| b.files.cmp(&a.files).then_with(|| a.value.cmp(&b.value)));

    let under = under_counts(conn, &ids)?;
    let mut folders = Vec::new();
    for (folder_id, mut tags) in given {
        tags.sort_by_key(|(tag, held_at)| (!tag.name, tag.key.is_some(), *held_at));
        let path = folders::ancestry(conn, folder_id)?;
        let Some(folder) = path.last().cloned() else {
            continue;
        };
        let titles: Vec<String> = path
            .iter()
            .map(|crumb| crumb.title.to_lowercase())
            .collect();
        folders.push((
            titles,
            FolderCovers {
                folder,
                under: under.get(&folder_id).copied().unwrap_or(0),
                tags: tags.into_iter().map(|(tag, _)| tag).collect(),
            },
        ));
    }
    folders.sort_by(|(a, one), (b, two)| a.cmp(b).then(one.folder.id.cmp(&two.folder.id)));
    Ok(Coverage {
        files,
        own,
        folders: folders.into_iter().map(|(_, covers)| covers).collect(),
    })
}

/// How many of the set lie at or below each folder above any of them.
fn under_counts(conn: &Connection, ids: &str) -> Result<HashMap<i64, i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE
           start(folder_id, n) AS (
             SELECT folder_id, COUNT(*) FROM item
              WHERE id IN (SELECT value FROM json_each(?1)) GROUP BY folder_id
           ),
           up(folder_id, n) AS (
             SELECT folder_id, n FROM start
           UNION ALL
             SELECT f.parent_id, up.n FROM up JOIN folder f ON f.id = up.folder_id
              WHERE f.parent_id IS NOT NULL
           )
         SELECT folder_id, SUM(n) FROM up GROUP BY folder_id",
    )?;
    Ok(stmt
        .query_map(params![ids], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Gives a tag to every file in the set that does not carry it yet, its own or from a folder, and
/// journals exactly those as one batch. Returns how many took it. DECISIONS.md "Undo".
pub fn add_items_tag(
    conn: &Connection,
    item_ids: &[i64],
    value: &str,
    batch_id: &str,
) -> Result<usize> {
    if fold(value).is_empty() {
        return Err(AppError::invalid("a tag needs a word"));
    }
    let tag_id = get_or_create_tag(conn, None, value)?;
    let ids = serde_json::to_string(item_ids)?;
    let lacking: Vec<i64> = {
        let mut stmt = conn.prepare(
            "SELECT i.id FROM item i
              WHERE i.id IN (SELECT value FROM json_each(?1))
                AND NOT EXISTS (SELECT 1 FROM item_effective_tag e
                                 WHERE e.item_id = i.id AND e.tag_id = ?2)
              ORDER BY i.id",
        )?;
        stmt.query_map(params![ids, tag_id], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?
    };
    if lacking.is_empty() {
        return Ok(0);
    }
    let at = now();
    let given: Vec<(i64, i64)> = lacking.iter().map(|&item_id| (item_id, at)).collect();
    give(conn, tag_id, &given)?;
    journal::record_items_tag(
        conn,
        batch_id,
        &ItemsTagged {
            tag_id,
            value: value_of(conn, tag_id)?,
            item_ids: lacking.clone(),
        },
    )?;
    Ok(lacking.len())
}

/// Takes a tag off every file in the set that holds it as its own, never one it inherits, and
/// journals exactly those, with when each had it, as one batch. Returns how many lost it.
pub fn remove_items_tag(
    conn: &Connection,
    item_ids: &[i64],
    tag_id: i64,
    batch_id: &str,
) -> Result<usize> {
    let ids = serde_json::to_string(item_ids)?;
    let items: Vec<Untagged> = {
        let mut stmt = conn.prepare(
            "SELECT it.item_id, it.added_at FROM item_tag it
               JOIN item_effective_tag e ON e.item_id = it.item_id AND e.tag_id = it.tag_id
              WHERE it.tag_id = ?2 AND e.origin_id IS NULL
                AND it.item_id IN (SELECT value FROM json_each(?1))
              ORDER BY it.item_id",
        )?;
        stmt.query_map(params![ids, tag_id], |r| {
            Ok(Untagged {
                item_id: r.get(0)?,
                added_at: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?
    };
    if items.is_empty() {
        return Ok(0);
    }
    let taken: Vec<i64> = items.iter().map(|one| one.item_id).collect();
    untag_items(conn, tag_id, &taken)?;
    journal::record_items_untag(
        conn,
        batch_id,
        &ItemsUntagged {
            tag_id,
            value: value_of(conn, tag_id)?,
            items,
        },
    )?;
    Ok(taken.len())
}

fn value_of(conn: &Connection, tag_id: i64) -> Result<String> {
    Ok(conn.query_row(
        "SELECT value FROM tag WHERE id = ?1",
        params![tag_id],
        |r| r.get(0),
    )?)
}

/// Takes a tag the files hold themselves off them, leaving whatever a folder gives them. Writes
/// no journal row: it is what undoing a bulk add applies.
pub fn untag_items(conn: &Connection, tag_id: i64, item_ids: &[i64]) -> Result<()> {
    let ids = serde_json::to_string(item_ids)?;
    atomically(conn, || {
        conn.execute(
            "DELETE FROM item_tag
              WHERE tag_id = ?2 AND item_id IN (SELECT value FROM json_each(?1))",
            params![ids, tag_id],
        )?;
        conn.execute(
            "DELETE FROM item_effective_tag
              WHERE tag_id = ?2 AND origin_id IS NULL
                AND item_id IN (SELECT value FROM json_each(?1))",
            params![ids, tag_id],
        )?;
        search::index_items(conn, item_ids)
    })
}

/// Gives a tag back to exactly the files a bulk remove took it off, each with when it first had
/// it. Writes no journal row: it is what undoing that remove applies.
pub fn retag_items(conn: &Connection, untagged: &ItemsUntagged) -> Result<()> {
    let still: Option<i64> = conn
        .query_row(
            "SELECT id FROM tag WHERE id = ?1 AND key IS NULL",
            params![untagged.tag_id],
            |r| r.get(0),
        )
        .optional()?;
    let tag_id = match still {
        Some(id) => id,
        None => get_or_create_tag(conn, None, &untagged.value)?,
    };
    let items: Vec<(i64, i64)> = untagged
        .items
        .iter()
        .map(|one| (one.item_id, one.added_at))
        .collect();
    atomically(conn, || give(conn, tag_id, &items))
}

/// Gives each file the tag as its own; where a folder already gives it, the folder's stays the
/// one it carries, as `rebuild_item` resolves it.
fn give(conn: &Connection, tag_id: i64, items: &[(i64, i64)]) -> Result<()> {
    let pairs = serde_json::to_string(items)?;
    conn.execute(
        "INSERT OR IGNORE INTO item_tag (item_id, tag_id, added_at)
         SELECT i.id, ?2, j.value ->> 1 FROM json_each(?1) j JOIN item i ON i.id = j.value ->> 0",
        params![pairs, tag_id],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO item_effective_tag (item_id, tag_id, origin_id)
         SELECT i.id, ?2, NULL FROM json_each(?1) j JOIN item i ON i.id = j.value ->> 0",
        params![pairs, tag_id],
    )?;
    let ids: Vec<i64> = items.iter().map(|(item_id, _)| *item_id).collect();
    search::index_items(conn, &ids)
}

/// Runs `work` whole or not at all, inside a transaction already open or on its own.
pub(crate) fn atomically(conn: &Connection, work: impl FnOnce() -> Result<()>) -> Result<()> {
    if conn.is_autocommit() {
        return in_transaction(conn, |_| work());
    }
    conn.execute_batch("SAVEPOINT tags")?;
    match work() {
        Ok(()) => Ok(conn.execute_batch("RELEASE tags")?),
        Err(err) => {
            conn.execute_batch("ROLLBACK TO tags; RELEASE tags")?;
            Err(err)
        }
    }
}

/// Folds every stored term again with `db::fold`, merges terms that then read the same into the
/// oldest, and rebuilds whatever carried one. A data migration. SCHEMA.md "Migrations".
pub fn refold(conn: &Connection) -> Result<()> {
    let terms: Vec<(i64, Option<String>, String)> = {
        let mut stmt = conn.prepare("SELECT id, key, value FROM tag ORDER BY id")?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    let mut kept: HashMap<(Option<String>, String), i64> = HashMap::new();
    let mut refolded = Vec::new();
    let mut touched = BTreeSet::new();
    for (id, key, value) in terms {
        let folded = (key.as_deref().map(fold), fold(&value));
        if let Some(&into) = kept.get(&folded) {
            merge_term(conn, id, into)?;
            touched.insert(into);
        } else {
            if folded != (key, value) {
                refolded.push((id, folded.clone()));
                touched.insert(id);
            }
            kept.insert(folded, id);
        }
    }
    for (id, (key, value)) in refolded {
        conn.execute(
            "UPDATE tag SET key = ?1, value = ?2 WHERE id = ?3",
            params![key, value, id],
        )?;
    }

    let mut folders = BTreeSet::new();
    let mut items = BTreeSet::new();
    for tag_id in touched {
        folders.extend(ids(
            conn,
            "SELECT folder_id FROM folder_tag WHERE tag_id = ?1",
            tag_id,
        )?);
        items.extend(ids(
            conn,
            "SELECT item_id FROM item_effective_tag WHERE tag_id = ?1
             UNION SELECT item_id FROM item_tag WHERE tag_id = ?1",
            tag_id,
        )?);
    }
    conn.execute(
        "DELETE FROM folder_tag WHERE rowid IN (
           SELECT ft.rowid FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
            WHERE t.key IS NOT NULL AND EXISTS (
              SELECT 1 FROM folder_tag held JOIN tag h ON h.id = held.tag_id
               WHERE held.folder_id = ft.folder_id AND h.key = t.key AND held.rowid < ft.rowid))",
        [],
    )?;
    for folder_id in folders {
        search::index_folder(conn, folder_id)?;
    }
    for item_id in items {
        rebuild_item(conn, item_id)?;
    }
    Ok(())
}

/// Moves everything that carries one term onto another, then drops the first. A folder's name
/// stays its name whichever of the two it was.
pub(crate) fn merge_term(conn: &Connection, from: i64, into: i64) -> Result<()> {
    conn.execute(
        "UPDATE folder_tag SET source = 'title'
          WHERE tag_id = ?2 AND folder_id IN
                (SELECT folder_id FROM folder_tag WHERE tag_id = ?1 AND source = 'title')",
        params![from, into],
    )?;
    for table in ["folder_tag", "item_tag", "item_effective_tag"] {
        conn.execute(
            &format!("UPDATE OR IGNORE {table} SET tag_id = ?2 WHERE tag_id = ?1"),
            params![from, into],
        )?;
        conn.execute(
            &format!("DELETE FROM {table} WHERE tag_id = ?1"),
            params![from],
        )?;
    }
    conn.execute("DELETE FROM tag WHERE id = ?1", params![from])?;
    Ok(())
}

fn ids(conn: &Connection, sql: &str, tag_id: i64) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(sql)?;
    Ok(stmt
        .query_map(params![tag_id], |r| r.get(0))?
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
            label.from.as_ref().map(|from| from.title.as_str()),
            Some("Trips"),
            "the folder it came from"
        );

        let own = carried.iter().find(|t| t.value == "favourite").unwrap();
        assert!(own.from.is_none(), "the item carries this one itself");

        let inherited = carried.iter().find(|t| t.value == "film").unwrap();
        assert_eq!(inherited.from.as_ref().map(|from| from.id), Some(cairo));
    }

    #[test]
    fn a_folders_title_becomes_a_tag_its_items_inherit() {
        let (conn, root) = library();
        let cairo = folders::create(&conn, root, "Cairo").unwrap();
        let id = item(&conn, cairo, "a.jpg");

        let carried = item_effective_tags(&conn, id).unwrap();
        assert!(
            carried.iter().any(|t| t.value == "cairo"
                && t.name
                && t.from.as_ref().map(|from| from.id) == Some(cairo)),
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

        assert_eq!(
            labels_of(&conn, cairo),
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

    fn labels_of(conn: &Connection, folder_id: i64) -> Vec<(String, String)> {
        let mut stmt = conn
            .prepare(
                "SELECT t.key, t.value FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                  WHERE ft.folder_id = ?1 AND t.key IS NOT NULL ORDER BY ft.rowid",
            )
            .unwrap();
        stmt.query_map(params![folder_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn a_key_is_refused_while_a_folder_above_or_below_holds_it_whichever_came_first() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        let giza = folders::create(&conn, cairo, "Giza").unwrap();
        let sphinx = item(&conn, giza, "sphinx.jpg");
        set_folder_label(&conn, giza, "Location", "Giza").unwrap();

        let refused = set_folder_label(&conn, trips, "location", "Egypt").unwrap_err();
        assert!(
            matches!(&refused, AppError::Invalid(line) if line.contains("Giza")),
            "names the folder below: {refused}"
        );
        assert!(set_folder_label(&conn, cairo, "LOCATION", "Cairo").is_err());
        assert_eq!(labels_of(&conn, trips), []);
        assert_eq!(labels_of(&conn, cairo), []);
        assert!(
            !carried_line(&conn, sphinx)
                .iter()
                .any(|t| t.contains("egypt")),
            "nothing below changed"
        );

        set_folder_label(&conn, giza, "Location", "Pyramids").unwrap();
        let giza_label = get_or_create_tag(&conn, Some("location"), "pyramids").unwrap();
        remove_folder_tag(&conn, giza, giza_label).unwrap();
        set_folder_label(&conn, trips, "Location", "Egypt").unwrap();
        let refused = set_folder_label(&conn, giza, "Location", "Giza").unwrap_err();
        assert!(
            matches!(&refused, AppError::Invalid(line) if line.contains("Trips")),
            "names the folder above: {refused}"
        );
        set_folder_label(&conn, trips, "Location", "Nile").unwrap();
        assert_eq!(
            labels_of(&conn, trips),
            [("location".into(), "nile".into())]
        );
    }

    #[test]
    fn a_key_held_only_in_a_trashed_folder_below_refuses_nothing() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        set_folder_label(&conn, cairo, "Location", "Cairo").unwrap();
        folders::trash_subtree(&conn, cairo).unwrap();
        set_folder_label(&conn, trips, "Location", "Egypt").unwrap();
        assert_eq!(
            labels_of(&conn, trips),
            [("location".into(), "egypt".into())]
        );
    }

    #[test]
    fn keys_below_name_the_nearest_folder_holding_each_then_the_first_by_name() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let oslo = folders::create(&conn, trips, "Oslo").unwrap();
        let cairo = folders::create(&conn, trips, "cairo").unwrap();
        let giza = folders::create(&conn, cairo, "Giza").unwrap();
        set_folder_label(&conn, giza, "Season", "Winter").unwrap();
        set_folder_label(&conn, oslo, "Location", "Oslo").unwrap();
        set_folder_label(&conn, cairo, "Location", "Cairo").unwrap();

        let below: Vec<(String, String)> = keys_below(&conn, trips)
            .unwrap()
            .into_iter()
            .map(|one| (one.key, one.folder.title))
            .collect();
        assert_eq!(
            below,
            [
                ("location".into(), "cairo".into()),
                ("season".into(), "Giza".into())
            ]
        );
        assert_eq!(keys_below(&conn, giza).unwrap(), []);
        let refused = set_folder_label(&conn, trips, "Location", "Norway").unwrap_err();
        assert!(
            matches!(&refused, AppError::Invalid(line) if line.starts_with("cairo below")),
            "names the nearest, then the first by name: {refused}"
        );
    }

    #[test]
    fn an_item_carries_one_value_per_key_the_nearest_folder_s() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, root, "Cairo").unwrap();
        let sphinx = item(&conn, cairo, "sphinx.jpg");
        let ticket = item(&conn, trips, "ticket.jpg");
        set_folder_label(&conn, cairo, "Location", "Cairo").unwrap();
        set_folder_label(&conn, trips, "Location", "Egypt").unwrap();
        folders::set_parent(&conn, cairo, trips).unwrap();
        rebuild_subtree(&conn, cairo).unwrap();

        let locations = |id| -> Vec<(String, Option<i64>)> {
            item_effective_tags(&conn, id)
                .unwrap()
                .into_iter()
                .filter(|t| t.key.as_deref() == Some("location"))
                .map(|t| (t.value, t.from.map(|from| from.id)))
                .collect()
        };
        assert_eq!(locations(sphinx), [("cairo".into(), Some(cairo))]);
        assert_eq!(locations(ticket), [("egypt".into(), Some(trips))]);

        let cairo_label = get_or_create_tag(&conn, Some("Location"), "Cairo").unwrap();
        remove_folder_tag(&conn, cairo, cairo_label).unwrap();
        assert_eq!(
            locations(sphinx),
            [("egypt".into(), Some(trips))],
            "with its own gone, the value above reaches it"
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

    fn carried_line(conn: &Connection, item_id: i64) -> Vec<String> {
        item_effective_tags(conn, item_id)
            .unwrap()
            .into_iter()
            .map(|tag| {
                let text = match &tag.key {
                    Some(key) => format!("{key}:{}", tag.value),
                    None => tag.value.clone(),
                };
                let mark = if tag.name { "#" } else { "" };
                match &tag.from {
                    Some(from) => format!("{mark}{text}<{}", from.title),
                    None => format!("{mark}{text}"),
                }
            })
            .collect()
    }

    fn found_by(conn: &Connection, query: &str) -> Vec<i64> {
        let expr = crate::query::parse(query).unwrap();
        search::items(conn, &expr, &crate::db::items::Sort::default())
            .unwrap()
            .into_iter()
            .map(|(row, _)| row.id)
            .collect()
    }

    #[test]
    fn a_file_lists_its_own_tags_as_added_then_each_folder_s_from_the_source_down() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        let sphinx = item(&conn, cairo, "sphinx.jpg");
        add_folder_tag(&conn, trips, "travel").unwrap();
        add_folder_tag(&conn, cairo, "egypt").unwrap();
        set_folder_label(&conn, cairo, "Location", "Cairo").unwrap();
        add_item_tag(&conn, sphinx, "Sphinx").unwrap();
        add_item_tag(&conn, sphinx, "dawn").unwrap();

        assert_eq!(
            carried_line(&conn, sphinx),
            [
                "sphinx",
                "dawn",
                "#library<Library",
                "#trips<Trips",
                "travel<Trips",
                "#cairo<Cairo",
                "egypt<Cairo",
                "location:cairo<Cairo",
            ]
        );
    }

    #[test]
    fn a_file_s_own_tag_comes_off_and_one_it_inherits_stays_with_its_folder() {
        let (conn, root) = library();
        let cairo = folders::create(&conn, root, "Cairo").unwrap();
        let sphinx = item(&conn, cairo, "sphinx.jpg");
        add_folder_tag(&conn, cairo, "egypt").unwrap();
        add_item_tag(&conn, sphinx, "dawn").unwrap();
        assert_eq!(found_by(&conn, "tag:dawn"), [sphinx]);

        let dawn = get_or_create_tag(&conn, None, "dawn").unwrap();
        let egypt = get_or_create_tag(&conn, None, "egypt").unwrap();
        remove_item_tag(&conn, sphinx, dawn).unwrap();
        remove_item_tag(&conn, sphinx, egypt).unwrap();
        assert_eq!(
            carried_line(&conn, sphinx),
            ["#library<Library", "#cairo<Cairo", "egypt<Cairo"]
        );
        assert!(
            found_by(&conn, "tag:dawn").is_empty(),
            "search forgets it too"
        );
        assert_eq!(found_by(&conn, "tag:egypt"), [sphinx]);
    }

    #[test]
    fn a_tag_a_file_and_its_folder_both_hold_is_listed_once_as_the_folder_s() {
        let (conn, root) = library();
        let cairo = folders::create(&conn, root, "Cairo").unwrap();
        let sphinx = item(&conn, cairo, "sphinx.jpg");
        add_item_tag(&conn, sphinx, "dawn").unwrap();
        add_folder_tag(&conn, cairo, "dawn").unwrap();
        assert_eq!(
            carried_line(&conn, sphinx),
            ["#library<Library", "#cairo<Cairo", "dawn<Cairo"]
        );

        let dawn = get_or_create_tag(&conn, None, "dawn").unwrap();
        remove_folder_tag(&conn, cairo, dawn).unwrap();
        assert_eq!(
            carried_line(&conn, sphinx),
            ["dawn", "#library<Library", "#cairo<Cairo"],
            "the file's own is still there once the folder's goes"
        );
    }

    #[test]
    fn a_tag_of_several_words_is_kept_lowercase_with_one_space_between_them() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let sphinx = item(&conn, trips, "sphinx.jpg");
        add_item_tag(&conn, sphinx, " New  York ").unwrap();
        add_folder_tag(&conn, trips, "Upper\t East\u{3000}Side").unwrap();

        assert_eq!(
            carried_line(&conn, sphinx),
            [
                "new york",
                "#library<Library",
                "#trips<Trips",
                "upper east side<Trips"
            ]
        );
        assert_eq!(
            get_or_create_tag(&conn, None, "new york").unwrap(),
            get_or_create_tag(&conn, None, "NEW   YORK").unwrap(),
            "one term however it was spaced"
        );
    }

    #[test]
    fn a_tag_of_several_words_reads_back_through_the_term_its_chip_searches() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let sphinx = item(&conn, trips, "sphinx.jpg");
        let other = item(&conn, trips, "york.jpg");
        add_item_tag(&conn, sphinx, "New  York").unwrap();
        add_item_tag(&conn, other, "york").unwrap();

        let carried = item_effective_tags(&conn, sphinx).unwrap();
        let tag = carried.iter().find(|tag| tag.from.is_none()).unwrap();
        let term = crate::query::tag_term(&tag.value);
        assert_eq!(term, "tag:\"new york\"");
        assert_eq!(found_by(&conn, &term), [sphinx]);
        assert_eq!(found_by(&conn, "tag:\"New  York\""), [sphinx]);
    }

    fn refold_again(conn: &mut Connection) {
        conn.execute("DELETE FROM data_version", []).unwrap();
        db::migrate(conn).unwrap();
    }

    fn sorted(mut ids: Vec<i64>) -> Vec<i64> {
        ids.sort();
        ids
    }

    #[test]
    fn terms_stored_before_whitespace_folded_are_found_by_their_chips_once_refolded() {
        let (mut conn, root) = library();
        let york = folders::create(&conn, root, "New  York").unwrap();
        conn.execute(
            "UPDATE tag SET value = 'new  york' WHERE value = 'new york'",
            [],
        )
        .unwrap();
        let stale: i64 = conn
            .query_row("SELECT id FROM tag WHERE value = 'new  york'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let inside = item(&conn, york, "inside.jpg");
        let tagged = item(&conn, root, "tagged.jpg");
        let fresh = item(&conn, root, "fresh.jpg");
        let both = item(&conn, root, "both.jpg");
        for id in [tagged, both] {
            conn.execute(
                "INSERT INTO item_tag (item_id, tag_id, added_at) VALUES (?1, ?2, 0)",
                params![id, stale],
            )
            .unwrap();
            rebuild_item(&conn, id).unwrap();
        }
        add_item_tag(&conn, fresh, "new york").unwrap();
        add_item_tag(&conn, both, "new york").unwrap();

        refold_again(&mut conn);

        let term = crate::query::tag_term("new york");
        assert_eq!(
            sorted(found_by(&conn, &term)),
            sorted(vec![inside, tagged, fresh, both])
        );
        let named: Vec<i64> = search::folders(&conn, &crate::query::parse(&term).unwrap())
            .unwrap()
            .into_iter()
            .map(|found| found.id)
            .collect();
        assert_eq!(named, [york]);
        for id in [inside, tagged, fresh, both] {
            let york_chips: Vec<EffectiveTag> = item_effective_tags(&conn, id)
                .unwrap()
                .into_iter()
                .filter(|tag| tag.value.contains("york"))
                .collect();
            assert_eq!(york_chips.len(), 1, "one chip on {id}: {york_chips:?}");
            let chip = crate::query::tag_term(&york_chips[0].value);
            assert!(found_by(&conn, &chip).contains(&id), "{chip} finds {id}");
        }
        assert_eq!(
            carried_line(&conn, inside),
            ["#library<Library", "#new york<New  York"]
        );
        let terms: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tag WHERE value LIKE 'new%york'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(terms, 1, "the two became one term");
    }

    #[test]
    fn a_folder_whose_label_keys_refold_together_keeps_the_one_it_had_first() {
        let (mut conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let id = item(&conn, trips, "a.jpg");
        set_folder_label(&conn, trips, "Trip Leg", "One").unwrap();
        conn.execute(
            "INSERT INTO tag (key, value) VALUES ('trip  leg', 'two')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO folder_tag (folder_id, tag_id, source) VALUES (?1, ?2, 'manual')",
            params![trips, conn.last_insert_rowid()],
        )
        .unwrap();
        rebuild_item(&conn, id).unwrap();

        refold_again(&mut conn);

        assert_eq!(
            carried_line(&conn, id),
            ["#library<Library", "#trips<Trips", "trip leg:one<Trips"]
        );
        let held: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                  WHERE ft.folder_id = ?1 AND t.key = 'trip leg'",
                [trips],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(held, 1, "Trips holds one trip leg label");
        let one: i64 = conn
            .query_row(
                "SELECT id FROM tag WHERE key = 'trip leg' AND value = 'one'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        remove_folder_tag(&conn, trips, one).unwrap();
        assert_eq!(
            carried_line(&conn, id),
            ["#library<Library", "#trips<Trips"]
        );
    }

    #[test]
    fn a_folder_s_name_stays_its_name_when_its_term_merges_into_an_older_one() {
        let (mut conn, root) = library();
        let older = get_or_create_tag(&conn, None, "old town").unwrap();
        let town = folders::create(&conn, root, "Old  Town").unwrap();
        add_folder_tag(&conn, town, "old town").unwrap();
        conn.execute(
            "INSERT INTO tag (key, value) VALUES (NULL, 'old  town')",
            [],
        )
        .unwrap();
        let stale = conn.last_insert_rowid();
        conn.execute(
            "UPDATE folder_tag SET source = 'manual' WHERE folder_id = ?1 AND tag_id = ?2",
            params![town, older],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO folder_tag (folder_id, tag_id, source) VALUES (?1, ?2, 'title')",
            params![town, stale],
        )
        .unwrap();
        let id = item(&conn, town, "a.jpg");

        refold_again(&mut conn);

        assert_eq!(
            carried_line(&conn, id),
            ["#library<Library", "#old town<Old  Town"]
        );
        remove_folder_tag(&conn, town, older).unwrap();
        assert_eq!(
            carried_line(&conn, id),
            ["#library<Library", "#old town<Old  Town"],
            "still the one it cannot lose"
        );
    }

    fn covered(tags: &[Covered]) -> Vec<String> {
        tags.iter()
            .map(|tag| {
                let text = match &tag.key {
                    Some(key) => format!("{key}:{}", tag.value),
                    None => tag.value.clone(),
                };
                let mark = if tag.name { "#" } else { "" };
                format!("{mark}{text} {}", tag.files)
            })
            .collect()
    }

    fn whose(coverage: &Coverage) -> Vec<(String, i64, Vec<String>)> {
        coverage
            .folders
            .iter()
            .map(|one| (one.folder.title.clone(), one.under, covered(&one.tags)))
            .collect()
    }

    /// Trips holds travel and trip: egypt 2024; Cairo, inside it, egypt and location: cairo, and
    /// three files; Lisbon portugal and location: lisbon, and one file with egypt of its own.
    fn search_set(conn: &Connection, root: i64) -> (i64, Vec<i64>) {
        let trips = folders::create(conn, root, "Trips").unwrap();
        let cairo = folders::create(conn, trips, "Cairo").unwrap();
        let lisbon = folders::create(conn, trips, "Lisbon").unwrap();
        add_folder_tag(conn, trips, "travel").unwrap();
        set_folder_label(conn, trips, "trip", "egypt 2024").unwrap();
        add_folder_tag(conn, cairo, "egypt").unwrap();
        set_folder_label(conn, cairo, "location", "cairo").unwrap();
        add_folder_tag(conn, lisbon, "portugal").unwrap();
        set_folder_label(conn, lisbon, "location", "lisbon").unwrap();
        let mut set: Vec<i64> = ["a.jpg", "b.jpg", "c.jpg"]
            .into_iter()
            .map(|name| item(conn, cairo, name))
            .collect();
        add_item_tag(conn, set[0], "sphinx").unwrap();
        let tram = item(conn, lisbon, "tram.jpg");
        add_item_tag(conn, tram, "egypt").unwrap();
        set.push(tram);
        (cairo, set)
    }

    #[test]
    fn a_set_s_coverage_counts_each_tag_and_says_whose_it_is_in_path_order() {
        let (conn, root) = library();
        let (_, set) = search_set(&conn, root);

        let coverage = selection_tag_coverage(&conn, &set).unwrap();
        assert_eq!(coverage.files, 4);
        assert_eq!(covered(&coverage.own), ["egypt 1", "sphinx 1"]);
        let line = |tags: &[&str]| tags.iter().map(|tag| tag.to_string()).collect::<Vec<_>>();
        assert_eq!(
            whose(&coverage),
            [
                ("Library".into(), 4, line(&["#library 4"])),
                (
                    "Trips".into(),
                    4,
                    line(&["#trips 4", "travel 4", "trip:egypt 2024 4"])
                ),
                (
                    "Cairo".into(),
                    3,
                    line(&["#cairo 3", "egypt 3", "location:cairo 3"])
                ),
                (
                    "Lisbon".into(),
                    1,
                    line(&["#lisbon 1", "portugal 1", "location:lisbon 1"])
                ),
            ]
        );
    }

    #[test]
    fn nothing_checked_covers_nothing_and_a_file_not_in_the_index_is_not_counted() {
        let (conn, root) = library();
        let (_, set) = search_set(&conn, root);
        assert_eq!(
            selection_tag_coverage(&conn, &[]).unwrap(),
            Coverage {
                files: 0,
                own: vec![],
                folders: vec![]
            }
        );
        let coverage = selection_tag_coverage(&conn, &[set[3], 9_999, set[3]]).unwrap();
        assert_eq!(coverage.files, 1);
        assert_eq!(covered(&coverage.own), ["egypt 1"]);
        assert_eq!(
            add_items_tag(&conn, &[], "dawn", &journal::new_batch()).unwrap(),
            0
        );
    }

    #[test]
    fn a_set_across_two_sources_lists_each_source_s_folders_in_path_order() {
        let (conn, root) = library();
        let archive = sources::add(
            &conn,
            Path::new("D:/archive"),
            "Archive",
            SourceKind::Library,
        )
        .unwrap();
        let archive_root = folders::source_root_folder(&conn, archive.id).unwrap();
        let scans = folders::create(&conn, archive_root, "Scans").unwrap();
        let old = item(&conn, scans, "old.jpg");
        let new = item(&conn, root, "new.jpg");

        let coverage = selection_tag_coverage(&conn, &[new, old]).unwrap();
        let titles: Vec<String> = whose(&coverage).into_iter().map(|one| one.0).collect();
        assert_eq!(titles, ["Archive", "Scans", "Library"]);
    }

    fn own_of(conn: &Connection, item_id: i64) -> Vec<String> {
        item_effective_tags(conn, item_id)
            .unwrap()
            .into_iter()
            .filter(|tag| tag.from.is_none())
            .map(|tag| tag.value)
            .collect()
    }

    fn rows_in(conn: &Connection, batch_id: &str) -> Vec<String> {
        journal::batch(conn, batch_id)
            .unwrap()
            .into_iter()
            .map(|entry| entry.op)
            .collect()
    }

    #[test]
    fn adding_to_a_set_gives_the_tag_only_to_files_that_lack_it_and_undo_takes_back_those() {
        let (conn, root) = library();
        let (cairo, set) = search_set(&conn, root);
        let trips = folders::parent(&conn, cairo).unwrap().unwrap();
        let ticket = item(&conn, trips, "ticket.jpg");
        let mut checked = set[..3].to_vec();
        checked.push(ticket);

        let batch = journal::new_batch();
        assert_eq!(add_items_tag(&conn, &checked, "Egypt", &batch).unwrap(), 1);
        assert_eq!(
            rows_in(&conn, &batch),
            [journal::ITEMS_TAG],
            "one row for the act"
        );
        assert_eq!(own_of(&conn, ticket), ["egypt"]);
        assert_eq!(
            own_of(&conn, set[1]),
            [] as [String; 0],
            "Cairo's stays Cairo's"
        );
        assert_eq!(found_by(&conn, "tag:egypt").len(), 5);

        let again = journal::new_batch();
        assert_eq!(add_items_tag(&conn, &checked, "egypt", &again).unwrap(), 0);
        assert!(rows_in(&conn, &again).is_empty(), "nothing to journal");

        crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!(own_of(&conn, ticket), [] as [String; 0]);
        assert_eq!(
            found_by(&conn, "tag:egypt").len(),
            4,
            "the three in Cairo, and the Lisbon file's own"
        );
    }

    #[test]
    fn removing_takes_a_file_s_own_tag_never_one_it_inherits_and_undo_puts_back_exactly_those() {
        let (conn, root) = library();
        let (cairo, set) = search_set(&conn, root);
        let tram = set[3];
        let shadowed = item(&conn, cairo, "d.jpg");
        add_item_tag(&conn, shadowed, "egypt").unwrap();
        add_item_tag(&conn, tram, "dawn").unwrap();
        add_item_tag(&conn, tram, "zebra").unwrap();
        conn.execute(
            "UPDATE item_tag SET added_at = CASE tag_id
               WHEN (SELECT id FROM tag WHERE value = 'dawn') THEN 1
               WHEN (SELECT id FROM tag WHERE value = 'egypt') THEN 2
               ELSE 3 END WHERE item_id = ?1",
            params![tram],
        )
        .unwrap();
        assert_eq!(own_of(&conn, tram), ["dawn", "egypt", "zebra"]);
        let egypt = get_or_create_tag(&conn, None, "egypt").unwrap();
        let mut checked = set.clone();
        checked.push(shadowed);

        let batch = journal::new_batch();
        assert_eq!(remove_items_tag(&conn, &checked, egypt, &batch).unwrap(), 1);
        assert_eq!(rows_in(&conn, &batch), [journal::ITEMS_UNTAG]);
        assert_eq!(own_of(&conn, tram), ["dawn", "zebra"]);
        assert_eq!(
            found_by(&conn, "tag:egypt").len(),
            4,
            "the files in Cairo keep what Cairo gives them"
        );

        crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!(
            own_of(&conn, tram),
            ["dawn", "egypt", "zebra"],
            "back in its place"
        );
        assert_eq!(found_by(&conn, "tag:egypt").len(), 5);
        let label = get_or_create_tag(&conn, Some("location"), "cairo").unwrap();
        assert_eq!(
            remove_items_tag(&conn, &checked, label, &journal::new_batch()).unwrap(),
            0,
            "a label is a folder's, and never comes off a file"
        );
    }

    #[test]
    fn an_undo_of_a_tag_that_fails_says_why_in_its_own_kind_and_keeps_its_row() {
        let (conn, root) = library();
        let (_, set) = search_set(&conn, root);
        let batch = journal::new_batch();
        add_items_tag(&conn, &set, "dawn", &batch).unwrap();
        conn.execute_batch("DROP TABLE item_fts").unwrap();

        let failed = crate::fs::undo::undo_batch(&conn, &batch).unwrap_err();
        assert!(matches!(failed, AppError::Db(_)), "{failed:?}");
        assert_eq!(rows_in(&conn, &batch), [journal::ITEMS_TAG]);
        assert!(
            set.iter()
                .all(|&id| own_of(&conn, id).contains(&"dawn".to_string())),
            "nothing came off in part"
        );
    }

    #[test]
    fn on_its_own_a_change_waits_out_another_connection_writing() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-tags/busy");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("library.db");
        let mut conn = db::open(&path).unwrap();
        db::migrate(&mut conn).unwrap();

        let held = db::hold_write_lock(&path, 300);
        let made = atomically(&conn, || {
            get_or_create_tag(&conn, None, "felucca").map(|_| ())
        });
        held.join().unwrap();
        made.unwrap();
    }

    #[test]
    fn five_thousand_files_take_and_lose_a_tag_in_one_row_each() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let tx = crate::db::begin(&conn).unwrap();
        let set: Vec<i64> = (0..5_000)
            .map(|n| item(&tx, trips, &format!("{n:04}.jpg")))
            .collect();
        tx.commit().unwrap();

        let added = journal::new_batch();
        assert_eq!(
            add_items_tag(&conn, &set, "felucca", &added).unwrap(),
            5_000
        );
        let felucca = get_or_create_tag(&conn, None, "felucca").unwrap();
        let taken = journal::new_batch();
        assert_eq!(
            remove_items_tag(&conn, &set[..3_120], felucca, &taken).unwrap(),
            3_120
        );
        assert_eq!(
            rows_in(&conn, &added).len() + rows_in(&conn, &taken).len(),
            2
        );
        let coverage = selection_tag_coverage(&conn, &set).unwrap();
        assert_eq!(covered(&coverage.own), ["felucca 1880"]);

        crate::fs::undo::undo_batch(&conn, &taken).unwrap();
        let coverage = selection_tag_coverage(&conn, &set).unwrap();
        assert_eq!(covered(&coverage.own), ["felucca 5000"]);
        assert_eq!(found_by(&conn, "tag:felucca").len(), 5_000);
    }

    #[test]
    fn a_bulk_tag_reads_back_as_its_act_and_its_undo_counts_the_files_that_came_back() {
        use crate::fs::acts::{self, Act};
        let (conn, root) = library();
        let (_, set) = search_set(&conn, root);
        let added = journal::new_batch();
        add_items_tag(&conn, &set, "Golden  Hour", &added).unwrap();
        let described = acts::describe(&conn, &added).unwrap();
        assert_eq!(
            (described.act, described.files, described.folders),
            (
                Act::AddTag {
                    tag: "golden hour".into()
                },
                4,
                0
            )
        );

        let egypt = get_or_create_tag(&conn, None, "egypt").unwrap();
        let taken = journal::new_batch();
        remove_items_tag(&conn, &set, egypt, &taken).unwrap();
        let report = crate::fs::undo::undo_last(&conn).unwrap().unwrap();
        assert_eq!(
            report.batch.act,
            Act::RemoveTag {
                tag: "egypt".into()
            }
        );
        assert_eq!((report.files_back, report.stayed.len()), (1, 0));
        assert_eq!(journal::latest_batch(&conn).unwrap(), Some(added));
    }
}
