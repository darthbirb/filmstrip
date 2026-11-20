//! The Trash: what the library sent to the Windows Recycle Bin, on its own drive, until it is taken
//! back. Sending one there is journalled, so it can be undone.
//! DECISIONS.md "The Trash is the Recycle Bin".

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::items::{ItemFile, ItemRow};
use crate::db::journal::ItemRestored;
use crate::db::{folders, in_transaction, items, journal, now, recycling, sources, tags};
use crate::error::{AppError, Reason, Result};
use crate::fs::recycle::{self, Bin, Sent, Shell};
use crate::fs::stayed::{self, Stayed};
use crate::fs::{paths, relocate};

/// What sending several items to the trash did: how many went, and each one that did not, with why.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TrashReport {
    pub trashed: u32,
    pub refused: Vec<Stayed>,
}

/// A file in the trash, when it went, and the folder it left.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Trashed {
    #[serde(flatten)]
    pub row: ItemRow,
    pub trashed_at: i64,
    pub from: Origin,
}

/// The folder a trashed file left, named from its source's own folder down. `gone` when neither
/// it nor a folder at its place is live, so Restore would be refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Origin {
    pub folder_id: i64,
    pub path: Vec<String>,
    pub gone: bool,
}

/// Everything in the trash, the most recent first.
pub fn listing(conn: &Connection) -> Result<Vec<Trashed>> {
    items::in_trash(conn)?
        .into_iter()
        .map(|(row, trashed_at)| {
            Ok(Trashed {
                from: origin(conn, row.folder_id)?,
                row,
                trashed_at,
            })
        })
        .collect()
}

/// A folder named from its source's own folder down, and whether it or one at its place is live.
pub fn origin(conn: &Connection, folder_id: i64) -> Result<Origin> {
    Ok(Origin {
        folder_id,
        path: folders::ancestry(conn, folder_id)?
            .into_iter()
            .map(|crumb| crumb.title)
            .collect(),
        gone: folders::live_at(conn, folder_id)?.is_none(),
    })
}

/// Sends each item to the trash under one batch, so one undo brings the whole selection back.
pub fn trash_items(conn: &Connection, item_ids: &[i64], batch_id: &str) -> Result<TrashReport> {
    let _turn = super::turn();
    let mut report = TrashReport::default();
    for &item_id in item_ids {
        match trash_unjournalled(conn, item_id, Some(batch_id)) {
            Ok(()) => report.trashed += 1,
            Err(err) => report.refused.push(stayed::file(conn, item_id, &err)?),
        }
    }
    Ok(report)
}

/// Sends one item's file to the Recycle Bin and records where the bin keeps it. A file gone from
/// where the index has it is refused, and the next walk retires it; one the bin will not take, or
/// on a drive with no bin and never sent, stays. DECISIONS.md "Sending to the Recycle Bin".
pub(super) fn trash_unjournalled(
    conn: &Connection,
    item_id: i64,
    batch_id: Option<&str>,
) -> Result<()> {
    if !items::is_live(conn, item_id)? {
        return Err(AppError::invalid("that file is no longer in the index"));
    }
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    if !from.is_file() {
        return Err(AppError::refused(Reason::NotOnDisk {
            name: file.disk_name,
        }));
    }
    if let Some(drive) = Shell.binless(&from) {
        return Err(AppError::refused(Reason::NoBin { drive }));
    }
    recycling::add(conn, &from)?;
    let sent = recycle::send(&Shell, &from)?;
    recycling::settled(conn, &from)?;
    let binned = match sent {
        Sent::Recycled(binned) => binned,
        Sent::Gone => {
            return Err(AppError::refused(Reason::NotOnDisk {
                name: file.disk_name,
            }));
        }
        Sent::Refused => return Err(AppError::refused(Reason::BinRefused)),
    };

    let recorded = in_transaction(conn, |tx| {
        items::send_to_trash(tx, item_id)?;
        items::set_binned(tx, item_id, &binned.path.to_string_lossy(), &binned.file)?;
        if let Some(batch_id) = batch_id {
            journal::record_item_trash(tx, batch_id, item_id)?;
        }
        Ok(())
    });
    if recorded.is_err() && relocate::relocate(&binned.path, &from).is_ok() {
        let_go(&binned.path);
    }
    recorded
}

/// Settles what each send from a library folder left beside its file when the app stopped during
/// it, once that folder can be reached. DECISIONS.md "Sending to the Recycle Bin".
pub fn settle_unfinished_send(conn: &Connection) -> Result<()> {
    for file in recycling::unsettled(conn)? {
        if !file.parent().is_some_and(Path::is_dir) {
            continue;
        }
        match recycle::settle_beside(&file) {
            Ok(()) => recycling::settled(conn, &file)?,
            Err(err) => eprintln!("recycle: {} was not settled: {err}", file.display()),
        }
    }
    Ok(())
}

/// Where a trashed item's file is now.
enum Found {
    /// Still in the Recycle Bin, under this name.
    Bin(PathBuf),
    /// Back at its own path, put back from Explorer.
    Back,
    /// Emptied from the bin outside the app.
    Gone,
    /// On a drive that is away, or another volume stands at its letter, so neither can be told.
    Away,
}

