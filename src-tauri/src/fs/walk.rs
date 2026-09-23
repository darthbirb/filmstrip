//! Reads each source's tree into the index and retires what it did not find.
//! DECISIONS.md "A walk only judges what it read".
//! Gap: DECISIONS.md "Renames made while the app was closed".

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::Connection;
use walkdir::WalkDir;

use crate::db::items::NewItem;
use crate::db::{folders, items, sources};
use crate::error::Result;
use crate::fs::paths;

/// Windows and macOS litter; never library content.
const IGNORED_FILES: &[&str] = &["thumbs.db", "desktop.ini", ".ds_store"];

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff", "avif", "heic",
];
const VIDEO_EXTS: &[&str] = &["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv"];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WalkReport {
    /// Files whose row already matched — the cheap path.
    pub unchanged: u64,
    /// Files recorded for the first time, or refreshed because they changed.
    pub indexed: u64,
    /// Items retired because the walk never found their file.
    pub items_retired: usize,
    /// Folders retired because their directory is gone.
    pub folders_retired: i64,
}

/// What a file's extension says it is. A real probe comes with the media pass;
/// this is what can be known without reading the file.
pub fn kind_of(ext: &str) -> &'static str {
    let ext = ext.to_lowercase();
    if IMAGE_EXTS.contains(&ext.as_str()) {
        "image"
    } else if VIDEO_EXTS.contains(&ext.as_str()) {
        "video"
    } else {
        "other"
    }
}

pub fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry.file_name().to_string_lossy().starts_with('.')
}

