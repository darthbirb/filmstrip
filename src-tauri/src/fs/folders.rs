//! Folders changed on disk: made, renamed, moved and deleted. The directory changes first and the
//! row second, so a disk that refuses never leaves a row claiming what is not there; and each
//! change is journalled, so it can be undone. DECISIONS.md "Undo".

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::sources::{self, SourceKind};
use crate::db::{folders, items, journal, now, tags};
use crate::error::{AppError, Reason, Result};
use crate::fs::stayed::{self, Stayed};
use crate::fs::{items as fs_items, paths, relocate, sanitize, trash, walk};

/// Makes a folder inside `parent_id` under `title`, as a directory and then a row.
pub fn create(conn: &Connection, parent_id: i64, title: &str, batch_id: &str) -> Result<i64> {
    let _turn = super::turn();
    if !folders::is_live(conn, parent_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    let title = sanitize::folder_title(title);
    refuse_clash(conn, parent_id, &title, None)?;

    let dir = paths::folder_dir(conn, parent_id)?.join(&title);
    // Not create_dir_all: a directory already there is a folder the index has not read yet.
    std::fs::create_dir(&dir).map_err(|err| match err.kind() {
        std::io::ErrorKind::AlreadyExists => taken(conn, parent_id, &title),
        _ => err.into(),
    })?;

    let recorded = in_transaction(conn, |tx| {
        let id = folders::create(tx, parent_id, &title)?;
        journal::record_folder_create(tx, batch_id, id, parent_id)?;
        Ok(id)
    });
    if recorded.is_err() {
        let _ = std::fs::remove_dir(&dir);
    }
    recorded
}

/// Renames a folder's directory and then its row. `false` when the name is already the one it has.
/// A source's own folder is renamed as a source, which touches no directory.
pub fn rename(conn: &Connection, folder_id: i64, title: &str, batch_id: &str) -> Result<bool> {
    let _turn = super::turn();
    rename_unjournalled(conn, folder_id, title, Some(batch_id))
}

/// The rename itself, which undo also uses to put a name back without journalling it again.
pub(super) fn rename_unjournalled(
    conn: &Connection,
    folder_id: i64,
    title: &str,
    batch_id: Option<&str>,
) -> Result<bool> {
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    let Some(parent_id) = folders::parent(conn, folder_id)? else {
        return Err(AppError::invalid(
            "a source's own folder is renamed as a source",
        ));
    };
    let old = folders::title(conn, folder_id)?.unwrap_or_default();
    let title = sanitize::folder_title(title);
    if title == old {
        return Ok(false);
    }
    // A change of case alone is still this folder's own name, not a clash with itself.
    refuse_clash(conn, parent_id, &title, Some(folder_id))?;

    let from = paths::folder_dir(conn, folder_id)?;
    let to = from.with_file_name(&title);
    if old.to_lowercase() != title.to_lowercase() && to.exists() {
        return Err(taken(conn, parent_id, &title));
    }
    std::fs::rename(&from, &to)?;

    let recorded = in_transaction(conn, |tx| {
        folders::set_title(tx, folder_id, &title)?;
        tags::rebuild_subtree(tx, folder_id)?;
        if let Some(batch_id) = batch_id {
            journal::record_folder_rename(tx, batch_id, folder_id, &old, &title)?;
        }
        Ok(true)
    });
    if recorded.is_err() {
        let _ = std::fs::rename(&to, &from);
    }
    recorded
}

/// Moves a folder, with everything in it, into another. `false` when it is already there.
pub fn move_into(
    conn: &Connection,
    folder_id: i64,
    parent_id: i64,
    batch_id: &str,
) -> Result<bool> {
    let _turn = super::turn();
    move_unjournalled(conn, folder_id, parent_id, Some(batch_id))
}

/// The move itself, which undo also uses to put a folder back without journalling it again.
pub(super) fn move_unjournalled(
    conn: &Connection,
    folder_id: i64,
    parent_id: i64,
    batch_id: Option<&str>,
) -> Result<bool> {
    if !folders::is_live(conn, folder_id)? || !folders::is_live(conn, parent_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    let Some(from_parent) = folders::parent(conn, folder_id)? else {
        return Err(AppError::invalid(
            "a source's own folder sits inside nothing",
        ));
    };
    if from_parent == parent_id {
        return Ok(false);
    }
    if folders::is_within(conn, parent_id, folder_id)? {
        return Err(AppError::invalid("a folder cannot go inside itself"));
    }
    let title = folders::title(conn, folder_id)?.unwrap_or_default();
    refuse_clash(conn, parent_id, &title, None)?;

    let from = paths::folder_dir(conn, folder_id)?;
    let to = paths::folder_dir(conn, parent_id)?.join(&title);
    if to.exists() {
        return Err(taken(conn, parent_id, &title));
    }
    relocate::relocate(&from, &to)?;

    let recorded = in_transaction(conn, |tx| {
        folders::set_parent(tx, folder_id, parent_id)?;
        tags::rebuild_subtree(tx, folder_id)?;
        if let Some(batch_id) = batch_id {
            journal::record_folder_move(tx, batch_id, folder_id, from_parent, parent_id)?;
        }
        Ok(true)
    });
    if recorded.is_err() {
        let _ = relocate::relocate(&to, &from);
    }
    recorded
}

/// Where the files in a folder being deleted go. PRODUCT.md "Folders and sources".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Contents {
    /// Into the trash, with the folder.
    Trash,
    /// Into a sorting source's top level, subfolders and all.
    MoveTo {
        #[serde(rename = "sourceId")]
        source_id: i64,
    },
}

/// Whether a folder went, and what kept it when it did not.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteReport {
    pub deleted: bool,
    pub refused: Vec<Stayed>,
}

