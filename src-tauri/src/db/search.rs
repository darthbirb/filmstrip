//! A query's tree as SQL, run for the files and the folders it finds; and the text index a bare
//! word is matched against, kept as rows change. SCHEMA.md "Query language".

use std::collections::HashSet;

use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, ToSql, params, params_from_iter};
use serde::Serialize;
use ts_rs::TS;

use crate::db::fold;
use crate::db::folders::Crumb;
use crate::db::items::{self, ItemRow};
use crate::error::Result;
use crate::media::probe::days_from_civil;
use crate::query::{Expr, IsFlag, LabelMatch, StatusValue, Term, split_path_segments};

/// The values a condition's `?`s take, in the order its text was written. Every value is bound,
/// never written into the text.
struct Sql {
    values: Vec<Value>,
}

impl Sql {
    fn new() -> Self {
        Sql { values: Vec::new() }
    }

    fn bind(&mut self, value: impl Into<Value>) {
        self.values.push(value.into());
    }

    fn bound(&self) -> Vec<&dyn ToSql> {
        self.values.iter().map(|v| v as &dyn ToSql).collect()
    }
}

const NOTHING: &str = "(1 = 0)";

/// `%`, `_` and `\` are LIKE's own, so a value that holds one is matched as itself.
pub(crate) fn escape_like(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn in_list(column: &str, ids: &[i64], sql: &mut Sql) -> String {
    if ids.is_empty() {
        return NOTHING.into();
    }
    for id in ids {
        sql.bind(*id);
    }
    format!("({column} IN ({}))", vec!["?"; ids.len()].join(","))
}

/// Whether the query asks for the Trash anywhere, negated or not: only then may a trashed file
/// be found at all.
fn mentions_trash(expr: &Expr) -> bool {
    match expr {
        Expr::And(parts) | Expr::Or(parts) => parts.iter().any(mentions_trash),
        Expr::Not(inner) => mentions_trash(inner),
        Expr::Term(term) => *term == Term::Is(IsFlag::Trashed),
    }
}

// Files.

/// Every file the query finds, and when it went to the Trash for one that is there. Trashed
/// files come first, newest first, then the rest by name. DECISIONS.md "Search".
pub fn items(conn: &Connection, expr: &Expr) -> Result<Vec<(ItemRow, Option<i64>)>> {
    let mut sql = Sql::new();
    let found = item_condition(conn, expr, &mut sql)?;
    let alive = if mentions_trash(expr) {
        "(i.deleted_at IS NULL OR i.trashed_at IS NOT NULL)"
    } else {
        "i.deleted_at IS NULL"
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT {}, i.trashed_at FROM item i
          WHERE {alive} AND {found}
          ORDER BY i.trashed_at IS NULL, i.trashed_at DESC, i.disk_name COLLATE NOCASE, i.id",
        items::ROW
    ))?;
    let rows = stmt
        .query_map(sql.bound().as_slice(), |r| {
            Ok((items::row(r)?, r.get(items::ROW_WIDTH)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn item_condition(conn: &Connection, expr: &Expr, sql: &mut Sql) -> Result<String> {
    Ok(match expr {
        Expr::And(parts) | Expr::Or(parts) => {
            let joiner = if matches!(expr, Expr::And(_)) {
                " AND "
            } else {
                " OR "
            };
            let parts = parts
                .iter()
                .map(|part| item_condition(conn, part, sql))
                .collect::<Result<Vec<_>>>()?;
            format!("({})", parts.join(joiner))
        }
        Expr::Not(inner) => format!("(NOT {})", item_condition(conn, inner, sql)?),
        Expr::Term(term) => item_term(conn, term, sql)?,
    })
}

/// Through the tags an item carries, its folders' included.
fn carries(predicate: &str) -> String {
    format!(
        "(EXISTS (SELECT 1 FROM item_effective_tag e JOIN tag t ON t.id = e.tag_id
                   WHERE e.item_id = i.id AND {predicate}))"
    )
}

fn item_term(conn: &Connection, term: &Term, sql: &mut Sql) -> Result<String> {
    let compare = |column: &str, cmp: crate::query::Cmp, value: i64, sql: &mut Sql| {
        sql.bind(value);
        format!("({column} {} ?)", cmp.sql())
    };
    Ok(match term {
        Term::Path { path, exact } => {
            let folders = resolve_path(conn, path)?;
            let ids = if *exact {
                folders
            } else {
                subtrees(conn, &folders, true)?
            };
            in_list("i.folder_id", &ids, sql)
        }
        Term::Tag { .. } | Term::Label { .. } | Term::AnyLabel { .. } => {
            let predicate = tag_row(term, sql).unwrap_or_else(|| NOTHING.into());
            carries(&predicate)
        }
        Term::Bare { text } => {
            sql.bind(fold(text));
            let tagged = carries("t.value = ?");
            match phrase(text) {
                Some(words) => {
                    sql.bind(words);
                    format!(
                        "({tagged} OR i.id IN (SELECT rowid FROM item_fts WHERE item_fts MATCH ?))"
                    )
                }
                None => tagged,
            }
        }
        Term::Type(kind) => {
            sql.bind(kind.clone());
            "(i.kind = ?)".into()
        }
        Term::Year(year) => {
            let year = i64::from(*year);
            dated(
                days_from_civil(year, 1, 1) * 86_400,
                days_from_civil(year + 1, 1, 1) * 86_400,
                sql,
            )
        }
        Term::DateRange { from, to } => dated(*from, *to, sql),
        Term::Duration { cmp, ms } => compare("i.duration_ms", *cmp, *ms, sql),
        Term::Size { cmp, bytes } => compare("i.size_bytes", *cmp, *bytes, sql),
        Term::Width { cmp, px } => compare("i.width", *cmp, *px, sql),
        Term::Height { cmp, px } => compare("i.height", *cmp, *px, sql),
        Term::Is(IsFlag::Favorite) => "(i.favorite = 1)".into(),
        Term::Is(IsFlag::Untagged) => {
            "(NOT EXISTS (SELECT 1 FROM item_tag it WHERE it.item_id = i.id))".into()
        }
        Term::Is(IsFlag::Sorting) => {
            "(EXISTS (SELECT 1 FROM source s WHERE s.id = i.source_id AND s.kind = 'sorting'))"
                .into()
        }
        Term::Is(IsFlag::Trashed) => "(i.trashed_at IS NOT NULL)".into(),
        Term::Status(status) => {
            let wip = || status_subtrees(conn, "wip");
            let complete = || status_subtrees(conn, "complete");
            match status {
                StatusValue::Wip => in_list("i.folder_id", &wip()?, sql),
                StatusValue::Complete => in_list("i.folder_id", &complete()?, sql),
                StatusValue::None => {
                    let mut held = wip()?;
                    held.extend(complete()?);
                    if held.is_empty() {
                        "(1 = 1)".into()
                    } else {
                        format!("(NOT {})", in_list("i.folder_id", &held, sql))
                    }
                }
            }
        }
    })
}

/// Of the date it was taken, or else the date it was last changed.
fn dated(from: i64, to: i64, sql: &mut Sql) -> String {
    sql.bind(from);
    sql.bind(to);
    "(COALESCE(i.captured_at, i.mtime) >= ? AND COALESCE(i.captured_at, i.mtime) < ?)".into()
}

/// A word as one FTS5 phrase, so what the person typed is never read as FTS5's own syntax. The
/// `*` lets its last word be the beginning of one. DECISIONS.md "Search".
fn phrase(text: &str) -> Option<String> {
    (!text.trim().is_empty()).then(|| format!("\"{}\"*", text.replace('"', "\"\"")))
}

/// A term as a condition over one `tag t` row, for the four kinds a tag row can answer.
fn tag_row(term: &Term, sql: &mut Sql) -> Option<String> {
    let value = |value: &LabelMatch, sql: &mut Sql| match value {
        LabelMatch::Present => String::new(),
        LabelMatch::Exact(v) => {
            sql.bind(fold(v));
            " AND t.value = ?".into()
        }
        LabelMatch::Prefix(v) => {
            sql.bind(format!("{}%", escape_like(&fold(v))));
            " AND t.value LIKE ? ESCAPE '\\'".into()
        }
    };
    match term {
        Term::Tag {
            value: v,
            prefix: false,
        } => Some(format!(
            "(t.key IS NULL{})",
            value(&LabelMatch::Exact(v.clone()), sql)
        )),
        Term::Tag {
            value: v,
            prefix: true,
        } => Some(format!(
            "(t.key IS NULL{})",
            value(&LabelMatch::Prefix(v.clone()), sql)
        )),
        Term::Label { key, value: v } => {
            sql.bind(fold(key));
            Some(format!("(t.key = ?{})", value(v, sql)))
        }
        Term::AnyLabel { value: v } => Some(format!("(t.key IS NOT NULL{})", value(v, sql))),
        Term::Bare { text } => {
            sql.bind(fold(text));
            Some("(t.value = ?)".into())
        }
        _ => None,
    }
}

/// Every live folder a path names. The first title is a source's, and two sources may share one.
pub(crate) fn resolve_path(conn: &Connection, path: &str) -> Result<Vec<i64>> {
    let mut titles = split_path_segments(path).into_iter();
    let Some(source) = titles.next() else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare(
        "SELECT id FROM folder
          WHERE parent_id IS NULL AND deleted_at IS NULL AND title = ?1 COLLATE NOCASE",
    )?;
    let mut here: Vec<i64> = stmt
        .query_map(params![source], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for title in titles {
        let mut next = Vec::new();
        for parent in here {
            next.extend(crate::db::folders::child_id(conn, parent, &title)?);
        }
        here = next;
    }
    Ok(here)
}

/// Every live folder at or below these, or only below them.
fn subtrees(conn: &Connection, roots: &[i64], with_roots: bool) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "WITH RECURSIVE subtree(id) AS (
             SELECT ?1
           UNION ALL
             SELECT f.id FROM folder f JOIN subtree s ON f.parent_id = s.id
              WHERE f.deleted_at IS NULL
         )
         SELECT id FROM subtree",
    )?;
    let mut all = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        for id in stmt.query_map(params![root], |r| r.get::<_, i64>(0))? {
            let id = id?;
            if (with_roots || id != *root) && seen.insert(id) {
                all.push(id);
            }
        }
    }
    Ok(all)
}

