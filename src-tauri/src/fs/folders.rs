//! Folders changed on disk: made, renamed, moved and deleted. The directory changes first and the
//! row second, so a disk that refuses never leaves a row claiming what is not there; and each
//! change is journalled, so it can be undone. DECISIONS.md "Undo".

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::sources::{self, SourceKind};
use crate::db::{folders, in_transaction, items, journal, now, tags};
use crate::error::{AppError, Reason, Result};
use crate::fs::paste::Halt;
use crate::fs::recycle::{Bin, Shell};
use crate::fs::stayed::{self, Stayed};
use crate::fs::{
    PASSING, binless, items as fs_items, noclobber, paths, relocate, sanitize, take_away, trash,
    walk,
};

/// Makes a folder inside `parent_id` under `title`, as a directory and then a row.
pub fn create(conn: &Connection, parent_id: i64, title: &str, batch_id: &str) -> Result<i64> {
    let _turn = super::turn();
    make(conn, parent_id, title, Some(batch_id))
}

/// The making itself, which a redo also uses to make a folder again without journalling it.
pub(super) fn make(
    conn: &Connection,
    parent_id: i64,
    title: &str,
    batch_id: Option<&str>,
) -> Result<i64> {
    if !folders::is_live(conn, parent_id)? {
        return Err(AppError::refused(Reason::NotIndexed));
    }
    sanitize::refuse_forbidden(title)?;
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
        if let Some(batch_id) = batch_id {
            journal::record_folder_create(tx, batch_id, id, parent_id)?;
        }
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
        return Err(AppError::refused(Reason::NotIndexed));
    }
    let Some(parent_id) = folders::parent(conn, folder_id)? else {
        return Err(AppError::invalid(
            "a source's own folder is renamed as a source",
        ));
    };
    sanitize::refuse_forbidden(title)?;
    let old = folders::title(conn, folder_id)?.unwrap_or_default();
    let title = sanitize::folder_title(title);
    if title == old {
        return Ok(false);
    }
    // A change of case alone is still this folder's own name, not a clash with itself.
    refuse_clash(conn, parent_id, &title, Some(folder_id))?;

    let from = paths::folder_dir(conn, folder_id)?;
    let to = from.with_file_name(&title);
    relocate::relocate(&from, &to)
        .map_err(relocate::taken_as(|| taken(conn, parent_id, &title)))?;

    let recorded = in_transaction(conn, |tx| {
        folders::set_title(tx, folder_id, &title)?;
        tags::rebuild_subtree(tx, folder_id)?;
        if let Some(batch_id) = batch_id {
            journal::record_folder_rename(tx, batch_id, folder_id, &old, &title)?;
        }
        Ok(true)
    });
    if recorded.is_err() {
        let _ = relocate::relocate(&to, &from);
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
        return Err(AppError::refused(Reason::NotIndexed));
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
    relocate::relocate(&from, &to)
        .map_err(relocate::taken_as(|| taken(conn, parent_id, &title)))?;

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
    /// Deleted for good where their drive has no Recycle Bin, once asked, and the rest into the
    /// trash, with the folder. DECISIONS.md "A drive with no Recycle Bin".
    Permanently,
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
    /// How many of its files went for good, from a drive with no Recycle Bin.
    pub outright: u32,
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
    delete_held(conn, folder_id, contents, batch_id)
}

/// What a folder's delete on the queue did, and why it stopped before the end, if it did.
#[derive(Debug, Default)]
pub struct DeleteOutcome {
    pub report: DeleteReport,
    pub halted: Option<Halt>,
    pub stopped: Option<Reason>,
}

