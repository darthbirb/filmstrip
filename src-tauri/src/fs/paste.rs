//! Files brought into a folder from outside the library, by a paste or a drop from Explorer: always
//! a copy, under their own names, a folder with its tree. A name already taken is refused and
//! reported, never changed, and a copy cut short leaves no half file. DECISIONS.md "Bringing files in".

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::journal::{self, FolderCopied, ItemCopied};
use crate::db::{folders, in_transaction, items, now, sources};
use crate::error::{AppError, Reason, Result};
use crate::fs::stayed::{self, Stayed};
use crate::fs::{acts, noclobber, paths, walk};

const CHUNK: usize = 1 << 20;

/// What a paste or a drop carries, counted as Explorer counts it: what is on top, not inside.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Carried {
    pub files: u32,
    pub folders: u32,
}

/// Why a copy will not start at all, in terms the interface words itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum CopyRefusal {
    /// Everything carried is already in the folder's own directory.
    AlreadyIn { place: String, carried: Carried },
    /// A folder carried is the folder it would go into, or holds it.
    IntoItself { name: String },
    /// The folder's drive is away.
    Offline { source: String },
}

/// Counts what is at each path, leaving out what a walk never reads.
pub fn carried(entries: &[PathBuf]) -> Carried {
    let mut out = Carried::default();
    for path in entries.iter().filter(|path| !skipped(path)) {
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.is_dir() => out.folders += 1,
            Ok(meta) if meta.is_file() => out.files += 1,
            _ => {}
        }
    }
    out
}

/// Whether a copy of `entries` into `folder_id` can start: the place it goes, or why not.
pub fn check(
    conn: &Connection,
    folder_id: i64,
    entries: &[PathBuf],
) -> Result<std::result::Result<String, CopyRefusal>> {
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    let source_id = folders::location(conn, folder_id)?.source_id;
    let source = sources::get(conn, source_id)?
        .ok_or_else(|| AppError::invalid("that source is no longer in the index"))?;
    if !Path::new(&source.root).is_dir() {
        return Ok(Err(CopyRefusal::Offline {
            source: source.title,
        }));
    }
    let dir = paths::folder_dir(conn, folder_id)?;
    if let Some(itself) = entries
        .iter()
        .find(|path| path.is_dir() && (paths::same_dir(path, &dir) || paths::contains(path, &dir)))
    {
        return Ok(Err(CopyRefusal::IntoItself {
            name: file_name(itself),
        }));
    }
    let present: Vec<&PathBuf> = entries.iter().filter(|path| path.exists()).collect();
    let place = acts::name(conn, folder_id)?;
    if !present.is_empty() && present.iter().all(|path| already_in(path, &dir)) {
        return Ok(Err(CopyRefusal::AlreadyIn {
            place,
            carried: carried(entries),
        }));
    }
    Ok(Ok(place))
}

/// Why a copy stopped before the end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Halt {
    /// Cancel: the file in hand is finished, and nothing after it is started.
    Cancel,
    /// The app is closing: the file in hand is abandoned and removed, and the copy goes on at the
    /// next launch from what the journal says came in.
    Stop,
}

/// What the copy answers to while it runs: being stopped, saying how far it has got, and each
/// file that has come in.
pub trait Control {
    fn halt(&self) -> Option<Halt>;
    fn progress(&self, done: u32, whole: u32);
    fn landed(&self, conn: &Connection, item_id: i64, kind: &str) -> Result<()>;
}

/// How a copy ended: how many files it carried and settled, and what stayed out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub whole: u32,
    pub done: u32,
    pub refused: Vec<Stayed>,
    pub halted: Option<Halt>,
    /// Why it stopped before the end, when something other than a halt stopped it.
    pub stopped: Option<Reason>,
}

/// Copies each entry into `folder_id` under `batch_id`, so one undo takes the whole copy back.
/// Run again under the same batch it goes on where it stopped: what the batch already brought in
/// is passed over rather than refused as a name taken.
pub fn run(
    conn: &Connection,
    batch_id: &str,
    folder_id: i64,
    entries: &[PathBuf],
    control: &impl Control,
) -> Result<Outcome> {
    let mut ours = Ours::read(conn, batch_id)?;
    ours.reclaim(conn, folder_id)?;
    let mut copy = Run {
        conn,
        batch_id,
        into: folder_id,
        part: part_of(batch_id),
        place: acts::name(conn, folder_id)?,
        source_id: folders::location(conn, folder_id)?.source_id,
        ours,
        control,
        whole: whole(entries),
        done: 0,
        refused: Vec::new(),
        halted: None,
    };
    control.progress(0, copy.whole);
    let brought = copy.bring_all(entries);
    tidy(conn, folder_id, &copy.ours, &copy.part);
    Ok(Outcome {
        whole: copy.whole,
        done: copy.done,
        refused: copy.refused,
        halted: copy.halted,
        stopped: brought.err().map(|err| Reason::of(&err)),
    })
}

/// A copy that will not run again, taken off the queue while it waited: what a crash left of it
/// is taken back and its parts cleared, as a run that ended would leave them.
pub fn abandon(conn: &Connection, batch_id: &str, folder_id: i64) -> Result<()> {
    let mut ours = Ours::read(conn, batch_id)?;
    ours.reclaim(conn, folder_id)?;
    tidy(conn, folder_id, &ours, &part_of(batch_id));
    Ok(())
}

/// Hidden, so a walk that reads a directory meanwhile passes it over.
fn part_of(batch_id: &str) -> String {
    format!(".{batch_id}.filmstrip-part")
}

/// A copy cut short by a crash leaves its part under a hidden name, in the folder it went into
/// or one the batch made; this clears any still there.
fn tidy(conn: &Connection, into: i64, ours: &Ours, part: &str) {
    for folder in std::iter::once(into).chain(ours.folders.keys().copied()) {
        if let Ok(dir) = paths::folder_dir(conn, folder) {
            let _ = std::fs::remove_file(dir.join(part));
        }
    }
}

/// What this batch has already brought in, read from its journal rows: each file and folder with
/// its row.
#[derive(Default)]
struct Ours {
    folders: HashMap<i64, i64>,
    items: HashMap<i64, i64>,
}

impl Ours {
    fn read(conn: &Connection, batch_id: &str) -> Result<Ours> {
        let mut ours = Ours::default();
        for entry in journal::batch(conn, batch_id)? {
            match entry.op.as_str() {
                journal::ITEM_COPY => {
                    let came: ItemCopied = serde_json::from_value(entry.forward)?;
                    ours.items.insert(came.item_id, entry.id);
                }
                journal::FOLDER_COPY => {
                    let made: FolderCopied = serde_json::from_value(entry.forward)?;
                    ours.folders.insert(made.folder_id, entry.id);
                }
                _ => {}
            }
        }
        Ok(ours)
    }