/// The folders carrying a status themselves, with everything below them.
fn status_subtrees(conn: &Connection, status: &str) -> Result<Vec<i64>> {
    let mut stmt =
        conn.prepare("SELECT id FROM folder WHERE status = ?1 AND deleted_at IS NULL")?;
    let roots: Vec<i64> = stmt
        .query_map(params![status], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    subtrees(conn, &roots, true)
}

// Folders.

/// A folder the query found, and the term that found it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderMatch {
    pub id: i64,
    pub source_id: i64,
    pub title: String,
    /// From its source's own folder, by the source's title, down to it, as a place is named.
    pub path: Vec<Crumb>,
    /// Every live file at or below it, and those directly in it.
    pub count: i64,
    pub own_count: i64,
    /// The picture that stands for it, once its thumbnail is made. Filled by the command.
    pub cover: Option<String>,
    #[serde(skip)]
    pub cover_uuid: Option<String>,
    pub matched: Matched,
}

/// What a folder matched on, said key first. PRODUCT.md "Tags and labels".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Matched {
    /// Its name, or anything that is not a tag, such as its place or its status.
    Name {
        value: String,
    },
    Tag {
        value: String,
    },
    Label {
        key: String,
        value: String,
    },
}

/// Every live folder the query finds by what the folder itself carries, never by what its files
/// or its ancestors do. A path only limits: the folder it names is not one of its results.
pub fn folders(conn: &Connection, expr: &Expr) -> Result<Vec<FolderMatch>> {
    let mut sql = Sql::new();
    let found = folder_condition(conn, expr, &mut sql)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT f.id, f.title FROM folder f
          WHERE f.deleted_at IS NULL AND {found}
          ORDER BY f.title COLLATE NOCASE, f.id"
    ))?;
    let rows: Vec<(i64, String)> = stmt
        .query_map(sql.bound().as_slice(), |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let conjuncts: Vec<&Expr> = match expr {
        Expr::And(parts) => parts.iter().collect(),
        other => vec![other],
    };
    let mut matches = Vec::with_capacity(rows.len());
    for (id, title) in rows {
        let source_id = crate::db::folders::location(conn, id)?.source_id;
        matches.push(FolderMatch {
            id,
            source_id,
            matched: matched(conn, &conjuncts, id, &title)?,
            title,
            path: crate::db::folders::ancestry(conn, id)?,
            count: live_count(conn, id)?,
            own_count: crate::db::folders::own_count(conn, id)?,
            cover: None,
            cover_uuid: crate::db::details::cover(conn, id)?.map(|(_, uuid)| uuid),
        });
    }
    Ok(matches)
}

