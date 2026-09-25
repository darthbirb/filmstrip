//! The trash: a folder beside the executable where a file waits, out of its folder, until it is
//! taken back. Sending one there is a move like any other, journalled, so it can be undone.
//! DECISIONS.md "Undo".

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::items::ItemRow;
use crate::db::journal::ItemRestored;
use crate::db::{folders, items, journal, tags};
use crate::error::{AppError, Reason, Result};
use crate::fs::stayed::{self, Stayed};
use crate::fs::{paths, relocate};

/// What sending several items to the trash did: how many went, and each one that did not, with why.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrashReport {
    pub trashed: u32,
    pub refused: Vec<Stayed>,
}

/// A file in the trash, when it went, and the folder it left.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Trashed {
    #[serde(flatten)]
    pub row: ItemRow,
    pub trashed_at: i64,
    pub from: Origin,
}

/// The folder a trashed file left, named from its source's own folder down. `gone` when neither
/// it nor a folder at its place is live, so Restore would be refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Origin {
    pub folder_id: i64,
    pub path: Vec<String>,
    pub gone: bool,
}

/// How much the trash holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrashSummary {
    pub count: u32,
    pub bytes: i64,
}

/// Everything in the trash, the most recent first.
pub fn listing(conn: &Connection) -> Result<Vec<Trashed>> {
    items::in_trash(conn)?
        .into_iter()
        .map(|(row, trashed_at)| {
            let from = Origin {
                folder_id: row.folder_id,
                path: folders::ancestry(conn, row.folder_id)?
                    .into_iter()
                    .map(|crumb| crumb.title)
                    .collect(),
                gone: folders::live_at(conn, row.folder_id)?.is_none(),
            };
            Ok(Trashed {
                row,
                trashed_at,
                from,
            })
        })
        .collect()
}

pub fn summary(conn: &Connection) -> Result<TrashSummary> {
    let (count, bytes) = items::trash_totals(conn)?;
    Ok(TrashSummary { count, bytes })
}

/// Sends each item to the trash under one batch, so one undo brings the whole selection back.
pub fn trash_items(conn: &Connection, item_ids: &[i64], batch_id: &str) -> Result<TrashReport> {
    let _turn = super::turn();
    let mut report = TrashReport::default();
    for &item_id in item_ids {
        match trash_unjournalled(conn, item_id, Some(batch_id)) {
            Ok(()) => report.trashed += 1,
            Err(err) => report.refused.push(stayed::file(conn, item_id, &err)?),
        }
    }
    Ok(report)
}

/// Moves one item's file into the trash and records it there. A file already gone from where the
/// index has it is refused: the next walk retires it.
pub(super) fn trash_unjournalled(
    conn: &Connection,
    item_id: i64,
    batch_id: Option<&str>,
) -> Result<()> {
    if !items::is_live(conn, item_id)? {
        return Err(AppError::invalid("that file is no longer in the index"));
    }
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    if !from.is_file() {
        return Err(AppError::refused(Reason::NotOnDisk {
            name: file.disk_name,
        }));
    }
    let to = paths::trash_path(&file.uuid, &file.disk_name)?;
    if let Some(shard) = to.parent() {
        std::fs::create_dir_all(shard)?;
    }
    relocate::relocate(&from, &to)?;

    let recorded = in_transaction(conn, |tx| {
        items::send_to_trash(tx, item_id)?;
        if let Some(batch_id) = batch_id {
            journal::record_item_trash(tx, batch_id, item_id)?;
        }
        Ok(())
    });
    if recorded.is_err() {
        let _ = relocate::relocate(&to, &from);
    }
    recorded
}

/// What restoring several items did: how many came back, and each one that did not, with why.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RestoreReport {
    pub restored: u32,
    pub refused: Vec<Stayed>,
}

/// Takes each item out of the trash under one batch: into the folder it left, or into `to`.
pub fn restore_items(
    conn: &Connection,
    item_ids: &[i64],
    to: Option<i64>,
    batch_id: &str,
) -> Result<RestoreReport> {
    let _turn = super::turn();
    let mut report = RestoreReport::default();
    for &item_id in item_ids {
        match restore_unjournalled(conn, item_id, to, Some(batch_id)) {
            Ok(()) => report.restored += 1,
            Err(err) => report.refused.push(stayed::file(conn, item_id, &err)?),
        }
    }
    Ok(report)
}

