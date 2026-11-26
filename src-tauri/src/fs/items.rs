//! Files moved between folders and renamed where they are. A file keeps its own name wherever it
//! goes, so a name already taken is refused and reported, never changed for it.
//! DECISIONS.md "Undo".

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::{folders, in_transaction, items, journal, tags};
use crate::error::{AppError, Reason, Result};
use crate::fs::paste::Halt;
use crate::fs::relocate::{Control, Unwatched};
use crate::fs::stayed::{self, Stayed};
use crate::fs::{paths, relocate, sanitize};

/// What a move of several items did: how many went, and each one that did not, with why.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MoveReport {
    pub moved: u32,
    pub refused: Vec<Stayed>,
}

/// Moves each item into `folder_id` under one batch, so one undo brings the whole selection back.
/// One item that cannot go costs only itself.
pub fn move_items(
    conn: &Connection,
    item_ids: &[i64],
    folder_id: i64,
    batch_id: &str,
) -> Result<MoveReport> {
    let _turn = super::turn();
    let outcome = move_each(conn, item_ids, folder_id, batch_id, &Unwatched, false)?;
    match outcome.stopped {
        Some(reason) => Err(AppError::refused(reason)),
        None => Ok(outcome.report),
    }
}

/// How a watched move ended: what went and what stayed, and why it ended before the last file.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MoveOutcome {
    pub report: MoveReport,
    pub halted: Option<Halt>,
    /// Why it stopped before the end, when something other than a halt stopped it.
    pub stopped: Option<Reason>,
}

/// `move_items`, one file to a turn, answering to `control` between files and to Stop within the
/// one in hand: a file is either moved whole or left where it was. Run again under the same batch,
/// what already went is passed over.
pub fn move_watched(
    conn: &Connection,
    item_ids: &[i64],
    folder_id: i64,
    batch_id: &str,
    control: &impl Control,
) -> Result<MoveOutcome> {
    move_each(conn, item_ids, folder_id, batch_id, control, true)
}

fn move_each(
    conn: &Connection,
    item_ids: &[i64],
    folder_id: i64,
    batch_id: &str,
    control: &impl Control,
    turn_each: bool,
) -> Result<MoveOutcome> {
    let whole = u32::try_from(item_ids.len()).unwrap_or(u32::MAX);
    let mut outcome = MoveOutcome::default();
    control.progress(0, whole);
    for (done, &item_id) in (1..).zip(item_ids) {
        if let Some(halt) = control.halt() {
            outcome.halted = Some(halt);
            break;
        }
        let _turn = turn_each.then(super::turn);
        if !folders::is_live(conn, folder_id)? {
            let name = crate::fs::acts::name(conn, folder_id)?;
            outcome.stopped = Some(Reason::FolderGone { name });
            break;
        }
        match move_one(conn, item_id, folder_id, Some(batch_id), control) {
            Ok(Went::Moved) => outcome.report.moved += 1,
            Ok(Went::There) => {}
            Ok(Went::Halted(halt)) => {
                outcome.halted = Some(halt);
                break;
            }
            Err(err) => outcome
                .report
                .refused
                .push(stayed::file(conn, item_id, &err)?),
        }
        control.progress(done, whole);
    }
    Ok(outcome)
}

/// Clears the part each of these files that has not gone into `folder_id` has there, left by a
/// move a crash cut short that will not run again.
pub fn clear_parts(conn: &Connection, item_ids: &[i64], folder_id: i64) -> Result<()> {
    let _turn = super::turn();
    let dir = paths::folder_dir(conn, folder_id)?;
    for &item_id in item_ids {
        let Some(file) = items::file_of(conn, item_id)? else {
            continue;
        };
        if file.folder_id != folder_id {
            let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
            relocate::clear_part_of(&from, &dir.join(&file.disk_name));
        }
    }
    Ok(())
}

/// Whether moving these items into `folder_id` copies any of them between drives.
pub fn cross_drives(conn: &Connection, item_ids: &[i64], folder_id: i64) -> Result<bool> {
    let dir = paths::folder_dir(conn, folder_id)?;
    let mut seen = std::collections::HashSet::new();
    for &item_id in item_ids {
        let Some(file) = items::file_of(conn, item_id)? else {
            continue;
        };
        if file.folder_id != folder_id
            && seen.insert(file.folder_id)
            && relocate::crosses_drives(&paths::folder_dir(conn, file.folder_id)?, &dir)
        {
            return Ok(true);
        }
    }
    Ok(false)
}

