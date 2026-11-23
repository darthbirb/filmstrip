//! Reads each source's tree into the index and retires what it did not find.
//! DECISIONS.md "A walk only judges what it read".
//! Gap: DECISIONS.md "Renames made while the app was closed".

use std::collections::{HashMap, HashSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::Connection;
use walkdir::WalkDir;

use crate::db::items::NewItem;
use crate::db::{folders, items, sources};
use crate::error::Result;
use crate::fs::paths;

/// Windows and macOS litter; never library content.
pub(crate) const IGNORED_FILES: &[&str] = &["thumbs.db", "desktop.ini", ".ds_store"];

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

/// A dot-name, or an entry Windows marks hidden or system.
pub(crate) fn is_hidden(name: &OsStr, meta: Option<&std::fs::Metadata>) -> bool {
    name.to_string_lossy().starts_with('.') || meta.is_some_and(marked_hidden)
}

#[cfg(windows)]
fn marked_hidden(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM};
    meta.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
}

#[cfg(not(windows))]
fn marked_hidden(_: &std::fs::Metadata) -> bool {
    false
}

fn is_hidden_entry(entry: &walkdir::DirEntry) -> bool {
    is_hidden(entry.file_name(), entry.metadata().ok().as_ref())
}

/// The Recycle Bin a drive keeps at its root, where Delete sends the library's own files: a source
/// at a drive's root would otherwise take them in again. DECISIONS.md "The Trash is the Recycle Bin".
fn is_recycle_bin(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("$Recycle.Bin"))
        && path.parent().is_some_and(|drive| drive.parent().is_none())
}

/// One step of reading a tree: an entry found, or a place that could not be read, named when the
/// walker knows which.
pub(crate) enum Read {
    Entry(walkdir::DirEntry),
    Unread(Option<PathBuf>),
}

/// How a tree is read: [`read_tree`], or in a test, a tree read with failures in it.
type Reader<'a> = &'a dyn Fn(&Path) -> Box<dyn Iterator<Item = Read>>;

/// A tree as the walk reads it, leaving out hidden entries, a drive's Recycle Bin, and the app's
/// own directory should a root contain it.
fn read_tree(root: &Path) -> Box<dyn Iterator<Item = Read>> {
    let app_data = crate::config::app_data_dir().ok();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(move |e| {
            (e.depth() == 0 || !is_hidden_entry(e))
                && !is_recycle_bin(e.path())
                && !app_data
                    .as_deref()
                    .is_some_and(|dir| e.path().starts_with(dir))
        });
    Box::new(walker.map(|read| match read {
        Ok(entry) => Read::Entry(entry),
        Err(err) => {
            eprintln!("could not read: {err}");
            Read::Unread(err.path().map(Path::to_path_buf))
        }
    }))
}

/// What reading one tree found: a folder for each directory, its files, and the folders whose
/// subtrees it could not read in full.
struct Mirrored {
    folder_ids: HashMap<PathBuf, i64>,
    files: Vec<PathBuf>,
    unread: Vec<i64>,
}