/// Takes an item back out of the trash under its own name: into `to`, or into the folder it left,
/// or a live one at that folder's place once it has gone. A name taken there is never changed.
pub(super) fn restore_unjournalled(
    conn: &Connection,
    item_id: i64,
    to: Option<i64>,
    batch_id: Option<&str>,
) -> Result<()> {
    if !items::is_trashed(conn, item_id)? {
        return Err(AppError::invalid("that file is not in the trash"));
    }
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let home = match to {
        Some(folder) if folders::is_live(conn, folder)? => folder,
        Some(_) => return Err(AppError::invalid("that folder is no longer in the index")),
        None => folders::live_at(conn, file.folder_id)?.ok_or_else(|| {
            AppError::refused(Reason::FolderGone {
                name: folders::title(conn, file.folder_id)
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
            })
        })?,
    };
    let taken = || {
        AppError::refused(Reason::NameTaken {
            place: place_name(conn, home),
            name: file.disk_name.clone(),
            folder: false,
        })
    };
    let held = items::existing_by_disk_name(conn, home, &file.disk_name)?;
    if held.as_ref().is_some_and(|row| !row.deleted) {
        return Err(taken());
    }
    let from = paths::trash_path(&file.uuid, &file.disk_name)?;
    let dest = paths::item_path(conn, home, &file.disk_name)?;
    if dest.exists() {
        return Err(taken());
    }
    let trashed_at = items::trashed_at(conn, item_id)?.unwrap_or_default();
    relocate::relocate(&from, &dest)?;

    let recorded = in_transaction(conn, |tx| {
        // A retired row holding the name describes a file that is gone; the returning one takes it.
        if let Some(stale) = &held {
            items::forget_retired(tx, stale.id)?;
        }
        if home != file.folder_id {
            items::set_folder(tx, item_id, home, &file.disk_name)?;
        }
        items::take_from_trash(tx, item_id)?;
        tags::rebuild_item(tx, item_id)?;
        if let Some(batch_id) = batch_id {
            let restored = ItemRestored {
                item_id,
                left_folder_id: file.folder_id,
                to_folder_id: home,
                trashed_at,
            };
            journal::record_item_restore(tx, batch_id, &restored)?;
        }
        Ok(())
    });
    if recorded.is_err() {
        let _ = relocate::relocate(&dest, &from);
    }
    recorded
}

/// Undoes a restore: the file goes back to the trash, from the folder it had left and at the
/// moment it first went, so the Trash shows it as it was.
pub(super) fn unrestore(conn: &Connection, restored: &ItemRestored) -> Result<()> {
    trash_unjournalled(conn, restored.item_id, None)?;
    in_transaction(conn, |tx| {
        if restored.left_folder_id != restored.to_folder_id {
            let file = items::file_of(tx, restored.item_id)?
                .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
            items::set_folder(
                tx,
                restored.item_id,
                restored.left_folder_id,
                &file.disk_name,
            )?;
        }
        items::set_trashed_at(tx, restored.item_id, restored.trashed_at)
    })
}

/// A folder as navigation names it: a source's own folder goes by the source's title.
fn place_name(conn: &Connection, folder_id: i64) -> String {
    folders::ancestry(conn, folder_id)
        .ok()
        .and_then(|mut crumbs| crumbs.pop())
        .map(|crumb| crumb.title)
        .unwrap_or_default()
}