/// Looks for a trashed item's file by the file itself: in the bin where it went, or back where it
/// came from. One the bin has no record of is gone, as a file the app's own trash folder held is.
fn find(conn: &Connection, item_id: i64, file: &ItemFile) -> Result<Found> {
    let Some((binned, itself)) = items::binned(conn, item_id)? else {
        return Ok(Found::Gone);
    };
    let binned = PathBuf::from(binned);
    if recycle::file_at(&binned).as_deref() == Some(itself.as_str()) {
        return Ok(Found::Bin(binned));
    }
    let home = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    if recycle::file_at(&home).as_deref() == Some(itself.as_str()) {
        return Ok(Found::Back);
    }
    match recycle::volume_serial(&binned) {
        Some(volume) if volume == recycle::serial_of(&itself) => Ok(Found::Gone),
        _ => Ok(Found::Away),
    }
}

/// Brings a file back from Explorer into the index, tags and all: live in its folder, or retired
/// there, for the walk to find, while the folder is gone. A row the walk made for it meanwhile, or
/// one retired at its name, describes the same file, and is forgotten. Whether it went live.
fn put_back(conn: &Connection, item_id: i64, file: &ItemFile) -> Result<bool> {
    if let Some(held) = items::existing_by_disk_name(conn, file.folder_id, &file.disk_name)? {
        items::forget(conn, held.id)?;
    }
    if !folders::is_live(conn, file.folder_id)? {
        items::retire_trashed(conn, item_id, now())?;
        return Ok(false);
    }
    items::take_from_trash(conn, item_id)?;
    tags::rebuild_item(conn, item_id)?;
    Ok(true)
}

/// What looking in the Recycle Bin found: rows retired for files emptied from it outside the app,
/// and rows restored for files put back from Explorer.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Looked {
    pub retired: u32,
    pub restored: u32,
}

/// Looks for each trashed item's file in the Recycle Bin, at launch and as the Trash opens: gone
/// from the bin and not back at its path, its row retires; back at its path, it is restored in the
/// index. One on a drive that is away waits. Artboards › The Trash in the Recycle Bin.
pub fn look_in_bin(conn: &Connection) -> Result<Looked> {
    let _turn = super::turn();
    let mut looked = Looked::default();
    for (row, _) in items::in_trash(conn)? {
        let Some(file) = items::file_of(conn, row.id)? else {
            continue;
        };
        match find(conn, row.id, &file)? {
            Found::Bin(_) | Found::Away => {}
            Found::Gone => {
                in_transaction(conn, |tx| items::retire_trashed(tx, row.id, now()))?;
                looked.retired += 1;
            }
            Found::Back => {
                if in_transaction(conn, |tx| put_back(tx, row.id, &file))? {
                    looked.restored += 1;
                } else {
                    looked.retired += 1;
                }
            }
        }
    }
    Ok(looked)
}

/// What restoring several items did: how many came back, and each one that did not, with why.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RestoreReport {
    pub restored: u32,
    pub refused: Vec<Stayed>,
}

/// Takes each item out of the trash under one batch: into the folder it left, or into `to`.
pub fn restore_items(
    conn: &Connection,
    item_ids: &[i64],
    to: Option<i64>,
    batch_id: &str,
) -> Result<RestoreReport> {
    let _turn = super::turn();
    let mut report = RestoreReport::default();
    for &item_id in item_ids {
        match restore_unjournalled(conn, item_id, to, Some(batch_id)) {
            Ok(()) => report.restored += 1,
            Err(err) => report.refused.push(stayed::file(conn, item_id, &err)?),
        }
    }
    Ok(report)
}

