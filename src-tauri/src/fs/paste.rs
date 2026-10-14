//! Files brought into a folder from outside the library, by a paste or a drop from Explorer: always
//! a copy, under their own names, a folder with its tree. A name already taken is refused and
//! reported, never changed, and a copy cut short leaves no half file. DECISIONS.md "Bringing files in".

use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::journal::{self, FolderCopied, ItemCopied};
use crate::db::{folders, items, sources};
use crate::error::{AppError, Reason, Result};
use crate::fs::stayed::{self, Stayed};
use crate::fs::{acts, paths, walk};

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
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    let dir = paths::folder_dir(conn, folder_id)?;
    let mut copy = Run {
        conn,
        batch_id,
        into: folder_id,
        place: acts::name(conn, folder_id)?,
        source_id: folders::location(conn, folder_id)?.source_id,
        ours: Ours::read(conn, batch_id)?,
        control,
        whole: entries.iter().map(|path| files_in(path)).sum(),
        done: 0,
        refused: Vec::new(),
        halted: None,
        visited: HashSet::new(),
    };
    control.progress(0, copy.whole);
    for path in entries {
        if copy.stopped() {
            break;
        }
        if skipped(path) {
            continue;
        }
        if already_in(path, &dir) {
            let place = copy.place.clone();
            copy.refuse(path, AppError::refused(Reason::AlreadyIn { place }));
            continue;
        }
        copy.bring(path, folder_id, &dir)?;
    }
    copy.tidy();
    Ok(Outcome {
        whole: copy.whole,
        done: copy.done,
        refused: copy.refused,
        halted: copy.halted,
    })
}

/// What this batch has already brought in, read from its journal rows.
#[derive(Default)]
struct Ours {
    folders: HashSet<i64>,
    items: HashSet<i64>,
}

impl Ours {
    fn read(conn: &Connection, batch_id: &str) -> Result<Ours> {
        let mut ours = Ours::default();
        for entry in journal::batch(conn, batch_id)? {
            match entry.op.as_str() {
                journal::ITEM_COPY => {
                    let came: ItemCopied = serde_json::from_value(entry.forward)?;
                    ours.items.insert(came.item_id);
                }
                journal::FOLDER_COPY => {
                    let made: FolderCopied = serde_json::from_value(entry.forward)?;
                    ours.folders.insert(made.folder_id);
                }
                _ => {}
            }
        }
        Ok(ours)
    }
}

struct Run<'a, C: Control> {
    conn: &'a Connection,
    batch_id: &'a str,
    into: i64,
    place: String,
    source_id: i64,
    ours: Ours,
    control: &'a C,
    whole: u32,
    done: u32,
    refused: Vec<Stayed>,
    halted: Option<Halt>,
    visited: HashSet<PathBuf>,
}