    /// Takes back each row whose file or folder is not there: a crash between a file's rows and
    /// its name leaves one, and a launch's walk may have retired it since. Kept, it would name
    /// something that never came in, and its undo could never finish.
    fn reclaim(&mut self, conn: &Connection, into: i64) -> Result<()> {
        let _turn = super::turn();
        // A drive that is away holds none of its files, and that is no crash to take back.
        let source = sources::get(conn, folders::location(conn, into)?.source_id)?;
        if !source.is_some_and(|source| Path::new(&source.root).is_dir()) {
            return Ok(());
        }
        let mut lost = Vec::new();
        for (&item, &row) in &self.items {
            if !at_its_name(conn, item)? {
                lost.push((item, row));
            }
        }
        for (item, row) in lost {
            take_back(conn, item, row)?;
            self.items.remove(&item);
        }
        let mut gone = Vec::new();
        for (&folder, &row) in &self.folders {
            if !folders::is_live(conn, folder)? {
                gone.push((folder, row));
            }
        }
        for (folder, row) in gone {
            journal::drop_entry(conn, row)?;
            self.folders.remove(&folder);
        }
        Ok(())
    }
}

/// Whether a file the batch brought in is live and on disk under its name.
fn at_its_name(conn: &Connection, item: i64) -> Result<bool> {
    if !items::is_live(conn, item)? {
        return Ok(false);
    }
    let Some(file) = items::file_of(conn, item)? else {
        return Ok(false);
    };
    Ok(paths::item_path(conn, file.folder_id, &file.disk_name).is_ok_and(|path| path.is_file()))
}

/// Takes back the rows of a file that never got its name, retired as a walk would find it.
fn take_back(conn: &Connection, item: i64, row: i64) -> Result<()> {
    in_transaction(conn, |tx| {
        journal::drop_entry(tx, row)?;
        if items::is_live(tx, item)? {
            items::retire(tx, item)?;
        }
        Ok(())
    })
}

struct Run<'a, C: Control> {
    conn: &'a Connection,
    batch_id: &'a str,
    into: i64,
    part: String,
    place: String,
    source_id: i64,
    ours: Ours,
    control: &'a C,
    whole: u32,
    done: u32,
    refused: Vec<Stayed>,
    halted: Option<Halt>,
}

