//! Carrying out again what an undo took back: the batch the last undo took back, oldest row first.
//! Each row goes back into its batch as the newest as it goes again, and what stayed is still the
//! redo, so a retry carries out only what stayed. DECISIONS.md "Undo".

use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::db::journal::{
    self, Entry, FolderCopied, FolderCreated, FolderDeleted, FolderMoved, FolderRenamed,
    ItemCopied, ItemMoved, ItemRenamed, ItemRestored, ItemTrashed, ItemsTagged, ItemsUntagged,
    Retagged, Untagged,
};
use crate::db::{now, tags, vocabulary};
use crate::error::{AppError, Reason, Result};
use crate::fs::acts::{self, Batch};
use crate::fs::stayed;
use crate::fs::undo::{self, UndoReport};
use crate::fs::{folders, items, trash};

/// Carries out one batch the redo holds again, by id.
pub fn redo_batch(conn: &Connection, batch_id: &str) -> Result<UndoReport> {
    let _turn = super::turn();
    replay(conn, batch_id)
}

/// Carries out again what the last undo took back; nothing when the redo holds nothing.
pub fn redo_last(conn: &Connection) -> Result<Option<UndoReport>> {
    let _turn = super::turn();
    match journal::latest_undone(conn)? {
        Some(batch_id) => replay(conn, &batch_id).map(Some),
        None => Ok(None),
    }
}

/// The act a redo would carry out again: the batch named, or the one the last undo took back;
/// none when the redo holds nothing of it.
pub fn act_to_redo(conn: &Connection, batch_id: Option<&str>) -> Result<Option<Batch>> {
    let batch_id = match batch_id {
        Some(batch_id) => batch_id.to_string(),
        None => match journal::latest_undone(conn)? {
            Some(batch_id) => batch_id,
            None => return Ok(None),
        },
    };
    if journal::undone_batch(conn, &batch_id)?.is_empty() {
        return Ok(None);
    }
    acts::describe_undone(conn, &batch_id).map(Some)
}

/// How a row reads once it has gone again.
enum Again {
    /// As it did.
    Same,
    /// Under new ids, as a folder made again is.
    As(Value),
    /// Journalled afresh by the act itself.
    Journalled,
}

fn replay(conn: &Connection, batch_id: &str) -> Result<UndoReport> {
    let entries = journal::undone_batch(conn, batch_id)?;
    if entries.is_empty() {
        return Err(AppError::invalid("there is nothing left to redo here"));
    }
    let batch = acts::describe_undone(conn, batch_id)?;
    let mut stayed = Vec::new();
    let (mut files_back, mut folders_back) = (0, 0);
    for entry in &entries {
        // A tag act takes no turn of the disk, and journalling one drops the redo meanwhile.
        if !journal::still_undone(conn, entry.id)? {
            break;
        }
        if let Some(forgotten) = journal::gone(entry) {
            journal::drop_entry(conn, entry.id)?;
            stayed.push(stayed::forgotten(conn, &forgotten)?);
            continue;
        }
        #[cfg(test)]
        BEFORE_EACH_ROW.with(|hook| {
            if let Some(then) = hook.borrow_mut().as_mut() {
                then();
            }
        });
        let (files, folders) = acts::count(conn, std::slice::from_ref(entry))?;
        match again(conn, batch_id, entry) {
            Ok(went) => {
                match went {
                    Again::Same => journal::redone(conn, batch_id, entry, None)?,
                    Again::As(now) => journal::redone(conn, batch_id, entry, Some(&now))?,
                    Again::Journalled => journal::drop_entry(conn, entry.id)?,
                }
                files_back += files;
                folders_back += folders;
            }
            Err(err) if undo::tagging(entry) => return Err(err),
            Err(err) => {
                let one = undo::stayed_of(conn, entry, &err)?;
                if matches!(
                    one.reason,
                    Reason::GoneFromBin { .. } | Reason::NoBin { .. }
                ) {
                    journal::drop_entry(conn, entry.id)?;
                }
                stayed.push(one);
            }
        }
    }
    Ok(UndoReport {
        files_back,
        folders_back,
        batch,
        stayed,
    })
}

