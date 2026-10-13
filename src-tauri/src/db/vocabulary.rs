//! The library's vocabulary as the tags screen lists it, and its renames, merges and deletes,
//! each one batch in the journal. DECISIONS.md "The tags screen".

use std::collections::{BTreeSet, HashMap};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::folders::{self, Crumb};
use crate::db::journal::{self, Change, FolderUse, ItemUse, Retagged, Reworded, Term};
use crate::db::{fold, search, tags};
use crate::error::{AppError, Result};

/// A tag as the screen lists it, with what carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TagRow {
    pub tag_id: i64,
    pub value: String,
    /// Live files carrying it, their own or from a folder: what a search for it finds.
    pub files: i64,
    /// Live folders holding it themselves, a folder's name among them.
    pub folders: i64,
    /// The folders whose name it is, which only renaming them changes.
    pub named: Vec<Crumb>,
    /// The files holding it themselves and the folders given it by hand: what an act changes.
    pub own_files: i64,
    pub hand_folders: i64,
}

/// One value of a label's key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ValueRow {
    pub tag_id: i64,
    pub value: String,
    pub files: i64,
    pub folders: i64,
}

/// A label's key, with its values: the files carrying any of them and the folders holding one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct KeyRow {
    pub key: String,
    pub files: i64,
    pub folders: i64,
    pub values: Vec<ValueRow>,
}

/// Every tag, then every label key, each in name order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Vocabulary {
    pub tags: Vec<TagRow>,
    pub keys: Vec<KeyRow>,
}

