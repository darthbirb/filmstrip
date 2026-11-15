//! Emptying the trash: the one act that deletes a file outright, and only ever a file the trash
//! holds, under the name the trash gave it. DECISIONS.md "Emptying the trash".

use std::path::Path;

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::items::{self, Tally};
use crate::db::{expired, in_transaction, journal};
use crate::error::{AppError, Reason, Result};
use crate::fs::paths;

/// What the trash holds as Empty Trash… asks: the files its answer empties, and what they weigh.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ToEmpty {
    pub item_ids: Vec<i64>,
    pub held: Tally,
}

pub fn to_empty(conn: &Connection) -> Result<ToEmpty> {
    Ok(ToEmpty {
        item_ids: items::trash_oldest_first(conn)?
            .into_iter()
            .map(|one| one.id)
            .collect(),
        held: items::in_trash_tally(conn)?,
    })
}

/// What emptying did: the files deleted and what they weighed, and those that would not go, which
/// stay in the trash under their rows.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Emptied {
    pub deleted: u32,
    pub bytes: i64,
    pub kept: u32,
    pub first_kept: Option<i64>,
    /// Whether every file kept was kept because another program has it open.
    pub in_use: bool,
}

enum Outcome {
    Deleted(i64),
    Kept(Reason),
    NotInTrash,
}

/// Deletes each of the files asked about that is still in the trash, one turn of the disk per
/// file, so a restore between two takes its file out of reach. `progress` hears how many are
/// settled. Expiry waits for the whole of it.
pub fn empty(conn: &Connection, item_ids: &[i64], progress: &dyn Fn(u32)) -> Result<Emptied> {
    let _run = super::trash_run();
    let mut emptied = Emptied {
        in_use: true,
        ..Emptied::default()
    };
    let mut gone = Vec::new();
    for (at, &item_id) in item_ids.iter().enumerate() {
        let outcome = {
            let _turn = super::turn();
            delete(conn, item_id)?
        };
        match outcome {
            Outcome::Deleted(bytes) => {
                emptied.deleted += 1;
                emptied.bytes += bytes;
                gone.push(item_id);
            }
            Outcome::Kept(reason) => {
                emptied.kept += 1;
                emptied.first_kept.get_or_insert(item_id);
                emptied.in_use &= reason == Reason::InUse;
            }
            Outcome::NotInTrash => {}
        }
        progress(at as u32 + 1);
    }
    emptied.in_use &= emptied.kept > 0;
    let refused = expired::refused(conn)?;
    if refused.iter().any(|id| gone.contains(id)) {
        let left: Vec<i64> = refused
            .into_iter()
            .filter(|id| !gone.contains(id))
            .collect();
        expired::set_refused(conn, &left)?;
    }
    Ok(emptied)
}

/// Deletes one trashed file and then forgets its row and every journal row about it alone. The
/// caller holds the disk's turn.
fn delete(conn: &Connection, item_id: i64) -> Result<Outcome> {
    let Some(bytes) = items::trashed_bytes(conn, item_id)? else {
        return Ok(Outcome::NotInTrash);
    };
    let Some(file) = items::file_of(conn, item_id)? else {
        return Ok(Outcome::NotInTrash);
    };
    let path = paths::trash_path(&file.uuid, &file.disk_name)?;
    if let Err(err) = remove(&path) {
        eprintln!("empty: {} was kept: {err}", path.display());
        return Ok(Outcome::Kept(Reason::of(&AppError::Io(err))));
    }
    in_transaction(conn, |tx| {
        journal::forget_item(tx, item_id)?;
        items::forget_trashed(tx, item_id)
    })?;
    Ok(Outcome::Deleted(bytes))
}