enum Went {
    Moved,
    There,
    Halted(Halt),
}

/// The move itself, which undo also uses to put an item back without journalling it again.
/// `false` when the item is already there.
pub(super) fn move_unjournalled(
    conn: &Connection,
    item_id: i64,
    folder_id: i64,
    batch_id: Option<&str>,
) -> Result<bool> {
    let went = move_one(conn, item_id, folder_id, batch_id, &Unwatched)?;
    Ok(matches!(went, Went::Moved))
}

fn move_one(
    conn: &Connection,
    item_id: i64,
    folder_id: i64,
    batch_id: Option<&str>,
    control: &impl Control,
) -> Result<Went> {
    if !items::is_live(conn, item_id)? {
        return Err(AppError::refused(Reason::NotIndexed));
    }
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::refused(Reason::NotIndexed));
    }
    let file =
        items::file_of(conn, item_id)?.ok_or_else(|| AppError::refused(Reason::NotIndexed))?;
    if file.folder_id == folder_id {
        return Ok(Went::There);
    }

    let taken = || {
        AppError::refused(Reason::NameTaken {
            place: crate::fs::acts::name(conn, folder_id).unwrap_or_default(),
            name: file.disk_name.clone(),
            folder: false,
        })
    };
    let held = items::existing_by_disk_name(conn, folder_id, &file.disk_name)?;
    if held.as_ref().is_some_and(|row| !row.deleted) {
        return Err(taken());
    }
    let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    let to = paths::folder_dir(conn, folder_id)?.join(&file.disk_name);
    if let Some(halt) =
        relocate::relocate_watched(&from, &to, control).map_err(relocate::taken_as(taken))?
    {
        return Ok(Went::Halted(halt));
    }

    let recorded = in_transaction(conn, |tx| {
        // A retired row holding the name describes a file that is gone; the arriving one takes it.
        if let Some(stale) = &held {
            items::forget_retired(tx, stale.id)?;
        }
        items::set_folder(tx, item_id, folder_id, &file.disk_name)?;
        tags::rebuild_item(tx, item_id)?;
        if let Some(batch_id) = batch_id {
            journal::record_item_move(tx, batch_id, item_id, file.folder_id, folder_id)?;
        }
        Ok(Went::Moved)
    });
    if recorded.is_err() {
        let _ = relocate::relocate(&to, &from);
    }
    recorded
}

/// Renames a file where it is, on disk and then in the index. `false` when the name is already
/// the one it has.
pub fn rename(conn: &Connection, item_id: i64, name: &str, batch_id: &str) -> Result<bool> {
    let _turn = super::turn();
    rename_unjournalled(conn, item_id, name, Some(batch_id))
}