#[cfg(test)]
thread_local! {
    static BEFORE_EACH_ROW: std::cell::RefCell<Option<Box<dyn FnMut()>>> =
        const { std::cell::RefCell::new(None) };
}

/// Runs `then` before each row this thread's next redo carries out again, once it has found the row
/// still the redo's: where a test journals another act meanwhile.
#[cfg(test)]
fn just_before_each_row(then: impl FnMut() + 'static) {
    BEFORE_EACH_ROW.with(|hook| *hook.borrow_mut() = Some(Box::new(then)));
}

/// Carries out one row again, never a permanent delete: a file bound for a drive with no bin stays.
fn again(conn: &Connection, batch_id: &str, entry: &Entry) -> Result<Again> {
    match entry.op.as_str() {
        journal::FOLDER_CREATE => {
            let made: FolderCreated = forward(entry)?;
            let title = journal::kept(entry)
                .title
                .ok_or_else(|| AppError::refused(Reason::NotIndexed))?;
            let folder_id = folders::make(conn, made.parent_id, &title, None)?;
            let now = FolderCreated {
                folder_id,
                parent_id: made.parent_id,
            };
            Ok(Again::As(serde_json::to_value(now)?))
        }
        journal::FOLDER_RENAME => {
            let renamed: FolderRenamed = forward(entry)?;
            folders::rename_unjournalled(conn, renamed.folder_id, &renamed.to, None)?;
            Ok(Again::Same)
        }
        journal::FOLDER_MOVE => {
            let moved: FolderMoved = forward(entry)?;
            folders::move_unjournalled(conn, moved.folder_id, moved.to_parent_id, None)?;
            Ok(Again::Same)
        }
        journal::ITEM_MOVE => {
            let moved: ItemMoved = forward(entry)?;
            items::move_unjournalled(conn, moved.item_id, moved.to_folder_id, None)?;
            Ok(Again::Same)
        }
        journal::ITEM_RENAME => {
            let renamed: ItemRenamed = forward(entry)?;
            items::rename_unjournalled(conn, renamed.item_id, &renamed.to, None)?;
            Ok(Again::Same)
        }
        journal::ITEM_TRASH => {
            let trashed: ItemTrashed = forward(entry)?;
            trash::trash_unjournalled(conn, trashed.item_id, None)?;
            Ok(Again::Same)
        }
        journal::ITEM_RESTORE => {
            let restored: ItemRestored = forward(entry)?;
            trash::restore_unjournalled(conn, restored.item_id, Some(restored.to_folder_id), None)?;
            Ok(Again::Same)
        }
        journal::FOLDER_DELETE => {
            let deleted: FolderDeleted = forward(entry)?;
            folders::redelete(conn, deleted.folder_id, deleted.retired_at)?;
            Ok(Again::Same)
        }
        journal::ITEMS_TAG => {
            let tagged: ItemsTagged = forward(entry)?;
            let at = now();
            let given = ItemsUntagged {
                tag_id: tagged.tag_id,
                value: tagged.value,
                items: tagged
                    .item_ids
                    .iter()
                    .map(|&item_id| Untagged {
                        item_id,
                        added_at: at,
                    })
                    .collect(),
            };
            tags::retag_items(conn, &given)?;
            Ok(Again::Same)
        }
        journal::ITEMS_UNTAG => {
            let untagged: ItemsUntagged = forward(entry)?;
            let ids: Vec<i64> = untagged.items.iter().map(|one| one.item_id).collect();
            tags::untag_items(conn, untagged.tag_id, &ids)?;
            Ok(Again::Same)
        }
        journal::RETAG => {
            let retagged: Retagged = forward(entry)?;
            vocabulary::redo(conn, &retagged.change, batch_id)?;
            Ok(Again::Journalled)
        }
        journal::ITEM_COPY => {
            let came: ItemCopied = forward(entry)?;
            trash::untrash(conn, came.item_id)?;
            Ok(Again::Same)
        }
        journal::FOLDER_COPY => {
            let made: FolderCopied = forward(entry)?;
            let retired_at = journal::kept(entry)
                .retired_at
                .ok_or_else(|| AppError::refused(Reason::NotIndexed))?;
            folders::undelete(conn, made.folder_id, retired_at)?;
            Ok(Again::Same)
        }
        other => Err(AppError::invalid(format!("{other} cannot be redone"))),
    }
}

