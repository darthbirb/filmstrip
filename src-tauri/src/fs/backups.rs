//! The index's backups, in `data\backups` beside it: each written beside its name and given it
//! only once whole, the newest kept to a number, and any one restored over the index.
//! DECISIONS.md "Backing up the index".

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::backup::{self as index, InTrash};
use crate::error::{AppError, Reason, Result};
use crate::fs::noclobber;

const PREFIX: &str = "index-";
const SUFFIX: &str = ".db";
const PART: &str = ".part";
const DAY_SECS: i64 = 86_400;

/// How a backup was taken, which its name records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Taken {
    Launch,
    Hand,
    Restore,
}

impl Taken {
    const ALL: [Taken; 3] = [Taken::Launch, Taken::Hand, Taken::Restore];

    fn word(self) -> &'static str {
        match self {
            Taken::Launch => "launch",
            Taken::Hand => "hand",
            Taken::Restore => "restore",
        }
    }
}

/// One backup, as its row in Settings shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Backup {
    /// Its file's name, which is how a restore asks for it.
    pub name: String,
    /// When it was taken, in seconds.
    pub taken_at: i64,
    pub how: Taken,
    pub bytes: i64,
    /// False for a file a restore found it could not read, or that is no index at all.
    pub readable: bool,
}

/// What came of asking for a restore.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Restored {
    /// Swapped in, with the backup of the index as it was before: the way back.
    Restored { from: Backup, back: Backup },
    /// Refused before anything was written: it could not be read whole.
    Unreadable { from: Backup },
}

/// The backups as Settings lists them, with the number kept and the folder they are in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Shelved {
    pub backups: Vec<Backup>,
    pub keep: u32,
    pub dir: String,
    /// Whether one is being written now.
    pub writing: bool,
}

/// The folder of backups, and what the app knows of it beyond its files: whether one is being
/// written, which a restore found unreadable, and how the launch's backup ended.
pub struct Shelf {
    pub dir: PathBuf,
    writing: Arc<Mutex<()>>,
    refused: Mutex<HashSet<String>>,
    launch: Arc<(Mutex<Option<Option<Reason>>>, Condvar)>,
}

impl Shelf {
    pub fn new(dir: PathBuf) -> Shelf {
        Shelf {
            dir,
            writing: Arc::default(),
            refused: Mutex::default(),
            launch: Arc::default(),
        }
    }

    pub fn shelved(&self, keep: u32) -> Result<Shelved> {
        Ok(Shelved {
            backups: list(&self.dir, &lock(&self.refused))?,
            keep,
            dir: self.dir.to_string_lossy().into_owned(),
            writing: self.writing.try_lock().is_err(),
        })
    }

    /// The lock one backup or restore at a time holds, shared with the thread that takes one.
    pub fn writing(&self) -> Arc<Mutex<()>> {
        Arc::clone(&self.writing)
    }

    pub fn refuse(&self, name: &str) {
        lock(&self.refused).insert(name.to_owned());
    }

    /// Says how the launch's backup ended: `None` when it was taken, or not due.
    pub fn launched(&self) -> impl FnOnce(Option<Reason>) + Send + 'static {
        let launch = Arc::clone(&self.launch);
        move |refused| {
            *lock(&launch.0) = Some(refused);
            launch.1.notify_all();
        }
    }

    /// Waits for the launch's backup to end, and says why it was refused, if it was.
    pub fn launch_refusal_waiter(&self) -> impl FnOnce() -> Option<Reason> + Send + 'static {
        let launch = Arc::clone(&self.launch);
        move || {
            let mut ended = lock(&launch.0);
            while ended.is_none() {
                ended = launch.1.wait(ended).unwrap_or_else(PoisonError::into_inner);
            }
            ended.clone().flatten()
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn name_of(ms: i64, how: Taken) -> String {
    format!("{PREFIX}{ms}-{}{SUFFIX}", how.word())
}

/// The moment and the way a backup's name records, or `None` for a file that is not one.
fn parse(name: &str) -> Option<(i64, Taken)> {
    let (ms, how) = name
        .strip_prefix(PREFIX)?
        .strip_suffix(SUFFIX)?
        .split_once('-')?;
    let how = Taken::ALL.into_iter().find(|taken| taken.word() == how)?;
    Some((ms.parse().ok()?, how))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}

/// What SQLite writes first in every database it makes.
fn looks_like_an_index(path: &Path) -> bool {
    let mut head = [0u8; 16];
    std::fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut head))
        .is_ok_and(|()| &head == b"SQLite format 3\0")
}

