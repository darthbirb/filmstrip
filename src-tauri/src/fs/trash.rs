//! The Trash: what the library sent to the Windows Recycle Bin, on its own drive, until it is taken
//! back. Sending one there is journalled, so it can be undone.
//! DECISIONS.md "The Trash is the Recycle Bin".

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::items::{ItemFile, ItemRow};
use crate::db::journal::{Forgot, ItemRestored, ItemTrashed};
use crate::db::recycling::{self, Sending};
use crate::db::{folders, in_transaction, items, journal, now, sources, tags};
use crate::error::{AppError, Reason, Result};
use crate::fs::paste::Halt;
use crate::fs::recycle::{self, Bin, Binned, Sent, Shell};
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
        path: sources::place_path(conn, folder_id)?,
        gone: folders::live_at(conn, folder_id)?.is_none(),
    })
}

/// Sends each item to the trash under one batch, so one undo brings the whole selection back.
pub fn trash_items(conn: &Connection, item_ids: &[i64], batch_id: &str) -> Result<TrashReport> {
    let _turn = super::turn();
    Ok(trash_each(conn, item_ids, batch_id, &relocate::Unwatched, false)?.report)
}

/// What a delete on the queue did, and why it stopped before the end, if it did.
#[derive(Debug, Default)]
pub struct TrashOutcome {
    pub report: TrashReport,
    pub halted: Option<Halt>,
}

/// `trash_items` one file to a turn of the disk, answering to `control` between them, so each file
/// is in the Recycle Bin or where it was. One already sent under `batch_id`, before a restart, is
/// counted as sent.
pub fn trash_watched(
    conn: &Connection,
    item_ids: &[i64],
    batch_id: &str,
    control: &impl relocate::Control,
) -> Result<TrashOutcome> {
    trash_each(conn, item_ids, batch_id, control, true)
}

fn trash_each(
    conn: &Connection,
    item_ids: &[i64],
    batch_id: &str,
    control: &impl relocate::Control,
    turn_each: bool,
) -> Result<TrashOutcome> {
    let whole = u32::try_from(item_ids.len()).unwrap_or(u32::MAX);
    let sent = sent_under(conn, batch_id)?;
    let mut outcome = TrashOutcome::default();
    control.progress(0, whole);
    for (done, &item_id) in (1..).zip(item_ids) {
        if let Some(halt) = control.halt() {
            outcome.halted = Some(halt);
            break;
        }
        let _turn = turn_each.then(super::turn);
        if sent.contains(&item_id) {
            outcome.report.trashed += 1;
        } else {
            match trash_unjournalled(conn, item_id, Some(batch_id)) {
                Ok(()) => outcome.report.trashed += 1,
                Err(err) => outcome
                    .report
                    .refused
                    .push(stayed::file(conn, item_id, &err)?),
            }
        }
        control.progress(done, whole);
    }
    Ok(outcome)
}

/// The files a batch has already sent to the Recycle Bin.
fn sent_under(conn: &Connection, batch_id: &str) -> Result<HashSet<i64>> {
    Ok(journal::batch(conn, batch_id)?
        .into_iter()
        .filter(|entry| entry.op == journal::ITEM_TRASH)
        .filter_map(|entry| serde_json::from_value::<ItemTrashed>(entry.forward).ok())
        .map(|trashed| trashed.item_id)
        .collect())
}

/// Sends one item's file to the Recycle Bin and records where the bin keeps it. Refused before the
/// shell is asked: a row gone from the index, a file gone from disk, a drive with no bin, a path
/// too long for the shell, a file that cannot be held. DECISIONS.md "Sending to the Recycle Bin".
pub(super) fn trash_unjournalled(
    conn: &Connection,
    item_id: i64,
    batch_id: Option<&str>,
) -> Result<()> {
    if !items::is_live(conn, item_id)? {
        return Err(AppError::refused(Reason::NotIndexed));
    }
    let file =
        items::file_of(conn, item_id)?.ok_or_else(|| AppError::refused(Reason::NotIndexed))?;
    let from = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    if !from.is_file() {
        return Err(AppError::refused(Reason::NotOnDisk {
            name: file.disk_name,
        }));
    }
    if let Some(drive) = Shell.binless(&from) {
        return Err(AppError::refused(Reason::NoBin { drive }));
    }
    recycling::add(conn, &Sending::new(&from, item_id, &file.uuid, batch_id))?;
    let sent = recycle::send(&Shell, &from, |itself, before| {
        recycling::holding(conn, &from, itself, before)
            .map_err(|err| std::io::Error::other(err.to_string()))
    })?;
    let binned = match sent {
        Sent::Recycled(binned) => binned,
        Sent::Gone => {
            recycling::settled(conn, &from)?;
            return Err(AppError::refused(Reason::NotOnDisk {
                name: file.disk_name,
            }));
        }
        Sent::Refused => {
            recycling::settled(conn, &from)?;
            return Err(AppError::refused(Reason::BinRefused));
        }
        Sent::TooLong => {
            recycling::settled(conn, &from)?;
            return Err(AppError::refused(Reason::PathTooLong));
        }
        Sent::Unheld(code) => {
            recycling::settled(conn, &from)?;
            return Err(AppError::refused(unheld(&from, code)));
        }
        Sent::Untraced => {
            recycling::settled(conn, &from)?;
            eprintln!(
                "recycle: {} left its folder, and the shell did not say where",
                from.display()
            );
            return Err(AppError::refused(Reason::NotOnDisk {
                name: file.disk_name,
            }));
        }
    };

    let recorded = in_transaction(conn, |tx| record_send(tx, item_id, &binned, batch_id));
    if recorded.is_err() {
        if relocate::relocate(&binned.path, &from).is_ok() {
            let_go(&binned.path);
            if recycle::settle_beside(&from).is_ok() {
                recycling::settled(conn, &from)?;
            }
        }
        return recorded;
    }
    match recycle::release(&from, &binned.file) {
        Ok(()) => recycling::settled(conn, &from)?,
        Err(err) => eprintln!("recycle: {} was not settled: {err}", from.display()),
    }
    Ok(())
}

