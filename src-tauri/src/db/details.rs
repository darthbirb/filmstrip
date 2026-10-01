//! What a folder knows about itself beyond its place: a status, a favourite, a note, a cover, and
//! the tags and labels it carries and inherits. DECISIONS.md "A folder's details".

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::folders::{self, Crumb};
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FolderStatus {
    Wip,
    Complete,
}

impl FolderStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wip => "wip",
            Self::Complete => "complete",
        }
    }

    fn parse(text: &str) -> Option<Self> {
        match text {
            "wip" => Some(Self::Wip),
            "complete" => Some(Self::Complete),
            _ => None,
        }
    }
}

/// A folder as its band shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderDetail {
    pub id: i64,
    pub source_id: i64,
    /// From its source's own folder, by the source's title, down to it.
    pub path: Vec<Crumb>,
    pub status: Option<FolderStatus>,
    pub status_set_at: Option<i64>,
    pub favorite: bool,
    pub note: Option<String>,
    /// The file chosen as its cover, while that file is live at or below it.
    pub cover_item_id: Option<i64>,
    /// The picture that stands for it, once its thumbnail is made. Filled by the command.
    pub cover: Option<String>,
    #[serde(skip)]
    pub cover_uuid: Option<String>,
    /// The live files directly in it, then every one at or below it.
    pub own_count: i64,
    pub all_count: i64,
    /// Its own first, its name leading, then what it inherits, the source's first.
    pub tags: Vec<FolderTag>,
}

/// A tag or a label on a folder: a label has a key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderTag {
    pub tag_id: i64,
    pub key: Option<String>,
    pub value: String,
    /// The folder above that carries it, or `None` when this folder does.
    pub from: Option<Crumb>,
    /// A folder's name, which only renaming it changes.
    pub name: bool,
}

