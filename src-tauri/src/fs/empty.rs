//! Emptying the Trash: the files the library sent to the Recycle Bin deleted for good, each found
//! again in the bin first, and nothing else in the bin touched. Nothing is journalled.
//! DECISIONS.md "Emptying the Trash".

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::in_transaction;
use crate::db::items::{self, Tally};
use crate::error::Result;
use crate::fs::recycle::{self, Shell};
use crate::fs::trash::{self, Found};

/// A file Empty Trash… counted, by its row and the name the bin kept it under as it asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Counted {
    pub item_id: i64,
    pub bin_path: Option<String>,
}

/// What Empty Trash… asks about: the files the Trash holds, oldest first, and what they weigh.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ToEmpty {
    pub files: Vec<Counted>,
    pub held: Tally,
}

pub fn to_empty(conn: &Connection) -> Result<ToEmpty> {
    let mut files = Vec::new();
    let mut held = Tally::default();
    for (row, _) in items::in_trash(conn)?.into_iter().rev() {
        held.count += 1;
        held.bytes += row.size_bytes;
        files.push(Counted {
            item_id: row.id,
            bin_path: items::binned(conn, row.id)?.map(|(path, _)| path),
        });
    }
    Ok(ToEmpty { files, held })
}

/// What emptying did with the files counted that were still in the Trash: those deleted and what
/// they weighed, those no longer in the Recycle Bin, and those that would not go, which stay in
/// the Trash, with the first of them to show there.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Emptied {
    pub deleted: u32,
    pub bytes: i64,
    pub gone: u32,
    pub kept: u32,
    pub first_kept: Option<i64>,
}

enum Outcome {
    Deleted(i64),
    Gone,
    Kept,
    /// Taken out of the Trash since it was counted, or sent there again under another name.
    NotCounted,
}

/// Deletes for good each file counted that is still in the Trash as it was counted, one turn of
/// the disk per file, so a restore between two takes its file out of reach. `progress` hears how
/// many of them are settled.
pub fn empty(conn: &Connection, counted: &[Counted], progress: &dyn Fn(u32)) -> Result<Emptied> {
    let mut emptied = Emptied::default();
    for (at, one) in counted.iter().enumerate() {
        let outcome = {
            let _turn = super::turn();
            empty_one(conn, one)?
        };
        match outcome {
            Outcome::Deleted(bytes) => {
                emptied.deleted += 1;
                emptied.bytes += bytes;
            }
            Outcome::Gone => emptied.gone += 1,
            Outcome::Kept => {
                emptied.kept += 1;
                emptied.first_kept.get_or_insert(one.item_id);
            }
            Outcome::NotCounted => {}
        }
        progress(u32::try_from(at + 1).unwrap_or(u32::MAX));
    }
    Ok(emptied)
}