/// Takes an item back out of the Recycle Bin under its own name, into `to` or the folder it left or
/// a live one at its place; a name taken there is never changed. One already back at its path is
/// restored where it is; one emptied from the bin has its row retired, and says so.
fn restore_unjournalled(
    conn: &Connection,
    item_id: i64,
    to: Option<i64>,
    batch_id: Option<&str>,
) -> Result<()> {
    if !items::is_trashed(conn, item_id)? {
        return Err(AppError::invalid("that file is not in the trash"));
    }
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let trashed_at = items::trashed_at(conn, item_id)?.unwrap_or_default();
    let binned = match find(conn, item_id, &file)? {
        Found::Bin(binned) => binned,
        Found::Back => {
            return in_transaction(conn, |tx| {
                if put_back(tx, item_id, &file)?
                    && let Some(batch_id) = batch_id
                {
                    let restored = ItemRestored {
                        item_id,
                        left_folder_id: file.folder_id,
                        to_folder_id: file.folder_id,
                        trashed_at,
                    };
                    journal::record_item_restore(tx, batch_id, &restored)?;
                }
                Ok(())
            });
        }
        Found::Gone => {
            let place = folders::title(conn, to.unwrap_or(file.folder_id))?.unwrap_or_default();
            in_transaction(conn, |tx| items::retire_trashed(tx, item_id, now()))?;
            return Err(AppError::refused(Reason::GoneFromBin {
                name: file.disk_name,
                place,
            }));
        }
        Found::Away => {
            return Err(AppError::refused(Reason::Offline {
                source: source_title(conn, file.folder_id),
            }));
        }
    };
    let home = match to {
        Some(folder) if folders::is_live(conn, folder)? => folder,
        Some(_) => return Err(AppError::invalid("that folder is no longer in the index")),
        None => folders::live_at(conn, file.folder_id)?.ok_or_else(|| {
            AppError::refused(Reason::FolderGone {
                name: folders::title(conn, file.folder_id)
                    .ok()
                    .flatten()
                    .unwrap_or_default(),
            })
        })?,
    };
    let taken = || {
        AppError::refused(Reason::NameTaken {
            place: place_name(conn, home),
            name: file.disk_name.clone(),
            folder: false,
        })
    };
    let held = items::existing_by_disk_name(conn, home, &file.disk_name)?;
    if held.as_ref().is_some_and(|row| !row.deleted) {
        return Err(taken());
    }
    let dest = paths::item_path(conn, home, &file.disk_name)?;
    relocate::relocate(&binned, &dest).map_err(relocate::taken_as(taken))?;

    let recorded = in_transaction(conn, |tx| {
        // A retired row holding the name describes a file that is gone; the returning one takes it.
        if let Some(stale) = &held {
            items::forget_retired(tx, stale.id)?;
        }
        if home != file.folder_id {
            items::set_folder(tx, item_id, home, &file.disk_name)?;
        }
        items::take_from_trash(tx, item_id)?;
        tags::rebuild_item(tx, item_id)?;
        if let Some(batch_id) = batch_id {
            let restored = ItemRestored {
                item_id,
                left_folder_id: file.folder_id,
                to_folder_id: home,
                trashed_at,
            };
            journal::record_item_restore(tx, batch_id, &restored)?;
        }
        Ok(())
    });
    match recorded {
        Ok(()) => let_go(&binned),
        Err(_) => {
            let _ = relocate::relocate(&dest, &binned);
        }
    }
    recorded
}

/// Undoes a send to the Recycle Bin: takes the file back out, unless looking in the bin already
/// found it put back from Explorer, which leaves nothing to do, or emptied from it outside the app.
pub(super) fn untrash(conn: &Connection, item_id: i64) -> Result<()> {
    if !items::is_trashed(conn, item_id)?
        && let Some(file) = items::file_of(conn, item_id)?
    {
        if items::is_live(conn, item_id)? {
            return Ok(());
        }
        return Err(AppError::refused(Reason::GoneFromBin {
            name: file.disk_name,
            place: folders::title(conn, file.folder_id)?.unwrap_or_default(),
        }));
    }
    restore_unjournalled(conn, item_id, None, None)
}

/// Has the bin forget what it kept beside a file taken back out of it. The file is already where
/// it belongs, so a record left behind is only said in the log.
fn let_go(binned: &Path) {
    if let Err(err) = Shell.let_go(binned) {
        eprintln!(
            "recycle: the bin's record of {} stays: {err}",
            binned.display()
        );
    }
}

/// Undoes a restore: the file goes back to the Recycle Bin, from the folder it had left and at the
/// moment it first went, so the Trash shows it as it was.
pub(super) fn unrestore(conn: &Connection, restored: &ItemRestored) -> Result<()> {
    trash_unjournalled(conn, restored.item_id, None)?;
    in_transaction(conn, |tx| {
        if restored.left_folder_id != restored.to_folder_id {
            let file = items::file_of(tx, restored.item_id)?
                .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
            items::set_folder(
                tx,
                restored.item_id,
                restored.left_folder_id,
                &file.disk_name,
            )?;
        }
        items::set_trashed_at(tx, restored.item_id, restored.trashed_at)
    })
}

/// A folder as navigation names it: a source's own folder goes by the source's title.
fn place_name(conn: &Connection, folder_id: i64) -> String {
    folders::ancestry(conn, folder_id)
        .ok()
        .and_then(|mut crumbs| crumbs.pop())
        .map(|crumb| crumb.title)
        .unwrap_or_default()
}

