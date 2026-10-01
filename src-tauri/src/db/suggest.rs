//! The terms the list under the search field offers for the word being typed: the folders, tags
//! and labels it begins. DECISIONS.md "Search".

use rusqlite::{Connection, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::search::{escape_like, resolve_path};
use crate::db::{fold, folders};
use crate::error::Result;
use crate::query::{IsFlag, Narrow, Shape, Term, Typing, label_term, path_term, tag_term};

/// The most rows the list ever holds, the words as typed among them.
pub const ROWS: usize = 8;

/// The most folders read by title before the scope and the nearness are looked at.
const CANDIDATES: i64 = 200;

/// One row of the list: the term it writes, and how the row draws it.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Suggestion {
    pub kind: SuggestionKind,
    /// The term as text that reads back as itself, with the `-` the word was typed with.
    pub text: String,
    /// A folder's is its whole path from the source, as its row names it.
    pub shape: Shape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SuggestionKind {
    Words,
    Folder,
    Tag,
    Label,
}

/// The rows for a word: the words as typed, then folders, tags and labels that begin with it.
/// `scope` is the query's place term, which limits the folders and nothing else.
pub fn suggest(
    conn: &Connection,
    scope: Option<&Term>,
    typing: &Typing,
) -> Result<Vec<Suggestion>> {
    let any = typing.narrow == Narrow::Any;
    let mut rows = Vec::new();
    if any {
        rows.push(Suggestion {
            kind: SuggestionKind::Words,
            text: typing.raw.clone(),
            shape: Shape::Text,
        });
    }
    let room = ROWS - rows.len();
    let like = format!("{}%", escape_like(&fold(&typing.word)));
    let found = [
        if any || typing.narrow == Narrow::Folders {
            folders_beginning(conn, scope, &like, room)?
        } else {
            Vec::new()
        },
        if any || typing.narrow == Narrow::Tags {
            tags_beginning(conn, &like, room)?
        } else {
            Vec::new()
        },
        match &typing.narrow {
            Narrow::Any => labels_beginning(conn, None, &like, room)?,
            Narrow::Labels(key) => labels_beginning(conn, key.as_deref(), &like, room)?,
            _ => Vec::new(),
        },
    ];
    rows.extend(share(found, room).into_iter().map(|mut row| {
        if typing.negated {
            row.text.insert(0, '-');
        }
        row
    }));
    Ok(rows)
}

/// Each kind takes a row in turn until the room is gone, so one kind with many matches never
/// crowds out the others; the rows then stand kind by kind, in the order given.
fn share(kinds: [Vec<Suggestion>; 3], room: usize) -> Vec<Suggestion> {
    let mut taken = [0usize; 3];
    let mut left = room;
    loop {
        let before = left;
        for (kind, taken) in kinds.iter().zip(&mut taken) {
            if left > 0 && *taken < kind.len() {
                *taken += 1;
                left -= 1;
            }
        }
        if left == 0 || left == before {
            break;
        }
    }
    kinds
        .into_iter()
        .zip(taken)
        .flat_map(|(kind, taken)| kind.into_iter().take(taken))
        .collect()
}

/// Live folders whose title begins the word, nearest the scope first. A source's own folder goes
/// by the source's title. SQLite's LIKE folds ASCII only, so `É` is not found by `é`.
fn folders_beginning(
    conn: &Connection,
    scope: Option<&Term>,
    like: &str,
    room: usize,
) -> Result<Vec<Suggestion>> {
    let below = match scope {
        Some(Term::Is(IsFlag::Trashed)) => return Ok(Vec::new()),
        Some(Term::Path { path, .. }) => Some(resolve_path(conn, path)?),
        _ => None,
    };
    let sorting = match scope {
        Some(Term::Is(IsFlag::Sorting)) => Some(sorting_roots(conn)?),
        _ => None,
    };
    // Only a source's own folder carries its source, so the title is the source's there.
    let mut stmt = conn.prepare(
        "SELECT f.id FROM folder f LEFT JOIN source s ON f.parent_id IS NULL AND s.id = f.source_id
          WHERE f.deleted_at IS NULL AND COALESCE(s.title, f.title) LIKE ?1 ESCAPE '\\'
          ORDER BY COALESCE(s.title, f.title) COLLATE NOCASE, f.id LIMIT ?2",
    )?;
    let ids: Vec<i64> = stmt
        .query_map(params![like, CANDIDATES], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;

    // How far below the scope each folder sits, beside its row.
    let mut found: Vec<(usize, Suggestion)> = Vec::new();
    for id in ids {
        let titles: Vec<(i64, String)> = folders::ancestry(conn, id)?
            .into_iter()
            .map(|crumb| (crumb.id, crumb.title))
            .collect();
        if sorting
            .as_ref()
            .is_some_and(|roots| !roots.contains(&titles[0].0))
        {
            continue;
        }
        let above = &titles[..titles.len() - 1];
        let from = match &below {
            Some(roots) => match above.iter().position(|(id, _)| roots.contains(id)) {
                Some(at) => at,
                None => continue,
            },
            None => 0,
        };
        let all: Vec<String> = titles.iter().map(|(_, title)| title.clone()).collect();
        let depth = all.len() - from;
        found.push((
            depth,
            Suggestion {
                kind: SuggestionKind::Folder,
                text: path_term(&all, false),
                shape: Shape::Path {
                    titles: all,
                    exact: false,
                },
            },
        ));
    }
    // Stable, so folders as near as each other keep the order of their titles.
    found.sort_by_key(|(depth, _)| *depth);
    Ok(found.into_iter().take(room).map(|(_, row)| row).collect())
}

/// The own folder of every sorting source.
fn sorting_roots(conn: &Connection) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT f.id FROM folder f JOIN source s ON s.id = f.source_id
          WHERE f.parent_id IS NULL AND s.kind = 'sorting'",
    )?;
    let roots = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(roots)
}