/// Removes the one file at `path`, never a directory and never what a link points to; on Windows a
/// read-only file goes too. A file already gone counts as removed.
fn remove(path: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        done => done,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, folders, tags};
    use crate::fs::expiry::{self, Limits};
    use crate::fs::recycle::tests::{Fake, Stand};
    use crate::fs::{trash, undo, walk};
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::PathBuf;

    struct Library {
        conn: Connection,
        dir: PathBuf,
        cairo: i64,
    }

    /// Trips/Cairo holding the files named, walked into a real file, in a folder of its own.
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
        Library { conn, dir, cairo }
    }

    impl Library {
        fn id(&self, name: &str) -> i64 {
            items::existing_by_disk_name(&self.conn, self.cairo, name)
                .unwrap()
                .unwrap()
                .id
        }

        /// Sends the files named to the trash, each in a batch of its own.
        fn trashed(&self, names: &[&str]) -> Vec<(i64, String)> {
            names
                .iter()
                .map(|name| {
                    let id = self.id(name);
                    let batch = journal::new_batch();
                    trash::trash_items(&self.conn, &[id], &batch).unwrap();
                    (id, batch)
                })
                .collect()
        }

        fn trash_file(&self, id: i64) -> PathBuf {
            let file = items::file_of(&self.conn, id).unwrap().unwrap();
            paths::trash_path(&file.uuid, &file.disk_name).unwrap()
        }

        fn in_cairo(&self, name: &str) -> PathBuf {
            self.dir.join("library/Trips/Cairo").join(name)
        }

        fn ids(&self) -> Vec<i64> {
            to_empty(&self.conn).unwrap().item_ids
        }
    }

    #[test]
    fn emptying_deletes_every_file_in_the_trash_its_rows_and_its_journal_and_nothing_else() {
        let lib = library("all", &["a.jpg", "b.jpg", "kept.jpg"]);
        let batches = lib.trashed(&["a.jpg", "b.jpg"]);
        let files: Vec<PathBuf> = batches.iter().map(|(id, _)| lib.trash_file(*id)).collect();
        let asked = to_empty(&lib.conn).unwrap();
        assert_eq!(
            asked.held,
            Tally {
                count: 2,
                bytes: 10
            }
        );
        let heard = std::cell::RefCell::new(Vec::new());

        let emptied = empty(&lib.conn, &asked.item_ids, &|done| {
            heard.borrow_mut().push(done)
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
        for file in &files {
            assert!(!file.exists());
        }
        assert_eq!(items::in_trash_tally(&lib.conn).unwrap(), Tally::default());
        for (id, batch) in &batches {
            assert!(items::file_of(&lib.conn, *id).unwrap().is_none());
            assert!(journal::batch(&lib.conn, batch).unwrap().is_empty());
        }
        assert_eq!(undo::undo_last(&lib.conn).unwrap(), None);
        assert!(lib.in_cairo("kept.jpg").is_file());
        assert!(
            files[0].parent().unwrap().is_dir(),
            "the trash's own folders stay"
        );
    }

    #[test]
    fn a_file_another_program_has_open_stays_in_the_trash_under_its_row_and_the_rest_go() {
        let lib = library("in-use", &["a.jpg", "b.jpg", "c.jpg"]);
        let batches = lib.trashed(&["a.jpg", "b.jpg", "c.jpg"]);
        let held = lib.trash_file(batches[1].0);
        let open = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&held)
            .unwrap();

        let emptied = empty(&lib.conn, &lib.ids(), &|_| {}).unwrap();

        assert_eq!((emptied.deleted, emptied.kept), (2, 1));
        assert_eq!(emptied.first_kept, Some(batches[1].0));
        assert!(emptied.in_use);
        drop(open);
        assert_eq!(std::fs::read_to_string(&held).unwrap(), "b.jpg");
        assert_eq!(
            lib.ids(),
            [batches[1].0],
            "it stays in the Trash, never half gone"
        );
        assert_eq!(journal::batch(&lib.conn, &batches[1].1).unwrap().len(), 1);

        let back = undo::undo_batch(&lib.conn, &batches[1].1).unwrap();
        assert_eq!(back.files_back, 1, "still restorable");
        assert!(lib.in_cairo("b.jpg").is_file());
    }

    #[test]
    fn a_read_only_file_is_deleted_all_the_same() {
        let lib = library("read-only", &["a.jpg"]);
        let batches = lib.trashed(&["a.jpg"]);
        let file = lib.trash_file(batches[0].0);
        let mut perms = std::fs::metadata(&file).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&file, perms).unwrap();

        let emptied = empty(&lib.conn, &lib.ids(), &|_| {}).unwrap();

        assert_eq!((emptied.deleted, emptied.kept), (1, 0));
        assert!(!file.exists());
    }

    #[test]
    fn a_file_already_gone_from_the_trash_counts_as_deleted_and_its_row_goes() {
        let lib = library("already-gone", &["a.jpg"]);
        let batches = lib.trashed(&["a.jpg"]);
        std::fs::remove_file(lib.trash_file(batches[0].0)).unwrap();

        let emptied = empty(&lib.conn, &lib.ids(), &|_| {}).unwrap();

        assert_eq!((emptied.deleted, emptied.kept), (1, 0));
        assert!(lib.ids().is_empty());
    }

    #[test]
    fn a_directory_where_a_trashed_file_should_be_is_never_removed() {
        let lib = library("a-directory", &["a.jpg"]);
        let batches = lib.trashed(&["a.jpg"]);
        let file = lib.trash_file(batches[0].0);
        std::fs::remove_file(&file).unwrap();
        std::fs::create_dir(&file).unwrap();
        std::fs::write(file.join("inside.txt"), "inside").unwrap();

        let emptied = empty(&lib.conn, &lib.ids(), &|_| {}).unwrap();

        assert_eq!((emptied.deleted, emptied.kept), (0, 1));
        assert!(!emptied.in_use);
        assert!(file.join("inside.txt").is_file());
        std::fs::remove_dir_all(&file).unwrap();
    }

    #[test]
    fn only_the_files_asked_about_go_and_one_deleted_after_the_question_waits() {
        let lib = library("asked", &["a.jpg", "b.jpg"]);
        lib.trashed(&["a.jpg"]);
        let asked = lib.ids();
        let later = lib.trashed(&["b.jpg"]);

        let emptied = empty(&lib.conn, &asked, &|_| {}).unwrap();

        assert_eq!(emptied.deleted, 1);
        assert_eq!(lib.ids(), [later[0].0]);
        assert!(lib.trash_file(later[0].0).is_file());
        std::fs::remove_file(lib.trash_file(later[0].0)).unwrap();
    }

    #[test]
    fn a_restore_between_two_files_takes_its_file_out_of_reach_and_it_is_never_deleted() {
        let lib = library("restore-race", &["a.jpg", "b.jpg", "c.jpg"]);
        let batches = lib.trashed(&["a.jpg", "b.jpg", "c.jpg"]);
        let restored = batches[1].0;
        let restore_done = std::cell::Cell::new(false);

        let emptied = empty(&lib.conn, &lib.ids(), &|done| {
            if done == 1 {
                let report =
                    trash::restore_items(&lib.conn, &[restored], None, &journal::new_batch())
                        .unwrap();
                restore_done.set(report.restored == 1);
            }
        })
        .unwrap();

        assert!(restore_done.get());
        assert_eq!((emptied.deleted, emptied.kept), (2, 0));
        assert_eq!(
            std::fs::read_to_string(lib.in_cairo("b.jpg")).unwrap(),
            "b.jpg"
        );
        assert!(items::is_live(&lib.conn, restored).unwrap());
        assert!(lib.ids().is_empty());
    }

    #[test]
    fn expiry_waits_for_emptying_and_finds_nothing_left_to_send() {
        let lib = library("expiry-race", &["a.jpg", "b.jpg"]);
        let batches = lib.trashed(&["a.jpg", "b.jpg"]);
        for (id, _) in &batches {
            items::set_trashed_at(&lib.conn, *id, 0).unwrap();
        }
        let db_path = lib.dir.join("library.db");
        let bin_dir = lib.dir.join("bin");
        let run = std::cell::RefCell::new(None);

        let emptied = empty(&lib.conn, &lib.ids(), &|done| {
            if done == 1 {
                let (db_path, bin_dir) = (db_path.clone(), bin_dir.clone());
                *run.borrow_mut() = Some(std::thread::spawn(move || {
                    let conn = db::open(&db_path).unwrap();
                    let bin = Fake::new(Stand::Recycles(bin_dir));
                    let limits = Limits {
                        keep_days: Some(1),
                        total_bytes: None,
                    };
                    let said = expiry::run(&conn, &bin, limits, db::now()).unwrap();
                    (said, bin.asked.borrow().len())
                }));
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        })
        .unwrap();
        let (said, asked) = run.into_inner().unwrap().join().unwrap();

        assert_eq!(emptied.deleted, 2, "expiry took nothing from under it");
        assert_eq!((said.by_age, asked), (0, 0));
        assert!(!bin_dir.exists());
    }

    #[test]
    fn an_emptied_file_leaves_every_row_about_several_and_a_row_left_with_none_goes() {
        let lib = library("prune", &["a.jpg", "b.jpg"]);
        let (a, b) = (lib.id("a.jpg"), lib.id("b.jpg"));
        let pair = journal::new_batch();
        tags::add_items_tag(&lib.conn, &[a, b], "dusk", &pair).unwrap();
        let lone = journal::new_batch();
        tags::add_items_tag(&lib.conn, &[a], "dawn", &lone).unwrap();
        lib.trashed(&["a.jpg"]);

        empty(&lib.conn, &lib.ids(), &|_| {}).unwrap();

        let rows = journal::batch(&lib.conn, &pair).unwrap();
        let tagged: journal::ItemsTagged = serde_json::from_value(rows[0].inverse.clone()).unwrap();
        assert_eq!(tagged.item_ids, [b]);
        assert!(journal::batch(&lib.conn, &lone).unwrap().is_empty());
        let about: i64 = lib
            .conn
            .query_row(
                "SELECT COUNT(*) FROM journal WHERE json_extract(inverse, '$.itemId') = ?1",
                [a],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(about, 0, "no row acts on its id again");
    }

    #[test]
    fn a_file_the_recycle_bin_refused_and_emptying_deleted_is_no_longer_counted_refused() {
        let lib = library("refused", &["a.jpg", "b.jpg"]);
        let batches = lib.trashed(&["a.jpg", "b.jpg"]);
        expired::set_refused(&lib.conn, &[batches[0].0, batches[1].0]).unwrap();
        let held = lib.trash_file(batches[1].0);
        let open = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&held)
            .unwrap();

        empty(&lib.conn, &lib.ids(), &|_| {}).unwrap();

        drop(open);
        assert_eq!(expired::refused(&lib.conn).unwrap(), [batches[1].0]);
        std::fs::remove_file(held).unwrap();
    }
}