/// The title of the source a folder is in.
fn source_title(conn: &Connection, folder_id: i64) -> String {
    folders::location(conn, folder_id)
        .ok()
        .and_then(|location| sources::get(conn, location.source_id).ok().flatten())
        .map(|source| source.title)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, journal};
    use crate::fs::recycle::tests::{Fake, Stand, stand_in, stand_in_as};
    use crate::fs::{acts, undo, walk};

    /// Trips/Cairo holding pyramid.jpg and sphinx.jpg, walked into a real file.
    fn library(name: &str) -> (Connection, PathBuf, i64) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-trash")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("library");
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "p").unwrap();
        std::fs::write(root.join("Trips/Cairo/sphinx.jpg"), "s").unwrap();
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        (conn, root, cairo)
    }

    fn id_of(conn: &Connection, folder_id: i64, name: &str) -> i64 {
        items::existing_by_disk_name(conn, folder_id, name)
            .unwrap()
            .unwrap()
            .id
    }

    /// Where the bin keeps a trashed item's file.
    fn bin_file(conn: &Connection, id: i64) -> PathBuf {
        PathBuf::from(items::binned(conn, id).unwrap().unwrap().0)
    }

    fn cairo_holds(root: &Path, names: &[&str]) {
        crate::fs::settles_to(&root.join("Trips/Cairo"), names);
    }

    /// A stand-in that recycles into `bin` beside the library, but refuses each file named here.
    fn refusing(root: &Path, names: &[&str]) {
        let mut bin = Fake::new(Stand::Recycles(root.parent().unwrap().join("bin")));
        bin.deletes = names.iter().map(|name| (*name).to_owned()).collect();
        stand_in_as(bin);
    }

    #[test]
    fn a_file_goes_to_the_recycle_bin_and_one_undo_brings_it_back_with_its_tags() {
        let (conn, root, cairo) = library("round-trip");
        let bin = stand_in();
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();

        let report = trash_items(&conn, &[pyramid], &batch).unwrap();
        assert_eq!(report.trashed, 1);
        cairo_holds(&root, &["sphinx.jpg"]);
        let binned = bin_file(&conn, pyramid);
        assert!(binned.starts_with(bin.dir().unwrap()));
        assert_eq!(std::fs::read_to_string(&binned).unwrap(), "p");
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert_eq!(items::in_folder(&conn, cairo).unwrap().len(), 1);

        undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "p"
        );
        assert!(!binned.exists());
        assert_eq!(
            bin.let_go.borrow().as_slice(),
            std::slice::from_ref(&binned)
        );
        assert!(items::is_live(&conn, pyramid).unwrap());
        assert_eq!(items::binned(&conn, pyramid).unwrap(), None);
        let carried = tags::item_effective_tags(&conn, pyramid).unwrap();
        assert!(carried.iter().any(|tag| tag.value == "cairo"));
    }

    #[test]
    fn a_new_file_under_a_trashed_ones_name_is_a_new_item_and_the_trashed_one_waits() {
        let (conn, root, cairo) = library("name-freed");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();

        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "another").unwrap();
        walk::reconcile(&conn).unwrap();
        let newcomer = id_of(&conn, cairo, "pyramid.jpg");
        assert_ne!(newcomer, pyramid);
        assert_eq!(look_in_bin(&conn).unwrap(), Looked::default());
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert!(bin_file(&conn, pyramid).is_file());
    }

    #[test]
    fn a_file_whose_name_has_been_taken_since_stays_in_the_bin_and_says_so() {
        let (conn, root, cairo) = library("blocked");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        trash_items(&conn, &[pyramid], &batch).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "another").unwrap();

        let report = undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!(report.files_back, 0);
        assert_eq!(
            report.stayed[0].reason,
            Reason::NameTaken {
                place: "Cairo".into(),
                name: "pyramid.jpg".into(),
                folder: false
            }
        );
        assert_eq!(report.stayed[0].at, stayed::Whereabouts::Trash);
        assert_eq!(
            std::fs::read_to_string(bin_file(&conn, pyramid)).unwrap(),
            "p"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "another"
        );
        assert_eq!(journal::latest_batch(&conn).unwrap(), Some(batch));
    }

    #[test]
    fn the_trash_lists_what_it_holds_newest_first_with_the_folder_each_left() {
        let (conn, root, cairo) = library("listing");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();

        let held = listing(&conn).unwrap();
        let ids: Vec<i64> = held.iter().map(|one| one.row.id).collect();
        assert_eq!(ids, [sphinx, pyramid]);
        assert_eq!(held[0].from.path, ["Library", "Trips", "Cairo"]);
        assert!(!held[0].from.gone);
        assert_eq!(
            items::totals(&conn).unwrap().trash,
            items::Tally { count: 2, bytes: 2 }
        );

        // Its folder gone, the file says so; made again under the same name, it is not.
        std::fs::remove_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();
        assert!(listing(&conn).unwrap()[0].from.gone);
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();
        assert!(!listing(&conn).unwrap()[0].from.gone);
    }

    #[test]
    fn a_trashed_file_is_shown_in_full_from_where_the_bin_keeps_it() {
        let (conn, _, cairo) = library("detail");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();

        let thumbs = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-trash/no-thumbs");
        let detail = crate::commands::detail_of(&conn, pyramid, &thumbs)
            .unwrap()
            .unwrap();
        assert!(detail.trashed_at.is_some());
        assert_eq!(
            detail.folders.last().map(|crumb| crumb.title.as_str()),
            Some("Cairo")
        );
        assert_eq!(Path::new(&detail.path), bin_file(&conn, pyramid));
        let path = crate::commands::last_path(&conn, pyramid).unwrap().unwrap();
        assert_eq!(Path::new(&path), bin_file(&conn, pyramid));
    }

    #[test]
    fn restore_takes_a_file_out_of_the_bin_and_its_undo_sends_it_back_as_it_was() {
        let (conn, root, cairo) = library("restore");
        let bin = stand_in();
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        let went = items::trashed_at(&conn, pyramid).unwrap();
        let binned = bin_file(&conn, pyramid);

        let batch = journal::new_batch();
        let report = restore_items(&conn, &[pyramid], None, &batch).unwrap();
        assert_eq!(report.restored, 1);
        cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        assert!(!binned.exists());
        assert_eq!(
            bin.let_go.borrow().as_slice(),
            std::slice::from_ref(&binned)
        );
        assert!(items::is_live(&conn, pyramid).unwrap());
        assert_eq!(
            crate::fs::acts::describe(&conn, &batch).unwrap().act,
            crate::fs::acts::Act::Restore {
                to: Some("Cairo".into()),
                one: Some("pyramid.jpg".into())
            }
        );

        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        cairo_holds(&root, &["sphinx.jpg"]);
        assert_eq!(
            std::fs::read_to_string(bin_file(&conn, pyramid)).unwrap(),
            "p"
        );
        assert_eq!(items::trashed_at(&conn, pyramid).unwrap(), went);
    }

    #[test]
    fn restore_to_another_folder_leaves_the_trash_remembering_where_the_file_came_from() {
        let (conn, root, cairo) = library("restore-to");
        std::fs::create_dir_all(root.join("People")).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let people = folders::child_id(&conn, top, "People").unwrap().unwrap();
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        let binned = bin_file(&conn, pyramid);

        let batch = journal::new_batch();
        restore_items(&conn, &[pyramid], Some(people), &batch).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("People/pyramid.jpg")).unwrap(),
            "p"
        );
        assert!(!binned.exists());
        assert_eq!(items::folder_of(&conn, pyramid).unwrap(), Some(people));

        undo::undo_batch(&conn, &batch).unwrap();
        assert!(!root.join("People/pyramid.jpg").exists());
        assert!(bin_file(&conn, pyramid).is_file());
        assert_eq!(
            listing(&conn).unwrap()[0].from.path,
            ["Library", "Trips", "Cairo"]
        );
    }

    fn theirs_appears_just_before_the_move() {
        crate::fs::noclobber::just_before_the_next(|to| std::fs::write(to, "theirs").unwrap());
    }

    #[test]
    fn a_restore_onto_a_name_that_appeared_just_before_it_is_refused_and_theirs_kept() {
        let (conn, root, cairo) = library("late-restore");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();

        theirs_appears_just_before_the_move();
        let report = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();
        assert_eq!(report.restored, 0);
        assert_eq!(
            report.refused[0].reason,
            Reason::NameTaken {
                place: "Cairo".into(),
                name: "pyramid.jpg".into(),
                folder: false
            }
        );
        assert_eq!(report.refused[0].at, stayed::Whereabouts::Trash);
        let theirs = std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap();
        assert_eq!(theirs, "theirs");
        assert_eq!(
            std::fs::read_to_string(bin_file(&conn, pyramid)).unwrap(),
            "p"
        );
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert!(stand_in().let_go.borrow().is_empty());
    }

    #[test]
    fn undoing_a_delete_onto_a_name_that_appeared_just_before_it_stays_and_theirs_is_kept() {
        let (conn, root, cairo) = library("late-untrash");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        trash_items(&conn, &[pyramid], &batch).unwrap();

        theirs_appears_just_before_the_move();
        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!((back.files_back, back.stayed.len()), (0, 1));
        let theirs = std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap();
        assert_eq!(theirs, "theirs");
        assert_eq!(
            std::fs::read_to_string(bin_file(&conn, pyramid)).unwrap(),
            "p"
        );
    }

    #[test]
    fn a_file_whose_folder_has_gone_stays_until_a_folder_stands_in_its_place_again() {
        let (conn, root, cairo) = library("restore-gone");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        trash_items(&conn, &[pyramid, sphinx], &journal::new_batch()).unwrap();
        std::fs::remove_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();

        let report = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();
        assert_eq!(report.restored, 0);
        assert_eq!(
            report.refused[0].reason,
            Reason::FolderGone {
                name: "Cairo".into()
            }
        );
        assert_eq!(report.refused[0].at, stayed::Whereabouts::Trash);

        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();
        let report = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();
        assert_eq!(report.restored, 1, "{:?}", report.refused);
        assert!(root.join("Trips/Cairo/pyramid.jpg").is_file());
    }

    fn still_in_cairo(at: &stayed::Whereabouts) -> bool {
        matches!(at, stayed::Whereabouts::Folder { path, .. } if path.last().is_some_and(|name| name == "Cairo"))
    }

    #[test]
    fn a_file_the_bin_refuses_stays_where_it_was_and_nothing_is_deleted() {
        for (at, stand) in [("deletes", Stand::Deletes), ("fails", Stand::Fails)] {
            let (conn, root, cairo) = library(&format!("bin-refuses-{at}"));
            let sphinx = id_of(&conn, cairo, "sphinx.jpg");
            stand_in_as(Fake::new(stand));

            let report = trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();

            assert_eq!(report.trashed, 0, "{at}");
            assert_eq!(report.refused.len(), 1);
            assert_eq!(report.refused[0].reason, Reason::BinRefused);
            assert!(still_in_cairo(&report.refused[0].at));
            assert_eq!(
                std::fs::read_to_string(root.join("Trips/Cairo/sphinx.jpg")).unwrap(),
                "s"
            );
            assert!(items::is_live(&conn, sphinx).unwrap());
            assert_eq!(journal::latest_batch(&conn).unwrap(), None);
            assert!(recycling::unsettled(&conn).unwrap().is_empty());
            cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        }
    }

    #[test]
    fn in_a_set_the_bin_refuses_one_and_the_rest_go_under_one_undo() {
        let (conn, root, cairo) = library("bin-refuses-one");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        refusing(&root, &["sphinx"]);
        let batch = journal::new_batch();

        let report = trash_items(&conn, &[pyramid, sphinx], &batch).unwrap();

        assert_eq!(report.trashed, 1);
        assert_eq!(
            (report.refused[0].id, &report.refused[0].reason),
            (sphinx, &Reason::BinRefused)
        );
        cairo_holds(&root, &["sphinx.jpg"]);
        assert!(items::is_trashed(&conn, pyramid).unwrap());

        undo::undo_batch(&conn, &batch).unwrap();
        cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        assert!(items::is_live(&conn, pyramid).unwrap());
    }

    #[test]
    fn a_folders_files_the_bin_refuses_keep_it_until_they_go() {
        let (conn, root, cairo) = library("folder-refused");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let contents = Some(crate::fs::folders::Contents::Trash);
        refusing(&root, &["sphinx"]);

        let report =
            crate::fs::folders::delete(&conn, cairo, contents, &journal::new_batch()).unwrap();
        assert!(!report.deleted);
        assert_eq!(report.refused.len(), 1);
        assert_eq!(
            (report.refused[0].id, &report.refused[0].reason),
            (sphinx, &Reason::BinRefused)
        );
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        cairo_holds(&root, &["sphinx.jpg"]);

        refusing(&root, &[]);
        let report =
            crate::fs::folders::delete(&conn, cairo, contents, &journal::new_batch()).unwrap();
        assert!(report.deleted, "{:?}", report.refused);
        assert!(!root.join("Trips/Cairo").exists());
    }

    #[test]
    fn a_file_emptied_from_the_bin_outside_the_app_is_refused_and_its_row_retires() {
        let (conn, root, cairo) = library("emptied");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        tags::add_item_tag(&conn, pyramid, "dusk").unwrap();
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();

        let report = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();

        assert_eq!(report.restored, 0);
        assert_eq!(
            report.refused,
            [Stayed {
                kind: stayed::Thing::File,
                id: pyramid,
                name: "pyramid.jpg".into(),
                at: stayed::Whereabouts::RecycleBin,
                reason: Reason::GoneFromBin {
                    name: "pyramid.jpg".into(),
                    place: "Cairo".into(),
                },
            }]
        );
        assert!(!items::is_trashed(&conn, pyramid).unwrap());
        assert!(!items::is_live(&conn, pyramid).unwrap());
        assert!(listing(&conn).unwrap().is_empty());
        cairo_holds(&root, &["sphinx.jpg"]);

        // Retired where it was, it keeps its name and tags: the same file back is the same item.
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "p").unwrap();
        walk::reconcile(&conn).unwrap();
        assert!(items::is_live(&conn, pyramid).unwrap());
        let tags = tags::item_effective_tags(&conn, pyramid).unwrap();
        assert!(tags.iter().any(|tag| tag.value == "dusk"));
    }

    #[test]
    fn looking_in_the_bin_retires_what_was_emptied_and_restores_what_was_put_back() {
        let (conn, root, cairo) = library("look");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        tags::add_item_tag(&conn, sphinx, "dusk").unwrap();
        trash_items(&conn, &[pyramid, sphinx], &journal::new_batch()).unwrap();
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();
        std::fs::rename(bin_file(&conn, sphinx), root.join("Trips/Cairo/sphinx.jpg")).unwrap();

        assert_eq!(
            look_in_bin(&conn).unwrap(),
            Looked {
                retired: 1,
                restored: 1
            }
        );

        assert!(!items::is_trashed(&conn, pyramid).unwrap());
        assert!(!items::is_live(&conn, pyramid).unwrap());
        assert!(items::is_live(&conn, sphinx).unwrap());
        assert_eq!(items::folder_of(&conn, sphinx).unwrap(), Some(cairo));
        let tags = tags::item_effective_tags(&conn, sphinx).unwrap();
        assert!(tags.iter().any(|tag| tag.value == "dusk"));
        assert!(listing(&conn).unwrap().is_empty());
        assert_eq!(look_in_bin(&conn).unwrap(), Looked::default());
    }

    #[test]
    fn a_file_put_back_from_explorer_after_a_walk_took_it_in_is_the_item_it_was() {
        let (conn, root, cairo) = library("look-after-walk");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        tags::add_item_tag(&conn, sphinx, "dusk").unwrap();
        trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();
        std::fs::rename(bin_file(&conn, sphinx), root.join("Trips/Cairo/sphinx.jpg")).unwrap();
        walk::reconcile(&conn).unwrap();
        let newcomer = id_of(&conn, cairo, "sphinx.jpg");
        assert_ne!(newcomer, sphinx);

        look_in_bin(&conn).unwrap();

        assert_eq!(id_of(&conn, cairo, "sphinx.jpg"), sphinx);
        assert!(items::file_of(&conn, newcomer).unwrap().is_none());
        let tags = tags::item_effective_tags(&conn, sphinx).unwrap();
        assert!(tags.iter().any(|tag| tag.value == "dusk"));
    }

    #[test]
    fn a_file_put_back_from_explorer_into_a_folder_the_index_has_retired_counts_as_retired() {
        let (conn, root, cairo) = library("look-folder-gone");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        let binned = bin_file(&conn, pyramid);
        std::fs::remove_dir_all(root.join("Trips/Cairo")).unwrap();
        walk::reconcile(&conn).unwrap();
        std::fs::create_dir_all(root.join("Trips/Cairo")).unwrap();
        std::fs::rename(binned, root.join("Trips/Cairo/pyramid.jpg")).unwrap();

        assert_eq!(
            look_in_bin(&conn).unwrap(),
            Looked {
                retired: 1,
                restored: 0
            }
        );
        assert!(!items::is_trashed(&conn, pyramid).unwrap());
    }

    #[test]
    fn a_file_put_back_from_explorer_counts_as_restored() {
        let (conn, root, cairo) = library("restore-put-back");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        std::fs::rename(
            bin_file(&conn, pyramid),
            root.join("Trips/Cairo/pyramid.jpg"),
        )
        .unwrap();

        let report = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();

        assert_eq!((report.restored, report.refused.len()), (1, 0));
        assert!(items::is_live(&conn, pyramid).unwrap());
        assert!(stand_in().let_go.borrow().is_empty());
    }

    #[test]
    fn a_file_another_took_the_bins_name_of_is_gone_and_theirs_is_left() {
        let (conn, root, cairo) = library("bin-name-reused");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        let binned = bin_file(&conn, pyramid);
        std::fs::remove_file(&binned).unwrap();
        std::fs::write(&binned, "another").unwrap();

        let report = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();

        assert_eq!(report.restored, 0);
        assert_eq!(report.refused[0].at, stayed::Whereabouts::RecycleBin);
        assert_eq!(std::fs::read_to_string(&binned).unwrap(), "another");
        cairo_holds(&root, &["sphinx.jpg"]);
    }

    #[test]
    fn an_undo_across_a_send_brings_back_what_is_still_in_the_bin_and_names_what_is_not() {
        let (conn, root, cairo) = library("undo-emptied");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let batch = journal::new_batch();
        trash_items(&conn, &[pyramid, sphinx], &batch).unwrap();
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();

        let report = undo::undo_batch(&conn, &batch).unwrap();

        assert_eq!(report.files_back, 1);
        assert_eq!(report.stayed.len(), 1);
        assert_eq!(report.stayed[0].id, pyramid);
        assert_eq!(report.stayed[0].at, stayed::Whereabouts::RecycleBin);
        cairo_holds(&root, &["sphinx.jpg"]);
        assert!(items::is_live(&conn, sphinx).unwrap());
        assert_eq!(
            journal::latest_batch(&conn).unwrap(),
            None,
            "nothing is left to try again"
        );
    }

    #[test]
    fn an_undo_after_the_trash_found_a_file_emptied_or_put_back_says_so_or_counts_it_back() {
        let (conn, root, cairo) = library("undo-after-look");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let batch = journal::new_batch();
        trash_items(&conn, &[pyramid, sphinx], &batch).unwrap();
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();
        std::fs::rename(bin_file(&conn, sphinx), root.join("Trips/Cairo/sphinx.jpg")).unwrap();
        look_in_bin(&conn).unwrap();

        let report = undo::undo_batch(&conn, &batch).unwrap();

        assert_eq!(report.files_back, 1);
        assert_eq!(report.stayed.len(), 1);
        assert_eq!(report.stayed[0].id, pyramid);
        assert_eq!(
            report.stayed[0].reason,
            Reason::GoneFromBin {
                name: "pyramid.jpg".into(),
                place: "Cairo".into(),
            }
        );
        assert!(items::is_live(&conn, sphinx).unwrap());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
    }

    #[test]
    fn an_undo_of_a_file_the_index_forgot_once_it_was_emptied_says_so_and_leaves_nothing_to_redo() {
        let (conn, root, cairo) = library("undo-forgotten");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        trash_items(&conn, &[pyramid], &batch).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "another").unwrap();
        walk::reconcile(&conn).unwrap();
        let newcomer = id_of(&conn, cairo, "pyramid.jpg");
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();
        assert_eq!(look_in_bin(&conn).unwrap().retired, 1);
        assert!(items::file_of(&conn, pyramid).unwrap().is_none());

        let report = undo::undo_last(&conn).unwrap().unwrap();

        assert_eq!(report.batch.batch_id, batch);
        assert_eq!(
            report.batch.act,
            acts::Act::Delete {
                from: Some("Cairo".into()),
                one: Some("pyramid.jpg".into()),
            }
        );
        assert_eq!(report.files_back, 0);
        assert_eq!(
            report.stayed,
            [Stayed {
                kind: stayed::Thing::File,
                id: pyramid,
                name: "pyramid.jpg".into(),
                at: stayed::Whereabouts::RecycleBin,
                reason: Reason::GoneFromBin {
                    name: "pyramid.jpg".into(),
                    place: "Cairo".into(),
                },
            }]
        );
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
        assert!(items::is_live(&conn, newcomer).unwrap());
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "another"
        );
    }

    /// A drive letter with nothing at it.
    fn free_letter() -> char {
        ('D'..='Z')
            .rev()
            .find(|letter| !Path::new(&format!(r"{letter}:\")).is_dir())
            .expect("a drive letter with nothing at it")
    }

    #[test]
    fn a_file_on_a_drive_that_is_away_or_another_volume_at_its_letter_waits_in_the_trash() {
        let (conn, _root, cairo) = library("away");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        trash_items(&conn, &[pyramid, sphinx], &journal::new_batch()).unwrap();
        let (binned, itself) = items::binned(&conn, pyramid).unwrap().unwrap();
        let away = format!(r"{}:\$Recycle.Bin\$RAWAY.jpg", free_letter());
        items::set_binned(&conn, pyramid, &away, &itself).unwrap();
        let ours = recycle::volume_serial(Path::new(&binned)).unwrap();
        let other = if ours == "1" { "2" } else { "1" };
        let (sphinx_binned, sphinx_itself) = items::binned(&conn, sphinx).unwrap().unwrap();
        std::fs::remove_file(&sphinx_binned).unwrap();
        let index = sphinx_itself.split_once('-').unwrap().1;
        let elsewhere = format!("{other}-{index}");
        items::set_binned(&conn, sphinx, &sphinx_binned, &elsewhere).unwrap();

        assert_eq!(look_in_bin(&conn).unwrap(), Looked::default());
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert!(items::is_trashed(&conn, sphinx).unwrap());

        let report = restore_items(&conn, &[pyramid, sphinx], None, &journal::new_batch()).unwrap();

        assert_eq!(report.restored, 0);
        let offline = Reason::Offline {
            source: "Library".into(),
        };
        assert!(report.refused.iter().all(|one| one.reason == offline));
        assert!(
            report
                .refused
                .iter()
                .all(|one| one.at == stayed::Whereabouts::Trash)
        );
        assert_eq!(listing(&conn).unwrap().len(), 2);
    }

    #[test]
    fn a_trashed_row_the_bin_has_no_record_of_retires_and_nothing_else_is_touched() {
        let (conn, root, cairo) = library("no-record");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let elsewhere = root.parent().unwrap().join("pyramid.jpg");
        std::fs::rename(root.join("Trips/Cairo/pyramid.jpg"), &elsewhere).unwrap();
        items::send_to_trash(&conn, pyramid).unwrap();

        assert_eq!(look_in_bin(&conn).unwrap().retired, 1);

        assert!(!items::is_trashed(&conn, pyramid).unwrap());
        assert_eq!(std::fs::read_to_string(&elsewhere).unwrap(), "p");
    }

    #[test]
    fn a_send_the_app_stopped_during_is_settled_at_launch_and_the_file_is_back() {
        let (conn, root, _) = library("send-cut-short");
        let place = root.join("Trips/Cairo/sphinx.jpg");
        recycling::add(&conn, &place).unwrap();
        std::fs::rename(&place, hold_of(&place)).unwrap();

        settle_unfinished_send(&conn).unwrap();

        assert_eq!(std::fs::read_to_string(&place).unwrap(), "s");
        assert!(!hold_of(&place).exists());
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_send_cut_short_in_a_folder_that_is_away_waits_for_it() {
        let (conn, root, _) = library("send-away");
        let away = root.join("Away/sphinx.jpg");
        recycling::add(&conn, &away).unwrap();

        settle_unfinished_send(&conn).unwrap();

        assert_eq!(recycling::unsettled(&conn).unwrap(), [away]);
    }

    #[test]
    fn a_send_that_fails_partway_keeps_its_marker_for_the_next_launch() {
        let (conn, root, cairo) = library("send-fails");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let place = root.join("Trips/Cairo/sphinx.jpg");
        std::fs::write(hold_of(&place), "another").unwrap();

        let report = trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();

        assert_eq!(report.trashed, 0);
        assert_eq!(std::fs::read_to_string(&place).unwrap(), "s");
        assert_eq!(
            recycling::unsettled(&conn).unwrap(),
            std::slice::from_ref(&place)
        );
        std::fs::remove_file(hold_of(&place)).unwrap();
    }

    fn hold_of(file: &Path) -> PathBuf {
        file.with_file_name(format!(
            ".{}.recycling",
            file.file_name().unwrap().to_string_lossy()
        ))
    }

    #[test]
    fn a_file_no_longer_on_disk_is_not_sent_to_the_bin() {
        let (conn, root, cairo) = library("gone");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        std::fs::remove_file(root.join("Trips/Cairo/sphinx.jpg")).unwrap();

        let report = trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();
        assert_eq!(report.trashed, 0);
        assert_eq!(
            report.refused[0].reason,
            Reason::NotOnDisk {
                name: "sphinx.jpg".into()
            }
        );
        assert!(!items::is_trashed(&conn, sphinx).unwrap());
        assert!(stand_in().asked.borrow().is_empty());
    }
}