/// The rename itself, which undo also uses to put a name back without journalling it again.
pub(super) fn rename_unjournalled(
    conn: &Connection,
    item_id: i64,
    name: &str,
    batch_id: Option<&str>,
) -> Result<bool> {
    if !items::is_live(conn, item_id)? {
        return Err(AppError::refused(Reason::NotIndexed));
    }
    let file =
        items::file_of(conn, item_id)?.ok_or_else(|| AppError::refused(Reason::NotIndexed))?;
    sanitize::refuse_forbidden(name)?;
    let name = sanitize::file_name(name.trim());
    if name == file.disk_name {
        return Ok(false);
    }
    let taken = || {
        AppError::refused(Reason::NameTaken {
            place: crate::fs::acts::name(conn, file.folder_id).unwrap_or_default(),
            name: name.clone(),
            folder: false,
        })
    };
    let held =
        items::existing_by_disk_name(conn, file.folder_id, &name)?.filter(|row| row.id != item_id);
    if held.as_ref().is_some_and(|row| !row.deleted) {
        return Err(taken());
    }
    let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    let to = paths::item_path(conn, file.folder_id, &name)?;
    relocate::relocate(&from, &to).map_err(relocate::taken_as(taken))?;

    let recorded = in_transaction(conn, |tx| {
        if let Some(stale) = &held {
            items::forget_retired(tx, stale.id)?;
        }
        items::set_name(tx, item_id, &name)?;
        if let Some(batch_id) = batch_id {
            journal::record_item_rename(tx, batch_id, item_id, &file.disk_name, &name)?;
        }
        Ok(true)
    });
    if recorded.is_err() {
        let _ = relocate::relocate(&to, &from);
    }
    recorded
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::SourceKind;
    use crate::db::{self, sources};
    use crate::fs::walk;
    use std::path::{Path, PathBuf};

    /// Trips/Cairo holding pyramid.jpg and sphinx.jpg, and People holding a sphinx.jpg of its own.
    fn library(name: &str) -> (Connection, PathBuf, i64, i64) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-items")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("library");
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        std::fs::create_dir_all(root.join("People")).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "p").unwrap();
        std::fs::write(root.join("Trips/Cairo/sphinx.jpg"), "s").unwrap();
        std::fs::write(root.join("People/sphinx.jpg"), "other").unwrap();
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let people = folders::child_id(&conn, top, "People").unwrap().unwrap();
        (conn, root, cairo, people)
    }

    fn id_of(conn: &Connection, folder_id: i64, name: &str) -> i64 {
        items::existing_by_disk_name(conn, folder_id, name)
            .unwrap()
            .unwrap()
            .id
    }

    #[test]
    fn a_selection_moves_file_by_file_and_one_name_taken_costs_only_itself() {
        let (conn, root, cairo, people) = library("selection");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");

        let report = move_items(&conn, &[pyramid, sphinx], people, &journal::new_batch()).unwrap();
        assert_eq!(report.moved, 1);
        assert_eq!(report.refused.len(), 1);
        assert_eq!(report.refused[0].id, sphinx);
        assert_eq!(
            report.refused[0].reason,
            Reason::NameTaken {
                place: "People".into(),
                name: "sphinx.jpg".into(),
                folder: false
            }
        );

        assert!(root.join("People/pyramid.jpg").is_file());
        let theirs = std::fs::read_to_string(root.join("People/sphinx.jpg")).unwrap();
        assert_eq!(theirs, "other");
        assert!(root.join("Trips/Cairo/sphinx.jpg").is_file());
        assert_eq!(items::folder_of(&conn, pyramid).unwrap(), Some(people));
        let carried: Vec<String> = tags::item_effective_tags(&conn, pyramid)
            .unwrap()
            .into_iter()
            .map(|tag| tag.value)
            .collect();
        assert!(carried.iter().any(|value| value == "people"), "{carried:?}");
    }

    #[test]
    fn a_file_is_renamed_where_it_is_and_one_undo_puts_its_name_back() {
        let (conn, root, cairo, _) = library("rename");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();

        assert!(rename(&conn, pyramid, "giza.JPG", &batch).unwrap());
        assert!(root.join("Trips/Cairo/giza.JPG").is_file());
        assert!(!root.join("Trips/Cairo/pyramid.jpg").exists());
        let file = items::file_of(&conn, pyramid).unwrap().unwrap();
        assert_eq!(file.disk_name, "giza.JPG");
        let described = crate::fs::acts::describe(&conn, &batch).unwrap();
        assert_eq!(
            described.act,
            crate::fs::acts::Act::RenameFile {
                from: "pyramid.jpg".into(),
                to: "giza.JPG".into()
            }
        );

        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!((back.files_back, back.stayed.len()), (1, 0));
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert_eq!(id_of(&conn, cairo, "pyramid.jpg"), pyramid);
    }

    #[test]
    fn a_rename_onto_a_name_taken_in_a_sorting_sources_own_folder_is_taken_in_the_sorting_box() {
        let (conn, root, _, _) = library("rename-taken-sorting");
        let incoming = root.parent().unwrap().join("incoming");
        std::fs::create_dir_all(&incoming).unwrap();
        std::fs::write(incoming.join("a.jpg"), "a").unwrap();
        std::fs::write(incoming.join("b.jpg"), "b").unwrap();
        let source = sources::add(&conn, &incoming, "Incoming", SourceKind::Sorting).unwrap();
        walk::reconcile(&conn).unwrap();
        let sorting = folders::source_root_folder(&conn, source.id).unwrap();

        let a = id_of(&conn, sorting, "a.jpg");
        let err = rename(&conn, a, "b.jpg", &journal::new_batch()).unwrap_err();
        assert_eq!(
            Reason::of(&err),
            Reason::NameTaken {
                place: "Sorting Box".into(),
                name: "b.jpg".into(),
                folder: false
            }
        );
    }

    #[test]
    fn a_rename_onto_a_name_taken_is_refused_and_a_change_of_case_is_not() {
        let (conn, root, cairo, _) = library("rename-taken");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");

        let err = rename(&conn, pyramid, "SPHINX.jpg", &journal::new_batch()).unwrap_err();
        assert_eq!(
            Reason::of(&err),
            Reason::NameTaken {
                place: "Cairo".into(),
                name: "SPHINX.jpg".into(),
                folder: false
            }
        );
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());

        assert!(rename(&conn, pyramid, "Pyramid.jpg", &journal::new_batch()).unwrap());
        let names: Vec<String> = std::fs::read_dir(root.join("Trips/Cairo"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"Pyramid.jpg".to_string()), "{names:?}");
        assert!(!rename(&conn, pyramid, "Pyramid.jpg", &journal::new_batch()).unwrap());
    }

    #[test]
    fn a_rename_holding_a_character_windows_refuses_is_refused_with_it_named() {
        let (conn, root, cairo, _) = library("rename-forbidden");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");

        let err = rename(&conn, pyramid, "giza: day 2.jpg", &journal::new_batch()).unwrap_err();
        assert_eq!(
            Reason::of(&err),
            Reason::ForbiddenCharacter {
                character: ":".into()
            }
        );
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert_eq!(id_of(&conn, cairo, "pyramid.jpg"), pyramid);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_another_program_holds_open_stays_and_says_so() {
        use std::os::windows::fs::OpenOptionsExt;
        let (conn, root, cairo, people) = library("in-use");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        // Opened sharing nothing, as a program that locks its file does.
        let _held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(root.join("Trips/Cairo/pyramid.jpg"))
            .unwrap();

        let report = move_items(&conn, &[pyramid], people, &journal::new_batch()).unwrap();
        assert_eq!(report.moved, 0);
        assert_eq!(report.refused[0].reason, Reason::InUse);
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
    }

    fn theirs_appears_just_before_the_move() {
        crate::fs::noclobber::just_before_the_next(|to| std::fs::write(to, "theirs").unwrap());
    }

    #[test]
    fn a_move_onto_a_name_that_appeared_just_before_it_is_refused_and_theirs_kept() {
        let (conn, root, cairo, people) = library("late-move");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");

        theirs_appears_just_before_the_move();
        let report = move_items(&conn, &[pyramid], people, &journal::new_batch()).unwrap();
        assert_eq!(report.moved, 0);
        assert_eq!(
            report.refused[0].reason,
            Reason::NameTaken {
                place: "People".into(),
                name: "pyramid.jpg".into(),
                folder: false
            }
        );
        let theirs = std::fs::read_to_string(root.join("People/pyramid.jpg")).unwrap();
        assert_eq!(theirs, "theirs");
        let ours = std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap();
        assert_eq!(ours, "p");
        assert_eq!(items::folder_of(&conn, pyramid).unwrap(), Some(cairo));
    }

    #[test]
    fn a_rename_onto_a_name_that_appeared_just_before_it_is_refused_and_theirs_kept() {
        let (conn, root, cairo, _) = library("late-rename");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");

        theirs_appears_just_before_the_move();
        let err = rename(&conn, pyramid, "giza.jpg", &journal::new_batch()).unwrap_err();
        assert_eq!(
            Reason::of(&err),
            Reason::NameTaken {
                place: "Cairo".into(),
                name: "giza.jpg".into(),
                folder: false
            }
        );
        let theirs = std::fs::read_to_string(root.join("Trips/Cairo/giza.jpg")).unwrap();
        assert_eq!(theirs, "theirs");
        let ours = std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap();
        assert_eq!(ours, "p");
        let file = items::file_of(&conn, pyramid).unwrap().unwrap();
        assert_eq!(file.disk_name, "pyramid.jpg");
    }

    #[test]
    fn undoing_a_move_onto_a_name_that_appeared_just_before_it_stays_and_theirs_is_kept() {
        let (conn, root, cairo, people) = library("late-undo");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        move_items(&conn, &[pyramid], people, &batch).unwrap();

        theirs_appears_just_before_the_move();
        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!((back.files_back, back.stayed.len()), (0, 1));
        assert!(matches!(back.stayed[0].reason, Reason::NameTaken { .. }));
        let theirs = std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap();
        assert_eq!(theirs, "theirs");
        let ours = std::fs::read_to_string(root.join("People/pyramid.jpg")).unwrap();
        assert_eq!(ours, "p");
        assert_eq!(items::folder_of(&conn, pyramid).unwrap(), Some(people));
    }

    #[test]
    fn undoing_a_rename_onto_a_name_that_appeared_just_before_it_stays_and_theirs_is_kept() {
        let (conn, root, cairo, _) = library("late-undo-rename");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        rename(&conn, pyramid, "giza.jpg", &batch).unwrap();

        theirs_appears_just_before_the_move();
        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!((back.files_back, back.stayed.len()), (0, 1));
        let theirs = std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap();
        assert_eq!(theirs, "theirs");
        let ours = std::fs::read_to_string(root.join("Trips/Cairo/giza.jpg")).unwrap();
        assert_eq!(ours, "p");
    }

    /// Cancels once `after` files are settled, keeping every count it was given.
    struct CancelAfter {
        after: u32,
        said: std::cell::RefCell<Vec<(u32, u32)>>,
    }

    impl Control for CancelAfter {
        fn halt(&self) -> Option<Halt> {
            let done = self.said.borrow().last().map_or(0, |(done, _)| *done);
            (done >= self.after).then_some(Halt::Cancel)
        }
        fn progress(&self, done: u32, whole: u32) {
            self.said.borrow_mut().push((done, whole));
        }
    }

    #[test]
    fn a_move_cancelled_between_files_leaves_each_whole_in_one_place_and_undo_takes_back_what_went()
    {
        let (conn, root, cairo, _) = library("cancelled");
        let trips = folders::parent(&conn, cairo).unwrap().unwrap();
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let batch = journal::new_batch();
        let control = CancelAfter {
            after: 1,
            said: std::cell::RefCell::new(Vec::new()),
        };

        let outcome = move_watched(&conn, &[pyramid, sphinx], trips, &batch, &control).unwrap();
        assert_eq!(outcome.halted, Some(Halt::Cancel));
        assert_eq!((outcome.report.moved, outcome.report.refused.len()), (1, 0));
        assert_eq!(control.said.take(), [(0, 2), (1, 2)]);
        let whole_in = |dir: &str, name: &str, bytes: &str| {
            assert_eq!(
                std::fs::read_to_string(root.join(dir).join(name)).unwrap(),
                bytes
            );
        };
        whole_in("Trips", "pyramid.jpg", "p");
        assert!(!root.join("Trips/Cairo/pyramid.jpg").exists());
        whole_in("Trips/Cairo", "sphinx.jpg", "s");
        assert!(!root.join("Trips/sphinx.jpg").exists());

        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!((back.files_back, back.stayed.len()), (1, 0));
        whole_in("Trips/Cairo", "pyramid.jpg", "p");
    }

    #[test]
    fn a_move_whose_folder_went_meanwhile_stops_and_says_why() {
        let (conn, root, cairo, people) = library("folder-gone");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        folders::retire_subtree_at(&conn, people, crate::db::now()).unwrap();

        let outcome =
            move_watched(&conn, &[pyramid], people, &journal::new_batch(), &Unwatched).unwrap();
        assert_eq!(
            outcome.stopped,
            Some(Reason::FolderGone {
                name: "People".into()
            })
        );
        assert_eq!(outcome.report.moved, 0);
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
    }

    #[test]
    fn a_move_on_one_drive_crosses_none() {
        let (conn, _, cairo, people) = library("one-drive");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        assert!(!cross_drives(&conn, &[pyramid], people).unwrap());
    }

    #[test]
    fn a_name_held_only_by_a_file_long_gone_is_given_to_the_one_arriving() {
        let (conn, root, cairo, people) = library("retired");
        std::fs::remove_file(root.join("People/sphinx.jpg")).unwrap();
        walk::reconcile(&conn).unwrap();
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");

        let report = move_items(&conn, &[sphinx], people, &journal::new_batch()).unwrap();
        assert_eq!(report.moved, 1, "{:?}", report.refused);
        assert_eq!(id_of(&conn, people, "sphinx.jpg"), sphinx);
        assert!(root.join("People/sphinx.jpg").is_file());
    }
}
