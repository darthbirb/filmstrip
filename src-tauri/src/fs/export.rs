//! A folder's branch or a set of files copied into one zip, stored rather than compressed. The
//! library is only read, a file on a drive that is away is skipped, and the zip is written beside
//! its name and put in place whole, only under a name still free. DECISIONS.md "Exporting a zip".

use std::collections::hash_map::Entry as Slot;
use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Datelike, Local, TimeZone, Timelike, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::db::sources::{self, SourceKind};
use crate::db::{folders, items};
use crate::error::{AppError, Reason, Result};
use crate::fs::paste::Halt;
use crate::fs::stayed::{self, Stayed, Thing, Whereabouts};
use crate::fs::{noclobber, paths, sanitize};

const CHUNK: usize = 1 << 20;
const STAMP: &str = "%Y-%m-%d-%H-%M-%S";
/// What a file at a sorting source's top level is named for, as the Sorting Box shows it.
const SORTING_BOX: &str = "Sorting Box";

/// How the files are named in the zip: their own names, or from their folder and when each was taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Naming {
    Keep,
    Folders,
}

/// What goes into the zip: a folder's whole branch, under the folder, or checked files, each under
/// its path from its source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Scope {
    Branch {
        #[serde(rename = "folderId")]
        folder_id: i64,
    },
    Files {
        #[serde(rename = "itemIds")]
        item_ids: Vec<i64>,
    },
}

/// One file as it goes into the zip, under either naming.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub item_id: i64,
    /// The folders it sits under in the zip, from the top.
    pub dir: Vec<String>,
    pub keep: String,
    pub folders: String,
    mtime: i64,
}

impl Entry {
    pub fn name(&self, naming: Naming) -> String {
        let name = match naming {
            Naming::Keep => &self.keep,
            Naming::Folders => &self.folders,
        };
        format!("{}/{name}", self.dir.join("/"))
    }
}

/// Every file of a scope that can be read, in the zip's order, and those on a drive that is away.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gathered {
    pub entries: Vec<Entry>,
    pub away: Vec<Stayed>,
    /// The sources away, by title, each once.
    pub offline: Vec<String>,
}

/// What the sheet says before anything is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Plan {
    Ready {
        whole: u32,
        away: u32,
        offline: Vec<String>,
        first: First,
    },
    /// Every file is on a drive that is away, so nothing could go in.
    Away {
        files: u32,
        offline: Vec<String>,
    },
    Empty,
}

/// The first file as it will be in the zip: its folders, then its name under each naming.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct First {
    pub dir: String,
    pub keep: String,
    pub folders: String,
}

pub fn plan(conn: &Connection, scope: &Scope) -> Result<Plan> {
    let gathered = gather(conn, scope)?;
    let away = count(gathered.away.len());
    let Some(first) = gathered.entries.first() else {
        return Ok(if away > 0 {
            Plan::Away {
                files: away,
                offline: gathered.offline,
            }
        } else {
            Plan::Empty
        });
    };
    Ok(Plan::Ready {
        whole: count(gathered.entries.len()) + away,
        away,
        offline: gathered.offline.clone(),
        first: First {
            dir: format!("{}/", first.dir.join("/")),
            keep: first.keep.clone(),
            folders: first.folders.clone(),
        },
    })
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// One file's row, live in the index.
struct Row {
    folder_id: i64,
    disk_name: String,
    source_id: i64,
    captured_at: Option<i64>,
    captured_src: Option<String>,
    mtime: i64,
}

fn row_of(conn: &Connection, item_id: i64) -> Result<Option<Row>> {
    Ok(conn
        .query_row(
            "SELECT folder_id, disk_name, source_id, captured_at, captured_src, mtime
               FROM item WHERE id = ?1 AND deleted_at IS NULL",
            params![item_id],
            |r| {
                Ok(Row {
                    folder_id: r.get(0)?,
                    disk_name: r.get(1)?,
                    source_id: r.get(2)?,
                    captured_at: r.get(3)?,
                    captured_src: r.get(4)?,
                    mtime: r.get(5)?,
                })
            },
        )
        .optional()?)
}

/// A folder as the zip has it: its titles from its source down, the source by its own title.
struct Place {
    ids: Vec<i64>,
    titles: Vec<String>,
    /// What From Folders names its files for.
    named: String,
}

/// A source as an export needs it: its title, and whether its drive is here.
struct Held {
    title: String,
    here: bool,
}

/// Reads the scope's files from the index, never the disk but for whether each source is here.
pub fn gather(conn: &Connection, scope: &Scope) -> Result<Gathered> {
    let (ids, top) = match scope {
        Scope::Branch { folder_id } => {
            (items::branch_ids(conn, *folder_id, true)?, Some(*folder_id))
        }
        Scope::Files { item_ids } => (item_ids.clone(), None),
    };
    let mut places: HashMap<i64, Place> = HashMap::new();
    let mut held: HashMap<i64, Held> = HashMap::new();
    let mut seen = HashSet::new();
    let mut gathered = Gathered {
        entries: Vec::new(),
        away: Vec::new(),
        offline: Vec::new(),
    };
    for id in ids {
        if !seen.insert(id) {
            continue;
        }
        let Some(row) = row_of(conn, id)? else {
            continue;
        };
        let source = match held.entry(row.source_id) {
            Slot::Occupied(known) => known.into_mut(),
            Slot::Vacant(new) => new.insert(held_of(conn, row.source_id)?),
        };
        let place = match places.entry(row.folder_id) {
            Slot::Occupied(known) => known.into_mut(),
            Slot::Vacant(new) => new.insert(place_of(conn, row.folder_id)?),
        };
        if !source.here {
            if !gathered.offline.contains(&source.title) {
                gathered.offline.push(source.title.clone());
            }
            gathered.away.push(Stayed {
                kind: Thing::File,
                id,
                name: row.disk_name,
                at: Whereabouts::Folder {
                    folder_id: row.folder_id,
                    path: place.titles.clone(),
                },
                reason: Reason::Offline {
                    source: source.title.clone(),
                },
            });
            continue;
        }
        let from = top
            .and_then(|top| place.ids.iter().position(|id| *id == top))
            .unwrap_or(0);
        let stamp = stamp(row.captured_at, row.captured_src.as_deref(), row.mtime);
        let folders = match row.disk_name.rsplit_once('.') {
            Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
                format!("{} - {stamp}.{ext}", place.named)
            }
            _ => format!("{} - {stamp}", place.named),
        };
        gathered.entries.push(Entry {
            item_id: id,
            dir: place.titles[from..]
                .iter()
                .map(|title| sanitize::folder_title(title))
                .collect(),
            keep: row.disk_name,
            folders: sanitize::file_name(&folders),
            mtime: row.mtime,
        });
    }
    settle(&mut gathered.entries);
    Ok(gathered)
}