/// Why a file could not be held for its send: the file's own reason when the disk gave one, as
/// another app holding it, and otherwise its drive, which cannot give it a second name.
fn unheld(file: &Path, code: Option<i32>) -> Reason {
    let err = code.map_or_else(
        || std::io::ErrorKind::Unsupported.into(),
        std::io::Error::from_raw_os_error,
    );
    match Reason::of_io(&err) {
        Reason::Other => Reason::NoHardLinks {
            drive: recycle::drive_of(file),
        },
        own => own,
    }
}

/// Records an item as in the Trash, where the bin keeps its file.
fn record_send(
    conn: &Connection,
    item_id: i64,
    binned: &Binned,
    batch_id: Option<&str>,
) -> Result<()> {
    items::send_to_trash(conn, item_id)?;
    items::set_binned(conn, item_id, &binned.path.to_string_lossy(), &binned.file)?;
    if let Some(batch_id) = batch_id {
        journal::record_item_trash(conn, batch_id, item_id)?;
    }
    Ok(())
}

/// Settles each send from a library folder the app stopped during, once that folder can be
/// reached: one the bin had taken is recorded as in the Trash, tags and all, as the send would
/// have recorded it. DECISIONS.md "Sending to the Recycle Bin".
pub fn settle_unfinished_send(conn: &Connection) -> Result<()> {
    for sending in recycling::unsettled(conn)? {
        if !sending.file.parent().is_some_and(Path::is_dir) {
            continue;
        }
        match settle_send(conn, &sending) {
            Ok(()) => recycling::settled(conn, &sending.file)?,
            Err(err) => eprintln!("recycle: {} was not settled: {err}", sending.file.display()),
        }
    }
    Ok(())
}

fn settle_send(conn: &Connection, sending: &Sending) -> Result<()> {
    let Some(itself) = sending.itself.as_deref() else {
        return Ok(recycle::settle_beside(&sending.file)?);
    };
    let recorded = items::binned(conn, sending.item_id)?.is_some_and(|(_, file)| file == itself);
    if !recorded {
        match recycle::found_in_bin(&Shell, &sending.file, itself, &sending.before) {
            Some(binned) if still_at(conn, sending)? => {
                let batch_id = sending.batch_id.as_deref();
                in_transaction(conn, |tx| {
                    record_send(tx, sending.item_id, &binned, batch_id)
                })?;
            }
            _ => return Ok(recycle::settle_beside(&sending.file)?),
        }
    }
    Ok(recycle::release(&sending.file, itself)?)
}

/// Whether the mark's item is still the live row at the path it sent from, and not another file
/// given its id since, even at the same name.
fn still_at(conn: &Connection, sending: &Sending) -> Result<bool> {
    if !items::is_live(conn, sending.item_id)? {
        return Ok(false);
    }
    let Some(file) = items::file_of(conn, sending.item_id)? else {
        return Ok(false);
    };
    Ok(file.uuid == sending.item_uuid
        && paths::item_path(conn, file.folder_id, &file.disk_name)? == sending.file)
}