/// Deletes a folder, trashing or moving what it holds first, under the same batch, as `contents`
/// says; it goes once only Windows' litter is left in it. DECISIONS.md "Undo".
pub fn delete(
    conn: &Connection,
    folder_id: i64,
    contents: Option<Contents>,
    batch_id: &str,
) -> Result<DeleteReport> {
    let _turn = super::turn();
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    if folders::parent(conn, folder_id)?.is_none() {
        return Err(AppError::invalid(
            "a source's own folder is removed as a source, never deleted",
        ));
    }
    let title = folders::title(conn, folder_id)?.unwrap_or_default();
    let held = items::live_under(conn, folder_id)?;
    let mut report = DeleteReport::default();
    match (contents, held.is_empty()) {
        (_, true) => {}
        (None, false) => {
            return Err(AppError::invalid(format!(
                "{title} holds {} files, so where they go has to be chosen",
                held.len()
            )));
        }
        (Some(Contents::Trash), false) => {
            for item_id in held {
                if let Err(err) = trash::trash_unjournalled(conn, item_id, Some(batch_id)) {
                    report.refused.push(stayed::file(conn, item_id, &err)?);
                }
            }
        }
        (Some(Contents::MoveTo { source_id }), false) => {
            let inbox = sorting_root(conn, source_id)?;
            for child in folders::live_children(conn, folder_id)? {
                if let Err(err) = move_unjournalled(conn, child, inbox, Some(batch_id)) {
                    report.refused.push(stayed::folder(conn, child, &err)?);
                }
            }
            for item_id in items::in_folder(conn, folder_id)?
                .into_iter()
                .map(|item| item.id)
            {
                if let Err(err) = fs_items::move_unjournalled(conn, item_id, inbox, Some(batch_id))
                {
                    report.refused.push(stayed::file(conn, item_id, &err)?);
                }
            }
        }
    }
    if !report.refused.is_empty() {
        return Ok(report);
    }

    let dir = paths::folder_dir(conn, folder_id)?;
    let unseen = unseen_files(&dir)?;
    if let Some(first) = unseen.first() {
        let holds = AppError::refused(Reason::Holds {
            name: file_name(first),
            more: unseen.len() as u32 - 1,
        });
        report
            .refused
            .push(stayed::folder(conn, folder_id, &holds)?);
        return Ok(report);
    }
    clear_litter(&dir)?;

    let retired_at = now();
    let subtree: Vec<PathBuf> = folders::descendants(conn, folder_id)?
        .into_iter()
        .map(|id| paths::folder_dir(conn, id))
        .collect::<Result<_>>()?;
    let recorded = in_transaction(conn, |tx| {
        folders::retire_subtree_at(tx, folder_id, retired_at)?;
        journal::record_folder_delete(tx, batch_id, folder_id, retired_at)
    });
    if let Err(err) = recorded {
        for path in std::iter::once(&dir).chain(&subtree) {
            let _ = std::fs::create_dir_all(path);
        }
        return Err(err);
    }
    report.deleted = true;
    Ok(report)
}