/// Every term in the library, counted from the index, so a source that is away still counts.
pub fn list_tags(conn: &Connection) -> Result<Vocabulary> {
    let files = counts(
        conn,
        "SELECT e.tag_id, COUNT(*) FROM item_effective_tag e JOIN item i ON i.id = e.item_id
          WHERE i.deleted_at IS NULL GROUP BY e.tag_id",
    )?;
    let own = counts(
        conn,
        "SELECT it.tag_id, COUNT(*) FROM item_tag it JOIN item i ON i.id = it.item_id
          WHERE i.deleted_at IS NULL GROUP BY it.tag_id",
    )?;
    let held = counts(
        conn,
        "SELECT ft.tag_id, COUNT(*) FROM folder_tag ft JOIN folder f ON f.id = ft.folder_id
          WHERE f.deleted_at IS NULL GROUP BY ft.tag_id",
    )?;
    let hand = counts(
        conn,
        "SELECT ft.tag_id, COUNT(*) FROM folder_tag ft JOIN folder f ON f.id = ft.folder_id
          WHERE f.deleted_at IS NULL AND ft.source <> 'title' GROUP BY ft.tag_id",
    )?;
    let key_files = key_counts(
        conn,
        "SELECT t.key, COUNT(DISTINCT e.item_id) FROM item_effective_tag e
           JOIN tag t ON t.id = e.tag_id JOIN item i ON i.id = e.item_id
          WHERE t.key IS NOT NULL AND i.deleted_at IS NULL GROUP BY t.key",
    )?;
    let key_folders = key_counts(
        conn,
        "SELECT t.key, COUNT(DISTINCT ft.folder_id) FROM folder_tag ft
           JOIN tag t ON t.id = ft.tag_id JOIN folder f ON f.id = ft.folder_id
          WHERE t.key IS NOT NULL AND f.deleted_at IS NULL GROUP BY t.key",
    )?;
    let mut named: HashMap<i64, Vec<Crumb>> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT ft.tag_id, f.id, COALESCE(s.title, f.title) FROM folder_tag ft
               JOIN folder f ON f.id = ft.folder_id
               LEFT JOIN source s ON f.parent_id IS NULL AND s.id = f.source_id
              WHERE ft.source = 'title' AND f.deleted_at IS NULL
              ORDER BY COALESCE(s.title, f.title) COLLATE NOCASE, f.id",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                Crumb {
                    id: r.get(1)?,
                    title: r.get(2)?,
                },
            ))
        })?;
        for row in rows {
            let (tag_id, crumb) = row?;
            named.entry(tag_id).or_default().push(crumb);
        }
    }
    let of = |map: &HashMap<i64, i64>, id: i64| map.get(&id).copied().unwrap_or(0);

    let mut stmt =
        conn.prepare("SELECT id, key, value FROM tag ORDER BY key IS NOT NULL, key, value")?;
    let terms = stmt
        .query_map([], |r| {
            Ok(Term {
                id: r.get(0)?,
                key: r.get(1)?,
                value: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut vocabulary = Vocabulary {
        tags: Vec::new(),
        keys: Vec::new(),
    };
    for term in terms {
        let Some(key) = term.key else {
            vocabulary.tags.push(TagRow {
                tag_id: term.id,
                value: term.value,
                files: of(&files, term.id),
                folders: of(&held, term.id),
                named: named.remove(&term.id).unwrap_or_default(),
                own_files: of(&own, term.id),
                hand_folders: of(&hand, term.id),
            });
            continue;
        };
        let value = ValueRow {
            tag_id: term.id,
            value: term.value,
            files: of(&files, term.id),
            folders: of(&held, term.id),
        };
        match vocabulary.keys.last_mut() {
            Some(last) if last.key == key => last.values.push(value),
            _ => vocabulary.keys.push(KeyRow {
                files: key_files.get(&key).copied().unwrap_or(0),
                folders: key_folders.get(&key).copied().unwrap_or(0),
                key,
                values: vec![value],
            }),
        }
    }
    Ok(vocabulary)
}

fn counts(conn: &Connection, sql: &str) -> Result<HashMap<i64, i64>> {
    let mut stmt = conn.prepare(sql)?;
    Ok(stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?)
}

fn key_counts(conn: &Connection, sql: &str) -> Result<HashMap<String, i64>> {
    let mut stmt = conn.prepare(sql)?;
    Ok(stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Why merging one key into another would give a folder a key twice down its branch, in the
/// folder band's terms: the folder it would land on first, then where the other is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum KeyClash {
    /// The folder holds both keys.
    Both { folder: String },
    /// A folder above it holds the key it would take.
    Above { folder: String, above: String },
    /// A folder below it holds the key it would take.
    Below { folder: String, below: String },
}

/// What stands in the way of merging `from` into `into`, or nothing when no branch would hold
/// either key twice. DECISIONS.md "A folder's details".
pub fn key_clash(conn: &Connection, from: &str, into: &str) -> Result<Option<KeyClash>> {
    let (from, into) = (fold(from), fold(into));
    if from == into {
        return Ok(None);
    }
    let holders: Vec<(i64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT DISTINCT f.id, f.title FROM folder_tag ft
               JOIN tag t ON t.id = ft.tag_id JOIN folder f ON f.id = ft.folder_id
              WHERE t.key = ?1 AND f.deleted_at IS NULL
              ORDER BY f.title COLLATE NOCASE, f.id",
        )?;
        stmt.query_map(params![from], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    for (folder_id, _) in holders {
        let folder = name(conn, folder_id)?;
        let both: bool = conn.query_row(
            "SELECT EXISTS (SELECT 1 FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                             WHERE ft.folder_id = ?1 AND t.key = ?2)",
            params![folder_id, into],
            |r| r.get(0),
        )?;
        if both {
            return Ok(Some(KeyClash::Both { folder }));
        }
        if let Some(above) = tags::holding_above(conn, folder_id, &into)? {
            let above = name(conn, above)?;
            return Ok(Some(KeyClash::Above { folder, above }));
        }
        if let Some(below) = tags::holding_below(conn, folder_id, Some(&into))?
            .into_iter()
            .next()
        {
            let below = below.folder.title;
            return Ok(Some(KeyClash::Below { folder, below }));
        }
    }
    Ok(None)
}

/// A folder as navigation names it: a source's own folder goes by the source's title.
fn name(conn: &Connection, folder_id: i64) -> Result<String> {
    Ok(folders::ancestry(conn, folder_id)?
        .pop()
        .map(|crumb| crumb.title)
        .unwrap_or_default())
}

/// Gives a tag a new name everywhere at once. Refused onto a tag that exists, which is a merge.
/// A folder's name keeps its tag, so renaming one moves only the uses given by hand, onto a new
/// tag; any other keeps its id. Returns whether anything changed.
pub fn rename_tag(conn: &Connection, tag_id: i64, value: &str, batch_id: &str) -> Result<bool> {
    let term = tag(conn, tag_id)?;
    let to = word(value, "a tag needs a word")?;
    if to == term.value {
        return Ok(false);
    }
    if find(conn, None, &to)?.is_some() {
        return Err(AppError::invalid(format!("{to} is already a tag")));
    }
    let change = Change::RenameTag {
        from: term.value.clone(),
        to: to.clone(),
    };
    if !named(conn, tag_id)? {
        let mut retagged = blank(
            change,
            live_carriers(conn, &[tag_id])?.len(),
            live_holders(conn, &[tag_id])?,
        );
        reword(
            conn,
            &mut retagged,
            &term,
            Term {
                id: tag_id,
                key: None,
                value: to,
            },
        )?;
        return record(conn, batch_id, &retagged);
    }
    let before = live_carriers(conn, &[tag_id])?;
    let mut retagged = blank(change, 0, live_hand_holders(conn, tag_id)?);
    let made = make(conn, None, &to)?;
    retagged.made.push(made.clone());
    let items = carriers(conn, &[tag_id])?;
    take_uses(conn, &mut retagged, tag_id, Some(made.id))?;
    settle(conn, &retagged, &items, &[tag_id, made.id])?;
    retagged.files = gone_from(&before, &live_carriers(conn, &[tag_id])?);
    record(conn, batch_id, &retagged)
}

/// Moves every use of one tag given by hand onto another, leaving nothing holding it twice. A
/// folder's name stays its name. Returns whether anything changed.
pub fn merge_tags(conn: &Connection, from: i64, into: i64, batch_id: &str) -> Result<bool> {
    let (one, other) = (tag(conn, from)?, tag(conn, into)?);
    if from == into {
        return Ok(false);
    }
    let before = live_carriers(conn, &[from])?;
    let mut retagged = blank(
        Change::MergeTags {
            from: one.value.clone(),
            into: other.value,
        },
        0,
        live_hand_holders(conn, from)?,
    );
    let items = carriers(conn, &[from, into])?;
    take_uses(conn, &mut retagged, from, Some(into))?;
    settle(conn, &retagged, &items, &[from, into])?;
    retire(conn, &mut retagged, &one)?;
    retagged.files = gone_from(&before, &live_carriers(conn, &[from])?);
    record(conn, batch_id, &retagged)
}

/// Takes a tag off everything given it by hand, and forgets it once nothing holds it. A folder's
/// name stays its name.
pub fn delete_tag(conn: &Connection, tag_id: i64, batch_id: &str) -> Result<bool> {
    let term = tag(conn, tag_id)?;
    let before = live_carriers(conn, &[tag_id])?;
    let mut retagged = blank(
        Change::DeleteTag {
            tag: term.value.clone(),
        },
        0,
        live_hand_holders(conn, tag_id)?,
    );
    let items = carriers(conn, &[tag_id])?;
    take_uses(conn, &mut retagged, tag_id, None)?;
    settle(conn, &retagged, &items, &[tag_id])?;
    retire(conn, &mut retagged, &term)?;
    retagged.files = gone_from(&before, &live_carriers(conn, &[tag_id])?);
    record(conn, batch_id, &retagged)
}

/// Gives a key a new name on every label of it. Refused onto a key that exists, which is a merge.
pub fn rename_key(conn: &Connection, from: &str, to: &str, batch_id: &str) -> Result<bool> {
    let (from, to) = (fold(from), word(to, "a key needs a word")?);
    let terms = key_terms(conn, &from)?;
    if from == to || terms.is_empty() {
        return Ok(false);
    }
    if !key_terms(conn, &to)?.is_empty() {
        return Err(AppError::invalid(format!("{to} is already a key")));
    }
    let ids: Vec<i64> = terms.iter().map(|term| term.id).collect();
    let mut retagged = blank(
        Change::RenameKey {
            from,
            to: to.clone(),
        },
        live_carriers(conn, &ids)?.len(),
        live_holders(conn, &ids)?,
    );
    for term in terms {
        let renamed = Term {
            key: Some(to.clone()),
            ..term.clone()
        };
        reword(conn, &mut retagged, &term, renamed)?;
    }
    record(conn, batch_id, &retagged)
}

/// Every label of one key becomes a label of another, each folder keeping its value. Refused
/// where a branch would hold the key twice.
pub fn merge_keys(conn: &Connection, from: &str, into: &str, batch_id: &str) -> Result<bool> {
    let (from, into) = (fold(from), fold(into));
    let terms = key_terms(conn, &from)?;
    let kept = key_terms(conn, &into)?;
    if from == into || terms.is_empty() {
        return Ok(false);
    }
    if kept.is_empty() {
        return Err(AppError::invalid(format!("{into} is not a key")));
    }
    if let Some(clash) = key_clash(conn, &from, &into)? {
        return Err(AppError::invalid(format!(
            "{from} cannot merge into {into}: {clash:?}"
        )));
    }
    let ids: Vec<i64> = terms.iter().map(|term| term.id).collect();
    let mut scope = ids.clone();
    scope.extend(kept.iter().map(|term| term.id));
    let mut retagged = blank(
        Change::MergeKeys {
            from,
            into: into.clone(),
        },
        live_carriers(conn, &ids)?.len(),
        live_holders(conn, &ids)?,
    );
    let items = carriers(conn, &scope)?;
    let mut moved = Vec::new();
    for term in terms {
        match kept.iter().find(|one| one.value == term.value) {
            Some(same) => {
                take_uses(conn, &mut retagged, term.id, Some(same.id))?;
                moved.push(term);
            }
            None => {
                let renamed = Term {
                    key: Some(into.clone()),
                    ..term.clone()
                };
                reword(conn, &mut retagged, &term, renamed)?;
            }
        }
    }
    settle(conn, &retagged, &items, &scope)?;
    for term in moved {
        retire(conn, &mut retagged, &term)?;
    }
    record(conn, batch_id, &retagged)
}

/// Takes every label of a key off the folders that hold one.
pub fn delete_key(conn: &Connection, key: &str, batch_id: &str) -> Result<bool> {
    let key = fold(key);
    let terms = key_terms(conn, &key)?;
    if terms.is_empty() {
        return Ok(false);
    }
    let ids: Vec<i64> = terms.iter().map(|term| term.id).collect();
    let mut retagged = blank(
        Change::DeleteKey { key },
        live_carriers(conn, &ids)?.len(),
        live_holders(conn, &ids)?,
    );
    let items = carriers(conn, &ids)?;
    for term in &terms {
        take_uses(conn, &mut retagged, term.id, None)?;
    }
    settle(conn, &retagged, &items, &ids)?;
    for term in &terms {
        retire(conn, &mut retagged, term)?;
    }
    record(conn, batch_id, &retagged)
}

/// Gives one value of a key a new name on every folder that holds it. Refused onto a value the
/// key already has, which is a merge.
pub fn rename_value(conn: &Connection, tag_id: i64, value: &str, batch_id: &str) -> Result<bool> {
    let term = label(conn, tag_id)?;
    let key = term.key.clone().unwrap_or_default();
    let to = word(value, "a label needs a value")?;
    if to == term.value {
        return Ok(false);
    }
    if find(conn, Some(&key), &to)?.is_some() {
        return Err(AppError::invalid(format!("{key} already has {to}")));
    }
    let mut retagged = blank(
        Change::RenameValue {
            key,
            from: term.value.clone(),
            to: to.clone(),
        },
        live_carriers(conn, &[tag_id])?.len(),
        live_holders(conn, &[tag_id])?,
    );
    let renamed = Term {
        value: to,
        ..term.clone()
    };
    reword(conn, &mut retagged, &term, renamed)?;
    record(conn, batch_id, &retagged)
}

/// Moves one value of a key onto another of the same key, on every folder that holds it.
pub fn merge_values(conn: &Connection, from: i64, into: i64, batch_id: &str) -> Result<bool> {
    let (one, other) = (label(conn, from)?, label(conn, into)?);
    if from == into {
        return Ok(false);
    }
    if one.key != other.key {
        return Err(AppError::invalid("a value never leaves its key"));
    }
    let mut retagged = blank(
        Change::MergeValues {
            key: one.key.clone().unwrap_or_default(),
            from: one.value.clone(),
            into: other.value,
        },
        live_carriers(conn, &[from])?.len(),
        live_holders(conn, &[from])?,
    );
    let items = carriers(conn, &[from, into])?;
    take_uses(conn, &mut retagged, from, Some(into))?;
    settle(conn, &retagged, &items, &[from, into])?;
    retire(conn, &mut retagged, &one)?;
    record(conn, batch_id, &retagged)
}

/// Takes one value of a key off the folders that hold it.
pub fn delete_value(conn: &Connection, tag_id: i64, batch_id: &str) -> Result<bool> {
    let term = label(conn, tag_id)?;
    let mut retagged = blank(
        Change::DeleteValue {
            key: term.key.clone().unwrap_or_default(),
            value: term.value.clone(),
        },
        live_carriers(conn, &[tag_id])?.len(),
        live_holders(conn, &[tag_id])?,
    );
    let items = carriers(conn, &[tag_id])?;
    take_uses(conn, &mut retagged, tag_id, None)?;
    settle(conn, &retagged, &items, &[tag_id])?;
    retire(conn, &mut retagged, &term)?;
    record(conn, batch_id, &retagged)
}

/// Puts back exactly what one act changed, each term under its own id where that is still free.
/// Writes no journal row: it is what undoing the act applies.
pub fn reverse(conn: &Connection, retagged: &Retagged) -> Result<()> {
    tags::atomically(conn, || {
        let mut ids: HashMap<i64, i64> = HashMap::new();
        let mut extra = BTreeSet::new();
        for term in &retagged.removed {
            ids.insert(term.id, restore(conn, term)?);
        }
        for reworded in retagged.reworded.iter().rev() {
            extra.extend(reword_back(conn, reworded)?);
        }
        let id = |one: i64| ids.get(&one).copied().unwrap_or(one);
        let mut scope = BTreeSet::new();
        let mut folder_ids = BTreeSet::new();
        for used in retagged.folder_uses.iter().rev() {
            let from = id(used.from);
            scope.insert(from);
            folder_ids.insert(used.folder_id);
            if let Some(to) = used.to {
                scope.insert(to);
                conn.execute(
                    "DELETE FROM folder_tag WHERE folder_id = ?1 AND tag_id = ?2",
                    params![used.folder_id, to],
                )?;
            }
            give_folder(conn, used.rowid, used.folder_id, from, &used.source)?;
        }
        for used in retagged.item_uses.iter().rev() {
            let from = id(used.from);
            scope.insert(from);
            extra.insert(used.item_id);
            if let Some(to) = used.to {
                scope.insert(to);
                conn.execute(
                    "DELETE FROM item_tag WHERE item_id = ?1 AND tag_id = ?2",
                    params![used.item_id, to],
                )?;
            }
            give_item(conn, used.rowid, used.item_id, from, used.added_at)?;
        }
        scope.extend(retagged.reworded.iter().map(|one| one.id));
        scope.extend(retagged.made.iter().map(|term| term.id));
        scope.extend(ids.values().copied());
        let scope: Vec<i64> = scope.into_iter().collect();
        let folder_ids: Vec<i64> = folder_ids.into_iter().collect();
        let mut items: BTreeSet<i64> = carriers(conn, &scope)?.into_iter().collect();
        items.extend(under(conn, &folder_ids)?);
        items.extend(extra);
        let items: Vec<i64> = items.into_iter().collect();
        resolve(conn, &items, &scope)?;
        for folder_id in holders(conn, &scope)?.into_iter().chain(folder_ids) {
            search::index_folder(conn, folder_id)?;
        }
        for term in &retagged.made {
            forget_if_unheld(conn, term.id)?;
        }
        Ok(())
    })
}

fn blank(change: Change, files: usize, folders: i64) -> Retagged {
    Retagged {
        change,
        files: files as u32,
        folders: folders as u32,
        reworded: Vec::new(),
        made: Vec::new(),
        removed: Vec::new(),
        folder_uses: Vec::new(),
        item_uses: Vec::new(),
    }
}

fn record(conn: &Connection, batch_id: &str, retagged: &Retagged) -> Result<bool> {
    journal::record_retag(conn, batch_id, retagged)?;
    Ok(true)
}

fn word(typed: &str, empty: &str) -> Result<String> {
    let folded = fold(typed);
    if folded.is_empty() {
        return Err(AppError::invalid(empty));
    }
    Ok(folded)
}

fn term(conn: &Connection, tag_id: i64) -> Result<Term> {
    conn.query_row(
        "SELECT id, key, value FROM tag WHERE id = ?1",
        params![tag_id],
        |r| {
            Ok(Term {
                id: r.get(0)?,
                key: r.get(1)?,
                value: r.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::invalid("that tag is gone"))
}

fn tag(conn: &Connection, tag_id: i64) -> Result<Term> {
    let term = term(conn, tag_id)?;
    match term.key {
        None => Ok(term),
        Some(_) => Err(AppError::invalid("that is a label, not a tag")),
    }
}

fn label(conn: &Connection, tag_id: i64) -> Result<Term> {
    let term = term(conn, tag_id)?;
    match term.key {
        Some(_) => Ok(term),
        None => Err(AppError::invalid("that is a tag, not a label")),
    }
}

fn find(conn: &Connection, key: Option<&str>, value: &str) -> Result<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM tag WHERE key IS ?1 AND value = ?2",
            params![key, value],
            |r| r.get(0),
        )
        .optional()?)
}

fn make(conn: &Connection, key: Option<&str>, value: &str) -> Result<Term> {
    conn.execute(
        "INSERT INTO tag (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(Term {
        id: conn.last_insert_rowid(),
        key: key.map(str::to_string),
        value: value.to_string(),
    })
}

fn key_terms(conn: &Connection, key: &str) -> Result<Vec<Term>> {
    let mut stmt = conn.prepare("SELECT id, key, value FROM tag WHERE key = ?1 ORDER BY id")?;
    Ok(stmt
        .query_map(params![key], |r| {
            Ok(Term {
                id: r.get(0)?,
                key: r.get(1)?,
                value: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?)
}

fn named(conn: &Connection, tag_id: i64) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM folder_tag WHERE tag_id = ?1 AND source = 'title')",
        params![tag_id],
        |r| r.get(0),
    )?)
}

fn json(ids: &[i64]) -> Result<String> {
    Ok(serde_json::to_string(ids)?)
}

fn id_list(conn: &Connection, sql: &str, ids: &[i64]) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(sql)?;
    Ok(stmt
        .query_map(params![json(ids)?], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}

/// Every item that carries any of the terms, in whatever state: their rows all have to follow.
fn carriers(conn: &Connection, tag_ids: &[i64]) -> Result<Vec<i64>> {
    id_list(
        conn,
        "SELECT DISTINCT item_id FROM item_effective_tag
          WHERE tag_id IN (SELECT value FROM json_each(?1)) ORDER BY item_id",
        tag_ids,
    )
}

fn live_carriers(conn: &Connection, tag_ids: &[i64]) -> Result<BTreeSet<i64>> {
    Ok(id_list(
        conn,
        "SELECT DISTINCT e.item_id FROM item_effective_tag e JOIN item i ON i.id = e.item_id
          WHERE i.deleted_at IS NULL AND e.tag_id IN (SELECT value FROM json_each(?1))",
        tag_ids,
    )?
    .into_iter()
    .collect())
}

fn holders(conn: &Connection, tag_ids: &[i64]) -> Result<Vec<i64>> {
    id_list(
        conn,
        "SELECT DISTINCT folder_id FROM folder_tag
          WHERE tag_id IN (SELECT value FROM json_each(?1)) ORDER BY folder_id",
        tag_ids,
    )
}

fn live_holders(conn: &Connection, tag_ids: &[i64]) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(DISTINCT ft.folder_id) FROM folder_tag ft JOIN folder f ON f.id = ft.folder_id
          WHERE f.deleted_at IS NULL AND ft.tag_id IN (SELECT value FROM json_each(?1))",
        params![json(tag_ids)?],
        |r| r.get(0),
    )?)
}

fn live_hand_holders(conn: &Connection, tag_id: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM folder_tag ft JOIN folder f ON f.id = ft.folder_id
          WHERE f.deleted_at IS NULL AND ft.tag_id = ?1 AND ft.source <> 'title'",
        params![tag_id],
        |r| r.get(0),
    )?)
}

