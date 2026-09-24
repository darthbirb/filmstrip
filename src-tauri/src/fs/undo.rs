//! Reversing what the journal holds: one batch at a time, newest row first. A reversal writes
//! nothing to the journal, and each row leaves it as it comes back, so a retry takes back only
//! what stayed. DECISIONS.md "Undo".

use rusqlite::Connection;
use serde::Serialize;
use serde::de::DeserializeOwned;
use ts_rs::TS;

use crate::db::journal::{
    self, Entry, FolderCreated, FolderDeleted, FolderMoved, FolderRenamed, ItemMoved, ItemTrashed,
};
use crate::error::{AppError, Result};
use crate::fs::stayed::{self, Stayed};
use crate::fs::{folders, items, trash};

/// What an undo put back, and what it could not, each with where it still is and why.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UndoReport {
    pub reversed: u32,
    pub stayed: Vec<Stayed>,
}

/// Reverses one batch by id.
pub fn undo_batch(conn: &Connection, batch_id: &str) -> Result<UndoReport> {
    let _turn = super::turn();
    reverse_batch(conn, batch_id)
}

/// Reverses whatever was done last, in this session or an earlier one; nothing when nothing is left.
pub fn undo_last(conn: &Connection) -> Result<Option<UndoReport>> {
    let _turn = super::turn();
    match journal::latest_batch(conn)? {
        Some(batch_id) => reverse_batch(conn, &batch_id).map(Some),
        None => Ok(None),
    }
}

fn reverse_batch(conn: &Connection, batch_id: &str) -> Result<UndoReport> {
    let entries = journal::batch(conn, batch_id)?;
    if entries.is_empty() {
        return Err(AppError::invalid("there is nothing left to undo here"));
    }
    let mut report = UndoReport::default();
    for entry in &entries {
        // What failed stays in the journal, or it could never be tried again.
        match reverse(conn, entry) {
            Ok(()) => {
                journal::drop_entry(conn, entry.id)?;
                report.reversed += 1;
            }
            Err(err) => report.stayed.push(stayed_of(conn, entry, &err)?),
        }
    }
    Ok(report)
}

/// The file or folder a row that failed to come back is about.
fn stayed_of(conn: &Connection, entry: &Entry, err: &AppError) -> Result<Stayed> {
    match entry.op.as_str() {
        journal::ITEM_MOVE => stayed::file(conn, inverse::<ItemMoved>(entry)?.item_id, err),
        journal::ITEM_TRASH => stayed::file(conn, inverse::<ItemTrashed>(entry)?.item_id, err),
        journal::FOLDER_CREATE => {
            stayed::folder(conn, inverse::<FolderCreated>(entry)?.folder_id, err)
        }
        journal::FOLDER_RENAME => {
            stayed::folder(conn, inverse::<FolderRenamed>(entry)?.folder_id, err)
        }
        journal::FOLDER_MOVE => stayed::folder(conn, inverse::<FolderMoved>(entry)?.folder_id, err),
        journal::FOLDER_DELETE => {
            stayed::folder(conn, inverse::<FolderDeleted>(entry)?.folder_id, err)
        }
        other => Err(AppError::invalid(format!("{other} cannot be undone"))),
    }
}

fn reverse(conn: &Connection, entry: &Entry) -> Result<()> {
    match entry.op.as_str() {
        journal::FOLDER_CREATE => {
            let made: FolderCreated = inverse(entry)?;
            folders::unmake(conn, made.folder_id)
        }
        journal::FOLDER_RENAME => {
            let back: FolderRenamed = inverse(entry)?;
            folders::rename_unjournalled(conn, back.folder_id, &back.to, None).map(|_| ())
        }
        journal::FOLDER_MOVE => {
            let back: FolderMoved = inverse(entry)?;
            folders::move_unjournalled(conn, back.folder_id, back.to_parent_id, None).map(|_| ())
        }
        journal::ITEM_MOVE => {
            let back: ItemMoved = inverse(entry)?;
            items::move_unjournalled(conn, back.item_id, back.to_folder_id, None).map(|_| ())
        }
        journal::ITEM_TRASH => {
            let back: ItemTrashed = inverse(entry)?;
            trash::restore_unjournalled(conn, back.item_id)
        }
        journal::FOLDER_DELETE => {
            let back: FolderDeleted = inverse(entry)?;
            folders::undelete(conn, back.folder_id, back.retired_at)
        }
        other => Err(AppError::invalid(format!("{other} cannot be undone"))),
    }
}