/// Every backup in the folder, newest first; `refused` names those a restore found unreadable.
pub fn list(dir: &Path, refused: &HashSet<String>) -> Result<Vec<Backup>> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err.into()),
    };
    let mut found: Vec<(i64, Backup)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((ms, how)) = parse(&name) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let readable = !refused.contains(&name) && looks_like_an_index(&entry.path());
        found.push((
            ms,
            Backup {
                name,
                taken_at: ms.div_euclid(1000),
                how,
                bytes: i64::try_from(meta.len()).unwrap_or(i64::MAX),
                readable,
            },
        ));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.name.cmp(&a.1.name)));
    Ok(found.into_iter().map(|(_, backup)| backup).collect())
}

/// The backup a name names, refused unless it is one of the folder's own.
pub fn find(dir: &Path, name: &str) -> Result<Backup> {
    list(dir, &HashSet::new())?
        .into_iter()
        .find(|backup| backup.name == name)
        .ok_or_else(|| AppError::invalid(format!("there is no backup named {name}")))
}

/// Takes a backup of the index, written beside its name and given it only once whole, so one
/// that fails leaves nothing half written. Nothing is rotated here.
pub fn take(conn: &Connection, dir: &Path, how: Taken) -> Result<Backup> {
    std::fs::create_dir_all(dir)?;
    let mut ms = now_ms();
    while Taken::ALL
        .into_iter()
        .any(|taken| dir.join(name_of(ms, taken)).exists())
    {
        ms += 1;
    }
    let name = name_of(ms, how);
    let part = dir.join(format!(".{name}{PART}"));
    remove_part(&part);
    let written = index::copy(conn, &part)
        .and_then(|()| noclobber::rename(&part, &dir.join(&name)).map_err(AppError::from));
    if let Err(err) = written {
        remove_part(&part);
        return Err(err);
    }
    let bytes = std::fs::metadata(dir.join(&name))?.len();
    Ok(Backup {
        name,
        taken_at: ms.div_euclid(1000),
        how,
        bytes: i64::try_from(bytes).unwrap_or(i64::MAX),
        readable: true,
    })
}

/// Takes a backup, then removes the oldest past the number kept.
pub fn back_up(conn: &Connection, dir: &Path, how: Taken, keep: u32) -> Result<Backup> {
    let taken = take(conn, dir, how)?;
    rotate(dir, keep, None)?;
    Ok(taken)
}

/// Removes every backup past the newest `keep`, oldest first, but never `spare`: the one a restore
/// has just restored, which stays past the number until the next backup.
pub fn rotate(dir: &Path, keep: u32, spare: Option<&str>) -> Result<()> {
    let keep = usize::try_from(keep).unwrap_or(usize::MAX);
    for backup in list(dir, &HashSet::new())?.into_iter().skip(keep).rev() {
        if spare != Some(backup.name.as_str()) {
            let _ = std::fs::remove_file(dir.join(&backup.name));
        }
    }
    Ok(())
}

/// Whether the launch takes one: none yet, or the newest over a day old, however it was taken.
pub fn due(dir: &Path) -> Result<bool> {
    Ok(list(dir, &HashSet::new())?
        .first()
        .is_none_or(|newest| now_ms().div_euclid(1000) - newest.taken_at > DAY_SECS))
}

/// Clears what a backup or a restore cut short by a crash left behind.
pub fn clear_parts(dir: &Path) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && name.contains(PART) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

fn remove_part(part: &Path) {
    let _ = std::fs::remove_file(part);
    let mut journal = part.as_os_str().to_owned();
    journal.push("-journal");
    let _ = std::fs::remove_file(PathBuf::from(journal));
}