/// Every item at or below the folders, in whatever state.
fn under(conn: &Connection, folder_ids: &[i64]) -> Result<Vec<i64>> {
    id_list(
        conn,
        "WITH RECURSIVE subtree(id) AS (
             SELECT value FROM json_each(?1)
           UNION
             SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
         )
         SELECT i.id FROM item i JOIN subtree s ON i.folder_id = s.id",
        folder_ids,
    )
}

fn gone_from(before: &BTreeSet<i64>, still: &BTreeSet<i64>) -> u32 {
    before.difference(still).count() as u32
}

/// Changes a term's text where it stands, so everything holding it reads the new words.
fn reword(conn: &Connection, retagged: &mut Retagged, from: &Term, to: Term) -> Result<()> {
    conn.execute(
        "UPDATE tag SET key = ?1, value = ?2 WHERE id = ?3",
        params![to.key, to.value, from.id],
    )?;
    reindex(conn, &[from.id])?;
    retagged.reworded.push(Reworded {
        id: from.id,
        from: from.clone(),
        to,
    });
    Ok(())
}

fn reindex(conn: &Connection, tag_ids: &[i64]) -> Result<()> {
    search::index_items(conn, &carriers(conn, tag_ids)?)?;
    for folder_id in holders(conn, tag_ids)? {
        search::index_folder(conn, folder_id)?;
    }
    Ok(())
}