fn folder_condition(conn: &Connection, expr: &Expr, sql: &mut Sql) -> Result<String> {
    Ok(match expr {
        Expr::And(parts) | Expr::Or(parts) => {
            let joiner = if matches!(expr, Expr::And(_)) {
                " AND "
            } else {
                " OR "
            };
            let parts = parts
                .iter()
                .map(|part| folder_condition(conn, part, sql))
                .collect::<Result<Vec<_>>>()?;
            format!("({})", parts.join(joiner))
        }
        Expr::Not(inner) => format!("(NOT {})", folder_condition(conn, inner, sql)?),
        Expr::Term(term) => folder_term(conn, term, sql)?,
    })
}

/// A folder has no kind, size, length or date, and is never in the Trash, so a term about any
/// of those finds no folder at all.
fn folder_term(conn: &Connection, term: &Term, sql: &mut Sql) -> Result<String> {
    Ok(match term {
        Term::Path { path, exact } => {
            let named = resolve_path(conn, path)?;
            if *exact {
                in_list("f.parent_id", &named, sql)
            } else {
                in_list("f.id", &subtrees(conn, &named, false)?, sql)
            }
        }
        Term::Tag { .. } | Term::Label { .. } | Term::AnyLabel { .. } => {
            let predicate = tag_row(term, sql).unwrap_or_else(|| NOTHING.into());
            owns(&predicate)
        }
        Term::Bare { text } => {
            sql.bind(fold(text));
            let tagged = owns("t.value = ?");
            match phrase(text) {
                Some(words) => {
                    sql.bind(words);
                    format!(
                        "({tagged} OR f.id IN (SELECT rowid FROM folder_fts WHERE folder_fts MATCH ?))"
                    )
                }
                None => tagged,
            }
        }
        Term::Status(StatusValue::None) => "(f.status IS NULL)".into(),
        Term::Status(status) => {
            let word = if *status == StatusValue::Wip {
                "wip"
            } else {
                "complete"
            };
            sql.bind(word.to_owned());
            "(f.status = ?)".into()
        }
        Term::Is(IsFlag::Favorite) => "(f.favorite = 1)".into(),
        Term::Is(IsFlag::Sorting) => {
            let mut stmt = conn.prepare(
                "SELECT f.id FROM folder f JOIN source s ON s.id = f.source_id
                  WHERE f.parent_id IS NULL AND s.kind = 'sorting'",
            )?;
            let roots: Vec<i64> = stmt
                .query_map([], |r| r.get(0))?
                .collect::<rusqlite::Result<_>>()?;
            in_list("f.id", &subtrees(conn, &roots, true)?, sql)
        }
        _ => NOTHING.into(),
    })
}