/// Restores a backup over the live index: checked whole first, then `hold`, then the index backed
/// up as it is, then the swap; only after it the oldest go, never the one restored. A failure
/// leaves the index as it was. DECISIONS.md "Backing up the index".
pub fn restore<H>(
    live: &mut Connection,
    dir: &Path,
    name: &str,
    keep: u32,
    kept: &dyn Fn(&InTrash) -> bool,
    progress: &dyn Fn(f64),
    hold: impl FnOnce() -> Result<H>,
) -> Result<Restored> {
    let from = find(dir, name)?;
    let path = dir.join(name);
    if !index::is_whole(&path) {
        return Ok(Restored::Unreadable {
            from: Backup {
                readable: false,
                ..from
            },
        });
    }
    let _held = hold()?;
    let back = take(live, dir, Taken::Restore)?;
    progress(0.25);
    let staging = dir.join(format!(".restore{PART}"));
    remove_part(&staging);
    let swapped = swap(live, &path, &staging, kept, progress);
    remove_part(&staging);
    if let Err(err) = swapped {
        let _ = std::fs::remove_file(dir.join(&back.name));
        return Err(err);
    }
    rotate(dir, keep, Some(name))?;
    Ok(Restored::Restored { from, back })
}

fn swap(
    live: &mut Connection,
    from: &Path,
    staging: &Path,
    kept: &dyn Fn(&InTrash) -> bool,
    progress: &dyn Fn(f64),
) -> Result<()> {
    index::copy_file(from, staging)?;
    {
        let mut staged = Connection::open(staging)?;
        staged.pragma_update(None, "foreign_keys", "ON")?;
        crate::db::migrate(&mut staged)?;
        let trash = index::in_trash(live)?;
        index::settle(&mut staged, live, &trash, kept)?;
    }
    progress(0.5);
    index::copy_back(staging, live, &|done| progress(0.5 + done / 2.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, folders, items, journal, tags};
    use crate::fs::walk;
    use std::cell::Cell;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-backups")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("library/Trips/Cairo")).unwrap();
        dir
    }

    /// A library of two files in Trips › Cairo, walked, and the folder its backups go in.
    fn library(name: &str) -> (Connection, PathBuf, PathBuf) {
        let dir = scratch(name);
        std::fs::write(dir.join("library/Trips/Cairo/IMG_1.jpg"), "one").unwrap();
        std::fs::write(dir.join("library/Trips/Cairo/IMG_2.jpg"), "two").unwrap();
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let backups = dir.join("backups");
        (conn, dir, backups)
    }

    fn folder(conn: &Connection, titles: &[&str]) -> i64 {
        let mut here = folders::source_root_folder(conn, 1).unwrap();
        for title in titles {
            here = folders::child_id(conn, here, title).unwrap().unwrap();
        }
        here
    }

    fn item(conn: &Connection, name: &str) -> i64 {
        conn.query_row(
            "SELECT id FROM item WHERE disk_name = ?1 ORDER BY id DESC",
            [name],
            |r| r.get(0),
        )
        .unwrap()
    }

    fn uuid(conn: &Connection, id: i64) -> String {
        conn.query_row("SELECT uuid FROM item WHERE id = ?1", [id], |r| r.get(0))
            .unwrap()
    }

    fn own_tags(conn: &Connection, folder_id: i64) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT t.value FROM folder_tag ft JOIN tag t ON t.id = ft.tag_id
                  WHERE ft.folder_id = ?1 AND ft.source = 'manual' ORDER BY t.value",
            )
            .unwrap();
        stmt.query_map([folder_id], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    fn kinds(dir: &Path) -> Vec<Taken> {
        list(dir, &HashSet::new())
            .unwrap()
            .into_iter()
            .map(|backup| backup.how)
            .collect()
    }

    fn named(dir: &Path, ms: i64, how: Taken) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        dir.join(name_of(ms, how))
    }

    fn restoring(
        live: &mut Connection,
        dir: &Path,
        name: &str,
        keep: u32,
        held: &Cell<u32>,
    ) -> Result<Restored> {
        restore(live, dir, name, keep, &|_| true, &|_| {}, || {
            held.set(held.get() + 1);
            Ok(())
        })
    }

    #[test]
    fn a_backup_taken_while_the_index_is_written_is_whole() {
        let (conn, dir, backups) = library("while-writing");
        let cairo = folder(&conn, &["Trips", "Cairo"]);
        let path = dir.join("library.db");
        let writer = std::thread::spawn(move || {
            let conn = db::open(&path).unwrap();
            for n in 0..60 {
                tags::add_folder_tag(&conn, cairo, &format!("tag {n}")).unwrap();
            }
        });
        let mut taken = Vec::new();
        while !writer.is_finished() || taken.is_empty() {
            taken.push(take(&conn, &backups, Taken::Hand).unwrap());
        }
        writer.join().unwrap();

        for backup in &taken {
            let file = backups.join(&backup.name);
            assert!(index::is_whole(&file), "{} is whole", backup.name);
            let copy = Connection::open(&file).unwrap();
            let mode: String = copy
                .query_row("PRAGMA journal_mode", [], |r| r.get(0))
                .unwrap();
            assert_eq!(mode, "delete", "a backup stands as one file");
        }
        assert!(
            std::fs::read_dir(&backups)
                .unwrap()
                .flatten()
                .all(|entry| !entry.file_name().to_string_lossy().starts_with('.')),
            "no part is left behind"
        );
    }

    #[test]
    fn the_oldest_go_past_the_number_kept_and_never_the_one_spared() {
        let (conn, _dir, backups) = library("rotation");
        let taken: Vec<Backup> = (0..5)
            .map(|_| take(&conn, &backups, Taken::Hand).unwrap())
            .collect();
        assert_eq!(list(&backups, &HashSet::new()).unwrap().len(), 5);

        rotate(&backups, 3, Some(&taken[0].name)).unwrap();
        let left: Vec<String> = list(&backups, &HashSet::new())
            .unwrap()
            .into_iter()
            .map(|backup| backup.name)
            .collect();
        assert_eq!(
            left,
            [
                taken[4].name.clone(),
                taken[3].name.clone(),
                taken[2].name.clone(),
                taken[0].name.clone()
            ],
            "newest first, the spared one past the number"
        );

        back_up(&conn, &backups, Taken::Launch, 3).unwrap();
        assert_eq!(
            kinds(&backups),
            [Taken::Launch, Taken::Hand, Taken::Hand],
            "at the next backup it goes too"
        );
    }

    #[test]
    fn lowering_the_number_kept_removes_nothing_until_the_next_backup() {
        let (conn, _dir, backups) = library("lowered");
        for _ in 0..4 {
            back_up(&conn, &backups, Taken::Hand, 7).unwrap();
        }
        assert_eq!(list(&backups, &HashSet::new()).unwrap().len(), 4);
        back_up(&conn, &backups, Taken::Hand, 2).unwrap();
        assert_eq!(list(&backups, &HashSet::new()).unwrap().len(), 2);
    }

    #[test]
    fn the_launch_backs_up_when_there_is_none_or_the_newest_is_over_a_day_old() {
        let (conn, _dir, backups) = library("due");
        assert!(due(&backups).unwrap(), "none yet");
        let old = now_ms() - 2 * DAY_SECS * 1000;
        std::fs::write(named(&backups, old, Taken::Hand), b"x").unwrap();
        assert!(due(&backups).unwrap(), "two days old");
        take(&conn, &backups, Taken::Hand).unwrap();
        assert!(!due(&backups).unwrap(), "by hand counts");
    }

    #[test]
    fn only_the_apps_own_names_are_backups_and_a_crashs_parts_are_cleared() {
        let (_conn, _dir, backups) = library("names");
        std::fs::write(named(&backups, 5_000, Taken::Restore), b"x").unwrap();
        std::fs::write(backups.join("notes.txt"), b"mine").unwrap();
        std::fs::write(backups.join("index-12-other.db"), b"x").unwrap();
        std::fs::write(backups.join(".index-9-hand.db.part"), b"half").unwrap();
        let listed = list(&backups, &HashSet::new()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(
            (listed[0].taken_at, listed[0].how, listed[0].readable),
            (5, Taken::Restore, false),
            "a file that is no index is not readable"
        );
        clear_parts(&backups).unwrap();
        assert!(!backups.join(".index-9-hand.db.part").exists());
        assert!(
            backups.join("notes.txt").exists(),
            "nothing else is touched"
        );
    }

    #[test]
    fn a_restore_puts_the_index_back_and_keeps_the_way_back_as_the_newest() {
        let (mut conn, dir, backups) = library("restore");
        let cairo = folder(&conn, &["Trips", "Cairo"]);
        tags::add_folder_tag(&conn, cairo, "dawn").unwrap();
        let then = back_up(&conn, &backups, Taken::Hand, 7).unwrap();
        tags::add_folder_tag(&conn, cairo, "dusk").unwrap();
        let other = db::open(&dir.join("library.db")).unwrap();
        assert_eq!(own_tags(&other, cairo), ["dawn", "dusk"]);

        let held = Cell::new(0);
        let progress = Cell::new(0.0);
        let restored = restore(
            &mut conn,
            &backups,
            &then.name,
            7,
            &|_| true,
            &|done| progress.set(done),
            || {
                held.set(held.get() + 1);
                Ok(())
            },
        )
        .unwrap();
        let Restored::Restored { from, back } = restored else {
            panic!("restored");
        };
        assert_eq!(
            (from.name.as_str(), back.how),
            (then.name.as_str(), Taken::Restore)
        );
        assert_eq!((held.get(), progress.get()), (1, 1.0));
        assert_eq!(own_tags(&conn, cairo), ["dawn"]);
        assert_eq!(
            own_tags(&other, cairo),
            ["dawn"],
            "every connection reads it"
        );
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        assert_eq!(
            kinds(&backups),
            [Taken::Restore, Taken::Hand],
            "the index from before is the newest"
        );

        restoring(&mut conn, &backups, &back.name, 7, &held).unwrap();
        assert_eq!(
            own_tags(&conn, cairo),
            ["dawn", "dusk"],
            "and is the way back"
        );
    }

    #[test]
    fn a_backup_that_cannot_be_read_is_refused_before_anything_is_written() {
        let (mut conn, _dir, backups) = library("corrupt");
        let cairo = folder(&conn, &["Trips", "Cairo"]);
        let whole = take(&conn, &backups, Taken::Hand).unwrap();
        tags::add_folder_tag(&conn, cairo, "dusk").unwrap();
        let bytes = std::fs::read(backups.join(&whole.name)).unwrap();
        let cut = named(&backups, now_ms() + 10, Taken::Launch);
        std::fs::write(&cut, &bytes[..bytes.len() / 2]).unwrap();
        let mut scrambled = bytes.clone();
        for byte in scrambled.iter_mut().skip(100) {
            *byte = byte.wrapping_add(7);
        }
        let garbage = named(&backups, now_ms() + 20, Taken::Hand);
        std::fs::write(&garbage, scrambled).unwrap();

        let held = Cell::new(0);
        for file in [&cut, &garbage] {
            let name = file.file_name().unwrap().to_string_lossy().into_owned();
            let refused = restoring(&mut conn, &backups, &name, 7, &held).unwrap();
            assert!(
                matches!(&refused, Restored::Unreadable { from } if from.name == name && !from.readable),
                "{refused:?}"
            );
        }
        assert_eq!(held.get(), 0, "nothing was stopped");
        assert_eq!(own_tags(&conn, cairo), ["dusk"], "the index is untouched");
        assert_eq!(
            list(&backups, &HashSet::new()).unwrap().len(),
            3,
            "and no backup taken"
        );
    }

    #[test]
    fn a_restore_the_hold_refuses_writes_nothing() {
        let (mut conn, _dir, backups) = library("hold-refused");
        let then = take(&conn, &backups, Taken::Hand).unwrap();
        let refused = restore(
            &mut conn,
            &backups,
            &then.name,
            7,
            &|_| true,
            &|_| {},
            || Err::<(), _>(AppError::invalid("busy")),
        );
        assert!(refused.is_err());
        assert_eq!(kinds(&backups), [Taken::Hand]);
    }

    #[test]
    fn rotation_after_a_restore_waits_for_the_swap_and_spares_the_one_restored() {
        let (mut conn, _dir, backups) = library("restore-rotation");
        let oldest = take(&conn, &backups, Taken::Launch).unwrap();
        take(&conn, &backups, Taken::Launch).unwrap();
        take(&conn, &backups, Taken::Hand).unwrap();

        let held = Cell::new(0);
        restoring(&mut conn, &backups, &oldest.name, 3, &held).unwrap();
        let left = list(&backups, &HashSet::new()).unwrap();
        assert_eq!(left.len(), 4, "the one restored stays past the number");
        assert_eq!(left[3].name, oldest.name);
        assert_eq!(left[0].how, Taken::Restore);
    }

    #[test]
    fn a_restore_keeps_the_trash_as_it_is_now_with_its_folders_and_empties_the_queue() {
        let (mut conn, dir, backups) = library("trash");
        let cairo = folder(&conn, &["Trips", "Cairo"]);
        let one = item(&conn, "IMG_1.jpg");
        let two = item(&conn, "IMG_2.jpg");
        items::send_to_trash(&conn, two).unwrap();
        let journalled = journal::new_batch();
        journal::record_folder_create(&conn, &journalled, cairo, 1).unwrap();
        crate::jobs::enqueue_index(&conn).unwrap();
        let then = take(&conn, &backups, Taken::Hand).unwrap();

        items::send_to_trash(&conn, one).unwrap();
        items::take_from_trash(&conn, two).unwrap();
        std::fs::create_dir_all(dir.join("library/Trips/Later")).unwrap();
        std::fs::write(dir.join("library/Trips/Later/IMG_3.jpg"), "three").unwrap();
        std::fs::write(dir.join("library/IMG_4.jpg"), "four").unwrap();
        std::fs::create_dir_all(dir.join("Phone")).unwrap();
        std::fs::write(dir.join("Phone/IMG_5.jpg"), "five").unwrap();
        sources::add(&conn, &dir.join("Phone"), "Phone", SourceKind::Sorting).unwrap();
        walk::reconcile(&conn).unwrap();
        let three = item(&conn, "IMG_3.jpg");
        tags::add_item_tag(&conn, three, "sunset").unwrap();
        for name in ["IMG_3.jpg", "IMG_4.jpg", "IMG_5.jpg"] {
            items::send_to_trash(&conn, item(&conn, name)).unwrap();
        }
        folders::trash_subtree(&conn, folder(&conn, &["Trips", "Later"])).unwrap();
        let three_at: i64 = conn
            .query_row("SELECT trashed_at FROM item WHERE id = ?1", [three], |r| {
                r.get(0)
            })
            .unwrap();
        let one_uuid = uuid(&conn, one);
        let gone_uuid = uuid(&conn, item(&conn, "IMG_4.jpg"));

        restore(
            &mut conn,
            &backups,
            &then.name,
            7,
            &|kept| kept.uuid != gone_uuid,
            &|_| {},
            || Ok(()),
        )
        .unwrap();

        let later = folders::retired_child(&conn, folder(&conn, &["Trips"]), "Later")
            .unwrap()
            .expect("Later comes along, retired");
        let trash: Vec<(String, i64)> = {
            let mut stmt = conn
                .prepare(
                    "SELECT disk_name, folder_id FROM item
                      WHERE trashed_at IS NOT NULL ORDER BY disk_name",
                )
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert_eq!(
            trash,
            [
                ("IMG_1.jpg".to_string(), cairo),
                ("IMG_3.jpg".to_string(), later)
            ],
            "not IMG_2, back out of it; not IMG_4, whose file left it; not IMG_5, from a source \
             added since"
        );
        assert_eq!(uuid(&conn, item(&conn, "IMG_1.jpg")), one_uuid);
        let carried = item(&conn, "IMG_3.jpg");
        let at: i64 = conn
            .query_row(
                "SELECT trashed_at FROM item WHERE id = ?1",
                [carried],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(at, three_at, "with its days as they were");
        let carries: Vec<String> = tags::item_effective_tags(&conn, carried)
            .unwrap()
            .into_iter()
            .map(|tag| tag.value)
            .collect();
        assert!(carries.contains(&"sunset".to_string()), "{carries:?}");
        assert!(carries.contains(&"later".to_string()), "{carries:?}");
        let rows: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM item WHERE disk_name = 'IMG_2.jpg'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            rows, 0,
            "a trashed row whose file left the trash is dropped"
        );

        let jobs: i64 = conn
            .query_row("SELECT COUNT(*) FROM job", [], |r| r.get(0))
            .unwrap();
        assert_eq!(jobs, 0, "the queue starts empty");
        assert_eq!(journal::latest_batch(&conn).unwrap(), None);
        assert_eq!(sources::list(&conn).unwrap().len(), 1);
    }
}