/// Where a trashed item's file is now.
pub(super) enum Found {
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
pub(super) fn find(conn: &Connection, item_id: i64, file: &ItemFile) -> Result<Found> {
    find_in(conn, items::binned(conn, item_id)?, file)
}

/// As [`find`], for a file whose place in the bin was already read.
pub(super) fn find_in(
    conn: &Connection,
    binned: Option<(String, String)>,
    file: &ItemFile,
) -> Result<Found> {
    Looking::default().find(conn, binned, file)
}

/// What a look at many trashed files reads once rather than per file: each folder's directory and
/// each bin directory's volume.
#[derive(Default)]
struct Looking {
    dirs: HashMap<i64, PathBuf>,
    volumes: HashMap<PathBuf, Option<String>>,
}

impl Looking {
    fn find(
        &mut self,
        conn: &Connection,
        binned: Option<(String, String)>,
        file: &ItemFile,
    ) -> Result<Found> {
        let Some((binned, itself)) = binned else {
            return Ok(Found::Gone);
        };
        let binned = PathBuf::from(binned);
        if recycle::file_at(&binned).as_deref() == Some(itself.as_str()) {
            return Ok(Found::Bin(binned));
        }
        let dir = match self.dirs.get(&file.folder_id) {
            Some(dir) => dir,
            None => {
                let dir = paths::folder_dir(conn, file.folder_id)?;
                self.dirs.entry(file.folder_id).or_insert(dir)
            }
        };
        if recycle::file_at(&dir.join(&file.disk_name)).as_deref() == Some(itself.as_str()) {
            return Ok(Found::Back);
        }
        let volume = self
            .volumes
            .entry(binned.parent().map(Path::to_path_buf).unwrap_or_default())
            .or_insert_with(|| recycle::volume_serial(&binned));
        match volume {
            Some(volume) if volume == recycle::serial_of(&itself) => Ok(Found::Gone),
            _ => Ok(Found::Away),
        }
    }
}

/// Brings a file back from Explorer into the index, tags and all: live in its folder, or retired
/// there, for the walk to find, while the folder is gone. A row the walk made for it meanwhile, or
/// one retired at its name, describes the same file, and is forgotten. Whether it went live.
pub(super) fn put_back(conn: &Connection, item_id: i64, file: &ItemFile) -> Result<bool> {
    if let Some(held) = items::existing_by_disk_name(conn, file.folder_id, &file.disk_name)? {
        items::forget(conn, held.id, Forgot::NotOnDisk)?;
    }
    if !folders::is_live(conn, file.folder_id)? {
        items::retire_trashed(conn, item_id, now())?;
        return Ok(false);
    }
    items::take_from_trash(conn, item_id)?;
    tags::rebuild_item(conn, item_id)?;
    Ok(true)
}

/// Takes a file gone from the Recycle Bin out of the Trash and out of the journal, so an undo
/// passes over it. SCHEMA.md "The undo journal".
pub(super) fn leave(conn: &Connection, id: i64) -> Result<()> {
    leave_all(conn, &[id])
}

/// Takes many files gone from the Recycle Bin out of the Trash and the journal at once.
pub(super) fn leave_all(conn: &Connection, ids: &[i64]) -> Result<()> {
    journal::drop_items(conn, ids)?;
    items::retire_all_trashed(conn, ids, now())
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

/// Looks for each trashed file in the Recycle Bin: gone, its row leaves the Trash and the journal;
/// back at its path, it is restored. Only what changed is looked at again, under the disk's turn.
/// DECISIONS.md "The Trash is the Recycle Bin".
pub fn look_in_bin(conn: &Connection) -> Result<Looked> {
    let mut looking = Looking::default();
    let mut changed = Vec::new();
    for one in items::in_bin(conn, None)? {
        if matches!(
            looking.find(conn, one.binned, &one.file)?,
            Found::Gone | Found::Back
        ) {
            changed.push(one.id);
        }
    }
    if changed.is_empty() {
        return Ok(Looked::default());
    }
    #[cfg(test)]
    if let Some(then) = BETWEEN_LOOKS.with(|hook| hook.borrow_mut().take()) {
        then();
    }
    let _turn = super::turn();
    let mut looking = Looking::default();
    let (mut gone, mut back) = (Vec::new(), Vec::new());
    for one in items::in_bin(conn, Some(&changed))? {
        match looking.find(conn, one.binned, &one.file)? {
            Found::Bin(_) | Found::Away => {}
            Found::Gone => gone.push(one.id),
            Found::Back => back.push((one.id, one.file)),
        }
    }
    if !gone.is_empty() {
        in_transaction(conn, |tx| leave_all(tx, &gone))?;
    }
    let mut looked = Looked {
        retired: u32::try_from(gone.len()).unwrap_or(u32::MAX),
        restored: 0,
    };
    for (id, file) in &back {
        if in_transaction(conn, |tx| put_back(tx, *id, file))? {
            looked.restored += 1;
        } else {
            looked.retired += 1;
        }
    }
    Ok(looked)
}

#[cfg(test)]
thread_local! {
    static BETWEEN_LOOKS: std::cell::RefCell<Option<Box<dyn FnOnce()>>> =
        const { std::cell::RefCell::new(None) };
}

/// Runs `then` once on this thread's next look in the bin that found something to change, after
/// its first look and before it takes the disk's turn: where a test changes the bin meanwhile.
#[cfg(test)]
fn just_before_looking_again(then: impl FnOnce() + 'static) {
    BETWEEN_LOOKS.with(|hook| *hook.borrow_mut() = Some(Box::new(then)));
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
pub(super) fn restore_unjournalled(
    conn: &Connection,
    item_id: i64,
    to: Option<i64>,
    batch_id: Option<&str>,
) -> Result<()> {
    if !items::is_trashed(conn, item_id)? {
        return Err(AppError::invalid("that file is not in the trash"));
    }
    let file =
        items::file_of(conn, item_id)?.ok_or_else(|| AppError::refused(Reason::NotIndexed))?;
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
            let place = sources::place_name(conn, to.unwrap_or(file.folder_id))?;
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
        Some(_) => return Err(AppError::refused(Reason::NotIndexed)),
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
            place: sources::place_name(conn, home).unwrap_or_default(),
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
            place: sources::place_name(conn, file.folder_id)?,
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
                .ok_or_else(|| AppError::refused(Reason::NotIndexed))?;
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

/// The title of the source a folder is in.
pub(super) fn source_title(conn: &Connection, folder_id: i64) -> String {
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
    use std::cell::RefCell;
    use std::rc::Rc;

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

    fn uuid_of(conn: &Connection, id: i64) -> String {
        items::file_of(conn, id).unwrap().unwrap().uuid
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

    #[cfg(windows)]
    #[test]
    fn a_file_whose_path_is_too_long_for_the_shell_stays_and_says_so() {
        let (conn, root, cairo) = library("too-long");
        let cairo_units =
            std::os::windows::ffi::OsStrExt::encode_wide(root.join("Trips/Cairo").as_os_str())
                .count();
        let room = 262 - cairo_units - 1;
        let long = format!("{}.jpg", "l".repeat(room - 4));
        std::fs::write(root.join("Trips/Cairo").join(&long), "l").unwrap();
        walk::reconcile(&conn).unwrap();
        let id = id_of(&conn, cairo, &long);
        let bin = stand_in();

        let report = trash_items(&conn, &[id], &journal::new_batch()).unwrap();

        assert_eq!(report.trashed, 0);
        assert_eq!(report.refused[0].reason, Reason::PathTooLong);
        assert!(still_in_cairo(&report.refused[0].at));
        assert!(bin.asked.borrow().is_empty());
        assert!(items::is_live(&conn, id).unwrap());
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
        cairo_holds(&root, &[long.as_str(), "pyramid.jpg", "sphinx.jpg"]);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_that_cannot_be_held_for_its_send_stays_saying_why() {
        let gone = Reason::NotOnDisk {
            name: "sphinx.jpg".into(),
        };
        for (code, why) in [(87, None), (32, Some(Reason::InUse)), (2, Some(gone))] {
            let (conn, root, cairo) = library(&format!("unlinkable-{code}"));
            let sphinx = id_of(&conn, cairo, "sphinx.jpg");
            let bin = stand_in();
            recycle::links_fail(code);

            let report = trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();

            let drive = Reason::NoHardLinks {
                drive: recycle::drive_of(&root),
            };
            assert_eq!(report.trashed, 0);
            assert_eq!(report.refused[0].reason, why.unwrap_or(drive), "{code}");
            assert!(still_in_cairo(&report.refused[0].at));
            assert!(bin.asked.borrow().is_empty());
            assert!(items::is_live(&conn, sphinx).unwrap());
            assert!(recycling::unsettled(&conn).unwrap().is_empty());
            cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        }
    }

    /// The disk's answer to a second name on a drive without hard links.
    #[cfg(windows)]
    const NO_HARD_LINKS: i32 = 1;

    #[cfg(windows)]
    #[test]
    fn on_a_drive_without_hard_links_a_file_goes_to_the_bin_and_one_undo_brings_it_back() {
        let (conn, root, cairo) = library("linkless-round-trip");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let bin = stand_in();
        recycle::links_fail(NO_HARD_LINKS);
        let batch = journal::new_batch();

        let report = trash_items(&conn, &[pyramid], &batch).unwrap();

        assert_eq!(report.trashed, 1);
        cairo_holds(&root, &["sphinx.jpg"]);
        let binned = bin_file(&conn, pyramid);
        assert!(binned.starts_with(bin.dir().unwrap()));
        assert_eq!(std::fs::read_to_string(&binned).unwrap(), "p");
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
        assert_eq!(look_in_bin(&conn).unwrap(), Looked::default());
        assert!(items::is_trashed(&conn, pyramid).unwrap());

        undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "p"
        );
        assert!(items::is_live(&conn, pyramid).unwrap());
        let kept = tags::item_effective_tags(&conn, pyramid).unwrap();
        assert!(kept.iter().any(|tag| tag.value == "cairo"));
    }

    #[cfg(windows)]
    #[test]
    fn on_a_drive_without_hard_links_a_file_the_bin_cannot_take_stays_whole() {
        let (conn, root, cairo) = library("linkless-unrecyclable");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let mut bin = Fake::new(Stand::Recycles(root.parent().unwrap().join("bin")));
        bin.unrecyclable.push("sphinx".into());
        let bin = stand_in_as(bin);
        recycle::links_fail(NO_HARD_LINKS);

        let report = trash_items(&conn, &[pyramid, sphinx], &journal::new_batch()).unwrap();

        assert_eq!(report.trashed, 1);
        assert_eq!(
            (report.refused[0].id, &report.refused[0].reason),
            (sphinx, &Reason::BinRefused)
        );
        assert_eq!(bin.asked.borrow().len(), 2);
        cairo_holds(&root, &["sphinx.jpg"]);
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/sphinx.jpg")).unwrap(),
            "s"
        );
        assert!(items::is_live(&conn, sphinx).unwrap());
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn on_a_drive_without_hard_links_a_send_the_app_stopped_during_leaves_the_file_in_the_bin() {
        let (conn, root, cairo) = library("linkless-stopped");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        recycle::links_fail(NO_HARD_LINKS);
        let bin = stopped_during_send(&conn, cairo, &journal::new_batch());

        settle_unfinished_send(&conn).unwrap();

        assert!(recycling::unsettled(&conn).unwrap().is_empty());
        assert!(items::is_live(&conn, pyramid).unwrap());
        cairo_holds(&root, &["sphinx.jpg"]);
        let kept = crate::fs::settled_names(bin.dir().unwrap(), |seen| seen.len() == 1);
        assert_eq!(kept, ["pyramid.jpg"]);
        assert_eq!(
            std::fs::read_to_string(bin.dir().unwrap().join("pyramid.jpg")).unwrap(),
            "p"
        );
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

    /// Cairo holding sphinx.jpg, pyramid.jpg and then each name here, walked; their ids, sphinx first.
    fn with_more(conn: &Connection, root: &Path, cairo: i64, names: &[&str]) -> Vec<i64> {
        for name in names {
            std::fs::write(root.join("Trips/Cairo").join(name), *name).unwrap();
        }
        walk::reconcile(conn).unwrap();
        ["sphinx.jpg", "pyramid.jpg"]
            .iter()
            .chain(names)
            .map(|name| id_of(conn, cairo, name))
            .collect()
    }

    #[test]
    fn a_delete_on_the_queue_sends_one_file_to_a_turn_and_counts_each() {
        let (conn, root, cairo) = library("watched");
        stand_in();
        let ids = with_more(&conn, &root, cairo, &["obelisk.jpg"]);
        let batch = journal::new_batch();
        let control = relocate::HaltAfter::new(u32::MAX, Halt::Cancel);
        let turns = Rc::new(RefCell::new(0));
        let counted = Rc::clone(&turns);
        crate::fs::just_after_queueing(move || *counted.borrow_mut() += 1);

        let outcome = trash_watched(&conn, &ids, &batch, &control).unwrap();

        assert_eq!((outcome.report.trashed, outcome.halted), (3, None));
        assert_eq!(*control.heard.borrow(), [(0, 3), (1, 3), (2, 3), (3, 3)]);
        assert_eq!(*turns.borrow(), 3, "one turn of the disk per file");
        cairo_holds(&root, &[]);
        undo::undo_batch(&conn, &batch).unwrap();
        cairo_holds(&root, &["obelisk.jpg", "pyramid.jpg", "sphinx.jpg"]);
    }

    #[test]
    fn a_cancelled_delete_leaves_each_file_in_the_bin_or_where_it_was() {
        let (conn, root, cairo) = library("cancelled");
        stand_in();
        let ids = with_more(&conn, &root, cairo, &["obelisk.jpg"]);
        let batch = journal::new_batch();
        let control = relocate::HaltAfter::new(1, Halt::Cancel);

        let outcome = trash_watched(&conn, &ids, &batch, &control).unwrap();

        assert_eq!(
            (outcome.report.trashed, outcome.halted),
            (1, Some(Halt::Cancel))
        );
        assert!(outcome.report.refused.is_empty());
        cairo_holds(&root, &["obelisk.jpg", "pyramid.jpg"]);
        assert!(bin_file(&conn, ids[0]).is_file(), "sphinx is in the bin");
        assert!(items::is_trashed(&conn, ids[0]).unwrap());
        assert!(items::is_live(&conn, ids[1]).unwrap());
        assert!(items::is_live(&conn, ids[2]).unwrap());
        assert_eq!(journal::batch(&conn, &batch).unwrap().len(), 1);
    }

    #[test]
    fn a_delete_going_on_after_a_restart_passes_over_what_already_went() {
        let (conn, root, cairo) = library("resumed");
        stand_in();
        let ids = with_more(&conn, &root, cairo, &["obelisk.jpg"]);
        let batch = journal::new_batch();
        let stopped = trash_watched(
            &conn,
            &ids,
            &batch,
            &relocate::HaltAfter::new(2, Halt::Stop),
        )
        .unwrap();
        assert_eq!(stopped.halted, Some(Halt::Stop));

        let outcome = trash_watched(&conn, &ids, &batch, &relocate::Unwatched).unwrap();

        assert_eq!(outcome.report.trashed, 3);
        assert!(outcome.report.refused.is_empty(), "{:?}", outcome.report);
        cairo_holds(&root, &[]);
        undo::undo_batch(&conn, &batch).unwrap();
        cairo_holds(&root, &["obelisk.jpg", "pyramid.jpg", "sphinx.jpg"]);
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
    fn a_sorting_sources_own_folder_is_the_sorting_box_in_the_trash_and_in_what_stays() {
        let (conn, root, _) = library("sorting-box");
        let incoming = root.parent().unwrap().join("incoming");
        std::fs::create_dir_all(&incoming).unwrap();
        std::fs::write(incoming.join("a.jpg"), "a").unwrap();
        std::fs::write(incoming.join("b.jpg"), "b").unwrap();
        let source = sources::add(&conn, &incoming, "Incoming", SourceKind::Sorting).unwrap();
        walk::reconcile(&conn).unwrap();
        let sorting = folders::source_root_folder(&conn, source.id).unwrap();
        let (a, b) = (
            id_of(&conn, sorting, "a.jpg"),
            id_of(&conn, sorting, "b.jpg"),
        );
        let batch = journal::new_batch();
        trash_items(&conn, &[a, b], &batch).unwrap();
        let from: Vec<Vec<String>> = listing(&conn)
            .unwrap()
            .into_iter()
            .map(|one| one.from.path)
            .collect();
        assert_eq!(from, [["Sorting Box"], ["Sorting Box"]]);

        std::fs::write(incoming.join("a.jpg"), "another").unwrap();
        std::fs::remove_file(bin_file(&conn, b)).unwrap();
        let report = restore_items(&conn, &[a, b], None, &journal::new_batch()).unwrap();

        let reasons: Vec<Reason> = report.refused.into_iter().map(|one| one.reason).collect();
        assert_eq!(
            reasons,
            [
                Reason::NameTaken {
                    place: "Sorting Box".into(),
                    name: "a.jpg".into(),
                    folder: false
                },
                Reason::GoneFromBin {
                    name: "b.jpg".into(),
                    place: "Sorting Box".into(),
                },
            ]
        );

        let undone = undo::undo_batch(&conn, &batch).unwrap();
        let gone = undone.stayed.iter().find(|one| one.id == b).unwrap();
        assert_eq!(
            gone.reason,
            Reason::GoneFromBin {
                name: "b.jpg".into(),
                place: "Sorting Box".into(),
            }
        );
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
    fn looking_in_the_bin_waits_for_no_turn_of_the_disk_while_every_file_is_still_there() {
        let (conn, root, cairo) = library("look-no-turn");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        let path = root.parent().unwrap().join("library.db");
        let (sent, looked) = std::sync::mpsc::channel();

        let turn = crate::fs::turn();
        let looking = std::thread::spawn(move || {
            let conn = db::open(&path).unwrap();
            sent.send(look_in_bin(&conn).unwrap()).unwrap();
        });
        let looked = looked.recv_timeout(std::time::Duration::from_secs(10));
        drop(turn);
        looking.join().unwrap();

        assert_eq!(looked, Ok(Looked::default()));
        assert!(items::is_trashed(&conn, pyramid).unwrap());
    }

    /// Pyramid trashed under its own batch, its file moved aside in the bin so a look finds it
    /// gone; the batch, and where the file was and is.
    fn aside_in_bin(conn: &Connection, cairo: i64) -> (i64, String, PathBuf, PathBuf) {
        let pyramid = id_of(conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        trash_items(conn, &[pyramid], &batch).unwrap();
        let binned = bin_file(conn, pyramid);
        let aside = binned.with_file_name("aside");
        std::fs::rename(&binned, &aside).unwrap();
        (pyramid, batch, binned, aside)
    }

    #[test]
    fn a_file_back_in_the_bin_by_the_time_the_look_takes_the_turn_stays_in_the_trash() {
        let (conn, _, cairo) = library("look-again-in-bin");
        let (pyramid, batch, binned, aside) = aside_in_bin(&conn, cairo);
        just_before_looking_again(move || std::fs::rename(aside, binned).unwrap());

        assert_eq!(look_in_bin(&conn).unwrap(), Looked::default());

        assert!(items::is_trashed(&conn, pyramid).unwrap());
        assert!(!journal::batch(&conn, &batch).unwrap().is_empty());
    }

    #[test]
    fn a_file_restored_while_the_look_waited_for_the_turn_stays_restored_with_its_undo() {
        let (conn, root, cairo) = library("look-again-restored");
        let (pyramid, _, binned, aside) = aside_in_bin(&conn, cairo);
        let path = root.parent().unwrap().join("library.db");
        let restored = journal::new_batch();
        let restoring = restored.clone();
        just_before_looking_again(move || {
            std::fs::rename(aside, binned).unwrap();
            let conn = db::open(&path).unwrap();
            let report = restore_items(&conn, &[pyramid], None, &restoring).unwrap();
            assert_eq!(report.restored, 1);
        });

        assert_eq!(look_in_bin(&conn).unwrap(), Looked::default());

        assert!(items::is_live(&conn, pyramid).unwrap());
        cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        assert!(!journal::batch(&conn, &restored).unwrap().is_empty());
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
    fn a_tag_on_a_walk_made_row_can_no_longer_be_undone_once_the_look_puts_its_file_back() {
        let (conn, root, cairo) = library("look-put-back-tagged");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        trash_items(&conn, &[sphinx], &journal::new_batch()).unwrap();
        std::fs::rename(bin_file(&conn, sphinx), root.join("Trips/Cairo/sphinx.jpg")).unwrap();
        walk::reconcile(&conn).unwrap();
        let newcomer = id_of(&conn, cairo, "sphinx.jpg");
        let tagged = journal::new_batch();
        tags::add_items_tag(&conn, &[newcomer], "dusk", &tagged).unwrap();
        assert!(undo::can_undo(&conn, &tagged).unwrap());

        assert_eq!(
            look_in_bin(&conn).unwrap(),
            Looked {
                retired: 0,
                restored: 1
            }
        );

        assert!(!undo::can_undo(&conn, &tagged).unwrap());
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
    fn an_undo_after_the_trash_found_a_file_emptied_or_put_back_passes_over_it_or_counts_it_back() {
        let (conn, root, cairo) = library("undo-after-look");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let batch = journal::new_batch();
        trash_items(&conn, &[pyramid, sphinx], &batch).unwrap();
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();
        std::fs::rename(bin_file(&conn, sphinx), root.join("Trips/Cairo/sphinx.jpg")).unwrap();
        look_in_bin(&conn).unwrap();

        let report = undo::undo_batch(&conn, &batch).unwrap();

        assert_eq!(
            report.batch.act,
            acts::Act::Delete {
                from: Some("Cairo".into()),
                one: Some("sphinx.jpg".into()),
            }
        );
        assert_eq!((report.batch.files, report.files_back), (1, 1));
        assert!(report.stayed.is_empty(), "{:?}", report.stayed);
        assert!(!items::is_live(&conn, pyramid).unwrap());
        assert!(items::is_live(&conn, sphinx).unwrap());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
    }

    /// Trips/Cairo deleted with its files, as Delete Files Too does, after an act on Trips alone.
    fn delete_cairo(conn: &Connection, root: &Path, cairo: i64) -> (String, String) {
        let trips = folders::parent(conn, cairo).unwrap().unwrap();
        std::fs::write(root.join("Trips/note.jpg"), "n").unwrap();
        walk::reconcile(conn).unwrap();
        let note = id_of(conn, trips, "note.jpg");
        let named = journal::new_batch();
        crate::fs::items::rename(conn, note, "dusk.jpg", &named).unwrap();
        let deleted = journal::new_batch();
        let report = crate::fs::folders::delete(
            conn,
            cairo,
            Some(crate::fs::folders::Contents::Trash),
            &deleted,
        )
        .unwrap();
        assert!(report.deleted);
        (named, deleted)
    }

    #[test]
    fn a_folder_whose_files_were_all_emptied_from_explorer_is_never_made_again_by_undo() {
        let (conn, root, cairo) = library("look-emptied-folder");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let (named, deleted) = delete_cairo(&conn, &root, cairo);
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();
        std::fs::remove_file(bin_file(&conn, sphinx)).unwrap();

        assert_eq!(look_in_bin(&conn).unwrap().retired, 2);

        assert!(journal::batch(&conn, &deleted).unwrap().is_empty());
        let back = undo::undo_last(&conn).unwrap().unwrap();
        assert_eq!(back.batch.batch_id, named);
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert!(!root.join("Trips/Cairo").exists());
        assert!(!folders::is_live(&conn, cairo).unwrap());
        crate::fs::settles_to(&root.join("Trips"), &["note.jpg"]);
    }

    #[test]
    fn an_act_the_look_took_whole_from_the_journal_can_no_longer_be_undone_by_name() {
        let (conn, root, cairo) = library("look-undoable");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let (named, deleted) = delete_cairo(&conn, &root, cairo);
        assert!(undo::can_undo(&conn, &deleted).unwrap());

        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();
        look_in_bin(&conn).unwrap();
        assert!(undo::can_undo(&conn, &deleted).unwrap());

        std::fs::remove_file(bin_file(&conn, sphinx)).unwrap();
        look_in_bin(&conn).unwrap();
        assert!(!undo::can_undo(&conn, &deleted).unwrap());
        assert!(undo::can_undo(&conn, &named).unwrap());
    }

    #[test]
    fn a_folder_one_of_whose_files_was_emptied_from_explorer_comes_back_with_the_rest() {
        let (conn, root, cairo) = library("look-emptied-one");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let (_, deleted) = delete_cairo(&conn, &root, cairo);
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();

        assert_eq!(look_in_bin(&conn).unwrap().retired, 1);

        let back = undo::undo_last(&conn).unwrap().unwrap();
        assert_eq!(back.batch.batch_id, deleted);
        assert_eq!(
            (back.batch.files, back.files_back, back.folders_back),
            (1, 1, 1)
        );
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert!(folders::is_live(&conn, cairo).unwrap());
        assert!(items::is_live(&conn, sphinx).unwrap());
        cairo_holds(&root, &["sphinx.jpg"]);
    }

    #[test]
    fn an_undo_of_a_file_whose_name_one_put_back_from_explorer_took_says_it_left_the_disk() {
        let (conn, root, cairo) = library("undo-put-back-over");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let trashed = journal::new_batch();
        trash_items(&conn, &[sphinx], &trashed).unwrap();
        crate::fs::items::rename(&conn, pyramid, "sphinx.jpg", &journal::new_batch()).unwrap();
        std::fs::remove_file(root.join("Trips/Cairo/sphinx.jpg")).unwrap();
        walk::reconcile(&conn).unwrap();
        std::fs::rename(bin_file(&conn, sphinx), root.join("Trips/Cairo/sphinx.jpg")).unwrap();
        look_in_bin(&conn).unwrap();
        assert!(items::file_of(&conn, pyramid).unwrap().is_none());

        let report = undo::undo_last(&conn).unwrap().unwrap();

        assert_eq!(report.files_back, 0);
        assert_eq!(
            report.stayed,
            [Stayed {
                kind: stayed::Thing::File,
                id: pyramid,
                name: "sphinx.jpg".into(),
                at: stayed::Whereabouts::Forgotten {
                    path: vec!["Library".into(), "Trips".into(), "Cairo".into()],
                },
                reason: Reason::NotOnDisk {
                    name: "sphinx.jpg".into(),
                },
            }]
        );
        assert_eq!(journal::latest_batch(&conn).unwrap(), Some(trashed));
        assert!(items::is_live(&conn, sphinx).unwrap());
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/sphinx.jpg")).unwrap(),
            "s"
        );
    }

    #[test]
    fn a_file_the_look_forgot_once_it_was_emptied_leaves_nothing_to_undo() {
        let (conn, root, cairo) = library("look-forgotten");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "another").unwrap();
        walk::reconcile(&conn).unwrap();
        let newcomer = id_of(&conn, cairo, "pyramid.jpg");
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();

        assert_eq!(look_in_bin(&conn).unwrap().retired, 1);

        assert!(items::file_of(&conn, pyramid).unwrap().is_none());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
        assert!(items::is_live(&conn, newcomer).unwrap());
    }

    #[test]
    fn an_undo_of_a_file_a_restore_forgot_once_it_was_emptied_says_so_and_leaves_nothing_to_redo() {
        let (conn, root, cairo) = library("undo-forgotten");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        trash_items(&conn, &[pyramid], &batch).unwrap();
        std::fs::write(root.join("Trips/Cairo/pyramid.jpg"), "another").unwrap();
        walk::reconcile(&conn).unwrap();
        let newcomer = id_of(&conn, cairo, "pyramid.jpg");
        std::fs::remove_file(bin_file(&conn, pyramid)).unwrap();
        let restored = restore_items(&conn, &[pyramid], None, &journal::new_batch()).unwrap();
        assert_eq!((restored.restored, restored.refused.len()), (0, 1));
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

    fn files(sendings: Vec<Sending>) -> Vec<PathBuf> {
        sendings.into_iter().map(|sending| sending.file).collect()
    }

    #[test]
    fn a_send_the_app_stopped_during_is_settled_at_launch_and_the_file_is_back() {
        let (conn, root, cairo) = library("send-cut-short");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let place = root.join("Trips/Cairo/sphinx.jpg");
        recycling::add(
            &conn,
            &Sending::new(&place, sphinx, &uuid_of(&conn, sphinx), None),
        )
        .unwrap();
        std::fs::rename(&place, hold_of(&place)).unwrap();

        settle_unfinished_send(&conn).unwrap();

        assert_eq!(std::fs::read_to_string(&place).unwrap(), "s");
        assert!(!hold_of(&place).exists());
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
        assert!(items::is_live(&conn, sphinx).unwrap());
    }

    /// Sends pyramid.jpg under `batch` to a bin that takes it, and the app stops before the shell
    /// returns. The bin it took it into, from then on.
    fn stopped_during_send(conn: &Connection, cairo: i64, batch: &str) -> Rc<Fake> {
        let dir = stand_in().dir().unwrap().to_path_buf();
        stand_in_as(Fake::new(Stand::Stops(dir.clone())));
        let pyramid = id_of(conn, cairo, "pyramid.jpg");
        let stopped = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            trash_items(conn, &[pyramid], batch)
        }));
        assert!(stopped.is_err());
        stand_in_as(Fake::new(Stand::Recycles(dir)))
    }

    #[test]
    fn a_send_the_app_stopped_during_once_the_bin_took_the_file_is_in_the_trash_at_launch() {
        let (conn, root, cairo) = library("send-stopped-in-bin");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let batch = journal::new_batch();
        let bin = stopped_during_send(&conn, cairo, &batch);
        assert!(items::is_live(&conn, pyramid).unwrap());

        settle_unfinished_send(&conn).unwrap();

        assert!(items::is_trashed(&conn, pyramid).unwrap());
        let binned = bin_file(&conn, pyramid);
        assert!(binned.starts_with(bin.dir().unwrap()));
        assert_eq!(std::fs::read_to_string(&binned).unwrap(), "p");
        cairo_holds(&root, &["sphinx.jpg"]);
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
        let kept = tags::item_effective_tags(&conn, pyramid).unwrap();
        assert!(kept.iter().any(|tag| tag.value == "cairo"));

        assert_eq!(look_in_bin(&conn).unwrap(), Looked::default());
        walk::reconcile(&conn).unwrap();
        assert!(items::is_trashed(&conn, pyramid).unwrap());
        undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "p"
        );
        assert!(items::is_live(&conn, pyramid).unwrap());
    }

    #[test]
    fn a_mark_whose_item_is_now_another_file_records_nothing_and_the_file_comes_back() {
        let (conn, root, cairo) = library("send-stopped-reused");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        stopped_during_send(&conn, cairo, &journal::new_batch());
        let mut sending = recycling::unsettled(&conn).unwrap().remove(0);
        sending.item_id = sphinx;
        recycling::add(&conn, &sending).unwrap();

        settle_unfinished_send(&conn).unwrap();

        assert!(items::is_live(&conn, sphinx).unwrap());
        assert_eq!(items::binned(&conn, sphinx).unwrap(), None);
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "p"
        );
        cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_mark_whose_item_id_and_place_are_now_another_file_records_nothing() {
        let (conn, root, cairo) = library("send-stopped-same-name");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        stopped_during_send(&conn, cairo, &journal::new_batch());
        conn.execute(
            "UPDATE item SET uuid = 'another' WHERE id = ?1",
            rusqlite::params![pyramid],
        )
        .unwrap();

        settle_unfinished_send(&conn).unwrap();

        assert!(items::is_live(&conn, pyramid).unwrap());
        assert_eq!(items::binned(&conn, pyramid).unwrap(), None);
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "p"
        );
        cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
    }

    fn refuse_to_trash(conn: &Connection) {
        conn.execute_batch(
            "CREATE TEMP TRIGGER refuse_trash BEFORE UPDATE OF trashed_at ON item
             BEGIN SELECT RAISE(ABORT, 'refused'); END;",
        )
        .unwrap();
    }

    #[test]
    fn a_send_the_index_cannot_record_puts_the_file_back_and_leaves_nothing_beside_it() {
        let (conn, root, cairo) = library("send-unrecorded");
        let bin = stand_in();
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        refuse_to_trash(&conn);

        let report = trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();

        assert_eq!(report.trashed, 0);
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/pyramid.jpg")).unwrap(),
            "p"
        );
        cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        assert!(items::is_live(&conn, pyramid).unwrap());
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
        assert_eq!(bin.let_go.borrow().len(), 1);
        crate::fs::settles_to(bin.dir().unwrap(), &[]);
    }

    #[test]
    fn a_send_the_index_cannot_record_nor_put_back_is_in_the_trash_at_the_next_launch() {
        let (conn, root, cairo) = library("send-unrecorded-taken");
        let dir = stand_in().dir().unwrap().to_path_buf();
        stand_in_as(Fake::new(Stand::Occupied(dir.clone(), RefCell::default())));
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let place = root.join("Trips/Cairo/pyramid.jpg");
        refuse_to_trash(&conn);

        let report = trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();

        assert_eq!(report.trashed, 0);
        assert_eq!(std::fs::read_to_string(&place).unwrap(), "theirs");
        assert!(items::is_live(&conn, pyramid).unwrap());
        assert_eq!(
            files(recycling::unsettled(&conn).unwrap()),
            std::slice::from_ref(&place)
        );

        conn.execute_batch("DROP TRIGGER temp.refuse_trash")
            .unwrap();
        let bin = stand_in_as(Fake::new(Stand::Recycles(dir)));
        settle_unfinished_send(&conn).unwrap();

        assert!(items::is_trashed(&conn, pyramid).unwrap());
        let binned = bin_file(&conn, pyramid);
        assert!(binned.starts_with(bin.dir().unwrap()));
        assert_eq!(std::fs::read_to_string(&binned).unwrap(), "p");
        assert_eq!(std::fs::read_to_string(&place).unwrap(), "theirs");
        cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_send_the_app_stopped_during_after_it_was_recorded_only_lets_go_of_the_second_name() {
        let (conn, root, cairo) = library("send-stopped-recorded");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        trash_items(&conn, &[pyramid], &journal::new_batch()).unwrap();
        let place = root.join("Trips/Cairo/pyramid.jpg");
        let binned = bin_file(&conn, pyramid);
        let itself = recycle::file_at(&binned).unwrap();
        std::fs::hard_link(&binned, hold_of(&place)).unwrap();
        recycling::add(
            &conn,
            &Sending::new(&place, pyramid, &uuid_of(&conn, pyramid), None),
        )
        .unwrap();
        recycling::holding(&conn, &place, &itself, &[]).unwrap();

        settle_unfinished_send(&conn).unwrap();

        cairo_holds(&root, &["sphinx.jpg"]);
        assert_eq!(bin_file(&conn, pyramid), binned);
        assert_eq!(std::fs::read_to_string(&binned).unwrap(), "p");
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_send_the_app_stopped_during_before_the_shell_was_asked_leaves_the_file_where_it_was() {
        let (conn, root, cairo) = library("send-stopped-before");
        let pyramid = id_of(&conn, cairo, "pyramid.jpg");
        let place = root.join("Trips/Cairo/pyramid.jpg");
        std::fs::hard_link(&place, hold_of(&place)).unwrap();
        let itself = recycle::file_at(&place).unwrap();
        recycling::add(
            &conn,
            &Sending::new(&place, pyramid, &uuid_of(&conn, pyramid), None),
        )
        .unwrap();
        recycling::holding(&conn, &place, &itself, &[]).unwrap();

        settle_unfinished_send(&conn).unwrap();

        cairo_holds(&root, &["pyramid.jpg", "sphinx.jpg"]);
        assert!(items::is_live(&conn, pyramid).unwrap());
        assert!(recycling::unsettled(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_send_cut_short_in_a_folder_that_is_away_waits_for_it() {
        let (conn, root, cairo) = library("send-away");
        let sphinx = id_of(&conn, cairo, "sphinx.jpg");
        let away = root.join("Away/sphinx.jpg");
        recycling::add(
            &conn,
            &Sending::new(&away, sphinx, &uuid_of(&conn, sphinx), None),
        )
        .unwrap();

        settle_unfinished_send(&conn).unwrap();

        assert_eq!(files(recycling::unsettled(&conn).unwrap()), [away]);
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
            files(recycling::unsettled(&conn).unwrap()),
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

    mod timing {
        use super::*;

        #[test]
        #[ignore = "timing: runs alone, one test at a time"]
        fn ten_thousand_files_emptied_outside_the_app_leave_the_trash_inside_five_seconds() {
            let (conn, root, cairo) = library("timing-look");
            let bin = root.parent().unwrap().join("bin");
            std::fs::create_dir_all(&bin).unwrap();
            let serial = recycle::volume_serial(&bin).unwrap();
            let tx = db::begin(&conn).unwrap();
            let trashed: Vec<i64> = (0..10_000_i64)
                .map(|n| {
                    tx.execute(
                        "INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, size_bytes,
                                           mtime, kind, added_at, deleted_at, trashed_at,
                                           bin_path, bin_file)
                         VALUES ('t' || ?1, 1, ?2, ?1 || '.jpg', 'jpg', 1, 1, 'image', 1, 2, 2,
                                 ?3, ?4)",
                        rusqlite::params![
                            n,
                            cairo,
                            bin.join(format!("$R{n}.jpg")).to_string_lossy(),
                            format!("{serial}-{n:x}")
                        ],
                    )
                    .unwrap();
                    tx.last_insert_rowid()
                })
                .collect();
            tx.commit().unwrap();
            journal::grow_to_two_hundred_thousand(&conn, &trashed);

            let started = std::time::Instant::now();
            let looked = look_in_bin(&conn).unwrap();
            let took = started.elapsed();

            assert_eq!(looked.retired, 10_000);
            assert!(listing(&conn).unwrap().is_empty());
            assert!(took < std::time::Duration::from_secs(5), "took {took:?}");
        }
    }
}
