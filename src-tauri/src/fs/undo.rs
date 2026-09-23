//! Reversing what the journal holds: one batch at a time, newest row first. A reversal writes
//! nothing to the journal, and a batch leaves it only once all of it has come back.
//! DECISIONS.md "Undo".

use rusqlite::Connection;
use serde::Serialize;
use serde::de::DeserializeOwned;
use ts_rs::TS;

use crate::db::journal::{self, Entry, FolderCreated, FolderRenamed};
use crate::error::{AppError, Result};
use crate::fs::folders;

/// What an undo put back, and what it could not, each with its reason.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UndoReport {
    pub reversed: u32,
    pub errors: Vec<String>,
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
        match reverse(conn, entry) {
            Ok(()) => report.reversed += 1,
            Err(err) => report.errors.push(err.to_string()),
        }
    }
    // A batch that came back only in part stays, or what failed could never be tried again.
    if report.errors.is_empty() {
        journal::drop_batch(conn, batch_id)?;
    }
    Ok(report)
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
    use crate::fs::{folders, walk};
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
                errors: vec![]
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
        assert_eq!(report.errors.len(), 1);
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
}