/// Moves each use given by hand of one term onto another, or takes it away when there is none or
/// the holder already has the other. A folder's name is never one of them.
fn take_uses(
    conn: &Connection,
    retagged: &mut Retagged,
    from: i64,
    into: Option<i64>,
) -> Result<()> {
    let held: Vec<(i64, i64, String, bool)> = {
        let mut stmt = conn.prepare(
            "SELECT ft.folder_id, ft.rowid, ft.source,
                    EXISTS (SELECT 1 FROM folder_tag o WHERE o.folder_id = ft.folder_id
                             AND o.tag_id IS ?2)
               FROM folder_tag ft WHERE ft.tag_id = ?1 AND ft.source <> 'title' ORDER BY ft.rowid",
        )?;
        stmt.query_map(params![from, into], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?
    };
    for (folder_id, rowid, source, has) in held {
        let to = into.filter(|_| !has);
        match to {
            Some(to) => conn.execute(
                "UPDATE folder_tag SET tag_id = ?1 WHERE rowid = ?2",
                params![to, rowid],
            )?,
            None => conn.execute("DELETE FROM folder_tag WHERE rowid = ?1", params![rowid])?,
        };
        retagged.folder_uses.push(FolderUse {
            folder_id,
            rowid,
            source,
            from,
            to,
        });
    }
    let own: Vec<(i64, i64, i64, bool)> = {
        let mut stmt = conn.prepare(
            "SELECT it.item_id, it.rowid, it.added_at,
                    EXISTS (SELECT 1 FROM item_tag o WHERE o.item_id = it.item_id
                             AND o.tag_id IS ?2)
               FROM item_tag it WHERE it.tag_id = ?1 ORDER BY it.rowid",
        )?;
        stmt.query_map(params![from, into], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?
    };
    for (item_id, rowid, added_at, has) in own {
        let to = into.filter(|_| !has);
        match to {
            Some(to) => conn.execute(
                "UPDATE item_tag SET tag_id = ?1 WHERE rowid = ?2",
                params![to, rowid],
            )?,
            None => conn.execute("DELETE FROM item_tag WHERE rowid = ?1", params![rowid])?,
        };
        retagged.item_uses.push(ItemUse {
            item_id,
            rowid,
            added_at,
            from,
            to,
        });
    }
    Ok(())
}

/// What the moved uses mean for the items that carried them, and for the folders' own search.
fn settle(conn: &Connection, retagged: &Retagged, items: &[i64], scope: &[i64]) -> Result<()> {
    resolve(conn, items, scope)?;
    let folders: BTreeSet<i64> = retagged
        .folder_uses
        .iter()
        .map(|used| used.folder_id)
        .collect();
    for folder_id in folders {
        search::index_folder(conn, folder_id)?;
    }
    Ok(())
}

/// Recomputes what the items carry of the terms, and of any label sharing a key with one, as
/// `tags::rebuild_item` does for one item: the nearest folder holding it, else the item's own.
/// One statement for the whole set.
fn resolve(conn: &Connection, item_ids: &[i64], tag_ids: &[i64]) -> Result<()> {
    if item_ids.is_empty() {
        return Ok(());
    }
    let items = json(item_ids)?;
    let scope = json(&id_list(
        conn,
        "SELECT id FROM tag WHERE id IN (SELECT value FROM json_each(?1))
            OR key IN (SELECT key FROM tag WHERE key IS NOT NULL
                        AND id IN (SELECT value FROM json_each(?1)))",
        tag_ids,
    )?)?;
    conn.execute(
        "DELETE FROM item_effective_tag
          WHERE item_id IN (SELECT value FROM json_each(?1))
            AND tag_id IN (SELECT value FROM json_each(?2))",
        params![items, scope],
    )?;
    conn.execute(
        "WITH RECURSIVE up(item_id, folder_id, depth) AS (
             SELECT id, folder_id, 0 FROM item WHERE id IN (SELECT value FROM json_each(?1))
           UNION ALL
             SELECT up.item_id, f.parent_id, up.depth + 1 FROM up JOIN folder f ON f.id = up.folder_id
              WHERE f.parent_id IS NOT NULL
         ),
         held AS (
             SELECT up.item_id, ft.tag_id, ft.folder_id, up.depth, ft.rowid AS held_at,
                    CASE WHEN t.key IS NULL THEN 't' || t.id ELSE 'k' || t.key END AS slot
               FROM up JOIN folder_tag ft ON ft.folder_id = up.folder_id
               JOIN tag t ON t.id = ft.tag_id
              WHERE ft.tag_id IN (SELECT value FROM json_each(?2))
         ),
         nearest AS (
             SELECT item_id, tag_id, folder_id,
                    ROW_NUMBER() OVER (PARTITION BY item_id, slot ORDER BY depth, held_at) AS n
               FROM held
         )
         INSERT OR IGNORE INTO item_effective_tag (item_id, tag_id, origin_id)
         SELECT item_id, tag_id, folder_id FROM nearest WHERE n = 1",
        params![items, scope],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO item_effective_tag (item_id, tag_id, origin_id)
         SELECT item_id, tag_id, NULL FROM item_tag
          WHERE item_id IN (SELECT value FROM json_each(?1))
            AND tag_id IN (SELECT value FROM json_each(?2))",
        params![items, scope],
    )?;
    search::index_items(conn, item_ids)
}

/// Forgets a term the act left nothing holding, so the list does not keep an unused one it made.
fn retire(conn: &Connection, retagged: &mut Retagged, term: &Term) -> Result<()> {
    if forget_if_unheld(conn, term.id)? {
        retagged.removed.push(term.clone());
    }
    Ok(())
}

fn forget_if_unheld(conn: &Connection, tag_id: i64) -> Result<bool> {
    let held: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM folder_tag WHERE tag_id = ?1)
             OR EXISTS (SELECT 1 FROM item_tag WHERE tag_id = ?1)",
        params![tag_id],
        |r| r.get(0),
    )?;
    if held {
        return Ok(false);
    }
    conn.execute(
        "DELETE FROM item_effective_tag WHERE tag_id = ?1",
        params![tag_id],
    )?;
    Ok(conn.execute("DELETE FROM tag WHERE id = ?1", params![tag_id])? > 0)
}