fn held_of(conn: &Connection, source_id: i64) -> Result<Held> {
    let source = sources::get(conn, source_id)?
        .ok_or_else(|| AppError::invalid(format!("source {source_id} is not registered")))?;
    Ok(Held {
        here: Path::new(&source.root).is_dir(),
        title: source.title,
    })
}

fn place_of(conn: &Connection, folder_id: i64) -> Result<Place> {
    let crumbs = folders::ancestry(conn, folder_id)?;
    let named = if crumbs.len() > 1 {
        crumbs
            .last()
            .map(|crumb| crumb.title.clone())
            .unwrap_or_default()
    } else {
        let location = folders::location(conn, folder_id)?;
        let source = sources::get(conn, location.source_id)?;
        match source {
            Some(source) if source.kind == SourceKind::Sorting => SORTING_BOX.to_owned(),
            Some(source) => source.title,
            None => String::new(),
        }
    };
    Ok(Place {
        ids: crumbs.iter().map(|crumb| crumb.id).collect(),
        titles: crumbs.into_iter().map(|crumb| crumb.title).collect(),
        named,
    })
}

/// When a file was taken, as the pane shows it: a camera's clock as written, a container's time
/// and a modification time in the local zone. DECISIONS.md "Capture dates".
fn stamp(captured_at: Option<i64>, captured_src: Option<&str>, mtime: i64) -> String {
    let local = |at: i64| {
        Local
            .timestamp_opt(at, 0)
            .earliest()
            .map(|t| t.format(STAMP).to_string())
    };
    match captured_at {
        Some(at) if captured_src == Some("exif") => {
            DateTime::<Utc>::from_timestamp(at, 0).map(|t| t.format(STAMP).to_string())
        }
        Some(at) => local(at),
        None => local(mtime),
    }
    .unwrap_or_else(|| "0000-00-00-00-00-00".to_owned())
}

/// A name already given in a folder of the zip takes (2), (3) after it, in the order the library
/// read the files, so the same files always get the same names; then the entries go in path order,
/// a folder's own files before its folders, names A to Z whatever the case.
fn settle(entries: &mut [Entry]) {
    let mut by_id: Vec<usize> = (0..entries.len()).collect();
    by_id.sort_by_key(|at| entries[*at].item_id);
    let mut keep: HashMap<String, HashSet<String>> = HashMap::new();
    let mut named: HashMap<String, HashSet<String>> = HashMap::new();
    for at in by_id {
        let entry = &mut entries[at];
        let dir = entry.dir.join("/").to_lowercase();
        entry.keep = free(keep.entry(dir.clone()).or_default(), &entry.keep);
        entry.folders = free(named.entry(dir).or_default(), &entry.folders);
    }
    entries.sort_by_cached_key(|entry| {
        let mut key: Vec<(u8, String)> = entry
            .dir
            .iter()
            .map(|title| (1, title.to_lowercase()))
            .collect();
        key.push((0, entry.keep.to_lowercase()));
        (key, entry.item_id)
    });
}