/// The journal is JSON that outlives the code that wrote it, so a row that no longer reads is one
/// failed redo, never a crash.
fn forward<T: DeserializeOwned>(entry: &Entry) -> Result<T> {
    serde_json::from_value(entry.forward.clone())
        .map_err(|err| AppError::invalid(format!("journal row {} does not read: {err}", entry.id)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, folders as rows};
    use crate::fs::acts::Act;
    use crate::fs::recycle::tests::{Fake, Stand, stand_in_as};
    use crate::fs::undo::{undo_batch, undo_last};
    use crate::fs::walk;
    use std::path::{Path, PathBuf};

    /// Trips/Cairo holding pyramid.jpg and sphinx.jpg, and People holding nothing, walked, with
    /// the bin a folder beside them.
    struct Lib {
        dir: PathBuf,
        conn: Connection,
        trips: i64,
        cairo: i64,
        people: i64,
        files: Vec<i64>,
    }

    fn library(name: &str) -> Lib {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-redo")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("library/Trips/Cairo")).unwrap();
        std::fs::create_dir_all(dir.join("library/People")).unwrap();
        std::fs::write(dir.join("library/Trips/Cairo/pyramid.jpg"), "p").unwrap();
        std::fs::write(dir.join("library/Trips/Cairo/sphinx.jpg"), "s").unwrap();
        stand_in_as(Fake::new(Stand::Recycles(dir.join("bin"))));
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = rows::source_root_folder(&conn, 1).unwrap();
        let trips = rows::child_id(&conn, top, "Trips").unwrap().unwrap();
        let cairo = rows::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let people = rows::child_id(&conn, top, "People").unwrap().unwrap();
        let files = db::items::in_folder(&conn, cairo)
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();
        Lib {
            dir,
            conn,
            trips,
            cairo,
            people,
            files,
        }
    }

    impl Lib {
        fn at(&self, path: &str) -> PathBuf {
            self.dir.join("library").join(path)
        }

        fn folder_of(&self, id: i64) -> Option<i64> {
            db::items::folder_of(&self.conn, id).unwrap()
        }

        fn tag_id(&self, value: &str) -> i64 {
            self.conn
                .query_row(
                    "SELECT id FROM tag WHERE key IS NULL AND value = ?1",
                    [value],
                    |r| r.get(0),
                )
                .unwrap()
        }

        fn tags_on(&self, value: &str) -> i64 {
            self.conn
                .query_row(
                    "SELECT COUNT(*) FROM item_tag it JOIN tag t ON t.id = it.tag_id
                      WHERE t.key IS NULL AND t.value = ?1",
                    [value],
                    |r| r.get(0),
                )
                .unwrap()
        }
    }

    #[test]
    fn a_move_undone_goes_again_on_redo_and_ctrl_z_takes_it_back_once_more() {
        let lib = library("move");
        let batch = journal::new_batch();
        items::move_items(&lib.conn, &lib.files, lib.people, &batch).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        assert!(lib.at("Trips/Cairo/pyramid.jpg").is_file());

        let named = act_to_redo(&lib.conn, None).unwrap().unwrap();
        assert_eq!(named.batch_id, batch);
        let report = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(
            report.batch.act,
            Act::Move {
                from: Some("Cairo".into()),
                to: "People".into(),
                one: None
            }
        );
        assert_eq!((report.files_back, report.stayed.len()), (2, 0));
        assert!(lib.at("People/pyramid.jpg").is_file());
        assert!(lib.at("People/sphinx.jpg").is_file());
        assert!(
            lib.files
                .iter()
                .all(|id| lib.folder_of(*id) == Some(lib.people))
        );
        assert_eq!(
            redo_last(&lib.conn).unwrap(),
            None,
            "nothing is left to redo"
        );

        assert_eq!(
            journal::latest_batch(&lib.conn).unwrap(),
            Some(batch.clone())
        );
        let again = undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(again.batch.batch_id, batch);
        assert!(
            lib.files
                .iter()
                .all(|id| lib.folder_of(*id) == Some(lib.cairo))
        );
    }

    #[test]
    fn a_delete_undone_goes_to_the_bin_again_on_redo_and_comes_back_on_undo() {
        let lib = library("delete");
        let batch = journal::new_batch();
        trash::trash_items(&lib.conn, &lib.files, &batch).unwrap();
        undo_batch(&lib.conn, &batch).unwrap();
        assert!(lib.at("Trips/Cairo/sphinx.jpg").is_file());

        let report = redo_batch(&lib.conn, &batch).unwrap();
        assert_eq!(
            report.batch.act,
            Act::Delete {
                from: Some("Cairo".into()),
                one: None
            }
        );
        assert_eq!((report.files_back, report.stayed.len()), (2, 0));
        assert!(!lib.at("Trips/Cairo/pyramid.jpg").exists());
        assert!(
            lib.files
                .iter()
                .all(|id| crate::db::items::is_trashed(&lib.conn, *id).unwrap())
        );

        undo_last(&lib.conn).unwrap().unwrap();
        assert!(lib.at("Trips/Cairo/pyramid.jpg").is_file());
        assert!(lib.at("Trips/Cairo/sphinx.jpg").is_file());
    }

    #[test]
    fn a_folder_deleted_with_its_files_is_deleted_again_on_redo_and_comes_back_whole_on_undo() {
        let lib = library("folder-delete");
        let batch = journal::new_batch();
        folders::delete(&lib.conn, lib.cairo, Some(folders::Contents::Trash), &batch).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        assert!(lib.at("Trips/Cairo/pyramid.jpg").is_file());

        let report = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(
            report.batch.act,
            Act::DeleteFolder {
                name: "Cairo".into(),
                parent: "Trips".into(),
                into: None
            }
        );
        assert_eq!(
            (report.files_back, report.folders_back, report.stayed.len()),
            (2, 1, 0)
        );
        assert!(!lib.at("Trips/Cairo").exists());
        assert!(!rows::is_live(&lib.conn, lib.cairo).unwrap());

        undo_last(&lib.conn).unwrap().unwrap();
        assert!(lib.at("Trips/Cairo/pyramid.jpg").is_file());
        assert!(lib.at("Trips/Cairo/sphinx.jpg").is_file());
        assert!(rows::is_live(&lib.conn, lib.cairo).unwrap());
    }

    #[test]
    fn a_redo_bound_for_a_drive_with_no_bin_deletes_nothing_and_its_folder_says_what_it_holds() {
        let lib = library("no-bin");
        let batch = journal::new_batch();
        folders::delete(&lib.conn, lib.cairo, Some(folders::Contents::Trash), &batch).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        let mut bin = Fake::new(Stand::Recycles(lib.dir.join("bin")));
        bin.binless = vec![(lib.at("Trips"), "USB Drive (E:)".into())];
        stand_in_as(bin);

        let report = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(report.files_back, 0);
        let no_bin = Reason::NoBin {
            drive: "USB Drive (E:)".into(),
        };
        let holds = Reason::Holds {
            name: "pyramid.jpg".into(),
            more: 1,
        };
        let reasons: Vec<&Reason> = report.stayed.iter().map(|one| &one.reason).collect();
        assert_eq!(reasons, [&no_bin, &no_bin, &holds]);
        assert!(
            lib.at("Trips/Cairo/pyramid.jpg").is_file(),
            "nothing went for good"
        );
        assert!(lib.at("Trips/Cairo/sphinx.jpg").is_file());
        assert!(rows::is_live(&lib.conn, lib.cairo).unwrap());
    }

    #[test]
    fn a_file_that_cannot_go_again_stays_says_why_and_is_still_the_redo() {
        let lib = library("blocked");
        let batch = journal::new_batch();
        items::move_items(&lib.conn, &lib.files, lib.people, &batch).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        std::fs::write(lib.at("People/sphinx.jpg"), "a new one").unwrap();

        let report = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(report.files_back, 1);
        assert_eq!(report.stayed.len(), 1);
        assert_eq!(
            report.stayed[0].reason,
            Reason::NameTaken {
                place: "People".into(),
                name: "sphinx.jpg".into(),
                folder: false
            }
        );
        assert!(lib.at("Trips/Cairo/sphinx.jpg").is_file());

        std::fs::remove_file(lib.at("People/sphinx.jpg")).unwrap();
        let retry = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!((retry.batch.files, retry.files_back), (1, 1));
        assert!(lib.at("People/sphinx.jpg").is_file());
        assert_eq!(redo_last(&lib.conn).unwrap(), None);
    }

    #[test]
    fn a_tag_given_and_one_taken_off_come_again_on_redo() {
        let lib = library("tags");
        let given = journal::new_batch();
        tags::add_items_tag(&lib.conn, &lib.files, "dusk", &given).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(lib.tags_on("dusk"), 0);

        let report = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(report.batch.act, Act::AddTag { tag: "dusk".into() });
        assert_eq!(report.files_back, 2);
        assert_eq!(lib.tags_on("dusk"), 2);

        let taken = journal::new_batch();
        tags::remove_items_tag(&lib.conn, &lib.files[..1], lib.tag_id("dusk"), &taken).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(lib.tags_on("dusk"), 2);
        redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(lib.tags_on("dusk"), 1);
        undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(lib.tags_on("dusk"), 2, "the redone act is undone once more");
    }

    #[test]
    fn a_rename_on_the_tags_screen_comes_again_on_redo() {
        let lib = library("retag");
        tags::add_items_tag(&lib.conn, &lib.files, "dusk", &journal::new_batch()).unwrap();
        let renamed = journal::new_batch();
        vocabulary::rename_tag(&lib.conn, lib.tag_id("dusk"), "dawn", &renamed).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(lib.tags_on("dusk"), 2);

        let report = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(report.batch.batch_id, renamed);
        assert_eq!((lib.tags_on("dusk"), lib.tags_on("dawn")), (0, 2));
        assert_eq!(journal::latest_batch(&lib.conn).unwrap(), Some(renamed));
        undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(lib.tags_on("dusk"), 2);
    }

    #[test]
    fn a_folder_made_and_undone_is_made_again_under_its_name() {
        let lib = library("create");
        let batch = journal::new_batch();
        folders::create(&lib.conn, lib.trips, "Lisbon", &batch).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        assert!(!lib.at("Trips/Lisbon").exists());

        let report = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(
            report.batch.act,
            Act::CreateFolder {
                name: "Lisbon".into(),
                parent: "Trips".into()
            }
        );
        assert!(lib.at("Trips/Lisbon").is_dir());
        assert!(
            rows::child_id(&lib.conn, lib.trips, "Lisbon")
                .unwrap()
                .is_some()
        );

        let again = undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(again.batch.act, report.batch.act);
        assert!(!lib.at("Trips/Lisbon").exists());
    }

    #[test]
    fn redo_goes_back_through_what_was_undone_the_last_undone_first() {
        let lib = library("order");
        let moved = journal::new_batch();
        items::move_items(&lib.conn, &lib.files, lib.people, &moved).unwrap();
        let renamed = journal::new_batch();
        folders::rename(&lib.conn, lib.cairo, "Giza", &renamed).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        undo_last(&lib.conn).unwrap().unwrap();

        let first = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(first.batch.batch_id, moved);
        let second = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(second.batch.batch_id, renamed);
        assert!(lib.at("Trips/Giza").is_dir());
        assert!(lib.at("People/pyramid.jpg").is_file());
        assert_eq!(journal::latest_batch(&lib.conn).unwrap(), Some(renamed));
    }

    #[test]
    fn a_file_deleted_for_good_drops_the_redo() {
        let lib = library("for-good");
        items::move_items(&lib.conn, &lib.files, lib.people, &journal::new_batch()).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        let mut bin = Fake::new(Stand::Recycles(lib.dir.join("bin")));
        bin.binless = vec![(lib.at("Trips"), "USB Drive (E:)".into())];
        stand_in_as(bin);

        let gone = crate::fs::binless::delete_items(&lib.conn, &lib.files[..1]).unwrap();
        assert_eq!(gone.deleted, 1);
        assert_eq!(act_to_redo(&lib.conn, None).unwrap(), None);
        assert!(lib.at("Trips/Cairo/sphinx.jpg").is_file());
    }

    #[test]
    fn a_tag_journalled_partway_through_a_redo_stops_it_and_what_went_is_undone() {
        let lib = library("tagged-meanwhile");
        std::fs::write(lib.at("Trips/Cairo/temple.jpg"), "t").unwrap();
        walk::reconcile(&lib.conn).unwrap();
        let files: Vec<i64> = db::items::in_folder(&lib.conn, lib.cairo)
            .unwrap()
            .into_iter()
            .map(|item| item.id)
            .collect();
        let moved = journal::new_batch();
        items::move_items(&lib.conn, &files, lib.people, &moved).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        let (path, first) = (lib.dir.join("library.db"), files[0]);
        let rows = std::rc::Rc::new(std::cell::Cell::new(0));
        let seen = std::rc::Rc::clone(&rows);
        just_before_each_row(move || {
            seen.set(seen.get() + 1);
            if seen.get() == 2 {
                let other = db::open(&path).unwrap();
                tags::add_items_tag(&other, &[first], "dusk", &journal::new_batch()).unwrap();
            }
        });

        let report = redo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(report.files_back, 2);
        assert_eq!(rows.get(), 2, "the redo stops once the tag drops it");
        let homes: Vec<Option<i64>> = files.iter().map(|id| lib.folder_of(*id)).collect();
        assert_eq!(homes, [Some(lib.people), Some(lib.people), Some(lib.cairo)]);
        assert_eq!(redo_last(&lib.conn).unwrap(), None);

        let undone = undo_last(&lib.conn).unwrap().unwrap();
        assert_eq!(undone.batch.batch_id, moved);
        assert_eq!(undone.files_back, 2);
        assert!(files.iter().all(|id| lib.folder_of(*id) == Some(lib.cairo)));
        assert_eq!(lib.tags_on("dusk"), 1);
    }

    #[test]
    fn emptying_the_trash_drops_the_redo() {
        let lib = library("emptied");
        trash::trash_items(&lib.conn, &lib.files[..1], &journal::new_batch()).unwrap();
        items::rename(&lib.conn, lib.files[1], "giza.jpg", &journal::new_batch()).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        assert!(act_to_redo(&lib.conn, None).unwrap().is_some());

        let asked = crate::fs::empty::to_empty(&lib.conn).unwrap();
        let emptied =
            crate::fs::empty::empty(&lib.conn, &asked.files, &crate::fs::relocate::Unwatched)
                .unwrap();
        assert_eq!(emptied.deleted, 1);
        assert_eq!(act_to_redo(&lib.conn, None).unwrap(), None);
        assert_eq!(redo_last(&lib.conn).unwrap(), None);
        assert!(!lib.at("Trips/Cairo/giza.jpg").exists());
    }

    #[test]
    fn a_new_act_drops_the_redo_and_so_does_a_restore_of_the_index() {
        let lib = library("dropped");
        items::move_items(&lib.conn, &lib.files, lib.people, &journal::new_batch()).unwrap();
        undo_last(&lib.conn).unwrap().unwrap();
        folders::create(&lib.conn, lib.trips, "Lisbon", &journal::new_batch()).unwrap();
        assert_eq!(act_to_redo(&lib.conn, None).unwrap(), None);
        assert_eq!(redo_last(&lib.conn).unwrap(), None);
        assert!(lib.at("Trips/Cairo/pyramid.jpg").is_file());

        undo_last(&lib.conn).unwrap().unwrap();
        assert!(act_to_redo(&lib.conn, None).unwrap().is_some());
        journal::set_floor(&lib.conn).unwrap();
        assert_eq!(redo_last(&lib.conn).unwrap(), None);
    }
}