/// A term an act took away, back under its own id, or under the one its words have now.
fn restore(conn: &Connection, term: &Term) -> Result<i64> {
    if let Some(id) = find(conn, term.key.as_deref(), &term.value)? {
        return Ok(id);
    }
    let free: bool = conn.query_row(
        "SELECT NOT EXISTS (SELECT 1 FROM tag WHERE id = ?1)",
        params![term.id],
        |r| r.get(0),
    )?;
    if free {
        conn.execute(
            "INSERT INTO tag (id, key, value) VALUES (?1, ?2, ?3)",
            params![term.id, term.key, term.value],
        )?;
        return Ok(term.id);
    }
    Ok(make(conn, term.key.as_deref(), &term.value)?.id)
}

/// A reworded term back to its old words. One that has taken those words since folds into it,
/// and the items that carried that one are returned, to be settled with the rest.
fn reword_back(conn: &Connection, reworded: &Reworded) -> Result<Vec<i64>> {
    let mut moved = Vec::new();
    if let Some(other) = find(conn, reworded.from.key.as_deref(), &reworded.from.value)?
        && other != reworded.id
    {
        moved = carriers(conn, &[other])?;
        tags::merge_term(conn, other, reworded.id)?;
    }
    conn.execute(
        "UPDATE tag SET key = ?1, value = ?2 WHERE id = ?3",
        params![reworded.from.key, reworded.from.value, reworded.id],
    )?;
    reindex(conn, &[reworded.id])?;
    Ok(moved)
}

/// A folder's use back in its old place among its terms, where its row is still free and the
/// folder still holds no other value of the label's key.
fn give_folder(
    conn: &Connection,
    rowid: i64,
    folder_id: i64,
    tag_id: i64,
    source: &str,
) -> Result<()> {
    let clear = "NOT EXISTS (SELECT 1 FROM folder_tag WHERE folder_id = ?2 AND tag_id = ?3)
         AND NOT EXISTS (SELECT 1 FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                          JOIN tag mine ON mine.id = ?3
                          WHERE ft.folder_id = ?2 AND t.key = mine.key)
         AND EXISTS (SELECT 1 FROM folder WHERE id = ?2) AND EXISTS (SELECT 1 FROM tag WHERE id = ?3)";
    let placed = conn.execute(
        &format!(
            "INSERT INTO folder_tag (rowid, folder_id, tag_id, source)
             SELECT ?1, ?2, ?3, ?4 WHERE {clear}
                AND NOT EXISTS (SELECT 1 FROM folder_tag WHERE rowid = ?1)"
        ),
        params![rowid, folder_id, tag_id, source],
    )?;
    if placed == 0 {
        conn.execute(
            &format!(
                "INSERT INTO folder_tag (folder_id, tag_id, source)
                 SELECT ?2, ?3, ?4 WHERE {clear} AND ?1 IS NOT NULL"
            ),
            params![rowid, folder_id, tag_id, source],
        )?;
    }
    Ok(())
}