fn free(used: &mut HashSet<String>, name: &str) -> String {
    let name =
        sanitize::suffix_until_free(name, |candidate| used.contains(&candidate.to_lowercase()));
    used.insert(name.to_lowercase());
    name
}

/// What the export answers to while it runs: being stopped, and saying how far it has got.
pub trait Control {
    fn halt(&self) -> Option<Halt>;
    fn progress(&self, done: u32, whole: u32);
}

/// How an export ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum End {
    /// The zip is in place.
    Written,
    Cancelled,
    /// Nothing could be read, so there is no zip.
    Nothing,
    /// Something has the zip's name, so it was not put there.
    Taken,
    Failed {
        reason: Reason,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub whole: u32,
    pub written: u32,
    pub skipped: Vec<Stayed>,
    pub end: End,
    /// The app closed partway; the export is given up, not taken up again.
    pub closed: bool,
}

/// Where a zip is written before it is whole: hidden, beside its name, so a walk passes over it.
pub fn part_beside(dest: &Path) -> PathBuf {
    dest.with_file_name(format!(".{}.filmstrip-part", uuid::Uuid::new_v4().simple()))
}

/// Writes the zip at `part` and gives it `dest`'s name once whole. Whatever happens, nothing but
/// a whole zip is ever left behind.
pub fn run(
    conn: &Connection,
    scope: &Scope,
    naming: Naming,
    dest: &Path,
    part: &Path,
    control: &impl Control,
) -> Outcome {
    let ended = |whole, written, skipped, end| Outcome {
        whole,
        written,
        skipped,
        end,
        closed: false,
    };
    let gathered = match gather(conn, scope) {
        Ok(gathered) => gathered,
        Err(err) => return ended(0, 0, Vec::new(), failed(&err)),
    };
    let whole = count(gathered.entries.len() + gathered.away.len());
    let mut skipped = gathered.away;
    if std::fs::symlink_metadata(dest).is_ok() {
        return ended(whole, 0, skipped, End::Taken);
    }
    let mut writer = Writer {
        conn,
        control,
        whole,
        settled: count(skipped.len()),
        skipped: &mut skipped,
    };
    let wrote = writer.write(&gathered.entries, naming, part);
    let end = match wrote {
        Ok(Wrote::Halted(halt)) => {
            let _ = std::fs::remove_file(part);
            return Outcome {
                whole,
                written: 0,
                skipped,
                end: End::Cancelled,
                closed: halt == Halt::Stop,
            };
        }
        Ok(Wrote::Whole(0)) => {
            let _ = std::fs::remove_file(part);
            return ended(whole, 0, skipped, End::Nothing);
        }
        Ok(Wrote::Whole(written)) => match noclobber::rename(part, dest) {
            Ok(()) => return ended(whole, written, skipped, End::Written),
            Err(err) if err.kind() == ErrorKind::AlreadyExists => End::Taken,
            Err(err) => failed(&err.into()),
        },
        Err(err) => failed(&err),
    };
    let _ = std::fs::remove_file(part);
    ended(whole, 0, skipped, end)
}

fn failed(err: &AppError) -> End {
    End::Failed {
        reason: Reason::of(err),
    }
}

enum Wrote {
    Whole(u32),
    Halted(Halt),
}

/// A read that failed skips its file; a write that failed ends the export.
enum Fault {
    Read(AppError),
    Write(AppError),
}

struct Writer<'a, C: Control> {
    conn: &'a Connection,
    control: &'a C,
    whole: u32,
    settled: u32,
    skipped: &'a mut Vec<Stayed>,
}