fn in_transaction<T>(conn: &Connection, work: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    let tx = conn.unchecked_transaction()?;
    let out = work(&tx)?;
    tx.commit()?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, journal};
    use crate::fs::{undo, walk};
    use std::path::{Path, PathBuf};

    /// Trips/Cairo holding pyramid.jpg and sphinx.jpg, walked into a real file.
    fn library(name: &str) -> (Connection, PathBuf, i64) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-trash")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("library");
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "p").unwrap();
        std::fs::write(root.join("Trips/Cairo/sphinx.jpg"), "s").unwrap();
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        (conn, root, cairo)
    }

    fn id_of(conn: &Connection, folder_id: i64, name: &str) -> i64 {
        items::existing_by_disk_name(conn, folder_id, name)
            .unwrap()
            .unwrap()
            .id
    }

    fn trash_file(conn: &Connection, id: i64) -> PathBuf {
        let file = items::file_of(conn, id).unwrap().unwrap();
        paths::trash_path(&file.uuid, &file.disk_name).unwrap()
    }

    #[test]
    fn a_file_goes_to_the_trash_and_one_undo_brings_it_back_with_its_tags() {
        let (conn, root, cairo) = library("round-trip");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();

        let report = trash_items(&conn, &[pyramid], &batch).unwrap();
        assert_eq!(report.trashed, 1);
        assert!(!root.join("Trips/Cairo/pyramid.jpg").exists());
        assert!(trash_file(&conn, pyramid).is_file());
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert_eq!(items::in_folder(&conn, cairo).unwrap().len(), 1);

        undo::undo_batch(&conn, &batch).unwrap();
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert!(!trash_file(&conn, pyramid).exists());
        assert!(items::is_live(&conn, pyramid).unwrap());
        let carried = tags::item_effective_tags(&conn, pyramid).unwrap();
        assert!(carried.iter().any(|tag| tag.value == "cairo"));
    }

    #[test]
    fn a_new_file_under_a_trashed_ones_name_is_a_new_item_and_the_trashed_one_waits() {
        let (conn, root, cairo) = library("name-freed");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();

        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "another").unwrap();
        walk::reconcile(&conn).unwrap();
        let newcomer = id_of(&conn, cairo, "pyramid.jpg");
        assert_ne!(newcomer, pyramid);
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert!(trash_file(&conn, pyramid).is_file());
    }

    #[test]
    fn a_file_whose_name_has_been_taken_since_stays_in_the_trash_and_says_so() {
        let (conn, root, cairo) = library("blocked");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        trash_items(&conn, &[pyramid], &batch).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "another").unwrap();

        let report = undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!(report.files_back, 0);
        assert_eq!(
            report.stayed[0].reason,
            Reason::NameTaken {
                place: "Cairo".into(),
                name: "pyramid.jpg".into(),
                folder: false
            }
        );
        assert_eq!(report.stayed[0].at, stayed::Whereabouts::Trash);
        assert!(trash_file(&conn, pyramid).is_file());
        assert_eq!(journal::latest_batch(&conn).unwrap(), Some(batch));
    }

    #[test]
    fn the_trash_lists_what_it_holds_newest_first_with_the_folder_each_left() {
        let (conn, root, cairo) = library("listing");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();

        let held = listing(&conn).unwrap();
        let ids: Vec<i64> = held.iter().map(|one| one.row.id).collect();
        assert_eq!(ids, [sphinx, pyramid]);
        assert_eq!(held[0].from.path, ["Library", "Trips", "Cairo"]);
        assert!(!held[0].from.gone);
        assert_eq!(summary(&conn).unwrap(), TrashSummary { count: 2, bytes: 2 });

        // Its folder gone, the file says so; made again under the same name, it is not.
        std::fs::remove_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();
        assert!(listing(&conn).unwrap()[0].from.gone);
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();
        assert!(!listing(&conn).unwrap()[0].from.gone);
    }

    #[test]
    fn a_trashed_file_is_shown_in_full_from_where_the_trash_keeps_it() {
        let (conn, _, cairo) = library("detail");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();

        let thumbs = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-trash/no-thumbs");
        let detail = crate::commands::detail_of(&conn, pyramid, &thumbs)
            .unwrap()
            .unwrap();
        assert!(detail.trashed_at.is_some());
        assert_eq!(
            detail.folders.last().map(|crumb| crumb.title.as_str()),
            Some("Cairo")
        );
        assert_eq!(Path::new(&detail.path), trash_file(&conn, pyramid));
        let path = crate::commands::last_path(&conn, pyramid).unwrap().unwrap();
        assert_eq!(Path::new(&path), trash_file(&conn, pyramid));
    }

    #[test]
    fn restore_puts_a_file_back_where_it_was_and_its_undo_returns_it_to_the_trash_as_it_was() {
        let (conn, root, cairo) = library("restore");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        let went = items::trashed_at(&conn, pyramid).unwrap();

        let batch = journal::new_batch();
        let report = restore_items(&conn, &[pyramid], None, &batch).unwrap();
        assert_eq!(report.restored, 1);
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert!(items::is_live(&conn, pyramid).unwrap());
        assert_eq!(
            crate::fs::acts::describe(&conn, &batch).unwrap().act,
            crate::fs::acts::Act::Restore {
                to: Some("Cairo".into()),
                one: Some("pyramid.jpg".into())
            }
        );

        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert!(trash_file(&conn, pyramid).is_file());
        assert_eq!(items::trashed_at(&conn, pyramid).unwrap(), went);
    }

    #[test]
    fn restore_to_another_folder_leaves_the_trash_remembering_where_the_file_came_from() {
        let (conn, root, cairo) = library("restore-to");
        std::fs::create_dir_all(root.join("People")).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let people = folders::child_id(&conn, top, "People").unwrap().unwrap();
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();

        let batch = journal::new_batch();
        restore_items(&conn, &[pyramid], Some(people), &batch).unwrap();
        assert!(root.join("People/pyramid.jpg").is_file());
        assert_eq!(items::folder_of(&conn, pyramid).unwrap(), Some(people));

        undo::undo_batch(&conn, &batch).unwrap();
        assert!(!root.join("People/pyramid.jpg").exists());
        assert_eq!(
            listing(&conn).unwrap()[0].from.path,
            ["Library", "Trips", "Cairo"]
        );
    }

    #[test]
    fn a_file_whose_folder_has_gone_stays_until_a_folder_stands_in_its_place_again() {
        let (conn, root, cairo) = library("restore-gone");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        trash_items(&conn, &[pyramid, sphinx], &journal::new_batch()).unwrap();
        std::fs::remove_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();

        let report = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();
        assert_eq!(report.restored, 0);
        assert_eq!(
            report.refused[0].reason,
            Reason::FolderGone {
                name: "Cairo".into()
            }
        );
        assert_eq!(report.refused[0].at, stayed::Whereabouts::Trash);

        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();
        let report = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();
        assert_eq!(report.restored, 1, "{:?}", report.refused);
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
    }

    #[test]
    fn a_file_no_longer_on_disk_is_not_sent_to_the_trash() {
        let (conn, root, cairo) = library("gone");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        std::fs::remove_file(root.join("Trips/Cairo/sphinx.jpg")).unwrap();

        let report = trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();
        assert_eq!(report.trashed, 0);
        assert_eq!(
            report.refused[0].reason,
            Reason::NotOnDisk {
                name: "sphinx.jpg".into()
            }
        );
        assert!(!items::is_trashed(&conn, sphinx).unwrap());
    }
}