/// A file's own tag back in its old place among its own, where its row is still free.
fn give_item(
    conn: &Connection,
    rowid: i64,
    item_id: i64,
    tag_id: i64,
    added_at: i64,
) -> Result<()> {
    let clear = "NOT EXISTS (SELECT 1 FROM item_tag WHERE item_id = ?2 AND tag_id = ?3)
         AND EXISTS (SELECT 1 FROM item WHERE id = ?2) AND EXISTS (SELECT 1 FROM tag WHERE id = ?3)";
    let placed = conn.execute(
        &format!(
            "INSERT INTO item_tag (rowid, item_id, tag_id, added_at)
             SELECT ?1, ?2, ?3, ?4 WHERE {clear}
                AND NOT EXISTS (SELECT 1 FROM item_tag WHERE rowid = ?1)"
        ),
        params![rowid, item_id, tag_id, added_at],
    )?;
    if placed == 0 {
        conn.execute(
            &format!(
                "INSERT INTO item_tag (item_id, tag_id, added_at)
                 SELECT ?2, ?3, ?4 WHERE {clear} AND ?1 IS NOT NULL"
            ),
            params![rowid, item_id, tag_id, added_at],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::{self, NewItem};
    use crate::db::sources::{self, SourceKind};
    use crate::db::tags::{
        add_folder_tag, add_item_tag, get_or_create_tag, item_effective_tags, rebuild_item,
        set_folder_label,
    };
    use crate::db::{self, folders};
    use crate::fs::acts::{self, Act};
    use crate::fs::undo;
    use std::path::Path;

    struct Library {
        conn: Connection,
        root: i64,
        trips: i64,
        cairo: i64,
        lisbon: i64,
        family: i64,
        beach: i64,
        sphinx: i64,
        pyramid: i64,
        tram: i64,
        tower: i64,
        aunt: i64,
        shell: i64,
    }

    /// Pictures › Trips › Cairo and Lisbon, People › Family, and Beach, as Artboards › Tags has
    /// them in small: Trips carries travel and `trip: egypt 2024`, People `owner: ada`.
    fn library() -> Library {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let source = sources::add(
            &conn,
            Path::new("D:/library"),
            "Pictures",
            SourceKind::Library,
        )
        .unwrap();
        let root = folders::source_root_folder(&conn, source.id).unwrap();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        let lisbon = folders::create(&conn, trips, "Lisbon").unwrap();
        let people = folders::create(&conn, root, "People").unwrap();
        let family = folders::create(&conn, people, "Family").unwrap();
        let beach = folders::create(&conn, root, "Beach").unwrap();
        let sphinx = item(&conn, cairo, "sphinx.jpg");
        let pyramid = item(&conn, cairo, "pyramid.jpg");
        let tram = item(&conn, lisbon, "tram.jpg");
        let tower = item(&conn, lisbon, "tower.jpg");
        let aunt = item(&conn, family, "aunt.jpg");
        let shell = item(&conn, beach, "shell.jpg");
        add_folder_tag(&conn, trips, "travel").unwrap();
        set_folder_label(&conn, trips, "trip", "egypt 2024").unwrap();
        add_folder_tag(&conn, cairo, "egypt").unwrap();
        set_folder_label(&conn, cairo, "location", "cairo").unwrap();
        set_folder_label(&conn, lisbon, "location", "lisbon").unwrap();
        set_folder_label(&conn, people, "owner", "ada").unwrap();
        set_folder_label(&conn, family, "place", "home").unwrap();
        set_folder_label(&conn, beach, "place", "gouna").unwrap();
        add_item_tag(&conn, sphinx, "dawn").unwrap();
        add_item_tag(&conn, tram, "egypt").unwrap();
        add_item_tag(&conn, tram, "dawn").unwrap();
        add_item_tag(&conn, tower, "lisbon").unwrap();
        add_item_tag(&conn, aunt, "golden hour").unwrap();
        add_item_tag(&conn, aunt, "dawn").unwrap();
        add_folder_tag(&conn, beach, "dawn").unwrap();
        get_or_create_tag(&conn, None, "winter").unwrap();
        Library {
            conn,
            root,
            trips,
            cairo,
            lisbon,
            family,
            beach,
            sphinx,
            pyramid,
            tram,
            tower,
            aunt,
            shell,
        }
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

    fn id_of(conn: &Connection, key: Option<&str>, value: &str) -> i64 {
        find(conn, key, value).unwrap().unwrap()
    }

    /// Each tag as `value files/folders`, a folder's name marked with #.
    fn tag_lines(conn: &Connection) -> Vec<String> {
        list_tags(conn)
            .unwrap()
            .tags
            .into_iter()
            .map(|row| {
                let mark = if row.named.is_empty() { "" } else { "#" };
                format!("{mark}{} {}/{}", row.value, row.files, row.folders)
            })
            .collect()
    }

    fn own_of(conn: &Connection, item_id: i64) -> Vec<String> {
        item_effective_tags(conn, item_id)
            .unwrap()
            .into_iter()
            .filter(|tag| tag.from.is_none())
            .map(|tag| tag.value)
            .collect()
    }

    /// What a file was given by hand, whether or not a folder gives it too.
    fn hand_of(conn: &Connection, item_id: i64) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT t.value FROM item_tag it JOIN tag t ON t.id = it.tag_id
                  WHERE it.item_id = ?1 ORDER BY it.added_at, it.rowid",
            )
            .unwrap();
        stmt.query_map(params![item_id], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn carried(conn: &Connection, item_id: i64) -> Vec<String> {
        item_effective_tags(conn, item_id)
            .unwrap()
            .into_iter()
            .map(|tag| match (tag.key, tag.from) {
                (Some(key), Some(from)) => format!("{key}:{}<{}", tag.value, from.title),
                (None, Some(from)) => format!("{}<{}", tag.value, from.title),
                (Some(key), None) => format!("{key}:{}", tag.value),
                (None, None) => tag.value,
            })
            .collect()
    }

    fn held_by(conn: &Connection, folder_id: i64) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT t.key, t.value, ft.source FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                  WHERE ft.folder_id = ?1 ORDER BY ft.rowid",
            )
            .unwrap();
        stmt.query_map(params![folder_id], |r| {
            let key: Option<String> = r.get(0)?;
            let value: String = r.get(1)?;
            let source: String = r.get(2)?;
            let mark = if source == "title" { "#" } else { "" };
            Ok(match key {
                Some(key) => format!("{key}:{value}"),
                None => format!("{mark}{value}"),
            })
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
    }

    fn found_by(conn: &Connection, query: &str) -> Vec<i64> {
        let expr = crate::query::parse(query).unwrap();
        let mut ids: Vec<i64> = search::items(conn, &expr, &crate::db::items::Sort::default())
            .unwrap()
            .into_iter()
            .map(|(row, _)| row.id)
            .collect();
        ids.sort();
        ids
    }

    fn sorted(mut ids: Vec<i64>) -> Vec<i64> {
        ids.sort();
        ids
    }

    /// The effective table as a set-based act left it is what rebuilding each item one at a time
    /// gives.
    fn assert_resolved(conn: &Connection) {
        let rows = |conn: &Connection| -> Vec<(i64, i64, Option<i64>)> {
            let mut stmt = conn
                .prepare(
                    "SELECT item_id, tag_id, origin_id FROM item_effective_tag
                      ORDER BY item_id, tag_id",
                )
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        let left = rows(conn);
        let ids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT id FROM item").unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        for id in ids {
            rebuild_item(conn, id).unwrap();
        }
        assert_eq!(
            left,
            rows(conn),
            "what the act left is what a rebuild gives"
        );
    }

    fn journal_rows(conn: &Connection, batch_id: &str) -> Vec<String> {
        journal::batch(conn, batch_id)
            .unwrap()
            .into_iter()
            .map(|entry| entry.op)
            .collect()
    }

    #[test]
    fn the_list_counts_what_a_search_finds_and_what_each_folder_holds_itself() {
        let lib = library();
        assert_eq!(
            tag_lines(&lib.conn),
            [
                "#beach 1/1",
                "#cairo 2/1",
                "dawn 4/1",
                "egypt 3/1",
                "#family 1/1",
                "golden hour 1/0",
                "#lisbon 2/1",
                "#people 1/1",
                "#pictures 6/1",
                "travel 4/1",
                "#trips 4/1",
                "winter 0/0",
            ]
        );
        let vocabulary = list_tags(&lib.conn).unwrap();
        let lisbon = vocabulary
            .tags
            .iter()
            .find(|row| row.value == "lisbon")
            .unwrap();
        assert_eq!(
            (
                lisbon.named[0].title.as_str(),
                lisbon.own_files,
                lisbon.hand_folders
            ),
            ("Lisbon", 1, 0),
            "Lisbon's name, and given by hand to one file inside it"
        );
        let keys: Vec<String> = vocabulary
            .keys
            .iter()
            .map(|key| {
                let values: Vec<String> = key
                    .values
                    .iter()
                    .map(|value| format!("{} {}/{}", value.value, value.files, value.folders))
                    .collect();
                format!(
                    "{} {}/{} [{}]",
                    key.key,
                    key.files,
                    key.folders,
                    values.join(", ")
                )
            })
            .collect();
        assert_eq!(
            keys,
            [
                "location 4/2 [cairo 2/1, lisbon 2/1]",
                "owner 1/1 [ada 1/1]",
                "place 2/2 [gouna 1/1, home 1/1]",
                "trip 4/1 [egypt 2024 4/1]",
            ]
        );
    }

    #[test]
    fn a_trashed_file_and_a_retired_folder_are_not_counted() {
        let lib = library();
        lib.conn
            .execute(
                "UPDATE item SET deleted_at = 1, trashed_at = 1 WHERE id = ?1",
                params![lib.aunt],
            )
            .unwrap();
        lib.conn
            .execute(
                "UPDATE item SET deleted_at = 1 WHERE id = ?1",
                params![lib.shell],
            )
            .unwrap();
        folders::trash_subtree(&lib.conn, lib.beach).unwrap();
        let lines = tag_lines(&lib.conn);
        assert!(lines.contains(&"golden hour 0/0".to_string()), "{lines:?}");
        assert!(lines.contains(&"dawn 2/0".to_string()), "{lines:?}");
    }

    #[test]
    fn a_rename_changes_the_tag_everywhere_at_once_under_its_own_id_and_undo_puts_it_back() {
        let lib = library();
        let conn = &lib.conn;
        let dawn = id_of(conn, None, "dawn");
        let before = found_by(conn, "tag:dawn");
        let batch = journal::new_batch();
        assert!(rename_tag(conn, dawn, "First  Light", &batch).unwrap());
        assert_eq!(journal_rows(conn, &batch), [journal::RETAG]);
        assert_eq!(id_of(conn, None, "first light"), dawn);
        assert_eq!(found_by(conn, "tag:\"first light\""), before);
        assert!(found_by(conn, "tag:dawn").is_empty());
        assert_eq!(
            held_by(conn, lib.beach),
            ["#beach", "place:gouna", "first light"]
        );
        assert_eq!(own_of(conn, lib.aunt), ["golden hour", "first light"]);
        let described = acts::describe(conn, &batch).unwrap();
        assert_eq!(
            (described.act, described.files, described.folders),
            (
                Act::Retag {
                    change: Change::RenameTag {
                        from: "dawn".into(),
                        to: "first light".into()
                    }
                },
                4,
                1
            )
        );

        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(id_of(conn, None, "dawn"), dawn);
        assert_eq!(found_by(conn, "tag:dawn"), before);
        assert!(found_by(conn, "tag:\"first light\"").is_empty());
        assert_resolved(conn);
    }

    #[test]
    fn a_rename_onto_a_tag_that_exists_is_refused_and_onto_itself_changes_nothing() {
        let lib = library();
        let conn = &lib.conn;
        let dawn = id_of(conn, None, "dawn");
        let refused = rename_tag(conn, dawn, "Golden  Hour", &journal::new_batch()).unwrap_err();
        assert!(matches!(&refused, AppError::Invalid(line) if line.contains("golden hour")));
        assert!(!rename_tag(conn, dawn, " DAWN ", &journal::new_batch()).unwrap());
        assert!(rename_tag(conn, dawn, "  ", &journal::new_batch()).is_err());
        assert_eq!(journal::latest_batch(conn).unwrap(), None);
    }

    #[test]
    fn a_folder_s_name_keeps_its_tag_and_only_the_uses_given_by_hand_are_renamed() {
        let lib = library();
        let conn = &lib.conn;
        let lisbon = id_of(conn, None, "lisbon");
        let batch = journal::new_batch();
        rename_tag(conn, lisbon, "lisboa", &batch).unwrap();
        assert_eq!(id_of(conn, None, "lisbon"), lisbon, "still Lisbon's name");
        assert_eq!(held_by(conn, lib.lisbon), ["#lisbon", "location:lisbon"]);
        assert_eq!(own_of(conn, lib.tower), ["lisboa"]);
        assert_eq!(
            found_by(conn, "tag:lisbon"),
            sorted(vec![lib.tram, lib.tower])
        );
        assert_eq!(
            acts::describe(conn, &batch).unwrap().files,
            0,
            "both still carry lisbon"
        );
        assert_resolved(conn);

        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(hand_of(conn, lib.tower), ["lisbon"]);
        assert!(
            find(conn, None, "lisboa").unwrap().is_none(),
            "the tag it made is gone"
        );
        assert_resolved(conn);
    }

    #[test]
    fn a_merge_moves_every_use_leaving_nothing_twice_and_undo_splits_them_exactly() {
        let lib = library();
        let conn = &lib.conn;
        add_item_tag(conn, lib.shell, "golden hour").unwrap();
        let (dawn, golden) = (id_of(conn, None, "dawn"), id_of(conn, None, "golden hour"));
        let found_dawn = found_by(conn, "tag:dawn");
        let found_golden = found_by(conn, "tag:\"golden hour\"");

        let batch = journal::new_batch();
        assert!(merge_tags(conn, dawn, golden, &batch).unwrap());
        assert!(
            find(conn, None, "dawn").unwrap().is_none(),
            "nothing holds it now"
        );
        assert_eq!(own_of(conn, lib.aunt), ["golden hour"], "not twice");
        assert_eq!(own_of(conn, lib.tram), ["egypt", "golden hour"]);
        assert_eq!(
            held_by(conn, lib.beach),
            ["#beach", "place:gouna", "golden hour"]
        );
        assert_eq!(
            carried(conn, lib.shell),
            [
                "pictures<Pictures",
                "beach<Beach",
                "place:gouna<Beach",
                "golden hour<Beach"
            ],
            "the folder gives it, as it gave dawn"
        );
        let mut both = found_dawn.clone();
        both.extend(&found_golden);
        assert_eq!(
            found_by(conn, "tag:\"golden hour\""),
            sorted(
                both.into_iter()
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect()
            )
        );
        let described = acts::describe(conn, &batch).unwrap();
        assert_eq!((described.files, described.folders), (4, 1));
        assert_resolved(conn);

        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(id_of(conn, None, "dawn"), dawn, "back under its own id");
        assert_eq!(own_of(conn, lib.aunt), ["golden hour", "dawn"]);
        assert_eq!(
            own_of(conn, lib.tram),
            ["egypt", "dawn"],
            "back in its place"
        );
        assert_eq!(held_by(conn, lib.beach), ["#beach", "place:gouna", "dawn"]);
        assert_eq!(found_by(conn, "tag:dawn"), found_dawn);
        assert_eq!(found_by(conn, "tag:\"golden hour\""), found_golden);
        assert_resolved(conn);
    }

    #[test]
    fn a_tag_merged_into_a_folder_s_name_is_carried_from_that_folder() {
        let lib = library();
        let conn = &lib.conn;
        let (egypt, cairo) = (id_of(conn, None, "egypt"), id_of(conn, None, "cairo"));
        merge_tags(conn, egypt, cairo, &journal::new_batch()).unwrap();
        assert_eq!(held_by(conn, lib.cairo), ["#cairo", "location:cairo"]);
        assert_eq!(
            own_of(conn, lib.tram),
            ["cairo", "dawn"],
            "in egypt's place"
        );
        assert_eq!(
            found_by(conn, "tag:cairo"),
            sorted(vec![lib.sphinx, lib.pyramid, lib.tram])
        );
        assert_resolved(conn);
    }

    #[test]
    fn delete_takes_a_tag_off_everything_and_undo_brings_it_back_under_its_own_id() {
        let lib = library();
        let conn = &lib.conn;
        let dawn = id_of(conn, None, "dawn");
        let found = found_by(conn, "tag:dawn");
        let batch = journal::new_batch();
        assert!(delete_tag(conn, dawn, &batch).unwrap());
        assert!(found_by(conn, "tag:dawn").is_empty());
        assert!(find(conn, None, "dawn").unwrap().is_none());
        assert_eq!(held_by(conn, lib.beach), ["#beach", "place:gouna"]);
        let described = acts::describe(conn, &batch).unwrap();
        assert_eq!((described.files, described.folders), (4, 1));
        assert_resolved(conn);

        let report = undo::undo_last(conn).unwrap().unwrap();
        assert_eq!((report.files_back, report.folders_back), (4, 1));
        assert_eq!(id_of(conn, None, "dawn"), dawn);
        assert_eq!(found_by(conn, "tag:dawn"), found);
        assert_eq!(own_of(conn, lib.tram), ["egypt", "dawn"]);
        assert_resolved(conn);
    }

    #[test]
    fn an_unused_tag_goes_and_comes_back_and_a_name_s_delete_keeps_the_name() {
        let lib = library();
        let conn = &lib.conn;
        let winter = id_of(conn, None, "winter");
        let batch = journal::new_batch();
        assert!(delete_tag(conn, winter, &batch).unwrap());
        assert!(find(conn, None, "winter").unwrap().is_none());
        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(id_of(conn, None, "winter"), winter);

        let lisbon = id_of(conn, None, "lisbon");
        delete_tag(conn, lisbon, &journal::new_batch()).unwrap();
        assert!(hand_of(conn, lib.tower).is_empty());
        assert_eq!(held_by(conn, lib.lisbon), ["#lisbon", "location:lisbon"]);
        assert_eq!(
            found_by(conn, "tag:lisbon"),
            sorted(vec![lib.tram, lib.tower])
        );
        assert_resolved(conn);
    }

    #[test]
    fn an_undone_term_whose_id_was_taken_since_comes_back_under_another() {
        let lib = library();
        let conn = &lib.conn;
        let winter = id_of(conn, None, "winter");
        let batch = journal::new_batch();
        delete_tag(conn, winter, &batch).unwrap();
        conn.execute(
            "INSERT INTO tag (id, key, value) VALUES (?1, NULL, 'sleet')",
            params![winter],
        )
        .unwrap();
        undo::undo_batch(conn, &batch).unwrap();
        assert_ne!(id_of(conn, None, "winter"), winter);
        assert_eq!(id_of(conn, None, "sleet"), winter);
    }

    #[test]
    fn an_undone_rename_whose_old_words_were_taken_since_folds_them_back_in() {
        let lib = library();
        let conn = &lib.conn;
        let dawn = id_of(conn, None, "dawn");
        let batch = journal::new_batch();
        rename_tag(conn, dawn, "sunrise", &batch).unwrap();
        add_item_tag(conn, lib.pyramid, "dawn").unwrap();
        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(id_of(conn, None, "dawn"), dawn);
        assert_eq!(own_of(conn, lib.pyramid), ["dawn"]);
        assert!(found_by(conn, "tag:dawn").contains(&lib.shell));
        assert_resolved(conn);
    }

    #[test]
    fn a_key_renamed_moves_with_every_value_and_onto_one_that_exists_is_refused() {
        let lib = library();
        let conn = &lib.conn;
        let refused = rename_key(conn, "place", "owner", &journal::new_batch()).unwrap_err();
        assert!(matches!(refused, AppError::Invalid(_)));

        let batch = journal::new_batch();
        assert!(rename_key(conn, "Place", "Spot", &batch).unwrap());
        assert_eq!(held_by(conn, lib.beach), ["#beach", "spot:gouna", "dawn"]);
        assert_eq!(found_by(conn, "spot:gouna"), [lib.shell]);
        assert!(found_by(conn, "place:*").is_empty());
        let described = acts::describe(conn, &batch).unwrap();
        assert_eq!((described.files, described.folders), (2, 2));

        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(found_by(conn, "place:*"), sorted(vec![lib.aunt, lib.shell]));
        assert_resolved(conn);
    }

    #[test]
    fn a_key_merge_is_refused_from_above_from_below_and_on_a_folder_holding_both() {
        let lib = library();
        let conn = &lib.conn;
        assert_eq!(
            key_clash(conn, "place", "owner").unwrap(),
            Some(KeyClash::Above {
                folder: "Family".into(),
                above: "People".into()
            })
        );
        assert_eq!(
            key_clash(conn, "trip", "location").unwrap(),
            Some(KeyClash::Below {
                folder: "Trips".into(),
                below: "Cairo".into()
            })
        );
        set_folder_label(conn, lib.lisbon, "season", "spring").unwrap();
        assert_eq!(
            key_clash(conn, "season", "location").unwrap(),
            Some(KeyClash::Both {
                folder: "Lisbon".into()
            })
        );
        assert!(merge_keys(conn, "place", "owner", &journal::new_batch()).is_err());
        assert_eq!(
            held_by(conn, lib.family),
            ["#family", "place:home"],
            "nothing in part"
        );
        assert_eq!(journal::latest_batch(conn).unwrap(), None);
    }

    #[test]
    fn keys_merged_keep_each_folder_s_value_and_undo_splits_them_again() {
        let lib = library();
        let conn = &lib.conn;
        set_folder_label(conn, lib.beach, "place", "cairo").unwrap();
        let cairo_place = id_of(conn, Some("place"), "cairo");
        assert_eq!(key_clash(conn, "place", "location").unwrap(), None);

        let batch = journal::new_batch();
        assert!(merge_keys(conn, "place", "location", &batch).unwrap());
        assert_eq!(held_by(conn, lib.family), ["#family", "location:home"]);
        assert_eq!(
            held_by(conn, lib.beach),
            ["#beach", "location:cairo", "dawn"]
        );
        assert_eq!(
            found_by(conn, "location:cairo"),
            sorted(vec![lib.sphinx, lib.pyramid, lib.shell])
        );
        assert!(find(conn, Some("place"), "cairo").unwrap().is_none());
        assert_resolved(conn);

        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(held_by(conn, lib.family), ["#family", "place:home"]);
        assert_eq!(held_by(conn, lib.beach), ["#beach", "place:cairo", "dawn"]);
        assert_eq!(id_of(conn, Some("place"), "cairo"), cairo_place);
        assert_eq!(
            found_by(conn, "location:cairo"),
            sorted(vec![lib.sphinx, lib.pyramid])
        );
        assert_resolved(conn);
    }

    #[test]
    fn a_key_deleted_comes_off_every_folder_and_comes_back_whole() {
        let lib = library();
        let conn = &lib.conn;
        let batch = journal::new_batch();
        delete_key(conn, "location", &batch).unwrap();
        assert!(found_by(conn, "location:*").is_empty());
        assert_eq!(held_by(conn, lib.cairo), ["#cairo", "egypt"]);
        let described = acts::describe(conn, &batch).unwrap();
        assert_eq!((described.files, described.folders), (4, 2));
        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(
            held_by(conn, lib.cairo),
            ["#cairo", "egypt", "location:cairo"]
        );
        assert_eq!(found_by(conn, "location:*").len(), 4);
        assert_resolved(conn);
    }

    #[test]
    fn a_value_renamed_merged_or_deleted_stays_with_its_key() {
        let lib = library();
        let conn = &lib.conn;
        let (cairo, lisbon) = (
            id_of(conn, Some("location"), "cairo"),
            id_of(conn, Some("location"), "lisbon"),
        );
        let gouna = id_of(conn, Some("place"), "gouna");
        assert!(merge_values(conn, cairo, gouna, &journal::new_batch()).is_err());
        assert!(rename_value(conn, cairo, "Lisbon", &journal::new_batch()).is_err());

        let renamed = journal::new_batch();
        rename_value(conn, cairo, "Giza", &renamed).unwrap();
        assert_eq!(
            found_by(conn, "location:giza"),
            sorted(vec![lib.sphinx, lib.pyramid])
        );
        assert_eq!(
            found_by(conn, "giza"),
            sorted(vec![lib.sphinx, lib.pyramid])
        );
        let merged = journal::new_batch();
        merge_values(conn, lisbon, cairo, &merged).unwrap();
        assert_eq!(held_by(conn, lib.lisbon), ["#lisbon", "location:giza"]);
        assert_eq!(found_by(conn, "location:giza").len(), 4);
        assert_resolved(conn);

        undo::undo_batch(conn, &merged).unwrap();
        undo::undo_batch(conn, &renamed).unwrap();
        assert_eq!(held_by(conn, lib.lisbon), ["#lisbon", "location:lisbon"]);
        assert_eq!(
            found_by(conn, "location:cairo"),
            sorted(vec![lib.sphinx, lib.pyramid])
        );

        let deleted = journal::new_batch();
        delete_value(conn, lisbon, &deleted).unwrap();
        assert_eq!(held_by(conn, lib.lisbon), ["#lisbon"]);
        assert!(found_by(conn, "location:lisbon").is_empty());
        undo::undo_batch(conn, &deleted).unwrap();
        assert_eq!(held_by(conn, lib.lisbon), ["#lisbon", "location:lisbon"]);
        assert_resolved(conn);
    }

    #[test]
    fn a_value_deleted_lets_the_one_above_reach_the_files_again() {
        let lib = library();
        let conn = &lib.conn;
        set_folder_label(conn, lib.root, "season", "summer").unwrap();
        let winter = get_or_create_tag(conn, Some("season"), "winter").unwrap();
        conn.execute(
            "INSERT INTO folder_tag (folder_id, tag_id, source) VALUES (?1, ?2, 'manual')",
            params![lib.cairo, winter],
        )
        .unwrap();
        rebuild_item(conn, lib.sphinx).unwrap();
        assert!(carried(conn, lib.sphinx).contains(&"season:winter<Cairo".to_string()));
        delete_value(conn, winter, &journal::new_batch()).unwrap();
        assert!(carried(conn, lib.sphinx).contains(&"season:summer<Pictures".to_string()));
        assert_resolved(conn);
    }

    #[test]
    fn a_folder_in_the_trash_keeps_its_place_through_an_act_and_its_undo() {
        let lib = library();
        let conn = &lib.conn;
        folders::trash_subtree(conn, lib.beach).unwrap();
        let dawn = id_of(conn, None, "dawn");
        let batch = journal::new_batch();
        delete_tag(conn, dawn, &batch).unwrap();
        assert_eq!(held_by(conn, lib.beach), ["#beach", "place:gouna"]);
        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(held_by(conn, lib.beach), ["#beach", "place:gouna", "dawn"]);
    }

    #[test]
    fn five_thousand_files_merge_in_one_row_and_come_back() {
        let lib = library();
        let conn = &lib.conn;
        conn.execute(
            "WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 4999)
             INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, size_bytes, mtime, kind,
                               added_at)
             SELECT 'bulk-' || i, 1, ?1, printf('%04d.jpg', i), 'jpg', 1, 0, 'image', 0 FROM n",
            params![lib.trips],
        )
        .unwrap();
        let ids = |sql: &str| -> Vec<i64> {
            let mut stmt = conn.prepare(sql).unwrap();
            stmt.query_map([], |r| r.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        let set = ids("SELECT id FROM item WHERE uuid LIKE 'bulk-%' ORDER BY id");
        let every = ids("SELECT id FROM tag");
        resolve(conn, &set, &every).unwrap();
        tags::add_items_tag(conn, &set[..3_120], "felucca", &journal::new_batch()).unwrap();
        let (felucca, travel) = (id_of(conn, None, "felucca"), id_of(conn, None, "travel"));
        let batch = journal::new_batch();
        merge_tags(conn, felucca, travel, &batch).unwrap();
        assert_eq!(journal_rows(conn, &batch), [journal::RETAG]);
        assert!(
            set.iter().all(|id| own_of(conn, *id).is_empty()),
            "Trips gives travel"
        );
        undo::undo_batch(conn, &batch).unwrap();
        assert_eq!(found_by(conn, "tag:felucca"), sorted(set[..3_120].to_vec()));
    }
}