/// The journal is JSON that outlives the code that wrote it, so a row that no longer reads is one
/// failed undo, never a crash.
fn inverse<T: DeserializeOwned>(entry: &Entry) -> Result<T> {
    serde_json::from_value(entry.inverse.clone())
        .map_err(|err| AppError::invalid(format!("journal row {} does not read: {err}", entry.id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::SourceKind;
    use crate::db::{self, folders as rows, sources};
    use crate::fs::{folders, items, walk};
    use std::path::{Path, PathBuf};
    use std::sync::mpsc;
    use std::time::Duration;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-undo")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("library/Trips/Cairo")).unwrap();
        std::fs::write(dir.join("library/Trips/Cairo/pyramid.jpg"), "p").unwrap();
        dir
    }

    fn open(dir: &Path) -> Connection {
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    /// The library under `dir`, walked, and the id of its Trips folder.
    fn library(dir: &Path) -> (Connection, i64) {
        let conn = open(dir);
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = rows::source_root_folder(&conn, 1).unwrap();
        let trips = rows::child_id(&conn, top, "Trips").unwrap().unwrap();
        (conn, trips)
    }

    #[test]
    fn undo_takes_back_a_folder_made_and_puts_back_a_name_changed_newest_first() {
        let dir = scratch("both");
        let (conn, trips) = library(&dir);
        let made = folders::create(&conn, trips, "Lisbon", &journal::new_batch()).unwrap();
        let cairo = rows::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        folders::rename(&conn, cairo, "Giza", &journal::new_batch()).unwrap();

        let first = undo_last(&conn).unwrap().unwrap();
        assert_eq!(
            first,
            UndoReport {
                reversed: 1,
                stayed: vec![]
            }
        );
        assert!(dir.join("library/Trips/Cairo/pyramid.jpg").is_file());
        assert_eq!(rows::title(&conn, cairo).unwrap().as_deref(), Some("Cairo"));
        assert!(
            dir.join("library/Trips/Lisbon").is_dir(),
            "one undo, one batch"
        );

        undo_last(&conn).unwrap().unwrap();
        assert!(!dir.join("library/Trips/Lisbon").exists());
        assert_eq!(rows::title(&conn, made).unwrap(), None);
        assert_eq!(undo_last(&conn).unwrap(), None, "nothing is left to undo");
    }

    #[test]
    fn what_was_done_before_the_app_closed_is_undone_after_it_opens_again() {
        let dir = scratch("restart");
        let (conn, trips) = library(&dir);
        let cairo = rows::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        folders::rename(&conn, cairo, "Giza", &journal::new_batch()).unwrap();
        drop(conn);

        let reopened = open(&dir);
        undo_last(&reopened).unwrap().unwrap();
        assert!(dir.join("library/Trips/Cairo").is_dir());
        assert_eq!(
            rows::title(&reopened, cairo).unwrap().as_deref(),
            Some("Cairo")
        );
    }

    #[test]
    fn a_folder_that_has_filled_since_stays_and_its_undo_stays_in_the_journal() {
        let dir = scratch("filled");
        let (conn, trips) = library(&dir);
        let batch = journal::new_batch();
        folders::create(&conn, trips, "Lisbon", &batch).unwrap();
        std::fs::write(dir.join("library/Trips/Lisbon/tram.jpg"), "t").unwrap();

        let report = undo_batch(&conn, &batch).unwrap();
        assert_eq!(report.reversed, 0);
        assert_eq!(report.stayed.len(), 1);
        assert!(dir.join("library/Trips/Lisbon/tram.jpg").is_file());
        assert_eq!(journal::latest_batch(&conn).unwrap(), Some(batch));
    }

    #[test]
    fn a_batch_already_undone_cannot_be_undone_twice() {
        let dir = scratch("twice");
        let (conn, trips) = library(&dir);
        let batch = journal::new_batch();
        folders::create(&conn, trips, "Lisbon", &batch).unwrap();
        undo_batch(&conn, &batch).unwrap();
        assert!(undo_batch(&conn, &batch).is_err());
    }

    #[test]
    fn a_change_waits_while_a_walk_has_its_turn() {
        let dir = scratch("turn");
        let (conn, trips) = library(&dir);
        drop(conn);

        let walking = crate::fs::turn();
        let (done, finished) = mpsc::channel();
        let path = dir.clone();
        let changer = std::thread::spawn(move || {
            let conn = open(&path);
            folders::create(&conn, trips, "Lisbon", &journal::new_batch()).unwrap();
            done.send(()).unwrap();
        });
        assert!(
            finished.recv_timeout(Duration::from_millis(300)).is_err(),
            "the change went ahead while the walk had its turn"
        );
        drop(walking);
        finished.recv_timeout(Duration::from_secs(10)).unwrap();
        changer.join().unwrap();
        assert!(dir.join("library/Trips/Lisbon").is_dir());
    }

    #[test]
    fn one_undo_brings_back_a_whole_selection_and_another_the_folder_moved_after_it() {
        let dir = scratch("moves");
        std::fs::write(dir.join("library/Trips/Cairo/sphinx.jpg"), "s").unwrap();
        std::fs::create_dir_all(dir.join("library/People")).unwrap();
        let (conn, trips) = library(&dir);
        let top = rows::source_root_folder(&conn, 1).unwrap();
        let people = rows::child_id(&conn, top, "People").unwrap().unwrap();
        let cairo = rows::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let ids: Vec<i64> = db::items::in_folder(&conn, cairo)
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();

        items::move_items(&conn, &ids, people, &journal::new_batch()).unwrap();
        folders::move_into(&conn, cairo, people, &journal::new_batch()).unwrap();

        undo_last(&conn).unwrap().unwrap();
        assert!(dir.join("library/Trips/Cairo").is_dir());
        let report = undo_last(&conn).unwrap().unwrap();
        assert_eq!(
            report,
            UndoReport {
                reversed: 2,
                stayed: vec![]
            }
        );
        assert!(dir.join("library/Trips/Cairo/pyramid.jpg").is_file());
        assert!(dir.join("library/Trips/Cairo/sphinx.jpg").is_file());
        let home = |id: &i64| db::items::folder_of(&conn, *id).unwrap() == Some(cairo);
        assert!(ids.iter().all(home));
    }

    #[test]
    fn a_file_that_cannot_go_back_because_its_name_is_taken_keeps_its_undo() {
        let dir = scratch("blocked");
        std::fs::create_dir_all(dir.join("library/People")).unwrap();
        let (conn, trips) = library(&dir);
        let top = rows::source_root_folder(&conn, 1).unwrap();
        let people = rows::child_id(&conn, top, "People").unwrap().unwrap();
        let cairo = rows::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let pyramid = db::items::in_folder(&conn, cairo).unwrap()[0].id;

        let batch = journal::new_batch();
        items::move_items(&conn, &[pyramid], people, &batch).unwrap();
        std::fs::write(dir.join("library/Trips/Cairo/pyramid.jpg"), "a new one").unwrap();

        let report = undo_batch(&conn, &batch).unwrap();
        assert_eq!(report.reversed, 0);
        assert_eq!(report.stayed[0].id, pyramid);
        assert_eq!(
            report.stayed[0].reason,
            crate::error::Reason::NameTaken {
                place: "Cairo".into(),
                name: "pyramid.jpg".into(),
                folder: false
            }
        );
        assert!(dir.join("library/People/pyramid.jpg").is_file());
        assert_eq!(journal::latest_batch(&conn).unwrap(), Some(batch));
    }

    #[test]
    fn a_retry_takes_back_only_what_stayed_the_first_time() {
        let dir = scratch("retry");
        std::fs::write(dir.join("library/Trips/Cairo/sphinx.jpg"), "s").unwrap();
        let (conn, trips) = library(&dir);
        let cairo = rows::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let ids: Vec<i64> = db::items::in_folder(&conn, cairo)
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();
        let batch = journal::new_batch();
        crate::fs::trash::trash_items(&conn, &ids, &batch).unwrap();
        std::fs::write(dir.join("library/Trips/Cairo/sphinx.jpg"), "in the way").unwrap();

        let first = undo_batch(&conn, &batch).unwrap();
        assert_eq!((first.reversed, first.stayed.len()), (1, 1));

        std::fs::remove_file(dir.join("library/Trips/Cairo/sphinx.jpg")).unwrap();
        let retry = undo_batch(&conn, &batch).unwrap();
        assert_eq!(
            retry,
            UndoReport {
                reversed: 1,
                stayed: vec![]
            }
        );
        assert!(dir.join("library/Trips/Cairo/pyramid.jpg").is_file());
        assert!(dir.join("library/Trips/Cairo/sphinx.jpg").is_file());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
    }
}