/// `delete` one file to a turn of the disk, answering to `control` between them; the folder goes
/// in a turn of its own once nothing is left in it. Files moved to a sorting source move in one
/// turn, as a folder's move does. DECISIONS.md "Background work".
pub fn delete_watched(
    conn: &Connection,
    folder_id: i64,
    contents: Contents,
    batch_id: &str,
    whole: u32,
    control: &impl relocate::Control,
) -> Result<DeleteOutcome> {
    let mut outcome = DeleteOutcome::default();
    if let Contents::MoveTo { .. } = contents {
        let _turn = super::turn();
        outcome.report = delete_held(conn, folder_id, Some(contents), batch_id)?;
        control.progress(whole, whole);
        return Ok(outcome);
    }
    let at_first = {
        let _turn = super::turn();
        refuse_undeletable(conn, folder_id)?;
        items::live_under(conn, folder_id)?
    };
    let mut done = whole.saturating_sub(u32::try_from(at_first.len()).unwrap_or(u32::MAX));
    control.progress(done, whole);
    for item_id in at_first {
        if let Some(halt) = control.halt() {
            outcome.halted = Some(halt);
            return Ok(outcome);
        }
        let _turn = super::turn();
        if !folders::is_live(conn, folder_id)? {
            outcome.stopped = Some(Reason::NotIndexed);
            return Ok(outcome);
        }
        if is_under(conn, item_id, folder_id)? {
            send_one(conn, item_id, contents, batch_id, &mut outcome.report)?;
        }
        done += 1;
        control.progress(done, whole);
    }
    if !outcome.report.refused.is_empty() {
        return Ok(outcome);
    }
    if let Some(halt) = control.halt() {
        outcome.halted = Some(halt);
        return Ok(outcome);
    }
    let _turn = super::turn();
    if !folders::is_live(conn, folder_id)? {
        outcome.stopped = Some(Reason::NotIndexed);
        return Ok(outcome);
    }
    let arrived = items::live_under(conn, folder_id)?;
    if let Some(&first) = arrived.first() {
        let name = items::file_of(conn, first)?
            .map(|file| file.disk_name)
            .unwrap_or_default();
        let holds = AppError::refused(Reason::Holds {
            name,
            more: arrived.len() as u32 - 1,
        });
        outcome
            .report
            .refused
            .push(stayed::folder(conn, folder_id, &holds)?);
        return Ok(outcome);
    }
    take_away_folder(conn, folder_id, batch_id, &mut outcome.report)?;
    Ok(outcome)
}

/// Whether a file is still live at or below a folder, not moved out of it since it was listed.
fn is_under(conn: &Connection, item_id: i64, folder_id: i64) -> Result<bool> {
    if !items::is_live(conn, item_id)? {
        return Ok(false);
    }
    let Some(file) = items::file_of(conn, item_id)? else {
        return Ok(false);
    };
    let mut at = Some(file.folder_id);
    while let Some(id) = at {
        if id == folder_id {
            return Ok(true);
        }
        at = folders::parent(conn, id)?;
    }
    Ok(false)
}

/// Refuses a folder that is gone, or is a source's own.
fn refuse_undeletable(conn: &Connection, folder_id: i64) -> Result<()> {
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::refused(Reason::NotIndexed));
    }
    if folders::parent(conn, folder_id)?.is_none() {
        return Err(AppError::invalid(
            "a source's own folder is removed as a source, never deleted",
        ));
    }
    Ok(())
}

/// Sends one file of a folder being deleted to the trash, or deletes it outright from a drive with
/// no Recycle Bin when `contents` says so; one that stays is reported.
fn send_one(
    conn: &Connection,
    item_id: i64,
    contents: Contents,
    batch_id: &str,
    report: &mut DeleteReport,
) -> Result<()> {
    let went = if contents == Contents::Permanently && binless::is_binless(conn, item_id)? {
        binless::delete_unjournalled(conn, item_id).map(|()| report.outright += 1)
    } else {
        trash::trash_unjournalled(conn, item_id, Some(batch_id))
    };
    if let Err(err) = went {
        report.refused.push(stayed::file(conn, item_id, &err)?);
    }
    Ok(())
}