/// Tags someone added, to a folder or a file, most carried first. The tag every folder gets from
/// its own title is not one: the folder's row already stands for it.
fn tags_beginning(conn: &Connection, like: &str, room: usize) -> Result<Vec<Suggestion>> {
    let mut stmt = conn.prepare(
        "SELECT value FROM (
             SELECT t.value AS value,
                    (SELECT COUNT(*) FROM folder_tag ft JOIN folder f ON f.id = ft.folder_id
                      WHERE ft.tag_id = t.id AND ft.source <> 'title' AND f.deleted_at IS NULL)
                  + (SELECT COUNT(*) FROM item_tag it JOIN item i ON i.id = it.item_id
                      WHERE it.tag_id = t.id AND i.deleted_at IS NULL) AS uses
               FROM tag t
              WHERE t.key IS NULL AND t.value LIKE ?1 ESCAPE '\\'
         )
          WHERE uses > 0 ORDER BY uses DESC, value LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![like, room as i64], |r| {
            let value: String = r.get(0)?;
            Ok(Suggestion {
                kind: SuggestionKind::Tag,
                text: tag_term(&value),
                shape: Shape::Tag { value },
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Labels a live folder carries whose value begins the word, under one key when one was typed.
fn labels_beginning(
    conn: &Connection,
    key: Option<&str>,
    like: &str,
    room: usize,
) -> Result<Vec<Suggestion>> {
    let mut stmt = conn.prepare(
        "SELECT key, value FROM (
             SELECT t.key AS key, t.value AS value,
                    (SELECT COUNT(*) FROM folder_tag ft JOIN folder f ON f.id = ft.folder_id
                      WHERE ft.tag_id = t.id AND f.deleted_at IS NULL) AS uses
               FROM tag t
              WHERE t.key IS NOT NULL AND (?3 IS NULL OR t.key = ?3)
                AND t.value LIKE ?1 ESCAPE '\\'
         )
          WHERE uses > 0 ORDER BY uses DESC, value, key LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![like, room as i64, key.map(fold)], |r| {
            let (key, value): (String, String) = (r.get(0)?, r.get(1)?);
            Ok(Suggestion {
                kind: SuggestionKind::Label,
                text: label_term(&key, &value),
                shape: Shape::Label { key, value },
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;
    use crate::db::items::{self, NewItem};
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, tags};
    use crate::query::{Expr, parse, typing};

    fn source(conn: &Connection, root: &str, title: &str, kind: SourceKind) -> (i64, i64) {
        let source = sources::add(conn, Path::new(root), title, kind).unwrap();
        (
            source.id,
            folders::source_root_folder(conn, source.id).unwrap(),
        )
    }

    fn file(conn: &Connection, source_id: i64, folder_id: i64, name: &str) -> i64 {
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
        tags::rebuild_item(conn, id).unwrap();
        id
    }

    /// Library: Trips/Cairo/Dawn Walks, Trips/Oslo/Dark Days, Dance. Incoming, a sorting source,
    /// holds Dawn Drop. Tags dawn (twice), daylight, dusk; labels time:dawn, time:day, mood:dark.
    fn library() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let (lib, root) = source(&conn, "D:/library", "Library", SourceKind::Library);
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        let walks = folders::create(&conn, cairo, "Dawn Walks").unwrap();
        let oslo = folders::create(&conn, trips, "Oslo").unwrap();
        let dark = folders::create(&conn, oslo, "Dark Days").unwrap();
        let dance = folders::create(&conn, root, "Dance").unwrap();
        let (_, incoming) = source(&conn, "D:/incoming", "Incoming", SourceKind::Sorting);
        folders::create(&conn, incoming, "Dawn Drop").unwrap();

        tags::add_folder_tag(&conn, cairo, "dawn").unwrap();
        tags::add_folder_tag(&conn, oslo, "dusk").unwrap();
        tags::add_folder_tag(&conn, dance, "daylight").unwrap();
        tags::set_folder_label(&conn, walks, "Time", "Dawn").unwrap();
        tags::set_folder_label(&conn, oslo, "Time", "Day").unwrap();
        tags::set_folder_label(&conn, dark, "Mood", "Dark").unwrap();
        let sphinx = file(&conn, lib, cairo, "sphinx.jpg");
        tags::add_item_tag(&conn, sphinx, "dawn").unwrap();
        // A tag nothing carries any more.
        tags::get_or_create_tag(&conn, None, "daffodil").unwrap();
        conn
    }

    fn rows(conn: &Connection, scope: Option<&str>, text: &str) -> Vec<(SuggestionKind, String)> {
        let scope = scope.map(|scope| match parse(scope).unwrap() {
            Expr::Term(term) => term,
            other => panic!("{other:?} is no scope"),
        });
        let typing = typing(text).unwrap_or_else(|| panic!("{text:?} ends on no word"));
        suggest(conn, scope.as_ref(), &typing)
            .unwrap()
            .into_iter()
            .map(|row| (row.kind, row.text))
            .collect()
    }

    use SuggestionKind::{Folder, Label, Tag, Words};

    fn said(rows: &[(SuggestionKind, &str)]) -> Vec<(SuggestionKind, String)> {
        rows.iter()
            .map(|(kind, text)| (*kind, (*text).to_owned()))
            .collect()
    }

    #[test]
    fn a_word_offers_itself_then_folders_tags_and_labels_that_begin_with_it() {
        let conn = library();
        assert_eq!(
            rows(&conn, None, "giza da"),
            said(&[
                (Words, "da"),
                (Folder, "path:Library/Dance"),
                (Folder, "path:\"Incoming/Dawn Drop\""),
                (Folder, "path:\"Library/Trips/Oslo/Dark Days\""),
                (Tag, "tag:dawn"),
                (Tag, "tag:daylight"),
                (Label, "mood:dark"),
                (Label, "time:dawn"),
            ]),
            "eight rows, each kind taking its turn, so Dawn Walks and time:day are left out"
        );
    }

    #[test]
    fn a_tag_is_offered_only_when_someone_added_it_and_something_still_carries_it() {
        let conn = library();
        assert_eq!(
            rows(&conn, None, "tag:da"),
            said(&[(Tag, "tag:dawn"), (Tag, "tag:daylight")]),
            "most carried first; not daffodil, which nothing carries, nor any folder's title"
        );
        assert_eq!(rows(&conn, None, "tag:cai"), said(&[]));
        let dance: i64 = conn
            .query_row("SELECT id FROM folder WHERE title = 'Dance'", [], |r| {
                r.get(0)
            })
            .unwrap();
        tags::add_folder_tag(&conn, dance, "cairo").unwrap();
        assert_eq!(
            rows(&conn, None, "tag:cai"),
            said(&[(Tag, "tag:cairo")]),
            "a folder's title is a tag once it is added somewhere else"
        );
    }

    #[test]
    fn folders_are_offered_below_the_scope_and_named_from_their_source() {
        let conn = library();
        let typing = typing("d").unwrap();
        let Expr::Term(scope) = parse("path:Library/Trips").unwrap() else {
            panic!("a term")
        };
        let folders: Vec<_> = suggest(&conn, Some(&scope), &typing)
            .unwrap()
            .into_iter()
            .filter(|row| row.kind == Folder)
            .map(|row| (row.text, row.shape))
            .collect();
        let path = |titles: &[&str]| Shape::Path {
            titles: titles.iter().map(|t| (*t).to_owned()).collect(),
            exact: false,
        };
        assert_eq!(
            folders,
            [
                (
                    "path:\"Library/Trips/Oslo/Dark Days\"".to_owned(),
                    path(&["Library", "Trips", "Oslo", "Dark Days"])
                ),
                (
                    "path:\"Library/Trips/Cairo/Dawn Walks\"".to_owned(),
                    path(&["Library", "Trips", "Cairo", "Dawn Walks"])
                ),
            ]
        );
        assert_eq!(
            rows(&conn, Some("is:sorting"), "path:da"),
            said(&[(Folder, "path:\"Incoming/Dawn Drop\"")])
        );
        assert_eq!(rows(&conn, Some("is:trashed"), "path:da"), said(&[]));
        assert_eq!(
            rows(&conn, Some("path:Library/Trips"), "path:tri"),
            said(&[]),
            "the scope is not below itself"
        );
        assert_eq!(
            rows(&conn, None, "path:lib"),
            said(&[(Folder, "path:Library")]),
            "a source goes by its title"
        );
    }

    #[test]
    fn a_typed_key_narrows_the_rows_to_its_kind() {
        let conn = library();
        assert_eq!(
            rows(&conn, None, "time:da"),
            said(&[(Label, "time:dawn"), (Label, "time:day")])
        );
        assert_eq!(
            rows(&conn, None, ":da"),
            said(&[
                (Label, "mood:dark"),
                (Label, "time:dawn"),
                (Label, "time:day")
            ])
        );
        assert_eq!(
            rows(&conn, None, "Time:"),
            said(&[(Label, "time:dawn"), (Label, "time:day")])
        );
        assert_eq!(
            rows(&conn, None, "-tag:du"),
            said(&[(Tag, "-tag:dusk")]),
            "a term keeps the - its word was typed with"
        );
    }

    #[test]
    fn every_row_reads_back_as_the_term_it_shows() {
        let conn = library();
        let (_, root) = source(&conn, "D:/odd", "Odd (one)", SourceKind::Library);
        let odd = folders::create(&conn, root, "da/sh \"x\"").unwrap();
        tags::add_folder_tag(&conn, odd, "day off").unwrap();
        tags::set_folder_label(&conn, odd, "Time", "Day (late)").unwrap();
        for text in ["da", "path:da", "tag:da", "time:da"] {
            for row in suggest(&conn, None, &typing(text).unwrap()).unwrap() {
                if row.kind == Words {
                    continue;
                }
                let read = crate::query::read(&row.text);
                assert_eq!(read.fault, None, "{:?}", row.text);
                let [term] = read.terms.as_slice() else {
                    panic!("{:?} is not one term", row.text)
                };
                assert_eq!(term.shape, row.shape, "{:?}", row.text);
            }
        }
    }

    #[test]
    fn a_row_crosses_to_the_window_in_camel_case() {
        let conn = library();
        let rows = suggest(&conn, None, &typing("time:daw").unwrap()).unwrap();
        assert_eq!(
            serde_json::to_value(rows).unwrap(),
            serde_json::json!([{
                "kind": "label",
                "text": "time:dawn",
                "shape": { "kind": "label", "key": "time", "value": "dawn" }
            }])
        );
    }
}