/// Finds one counted file again by what it is, in the bin where it went, and deletes it there.
/// The caller holds the disk's turn.
fn empty_one(conn: &Connection, counted: &Counted) -> Result<Outcome> {
    let id = counted.item_id;
    let binned = items::binned(conn, id)?;
    if !items::is_trashed(conn, id)?
        || binned.as_ref().map(|(path, _)| path) != counted.bin_path.as_ref()
    {
        return Ok(Outcome::NotCounted);
    }
    let Some(file) = items::file_of(conn, id)? else {
        return Ok(Outcome::NotCounted);
    };
    match trash::find(conn, id, &file)? {
        Found::Bin(path) => {
            let Some((_, itself)) = binned else {
                return Ok(Outcome::NotCounted);
            };
            let bytes = items::size_of(conn, id)?.unwrap_or_default();
            if let Err(err) = recycle::purge(&Shell, &path, &itself) {
                eprintln!("empty: {} stays in the Trash: {err}", path.display());
                return Ok(Outcome::Kept);
            }
            // The file is gone whatever the index says now; a row left in the Trash is retired by
            // the next look in the bin.
            if let Err(err) = in_transaction(conn, |tx| trash::leave(tx, id)) {
                eprintln!("empty: {} is gone, its row not yet: {err}", path.display());
            }
            Ok(Outcome::Deleted(bytes))
        }
        Found::Gone => {
            in_transaction(conn, |tx| trash::leave(tx, id))?;
            Ok(Outcome::Gone)
        }
        Found::Back => {
            in_transaction(conn, |tx| trash::put_back(tx, id, &file))?;
            Ok(Outcome::Gone)
        }
        Found::Away => Ok(Outcome::Kept),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, folders, journal, tags};
    use crate::fs::recycle::tests::{Fake, stand_in};
    use crate::fs::{settles_to, undo, walk};
    use std::cell::{Cell, RefCell};
    use std::path::{Path, PathBuf};
    use std::rc::Rc;

    struct Library {
        conn: Connection,
        root: PathBuf,
        cairo: i64,
        bin: Rc<Fake>,
    }

    /// Trips/Cairo holding the files named, each holding its own name, walked into a real file,
    /// with the thread's stand-in for the bin.
    fn library(name: &str, files: &[&str]) -> Library {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-empty")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("library");
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        for file in files {
            std::fs::write(root.join("Trips/Cairo").join(file), *file).unwrap();
        }
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        Library {
            conn,
            root,
            cairo,
            bin: stand_in(),
        }
    }

    impl Library {
        fn id(&self, name: &str) -> i64 {
            items::existing_by_disk_name(&self.conn, self.cairo, name)
                .unwrap()
                .unwrap()
                .id
        }

        /// Deletes the files named, as one act, and the batch that undoes it.
        fn delete(&self, names: &[&str]) -> String {
            let ids: Vec<i64> = names.iter().map(|name| self.id(name)).collect();
            let batch = journal::new_batch();
            let report = trash::trash_items(&self.conn, &ids, &batch).unwrap();
            assert_eq!(report.trashed as usize, ids.len());
            batch
        }

        fn in_bin(&self, id: i64) -> PathBuf {
            PathBuf::from(items::binned(&self.conn, id).unwrap().unwrap().0)
        }

        fn in_cairo(&self, name: &str) -> PathBuf {
            self.root.join("Trips/Cairo").join(name)
        }

        fn asked(&self) -> ToEmpty {
            to_empty(&self.conn).unwrap()
        }

        fn empty(&self, asked: &ToEmpty) -> Emptied {
            empty(&self.conn, &asked.files, &|_| {}).unwrap()
        }

        fn bin_dir(&self) -> &Path {
            self.bin.dir().unwrap()
        }
    }

    #[test]
    fn emptying_deletes_from_the_bin_only_what_was_counted_and_undo_passes_over_it() {
        let lib = library("counted", &["a.jpg", "b.jpg", "c.jpg", "d.jpg"]);
        let (a, b, c) = (lib.id("a.jpg"), lib.id("b.jpg"), lib.id("c.jpg"));
        let named = journal::new_batch();
        crate::fs::items::rename(&lib.conn, lib.id("d.jpg"), "e.jpg", &named).unwrap();
        tags::add_items_tag(&lib.conn, &[a, c], "dusk", &journal::new_batch()).unwrap();
        let deleted = lib.delete(&["a.jpg", "b.jpg"]);
        let binned = [lib.in_bin(a), lib.in_bin(b)];
        std::fs::write(lib.bin_dir().join("theirs.jpg"), "not the library's").unwrap();
        let asked = lib.asked();
        assert_eq!(
            asked.held,
            Tally {
                count: 2,
                bytes: 10
            }
        );
        lib.delete(&["c.jpg"]);
        let heard = RefCell::new(Vec::new());

        let emptied = empty(&lib.conn, &asked.files, &|done| {
            heard.borrow_mut().push(done);
        })
        .unwrap();

        assert_eq!(
            emptied,
            Emptied {
                deleted: 2,
                bytes: 10,
                ..Emptied::default()
            }
        );
        assert_eq!(*heard.borrow(), [1, 2]);
        for file in &binned {
            assert!(std::fs::symlink_metadata(file).is_err());
        }
        assert_eq!(lib.bin.let_go.borrow().as_slice(), binned);
        assert_eq!(
            std::fs::read_to_string(lib.bin_dir().join("theirs.jpg")).unwrap(),
            "not the library's"
        );
        assert_eq!(
            std::fs::read_to_string(lib.in_bin(c)).unwrap(),
            "c.jpg",
            "deleted after the question, it stays"
        );
        assert_eq!(lib.asked().files.len(), 1);
        for id in [a, b] {
            assert!(!items::is_trashed(&lib.conn, id).unwrap());
            assert!(!items::is_live(&lib.conn, id).unwrap());
        }
        assert!(journal::batch(&lib.conn, &deleted).unwrap().is_empty());

        // Ctrl+Z takes back the delete after it, then the tag, now c's alone, then the rename.
        undo::undo_last(&lib.conn).unwrap().unwrap();
        assert!(items::is_live(&lib.conn, c).unwrap());
        let untagged = undo::undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(untagged.batch.files, 1);
        let back = undo::undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(back.batch.batch_id, named);
        assert!(back.stayed.is_empty());
        settles_to(&lib.root.join("Trips/Cairo"), &["c.jpg", "d.jpg"]);
        assert_eq!(undo::undo_last(&lib.conn).unwrap(), None);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_that_would_not_go_stays_in_the_trash_and_undo_still_brings_it_back() {
        use std::os::windows::fs::OpenOptionsExt;

        let lib = library("would-not-go", &["a.jpg", "b.jpg", "c.jpg"]);
        let (a, b) = (lib.id("a.jpg"), lib.id("b.jpg"));
        let batch = lib.delete(&["a.jpg", "b.jpg", "c.jpg"]);
        let held = lib.in_bin(b);
        let open = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&held)
            .unwrap();

        let emptied = lib.empty(&lib.asked());
        drop(open);

        assert_eq!((emptied.deleted, emptied.gone, emptied.kept), (2, 0, 1));
        assert_eq!(emptied.first_kept, Some(b));
        assert_eq!(std::fs::read_to_string(&held).unwrap(), "b.jpg");
        assert_eq!(
            lib.asked().files,
            [Counted {
                item_id: b,
                bin_path: Some(held.to_string_lossy().into_owned()),
            }]
        );
        assert!(!items::is_trashed(&lib.conn, a).unwrap());

        let back = undo::undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(back.batch.batch_id, batch);
        assert_eq!((back.files_back, back.stayed.len()), (1, 0));
        settles_to(&lib.root.join("Trips/Cairo"), &["b.jpg"]);
        assert!(items::is_live(&lib.conn, b).unwrap());
    }

    #[test]
    fn a_file_no_longer_in_the_bin_is_skipped_and_said_and_nothing_is_deleted_for_it() {
        let lib = library("no-longer", &["a.jpg", "b.jpg", "c.jpg"]);
        let (a, b, c) = (lib.id("a.jpg"), lib.id("b.jpg"), lib.id("c.jpg"));
        let batch = lib.delete(&["a.jpg", "b.jpg", "c.jpg"]);
        let asked = lib.asked();
        std::fs::remove_file(lib.in_bin(a)).unwrap();
        std::fs::rename(lib.in_bin(b), lib.in_cairo("b.jpg")).unwrap();

        let emptied = lib.empty(&asked);

        assert_eq!((emptied.deleted, emptied.gone, emptied.kept), (1, 2, 0));
        assert_eq!(emptied.bytes, 5);
        assert!(!items::is_trashed(&lib.conn, a).unwrap());
        assert!(!items::is_live(&lib.conn, a).unwrap());
        assert!(items::is_live(&lib.conn, b).unwrap());
        assert_eq!(
            std::fs::read_to_string(lib.in_cairo("b.jpg")).unwrap(),
            "b.jpg",
            "put back from Explorer, it is never deleted"
        );
        assert!(!items::is_trashed(&lib.conn, c).unwrap());
        assert_eq!(lib.bin.let_go.borrow().len(), 1);
        let left = journal::batch(&lib.conn, &batch).unwrap();
        assert_eq!(left.len(), 1, "only the one put back is left to undo");
        let back = undo::undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!((back.files_back, back.stayed.len()), (1, 0));
    }

    #[test]
    fn a_restore_racing_an_empty_takes_its_file_out_of_reach_and_it_is_never_deleted() {
        let lib = library("restore-race", &["a.jpg", "b.jpg", "c.jpg"]);
        let b = lib.id("b.jpg");
        lib.delete(&["a.jpg", "b.jpg", "c.jpg"]);
        let asked = lib.asked();
        let restored = Cell::new(false);

        let emptied = empty(&lib.conn, &asked.files, &|done| {
            if done == 1 {
                let report =
                    trash::restore_items(&lib.conn, &[b], None, &journal::new_batch()).unwrap();
                restored.set(report.restored == 1);
            }
        })
        .unwrap();

        assert!(restored.get());
        assert_eq!((emptied.deleted, emptied.gone, emptied.kept), (2, 0, 0));
        assert_eq!(
            std::fs::read_to_string(lib.in_cairo("b.jpg")).unwrap(),
            "b.jpg"
        );
        assert!(items::is_live(&lib.conn, b).unwrap());
        assert!(lib.asked().files.is_empty());
    }

    #[test]
    fn a_file_deleted_again_after_the_question_is_not_the_one_counted_and_stays() {
        let lib = library("again", &["a.jpg"]);
        let a = lib.id("a.jpg");
        lib.delete(&["a.jpg"]);
        let asked = lib.asked();
        let first = lib.in_bin(a);
        trash::restore_items(&lib.conn, &[a], None, &journal::new_batch()).unwrap();
        // The bin names each file it takes afresh.
        std::fs::write(&first, "theirs").unwrap();
        lib.delete(&["a.jpg"]);
        assert_ne!(lib.in_bin(a), first);

        let emptied = lib.empty(&asked);

        assert_eq!(emptied, Emptied::default());
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "theirs");
        assert_eq!(std::fs::read_to_string(lib.in_bin(a)).unwrap(), "a.jpg");
        assert!(items::is_trashed(&lib.conn, a).unwrap());
    }

    #[test]
    fn every_act_on_an_emptied_file_alone_leaves_the_journal_and_undo_finds_nothing_stuck() {
        let lib = library("journal", &["a.jpg"]);
        let a = lib.id("a.jpg");
        crate::fs::items::rename(&lib.conn, a, "b.jpg", &journal::new_batch()).unwrap();
        lib.delete(&["b.jpg"]);
        trash::restore_items(&lib.conn, &[a], None, &journal::new_batch()).unwrap();
        lib.delete(&["b.jpg"]);

        assert_eq!(lib.empty(&lib.asked()).deleted, 1);

        assert_eq!(journal::latest_batch(&lib.conn).unwrap(), None);
        assert_eq!(undo::undo_last(&lib.conn).unwrap(), None);
    }

    #[test]
    fn a_folder_whose_files_were_all_emptied_is_never_made_again_by_undo() {
        let lib = library("folder", &["a.jpg", "b.jpg"]);
        let trips = folders::parent(&lib.conn, lib.cairo).unwrap().unwrap();
        std::fs::write(lib.root.join("Trips/note.jpg"), "note").unwrap();
        std::fs::create_dir(lib.root.join("Trips/Empty")).unwrap();
        walk::reconcile(&lib.conn).unwrap();
        let note = items::existing_by_disk_name(&lib.conn, trips, "note.jpg")
            .unwrap()
            .unwrap()
            .id;
        let named = journal::new_batch();
        crate::fs::items::rename(&lib.conn, note, "dusk.jpg", &named).unwrap();
        let empty_dir = folders::child_id(&lib.conn, trips, "Empty")
            .unwrap()
            .unwrap();
        let emptied_dir = journal::new_batch();
        crate::fs::folders::delete(&lib.conn, empty_dir, None, &emptied_dir).unwrap();
        let cairo = journal::new_batch();
        let report = crate::fs::folders::delete(
            &lib.conn,
            lib.cairo,
            Some(crate::fs::folders::Contents::Trash),
            &cairo,
        )
        .unwrap();
        assert!(report.deleted);

        assert_eq!(lib.empty(&lib.asked()).deleted, 2);

        assert!(journal::batch(&lib.conn, &cairo).unwrap().is_empty());
        let back = undo::undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(
            back.batch.batch_id, emptied_dir,
            "a folder that held no file keeps its undo"
        );
        assert!(lib.root.join("Trips/Empty").is_dir());
        let back = undo::undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(back.batch.batch_id, named);
        assert!(!lib.root.join("Trips/Cairo").exists());
        assert!(!folders::is_live(&lib.conn, lib.cairo).unwrap());
        assert_eq!(undo::undo_last(&lib.conn).unwrap(), None);
    }

    #[test]
    fn a_folder_whose_files_left_the_bin_from_explorer_and_empty_trash_is_never_made_again() {
        let lib = library("explorer-then-empty", &["a.jpg", "b.jpg"]);
        let a = lib.id("a.jpg");
        let trips = folders::parent(&lib.conn, lib.cairo).unwrap().unwrap();
        std::fs::write(lib.root.join("Trips/note.jpg"), "note").unwrap();
        walk::reconcile(&lib.conn).unwrap();
        let note = items::existing_by_disk_name(&lib.conn, trips, "note.jpg")
            .unwrap()
            .unwrap()
            .id;
        let named = journal::new_batch();
        crate::fs::items::rename(&lib.conn, note, "dusk.jpg", &named).unwrap();
        let cairo = journal::new_batch();
        let report = crate::fs::folders::delete(
            &lib.conn,
            lib.cairo,
            Some(crate::fs::folders::Contents::Trash),
            &cairo,
        )
        .unwrap();
        assert!(report.deleted);
        std::fs::remove_file(lib.in_bin(a)).unwrap();
        assert_eq!(trash::look_in_bin(&lib.conn).unwrap().retired, 1);

        assert_eq!(lib.empty(&lib.asked()).deleted, 1);

        assert!(journal::batch(&lib.conn, &cairo).unwrap().is_empty());
        let back = undo::undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(back.batch.batch_id, named);
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert!(!lib.root.join("Trips/Cairo").exists());
        assert!(!folders::is_live(&lib.conn, lib.cairo).unwrap());
        settles_to(&lib.root.join("Trips"), &["note.jpg"]);
        assert_eq!(undo::undo_last(&lib.conn).unwrap(), None);
    }

    #[test]
    fn a_trashed_row_naming_a_file_outside_the_bin_never_has_it_deleted() {
        let lib = library("outside", &["a.jpg"]);
        let a = lib.id("a.jpg");
        lib.delete(&["a.jpg"]);
        let (binned, itself) = items::binned(&lib.conn, a).unwrap().unwrap();
        let outside = lib.root.join("a-again.jpg");
        std::fs::hard_link(&binned, &outside).unwrap();
        items::set_binned(&lib.conn, a, &outside.to_string_lossy(), &itself).unwrap();

        let emptied = lib.empty(&lib.asked());

        assert_eq!((emptied.deleted, emptied.kept), (0, 1));
        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "a.jpg");
        assert_eq!(std::fs::read_to_string(&binned).unwrap(), "a.jpg");
        assert!(items::is_trashed(&lib.conn, a).unwrap());
    }

    #[test]
    fn a_file_with_another_name_outside_the_bin_keeps_it() {
        let lib = library("other-name", &["a.jpg"]);
        let kept = lib.root.join("a-again.jpg");
        std::fs::hard_link(lib.in_cairo("a.jpg"), &kept).unwrap();
        lib.delete(&["a.jpg"]);

        let emptied = lib.empty(&lib.asked());

        assert_eq!(emptied.deleted, 1);
        assert_eq!(std::fs::read_to_string(&kept).unwrap(), "a.jpg");
    }

    #[test]
    fn a_file_on_a_drive_that_is_away_waits_in_the_trash() {
        let lib = library("away", &["a.jpg"]);
        let a = lib.id("a.jpg");
        lib.delete(&["a.jpg"]);
        let (_, itself) = items::binned(&lib.conn, a).unwrap().unwrap();
        let letter = ('D'..='Z')
            .rev()
            .find(|letter| !Path::new(&format!(r"{letter}:\")).is_dir())
            .unwrap();
        let away = format!(r"{letter}:\$Recycle.Bin\$RAWAY.jpg");
        items::set_binned(&lib.conn, a, &away, &itself).unwrap();

        let emptied = lib.empty(&lib.asked());

        assert_eq!((emptied.kept, emptied.first_kept), (1, Some(a)));
        assert!(items::is_trashed(&lib.conn, a).unwrap());
    }
}