/// Brings a deleted folder back: its directories made again, then its rows.
pub(super) fn undelete(conn: &Connection, folder_id: i64, retired_at: i64) -> Result<()> {
    let back = folders::retired_with(conn, folder_id, retired_at)?;
    if back.is_empty() {
        return Ok(());
    }
    let title = folders::title(conn, folder_id)?.unwrap_or_default();
    let parent = folders::parent(conn, folder_id)?
        .ok_or_else(|| AppError::invalid("a source's own folder is never deleted"))?;
    if !folders::is_live(conn, parent)? {
        return Err(AppError::refused(Reason::FolderGone {
            name: folders::title(conn, parent)?.unwrap_or_default(),
        }));
    }
    refuse_clash(conn, parent, &title, Some(folder_id))?;
    let top = paths::folder_dir(conn, folder_id)?;
    if top.exists() {
        return Err(taken(conn, parent, &title));
    }
    for id in &back {
        std::fs::create_dir_all(paths::folder_dir(conn, *id)?)?;
    }
    in_transaction(conn, |tx| {
        folders::restore_retired_with(tx, folder_id, retired_at)
    })
}

/// A sorting source's own folder, which is where "move them to" puts what a deleted folder held.
fn sorting_root(conn: &Connection, source_id: i64) -> Result<i64> {
    let source = sources::get(conn, source_id)?
        .ok_or_else(|| AppError::invalid("that source is no longer in the index"))?;
    if source.kind != SourceKind::Sorting {
        return Err(AppError::invalid(format!(
            "{} is not a sorting source",
            source.title
        )));
    }
    folders::source_root_folder(conn, source_id)
}

/// The first file that keeps a folder from going, for Explorer to show selected.
pub fn first_unseen(dir: &Path) -> Result<Option<PathBuf>> {
    Ok(unseen_files(dir)?.into_iter().next())
}

/// Every file under `dir` the index does not show, but for Windows' own litter.
fn unseen_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut found = Vec::new();
    if !dir.is_dir() {
        return Ok(found);
    }
    for entry in walkdir::WalkDir::new(dir).min_depth(1).sort_by_file_name() {
        let entry = entry.map_err(|err| AppError::invalid(err.to_string()))?;
        if entry.file_type().is_dir() {
            continue;
        }
        if !is_litter(entry.path()) {
            found.push(entry.into_path());
        }
    }
    Ok(found)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn is_litter(path: &Path) -> bool {
    walk::IGNORED_FILES.contains(&file_name(path).to_lowercase().as_str())
}