impl<C: Control> Writer<'_, C> {
    fn write(&mut self, entries: &[Entry], naming: Naming, part: &Path) -> Result<Wrote> {
        self.control.progress(self.settled, self.whole);
        let file = OpenOptions::new().write(true).create_new(true).open(part)?;
        let mut zip = ZipWriter::new(BufWriter::new(file)).set_auto_large_file();
        let mut written = 0;
        for entry in entries {
            if let Some(halt) = self.control.halt() {
                return Ok(Wrote::Halted(halt));
            }
            match open(self.conn, entry.item_id) {
                Ok(source) => {
                    zip.start_file(entry.name(naming), options(entry.mtime))?;
                    match copy(source, &mut zip, self.control) {
                        Ok(Some(halt)) => return Ok(Wrote::Halted(halt)),
                        Ok(None) => written += 1,
                        Err(Fault::Read(err)) => {
                            zip.abort_file()?;
                            self.skip(entry, &err);
                        }
                        Err(Fault::Write(err)) => return Err(err),
                    }
                }
                Err(err) => self.skip(entry, &err),
            }
            self.settled += 1;
            self.control.progress(self.settled, self.whole);
        }
        let mut file = zip
            .finish()?
            .into_inner()
            .map_err(|err| AppError::Io(err.into_error()))?;
        file.flush()?;
        file.sync_all()?;
        Ok(Wrote::Whole(written))
    }

    fn skip(&mut self, entry: &Entry, err: &AppError) {
        let row = stayed::file(self.conn, entry.item_id, err).unwrap_or_else(|_| Stayed {
            kind: Thing::File,
            id: entry.item_id,
            name: entry.keep.clone(),
            at: Whereabouts::Folder {
                folder_id: 0,
                path: entry.dir.clone(),
            },
            reason: Reason::of(err),
        });
        self.skipped.push(row);
    }
}

/// Opens a file where the index has it now, so one moved since the export began goes in from
/// where it went.
fn open(conn: &Connection, item_id: i64) -> Result<File> {
    let (path, name) = where_now(conn, item_id)?;
    match File::open(&path) {
        Ok(file) => Ok(file),
        Err(err) if err.kind() == ErrorKind::NotFound => {
            // A move changes the disk, then the index, inside one turn: once the turn is ours,
            // the index says where the file went.
            let _turn = crate::fs::turn();
            let (path, name) = where_now(conn, item_id)?;
            File::open(&path).map_err(|err| missing(conn, item_id, &name, err))
        }
        Err(err) => Err(missing(conn, item_id, &name, err)),
    }
}

fn where_now(conn: &Connection, item_id: i64) -> Result<(PathBuf, String)> {
    let row = row_of(conn, item_id)?.ok_or_else(|| {
        AppError::refused(Reason::NotOnDisk {
            name: items::file_of(conn, item_id)
                .ok()
                .flatten()
                .map(|file| file.disk_name)
                .unwrap_or_default(),
        })
    })?;
    Ok((
        paths::item_path(conn, row.folder_id, &row.disk_name)?,
        row.disk_name,
    ))
}

/// Why a file could not be opened: its drive gone away since, the file gone, or what the disk said.
fn missing(conn: &Connection, item_id: i64, name: &str, err: std::io::Error) -> AppError {
    if let Ok(Some(row)) = row_of(conn, item_id)
        && let Ok(source) = held_of(conn, row.source_id)
        && !source.here
    {
        return AppError::refused(Reason::Offline {
            source: source.title,
        });
    }
    if err.kind() == ErrorKind::NotFound {
        return AppError::refused(Reason::NotOnDisk {
            name: name.to_owned(),
        });
    }
    err.into()
}

/// Stored, since pictures and videos are compressed already, and dated as the file is.
fn options(mtime: i64) -> SimpleFileOptions {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let dated = Local.timestamp_opt(mtime, 0).earliest().and_then(|at| {
        zip::DateTime::from_date_and_time(
            u16::try_from(at.year()).ok()?,
            u8::try_from(at.month()).ok()?,
            u8::try_from(at.day()).ok()?,
            u8::try_from(at.hour()).ok()?,
            u8::try_from(at.minute()).ok()?,
            u8::try_from(at.second()).ok()?,
        )
        .ok()
    });
    match dated {
        Some(at) => options.last_modified_time(at),
        None => options,
    }
}