/// The whole of a folder's delete, under the caller's one turn of the disk.
fn delete_held(
    conn: &Connection,
    folder_id: i64,
    contents: Option<Contents>,
    batch_id: &str,
) -> Result<DeleteReport> {
    refuse_undeletable(conn, folder_id)?;
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
        (Some(contents), false) => {
            for item_id in held {
                send_one(conn, item_id, contents, batch_id, &mut report)?;
            }
        }
    }
    if report.refused.is_empty() {
        take_away_folder(conn, folder_id, batch_id, &mut report)?;
    }
    Ok(report)
}

/// Takes away a folder its delete has emptied, journalled under `batch_id` unless its files went
/// for good and nothing of it can be undone; one that still holds a file is reported.
fn take_away_folder(
    conn: &Connection,
    folder_id: i64,
    batch_id: &str,
    report: &mut DeleteReport,
) -> Result<()> {
    let undoable = report.outright == 0 || !journal::batch(conn, batch_id)?.is_empty();
    match take_away_emptied(conn, folder_id, now(), undoable.then_some(batch_id)) {
        Ok(()) => report.deleted = true,
        Err(holds @ AppError::Refused(Reason::Holds { .. })) => {
            report
                .refused
                .push(stayed::folder(conn, folder_id, &holds)?);
        }
        Err(err) => return Err(err),
    }
    Ok(())
}

// Deletes a folder again, as a redo does once what it held has gone again: under the stamp its
/// delete first retired it with, so an undo finds it once more.
pub(super) fn redelete(conn: &Connection, folder_id: i64, retired_at: i64) -> Result<()> {
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::refused(Reason::NotIndexed));
    }
    let held = items::live_under(conn, folder_id)?;
    if let Some(&first) = held.first() {
        let name = items::file_of(conn, first)?
            .map(|file| file.disk_name)
            .unwrap_or_default();
        return Err(AppError::refused(Reason::Holds {
            name,
            more: held.len() as u32 - 1,
        }));
    }
    take_away_emptied(conn, folder_id, retired_at, None)
}