/// Removes the litter and then each directory, deepest first and each only once it is empty, so a
/// file that arrived since the check stops the removal rather than going with it.
fn clear_litter(dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(dir).contents_first(true) {
        let entry = entry.map_err(|err| AppError::invalid(err.to_string()))?;
        if entry.file_type().is_dir() {
            std::fs::remove_dir(entry.path())?;
        } else if is_litter(entry.path()) {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

/// Takes back a folder the app made: its directory, while still empty, and then its row.
pub(super) fn unmake(conn: &Connection, folder_id: i64) -> Result<()> {
    if !folders::is_live(conn, folder_id)? {
        return Ok(()); // a walk found its directory gone and retired it already
    }
    let title = folders::title(conn, folder_id)?.unwrap_or_default();
    if folders::holds_anything(conn, folder_id)? {
        return Err(AppError::invalid(format!(
            "{title} holds something now, so it stays"
        )));
    }
    let dir = paths::folder_dir(conn, folder_id)?;
    match std::fs::remove_dir(&dir) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        // Files the index has not read yet: removing the directory would take them with it.
        Err(_) => {
            return Err(AppError::invalid(format!(
                "{title} holds something now, so it stays"
            )));
        }
    }
    folders::forget(conn, folder_id)
}

fn refuse_clash(conn: &Connection, parent_id: i64, title: &str, own: Option<i64>) -> Result<()> {
    match folders::child_id(conn, parent_id, title)? {
        Some(id) if Some(id) != own => Err(taken(conn, parent_id, title)),
        _ => Ok(()),
    }
}

fn taken(conn: &Connection, parent_id: i64, title: &str) -> AppError {
    AppError::refused(Reason::NameTaken {
        place: folders::title(conn, parent_id)
            .ok()
            .flatten()
            .unwrap_or_default(),
        name: title.to_string(),
        folder: true,
    })
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

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-folders")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("library")).unwrap();
        dir
    }

    /// A library with Trips/Cairo/pyramid.jpg, walked into an index kept in a real file.
    fn library(name: &str) -> (Connection, PathBuf, i64, i64) {
        let dir = scratch(name);
        let root = dir.join("library");
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "p").unwrap();
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        (conn, root, top, trips)
    }

    #[test]
    fn a_folder_is_made_on_disk_and_in_the_index_under_a_name_windows_accepts() {
        let (conn, root, _, trips) = library("make");
        let batch = journal::new_batch();
        let made = create(&conn, trips, "Lisbon: day 2.", &batch).unwrap();

        assert!(root.join("Trips/Lisbon day 2").is_dir());
        assert_eq!(
            folders::title(&conn, made).unwrap().as_deref(),
            Some("Lisbon day 2")
        );
        assert_eq!(journal::latest_batch(&conn).unwrap(), Some(batch));
    }

    #[test]
    fn a_name_taken_in_the_index_or_only_on_disk_is_refused_and_nothing_is_made() {
        let (conn, root, _, trips) = library("taken");
        assert!(create(&conn, trips, "cairo", &journal::new_batch()).is_err());

        std::fs::create_dir(root.join("Trips/Unread")).unwrap();
        assert!(create(&conn, trips, "Unread", &journal::new_batch()).is_err());
        assert_eq!(folders::child_id(&conn, trips, "Unread").unwrap(), None);
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
    }

    #[test]
    fn a_rename_moves_the_directory_and_the_title_the_items_under_it_inherit() {
        let (conn, root, _, trips) = library("rename");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        assert!(rename(&conn, cairo, "Giza", &journal::new_batch()).unwrap());

        assert!(root.join("Trips/Giza/pyramid.jpg").is_file());
        assert!(!root.join("Trips/Cairo").exists());
        let item = db::items::in_folder(&conn, cairo).unwrap()[0].id;
        let carried: Vec<String> = tags::item_effective_tags(&conn, item)
            .unwrap()
            .into_iter()
            .map(|tag| tag.value)
            .collect();
        // A tag is kept folded; the title keeps its case.
        assert!(carried.iter().any(|value| value == "giza"), "{carried:?}");
        assert!(!carried.iter().any(|value| value == "cairo"), "{carried:?}");
    }

    #[test]
    fn a_rename_that_only_changes_case_is_a_rename_and_the_same_name_is_nothing() {
        let (conn, root, _, trips) = library("case");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        assert!(!rename(&conn, cairo, "Cairo", &journal::new_batch()).unwrap());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);

        assert!(rename(&conn, cairo, "CAIRO", &journal::new_batch()).unwrap());
        let names: Vec<String> = std::fs::read_dir(root.join("Trips"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["CAIRO"]);
    }

    #[test]
    fn a_sources_own_folder_is_not_renamed_on_disk() {
        let (conn, root, top, _) = library("root");
        assert!(rename(&conn, top, "Elsewhere", &journal::new_batch()).is_err());
        assert!(root.is_dir());
    }

    fn carried(conn: &Connection, folder_id: i64) -> Vec<String> {
        let item = db::items::in_folder(conn, folder_id).unwrap()[0].id;
        tags::item_effective_tags(conn, item)
            .unwrap()
            .into_iter()
            .map(|tag| tag.value)
            .collect()
    }

    #[test]
    fn a_folder_moves_with_everything_in_it_and_its_files_inherit_from_the_new_place() {
        let (conn, root, top, trips) = library("move");
        std::fs::create_dir(root.join("People")).unwrap();
        walk::reconcile(&conn).unwrap();
        let people = folders::child_id(&conn, top, "People").unwrap().unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();

        assert!(move_into(&conn, cairo, people, &journal::new_batch()).unwrap());
        assert!(root.join("People/Cairo/pyramid.jpg").is_file());
        assert!(!root.join("Trips/Cairo").exists());
        assert_eq!(folders::parent(&conn, cairo).unwrap(), Some(people));
        let tags = carried(&conn, cairo);
        assert!(tags.iter().any(|value| value == "people"), "{tags:?}");
        assert!(!tags.iter().any(|value| value == "trips"), "{tags:?}");
        assert!(!move_into(&conn, cairo, people, &journal::new_batch()).unwrap());
    }

    #[test]
    fn a_folder_moved_into_another_source_takes_its_files_with_it() {
        let (conn, root, _, trips) = library("across");
        let incoming = root.parent().unwrap().join("incoming");
        std::fs::create_dir_all(&incoming).unwrap();
        let sorting = sources::add(&conn, &incoming, "Incoming", SourceKind::Sorting).unwrap();
        let inbox = folders::source_root_folder(&conn, sorting.id).unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();

        move_into(&conn, cairo, inbox, &journal::new_batch()).unwrap();
        assert!(incoming.join("Cairo/pyramid.jpg").is_file());
        let item = db::items::in_folder(&conn, cairo).unwrap()[0].id;
        let source: i64 = conn
            .query_row("SELECT source_id FROM item WHERE id = ?1", [item], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(source, sorting.id);
    }

    #[test]
    fn a_folder_goes_nowhere_inside_itself_nor_onto_a_name_taken() {
        let (conn, root, top, trips) = library("move-refused");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        assert!(move_into(&conn, trips, cairo, &journal::new_batch()).is_err());
        assert!(move_into(&conn, trips, trips, &journal::new_batch()).is_err());
        assert!(move_into(&conn, top, trips, &journal::new_batch()).is_err());

        std::fs::create_dir_all(root.join("Cairo")).unwrap();
        assert!(move_into(&conn, cairo, top, &journal::new_batch()).is_err());
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
    }

    /// The library, plus an Inbox sorting source; returns Inbox's own folder and its path.
    fn with_inbox(conn: &Connection, root: &Path) -> (i64, i64, PathBuf) {
        let inbox_root = root.parent().unwrap().join("inbox");
        std::fs::create_dir_all(&inbox_root).unwrap();
        let inbox = sources::add(conn, &inbox_root, "Inbox", SourceKind::Sorting).unwrap();
        let folder = folders::source_root_folder(conn, inbox.id).unwrap();
        (inbox.id, folder, inbox_root)
    }

    #[test]
    fn an_empty_folder_goes_without_being_asked_and_comes_back_with_one_undo() {
        let (conn, root, _, trips) = library("delete-empty");
        let made = create(&conn, trips, "Lisbon", &journal::new_batch()).unwrap();
        std::fs::write(root.join("Trips/Lisbon/desktop.ini"), "litter").unwrap();

        let batch = journal::new_batch();
        let report = delete(&conn, made, None, &batch).unwrap();
        assert_eq!(
            report,
            DeleteReport {
                deleted: true,
                refused: vec![]
            }
        );
        assert!(!root.join("Trips/Lisbon").exists(), "litter goes with it");
        assert!(!folders::is_live(&conn, made).unwrap());

        crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert!(root.join("Trips/Lisbon").is_dir());
        assert!(folders::is_live(&conn, made).unwrap());
    }

    #[test]
    fn a_folder_holding_files_is_not_deleted_until_it_is_told_where_they_go() {
        let (conn, root, _, trips) = library("delete-asks");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        assert!(delete(&conn, cairo, None, &journal::new_batch()).is_err());
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert!(folders::is_live(&conn, cairo).unwrap());
    }

    #[test]
    fn deleted_to_the_trash_everything_under_it_goes_and_one_undo_puts_it_all_back() {
        let (conn, root, _, trips) = library("delete-trash");
        std::fs::create_dir_all(root.join("Trips/Cairo/Night")).unwrap();
        std::fs::write(root.join("Trips/Cairo/Night/stars.jpg"), "s").unwrap();
        walk::reconcile(&conn).unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let night = folders::child_id(&conn, cairo, "Night").unwrap().unwrap();
        let held = items::live_under(&conn, cairo).unwrap();

        let batch = journal::new_batch();
        let report = delete(&conn, cairo, Some(Contents::Trash), &batch).unwrap();
        assert!(report.deleted, "{:?}", report.refused);
        let described = crate::fs::acts::describe(&conn, &batch).unwrap();
        assert_eq!(
            described.act,
            crate::fs::acts::Act::DeleteFolder {
                name: "Cairo".into(),
                parent: "Trips".into(),
                into: None
            }
        );
        assert_eq!(described.files, 2);
        assert!(!root.join("Trips/Cairo").exists());
        assert!(held.iter().all(|id| items::is_trashed(&conn, *id).unwrap()));
        assert!(!folders::is_live(&conn, night).unwrap());

        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert!(root.join("Trips/Cairo/Night/stars.jpg").is_file());
        assert!(folders::is_live(&conn, night).unwrap());
        assert!(held.iter().all(|id| items::is_live(&conn, *id).unwrap()));
    }

    #[test]
    fn moved_to_a_sorting_source_its_files_and_subfolders_arrive_as_they_were() {
        let (conn, root, _, trips) = library("delete-move");
        std::fs::create_dir_all(root.join("Trips/Cairo/Night")).unwrap();
        std::fs::write(root.join("Trips/Cairo/Night/stars.jpg"), "s").unwrap();
        walk::reconcile(&conn).unwrap();
        let (inbox, inbox_folder, inbox_root) = with_inbox(&conn, &root);
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();

        let batch = journal::new_batch();
        let contents = Some(Contents::MoveTo { source_id: inbox });
        let report = delete(&conn, cairo, contents, &batch).unwrap();
        assert!(report.deleted, "{:?}", report.refused);
        let described = crate::fs::acts::describe(&conn, &batch).unwrap();
        assert_eq!(
            described.act,
            crate::fs::acts::Act::DeleteFolder {
                name: "Cairo".into(),
                parent: "Trips".into(),
                into: Some("Inbox".into())
            }
        );
        assert_eq!(described.files, 2, "the file in Night counts too");
        assert!(inbox_root.join("pyramid.jpg").is_file());
        assert!(inbox_root.join("Night/stars.jpg").is_file());
        assert!(!root.join("Trips/Cairo").exists());
        assert!(
            folders::child_id(&conn, inbox_folder, "Night")
                .unwrap()
                .is_some()
        );

        crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert!(root.join("Trips/Cairo/Night/stars.jpg").is_file());
        assert!(!inbox_root.join("pyramid.jpg").exists());
    }

    #[test]
    fn a_name_the_sorting_source_already_holds_keeps_the_folder_and_says_why() {
        let (conn, root, _, trips) = library("delete-clash");
        let (inbox, _, inbox_root) = with_inbox(&conn, &root);
        std::fs::write(inbox_root.join("pyramid.jpg"), "theirs").unwrap();
        walk::reconcile(&conn).unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();

        let contents = Some(Contents::MoveTo { source_id: inbox });
        let report = delete(&conn, cairo, contents, &journal::new_batch()).unwrap();
        assert!(!report.deleted);
        assert_eq!(
            report.refused[0].reason,
            Reason::NameTaken {
                place: "Inbox".into(),
                name: "pyramid.jpg".into(),
                folder: false
            }
        );
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
        assert!(folders::is_live(&conn, cairo).unwrap());
    }

    #[test]
    fn a_file_filmstrip_does_not_show_keeps_the_folder_in_place() {
        let (conn, root, _, trips) = library("delete-hidden");
        let made = create(&conn, trips, "Lisbon", &journal::new_batch()).unwrap();
        std::fs::write(root.join("Trips/Lisbon/.notes"), "mine").unwrap();

        let report = delete(&conn, made, None, &journal::new_batch()).unwrap();
        assert!(!report.deleted);
        assert_eq!(report.refused[0].id, made);
        assert_eq!(
            report.refused[0].reason,
            Reason::Holds {
                name: ".notes".into(),
                more: 0
            }
        );
        assert!(root.join("Trips/Lisbon/.notes").is_file());
        assert!(folders::is_live(&conn, made).unwrap());
        let shown = first_unseen(&root.join("Trips/Lisbon")).unwrap();
        assert_eq!(shown, Some(root.join("Trips/Lisbon/.notes")));
    }

    #[test]
    fn a_source_is_never_deleted_and_files_only_move_to_a_sorting_source() {
        let (conn, _, top, trips) = library("delete-refused");
        assert!(delete(&conn, top, Some(Contents::Trash), &journal::new_batch()).is_err());
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let into_library = Some(Contents::MoveTo { source_id: 1 });
        assert!(delete(&conn, cairo, into_library, &journal::new_batch()).is_err());
        assert!(folders::is_live(&conn, cairo).unwrap());
    }
}