impl<C: Control> Run<'_, C> {
    fn bring_all(&mut self, entries: &[PathBuf]) -> Result<()> {
        self.dir_of(self.into)?;
        for path in entries {
            if self.stopped() {
                break;
            }
            if skipped(path) {
                continue;
            }
            if already_in(path, &self.dir_of(self.into)?) {
                let place = self.place.clone();
                self.refuse(
                    path,
                    self.into,
                    AppError::refused(Reason::AlreadyIn { place }),
                );
                continue;
            }
            self.bring(path, self.into)?;
        }
        Ok(())
    }

    fn stopped(&mut self) -> bool {
        if self.halted.is_none() {
            self.halted = self.control.halt();
        }
        self.halted.is_some()
    }

    fn settle(&mut self, files: u32) {
        self.done = (self.done + files).min(self.whole);
        self.control.progress(self.done, self.whole);
    }

    /// One entry left where it was, with every file under it counted as settled.
    fn refuse(&mut self, path: &Path, into: i64, err: AppError) {
        let folder = std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir());
        self.refused.push(stayed::outside(path, into, folder, &err));
        self.settle(files_in(path));
    }

    /// Where a folder is on disk now, read again each time: the app can rename or move it while a
    /// long copy runs.
    fn dir_of(&self, folder: i64) -> Result<PathBuf> {
        if !folders::is_live(self.conn, folder)? {
            let name = acts::name(self.conn, folder)?;
            return Err(AppError::refused(Reason::FolderGone { name }));
        }
        paths::folder_dir(self.conn, folder)
    }

    fn bring(&mut self, from: &Path, folder: i64) -> Result<()> {
        match std::fs::symlink_metadata(from) {
            Ok(meta) if meta.is_dir() => self.bring_folder(from, folder),
            Ok(meta) if meta.is_file() => self.bring_file(from, folder),
            Ok(_) => Ok(()),
            Err(_) => {
                let name = file_name(from);
                self.refuse(from, folder, AppError::refused(Reason::NotOnDisk { name }));
                Ok(())
            }
        }
    }

    /// A folder comes in whole or not at all: one whose name is taken is never merged into the
    /// folder already there.
    fn bring_folder(&mut self, from: &Path, parent: i64) -> Result<()> {
        let name = file_name(from);
        let made = match folders::child_id(self.conn, parent, &name)? {
            Some(id) if self.ours.folders.contains_key(&id) => {
                self.remake_folder(id, parent, &name).map(|()| id)
            }
            Some(_) => Err(taken(self.conn, parent, &name, true)),
            None => self.make_folder(parent, &name),
        };
        let made = match made {
            Ok(id) => id,
            Err(err) => {
                self.refuse(from, parent, err);
                return Ok(());
            }
        };
        let inside = match listing(from) {
            Ok(inside) => inside,
            Err(err) => {
                self.refuse(from, parent, err);
                return Ok(());
            }
        };
        for entry in inside {
            if self.stopped() {
                break;
            }
            self.bring(&entry, made)?;
        }
        Ok(())
    }

    /// The folder's rows first, then its directory, so a crash between the two leaves a folder the
    /// next run knows is its own.
    fn make_folder(&mut self, parent: i64, name: &str) -> Result<i64> {
        let _turn = super::turn();
        let to = self.dir_of(parent)?.join(name);
        if to.exists() {
            return Err(taken(self.conn, parent, name, true));
        }
        let (id, row) = in_transaction(self.conn, |tx| {
            let id = folders::create(tx, parent, name)?;
            let copied = FolderCopied {
                folder_id: id,
                parent_id: parent,
                into: self.into,
            };
            Ok((id, journal::record_folder_copy(tx, self.batch_id, &copied)?))
        })?;
        if let Err(err) = std::fs::create_dir(&to) {
            in_transaction(self.conn, |tx| {
                journal::drop_entry(tx, row)?;
                folders::retire_subtree_at(tx, id, now()).map(|_| ())
            })?;
            return Err(match err.kind() {
                std::io::ErrorKind::AlreadyExists => taken(self.conn, parent, name, true),
                _ => err.into(),
            });
        }
        self.ours.folders.insert(id, row);
        Ok(id)
    }

    /// A folder this batch made whose directory is not there: a crash came between its rows and it.
    /// One there already is the batch's own only while it holds nothing, or something the batch
    /// brought in; one holding only what someone else put there is theirs, and stays out whole.
    fn remake_folder(&mut self, id: i64, parent: i64, name: &str) -> Result<()> {
        let _turn = super::turn();
        let to = self.dir_of(id)?;
        match std::fs::create_dir(&to) {
            Ok(()) => return Ok(()),
            Err(err) if !(err.kind() == std::io::ErrorKind::AlreadyExists && to.is_dir()) => {
                return Err(err.into());
            }
            Err(_) => {}
        }
        if self.ours_to_go_on_in(id, &to)? {
            return Ok(());
        }
        if let Some(row) = self.ours.folders.remove(&id) {
            journal::drop_entry(self.conn, row)?;
        }
        Err(taken(self.conn, parent, name, true))
    }

    fn ours_to_go_on_in(&self, id: i64, dir: &Path) -> Result<bool> {
        let (mut ours, mut theirs) = (false, false);
        for entry in std::fs::read_dir(dir)? {
            let name = entry?.file_name().to_string_lossy().into_owned();
            if name == self.part {
                continue;
            }
            let mine = match folders::child_id(self.conn, id, &name)? {
                Some(folder) => self.ours.folders.contains_key(&folder),
                None => items::existing_by_disk_name(self.conn, id, &name)?
                    .is_some_and(|held| !held.deleted && self.ours.items.contains_key(&held.id)),
            };
            if mine {
                ours = true;
            } else {
                theirs = true;
            }
        }
        Ok(ours || !theirs)
    }

    fn bring_file(&mut self, from: &Path, folder: i64) -> Result<()> {
        let name = file_name(from);
        if let Some(held) = items::existing_by_disk_name(self.conn, folder, &name)?
            && !held.deleted
        {
            if self.ours.items.contains_key(&held.id) {
                self.settle(1);
            } else {
                self.refuse(from, folder, taken(self.conn, folder, &name, false));
            }
            return Ok(());
        }
        if self.dir_of(folder)?.join(&name).exists() {
            self.refuse(from, folder, taken(self.conn, folder, &name, false));
            return Ok(());
        }
        let copied = std::fs::File::open(from)
            .map_err(AppError::from)
            .and_then(|source| Ok((source, self.open_part(folder)?)))
            .and_then(|(source, (part, target))| {
                let whole = copy_bytes(from, source, target, self.control);
                if !matches!(whole, Ok(true)) {
                    let _ = std::fs::remove_file(&part);
                }
                whole
            });
        match copied {
            Ok(true) => {}
            Ok(false) => {
                self.halted = Some(Halt::Stop);
                return Ok(());
            }
            Err(err) => {
                self.refuse(from, folder, err);
                return Ok(());
            }
        }
        match self.land(folder, &name) {
            Ok(id) => {
                self.settle(1);
                let kind = walk::kind_of(&paths::extension_of(&name));
                self.control.landed(self.conn, id, kind)?;
            }
            Err(err) => {
                if let Ok(dir) = self.dir_of(folder) {
                    let _ = std::fs::remove_file(dir.join(&self.part));
                }
                self.refuse(from, folder, err);
            }
        }
        Ok(())
    }

    /// Made in the turn, so the part is in the folder's directory as it is now.
    fn open_part(&self, folder: i64) -> Result<(PathBuf, std::fs::File)> {
        let _turn = super::turn();
        let part = self.dir_of(folder)?.join(&self.part);
        let target = std::fs::File::create(&part)?;
        Ok((part, target))
    }

    /// The copy recorded as a walk would, with its journal row, and only then given its own name,
    /// so a crash between the two leaves a row the next run knows to take back.
    fn land(&mut self, folder: i64, name: &str) -> Result<i64> {
        let _turn = super::turn();
        let dir = self.dir_of(folder)?;
        let (part, to) = (dir.join(&self.part), dir.join(name));
        let held = items::existing_by_disk_name(self.conn, folder, name)?;
        if held.as_ref().is_some_and(|row| !row.deleted) || to.exists() {
            return Err(taken(self.conn, folder, name, false));
        }
        let (id, row) = in_transaction(self.conn, |tx| {
            // A retired row holding the name describes a file that is gone; the arriving one takes it.
            if let Some(stale) = &held {
                items::forget_retired(tx, stale.id)?;
            }
            let id = walk::index_arrival(tx, &part, name, folder, self.source_id)?;
            let copied = ItemCopied {
                item_id: id,
                folder_id: folder,
                into: self.into,
            };
            Ok((id, journal::record_item_copy(tx, self.batch_id, &copied)?))
        })?;
        if let Err(err) = noclobber::rename(&part, &to) {
            take_back(self.conn, id, row)?;
            return Err(match err.kind() {
                std::io::ErrorKind::AlreadyExists => taken(self.conn, folder, name, false),
                _ => err.into(),
            });
        }
        self.ours.items.insert(id, row);
        Ok(id)
    }
}

/// Copies a file's bytes into its part. `false` when the app began closing partway; the caller
/// removes what was written.
fn copy_bytes(
    from: &Path,
    mut source: std::fs::File,
    mut target: std::fs::File,
    control: &impl Control,
) -> Result<bool> {
    let meta = source.metadata()?;
    let mut buffer = vec![0; CHUNK];
    let mut written = 0u64;
    loop {
        if control.halt() == Some(Halt::Stop) {
            return Ok(false);
        }
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        target.write_all(&buffer[..read])?;
        written += read as u64;
    }
    if written != meta.len() {
        return Err(AppError::invalid(format!(
            "{} did not copy whole",
            from.display()
        )));
    }
    if let Ok(modified) = meta.modified() {
        target.set_modified(modified)?;
    }
    Ok(true)
}

/// What a folder holds that a copy brings in, in name order.
fn listing(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut inside = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let path = entry?.path();
        if !skipped(&path) {
            inside.push(path);
        }
    }
    inside.sort_by_key(|path| file_name(path).to_lowercase());
    Ok(inside)
}

/// How many files a copy of `entries` carries, every file in each tree counted.
pub fn whole(entries: &[PathBuf]) -> u32 {
    entries.iter().map(|path| files_in(path)).sum()
}

/// How many files a copy of `path` carries: itself, or every file in its tree.
fn files_in(path: &Path) -> u32 {
    if skipped(path) {
        return 0;
    }
    walkdir::WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.depth() == 0 || !skipped(entry.path()))
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .count() as u32
}

/// Windows' own litter and hidden entries, which a walk never reads, so a copy never brings them.
fn skipped(path: &Path) -> bool {
    let name = file_name(path);
    name.starts_with('.') || walk::IGNORED_FILES.contains(&name.to_lowercase().as_str())
}

