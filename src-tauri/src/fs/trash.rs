//! The trash: a folder beside the executable where a file waits, out of its folder, until it is
//! taken back. Sending one there is a move like any other, journalled, so it can be undone.
//! DECISIONS.md "Undo".

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

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

/// Takes an item back out of the trash into the folder it left, under its own name.
pub(super) fn restore_unjournalled(conn: &Connection, item_id: i64) -> Result<()> {
    if !items::is_trashed(conn, item_id)? {
        return Err(AppError::invalid("that file is not in the trash"));
    }
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let place = folders::title(conn, file.folder_id)?.unwrap_or_default();
    if !folders::is_live(conn, file.folder_id)? {
        return Err(AppError::refused(Reason::FolderGone { name: place }));
    }
    let taken = || {
        AppError::refused(Reason::NameTaken {
            place: place.clone(),
            name: file.disk_name.clone(),
            folder: false,
        })
    };
    let held = items::existing_by_disk_name(conn, file.folder_id, &file.disk_name)?;
    if held.as_ref().is_some_and(|row| !row.deleted) {
        return Err(taken());
    }
    let from = paths::trash_path(&file.uuid, &file.disk_name)?;
    let to = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    if to.exists() {
        return Err(taken());
    }
    relocate::relocate(&from, &to)?;

    let recorded = in_transaction(conn, |tx| {
        // A retired row holding the name describes a file that is gone; the returning one takes it.
        if let Some(stale) = &held {
            items::forget_retired(tx, stale.id)?;
        }
        items::take_from_trash(tx, item_id)?;
        tags::rebuild_item(tx, item_id)
    });
    if recorded.is_err() {
        let _ = relocate::relocate(&to, &from);
    }
    recorded
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
        assert_eq!(report.reversed, 0);
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