/// Through the tags a folder carries itself.
fn owns(predicate: &str) -> String {
    format!(
        "(EXISTS (SELECT 1 FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                   WHERE ft.folder_id = f.id AND {predicate}))"
    )
}

/// The tag that explains a folder's match: a label before a tag before its name. A folder found
/// by anything else is said by its name.
fn matched(conn: &Connection, conjuncts: &[&Expr], folder_id: i64, title: &str) -> Result<Matched> {
    let mut sql = Sql::new();
    sql.bind(folder_id);
    let clauses: Vec<String> = conjuncts
        .iter()
        .filter_map(|part| match part {
            Expr::Term(term) => tag_row(term, &mut sql),
            _ => None,
        })
        .collect();
    let named = || Matched::Name {
        value: title.to_owned(),
    };
    if clauses.is_empty() {
        return Ok(named());
    }
    let found: Option<(Option<String>, String, String)> = conn
        .query_row(
            &format!(
                "SELECT t.key, t.value, ft.source FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                  WHERE ft.folder_id = ? AND ({})
                  ORDER BY t.key IS NULL, ft.source = 'title', t.id LIMIT 1",
                clauses.join(" OR ")
            ),
            sql.bound().as_slice(),
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    Ok(match found {
        Some((Some(key), value, _)) => Matched::Label { key, value },
        Some((None, value, source)) if source != "title" => Matched::Tag { value },
        _ => named(),
    })
}

fn live_count(conn: &Connection, folder_id: i64) -> Result<i64> {
    let ids = subtrees(conn, &[folder_id], true)?;
    Ok(conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM item WHERE deleted_at IS NULL AND folder_id IN ({})",
            vec!["?"; ids.len()].join(",")
        ),
        params_from_iter(ids),
        |r| r.get(0),
    )?)
}

// The text index.

/// Writes an item's row again from its name and every tag it carries. `tags::rebuild_item` calls
/// it, so anything that changes what an item carries keeps its row current.
pub fn index_item(conn: &Connection, item_id: i64) -> Result<()> {
    conn.execute("DELETE FROM item_fts WHERE rowid = ?1", params![item_id])?;
    conn.execute(
        "INSERT INTO item_fts (rowid, name, tags)
         SELECT i.id, i.disk_name,
                COALESCE((SELECT group_concat(t.value, ' ')
                            FROM item_effective_tag e JOIN tag t ON t.id = e.tag_id
                           WHERE e.item_id = i.id), '')
           FROM item i WHERE i.id = ?1",
        params![item_id],
    )?;
    Ok(())
}