fn already_in(path: &Path, dir: &Path) -> bool {
    path.parent()
        .is_some_and(|parent| paths::same_dir(parent, dir))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn taken(conn: &Connection, folder_id: i64, name: &str, folder: bool) -> AppError {
    AppError::refused(Reason::NameTaken {
        place: acts::name(conn, folder_id).unwrap_or_default(),
        name: name.to_string(),
        folder,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::SourceKind;
    use crate::db::{self, items as rows};
    use crate::fs::acts::Act;
    use crate::fs::stayed::Whereabouts;
    use crate::fs::undo;
    use std::cell::{Cell, RefCell};

    /// A library with Trips/Lisbon, holding tram.jpg, and beside it Downloads, outside the library.
    fn library(name: &str) -> (Connection, PathBuf, i64) {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-paste")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        let root = dir.join("library");
        std::fs::create_dir_all(root.join("Trips/Lisbon")).unwrap();
        std::fs::write(root.join("Trips/Lisbon/tram.jpg"), "tram").unwrap();
        std::fs::create_dir_all(dir.join("Downloads")).unwrap();
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        let lisbon = folders::child_id(&conn, trips, "Lisbon").unwrap().unwrap();
        (conn, dir, lisbon)
    }

    fn write(path: &Path, contents: &str) -> PathBuf {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
        path.to_path_buf()
    }

    type Meanwhile = Box<dyn FnOnce()>;

    /// Runs to the end, or halts as told once `after` files have settled, or at its `at_look`th
    /// look, which can fall inside the copy of one file's bytes. `meanwhile` runs once, as the
    /// given number of files have settled.
    #[derive(Default)]
    struct Script {
        after: Option<(u32, Halt)>,
        at_look: Option<u32>,
        looks: Cell<u32>,
        done: Cell<u32>,
        landed: Cell<u32>,
        meanwhile: RefCell<Option<(u32, Meanwhile)>>,
    }

    impl Control for Script {
        fn halt(&self) -> Option<Halt> {
            self.looks.set(self.looks.get() + 1);
            if self.at_look.is_some_and(|at| self.looks.get() >= at) {
                return Some(Halt::Stop);
            }
            self.after
                .filter(|(after, _)| self.done.get() >= *after)
                .map(|(_, halt)| halt)
        }
        fn progress(&self, done: u32, _whole: u32) {
            self.done.set(done);
            let due = matches!(&*self.meanwhile.borrow(), Some((at, _)) if *at == done);
            if due && let Some((_, then)) = self.meanwhile.take() {
                then();
            }
        }
        fn landed(&self, _conn: &Connection, _item_id: i64, _kind: &str) -> Result<()> {
            self.landed.set(self.landed.get() + 1);
            Ok(())
        }
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn files_come_in_under_their_own_names_indexed_and_the_originals_stay() {
        let (conn, dir, lisbon) = library("files");
        let a = write(&dir.join("Downloads/IMG_5001.jpg"), "a");
        let b = write(&dir.join("Downloads/IMG_5002.jpg"), "b");
        let batch = journal::new_batch();
        let script = Script::default();

        let outcome = run(&conn, &batch, lisbon, &[a.clone(), b.clone()], &script).unwrap();
        assert_eq!((outcome.whole, outcome.done, outcome.halted), (2, 2, None));
        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(
            names_in(&dir.join("library/Trips/Lisbon")),
            ["IMG_5001.jpg", "IMG_5002.jpg", "tram.jpg"]
        );
        assert!(a.is_file() && b.is_file(), "a copy leaves the originals");
        assert_eq!(rows::in_folder(&conn, lisbon).unwrap().len(), 3);
        assert_eq!(script.landed.get(), 2);
        let described = acts::describe(&conn, &batch).unwrap();
        assert_eq!(
            described.act,
            Act::Copy {
                to: "Lisbon".into(),
                one: None,
                folder: None,
                folders: 0
            }
        );
        assert_eq!(described.files, 2);
    }

    #[test]
    fn a_file_waits_out_another_connection_writing_rather_than_being_refused() {
        let (conn, dir, lisbon) = library("busy");
        let a = write(&dir.join("Downloads/IMG_5001.jpg"), "a");

        let held = db::hold_write_lock(&dir.join("library.db"), 300);
        let outcome = run(
            &conn,
            &journal::new_batch(),
            lisbon,
            &[a],
            &Script::default(),
        );
        held.join().unwrap();
        let outcome = outcome.unwrap();
        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(outcome.done, 1);
        assert!(dir.join("library/Trips/Lisbon/IMG_5001.jpg").is_file());
    }

    #[test]
    fn a_folder_comes_in_whole_with_its_tree_and_without_windows_litter() {
        let (conn, dir, lisbon) = library("tree");
        write(&dir.join("Downloads/Alexandria/Day 1/a.jpg"), "a");
        write(&dir.join("Downloads/Alexandria/Day 2/b.jpg"), "b");
        write(&dir.join("Downloads/Alexandria/desktop.ini"), "litter");
        write(&dir.join("Downloads/Alexandria/.hidden"), "hidden");
        let batch = journal::new_batch();

        let entries = [dir.join("Downloads/Alexandria")];
        let outcome = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        assert_eq!((outcome.whole, outcome.done), (2, 2));
        let landed = dir.join("library/Trips/Lisbon/Alexandria");
        assert_eq!(names_in(&landed), ["Day 1", "Day 2"]);
        assert!(landed.join("Day 1/a.jpg").is_file());
        assert!(landed.join("Day 2/b.jpg").is_file());
        let alexandria = folders::child_id(&conn, lisbon, "Alexandria")
            .unwrap()
            .unwrap();
        assert_eq!(rows::live_under(&conn, alexandria).unwrap().len(), 2);
        let described = acts::describe(&conn, &batch).unwrap();
        assert_eq!(
            described.act,
            Act::Copy {
                to: "Lisbon".into(),
                one: None,
                folder: Some("Alexandria".into()),
                folders: 1
            }
        );
        assert_eq!((described.files, described.folders), (2, 3));
    }

    #[test]
    fn a_name_taken_is_reported_and_never_changed_or_overwritten() {
        let (conn, dir, lisbon) = library("taken");
        let tram = write(&dir.join("Downloads/tram.jpg"), "a different tram");
        let fresh = write(&dir.join("Downloads/fresh.jpg"), "fresh");
        let batch = journal::new_batch();

        let outcome = run(&conn, &batch, lisbon, &[tram, fresh], &Script::default()).unwrap();
        assert_eq!(outcome.done, 2);
        let [refused] = outcome.refused.as_slice() else {
            panic!("{:?}", outcome.refused)
        };
        assert_eq!(refused.name, "tram.jpg");
        assert_eq!(
            refused.reason,
            Reason::NameTaken {
                place: "Lisbon".into(),
                name: "tram.jpg".into(),
                folder: false
            }
        );
        assert_eq!(
            refused.at,
            Whereabouts::Outside {
                dir: dir.join("Downloads").to_string_lossy().into_owned(),
                into: lisbon
            }
        );
        let kept = std::fs::read_to_string(dir.join("library/Trips/Lisbon/tram.jpg")).unwrap();
        assert_eq!(kept, "tram");
        assert_eq!(
            names_in(&dir.join("library/Trips/Lisbon")),
            ["fresh.jpg", "tram.jpg"],
            "no suffixed copy"
        );
    }

    #[test]
    fn a_folder_whose_name_is_taken_stays_out_whole_and_is_never_merged() {
        let (conn, dir, lisbon) = library("folder-taken");
        write(
            &dir.join("library/Trips/Lisbon/Alexandria/kept.jpg"),
            "kept",
        );
        walk::reconcile(&conn).unwrap();
        write(&dir.join("Downloads/Alexandria/a.jpg"), "a");
        write(&dir.join("Downloads/Alexandria/b.jpg"), "b");
        let batch = journal::new_batch();

        let entries = [dir.join("Downloads/Alexandria")];
        let outcome = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        assert_eq!((outcome.whole, outcome.done), (2, 2));
        assert_eq!(outcome.refused.len(), 1);
        assert_eq!(outcome.refused[0].kind, stayed::Thing::Folder);
        assert_eq!(
            names_in(&dir.join("library/Trips/Lisbon/Alexandria")),
            ["kept.jpg"]
        );
        assert!(journal::batch(&conn, &batch).unwrap().is_empty());
    }

    #[test]
    fn what_is_already_there_is_refused_whole_and_a_mix_copies_the_rest() {
        let (conn, dir, lisbon) = library("already");
        let own = dir.join("library/Trips/Lisbon/tram.jpg");
        let refused = check(&conn, lisbon, std::slice::from_ref(&own)).unwrap();
        assert_eq!(
            refused,
            Err(CopyRefusal::AlreadyIn {
                place: "Lisbon".into(),
                carried: Carried {
                    files: 1,
                    folders: 0
                }
            })
        );

        let fresh = write(&dir.join("Downloads/fresh.jpg"), "fresh");
        let mix = [own, fresh];
        assert_eq!(check(&conn, lisbon, &mix).unwrap(), Ok("Lisbon".into()));
        let batch = journal::new_batch();
        let outcome = run(&conn, &batch, lisbon, &mix, &Script::default()).unwrap();
        assert_eq!(outcome.refused.len(), 1);
        assert_eq!(
            outcome.refused[0].reason,
            Reason::AlreadyIn {
                place: "Lisbon".into()
            }
        );
        assert!(dir.join("library/Trips/Lisbon/fresh.jpg").is_file());
    }

    #[test]
    fn a_folder_cannot_be_copied_into_itself_or_below_itself() {
        let (conn, dir, lisbon) = library("itself");
        let trips = folders::parent(&conn, lisbon).unwrap().unwrap();
        let carried = [dir.join("library/Trips")];
        for into in [trips, lisbon] {
            assert_eq!(
                check(&conn, into, &carried).unwrap(),
                Err(CopyRefusal::IntoItself {
                    name: "Trips".into()
                })
            );
        }
    }

    #[test]
    fn a_source_that_is_away_takes_nothing() {
        let (conn, dir, lisbon) = library("away");
        let fresh = write(&dir.join("Downloads/fresh.jpg"), "fresh");
        std::fs::rename(dir.join("library"), dir.join("unplugged")).unwrap();
        assert_eq!(
            check(&conn, lisbon, &[fresh]).unwrap(),
            Err(CopyRefusal::Offline {
                source: "Library".into()
            })
        );
    }

    #[test]
    fn closing_partway_leaves_no_half_file_and_the_next_run_goes_on_from_there() {
        let (conn, dir, lisbon) = library("resumed");
        let entries: Vec<PathBuf> = (1..=4)
            .map(|n| write(&dir.join(format!("Downloads/IMG_{n}.jpg")), "bytes"))
            .collect();
        let batch = journal::new_batch();

        let closing = Script {
            after: Some((2, Halt::Stop)),
            ..Script::default()
        };
        let first = run(&conn, &batch, lisbon, &entries, &closing).unwrap();
        assert_eq!((first.done, first.halted), (2, Some(Halt::Stop)));
        let lisbon_dir = dir.join("library/Trips/Lisbon");
        assert_eq!(
            names_in(&lisbon_dir),
            ["IMG_1.jpg", "IMG_2.jpg", "tram.jpg"],
            "no part left behind"
        );

        let second = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        assert_eq!((second.done, second.halted), (4, None));
        assert!(second.refused.is_empty(), "{:?}", second.refused);
        assert_eq!(names_in(&lisbon_dir).len(), 5);
        assert_eq!(acts::describe(&conn, &batch).unwrap().files, 4);
    }

    #[test]
    fn a_file_cut_short_is_removed_and_nothing_claims_it() {
        let (conn, dir, lisbon) = library("cut-short");
        let big = dir.join("Downloads/clip.mov");
        std::fs::write(&big, vec![7u8; CHUNK * 3]).unwrap();
        let batch = journal::new_batch();

        // The run looks once before the file and once before its first chunk; the third look
        // comes after a chunk is written.
        let closing = Script {
            at_look: Some(3),
            ..Script::default()
        };
        let outcome = run(&conn, &batch, lisbon, &[big], &closing).unwrap();
        assert_eq!((outcome.done, outcome.halted), (0, Some(Halt::Stop)));
        assert!(closing.looks.get() >= 3);
        assert_eq!(names_in(&dir.join("library/Trips/Lisbon")), ["tram.jpg"]);
        assert!(journal::batch(&conn, &batch).unwrap().is_empty());
    }
    #[test]
    fn cancel_keeps_what_came_in_as_one_batch_and_starts_nothing_more() {
        let (conn, dir, lisbon) = library("cancel");
        let entries: Vec<PathBuf> = (1..=3)
            .map(|n| write(&dir.join(format!("Downloads/IMG_{n}.jpg")), "bytes"))
            .collect();
        let batch = journal::new_batch();
        let cancelling = Script {
            after: Some((1, Halt::Cancel)),
            ..Script::default()
        };

        let outcome = run(&conn, &batch, lisbon, &entries, &cancelling).unwrap();
        assert_eq!(
            (outcome.whole, outcome.done, outcome.halted),
            (3, 1, Some(Halt::Cancel))
        );
        assert!(
            outcome.refused.is_empty(),
            "what was not copied is no failure"
        );
        assert_eq!(acts::describe(&conn, &batch).unwrap().files, 1);
    }

    #[test]
    fn undo_sends_what_came_in_to_the_trash_and_takes_its_folders_away() {
        let (conn, dir, lisbon) = library("undo");
        write(&dir.join("Downloads/Alexandria/Day 1/a.jpg"), "a");
        let loose = write(&dir.join("Downloads/loose.jpg"), "l");
        let batch = journal::new_batch();
        let entries = [dir.join("Downloads/Alexandria"), loose.clone()];
        run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        let came: Vec<i64> = rows::live_under(&conn, lisbon)
            .unwrap()
            .into_iter()
            .filter(|id| rows::file_of(&conn, *id).unwrap().unwrap().disk_name != "tram.jpg")
            .collect();
        assert_eq!(came.len(), 2);

        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert_eq!((back.files_back, back.folders_back), (2, 2));
        assert_eq!(names_in(&dir.join("library/Trips/Lisbon")), ["tram.jpg"]);
        assert!(came.iter().all(|id| rows::is_trashed(&conn, *id).unwrap()));
        assert!(dir.join("Downloads/Alexandria/Day 1/a.jpg").is_file());
        assert!(loose.is_file(), "undo never touches the originals");
        assert_eq!(
            folders::child_id(&conn, lisbon, "Alexandria").unwrap(),
            None
        );

        let again = run(
            &conn,
            &journal::new_batch(),
            lisbon,
            &entries,
            &Script::default(),
        );
        assert!(
            again.unwrap().refused.is_empty(),
            "the names are free again"
        );
    }

    #[test]
    fn undo_takes_the_act_before_a_copy_that_has_not_ended() {
        let (conn, dir, lisbon) = library("undo-while-copying");
        let entries: Vec<PathBuf> = (1..=4)
            .map(|n| write(&dir.join(format!("Downloads/IMG_{n}.jpg")), "bytes"))
            .collect();
        let batch = journal::new_batch();
        let payload = crate::jobs::kinds::CopyPayload {
            batch_id: batch.clone(),
            folder_id: lisbon,
            paths: entries
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect(),
            whole: 4,
        };
        let job = crate::db::jobs::enqueue(
            &conn,
            crate::jobs::kinds::COPY_IN,
            &serde_json::to_string(&payload).unwrap(),
            0,
        )
        .unwrap();
        let closing = |after| Script {
            after: Some((after, Halt::Stop)),
            ..Script::default()
        };
        run(&conn, &batch, lisbon, &entries, &closing(1)).unwrap();
        let made = journal::new_batch();
        crate::fs::folders::create(&conn, lisbon, "Porto", &made).unwrap();
        run(&conn, &batch, lisbon, &entries, &closing(2)).unwrap();
        let lisbon_dir = dir.join("library/Trips/Lisbon");

        let back = undo::undo_last(&conn).unwrap().unwrap();
        assert_eq!(back.batch.batch_id, made, "the act before the copy");
        assert_eq!(
            names_in(&lisbon_dir),
            ["IMG_1.jpg", "IMG_2.jpg", "tram.jpg"]
        );
        assert!(undo::undo_batch(&conn, &batch).is_err());

        run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        crate::db::jobs::complete(&conn, job).unwrap();
        let back = undo::undo_last(&conn).unwrap().unwrap();
        assert_eq!((back.batch.batch_id, back.files_back), (batch, 4));
        assert_eq!(names_in(&lisbon_dir), ["tram.jpg"]);
    }

    #[test]
    fn a_destination_renamed_partway_takes_the_rest_where_it_now_is() {
        let (conn, dir, lisbon) = library("renamed-partway");
        write(&dir.join("Downloads/Alexandria/Day 1/a.jpg"), "a");
        write(&dir.join("Downloads/Alexandria/Day 2/b.jpg"), "b");
        let entries = [
            write(&dir.join("Downloads/IMG_1.jpg"), "1"),
            dir.join("Downloads/Alexandria"),
            write(&dir.join("Downloads/IMG_2.jpg"), "2"),
        ];
        let trips = folders::parent(&conn, lisbon).unwrap().unwrap();
        let db_path = dir.join("library.db");
        let script = Script::default();
        script.meanwhile.replace(Some((
            2,
            Box::new(move || {
                let other = db::open(&db_path).unwrap();
                crate::fs::folders::rename(&other, lisbon, "Porto", &journal::new_batch()).unwrap();
                crate::fs::folders::create(&other, trips, "Lisbon", &journal::new_batch()).unwrap();
            }),
        )));
        let batch = journal::new_batch();

        let outcome = run(&conn, &batch, lisbon, &entries, &script).unwrap();
        assert!(outcome.refused.is_empty(), "{:?}", outcome.refused);
        assert_eq!(outcome.done, 4);
        let porto = dir.join("library/Trips/Porto");
        assert_eq!(
            names_in(&porto),
            ["Alexandria", "IMG_1.jpg", "IMG_2.jpg", "tram.jpg"]
        );
        assert!(porto.join("Alexandria/Day 1/a.jpg").is_file());
        assert!(porto.join("Alexandria/Day 2/b.jpg").is_file());
        assert!(names_in(&dir.join("library/Trips/Lisbon")).is_empty());
        let fresh = folders::child_id(&conn, trips, "Lisbon").unwrap().unwrap();
        assert!(rows::live_under(&conn, fresh).unwrap().is_empty());
        assert_eq!(rows::live_under(&conn, lisbon).unwrap().len(), 5);

        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert_eq!((back.files_back, back.folders_back), (4, 3));
        assert_eq!(names_in(&porto), ["tram.jpg"]);
    }

    #[test]
    fn a_crash_between_the_rows_and_the_disk_is_taken_back_and_copied_again() {
        let (conn, dir, lisbon) = library("crash-window");
        write(&dir.join("Downloads/Alexandria/a.jpg"), "a");
        let loose = write(&dir.join("Downloads/loose.jpg"), "loose");
        let entries = [dir.join("Downloads/Alexandria"), loose];
        let batch = journal::new_batch();
        run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        let lisbon_dir = dir.join("library/Trips/Lisbon");
        let part = format!(".{batch}.filmstrip-part");
        std::fs::rename(lisbon_dir.join("loose.jpg"), lisbon_dir.join(&part)).unwrap();
        std::fs::remove_dir_all(lisbon_dir.join("Alexandria")).unwrap();

        let again = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        assert!(again.refused.is_empty(), "{:?}", again.refused);
        assert_eq!(
            names_in(&lisbon_dir),
            ["Alexandria", "loose.jpg", "tram.jpg"]
        );
        assert_eq!(
            std::fs::read_to_string(lisbon_dir.join("Alexandria/a.jpg")).unwrap(),
            "a"
        );
        assert_eq!(rows::live_under(&conn, lisbon).unwrap().len(), 3);
        let described = acts::describe(&conn, &batch).unwrap();
        assert_eq!((described.files, described.folders), (2, 1));
    }

    /// A crash between a file's rows and its name, as the next launch finds it: the first of two
    /// files recorded and still under its part, the second never started.
    fn crashed_in_the_window(name: &str) -> (Connection, PathBuf, i64, String, Vec<PathBuf>) {
        let (conn, dir, lisbon) = library(name);
        let entries: Vec<PathBuf> = (1..=2)
            .map(|n| write(&dir.join(format!("Downloads/IMG_{n}.jpg")), "bytes"))
            .collect();
        let batch = journal::new_batch();
        let closing = Script {
            after: Some((1, Halt::Stop)),
            ..Script::default()
        };
        run(&conn, &batch, lisbon, &entries, &closing).unwrap();
        let lisbon_dir = dir.join("library/Trips/Lisbon");
        std::fs::rename(
            lisbon_dir.join("IMG_1.jpg"),
            lisbon_dir.join(part_of(&batch)),
        )
        .unwrap();
        (conn, dir, lisbon, batch, entries)
    }

    #[test]
    fn a_crash_the_launchs_walk_found_first_still_leaves_a_copy_that_undoes_whole() {
        let (conn, dir, lisbon, batch, entries) = crashed_in_the_window("crash-then-walk");
        walk::reconcile(&conn).unwrap();

        let again = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        assert!(again.refused.is_empty(), "{:?}", again.refused);
        assert_eq!((again.done, again.stopped), (2, None));
        let lisbon_dir = dir.join("library/Trips/Lisbon");
        assert_eq!(
            names_in(&lisbon_dir),
            ["IMG_1.jpg", "IMG_2.jpg", "tram.jpg"]
        );
        assert_eq!(acts::describe(&conn, &batch).unwrap().files, 2);

        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert_eq!(back.files_back, 2);
        assert!(journal::batch(&conn, &batch).unwrap().is_empty());
        assert_eq!(names_in(&lisbon_dir), ["tram.jpg"]);
        assert_eq!(undo::undo_last(&conn).unwrap(), None);
    }

    #[test]
    fn a_folder_crash_the_launchs_walk_found_first_is_made_again_and_undoes_whole() {
        let (conn, dir, lisbon) = library("crash-folder-then-walk");
        write(&dir.join("Downloads/Alexandria/a.jpg"), "a");
        let entries = [dir.join("Downloads/Alexandria")];
        let batch = journal::new_batch();
        let before_its_files = Script {
            at_look: Some(2),
            ..Script::default()
        };
        run(&conn, &batch, lisbon, &entries, &before_its_files).unwrap();
        let landed = dir.join("library/Trips/Lisbon/Alexandria");
        std::fs::remove_dir(&landed).unwrap();
        walk::reconcile(&conn).unwrap();

        let again = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        assert!(again.refused.is_empty(), "{:?}", again.refused);
        assert_eq!((again.done, again.stopped), (1, None));
        assert_eq!(names_in(&landed), ["a.jpg"]);
        let described = acts::describe(&conn, &batch).unwrap();
        assert_eq!((described.files, described.folders), (1, 1));

        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert_eq!((back.files_back, back.folders_back), (1, 1));
        assert!(journal::batch(&conn, &batch).unwrap().is_empty());
        assert_eq!(names_in(&dir.join("library/Trips/Lisbon")), ["tram.jpg"]);
        assert_eq!(undo::undo_last(&conn).unwrap(), None);
    }

    #[test]
    fn a_copy_going_on_while_its_drive_is_away_keeps_what_came_in() {
        let (conn, dir, lisbon) = library("resumed-away");
        let entries: Vec<PathBuf> = (1..=2)
            .map(|n| write(&dir.join(format!("Downloads/IMG_{n}.jpg")), "bytes"))
            .collect();
        let batch = journal::new_batch();
        let closing = Script {
            after: Some((1, Halt::Stop)),
            ..Script::default()
        };
        run(&conn, &batch, lisbon, &entries, &closing).unwrap();
        std::fs::rename(dir.join("library"), dir.join("unplugged")).unwrap();

        let _ = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        std::fs::rename(dir.join("unplugged"), dir.join("library")).unwrap();
        assert_eq!(acts::describe(&conn, &batch).unwrap().files, 1);
        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert_eq!(back.files_back, 1);
        assert_eq!(names_in(&dir.join("library/Trips/Lisbon")), ["tram.jpg"]);
    }

    #[test]
    fn a_crashed_file_whose_original_has_gone_since_is_taken_back_and_its_undo_finishes() {
        let (conn, dir, lisbon, batch, entries) = crashed_in_the_window("crash-original-gone");
        std::fs::remove_file(&entries[0]).unwrap();

        let again = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        let [refused] = again.refused.as_slice() else {
            panic!("{:?}", again.refused)
        };
        assert_eq!(
            refused.reason,
            Reason::NotOnDisk {
                name: "IMG_1.jpg".into()
            }
        );
        let lisbon_dir = dir.join("library/Trips/Lisbon");
        assert_eq!(names_in(&lisbon_dir), ["IMG_2.jpg", "tram.jpg"]);
        assert_eq!(rows::live_under(&conn, lisbon).unwrap().len(), 2);
        assert_eq!(acts::describe(&conn, &batch).unwrap().files, 1);

        let back = undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert_eq!(back.files_back, 1);
        assert!(journal::batch(&conn, &batch).unwrap().is_empty());
    }

    #[test]
    fn a_copied_file_gone_from_the_disk_and_the_index_since_does_not_hold_up_its_undo() {
        let (conn, dir, lisbon) = library("gone-since");
        let a = write(&dir.join("Downloads/a.jpg"), "a");
        let b = write(&dir.join("Downloads/b.jpg"), "b");
        let first = journal::new_batch();
        run(&conn, &first, lisbon, &[a.clone(), b], &Script::default()).unwrap();
        let lisbon_dir = dir.join("library/Trips/Lisbon");
        std::fs::remove_file(lisbon_dir.join("a.jpg")).unwrap();
        std::fs::remove_file(lisbon_dir.join("b.jpg")).unwrap();
        walk::reconcile(&conn).unwrap();
        // a.jpg comes in again, taking the name its retired row held, so that row is forgotten.
        let second = journal::new_batch();
        run(&conn, &second, lisbon, &[a], &Script::default()).unwrap();
        undo::undo_batch(&conn, &second).unwrap();

        let back = undo::undo_batch(&conn, &first).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert!(journal::batch(&conn, &first).unwrap().is_empty());
        assert_eq!(undo::undo_last(&conn).unwrap(), None);
    }

    #[test]
    fn a_folder_made_in_explorer_where_a_crash_left_the_copys_own_is_never_merged_into() {
        let (conn, dir, lisbon) = library("crash-folder-theirs");
        write(&dir.join("Downloads/Alexandria/a.jpg"), "a");
        let entries = [dir.join("Downloads/Alexandria")];
        let batch = journal::new_batch();
        run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        let theirs = dir.join("library/Trips/Lisbon/Alexandria");
        std::fs::remove_dir_all(&theirs).unwrap();
        write(&theirs.join("theirs.jpg"), "theirs");

        let again = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        let [refused] = again.refused.as_slice() else {
            panic!("{:?}", again.refused)
        };
        assert_eq!(
            refused.reason,
            Reason::NameTaken {
                place: "Lisbon".into(),
                name: "Alexandria".into(),
                folder: true
            }
        );
        assert_eq!(names_in(&theirs), ["theirs.jpg"]);
        assert!(journal::batch(&conn, &batch).unwrap().is_empty());
    }

    #[test]
    fn a_folder_the_copy_made_goes_on_filling_when_it_holds_what_the_copy_brought() {
        let (conn, dir, lisbon) = library("folder-ours-filled");
        write(&dir.join("Downloads/Alexandria/a.jpg"), "a");
        write(&dir.join("Downloads/Alexandria/b.jpg"), "b");
        let entries = [dir.join("Downloads/Alexandria")];
        let batch = journal::new_batch();
        let closing = Script {
            after: Some((1, Halt::Stop)),
            ..Script::default()
        };
        run(&conn, &batch, lisbon, &entries, &closing).unwrap();
        let landed = dir.join("library/Trips/Lisbon/Alexandria");
        write(&landed.join("added.jpg"), "added meanwhile");

        let again = run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        assert!(again.refused.is_empty(), "{:?}", again.refused);
        assert_eq!(names_in(&landed), ["a.jpg", "added.jpg", "b.jpg"]);
    }

    #[test]
    fn a_copy_whose_folder_goes_partway_says_why_and_keeps_what_it_refused() {
        let (conn, dir, lisbon) = library("folder-goes");
        let tram = write(&dir.join("Downloads/tram.jpg"), "a different tram");
        let fresh = write(&dir.join("Downloads/fresh.jpg"), "fresh");
        let db_path = dir.join("library.db");
        let script = Script::default();
        script.meanwhile.replace(Some((
            1,
            Box::new(move || {
                let other = db::open(&db_path).unwrap();
                folders::retire_subtree_at(&other, lisbon, now()).unwrap();
            }),
        )));

        let outcome = run(
            &conn,
            &journal::new_batch(),
            lisbon,
            &[tram, fresh],
            &script,
        )
        .unwrap();
        assert_eq!(
            outcome.stopped,
            Some(Reason::FolderGone {
                name: "Lisbon".into()
            })
        );
        let [refused] = outcome.refused.as_slice() else {
            panic!("{:?}", outcome.refused)
        };
        assert_eq!(refused.name, "tram.jpg");
        assert!(!dir.join("library/Trips/Lisbon/fresh.jpg").exists());
    }

    #[test]
    fn a_resumed_copy_clears_every_part_a_crash_left_in_its_folders() {
        let (conn, dir, lisbon) = library("stray-parts");
        write(&dir.join("Downloads/Alexandria/Day 1/a.jpg"), "a");
        write(&dir.join("Downloads/Alexandria/Day 2/b.jpg"), "b");
        let entries = [dir.join("Downloads/Alexandria")];
        let batch = journal::new_batch();
        let closing = Script {
            after: Some((1, Halt::Stop)),
            ..Script::default()
        };
        run(&conn, &batch, lisbon, &entries, &closing).unwrap();
        let landed = dir.join("library/Trips/Lisbon/Alexandria");
        let part = format!(".{batch}.filmstrip-part");
        for stray in [
            landed.join("Day 1"),
            landed.clone(),
            dir.join("library/Trips/Lisbon"),
        ] {
            std::fs::write(stray.join(&part), "half").unwrap();
        }

        run(&conn, &batch, lisbon, &entries, &Script::default()).unwrap();
        assert_eq!(names_in(&landed.join("Day 1")), ["a.jpg"]);
        assert_eq!(names_in(&landed.join("Day 2")), ["b.jpg"]);
        assert_eq!(names_in(&landed), ["Day 1", "Day 2"]);
        assert_eq!(
            names_in(&dir.join("library/Trips/Lisbon")),
            ["Alexandria", "tram.jpg"]
        );
    }

    #[cfg(windows)]
    #[test]
    fn what_stays_out_names_the_folder_it_was_going_into() {
        use std::os::windows::fs::OpenOptionsExt;
        let (conn, dir, lisbon) = library("stays-out-into");
        write(&dir.join("Downloads/Alexandria/Day 1/a.jpg"), "a");
        let held = write(&dir.join("Downloads/Alexandria/Day 1/held.jpg"), "held");
        let _open = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&held)
            .unwrap();
        let entries = [dir.join("Downloads/Alexandria")];
        let outcome = run(
            &conn,
            &journal::new_batch(),
            lisbon,
            &entries,
            &Script::default(),
        )
        .unwrap();
        let alexandria = folders::child_id(&conn, lisbon, "Alexandria")
            .unwrap()
            .unwrap();
        let day_1 = folders::child_id(&conn, alexandria, "Day 1")
            .unwrap()
            .unwrap();
        let [refused] = outcome.refused.as_slice() else {
            panic!("{:?}", outcome.refused)
        };
        let Whereabouts::Outside { dir: at, into } = &refused.at else {
            panic!("{:?}", refused.at)
        };
        assert!(paths::same_dir(Path::new(at), held.parent().unwrap()));
        assert_eq!(*into, day_1);
    }

    #[test]
    fn explorer_counts_what_is_on_top() {
        let (_, dir, _) = library("carried");
        let entries = [
            write(&dir.join("Downloads/a.jpg"), "a"),
            write(&dir.join("Downloads/Thumbs.db"), "litter"),
            write(&dir.join("Downloads/Alexandria/b.jpg"), "b"),
            write(&dir.join("Downloads/Alexandria/c.jpg"), "c"),
            dir.join("Downloads/gone.jpg"),
        ];
        let tops = [
            entries[0].clone(),
            entries[1].clone(),
            dir.join("Downloads/Alexandria"),
            entries[4].clone(),
        ];
        assert_eq!(
            carried(&tops),
            Carried {
                files: 1,
                folders: 1
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_file_another_program_holds_stays_out_and_says_so() {
        use std::os::windows::fs::OpenOptionsExt;
        let (conn, dir, lisbon) = library("in-use");
        let held = write(&dir.join("Downloads/held.jpg"), "held");
        let _open = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&held)
            .unwrap();

        let outcome = run(
            &conn,
            &journal::new_batch(),
            lisbon,
            &[held],
            &Script::default(),
        )
        .unwrap();
        assert_eq!(outcome.refused[0].reason, Reason::InUse);
        assert_eq!(names_in(&dir.join("library/Trips/Lisbon")), ["tram.jpg"]);
    }
}