/// Copies one file's bytes, looking between each chunk for a reason to stop.
fn copy(
    mut source: File,
    zip: &mut impl Write,
    control: &impl Control,
) -> std::result::Result<Option<Halt>, Fault> {
    let mut buffer = vec![0; CHUNK];
    loop {
        if let Some(halt) = control.halt() {
            return Ok(Some(halt));
        }
        let read = match source.read(&mut buffer) {
            Ok(0) => return Ok(None),
            Ok(read) => read,
            Err(err) if err.kind() == ErrorKind::Interrupted => continue,
            Err(err) => return Err(Fault::Read(err.into())),
        };
        zip.write_all(&buffer[..read])
            .map_err(|err| Fault::Write(err.into()))?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, sources::SourceKind};
    use crate::fs::walk;
    use std::cell::{Cell, RefCell};

    /// Pictures holds cover.jpg and Trips, with two files and Cairo under it; the Sorting Box's
    /// Inbox holds one; Archive is a source whose drive has gone away.
    struct Library {
        conn: Connection,
        dir: PathBuf,
        trips: i64,
    }

    fn library(name: &str) -> Library {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-export")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        for (path, bytes) in [
            ("pictures/cover.jpg", "cover"),
            ("pictures/Trips/hotel.jpg", "hotel"),
            ("pictures/Trips/boarding-pass.png", "boarding"),
            ("pictures/Trips/Cairo/pyramid.jpg", "pyramid"),
            ("pictures/Trips/Cairo/Sphinx.jpg", "sphinx"),
            ("pictures/Trips/Cairo/felucca.mp4", "felucca"),
            ("inbox/DSC_0001.jpg", "dsc"),
            ("archive/Scans/page 001.tif", "page"),
        ] {
            let path = dir.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(
            &conn,
            &dir.join("pictures"),
            "Pictures",
            SourceKind::Library,
        )
        .unwrap();
        sources::add(&conn, &dir.join("inbox"), "Inbox", SourceKind::Sorting).unwrap();
        sources::add(&conn, &dir.join("archive"), "Archive", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        std::fs::rename(dir.join("archive"), dir.join("unplugged")).unwrap();
        std::fs::create_dir_all(dir.join("Exports")).unwrap();
        let top = folders::source_root_folder(&conn, 1).unwrap();
        let trips = folders::child_id(&conn, top, "Trips").unwrap().unwrap();
        Library { conn, dir, trips }
    }

    impl Library {
        fn id(&self, name: &str) -> i64 {
            self.conn
                .query_row("SELECT id FROM item WHERE disk_name = ?1", [name], |r| {
                    r.get(0)
                })
                .unwrap()
        }

        /// Taken by a camera at this moment of its clock.
        fn taken(&self, name: &str, (y, mo, d, h, mi, s): (i32, u32, u32, u32, u32, u32)) {
            let at = Utc
                .with_ymd_and_hms(y, mo, d, h, mi, s)
                .unwrap()
                .timestamp();
            self.conn
                .execute(
                    "UPDATE item SET captured_at = ?1, captured_src = 'exif' WHERE disk_name = ?2",
                    params![at, name],
                )
                .unwrap();
        }

        /// A file with no date taken goes by when it was modified, in the local zone.
        fn modified(&self, name: &str) -> String {
            let mtime: i64 = self
                .conn
                .query_row("SELECT mtime FROM item WHERE disk_name = ?1", [name], |r| {
                    r.get(0)
                })
                .unwrap();
            stamp(None, None, mtime)
        }

        fn export(&self, scope: &Scope, naming: Naming, script: &Script) -> (Outcome, PathBuf) {
            let dest = self.dir.join("Exports/Trips.zip");
            let part = part_beside(&dest);
            let outcome = run(&self.conn, scope, naming, &dest, &part, script);
            assert!(!part.exists(), "the part never outlives the export");
            (outcome, dest)
        }

        fn leftovers(&self) -> Vec<String> {
            std::fs::read_dir(self.dir.join("Exports"))
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .collect()
        }
    }

    type Meanwhile = Box<dyn FnOnce()>;

    /// Runs to the end, or halts as told once `after` files have settled; `meanwhile` runs once,
    /// as the given number of files have settled.
    #[derive(Default)]
    struct Script {
        after: Option<(u32, Halt)>,
        done: Cell<u32>,
        meanwhile: RefCell<Option<(u32, Meanwhile)>>,
    }

    impl Control for Script {
        fn halt(&self) -> Option<Halt> {
            self.after
                .filter(|(after, _)| self.done.get() >= *after)
                .map(|(_, halt)| halt)
        }
        fn progress(&self, done: u32, _whole: u32) {
            self.done.set(done);
            let due = self
                .meanwhile
                .borrow()
                .as_ref()
                .is_some_and(|(at, _)| *at == done);
            if due && let Some((_, then)) = self.meanwhile.borrow_mut().take() {
                then();
            }
        }
    }

    fn meanwhile(at: u32, then: impl FnOnce() + 'static) -> Script {
        Script {
            meanwhile: RefCell::new(Some((at, Box::new(then)))),
            ..Script::default()
        }
    }

    /// Each entry's name and bytes, in the zip's own order, every one stored.
    fn held(zip: &Path) -> Vec<(String, String)> {
        let mut archive = zip::ZipArchive::new(File::open(zip).unwrap()).unwrap();
        (0..archive.len())
            .map(|at| {
                let mut entry = archive.by_index(at).unwrap();
                assert_eq!(entry.compression(), CompressionMethod::Stored);
                let mut bytes = String::new();
                entry.read_to_string(&mut bytes).unwrap();
                (entry.name().unwrap().into_owned(), bytes)
            })
            .collect()
    }

    fn names(zip: &Path) -> Vec<String> {
        held(zip).into_iter().map(|(name, _)| name).collect()
    }

    #[test]
    fn a_branch_keeps_its_tree_under_the_folder_in_path_order() {
        let lib = library("branch");
        let (outcome, zip) = lib.export(
            &Scope::Branch {
                folder_id: lib.trips,
            },
            Naming::Keep,
            &Script::default(),
        );
        assert_eq!(outcome.end, End::Written);
        assert_eq!((outcome.whole, outcome.written), (5, 5));
        assert!(outcome.skipped.is_empty());
        assert_eq!(
            held(&zip),
            [
                ("Trips/boarding-pass.png", "boarding"),
                ("Trips/hotel.jpg", "hotel"),
                ("Trips/Cairo/felucca.mp4", "felucca"),
                ("Trips/Cairo/pyramid.jpg", "pyramid"),
                ("Trips/Cairo/Sphinx.jpg", "sphinx"),
            ]
            .map(|(name, bytes)| (name.to_owned(), bytes.to_owned()))
        );
        assert!(
            lib.dir.join("pictures/Trips/Cairo/pyramid.jpg").is_file(),
            "the library is only read"
        );
        assert_eq!(lib.leftovers(), ["Trips.zip"]);
    }

    #[test]
    fn from_folders_names_each_file_from_its_folder_and_when_it_was_taken() {
        let lib = library("from-folders");
        lib.taken("pyramid.jpg", (2024, 6, 12, 10, 25, 21));
        let set = [
            "DSC_0001.jpg",
            "pyramid.jpg",
            "cover.jpg",
            "boarding-pass.png",
        ];
        let (outcome, zip) = lib.export(
            &Scope::Files {
                item_ids: set.iter().map(|name| lib.id(name)).collect(),
            },
            Naming::Folders,
            &Script::default(),
        );
        assert_eq!(outcome.end, End::Written);
        assert_eq!(
            names(&zip),
            [
                format!("Inbox/Sorting Box - {}.jpg", lib.modified("DSC_0001.jpg")),
                format!("Pictures/Pictures - {}.jpg", lib.modified("cover.jpg")),
                format!(
                    "Pictures/Trips/Trips - {}.png",
                    lib.modified("boarding-pass.png")
                ),
                "Pictures/Trips/Cairo/Cairo - 2024-06-12-10-25-21.jpg".to_owned(),
            ]
        );
    }

    #[test]
    fn two_from_one_folder_in_the_same_second_take_2_in_the_order_the_library_read_them() {
        let lib = library("collision");
        std::fs::write(lib.dir.join("pictures/Trips/Cairo/aswan.jpg"), "aswan").unwrap();
        walk::reconcile(&lib.conn).unwrap();
        assert!(lib.id("aswan.jpg") > lib.id("pyramid.jpg"), "read after it");
        lib.taken("pyramid.jpg", (2024, 6, 12, 10, 25, 21));
        lib.taken("aswan.jpg", (2024, 6, 12, 10, 25, 21));
        let scope = Scope::Branch {
            folder_id: lib.trips,
        };
        let (_, zip) = lib.export(&scope, Naming::Folders, &Script::default());
        let cairo: Vec<(String, String)> = held(&zip)
            .into_iter()
            .filter(|(name, _)| name.starts_with("Trips/Cairo/Cairo - 2024"))
            .collect();
        assert_eq!(
            cairo,
            [
                ("Trips/Cairo/Cairo - 2024-06-12-10-25-21 (2).jpg", "aswan"),
                ("Trips/Cairo/Cairo - 2024-06-12-10-25-21.jpg", "pyramid"),
            ]
            .map(|(name, bytes)| (name.to_owned(), bytes.to_owned()))
        );

        let again = gather(&lib.conn, &scope).unwrap();
        assert_eq!(
            again,
            gather(&lib.conn, &scope).unwrap(),
            "the same input, the same names"
        );
        let mut names: Vec<String> = again
            .entries
            .iter()
            .map(|e| e.name(Naming::Folders))
            .collect();
        let whole = names.len();
        names.sort_by_key(|name| name.to_lowercase());
        names.dedup_by_key(|name| name.to_lowercase());
        assert_eq!(names.len(), whole, "every name in the zip is its own");
    }

    #[test]
    fn a_cancel_or_the_app_closing_leaves_no_zip_and_no_part() {
        let lib = library("cancel");
        let scope = Scope::Branch {
            folder_id: lib.trips,
        };
        for halt in [Halt::Cancel, Halt::Stop] {
            let script = Script {
                after: Some((2, halt)),
                ..Script::default()
            };
            let (outcome, zip) = lib.export(&scope, Naming::Keep, &script);
            assert_eq!(outcome.end, End::Cancelled);
            assert_eq!(outcome.closed, halt == Halt::Stop);
            assert!(!zip.exists());
            assert!(lib.leftovers().is_empty(), "{:?}", lib.leftovers());
        }
    }

    #[test]
    fn a_file_on_a_drive_that_is_away_is_skipped_and_said_before_anything_is_written() {
        let lib = library("offline");
        let page = lib.id("page 001.tif");
        let mixed = Scope::Files {
            item_ids: vec![lib.id("cover.jpg"), page],
        };
        assert_eq!(
            plan(&lib.conn, &mixed).unwrap(),
            Plan::Ready {
                whole: 2,
                away: 1,
                offline: vec!["Archive".into()],
                first: First {
                    dir: "Pictures/".into(),
                    keep: "cover.jpg".into(),
                    folders: format!("Pictures - {}.jpg", lib.modified("cover.jpg")),
                },
            }
        );
        let away = Scope::Files {
            item_ids: vec![page],
        };
        assert_eq!(
            plan(&lib.conn, &away).unwrap(),
            Plan::Away {
                files: 1,
                offline: vec!["Archive".into()],
            }
        );

        let (outcome, zip) = lib.export(&mixed, Naming::Keep, &Script::default());
        assert_eq!(outcome.end, End::Written);
        assert_eq!((outcome.whole, outcome.written), (2, 1));
        let [skipped] = outcome.skipped.as_slice() else {
            panic!("{:?}", outcome.skipped)
        };
        assert_eq!(skipped.name, "page 001.tif");
        assert_eq!(
            skipped.reason,
            Reason::Offline {
                source: "Archive".into()
            }
        );
        assert!(
            matches!(&skipped.at, Whereabouts::Folder { path, .. } if path == &["Archive", "Scans"])
        );
        assert_eq!(names(&zip), ["Pictures/cover.jpg"]);
    }

    #[test]
    fn a_name_taken_before_or_while_the_zip_was_written_is_never_replaced() {
        let lib = library("taken");
        let scope = Scope::Branch {
            folder_id: lib.trips,
        };
        let dest = lib.dir.join("Exports/Trips.zip");
        std::fs::write(&dest, "theirs").unwrap();
        let (outcome, _) = lib.export(&scope, Naming::Keep, &Script::default());
        assert_eq!(outcome.end, End::Taken);
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "theirs");
        assert_eq!(lib.leftovers(), ["Trips.zip"]);

        std::fs::remove_file(&dest).unwrap();
        let theirs = dest.clone();
        let script = meanwhile(3, move || std::fs::write(theirs, "theirs").unwrap());
        let (outcome, _) = lib.export(&scope, Naming::Keep, &script);
        assert_eq!(outcome.end, End::Taken);
        assert_eq!(std::fs::read_to_string(&dest).unwrap(), "theirs");
        assert_eq!(lib.leftovers(), ["Trips.zip"]);
    }

    #[test]
    fn a_file_that_cannot_be_read_is_skipped_with_why_and_the_rest_go_in() {
        let lib = library("unreadable");
        std::fs::remove_file(lib.dir.join("pictures/Trips/hotel.jpg")).unwrap();
        let (outcome, zip) = lib.export(
            &Scope::Branch {
                folder_id: lib.trips,
            },
            Naming::Keep,
            &Script::default(),
        );
        assert_eq!(outcome.end, End::Written);
        assert_eq!((outcome.whole, outcome.written), (5, 4));
        let [skipped] = outcome.skipped.as_slice() else {
            panic!("{:?}", outcome.skipped)
        };
        assert_eq!(
            (skipped.name.as_str(), &skipped.reason),
            (
                "hotel.jpg",
                &Reason::NotOnDisk {
                    name: "hotel.jpg".into()
                }
            )
        );
        assert!(!names(&zip).contains(&"Trips/hotel.jpg".to_owned()));
    }

    #[cfg(windows)]
    #[test]
    fn a_file_that_fails_partway_through_leaves_no_half_entry_and_the_rest_go_in() {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::LockFile;
        let lib = library("cut-short");
        let pyramid = lib.dir.join("pictures/Trips/Cairo/pyramid.jpg");
        std::fs::write(&pyramid, vec![b'p'; 2 * CHUNK]).unwrap();
        // Another handle locks all past the first chunk: that chunk reads, the next one fails.
        let locker = File::open(&pyramid).unwrap();
        let chunk = u32::try_from(CHUNK).unwrap();
        assert_ne!(
            unsafe { LockFile(locker.as_raw_handle(), chunk, 0, u32::MAX, 0) },
            0
        );
        let (outcome, zip) = lib.export(
            &Scope::Files {
                item_ids: vec![lib.id("pyramid.jpg"), lib.id("Sphinx.jpg")],
            },
            Naming::Keep,
            &Script::default(),
        );
        assert_eq!(outcome.end, End::Written);
        assert_eq!((outcome.whole, outcome.written), (2, 1));
        let [skipped] = outcome.skipped.as_slice() else {
            panic!("{:?}", outcome.skipped)
        };
        assert_eq!(
            (skipped.name.as_str(), &skipped.reason),
            ("pyramid.jpg", &Reason::InUse)
        );
        assert_eq!(names(&zip), ["Pictures/Trips/Cairo/Sphinx.jpg"]);
        assert_eq!(
            held(&zip),
            [("Pictures/Trips/Cairo/Sphinx.jpg".into(), "sphinx".into())]
        );
    }

    #[test]
    fn a_file_moved_after_the_export_began_goes_in_from_where_it_went() {
        let lib = library("moved");
        let pyramid = lib.id("pyramid.jpg");
        let db = lib.dir.join("library.db");
        let trips = lib.trips;
        let script = meanwhile(1, move || {
            let conn = db::open(&db).unwrap();
            crate::fs::items::move_items(&conn, &[pyramid], trips, "moved").unwrap();
        });
        let (outcome, zip) = lib.export(
            &Scope::Branch {
                folder_id: lib.trips,
            },
            Naming::Keep,
            &script,
        );
        assert!(lib.dir.join("pictures/Trips/pyramid.jpg").is_file());
        assert_eq!((outcome.end, outcome.written), (End::Written, 5));
        assert!(held(&zip).contains(&("Trips/Cairo/pyramid.jpg".into(), "pyramid".into())));
    }

    #[test]
    fn a_file_caught_halfway_through_a_move_goes_in_once_the_move_has_ended() {
        let lib = library("mid-move");
        let pyramid = lib.id("pyramid.jpg");
        let db = lib.dir.join("library.db");
        let (from, to) = (
            lib.dir.join("pictures/Trips/Cairo/pyramid.jpg"),
            lib.dir.join("pictures/Trips/pyramid.jpg"),
        );
        let trips = lib.trips;
        let mover = std::rc::Rc::new(RefCell::new(None));
        let joined = mover.clone();
        let script = meanwhile(1, move || {
            let (moved, on_disk) = std::sync::mpsc::channel();
            *mover.borrow_mut() = Some(std::thread::spawn(move || {
                let _turn = crate::fs::turn();
                std::fs::rename(&from, &to).unwrap();
                moved.send(()).unwrap();
                std::thread::sleep(std::time::Duration::from_millis(300));
                db::open(&db)
                    .unwrap()
                    .execute(
                        "UPDATE item SET folder_id = ?1 WHERE id = ?2",
                        params![trips, pyramid],
                    )
                    .unwrap();
            }));
            on_disk.recv().unwrap();
        });
        let (outcome, zip) = lib.export(
            &Scope::Branch {
                folder_id: lib.trips,
            },
            Naming::Keep,
            &script,
        );
        joined.borrow_mut().take().unwrap().join().unwrap();
        assert_eq!((outcome.end, outcome.written), (End::Written, 5));
        assert!(held(&zip).contains(&("Trips/Cairo/pyramid.jpg".into(), "pyramid".into())));
    }

    #[test]
    fn nothing_read_leaves_no_zip() {
        let lib = library("nothing");
        std::fs::remove_file(lib.dir.join("pictures/cover.jpg")).unwrap();
        let (outcome, zip) = lib.export(
            &Scope::Files {
                item_ids: vec![lib.id("cover.jpg")],
            },
            Naming::Keep,
            &Script::default(),
        );
        assert_eq!((outcome.end, outcome.skipped.len()), (End::Nothing, 1));
        assert!(!zip.exists());
        assert!(lib.leftovers().is_empty());
    }

    #[test]
    fn the_plan_shows_the_first_file_under_each_naming_and_an_empty_folder_has_none() {
        let lib = library("plan");
        assert_eq!(
            plan(
                &lib.conn,
                &Scope::Branch {
                    folder_id: lib.trips
                }
            )
            .unwrap(),
            Plan::Ready {
                whole: 5,
                away: 0,
                offline: Vec::new(),
                first: First {
                    dir: "Trips/".into(),
                    keep: "boarding-pass.png".into(),
                    folders: format!("Trips - {}.png", lib.modified("boarding-pass.png")),
                },
            }
        );
        let empty = folders::create(&lib.conn, lib.trips, "Empty").unwrap();
        assert_eq!(
            plan(&lib.conn, &Scope::Branch { folder_id: empty }).unwrap(),
            Plan::Empty
        );
    }

    #[test]
    fn a_camera_clock_is_named_as_written_and_a_modification_time_in_the_local_zone() {
        let at = Utc
            .with_ymd_and_hms(2024, 6, 12, 10, 25, 21)
            .unwrap()
            .timestamp();
        assert_eq!(stamp(Some(at), Some("exif"), 0), "2024-06-12-10-25-21");
        let local = Local
            .timestamp_opt(at, 0)
            .unwrap()
            .format(STAMP)
            .to_string();
        assert_eq!(stamp(Some(at), Some("container"), 0), local);
        assert_eq!(stamp(None, None, at), local);
    }
}