/// Writes a folder's row again from the tags it carries itself.
pub fn index_folder(conn: &Connection, folder_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM folder_fts WHERE rowid = ?1",
        params![folder_id],
    )?;
    conn.execute(
        "INSERT INTO folder_fts (rowid, tags)
         SELECT f.id,
                COALESCE((SELECT group_concat(t.value, ' ')
                            FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                           WHERE ft.folder_id = f.id), '')
           FROM folder f WHERE f.id = ?1",
        params![folder_id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    //! One library, every kind of term run against its real rows.

    use std::path::Path;

    use super::*;
    use crate::db::items::NewItem;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, folders, tags};
    use crate::query::{bare_term, label_term, parse, path_term};

    struct Library {
        conn: Connection,
        people: i64,
        ana: i64,
        bob: i64,
        lisbon: i64,
        pinned: i64,
        sunset: i64,
        clip: i64,
        view: i64,
        keepsake: i64,
    }

    const MB: i64 = 1 << 20;

    fn seconds(y: i64, m: i64, d: i64) -> i64 {
        days_from_civil(y, m, d) * 86_400
    }

    fn open() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    fn source(conn: &Connection, root: &str, title: &str, kind: SourceKind) -> (i64, i64) {
        let source = sources::add(conn, Path::new(root), title, kind).unwrap();
        (
            source.id,
            folders::source_root_folder(conn, source.id).unwrap(),
        )
    }

    /// A file as a walk records it: its row, then everything it carries.
    fn file(conn: &Connection, source_id: i64, folder_id: i64, name: &str, shape: Shape) -> i64 {
        let kind = if name.ends_with(".mp4") {
            "video"
        } else {
            "image"
        };
        let id = items::upsert(
            conn,
            &NewItem {
                uuid: format!("uuid-{folder_id}-{name}"),
                source_id,
                folder_id,
                disk_name: name.into(),
                ext: crate::fs::paths::extension_of(name),
                orig_name: name.into(),
                hash: None,
                size_bytes: shape.size,
                mtime: shape.mtime,
                kind: kind.into(),
                width: shape.width,
                height: shape.height,
                duration_ms: shape.duration_ms,
                codec: None,
                bitrate: None,
                captured_at: shape.captured_at,
                captured_src: shape.captured_at.map(|_| "exif".into()),
            },
        )
        .unwrap();
        tags::rebuild_item(conn, id).unwrap();
        id
    }

    #[derive(Clone, Copy)]
    struct Shape {
        size: i64,
        mtime: i64,
        width: Option<i64>,
        height: Option<i64>,
        duration_ms: Option<i64>,
        captured_at: Option<i64>,
    }

    fn plain(size: i64, year: i64) -> Shape {
        Shape {
            size,
            mtime: seconds(year, 1, 1),
            width: None,
            height: None,
            duration_ms: None,
            captured_at: None,
        }
    }

    /// Library: People/Ana (wip, tag beach, label instagram:@ana), People/Bob (complete, one file
    /// in the Trash), Places/Lisbon, Pinned Folder. Archive: People. Incoming, a sorting source.
    fn library() -> Library {
        let conn = open();
        let (lib, root) = source(&conn, "D:/library", "Library", SourceKind::Library);
        let people = folders::create(&conn, root, "People").unwrap();
        let ana = folders::create(&conn, people, "Ana").unwrap();
        let bob = folders::create(&conn, people, "Bob").unwrap();
        let places = folders::create(&conn, root, "Places").unwrap();
        let lisbon = folders::create(&conn, places, "Lisbon").unwrap();
        let pinned = folders::create(&conn, root, "Pinned Folder").unwrap();
        conn.execute("UPDATE folder SET status = 'wip' WHERE id = ?1", [ana])
            .unwrap();
        conn.execute("UPDATE folder SET status = 'complete' WHERE id = ?1", [bob])
            .unwrap();
        tags::add_folder_tag(&conn, ana, "beach").unwrap();
        tags::set_folder_label(&conn, ana, "instagram", "@ana").unwrap();

        let sunset = file(
            &conn,
            lib,
            ana,
            "sunset_at_beach.jpg",
            Shape {
                width: Some(1920),
                height: Some(1080),
                captured_at: Some(seconds(2024, 6, 15)),
                ..plain(50 * MB, 2024)
            },
        );
        let clip = file(
            &conn,
            lib,
            ana,
            "ana_clip.mp4",
            Shape {
                width: Some(1280),
                height: Some(720),
                duration_ms: Some(45_000),
                captured_at: Some(seconds(2023, 1, 10)),
                ..plain(5 * MB, 2023)
            },
        );
        file(
            &conn,
            lib,
            bob,
            "bob_at_beach.jpg",
            Shape {
                width: Some(800),
                height: Some(600),
                ..plain(10 * MB, 2022)
            },
        );
        let gone = file(&conn, lib, bob, "old_trashed.jpg", plain(MB, 2019));
        items::send_to_trash(&conn, gone).unwrap();
        let view = file(
            &conn,
            lib,
            lisbon,
            "lisbon_view.png",
            Shape {
                width: Some(1024),
                height: Some(768),
                ..plain(2 * MB, 2021)
            },
        );
        tags::add_item_tag(&conn, view, "cityscape").unwrap();
        let keepsake = file(&conn, lib, pinned, "keepsake.jpg", plain(MB, 2020));
        items::set_favorite(&conn, &[sunset], true).unwrap();

        let (archive, archive_root) = source(&conn, "E:/archive", "Archive", SourceKind::Library);
        let old_people = folders::create(&conn, archive_root, "People").unwrap();
        file(
            &conn,
            archive,
            old_people,
            "old_portrait.jpg",
            plain(MB, 2018),
        );

        let (incoming, incoming_root) =
            source(&conn, "D:/incoming", "Incoming", SourceKind::Sorting);
        file(
            &conn,
            incoming,
            incoming_root,
            "loose_snapshot.jpg",
            plain(MB, 2020),
        );

        Library {
            conn,
            people,
            ana,
            bob,
            lisbon,
            pinned,
            sunset,
            clip,
            view,
            keepsake,
        }
    }

    /// Every file the query finds, by name, in the order found.
    fn found(conn: &Connection, query: &str) -> Vec<String> {
        items(conn, &parse(query).unwrap())
            .unwrap()
            .into_iter()
            .map(|(row, _)| row.disk_name)
            .collect()
    }

    fn found_folders(conn: &Connection, query: &str) -> Vec<String> {
        folders(conn, &parse(query).unwrap())
            .unwrap()
            .into_iter()
            .map(|folder| folder.title)
            .collect()
    }

    fn folder_ids(conn: &Connection, query: &str) -> Vec<i64> {
        folders(conn, &parse(query).unwrap())
            .unwrap()
            .into_iter()
            .map(|folder| folder.id)
            .collect()
    }

    #[test]
    fn a_word_is_a_tag_and_a_name_at_once() {
        let l = library();
        assert_eq!(
            found(&l.conn, "beach"),
            ["ana_clip.mp4", "bob_at_beach.jpg", "sunset_at_beach.jpg"],
            "Ana's tag, and Bob's file's own name"
        );
        assert_eq!(
            found(&l.conn, "tag:beach"),
            ["ana_clip.mp4", "sunset_at_beach.jpg"]
        );
    }

    #[test]
    fn a_word_is_a_folder_title_every_file_below_it_carries() {
        let l = library();
        assert_eq!(
            found(&l.conn, "ana"),
            ["ana_clip.mp4", "sunset_at_beach.jpg"]
        );
        assert_eq!(
            found(&l.conn, "people"),
            [
                "ana_clip.mp4",
                "bob_at_beach.jpg",
                "old_portrait.jpg",
                "sunset_at_beach.jpg"
            ]
        );
    }

    #[test]
    fn a_word_is_a_label_value_or_part_of_a_name() {
        let l = library();
        assert_eq!(
            found(&l.conn, "@ana"),
            ["ana_clip.mp4", "sunset_at_beach.jpg"]
        );
        assert_eq!(found(&l.conn, "view"), ["lisbon_view.png"]);
        assert!(found(&l.conn, "nonexistentword").is_empty());
        assert!(
            found(&l.conn, "\"\"").is_empty(),
            "an empty word finds nothing"
        );
    }

    #[test]
    fn a_word_finds_what_begins_with_it_and_not_what_only_holds_it() {
        let l = library();
        assert_eq!(found(&l.conn, "sun"), ["sunset_at_beach.jpg"]);
        assert_eq!(found_folders(&l.conn, "lis"), ["Lisbon"]);
        assert_eq!(found_folders(&l.conn, "pin"), ["Pinned Folder"]);
        assert_eq!(
            found_folders(&l.conn, "\"pinned fol\""),
            ["Pinned Folder"],
            "only the last word of a phrase is a beginning"
        );
        assert!(found(&l.conn, "each").is_empty(), "not the middle of beach");
        assert!(found_folders(&l.conn, "isbon").is_empty());
        assert!(found_folders(&l.conn, "\"pin folder\"").is_empty());
    }

    #[test]
    fn tags_and_labels_exactly_by_prefix_and_present() {
        let l = library();
        assert_eq!(
            found(&l.conn, "tag:bea*"),
            ["ana_clip.mp4", "sunset_at_beach.jpg"]
        );
        assert!(found(&l.conn, "tag:nope").is_empty());
        for query in ["instagram:@ana", "instagram:*", "instagram:@a*", ":@ana"] {
            assert_eq!(
                found(&l.conn, query),
                ["ana_clip.mp4", "sunset_at_beach.jpg"],
                "{query}"
            );
        }
        assert!(found(&l.conn, "instagram:@bob").is_empty());
        assert!(
            found(&l.conn, "tag:50%_off").is_empty(),
            "LIKE's own characters are text"
        );
    }

    #[test]
    fn a_path_starts_at_a_source() {
        let l = library();
        assert_eq!(
            found(&l.conn, "path:Library/People"),
            ["ana_clip.mp4", "bob_at_beach.jpg", "sunset_at_beach.jpg"]
        );
        assert_eq!(found(&l.conn, "path:archive/people"), ["old_portrait.jpg"]);
        assert!(found(&l.conn, "path:=Library/People").is_empty());
        assert_eq!(
            found(&l.conn, "path:=Library/People/Ana"),
            ["ana_clip.mp4", "sunset_at_beach.jpg"]
        );
        assert!(
            found(&l.conn, "path:People").is_empty(),
            "People is no source"
        );
        assert!(found(&l.conn, "path:Library/nowhere/at/all").is_empty());
    }

    #[test]
    fn two_sources_of_one_title_are_both_a_paths_start() {
        let conn = open();
        for root in ["D:/one", "E:/two"] {
            let (id, top) = source(&conn, root, "Photos", SourceKind::Library);
            let trips = folders::create(&conn, top, "Trips").unwrap();
            file(
                &conn,
                id,
                trips,
                &format!("{}.jpg", &root[3..]),
                plain(MB, 2020),
            );
        }
        assert_eq!(found(&conn, "path:Photos/Trips"), ["one.jpg", "two.jpg"]);
    }

    #[test]
    fn kinds_dates_lengths_sizes_and_shapes() {
        let l = library();
        assert_eq!(found(&l.conn, "type:video"), ["ana_clip.mp4"]);
        assert_eq!(found(&l.conn, "year:2024"), ["sunset_at_beach.jpg"]);
        assert_eq!(found(&l.conn, "year:2023"), ["ana_clip.mp4"]);
        assert_eq!(
            found(&l.conn, "year:2022"),
            ["bob_at_beach.jpg"],
            "no capture date: modified"
        );
        assert_eq!(
            found(&l.conn, "date:2024-06..2024-08"),
            ["sunset_at_beach.jpg"]
        );
        assert!(found(&l.conn, "date:2024-07").is_empty());
        assert_eq!(found(&l.conn, "dur:>30s"), ["ana_clip.mp4"]);
        assert!(found(&l.conn, "dur:>1h").is_empty());
        assert_eq!(found(&l.conn, "size:>20mb"), ["sunset_at_beach.jpg"]);
        assert_eq!(
            found(&l.conn, "size:>=10mb"),
            ["bob_at_beach.jpg", "sunset_at_beach.jpg"]
        );
        assert_eq!(found(&l.conn, "w:>=1920 h:>=1080"), ["sunset_at_beach.jpg"]);
    }

    #[test]
    fn favourites_untagged_and_the_sorting_box() {
        let l = library();
        assert_eq!(found(&l.conn, "is:favorite"), ["sunset_at_beach.jpg"]);
        let untagged = found(&l.conn, "is:untagged");
        assert!(
            !untagged.contains(&"lisbon_view.png".into()),
            "it carries a tag of its own"
        );
        assert!(
            untagged.contains(&"sunset_at_beach.jpg".into()),
            "inherited tags do not count"
        );
        assert_eq!(found(&l.conn, "is:sorting"), ["loose_snapshot.jpg"]);
    }

    #[test]
    fn the_trash_is_left_out_unless_asked_for() {
        let l = library();
        assert_eq!(found(&l.conn, "bob"), ["bob_at_beach.jpg"]);
        assert_eq!(found(&l.conn, "is:trashed"), ["old_trashed.jpg"]);
        assert_eq!(found(&l.conn, "old is:trashed"), ["old_trashed.jpg"]);
        assert_eq!(
            found(&l.conn, "bob or is:trashed"),
            ["old_trashed.jpg", "bob_at_beach.jpg"],
            "trashed first, then by name"
        );
    }

    #[test]
    fn status_matches_the_folder_and_everything_below() {
        let l = library();
        assert_eq!(
            found(&l.conn, "status:wip"),
            ["ana_clip.mp4", "sunset_at_beach.jpg"]
        );
        assert_eq!(found(&l.conn, "status:complete"), ["bob_at_beach.jpg"]);
        let none = found(&l.conn, "status:none");
        assert!(none.contains(&"lisbon_view.png".into()));
        assert!(!none.contains(&"sunset_at_beach.jpg".into()));
    }

    #[test]
    fn not_or_and_grouping_compose() {
        let l = library();
        let not_beach = found(&l.conn, "-tag:beach");
        assert!(not_beach.contains(&"lisbon_view.png".into()));
        assert!(!not_beach.contains(&"sunset_at_beach.jpg".into()));
        assert_eq!(
            found(
                &l.conn,
                "(path:Library/People/Bob or path:Library/Places/Lisbon) type:image"
            ),
            ["bob_at_beach.jpg", "lisbon_view.png"]
        );
        assert_eq!(found(&l.conn, "tag:beach type:video"), ["ana_clip.mp4"]);
    }

    #[test]
    fn a_renamed_file_is_found_by_its_new_name_only() {
        let l = library();
        items::set_name(&l.conn, l.view, "harbour.png").unwrap();
        assert_eq!(found(&l.conn, "harbour"), ["harbour.png"]);
        assert!(found(&l.conn, "view").is_empty());
    }

    #[test]
    fn a_moved_file_carries_its_new_folders_title() {
        let l = library();
        items::set_folder(&l.conn, l.keepsake, l.lisbon, "keepsake.jpg").unwrap();
        tags::rebuild_item(&l.conn, l.keepsake).unwrap();
        assert_eq!(
            found(&l.conn, "lisbon"),
            ["keepsake.jpg", "lisbon_view.png"]
        );
        assert!(found(&l.conn, "pinned").is_empty());
    }

    #[test]
    fn a_renamed_folder_is_found_by_its_new_title_only() {
        let l = library();
        folders::set_title(&l.conn, l.lisbon, "Porto").unwrap();
        tags::rebuild_subtree(&l.conn, l.lisbon).unwrap();
        assert_eq!(found(&l.conn, "porto"), ["lisbon_view.png"]);
        assert_eq!(found_folders(&l.conn, "porto"), ["Porto"]);
        assert!(found_folders(&l.conn, "lisbon").is_empty());
    }

    #[test]
    fn a_folder_matches_what_it_carries_itself() {
        let l = library();
        assert_eq!(found_folders(&l.conn, "instagram:@ana"), ["Ana"]);
        assert_eq!(found_folders(&l.conn, "tag:beach"), ["Ana"]);
        assert_eq!(found_folders(&l.conn, "lisbon"), ["Lisbon"]);
        assert_eq!(found_folders(&l.conn, "status:wip"), ["Ana"]);
        assert_eq!(found_folders(&l.conn, "is:favorite"), Vec::<String>::new());
        assert!(found_folders(&l.conn, "type:video").is_empty());
        assert!(found_folders(&l.conn, "is:trashed").is_empty());
        assert_eq!(found_folders(&l.conn, "is:sorting"), ["Incoming"]);
    }

    #[test]
    fn a_title_of_two_words_is_found_by_either() {
        let l = library();
        for query in ["pinned", "folder", "\"pinned folder\"", "pinned folder"] {
            assert_eq!(found_folders(&l.conn, query), ["Pinned Folder"], "{query}");
        }
    }

    #[test]
    fn an_ancestors_title_finds_that_ancestor_only() {
        let l = library();
        assert_eq!(
            folder_ids(&l.conn, "people").len(),
            2,
            "Library's and Archive's"
        );
        assert!(folder_ids(&l.conn, "people").contains(&l.people));
        assert!(!folder_ids(&l.conn, "people").contains(&l.ana));
    }

    /// A word finds a folder exactly when it finds a file directly in it through that folder's
    /// own tags. A word from a file's name, or from an ancestor's title, is left out on purpose.
    #[test]
    fn a_word_finds_a_folder_when_it_finds_that_folders_own_files() {
        let l = library();
        let own = [
            (l.ana, "Ana"),
            (l.bob, "Bob"),
            (l.lisbon, "Lisbon"),
            (l.pinned, "Pinned Folder"),
        ];
        for word in [
            "pinned",
            "folder",
            "ana",
            "lisbon",
            "bob",
            "nonexistentword",
        ] {
            let matched: HashSet<i64> = folder_ids(&l.conn, word).into_iter().collect();
            let files = found(&l.conn, word);
            for (id, title) in own {
                let inside: Vec<ItemRow> = items::in_folder(&l.conn, id).unwrap();
                let a_file_matched = inside.iter().any(|row| files.contains(&row.disk_name));
                assert_eq!(matched.contains(&id), a_file_matched, "{word:?} on {title}");
            }
        }
    }

    #[test]
    fn a_path_limits_folders_but_never_finds_the_one_it_names() {
        let l = library();
        assert_eq!(
            found_folders(&l.conn, "path:Library/People"),
            ["Ana", "Bob"]
        );
        assert_eq!(
            found_folders(&l.conn, "path:=Library/People"),
            ["Ana", "Bob"]
        );
        assert_eq!(found_folders(&l.conn, "path:Library/People ana"), ["Ana"]);
        assert!(found_folders(&l.conn, "path:Library/People lisbon").is_empty());
    }

    #[test]
    fn a_folder_says_what_it_matched_key_first() {
        let l = library();
        let matched = |query: &str| {
            folders(&l.conn, &parse(query).unwrap())
                .unwrap()
                .into_iter()
                .find(|folder| folder.id == l.ana)
                .unwrap()
                .matched
        };
        assert_eq!(
            matched("instagram:@ana"),
            Matched::Label {
                key: "instagram".into(),
                value: "@ana".into()
            }
        );
        assert_eq!(
            matched("tag:beach"),
            Matched::Tag {
                value: "beach".into()
            }
        );
        assert_eq!(
            matched("ana"),
            Matched::Name {
                value: "Ana".into()
            }
        );
        assert_eq!(
            matched("status:wip"),
            Matched::Name {
                value: "Ana".into()
            }
        );
    }

    #[test]
    fn a_folder_counts_everything_below_it_and_names_whats_above() {
        let l = library();
        let people = folders(&l.conn, &parse("people").unwrap())
            .unwrap()
            .into_iter()
            .find(|folder| folder.id == l.people)
            .unwrap();
        assert_eq!(
            (people.own_count, people.count),
            (0, 3),
            "none of its own; Ana's two and Bob's one; the Trash's is not counted"
        );
        let titles = |path: &[Crumb]| -> Vec<String> {
            path.iter().map(|crumb| crumb.title.clone()).collect()
        };
        assert_eq!(titles(&people.path), ["Library", "People"]);
        let ana = folders(&l.conn, &parse("ana").unwrap()).unwrap().remove(0);
        assert_eq!(titles(&ana.path), ["Library", "People", "Ana"]);
        assert_eq!(ana.path.last().map(|crumb| crumb.id), Some(l.ana));
        assert_eq!(ana.cover_uuid, Some(format!("uuid-{}-ana_clip.mp4", l.ana)));
        conn_cover(&l.conn, l.ana, l.sunset);
        let ana = folders(&l.conn, &parse("ana").unwrap()).unwrap().remove(0);
        assert_eq!(
            ana.cover_uuid,
            Some(format!("uuid-{}-sunset_at_beach.jpg", l.ana)),
            "its own cover first"
        );
        let _ = l.clip;
    }

    fn conn_cover(conn: &Connection, folder_id: i64, item_id: i64) {
        conn.execute(
            "UPDATE folder SET cover_item_id = ?1 WHERE id = ?2",
            [item_id, folder_id],
        )
        .unwrap();
    }

    /// A term written from a title, the way a control writes one, finds exactly that folder.
    #[test]
    fn a_written_term_finds_the_folder_it_was_written_from() {
        let conn = open();
        let (_, root) = source(&conn, "D:/library", "Library", SourceKind::Library);
        let big = folders::create(&conn, root, "Ana's \"Big\" Trip").unwrap();
        let nick = folders::create(&conn, root, "Nick").unwrap();
        tags::set_folder_label(&conn, nick, "nickname", "the \"real\" ana").unwrap();

        let path = path_term(&["Library".into(), "Ana's \"Big\" Trip".into()], true);
        assert_eq!(
            folder_ids(&conn, &path),
            Vec::<i64>::new(),
            "path:= finds what is in it"
        );
        let path = path_term(&["Library".into()], true);
        assert!(folder_ids(&conn, &path).contains(&big));
        assert_eq!(folder_ids(&conn, &bare_term("Ana's \"Big\" Trip")), [big]);
        assert_eq!(
            folder_ids(&conn, &label_term("nickname", "the \"real\" ana")),
            [nick]
        );
    }
}