/// Mirrors a tree's directories into folders and collects its files.
fn mirror(
    conn: &Connection,
    source_root: &Path,
    root_folder_id: i64,
    tree: Box<dyn Iterator<Item = Read>>,
) -> Result<Mirrored> {
    let mut folder_ids = HashMap::from([(source_root.to_path_buf(), root_folder_id)]);
    let mut files = Vec::new();
    let mut unread = Vec::new();

    for read in tree {
        let entry = match read {
            Read::Entry(entry) => entry,
            Read::Unread(at) => {
                unread.push(unread_folder(&folder_ids, at.as_deref(), root_folder_id));
                continue;
            }
        };
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
    Ok(Mirrored {
        folder_ids,
        files,
        unread,
    })
}

/// The folder a failed read leaves unjudged: the directory it names, else the one holding what it
/// names, else the whole tree.
fn unread_folder(folder_ids: &HashMap<PathBuf, i64>, at: Option<&Path>, root_folder: i64) -> i64 {
    at.and_then(|path| {
        folder_ids
            .get(path)
            .or_else(|| path.parent().and_then(|parent| folder_ids.get(parent)))
    })
    .copied()
    .unwrap_or(root_folder)
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

    let id = record_new(conn, name, size, mtime, folder_id, source_id)?;
    let uuid: String = conn.query_row(
        "SELECT uuid FROM item WHERE id = ?1",
        rusqlite::params![id],
        |r| r.get(0),
    )?;
    items::mark_seen(conn, &uuid)?;
    Ok(Outcome::Indexed)
}

/// A file the app is putting in a folder itself under `name`, recorded as a walk would record it,
/// from `file` as it is now. No walk is sweeping meanwhile: both hold the turn.
pub(crate) fn index_arrival(
    conn: &Connection,
    file: &Path,
    name: &str,
    folder_id: i64,
    source_id: i64,
) -> Result<i64> {
    let meta = std::fs::metadata(file)?;
    record_new(
        conn,
        name.to_string(),
        meta.len() as i64,
        mtime_secs(&meta),
        folder_id,
        source_id,
    )
}

fn record_new(
    conn: &Connection,
    name: String,
    size: i64,
    mtime: i64,
    folder_id: i64,
    source_id: i64,
) -> Result<i64> {
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
    Ok(id)
}

/// Brings the index back in line with what is on disk.
pub fn reconcile(conn: &Connection) -> Result<WalkReport> {
    reconcile_list(conn, sources::list(conn)?, &|| false, &read_tree).map(Option::unwrap_or_default)
}

/// As [`reconcile`], stopping before the next source or directory once `halt` says so, having
/// retired nothing in the source it stopped in; `None` when it stopped.
pub fn reconcile_until(conn: &Connection, halt: &dyn Fn() -> bool) -> Result<Option<WalkReport>> {
    reconcile_list(conn, sources::list(conn)?, halt, &read_tree)
}

/// A source the pass read, and the folders in it at or under one it could not read in full.
struct Walk {
    source_id: i64,
    root: PathBuf,
    kept: HashSet<i64>,
}

enum Walked {
    Read(HashSet<i64>),
    Halted,
    Away,
}

/// The pass itself, over the sources it listed when it started.
fn reconcile_list(
    conn: &Connection,
    listed: Vec<sources::Source>,
    halt: &dyn Fn() -> bool,
    read: Reader,
) -> Result<Option<WalkReport>> {
    let mut report = WalkReport::default();
    let mut walked: Vec<Walk> = Vec::new();

    for source in listed {
        if halt() {
            return Ok(None);
        }
        let root = PathBuf::from(&source.root);
        if !root.is_dir() {
            continue; // unreachable, so nothing here can be judged
        }
        let turn = super::turn();
        let walked_one = walk_source(conn, &source, &mut report, halt, read);
        drop(turn);
        match walked_one {
            Ok(Walked::Read(kept)) => walked.push(Walk {
                source_id: source.id,
                root,
                kept,
            }),
            Ok(Walked::Away) => {}
            Ok(Walked::Halted) => return Ok(None),
            // Removed while this pass ran: it took its folders with it, and the rest still walk.
            Err(err) => {
                if sources::get(conn, source.id)?.is_some() {
                    return Err(err);
                }
            }
        }
    }

    let _turn = super::turn();
    report.folders_retired = retire_vanished_folders(conn, &walked)?;
    Ok(Some(report))
}

/// One source: its directories mirrored, its files recorded, and what vanished from what it read
/// retired. Nothing is retired when `halt` stopped it first, or when its root was not there to be
/// read in full.
fn walk_source(
    conn: &Connection,
    source: &sources::Source,
    report: &mut WalkReport,
    halt: &dyn Fn() -> bool,
    read: Reader,
) -> Result<Walked> {
    let root = PathBuf::from(&source.root);
    let root_folder = folders::source_root_folder(conn, source.id)?;

    items::begin_sweep(conn)?;
    let Some(unread) = record_all(conn, &root, root_folder, source.id, report, halt, read)? else {
        return Ok(Walked::Halted);
    };
    if !root.is_dir() || unread.contains(&root_folder) {
        return Ok(Walked::Away);
    }
    let kept = folders::at_or_under(conn, &unread)?;
    report.items_retired += items::finish_sweep(conn, source.id, &kept)?;
    sources::mark_indexed(conn, source.id)?;
    Ok(Walked::Read(kept))
}

/// Every directory under `dir` mirrored into folders under `folder_id`, and every file recorded,
/// with the folders it could not read in full; `None` when `halt` stopped it before a directory's
/// files.
fn record_all(
    conn: &Connection,
    dir: &Path,
    folder_id: i64,
    source_id: i64,
    report: &mut WalkReport,
    halt: &dyn Fn() -> bool,
    read: Reader,
) -> Result<Option<Vec<i64>>> {
    let Mirrored {
        folder_ids,
        files,
        unread,
    } = mirror(conn, dir, folder_id, read(dir))?;
    let mut reading: Option<&Path> = None;
    for file in &files {
        let parent = file.parent();
        if parent != reading {
            if halt() {
                return Ok(None);
            }
            reading = parent;
        }
        let Some(folder_id) = parent.and_then(|p| folder_ids.get(p)).copied() else {
            continue;
        };
        match record_file(conn, file, folder_id, source_id) {
            Ok(Outcome::Unchanged) => report.unchanged += 1,
            Ok(Outcome::Indexed) => report.indexed += 1,
            Err(err) => {
                eprintln!("could not index {}: {err}", file.display());
                keep_unread(conn, file, folder_id)?;
            }
        }
    }
    Ok(Some(unread))
}

/// A file found but not read keeps the row it had.
fn keep_unread(conn: &Connection, file: &Path, folder_id: i64) -> Result<()> {
    let name = file.file_name().unwrap_or_default().to_string_lossy();
    if let Some(existing) = items::existing_by_disk_name(conn, folder_id, &name)?
        && !existing.deleted
    {
        items::mark_seen(conn, &existing.uuid)?;
    }
    Ok(())
}

/// One folder read again, as the whole walk reads a source, judging nothing outside its subtree.
/// A folder in an unreachable source is left as it is; one whose own directory is gone retires.
pub fn reconcile_folder(conn: &Connection, folder_id: i64) -> Result<WalkReport> {
    reconcile_folder_with(conn, folder_id, &read_tree)
}

fn reconcile_folder_with(conn: &Connection, folder_id: i64, read: Reader) -> Result<WalkReport> {
    let _turn = super::turn();
    let mut report = WalkReport::default();
    if !folders::is_live(conn, folder_id)? {
        return Ok(report);
    }
    let source_id = folders::location(conn, folder_id)?.source_id;
    let Some(source) = sources::get(conn, source_id)? else {
        return Ok(report);
    };
    let root = Path::new(&source.root);
    if !root.is_dir() {
        return Ok(report);
    }
    let dir = paths::folder_dir(conn, folder_id)?;
    items::begin_sweep(conn)?;
    let unread = if dir.is_dir() {
        let read = record_all(
            conn,
            &dir,
            folder_id,
            source_id,
            &mut report,
            &|| false,
            read,
        )?;
        let Some(unread) = read else {
            return Ok(report);
        };
        unread
    } else {
        Vec::new()
    };
    if !root.is_dir() {
        return Ok(report);
    }
    let kept = folders::at_or_under(conn, &unread)?;
    report.items_retired += items::finish_sweep_under(conn, folder_id, &kept)?;
    report.folders_retired = if dir.is_dir() {
        retire_gone(conn, root, folders::descendants(conn, folder_id)?, &kept)?
    } else {
        folders::trash_subtree(conn, folder_id)?
    };
    Ok(report)
}

/// Retires folders whose directory is gone, **only in sources this pass read**, and none in a
/// subtree it could not.
fn retire_vanished_folders(conn: &Connection, walked: &[Walk]) -> Result<i64> {
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

    let mut by_source: HashMap<i64, Vec<i64>> = HashMap::new();
    for folder_id in candidates {
        let source_id = folders::location(conn, folder_id)?.source_id;
        by_source.entry(source_id).or_default().push(folder_id);
    }
    let mut retired = 0;
    for walk in walked {
        let read = by_source.remove(&walk.source_id).unwrap_or_default();
        retired += retire_gone(conn, &walk.root, read, &walk.kept)?;
    }
    Ok(retired)
}

/// Retires each folder, in the order given, whose directory is no longer there while its source's
/// root still is, but none in `kept`.
fn retire_gone(
    conn: &Connection,
    root: &Path,
    candidates: Vec<i64>,
    kept: &HashSet<i64>,
) -> Result<i64> {
    let mut retired = 0;
    for folder_id in candidates {
        if kept.contains(&folder_id) {
            continue;
        }
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
        if !paths::folder_dir(conn, folder_id)?.is_dir() && root.is_dir() {
            retired += folders::trash_subtree(conn, folder_id)?;
        }
    }
    Ok(retired)
}

#[cfg(test)]
pub(crate) mod tests {
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

        let report = reconcile_list(&conn, listed, &|| false, &read_tree)
            .unwrap()
            .unwrap();
        assert_eq!(report.indexed, 1);
        assert_eq!(
            live_items(&conn).len(),
            1,
            "the source still there was walked"
        );
    }

    #[test]
    fn a_walk_asked_to_halt_stops_before_the_next_source_and_retires_nothing() {
        let (conn, root) = library("halted");
        write(&root.join("first.jpg"), "a");
        let second = scratch("halted-second");
        write(&second.join("second.jpg"), "b");
        sources::add(&conn, &second, "Second", SourceKind::Library).unwrap();
        let asked = std::cell::Cell::new(0);
        let halt = || {
            asked.set(asked.get() + 1);
            asked.get() > 2
        };

        assert_eq!(reconcile_until(&conn, &halt).unwrap(), None);
        assert_eq!(
            live_items(&conn),
            [(
                "first.jpg".to_string(),
                folders::source_root_folder(&conn, 1).unwrap()
            )]
        );
        assert!(reconcile_until(&conn, &|| false).unwrap().is_some());
        assert_eq!(live_items(&conn).len(), 2);
    }

    #[test]
    fn a_walk_asked_to_halt_stops_before_the_next_directory_and_retires_nothing_unread() {
        let (conn, root) = library("halted-directory");
        write(&root.join("A/a.jpg"), "a");
        write(&root.join("B/b.jpg"), "b");
        reconcile(&conn).unwrap();
        write(&root.join("A/a2.jpg"), "a2");
        write(&root.join("B/b2.jpg"), "b2");
        std::fs::remove_file(root.join("B/b.jpg")).unwrap();
        let asked = std::cell::Cell::new(0);
        let halt = || {
            asked.set(asked.get() + 1);
            asked.get() > 2
        };

        assert_eq!(reconcile_until(&conn, &halt).unwrap(), None);
        let names: Vec<String> = live_items(&conn).into_iter().map(|(n, _)| n).collect();
        assert_eq!(
            names,
            ["a.jpg", "a2.jpg", "b.jpg"],
            "A was read and B was not, so nothing in B is judged"
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
    fn a_case_only_rename_of_a_non_ascii_folder_keeps_its_row_and_its_files_tags() {
        let (conn, root) = library("case-only");
        write(&root.join("Ägypten/nile.jpg"), "a");
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let egypt = folders::child_id(&conn, top, "Ägypten").unwrap().unwrap();
        let nile: i64 = conn
            .query_row("SELECT id FROM item", [], |r| r.get(0))
            .unwrap();
        db::tags::add_item_tag(&conn, nile, "river").unwrap();

        std::fs::rename(root.join("Ägypten"), root.join("ägypten")).unwrap();
        let report = reconcile(&conn).unwrap();

        assert_eq!((report.folders_retired, report.items_retired), (0, 0));
        assert_eq!(
            folders::child_id(&conn, top, "ägypten").unwrap(),
            Some(egypt)
        );
        assert_eq!(live_items(&conn), [("nile.jpg".to_string(), egypt)]);
        let tags: Vec<String> = db::tags::item_effective_tags(&conn, nile)
            .unwrap()
            .into_iter()
            .map(|tag| tag.value)
            .collect();
        assert!(tags.contains(&"river".to_string()), "{tags:?}");
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

    /// Adds `attribute` to what `path` already carries, as Explorer's Properties would.
    #[cfg(windows)]
    pub(crate) fn mark(path: &Path, attribute: u32) {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::SetFileAttributesW;
        let wide = crate::fs::noclobber::verbatim(path).unwrap();
        let carried = std::fs::metadata(path).unwrap().file_attributes();
        // SAFETY: `wide` is a NUL-terminated wide string that outlives the call.
        let done = unsafe { SetFileAttributesW(wide.as_ptr(), carried | attribute) };
        assert_ne!(done, 0, "{}", std::io::Error::last_os_error());
    }

    #[cfg(windows)]
    #[test]
    fn what_windows_marks_hidden_or_system_is_not_library_content() {
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
        };
        let (conn, root) = library("hidden-attribute");
        write(&root.join("real.jpg"), "a");
        write(&root.join("hidden.jpg"), "h");
        write(&root.join("system.jpg"), "s");
        write(&root.join("Private/inside.jpg"), "p");
        mark(&root.join("hidden.jpg"), FILE_ATTRIBUTE_HIDDEN);
        mark(&root.join("system.jpg"), FILE_ATTRIBUTE_SYSTEM);
        mark(&root.join("Private"), FILE_ATTRIBUTE_HIDDEN);
        // A drive's root carries both, and is still read.
        mark(&root, FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM);

        reconcile(&conn).unwrap();
        assert_eq!(names(&conn), ["real.jpg"]);
        assert_eq!(folders::child_id(&conn, 1, "Private").unwrap(), None);
    }

    /// Reads the tree as [`read_tree`] does, but `unreadable` fails to open: nothing beneath it
    /// is found, and the walker says so.
    fn failing_at(unreadable: PathBuf) -> impl Fn(&Path) -> Box<dyn Iterator<Item = Read>> {
        move |dir: &Path| -> Box<dyn Iterator<Item = Read>> {
            let unreadable = unreadable.clone();
            Box::new(read_tree(dir).flat_map(move |read| match read {
                Read::Entry(entry) if entry.path() == unreadable => {
                    vec![Read::Entry(entry), Read::Unread(Some(unreadable.clone()))]
                }
                Read::Entry(entry) if entry.path().starts_with(&unreadable) => vec![],
                read => vec![read],
            }))
        }
    }

    #[test]
    fn a_directory_that_cannot_be_read_keeps_everything_beneath_it() {
        let (conn, root) = library("unreadable");
        write(&root.join("Trips/a.jpg"), "a");
        write(&root.join("Trips/Cairo/b.jpg"), "b");
        write(&root.join("People/c.jpg"), "c");
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");
        let cairo = folder_under(&conn, trips, "Cairo");

        // Under a directory that cannot be opened, what lies beneath reads as not there.
        std::fs::remove_dir_all(root.join("Trips/Cairo")).unwrap();
        std::fs::remove_file(root.join("People/c.jpg")).unwrap();
        let read = failing_at(root.join("Trips"));
        let report = reconcile_list(&conn, sources::list(&conn).unwrap(), &|| false, &read)
            .unwrap()
            .unwrap();

        assert_eq!(names(&conn), ["a.jpg", "b.jpg"], "People was read in full");
        assert!(live(&conn, trips) && live(&conn, cairo));
        assert_eq!((report.items_retired, report.folders_retired), (1, 0));
    }

    #[test]
    fn a_failure_the_walker_cannot_place_keeps_the_whole_source() {
        let (conn, root) = library("unplaced");
        write(&root.join("Trips/a.jpg"), "a");
        reconcile(&conn).unwrap();
        let stamped = indexed_at(&conn);

        std::fs::remove_dir_all(root.join("Trips")).unwrap();
        let read = |dir: &Path| -> Box<dyn Iterator<Item = Read>> {
            Box::new(read_tree(dir).chain([Read::Unread(None)]))
        };
        let report = reconcile_list(&conn, sources::list(&conn).unwrap(), &|| false, &read)
            .unwrap()
            .unwrap();

        assert_eq!(names(&conn), ["a.jpg"]);
        assert_eq!((report.items_retired, report.folders_retired), (0, 0));
        assert_eq!(indexed_at(&conn), stamped, "it was not read in full");
    }

    /// The pass asks `halt` before each source and before each directory's files.
    #[test]
    fn a_drive_lost_mid_walk_changes_nothing() {
        let (conn, root) = library("lost-mid-walk");
        write(&root.join("Trips/a.jpg"), "a");
        write(&root.join("Trips/Cairo/b.jpg"), "b");
        reconcile(&conn).unwrap();
        let before = live_items(&conn);
        let stamped = indexed_at(&conn);
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");
        let cairo = folder_under(&conn, trips, "Cairo");

        let asked = std::cell::Cell::new(0);
        let halt = || {
            asked.set(asked.get() + 1);
            if asked.get() == 2 {
                std::fs::remove_dir_all(&root).unwrap();
            }
            false
        };
        let report = reconcile_until(&conn, &halt).unwrap().unwrap();

        assert_eq!(live_items(&conn), before);
        assert!(live(&conn, trips) && live(&conn, cairo));
        assert_eq!((report.items_retired, report.folders_retired), (0, 0));
        assert_eq!(indexed_at(&conn), stamped);
    }

    #[test]
    fn a_file_found_but_not_read_keeps_its_row_until_a_walk_reads_its_absence() {
        let (conn, root) = library("found-not-read");
        write(&root.join("Trips/a.jpg"), "a");
        write(&root.join("Trips/b.jpg"), "b");
        reconcile(&conn).unwrap();

        // Asked before the source, then before Trips' files: a.jpg goes after the tree was listed.
        let asked = std::cell::Cell::new(0);
        let halt = || {
            asked.set(asked.get() + 1);
            if asked.get() == 2 {
                std::fs::remove_file(root.join("Trips/a.jpg")).unwrap();
            }
            false
        };
        reconcile_until(&conn, &halt).unwrap().unwrap();
        assert_eq!(names(&conn), ["a.jpg", "b.jpg"]);

        reconcile(&conn).unwrap();
        assert_eq!(names(&conn), ["b.jpg"]);
    }

    #[test]
    fn a_drive_lost_after_its_walk_keeps_its_folders() {
        let (conn, root) = library("lost-after-walk");
        write(&root.join("Trips/a.jpg"), "a");
        let second = scratch("lost-after-walk-second");
        write(&second.join("b.jpg"), "b");
        sources::add(&conn, &second, "Second", SourceKind::Library).unwrap();
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");

        // Asked before the first source, its one directory, then the second source.
        let asked = std::cell::Cell::new(0);
        let halt = || {
            asked.set(asked.get() + 1);
            if asked.get() == 3 {
                std::fs::remove_dir_all(&root).unwrap();
            }
            false
        };
        let report = reconcile_until(&conn, &halt).unwrap().unwrap();

        assert!(live(&conn, trips));
        assert_eq!(names(&conn), ["a.jpg", "b.jpg"]);
        assert_eq!((report.items_retired, report.folders_retired), (0, 0));
    }

    #[test]
    fn a_drives_recycle_bin_is_not_library_content_and_a_folder_named_so_elsewhere_is() {
        assert!(is_recycle_bin(Path::new(r"D:\$Recycle.Bin")));
        assert!(is_recycle_bin(Path::new(r"\\?\D:\$RECYCLE.BIN")));
        assert!(!is_recycle_bin(Path::new(r"D:\Photos\$Recycle.Bin")));
        assert!(!is_recycle_bin(Path::new(r"D:\Photos")));
    }

    /// An unplugged drive is not a mass deletion.
    #[test]
    fn an_unreachable_source_keeps_everything_it_had() {
        let (conn, root) = library("unreachable");
        write(&root.join("Trips/a.jpg"), "a");
        reconcile(&conn).unwrap();
        let before = live_items(&conn).len();
        let stamped = indexed_at(&conn);

        std::fs::remove_dir_all(&root).unwrap();
        let report = reconcile(&conn).unwrap();

        assert_eq!(
            report,
            WalkReport::default(),
            "nothing was walked, so nothing is judged"
        );
        assert_eq!(live_items(&conn).len(), before, "its items are still there");
        assert_eq!(
            indexed_at(&conn),
            stamped,
            "it was last indexed when it was read"
        );
    }

    #[test]
    fn a_walk_stamps_the_source_it_read() {
        let (conn, root) = library("stamped");
        write(&root.join("a.jpg"), "a");
        assert_eq!(indexed_at(&conn), None, "never read yet");

        reconcile(&conn).unwrap();
        assert!(indexed_at(&conn).is_some());
    }

    fn indexed_at(conn: &Connection) -> Option<i64> {
        sources::list(conn).unwrap()[0].indexed_at
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

    #[test]
    fn reading_a_folder_again_keeps_a_subdirectory_it_cannot_read_and_judges_its_sibling() {
        let (conn, root) = library("again-unreadable");
        write(&root.join("Trips/a.jpg"), "a");
        write(&root.join("Trips/Cairo/Day 1/b.jpg"), "b");
        write(&root.join("Trips/Luxor/c.jpg"), "c");
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");
        let cairo = folder_under(&conn, trips, "Cairo");
        let day_1 = folder_under(&conn, cairo, "Day 1");
        let luxor = folder_under(&conn, trips, "Luxor");

        // Under a directory that cannot be opened, what lies beneath reads as not there.
        std::fs::remove_dir_all(root.join("Trips/Cairo/Day 1")).unwrap();
        std::fs::remove_dir_all(root.join("Trips/Luxor")).unwrap();
        let read = failing_at(root.join("Trips/Cairo"));
        let report = reconcile_folder_with(&conn, trips, &read).unwrap();

        assert_eq!(names(&conn), ["a.jpg", "b.jpg"], "Luxor was read in full");
        assert!(live(&conn, cairo) && live(&conn, day_1));
        assert!(!live(&conn, luxor));
        assert_eq!((report.items_retired, report.folders_retired), (1, 1));
    }

    #[test]
    fn reading_a_folder_again_as_its_drive_goes_retires_nothing() {
        let (conn, root) = library("again-lost");
        write(&root.join("Trips/a.jpg"), "a");
        write(&root.join("Trips/Cairo/b.jpg"), "b");
        reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folder_under(&conn, top, "Trips");
        let cairo = folder_under(&conn, trips, "Cairo");

        // The drive goes as the listing ends, before it reached Cairo.
        let gone = root.clone();
        let read = move |dir: &Path| -> Box<dyn Iterator<Item = Read>> {
            let cut = dir.join("Cairo");
            let listed: Vec<Read> = read_tree(dir)
                .filter(|read| !matches!(read, Read::Entry(e) if e.path().starts_with(&cut)))
                .collect();
            std::fs::remove_dir_all(&gone).unwrap();
            Box::new(listed.into_iter())
        };
        let report = reconcile_folder_with(&conn, trips, &read).unwrap();

        assert_eq!(names(&conn), ["a.jpg", "b.jpg"]);
        assert!(live(&conn, trips) && live(&conn, cairo));
        assert_eq!((report.items_retired, report.folders_retired), (0, 0));
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