/// Everything the band shows for a live folder; `None` once it has gone.
pub fn detail(conn: &Connection, folder_id: i64) -> Result<Option<FolderDetail>> {
    let row = conn
        .query_row(
            "SELECT status, status_set_at, favorite, notes, cover_item_id FROM folder
              WHERE id = ?1 AND deleted_at IS NULL",
            params![folder_id],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<i64>>(1)?,
                    r.get::<_, bool>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((status, status_set_at, favorite, note, chosen)) = row else {
        return Ok(None);
    };
    let path = folders::ancestry(conn, folder_id)?;
    let source_id = folders::location(conn, folder_id)?.source_id;
    let cover = cover(conn, folder_id)?;
    Ok(Some(FolderDetail {
        id: folder_id,
        source_id,
        status: status.as_deref().and_then(FolderStatus::parse),
        status_set_at,
        favorite,
        note,
        cover_item_id: cover
            .as_ref()
            .map(|(id, _)| *id)
            .filter(|id| Some(*id) == chosen),
        cover: None,
        cover_uuid: cover.map(|(_, uuid)| uuid),
        own_count: folders::own_count(conn, folder_id)?,
        all_count: folders::subtree_count(conn, folder_id)?,
        tags: tags_of(conn, &path)?,
        path,
    }))
}

/// The folder's own tags, then each folder's above it from the source down. A tag carried twice
/// is shown once, where it is nearest, as `item_effective_tag` keeps it.
fn tags_of(conn: &Connection, path: &[Crumb]) -> Result<Vec<FolderTag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.key, t.value, ft.source = 'title' FROM folder_tag ft
           JOIN tag t ON t.id = ft.tag_id
          WHERE ft.folder_id = ?1
          ORDER BY ft.source = 'title' DESC, ft.rowid",
    )?;
    let mut levels: Vec<Vec<FolderTag>> = Vec::new();
    let mut seen = HashSet::new();
    for (depth, crumb) in path.iter().rev().enumerate() {
        let from = (depth > 0).then(|| crumb.clone());
        let level = stmt
            .query_map(params![crumb.id], |r| {
                Ok(FolderTag {
                    tag_id: r.get(0)?,
                    key: r.get(1)?,
                    value: r.get(2)?,
                    from: from.clone(),
                    name: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        levels.push(
            level
                .into_iter()
                .filter(|tag| seen.insert(tag.tag_id))
                .collect(),
        );
    }
    let own = if levels.is_empty() {
        Vec::new()
    } else {
        levels.remove(0)
    };
    Ok(own
        .into_iter()
        .chain(levels.into_iter().rev().flatten())
        .collect())
}

/// The file that stands for a folder: its chosen cover while that is live at or below it, else
/// its first picture or video, nearest first. A search's folder card shows the same one.
pub fn cover(conn: &Connection, folder_id: i64) -> Result<Option<(i64, String)>> {
    Ok(conn
        .query_row(
            "WITH RECURSIVE subtree(id, depth) AS (
                 SELECT ?1, 0
               UNION ALL
                 SELECT f.id, s.depth + 1 FROM folder f JOIN subtree s ON f.parent_id = s.id
                  WHERE f.deleted_at IS NULL
             )
             SELECT i.id, i.uuid FROM item i JOIN subtree s ON s.id = i.folder_id
              WHERE i.deleted_at IS NULL AND i.kind IN ('image', 'video')
              ORDER BY i.id = (SELECT cover_item_id FROM folder WHERE id = ?1) DESC,
                       s.depth, i.disk_name COLLATE NOCASE
              LIMIT 1",
            params![folder_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::{self, NewItem};
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, tags};
    use std::path::Path;

    fn library() -> (Connection, i64) {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let source = sources::add(
            &conn,
            Path::new("D:/Pictures"),
            "Pictures",
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
                uuid: format!("uuid-{name}"),
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
        tags::rebuild_item(conn, id).unwrap();
        id
    }

    fn tag_line(detail: &FolderDetail) -> Vec<String> {
        detail
            .tags
            .iter()
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

    #[test]
    fn its_own_tags_lead_with_its_name_then_each_folder_above_from_the_source_down() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        tags::add_folder_tag(&conn, trips, "travel").unwrap();
        tags::set_folder_label(&conn, trips, "Trip", "Egypt 2024").unwrap();
        tags::add_folder_tag(&conn, cairo, "egypt").unwrap();
        tags::set_folder_label(&conn, cairo, "Location", "Cairo").unwrap();

        let detail = detail(&conn, cairo).unwrap().unwrap();
        assert_eq!(
            tag_line(&detail),
            [
                "#cairo",
                "egypt",
                "location:cairo",
                "#pictures<Pictures",
                "#trips<Trips",
                "travel<Trips",
                "trip:egypt 2024<Trips",
            ]
        );
    }

    #[test]
    fn a_tag_carried_at_two_levels_shows_once_where_it_is_nearest() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        tags::add_folder_tag(&conn, root, "travel").unwrap();
        tags::add_folder_tag(&conn, trips, "travel").unwrap();

        let detail = detail(&conn, cairo).unwrap().unwrap();
        assert_eq!(
            tag_line(&detail),
            [
                "#cairo",
                "#pictures<Pictures",
                "#trips<Trips",
                "travel<Trips"
            ]
        );
    }

    #[test]
    fn a_source_s_own_folder_inherits_nothing_and_goes_by_the_source_s_name() {
        let (conn, root) = library();
        let detail = detail(&conn, root).unwrap().unwrap();
        assert_eq!(tag_line(&detail), ["#pictures"]);
        assert_eq!(detail.path.len(), 1);
        assert_eq!(detail.path[0].title, "Pictures");
    }

    #[test]
    fn its_counts_are_its_own_files_then_all_of_them() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        item(&conn, trips, "hotel.jpg");
        item(&conn, cairo, "a.jpg");
        item(&conn, cairo, "b.jpg");

        let detail = detail(&conn, trips).unwrap().unwrap();
        assert_eq!((detail.own_count, detail.all_count), (1, 3));
    }

    #[test]
    fn with_no_cover_chosen_its_first_file_stands_in_and_is_not_called_chosen() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        item(&conn, cairo, "a.jpg");
        let hotel = item(&conn, trips, "hotel.jpg");

        let standing = detail(&conn, trips).unwrap().unwrap();
        assert_eq!(
            standing.cover_uuid.as_deref(),
            Some("uuid-hotel.jpg"),
            "nearest first"
        );
        assert_eq!(standing.cover_item_id, None);

        conn.execute(
            "UPDATE folder SET cover_item_id = ?1 WHERE id = ?2",
            params![hotel, trips],
        )
        .unwrap();
        let chosen = detail(&conn, trips).unwrap().unwrap();
        assert_eq!(chosen.cover_item_id, Some(hotel));
    }

    #[test]
    fn its_status_note_and_favourite_are_read_as_stored() {
        let (conn, root) = library();
        conn.execute(
            "UPDATE folder SET status = 'wip', status_set_at = 7, notes = 'dawn', favorite = 1
              WHERE id = ?1",
            params![root],
        )
        .unwrap();
        let detail = detail(&conn, root).unwrap().unwrap();
        assert_eq!(detail.status, Some(FolderStatus::Wip));
        assert_eq!(detail.status_set_at, Some(7));
        assert_eq!(detail.note.as_deref(), Some("dawn"));
        assert!(detail.favorite);
    }

    #[test]
    fn a_folder_that_has_gone_has_no_details() {
        let (conn, root) = library();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        folders::trash_subtree(&conn, trips).unwrap();
        assert_eq!(detail(&conn, trips).unwrap(), None);
    }
}