/// Mirrors a source's directories into folders and collects its files. Skips
/// hidden entries, and the app's own directory should a root contain it.
pub fn mirror(
    conn: &Connection,
    source_root: &Path,
    root_folder_id: i64,
) -> Result<(HashMap<PathBuf, i64>, Vec<PathBuf>)> {
    let mut folder_ids = HashMap::from([(source_root.to_path_buf(), root_folder_id)]);
    let mut files = Vec::new();
    let app_data = crate::config::app_data_dir().ok();
    let is_app_owned = |path: &Path| app_data.as_deref().is_some_and(|dir| path.starts_with(dir));

    let walker = WalkDir::new(source_root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| (e.depth() == 0 || !is_hidden(e)) && !is_app_owned(e.path()));

    for entry in walker.flatten() {
        if entry.depth() == 0 {
            continue; // the root is already seeded
        }
        let path = entry.path().to_path_buf();

        if entry.file_type().is_dir() {
            let Some(parent_id) = path.parent().and_then(|p| folder_ids.get(p)).copied() else {
                continue; // its parent was skipped, so this is skipped too
            };
            let title = entry.file_name().to_string_lossy().to_string();
            let folder_id = match folders::child_id(conn, parent_id, &title)? {
                Some(existing) => existing,
                None => folders::create(conn, parent_id, &title)?,
            };
            folder_ids.insert(path, folder_id);
            continue;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        if IGNORED_FILES.contains(&entry.file_name().to_string_lossy().to_lowercase().as_str()) {
            continue;
        }
        files.push(path);
    }
    Ok((folder_ids, files))
}

enum Outcome {
    Unchanged,
    Indexed,
}

fn record_file(conn: &Connection, file: &Path, folder_id: i64, source_id: i64) -> Result<Outcome> {
    let name = file
        .file_name()
        .ok_or_else(|| crate::error::AppError::invalid("a directory entry with no name"))?
        .to_string_lossy()
        .to_string();
    let meta = std::fs::metadata(file)?;
    let size = meta.len() as i64;
    let mtime = mtime_secs(&meta);

    if let Some(existing) = items::existing_by_disk_name(conn, folder_id, &name)?
        && !existing.deleted
        && existing.size_bytes == size
        && existing.mtime == mtime
    {
        items::mark_seen(conn, &existing.uuid)?;
        return Ok(Outcome::Unchanged);
    }

    let ext = paths::extension_of(&name);
    let id = items::upsert(
        conn,
        &NewItem {
            uuid: uuid::Uuid::new_v4().to_string(),
            source_id,
            folder_id,
            disk_name: name.clone(),
            ext: ext.clone(),
            orig_name: name,
            hash: None,
            size_bytes: size,
            mtime,
            kind: kind_of(&ext).to_string(),
            width: None,
            height: None,
            duration_ms: None,
            codec: None,
            bitrate: None,
            captured_at: None,
            captured_src: None,
        },
    )?;
    crate::db::tags::rebuild_item(conn, id)?;

    let uuid: String = conn.query_row(
        "SELECT uuid FROM item WHERE id = ?1",
        rusqlite::params![id],
        |r| r.get(0),
    )?;
    items::mark_seen(conn, &uuid)?;
    Ok(Outcome::Indexed)
}

/// Brings the index back in line with what is on disk.
pub fn reconcile(conn: &Connection) -> Result<WalkReport> {
    reconcile_list(conn, sources::list(conn)?)
}

/// The pass itself, over the sources it listed when it started.
fn reconcile_list(conn: &Connection, listed: Vec<sources::Source>) -> Result<WalkReport> {
    let mut report = WalkReport::default();
    let mut walked: Vec<i64> = Vec::new();

    for source in listed {
        let root = PathBuf::from(&source.root);
        if !root.is_dir() {
            continue; // unreachable, so nothing here can be judged
        }
        match walk_source(conn, &source, &mut report) {
            Ok(()) => walked.push(source.id),
            // Removed while this pass ran: it took its folders with it, and the rest still walk.
            Err(err) => {
                if sources::get(conn, source.id)?.is_some() {
                    return Err(err);
                }
            }
        }
    }

    report.folders_retired = retire_vanished_folders(conn, &walked)?;
    Ok(report)
}

/// One source: its directories mirrored, its files recorded, and what vanished retired.
fn walk_source(conn: &Connection, source: &sources::Source, report: &mut WalkReport) -> Result<()> {
    let root = PathBuf::from(&source.root);
    let root_folder = folders::source_root_folder(conn, source.id)?;

    items::begin_sweep(conn)?;
    record_all(conn, &root, root_folder, source.id, report)?;
    report.items_retired += items::finish_sweep(conn, source.id)?;
    Ok(())
}

/// Every directory under `dir` mirrored into folders under `folder_id`, and every file recorded.
fn record_all(
    conn: &Connection,
    dir: &Path,
    folder_id: i64,
    source_id: i64,
    report: &mut WalkReport,
) -> Result<()> {
    let (folder_ids, files) = mirror(conn, dir, folder_id)?;
    for file in files {
        let Some(folder_id) = file.parent().and_then(|p| folder_ids.get(p)).copied() else {
            continue;
        };
        match record_file(conn, &file, folder_id, source_id) {
            Ok(Outcome::Unchanged) => report.unchanged += 1,
            Ok(Outcome::Indexed) => report.indexed += 1,
            Err(err) => eprintln!("could not index {}: {err}", file.display()),
        }
    }
    Ok(())
}

/// One folder read again, as the whole walk reads a source, judging nothing outside its subtree.
/// A folder in an unreachable source is left as it is; one whose own directory is gone retires.
pub fn reconcile_folder(conn: &Connection, folder_id: i64) -> Result<WalkReport> {
    let mut report = WalkReport::default();
    if !folders::is_live(conn, folder_id)? {
        return Ok(report);
    }
    let source_id = folders::location(conn, folder_id)?.source_id;
    let Some(source) = sources::get(conn, source_id)? else {
        return Ok(report);
    };
    if !Path::new(&source.root).is_dir() {
        return Ok(report);
    }
    let dir = paths::folder_dir(conn, folder_id)?;
    items::begin_sweep(conn)?;
    if dir.is_dir() {
        record_all(conn, &dir, folder_id, source_id, &mut report)?;
    }
    report.items_retired += items::finish_sweep_under(conn, folder_id)?;
    report.folders_retired = if dir.is_dir() {
        retire_gone(conn, folders::descendants(conn, folder_id)?)?
    } else {
        folders::trash_subtree(conn, folder_id)?
    };
    Ok(report)
}

/// Retires folders whose directory is gone, **only in sources this pass read**.
fn retire_vanished_folders(conn: &Connection, walked: &[i64]) -> Result<i64> {
    if walked.is_empty() {
        return Ok(0);
    }
    let mut stmt = conn.prepare(
        "SELECT id FROM folder WHERE deleted_at IS NULL AND parent_id IS NOT NULL ORDER BY id",
    )?;
    let candidates: Vec<i64> = stmt
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut read = Vec::new();
    for folder_id in candidates {
        if walked.contains(&folders::location(conn, folder_id)?.source_id) {
            read.push(folder_id);
        }
    }
    retire_gone(conn, read)
}

/// Retires each folder, in the order given, whose directory is no longer there.
fn retire_gone(conn: &Connection, candidates: Vec<i64>) -> Result<i64> {
    let mut retired = 0;
    for folder_id in candidates {
        // An ancestor retired earlier in this loop takes its descendants with
        // it, so anything already gone is skipped rather than counted twice.
        let still_live: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM folder WHERE id = ?1 AND deleted_at IS NULL)",
            rusqlite::params![folder_id],
            |r| r.get(0),
        )?;
        if !still_live {
            continue;
        }
        if !paths::folder_dir(conn, folder_id)?.is_dir() {
            retired += folders::trash_subtree(conn, folder_id)?;
        }
    }
    Ok(retired)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::sources::SourceKind;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-walk")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn library(name: &str) -> (Connection, PathBuf) {
        let root = scratch(name);
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        (conn, root)
    }

    fn live_items(conn: &Connection) -> Vec<(String, i64)> {
        let mut stmt = conn
            .prepare(
                "SELECT disk_name, folder_id FROM item WHERE deleted_at IS NULL
                  ORDER BY disk_name",
            )
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn a_tree_becomes_folders_and_items() {
        let (conn, root) = library("tree");
        write(&root.join("at-the-root.jpg"), "a");
        write(&root.join("Trips/Cairo/pyramid.jpg"), "b");

        let report = reconcile(&conn).unwrap();
        assert_eq!(report.indexed, 2);

        let root_folder = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, root_folder, "Trips")
            .unwrap()
            .unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        assert_eq!(
            live_items(&conn),
            [
                ("at-the-root.jpg".to_string(), root_folder),
                ("pyramid.jpg".to_string(), cairo)
            ]
        );
    }

    #[test]
    fn a_source_removed_while_the_pass_runs_does_not_stop_the_others() {
        let (conn, root) = library("removed-mid-pass");
        write(&root.join("kept.jpg"), "a");
        let going = scratch("removed-mid-pass-going");
        write(&going.join("gone.jpg"), "b");
        let doomed = sources::add(&conn, &going, "Going", SourceKind::Library).unwrap();
        // The pass listed both, and one was removed before it reached the other.
        let listed = sources::list(&conn).unwrap();
        sources::remove(&conn, doomed.id).unwrap();

        let report = reconcile_list(&conn, listed).unwrap();
        assert_eq!(report.indexed, 1);
        assert_eq!(
            live_items(&conn).len(),
            1,
            "the source still there was walked"
        );
    }

    #[test]
    fn walking_again_changes_nothing() {
        let (conn, root) = library("idempotent");
        write(&root.join("Trips/a.jpg"), "a");
        reconcile(&conn).unwrap();

        let report = reconcile(&conn).unwrap();
        assert_eq!(
            report,
            WalkReport {
                unchanged: 1,
                ..WalkReport::default()
            }
        );
        assert_eq!(live_items(&conn).len(), 1);
    }

    #[test]
    fn a_changed_file_is_refreshed_and_keeps_its_identity() {
        let (conn, root) = library("changed");
        let file = root.join("a.jpg");
        write(&file, "a");
        reconcile(&conn).unwrap();
        let before: (i64, String) = conn
            .query_row("SELECT id, uuid FROM item", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();

        write(&file, "much longer contents");
        filetime_bump(&file);
        let report = reconcile(&conn).unwrap();

        assert_eq!(report.indexed, 1);
        let after: (i64, String, i64) = conn
            .query_row("SELECT id, uuid, size_bytes FROM item", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(
            (after.0, after.1),
            before,
            "the same row and the same identity"
        );
        assert_eq!(after.2, 20);
    }

    #[test]
    fn what_is_gone_from_disk_is_retired() {
        let (conn, root) = library("retired");
        write(&root.join("stays.jpg"), "a");
        write(&root.join("Old/goes.jpg"), "b");
        reconcile(&conn).unwrap();

        std::fs::remove_dir_all(root.join("Old")).unwrap();
        let report = reconcile(&conn).unwrap();

        assert_eq!(report.items_retired, 1);
        assert_eq!(report.folders_retired, 1);
        assert_eq!(live_items(&conn).len(), 1, "only the file still on disk");
    }

    #[test]
    fn litter_and_hidden_directories_are_not_library_content() {
        let (conn, root) = library("litter");
        write(&root.join("Thumbs.db"), "x");
        write(&root.join("desktop.ini"), "x");
        write(&root.join(".git/config"), "x");
        write(&root.join("real.jpg"), "a");

        reconcile(&conn).unwrap();
        assert_eq!(live_items(&conn), [("real.jpg".to_string(), 1)]);
    }

    /// An unplugged drive is not a mass deletion.
    #[test]
    fn an_unreachable_source_keeps_everything_it_had() {
        let (conn, root) = library("unreachable");
        write(&root.join("Trips/a.jpg"), "a");
        reconcile(&conn).unwrap();
        let before = live_items(&conn).len();

        std::fs::remove_dir_all(&root).unwrap();
        let report = reconcile(&conn).unwrap();

        assert_eq!(
            report,
            WalkReport::default(),
            "nothing was walked, so nothing is judged"
        );
        assert_eq!(live_items(&conn).len(), before, "its items are still there");
    }

    #[test]
    fn a_sorting_source_is_walked_like_any_other() {
        let (conn, library_root) = library("two-sources");
        let incoming = scratch("two-sources-incoming");
        sources::add(&conn, &incoming, "Incoming", SourceKind::Sorting).unwrap();
        write(&library_root.join("kept.jpg"), "a");
        write(&incoming.join("waiting.jpg"), "b");

        reconcile(&conn).unwrap();

        let by_source: Vec<(String, i64)> = {
            let mut stmt = conn
                .prepare("SELECT disk_name, source_id FROM item ORDER BY disk_name")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert_eq!(
            by_source,
            [("kept.jpg".to_string(), 1), ("waiting.jpg".to_string(), 2)]
        );
    }

    fn names(conn: &Connection) -> Vec<String> {
        live_items(conn).into_iter().map(|(name, _)| name).collect()
    }

    fn folder_under(conn: &Connection, parent: i64, title: &str) -> i64 {
        folders::child_id(conn, parent, title).unwrap().unwrap()
    }

    fn live(conn: &Connection, folder_id: i64) -> bool {
        folders::is_live(conn, folder_id).unwrap()
    }

    #[test]
    fn reading_a_folder_again_judges_only_its_own_subtree() {
        let (conn, root) = library("again-subtree");
        write(&root.join("Trips/a.jpg"), "a");
        write(&root.join("Trips/Cairo/b.jpg"), "b");
        write(&root.join("People/c.jpg"), "c");
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");

        write(&root.join("Trips/new.jpg"), "n");
        write(&root.join("Trips/Cairo/deeper.jpg"), "d");
        write(&root.join("People/elsewhere.jpg"), "e");
        std::fs::remove_file(root.join("Trips/a.jpg")).unwrap();
        std::fs::remove_file(root.join("People/c.jpg")).unwrap();
        let report = reconcile_folder(&conn, trips).unwrap();

        // Outside Trips nothing is judged: c.jpg stays, elsewhere.jpg waits for a whole walk.
        assert_eq!(names(&conn), ["b.jpg", "c.jpg", "deeper.jpg", "new.jpg"]);
        assert_eq!((report.indexed, report.items_retired), (2, 1));
    }

    #[test]
    fn a_folder_gone_from_under_the_one_read_again_retires_and_nothing_outside_it_does() {
        let (conn, root) = library("again-folders");
        write(&root.join("Trips/Cairo/b.jpg"), "b");
        write(&root.join("People/c.jpg"), "c");
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");
        let cairo = folder_under(&conn, trips, "Cairo");
        let people = folder_under(&conn, top, "People");

        std::fs::remove_dir_all(root.join("Trips/Cairo")).unwrap();
        std::fs::remove_dir_all(root.join("People")).unwrap();
        reconcile_folder(&conn, trips).unwrap();

        assert!(!live(&conn, cairo));
        assert!(live(&conn, trips) && live(&conn, people));
        assert_eq!(names(&conn), ["c.jpg"]);
    }

    #[test]
    fn a_folder_read_again_after_its_own_directory_went_retires_with_what_was_in_it() {
        let (conn, root) = library("again-gone");
        write(&root.join("Trips/a.jpg"), "a");
        write(&root.join("People/c.jpg"), "c");
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");

        std::fs::remove_dir_all(root.join("Trips")).unwrap();
        reconcile_folder(&conn, trips).unwrap();

        assert!(!live(&conn, trips));
        assert_eq!(names(&conn), ["c.jpg"]);
    }

    #[test]
    fn a_folder_in_a_source_that_cannot_be_read_is_left_as_it_was() {
        let (conn, root) = library("again-offline");
        write(&root.join("Trips/a.jpg"), "a");
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");

        std::fs::remove_dir_all(&root).unwrap();
        reconcile_folder(&conn, trips).unwrap();

        assert!(live(&conn, trips));
        assert_eq!(names(&conn), ["a.jpg"]);
    }

    /// Writing the same number of bytes within the same second would leave
    /// size and mtime unchanged, and the walk would rightly call it unchanged.
    fn filetime_bump(path: &Path) {
        let meta = std::fs::metadata(path).unwrap();
        let later = meta.modified().unwrap() + std::time::Duration::from_secs(2);
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(later).unwrap();
    }
}
