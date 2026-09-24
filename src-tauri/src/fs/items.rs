//! Files moved between folders and renamed where they are. A file keeps its own name wherever it
//! goes, so a name already taken is refused and reported, never changed for it.
//! DECISIONS.md "Undo".

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::{folders, items, journal, tags};
use crate::error::{AppError, Reason, Result};
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
    let mut report = MoveReport::default();
    for &item_id in item_ids {
        match move_unjournalled(conn, item_id, folder_id, Some(batch_id)) {
            Ok(true) => report.moved += 1,
            Ok(false) => {}
            Err(err) => report.refused.push(stayed::file(conn, item_id, &err)?),
        }
    }
    Ok(report)
}

/// The move itself, which undo also uses to put an item back without journalling it again.
/// `false` when the item is already there.
pub(super) fn move_unjournalled(
    conn: &Connection,
    item_id: i64,
    folder_id: i64,
    batch_id: Option<&str>,
) -> Result<bool> {
    if !items::is_live(conn, item_id)? {
        return Err(AppError::invalid("that file is no longer in the index"));
    }
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    if file.folder_id == folder_id {
        return Ok(false);
    }

    let taken = || {
        AppError::refused(Reason::NameTaken {
            place: folders::title(conn, folder_id)
                .ok()
                .flatten()
                .unwrap_or_default(),
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
    if to.exists() {
        return Err(taken());
    }
    relocate::relocate(&from, &to)?;

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
        Ok(true)
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
        return Err(AppError::invalid("that file is no longer in the index"));
    }
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let name = sanitize::file_name(name.trim());
    if name == file.disk_name {
        return Ok(false);
    }
    let taken = || {
        AppError::refused(Reason::NameTaken {
            place: folders::title(conn, file.folder_id)
                .ok()
                .flatten()
                .unwrap_or_default(),
            name: name.clone(),
            folder: false,
        })
    };
    // A change of case alone is still this file's own name, not a clash with itself.
    let own_name = name.to_lowercase() == file.disk_name.to_lowercase();
    let held =
        items::existing_by_disk_name(conn, file.folder_id, &name)?.filter(|row| row.id != item_id);
    if held.as_ref().is_some_and(|row| !row.deleted) {
        return Err(taken());
    }
    let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    let to = paths::item_path(conn, file.folder_id, &name)?;
    if !own_name && to.exists() {
        return Err(taken());
    }
    std::fs::rename(&from, &to)?;

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
        let _ = std::fs::rename(&to, &from);
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
