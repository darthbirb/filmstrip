//! Folders changed on disk: made and renamed. The directory changes first and the row second, so
//! a disk that refuses never leaves a row claiming what is not there; and each change is
//! journalled, so it can be undone. DECISIONS.md "Undo".

use rusqlite::Connection;

use crate::db::{folders, journal, tags};
use crate::error::{AppError, Result};
use crate::fs::{paths, sanitize};

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
        std::io::ErrorKind::AlreadyExists => taken(&title),
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
        return Err(taken(&title));
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
        Some(id) if Some(id) != own => Err(taken(title)),
        _ => Ok(()),
    }
}

fn taken(title: &str) -> AppError {
    AppError::invalid(format!("a folder named {title} is already there"))
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
}