/// Takes away a folder that holds nothing the index shows, once only Windows' litter is left in
/// it, and retires it and everything under it at `retired_at`; refused, naming what it holds.
fn take_away_emptied(
    conn: &Connection,
    folder_id: i64,
    retired_at: i64,
    batch_id: Option<&str>,
) -> Result<()> {
    let dir = paths::folder_dir(conn, folder_id)?;
    let mut unseen = unseen_once_passed(&dir)?;
    if unseen.is_empty()
        && let Err(err) = clear_litter(&dir)
    {
        unseen = match unseen_files(&dir) {
            Ok(found) if !found.is_empty() => found,
            _ => return Err(err),
        };
    }
    if let Some(first) = unseen.first() {
        return Err(AppError::refused(Reason::Holds {
            name: file_name(first),
            more: unseen.len() as u32 - 1,
        }));
    }

    let subtree: Vec<PathBuf> = folders::descendants(conn, folder_id)?
        .into_iter()
        .map(|id| paths::folder_dir(conn, id))
        .collect::<Result<_>>()?;
    let recorded = in_transaction(conn, |tx| {
        folders::retire_subtree_at(tx, folder_id, retired_at)?;
        if let Some(batch_id) = batch_id {
            journal::record_folder_delete(tx, batch_id, folder_id, retired_at)?;
        }
        Ok(())
    });
    if let Err(err) = recorded {
        for path in std::iter::once(&dir).chain(&subtree) {
            let _ = std::fs::create_dir_all(path);
        }
        return Err(err);
    }
    Ok(())
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
    let gone = || -> Result<AppError> {
        Ok(AppError::refused(Reason::FolderGone {
            name: folders::title(conn, parent)?.unwrap_or_default(),
        }))
    };
    if !folders::is_live(conn, parent)? {
        return Err(gone()?);
    }
    refuse_clash(conn, parent, &title, Some(folder_id))?;
    let top = paths::folder_dir(conn, folder_id)?;
    match noclobber::make_dir(&top) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Err(gone()?),
        Err(err) => {
            return Err(relocate::taken_as(|| taken(conn, parent, &title))(
                err.into(),
            ));
        }
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
    let source =
        sources::get(conn, source_id)?.ok_or_else(|| AppError::refused(Reason::NotIndexed))?;
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

/// The files `unseen_files` finds once another program's passing file has gone, or as they are
/// after a quarter of a second. DECISIONS.md "Undo".
fn unseen_once_passed(dir: &Path) -> Result<Vec<PathBuf>> {
    let until = Instant::now() + PASSING;
    #[cfg(test)]
    let mut meanwhile = LOOKING.with(|hook| hook.borrow_mut().take());
    loop {
        #[cfg(test)]
        if let Some(then) = meanwhile.as_mut() {
            then(dir);
        }
        let unseen = unseen_files(dir)?;
        if unseen.is_empty() || Instant::now() >= until {
            return Ok(unseen);
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}

#[cfg(test)]
thread_local! {
    static LOOKING: std::cell::RefCell<Option<crate::fs::Meanwhile>> =
        const { std::cell::RefCell::new(None) };
}

/// Runs `then` with the directory this thread's next delete looks in, just before each look: where
/// a test puts what another program leaves there.
#[cfg(test)]
fn just_before_looking_for_unseen(then: impl FnMut(&Path) + 'static) {
    LOOKING.with(|hook| *hook.borrow_mut() = Some(Box::new(then)));
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
/// file that arrived since the check, and stays, stops the removal rather than going with it.
fn clear_litter(dir: &Path) -> Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(dir).contents_first(true) {
        let entry = entry.map_err(|err| AppError::invalid(err.to_string()))?;
        if entry.file_type().is_dir() {
            take_away(entry.path())?;
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
    match take_away(&dir) {
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

/// Takes back a folder a copy made, once what came into it has gone: its directory while still
/// empty, then its row, which is retired rather than forgotten since the trash still names it as
/// where its files came from. When it was retired, for a redo to make it again.
pub(super) fn unmake_copy(conn: &Connection, folder_id: i64) -> Result<Option<i64>> {
    if !folders::is_live(conn, folder_id)? {
        return Ok(None);
    }
    let title = folders::title(conn, folder_id)?.unwrap_or_default();
    let dir = paths::folder_dir(conn, folder_id)?;
    let holds = || match Shell.binless(&dir) {
        Some(drive) => AppError::refused(Reason::NoBin { drive }),
        None => AppError::invalid(format!("{title} holds something now, so it stays")),
    };
    if folders::holds_anything(conn, folder_id)? {
        return Err(holds());
    }
    match take_away(&dir) {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(holds()),
    }
    let retired_at = now();
    folders::retire_subtree_at(conn, folder_id, retired_at)?;
    Ok(Some(retired_at))
}

fn refuse_clash(conn: &Connection, parent_id: i64, title: &str, own: Option<i64>) -> Result<()> {
    match folders::child_id(conn, parent_id, title)? {
        Some(id) if Some(id) != own => Err(taken(conn, parent_id, title)),
        _ => Ok(()),
    }
}

fn taken(conn: &Connection, parent_id: i64, title: &str) -> AppError {
    AppError::refused(Reason::NameTaken {
        place: crate::fs::acts::name(conn, parent_id).unwrap_or_default(),
        name: title.to_string(),
        folder: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::SourceKind;
    use crate::db::{self, sources};
    use crate::fs::{settles_to, walk};
    use std::cell::{Cell, RefCell};
    use std::path::{Path, PathBuf};
    use std::rc::Rc;

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
        let made = create(&conn, trips, "Lisbon day 2.", &batch).unwrap();

        assert!(root.join("Trips/Lisbon day 2").is_dir());
        assert_eq!(
            folders::title(&conn, made).unwrap().as_deref(),
            Some("Lisbon day 2")
        );
        assert_eq!(journal::latest_batch(&conn).unwrap(), Some(batch));
    }

    #[test]
    fn a_name_holding_a_character_windows_refuses_is_refused_with_it_named() {
        let (conn, root, _, trips) = library("forbidden");
        let refused = |err: AppError| Reason::of(&err);
        let colon = Reason::ForbiddenCharacter {
            character: ":".into(),
        };

        let made = create(&conn, trips, "Lisbon: day 2", &journal::new_batch());
        assert_eq!(made.map_err(refused).unwrap_err(), colon);
        assert!(!root.join("Trips/Lisbon day 2").exists());

        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let renamed = rename(&conn, cairo, "Cairo: day 2", &journal::new_batch());
        assert_eq!(renamed.map_err(refused).unwrap_err(), colon);
        assert!(root.join("Trips/Cairo").is_dir());
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
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
        settles_to(&root.join("Trips"), &["CAIRO"]);
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
                ..DeleteReport::default()
            }
        );
        assert!(!root.join("Trips/Lisbon").exists(), "litter goes with it");
        assert!(!folders::is_live(&conn, made).unwrap());

        crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert!(root.join("Trips/Lisbon").is_dir());
        assert!(folders::is_live(&conn, made).unwrap());
    }

    fn theirs_appears_just_before_the_move() {
        crate::fs::noclobber::just_before_the_next(|to| {
            std::fs::create_dir(to).unwrap();
            std::fs::write(to.join("theirs.jpg"), "theirs").unwrap();
        });
    }

    #[test]
    fn a_rename_onto_a_folder_that_appeared_just_before_it_is_refused_and_both_stay() {
        let (conn, root, _, trips) = library("late-rename");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();

        theirs_appears_just_before_the_move();
        let err = rename(&conn, cairo, "Giza", &journal::new_batch()).unwrap_err();
        assert!(matches!(
            Reason::of(&err),
            Reason::NameTaken { folder: true, .. }
        ));
        settles_to(&root.join("Trips/Giza"), &["theirs.jpg"]);
        settles_to(&root.join("Trips/Cairo"), &["pyramid.jpg"]);
        assert_eq!(
            folders::title(&conn, cairo).unwrap().as_deref(),
            Some("Cairo")
        );
    }

    #[test]
    fn a_move_onto_a_folder_that_appeared_just_before_it_is_refused_and_both_stay() {
        let (conn, root, top, trips) = library("late-move");
        std::fs::create_dir(root.join("People")).unwrap();
        walk::reconcile(&conn).unwrap();
        let people = folders::child_id(&conn, top, "People").unwrap().unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();

        theirs_appears_just_before_the_move();
        let err = move_into(&conn, cairo, people, &journal::new_batch()).unwrap_err();
        assert!(matches!(
            Reason::of(&err),
            Reason::NameTaken { folder: true, .. }
        ));
        settles_to(&root.join("People/Cairo"), &["theirs.jpg"]);
        settles_to(&root.join("Trips/Cairo"), &["pyramid.jpg"]);
        assert_eq!(folders::parent(&conn, cairo).unwrap(), Some(trips));
    }

    #[test]
    fn undoing_a_rename_onto_a_folder_that_appeared_just_before_it_stays_and_both_are_kept() {
        let (conn, root, _, trips) = library("late-undo-rename");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let batch = journal::new_batch();
        rename(&conn, cairo, "Giza", &batch).unwrap();

        theirs_appears_just_before_the_move();
        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!((back.folders_back, back.stayed.len()), (0, 1));
        assert!(matches!(
            back.stayed[0].reason,
            Reason::NameTaken { folder: true, .. }
        ));
        settles_to(&root.join("Trips/Cairo"), &["theirs.jpg"]);
        settles_to(&root.join("Trips/Giza"), &["pyramid.jpg"]);
    }

    #[test]
    fn undoing_a_delete_onto_a_folder_that_appeared_just_before_it_stays_and_theirs_is_kept() {
        let (conn, root, _, trips) = library("late-undelete");
        let made = create(&conn, trips, "Lisbon", &journal::new_batch()).unwrap();
        let batch = journal::new_batch();
        delete(&conn, made, None, &batch).unwrap();

        theirs_appears_just_before_the_move();
        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!((back.folders_back, back.stayed.len()), (0, 1));
        assert!(matches!(
            back.stayed[0].reason,
            Reason::NameTaken { folder: true, .. }
        ));
        settles_to(&root.join("Trips/Lisbon"), &["theirs.jpg"]);
        assert!(!folders::is_live(&conn, made).unwrap());
    }

    #[test]
    fn undoing_a_delete_whose_parent_is_gone_from_the_disk_stays_and_never_remakes_it() {
        let (conn, root, _, trips) = library("undelete-parent-gone");
        let spain = create(&conn, trips, "Spain", &journal::new_batch()).unwrap();
        let lisbon = create(&conn, spain, "Lisbon", &journal::new_batch()).unwrap();
        let batch = journal::new_batch();
        delete(&conn, lisbon, None, &batch).unwrap();
        std::fs::remove_dir(root.join("Trips/Spain")).unwrap();

        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!((back.folders_back, back.stayed.len()), (0, 1));
        assert_eq!(
            back.stayed[0].reason,
            Reason::FolderGone {
                name: "Spain".into()
            }
        );
        assert!(!root.join("Trips/Spain").exists());
        assert!(!folders::is_live(&conn, lisbon).unwrap());
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

    /// Cairo holding pyramid.jpg and Night/stars.jpg, and Trips lone.jpg; Cairo's id, Night's, and
    /// the ids of stars and lone.
    fn cairo_by_night(conn: &Connection, root: &Path, trips: i64) -> (i64, i64, i64, i64) {
        std::fs::create_dir_all(root.join("Trips/Cairo/Night")).unwrap();
        std::fs::write(root.join("Trips/Cairo/Night/stars.jpg"), "s").unwrap();
        std::fs::write(root.join("Trips/lone.jpg"), "l").unwrap();
        walk::reconcile(conn).unwrap();
        let cairo = folders::child_id(conn, trips, "Cairo").unwrap().unwrap();
        let night = folders::child_id(conn, cairo, "Night").unwrap().unwrap();
        let id = |folder, name| {
            items::existing_by_disk_name(conn, folder, name)
                .unwrap()
                .unwrap()
                .id
        };
        (cairo, night, id(night, "stars.jpg"), id(trips, "lone.jpg"))
    }

    /// Runs `then` on its own connection to the library as the delete asks for its `nth` turn.
    fn at_turn(root: &Path, nth: u32, then: impl Fn(&Connection) + 'static) {
        let db = root.parent().unwrap().join("library.db");
        let asked = Cell::new(0);
        crate::fs::just_after_queueing(move || {
            asked.set(asked.get() + 1);
            if asked.get() == nth {
                then(&db::open(&db).unwrap());
            }
        });
    }

    #[test]
    fn a_folder_deleted_on_the_queue_sends_one_file_to_a_turn_and_goes_once_they_have() {
        let (conn, root, _, trips) = library("delete-watched");
        let (cairo, night, ..) = cairo_by_night(&conn, &root, trips);
        let held = items::live_under(&conn, cairo).unwrap();
        let control = relocate::HaltAfter::new(u32::MAX, Halt::Cancel);
        let batch = journal::new_batch();

        let outcome = delete_watched(&conn, cairo, Contents::Trash, &batch, 2, &control).unwrap();

        assert!(outcome.report.deleted, "{:?}", outcome.report);
        assert_eq!((outcome.halted, outcome.stopped), (None, None));
        assert_eq!(*control.heard.borrow(), [(0, 2), (1, 2), (2, 2)]);
        assert!(!root.join("Trips/Cairo").exists());
        assert!(held.iter().all(|id| items::is_trashed(&conn, *id).unwrap()));
        assert!(!folders::is_live(&conn, night).unwrap());

        crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert!(root.join("Trips/Cairo/Night/stars.jpg").is_file());
        assert!(held.iter().all(|id| items::is_live(&conn, *id).unwrap()));
    }

    #[test]
    fn a_cancelled_folder_delete_keeps_the_folder_and_each_file_in_the_bin_or_where_it_was() {
        let (conn, root, _, trips) = library("delete-cancelled");
        let (cairo, ..) = cairo_by_night(&conn, &root, trips);
        let held = items::live_under(&conn, cairo).unwrap();
        let batch = journal::new_batch();

        let outcome = delete_watched(
            &conn,
            cairo,
            Contents::Trash,
            &batch,
            2,
            &relocate::HaltAfter::new(1, Halt::Cancel),
        )
        .unwrap();

        assert_eq!(outcome.halted, Some(Halt::Cancel));
        assert!(!outcome.report.deleted);
        assert!(folders::is_live(&conn, cairo).unwrap());
        assert!(items::is_trashed(&conn, held[0]).unwrap());
        assert!(items::is_live(&conn, held[1]).unwrap());
        let still = items::file_of(&conn, held[1]).unwrap().unwrap();
        assert!(
            paths::item_path(&conn, still.folder_id, &still.disk_name)
                .unwrap()
                .is_file()
        );
        assert_eq!(journal::batch(&conn, &batch).unwrap().len(), 1);
    }

    #[test]
    fn a_file_moved_out_of_a_folder_as_it_is_deleted_stays_where_it_went() {
        let (conn, root, _, trips) = library("delete-moved-out");
        let (cairo, _, stars, _) = cairo_by_night(&conn, &root, trips);
        at_turn(&root, 2, move |other| {
            fs_items::move_unjournalled(other, stars, trips, None).unwrap();
        });

        let outcome = delete_watched(
            &conn,
            cairo,
            Contents::Trash,
            &journal::new_batch(),
            2,
            &relocate::Unwatched,
        )
        .unwrap();

        assert!(outcome.report.deleted, "{:?}", outcome.report);
        assert!(items::is_live(&conn, stars).unwrap());
        assert!(root.join("Trips/stars.jpg").is_file());
    }

    #[test]
    fn a_file_moved_into_a_folder_as_it_is_deleted_keeps_it_and_is_named() {
        let (conn, root, _, trips) = library("delete-moved-in");
        let (cairo, _, _, lone) = cairo_by_night(&conn, &root, trips);
        at_turn(&root, 4, move |other| {
            fs_items::move_unjournalled(other, lone, cairo, None).unwrap();
        });

        let outcome = delete_watched(
            &conn,
            cairo,
            Contents::Trash,
            &journal::new_batch(),
            2,
            &relocate::Unwatched,
        )
        .unwrap();

        assert!(!outcome.report.deleted);
        assert_eq!(
            outcome.report.refused[0].reason,
            Reason::Holds {
                name: "lone.jpg".into(),
                more: 0
            }
        );
        assert!(folders::is_live(&conn, cairo).unwrap());
        assert!(root.join("Trips/Cairo/lone.jpg").is_file());
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
                into: Some("Sorting Box".into())
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
    fn a_folder_name_taken_in_a_sorting_sources_own_folder_is_taken_in_the_sorting_box() {
        let (conn, root, _, _) = library("taken-sorting");
        let (_, inbox_folder, inbox_root) = with_inbox(&conn, &root);
        std::fs::create_dir_all(inbox_root.join("Day 2")).unwrap();
        walk::reconcile(&conn).unwrap();

        let err = create(&conn, inbox_folder, "Day 2", &journal::new_batch()).unwrap_err();
        assert_eq!(
            Reason::of(&err),
            Reason::NameTaken {
                place: "Sorting Box".into(),
                name: "Day 2".into(),
                folder: true
            }
        );
    }

    #[test]
    fn a_file_that_stays_in_a_sorting_source_is_placed_in_the_sorting_box() {
        let (conn, root, _, _) = library("stayed-sorting");
        let (_, inbox_folder, inbox_root) = with_inbox(&conn, &root);
        std::fs::create_dir_all(inbox_root.join("Day 2")).unwrap();
        std::fs::write(inbox_root.join("Day 2/pyramid.jpg"), "p").unwrap();
        walk::reconcile(&conn).unwrap();
        let day = folders::child_id(&conn, inbox_folder, "Day 2")
            .unwrap()
            .unwrap();
        let [item] = items::live_under(&conn, day).unwrap()[..] else {
            panic!("Day 2 holds one file");
        };

        let stayed =
            crate::fs::stayed::file(&conn, item, &AppError::refused(Reason::InUse)).unwrap();
        assert_eq!(
            stayed.at,
            crate::fs::stayed::Whereabouts::Folder {
                folder_id: day,
                path: vec!["Sorting Box".into(), "Day 2".into()],
            }
        );
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
                place: "Sorting Box".into(),
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

    /// Counts each try; on the first puts `name` in the folder, and on the second takes it away
    /// unless `stays`.
    fn theirs_passes(name: &'static str, stays: bool) -> (Rc<Cell<u32>>, impl FnMut(&Path)) {
        let tries = Rc::new(Cell::new(0));
        let counted = Rc::clone(&tries);
        let hook = move |at: &Path| {
            counted.set(counted.get() + 1);
            match counted.get() {
                1 => std::fs::write(at.join(name), "theirs").unwrap(),
                2 if !stays => crate::fs::remove_once_let_go(&at.join(name)),
                _ => {}
            }
        };
        (tries, hook)
    }

    fn trashed_whole(conn: &Connection, root: &Path, cairo: i64, tries: &Cell<u32>) {
        let report = delete(conn, cairo, Some(Contents::Trash), &journal::new_batch()).unwrap();
        assert!(report.deleted, "{:?}", report.refused);
        assert_eq!(tries.get(), 2);
        assert!(!root.join("Trips/Cairo").exists());
        assert!(!folders::is_live(conn, cairo).unwrap());
    }

    #[test]
    fn a_folder_deleted_goes_once_another_programs_file_it_found_has_passed() {
        let (conn, root, _, trips) = library("delete-passing-seen");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let (tries, hook) = theirs_passes("PYRAMID.JPG.tmp", false);
        just_before_looking_for_unseen(hook);
        trashed_whole(&conn, &root, cairo, &tries);
    }

    #[test]
    fn a_folder_deleted_goes_once_another_programs_file_has_passed_through_it() {
        let (conn, root, _, trips) = library("delete-passing");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let (tries, hook) = theirs_passes("PYRAMID.JPG.tmp", false);
        crate::fs::just_before_taking_away(hook);
        trashed_whole(&conn, &root, cairo, &tries);
    }

    #[test]
    fn a_file_that_arrives_as_its_folder_goes_keeps_it_and_is_named() {
        let (conn, root, _, trips) = library("delete-arrives");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let (_, hook) = theirs_passes("theirs.jpg", true);
        crate::fs::just_before_taking_away(hook);

        let report = delete(&conn, cairo, Some(Contents::Trash), &journal::new_batch()).unwrap();
        assert!(!report.deleted);
        assert_eq!(
            report.refused[0].reason,
            Reason::Holds {
                name: "theirs.jpg".into(),
                more: 0
            }
        );
        assert_eq!(
            std::fs::read_to_string(root.join("Trips/Cairo/theirs.jpg")).unwrap(),
            "theirs"
        );
        assert!(folders::is_live(&conn, cairo).unwrap());
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_that_will_not_go_and_cannot_then_be_read_fails_for_why_it_would_not_go() {
        use std::os::windows::fs::OpenOptionsExt;
        const BACKUP_SEMANTICS: u32 = 0x0200_0000;
        let (conn, _, _, trips) = library("delete-unreadable");
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let held = Rc::new(RefCell::new(None));
        let holding = Rc::clone(&held);
        crate::fs::just_before_taking_away(move |at| {
            holding.borrow_mut().get_or_insert_with(|| {
                std::fs::OpenOptions::new()
                    .read(true)
                    .share_mode(0)
                    .custom_flags(BACKUP_SEMANTICS)
                    .open(at)
                    .unwrap()
            });
        });

        let err = delete(&conn, cairo, Some(Contents::Trash), &journal::new_batch()).unwrap_err();
        assert!(matches!(err, AppError::Io(_)), "{err:?}");
        assert!(folders::is_live(&conn, cairo).unwrap());
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