impl<C: Control> Run<'_, C> {
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
    fn refuse(&mut self, path: &Path, err: AppError) {
        let folder = std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_dir());
        self.refused.push(stayed::outside(path, folder, &err));
        self.settle(files_in(path));
    }

    fn bring(&mut self, from: &Path, folder: i64, dir: &Path) -> Result<()> {
        match std::fs::symlink_metadata(from) {
            Ok(meta) if meta.is_dir() => self.bring_folder(from, folder, dir),
            Ok(meta) if meta.is_file() => self.bring_file(from, folder, dir),
            Ok(_) => Ok(()),
            Err(_) => {
                let name = file_name(from);
                self.refuse(from, AppError::refused(Reason::NotOnDisk { name }));
                Ok(())
            }
        }
    }

    /// A folder comes in whole or not at all: one whose name is taken is never merged into the
    /// folder already there.
    fn bring_folder(&mut self, from: &Path, parent: i64, dir: &Path) -> Result<()> {
        let name = file_name(from);
        let to = dir.join(&name);
        let made = match folders::child_id(self.conn, parent, &name)? {
            Some(id) if self.ours.folders.contains(&id) => id,
            Some(_) => {
                self.refuse(from, taken(self.conn, parent, &name, true));
                return Ok(());
            }
            None if to.exists() => {
                self.refuse(from, taken(self.conn, parent, &name, true));
                return Ok(());
            }
            None => match self.make_folder(parent, &name, &to) {
                Ok(id) => id,
                Err(err) => {
                    self.refuse(from, err);
                    return Ok(());
                }
            },
        };
        let inside = match listing(from) {
            Ok(inside) => inside,
            Err(err) => {
                self.refuse(from, err);
                return Ok(());
            }
        };
        for entry in inside {
            if self.stopped() {
                break;
            }
            self.bring(&entry, made, &to)?;
        }
        Ok(())
    }

    fn make_folder(&mut self, parent: i64, name: &str, to: &Path) -> Result<i64> {
        let _turn = super::turn();
        std::fs::create_dir(to).map_err(|err| match err.kind() {
            std::io::ErrorKind::AlreadyExists => taken(self.conn, parent, name, true),
            _ => err.into(),
        })?;
        let made = in_transaction(self.conn, |tx| {
            let id = folders::create(tx, parent, name)?;
            let copied = FolderCopied {
                folder_id: id,
                parent_id: parent,
                into: self.into,
            };
            journal::record_folder_copy(tx, self.batch_id, &copied)?;
            Ok(id)
        });
        if made.is_err() {
            let _ = std::fs::remove_dir(to);
        }
        let id = made?;
        self.ours.folders.insert(id);
        Ok(id)
    }

    fn bring_file(&mut self, from: &Path, folder: i64, dir: &Path) -> Result<()> {
        let name = file_name(from);
        if let Some(held) = items::existing_by_disk_name(self.conn, folder, &name)?
            && !held.deleted
        {
            if self.ours.items.contains(&held.id) {
                self.settle(1);
            } else {
                self.refuse(from, taken(self.conn, folder, &name, false));
            }
            return Ok(());
        }
        let to = dir.join(&name);
        if to.exists() {
            self.refuse(from, taken(self.conn, folder, &name, false));
            return Ok(());
        }
        // Hidden, so a walk that reads this directory meanwhile passes it over.
        let part = dir.join(format!(".{}.filmstrip-part", self.batch_id));
        self.visited.insert(part.clone());
        match copy_bytes(from, &part, self.control) {
            Ok(true) => {}
            Ok(false) => {
                let _ = std::fs::remove_file(&part);
                self.halted = Some(Halt::Stop);
                return Ok(());
            }
            Err(err) => {
                let _ = std::fs::remove_file(&part);
                self.refuse(from, err);
                return Ok(());
            }
        }
        match self.land(&part, &to, folder) {
            Ok(id) => {
                self.ours.items.insert(id);
                self.settle(1);
            }
            Err(err) => {
                let _ = std::fs::remove_file(&part);
                self.refuse(from, err);
            }
        }
        Ok(())
    }

    /// The whole copy given its own name, then recorded as a walk would, with its journal row.
    fn land(&self, part: &Path, to: &Path, folder: i64) -> Result<i64> {
        let _turn = super::turn();
        let name = file_name(to);
        let held = items::existing_by_disk_name(self.conn, folder, &name)?;
        // A rename onto a file would replace it, so the name is looked at once more, in the turn.
        if held.as_ref().is_some_and(|row| !row.deleted) || to.exists() {
            return Err(taken(self.conn, folder, &name, false));
        }
        std::fs::rename(part, to)?;
        let recorded = in_transaction(self.conn, |tx| {
            // A retired row holding the name describes a file that is gone; the arriving one takes it.
            if let Some(stale) = &held {
                items::forget_retired(tx, stale.id)?;
            }
            let id = walk::index_arrival(tx, to, folder, self.source_id)?;
            let copied = ItemCopied {
                item_id: id,
                folder_id: folder,
                into: self.into,
            };
            journal::record_item_copy(tx, self.batch_id, &copied)?;
            self.control
                .landed(tx, id, walk::kind_of(&paths::extension_of(&name)))?;
            Ok(id)
        });
        if recorded.is_err() {
            let _ = std::fs::rename(to, part);
        }
        recorded
    }

    /// A copy cut short by a crash leaves its part under a hidden name; a later run that reaches
    /// that directory reuses the name, and this clears any it did not reach.
    fn tidy(&self) {
        for part in &self.visited {
            let _ = std::fs::remove_file(part);
        }
    }
}

/// Copies a file's bytes to `to`, replacing a part left there before. `false` when the app began
/// closing partway; the caller removes what was written.
fn copy_bytes(from: &Path, to: &Path, control: &impl Control) -> Result<bool> {
    let mut source = std::fs::File::open(from)?;
    let meta = source.metadata()?;
    let mut target = std::fs::File::create(to)?;
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
    use crate::db::{self, items as rows};
    use crate::fs::acts::Act;
    use crate::fs::stayed::Whereabouts;
    use crate::fs::undo;
    use std::cell::Cell;

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

    /// Runs to the end, or halts as told once `after` files have settled, or at its `at_look`th
    /// look, which can fall inside the copy of one file's bytes.
    #[derive(Default)]
    struct Script {
        after: Option<(u32, Halt)>,
        at_look: Option<u32>,
        looks: Cell<u32>,
        done: Cell<u32>,
        landed: Cell<u32>,
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
                dir: dir.join("Downloads").to_string_lossy().into_owned()
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
