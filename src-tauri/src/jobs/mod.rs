//! The background queue: worker threads, each with its own connection, working through the job
//! table so the window never waits on a walk or a thumbnail. DECISIONS.md "Background work".

pub mod kinds;
pub mod worker;

use std::collections::{BTreeMap, HashSet};
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockWriteGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::{self, jobs as table};
use crate::error::{Reason, Result};
use crate::fs::acts::Batch;
use crate::fs::empty::{Counted, Emptied};
use crate::fs::export::{self, End, Naming, Scope};
use crate::fs::folders::{Contents, DeleteReport};
use crate::fs::stayed::Stayed;
use crate::fs::trash::TrashReport;
use crate::media::ffmpeg::Ffmpeg;

pub const PROGRESS_EVENT: &str = "job-progress";
pub const COPIED_EVENT: &str = "copy-done";
pub const EXPORTED_EVENT: &str = "export-done";
pub const MOVED_EVENT: &str = "move-done";
pub const DELETED_EVENT: &str = "delete-done";

const TICK: Duration = Duration::from_millis(500);
const IDLE: Duration = Duration::from_millis(150);
/// How long shutdown waits for a job in flight. One still running after that is left behind,
/// and the next launch puts it back in the queue, as after a crash.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);
const MIN_WORKERS: usize = 2;
const MAX_WORKERS: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Phase {
    Idle,
    Walking,
    Working,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Progress {
    pub phase: Phase,
    /// The walk's work and what it queued; a copy is not counted here.
    pub pending: i64,
    pub running: i64,
    pub failed: i64,
    /// Jobs finished since launch.
    pub completed: u64,
    /// Each copy running or waiting to, oldest first.
    pub copies: Vec<Copying>,
    /// Each export running or waiting to, oldest first.
    pub exports: Vec<Exporting>,
    /// Each move between drives running or waiting to, oldest first.
    pub moves: Vec<Moving>,
    /// Each delete and Empty Trash running or waiting to, oldest first.
    pub deletes: Vec<Deleting>,
    /// Walks finished since launch.
    pub walks: u64,
    /// The source a walk is reading, while one is.
    pub walked_source: Option<i64>,
    /// Items whose thumbnail or scrub frames were made since the last report.
    pub thumbed: Vec<i64>,
}

/// A copy in progress: where it is going, and how many of the files it carries are settled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Copying {
    pub job_id: i64,
    pub folder_id: i64,
    pub to: String,
    pub done: u32,
    pub whole: u32,
}

/// How a copy ended, as the line at the foot and the banner say it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Copied {
    pub job_id: i64,
    pub folder_id: i64,
    pub to: String,
    /// What came in, as one batch; nothing when nothing did.
    pub batch: Option<Batch>,
    /// Every file the copy carried, those that stayed out included.
    pub whole: u32,
    pub refused: Vec<Stayed>,
    pub cancelled: bool,
    /// Why it stopped before the end, when something other than Cancel stopped it.
    pub stopped: Option<Reason>,
}

/// A move between drives in progress: where it is going, and how many of the files it carries are
/// settled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Moving {
    pub job_id: i64,
    pub folder_id: i64,
    pub to: String,
    pub done: u32,
    pub whole: u32,
}

/// How a move between drives ended, as the line at the foot and the banner say it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Moved {
    pub job_id: i64,
    pub folder_id: i64,
    pub to: String,
    /// What went, as one batch; nothing when nothing did.
    pub batch: Option<Batch>,
    /// Every file the move carried, those that stayed included.
    pub whole: u32,
    pub refused: Vec<Stayed>,
    pub cancelled: bool,
    /// Why it stopped before the end, when something other than Cancel stopped it.
    pub stopped: Option<Reason>,
}

/// What a delete on the queue is deleting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DeleteKind {
    Files,
    Folder,
    Empty,
}

/// A delete in progress: what it deletes, the folder's name for a folder, and how many of its files
/// are settled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Deleting {
    pub job_id: i64,
    pub kind: DeleteKind,
    pub name: String,
    pub done: u32,
    pub whole: u32,
}

/// How a delete on the queue ended, as the line at the foot and the banner say it. One the app's
/// closing stopped says nothing until it ends at a later launch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Deleted {
    Files {
        #[serde(rename = "jobId")]
        job_id: i64,
        /// What went, as one batch; nothing when nothing did.
        batch: Option<Batch>,
        report: TrashReport,
        /// Every file it was asked to send.
        whole: u32,
        cancelled: bool,
        stopped: Option<Reason>,
    },
    Folder {
        #[serde(rename = "jobId")]
        job_id: i64,
        #[serde(rename = "folderId")]
        folder_id: i64,
        name: String,
        contents: Contents,
        batch: Option<Batch>,
        report: DeleteReport,
        /// Every file it held as it was asked.
        whole: u32,
        cancelled: bool,
        stopped: Option<Reason>,
    },
    Empty {
        #[serde(rename = "jobId")]
        job_id: i64,
        emptied: Emptied,
        /// Taken off the queue before it started, as a restore of the index does.
        cancelled: bool,
        stopped: Option<Reason>,
    },
}

/// An export in progress: the zip it is writing, and how many of its files are settled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Exporting {
    pub job_id: i64,
    pub zip: String,
    pub path: String,
    pub done: u32,
    pub whole: u32,
}

/// How an export ended, as the foot and the banner say it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Exported {
    pub job_id: i64,
    /// The zip, its name, and the folder it went into, by name and in full.
    pub path: String,
    pub zip: String,
    pub place: String,
    pub dir: String,
    /// Every file it was asked for, and how many went in.
    pub whole: u32,
    pub written: u32,
    pub skipped: Vec<Stayed>,
    pub end: End,
}

pub type Report = Box<dyn Fn(&Progress) + Send + Sync>;
pub type Announce = Box<dyn Fn(&Copied) + Send + Sync>;
pub type AnnounceExport = Box<dyn Fn(&Exported) + Send + Sync>;
pub type AnnounceMove = Box<dyn Fn(&Moved) + Send + Sync>;
pub type AnnounceDelete = Box<dyn Fn(&Deleted) + Send + Sync>;

pub struct QueueInner {
    db_path: PathBuf,
    thumbs: PathBuf,
    /// Videos are only read while this is here. DECISIONS.md "Video and ffmpeg".
    ffmpeg: Option<Ffmpeg>,
    stop: AtomicBool,
    /// Set while the index is being restored: no job starts, and a walk stops before its next
    /// directory.
    held: AtomicBool,
    /// Each job runs holding it to read; a hold takes it to write, so it waits out the jobs in flight.
    gate: RwLock<()>,
    walking: AtomicBool,
    walked_source: Mutex<Option<i64>>,
    walks: AtomicU64,
    completed: AtomicU64,
    thumbed: Mutex<Vec<i64>>,
    report: Report,
    announce: Announce,
    exported: AnnounceExport,
    moved: AnnounceMove,
    deleted: AnnounceDelete,
    copies: Mutex<BTreeMap<i64, Copying>>,
    exports: Mutex<BTreeMap<i64, Exporting>>,
    moves: Mutex<BTreeMap<i64, Moving>>,
    deletes: Mutex<BTreeMap<i64, Deleting>>,
    cancelled: Mutex<HashSet<i64>>,
}

impl QueueInner {
    #[expect(clippy::too_many_arguments)]
    fn new(
        db_path: PathBuf,
        thumbs: PathBuf,
        ffmpeg: Option<Ffmpeg>,
        report: Report,
        announce: Announce,
        exported: AnnounceExport,
        moved: AnnounceMove,
        deleted: AnnounceDelete,
    ) -> QueueInner {
        QueueInner {
            db_path,
            thumbs,
            ffmpeg,
            stop: AtomicBool::new(false),
            held: AtomicBool::new(false),
            gate: RwLock::new(()),
            walking: AtomicBool::new(false),
            walked_source: Mutex::new(None),
            walks: AtomicU64::new(0),
            completed: AtomicU64::new(0),
            thumbed: Mutex::new(Vec::new()),
            report,
            announce,
            exported,
            moved,
            deleted,
            copies: Mutex::new(BTreeMap::new()),
            exports: Mutex::new(BTreeMap::new()),
            moves: Mutex::new(BTreeMap::new()),
            deletes: Mutex::new(BTreeMap::new()),
            cancelled: Mutex::new(HashSet::new()),
        }
    }

    pub fn progress(&self, conn: &Connection) -> Result<Progress> {
        let counts = table::counts(conn)?;
        let phase = if self.walking.load(Ordering::Relaxed) {
            Phase::Walking
        } else if counts.pending + counts.running > 0 {
            Phase::Working
        } else {
            Phase::Idle
        };
        Ok(Progress {
            phase,
            pending: counts.pending,
            running: counts.running,
            failed: counts.failed,
            completed: self.completed.load(Ordering::Relaxed),
            copies: copies(conn, &lock(&self.copies))?,
            exports: exports(conn, &lock(&self.exports))?,
            moves: moves(conn, &lock(&self.moves))?,
            deletes: deletes(conn, &lock(&self.deletes))?,
            walks: self.walks.load(Ordering::Relaxed),
            walked_source: *lock(&self.walked_source),
            thumbed: Vec::new(),
        })
    }
}

impl QueueInner {
    fn cancel_copy(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        if let Some(payload) = table::cancel_pending(conn, job_id, kinds::COPY_IN)? {
            let payload: kinds::CopyPayload = serde_json::from_str(&payload)?;
            worker::cancel_waiting(self, conn, job_id, &payload)?;
            return Ok(true);
        }
        if !lock(&self.copies).contains_key(&job_id) {
            return Ok(false);
        }
        lock(&self.cancelled).insert(job_id);
        Ok(true)
    }

    fn cancel_move(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        if let Some(payload) = table::cancel_pending(conn, job_id, kinds::MOVE)? {
            let payload: kinds::MovePayload = serde_json::from_str(&payload)?;
            worker::moved_waiting(self, conn, job_id, &payload)?;
            return Ok(true);
        }
        if !lock(&self.moves).contains_key(&job_id) {
            return Ok(false);
        }
        lock(&self.cancelled).insert(job_id);
        Ok(true)
    }

    /// Takes a delete off the queue while it waits, or stops one running after the file in hand;
    /// an Empty Trash running is never stopped, since what has gone has gone.
    fn cancel_delete(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        for kind in kinds::DELETES {
            if let Some(payload) = table::cancel_pending(conn, job_id, kind)? {
                worker::deleted_waiting(self, conn, job_id, kind, &payload)?;
                return Ok(true);
            }
        }
        match lock(&self.deletes).get(&job_id) {
            Some(line) if line.kind != DeleteKind::Empty => {}
            _ => return Ok(false),
        }
        lock(&self.cancelled).insert(job_id);
        Ok(true)
    }

    fn cancel_export(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        if let Some(payload) = table::cancel_pending(conn, job_id, kinds::EXPORT)? {
            let payload: kinds::ExportPayload = serde_json::from_str(&payload)?;
            (self.exported)(&exported(
                job_id,
                &payload,
                export::Outcome {
                    whole: payload.whole,
                    written: 0,
                    skipped: Vec::new(),
                    end: End::Cancelled,
                    closed: false,
                },
            ));
            return Ok(true);
        }
        if !lock(&self.exports).contains_key(&job_id) {
            return Ok(false);
        }
        lock(&self.cancelled).insert(job_id);
        Ok(true)
    }
}

/// How an export ended, said of the zip it was writing.
fn exported(job_id: i64, payload: &kinds::ExportPayload, outcome: export::Outcome) -> Exported {
    let dest = Path::new(&payload.dest);
    let (zip, place, dir) = named(dest);
    Exported {
        job_id,
        path: payload.dest.clone(),
        zip,
        place,
        dir,
        whole: outcome.whole,
        written: outcome.written,
        skipped: outcome.skipped,
        end: outcome.end,
    }
}

/// A zip's own name, the name of the folder it is in, and that folder in full.
pub fn named(dest: &Path) -> (String, String, String) {
    let name = |path: &Path| {
        path.file_name()
            .map(|name| name.to_string_lossy().into_owned())
    };
    let dir = dest.parent().unwrap_or(dest);
    let full = dir.to_string_lossy().into_owned();
    (
        name(dest).unwrap_or_default(),
        name(dir).unwrap_or_else(|| full.clone()),
        full,
    )
}

/// Each export running, and each waiting its turn at none of its files settled, oldest first.
fn exports(conn: &Connection, running: &BTreeMap<i64, Exporting>) -> Result<Vec<Exporting>> {
    let mut exports: Vec<Exporting> = running.values().cloned().collect();
    for (job_id, payload) in table::waiting(conn, kinds::EXPORT)? {
        if running.contains_key(&job_id) {
            continue;
        }
        let Ok(payload) = serde_json::from_str::<kinds::ExportPayload>(&payload) else {
            continue;
        };
        exports.push(Exporting {
            job_id,
            zip: named(Path::new(&payload.dest)).0,
            path: payload.dest,
            done: 0,
            whole: payload.whole,
        });
    }
    exports.sort_by_key(|export| export.job_id);
    Ok(exports)
}

/// Each copy running, and each waiting its turn at none of its files settled, oldest first.
fn copies(conn: &Connection, running: &BTreeMap<i64, Copying>) -> Result<Vec<Copying>> {
    let mut copies: Vec<Copying> = running.values().cloned().collect();
    for (job_id, payload) in table::waiting_copies(conn)? {
        if running.contains_key(&job_id) {
            continue;
        }
        let Ok(payload) = serde_json::from_str::<kinds::CopyPayload>(&payload) else {
            continue;
        };
        copies.push(Copying {
            job_id,
            folder_id: payload.folder_id,
            to: crate::fs::acts::name(conn, payload.folder_id).unwrap_or_default(),
            done: 0,
            whole: payload.whole,
        });
    }
    copies.sort_by_key(|copy| copy.job_id);
    Ok(copies)
}

/// Each move running, and each waiting its turn at none of its files settled, oldest first.
fn moves(conn: &Connection, running: &BTreeMap<i64, Moving>) -> Result<Vec<Moving>> {
    let mut moves: Vec<Moving> = running.values().cloned().collect();
    for (job_id, payload) in table::waiting(conn, kinds::MOVE)? {
        if running.contains_key(&job_id) {
            continue;
        }
        let Ok(payload) = serde_json::from_str::<kinds::MovePayload>(&payload) else {
            continue;
        };
        moves.push(Moving {
            job_id,
            folder_id: payload.into,
            to: crate::fs::acts::name(conn, payload.into).unwrap_or_default(),
            done: 0,
            whole: payload.whole,
        });
    }
    moves.sort_by_key(|one| one.job_id);
    Ok(moves)
}

/// Each delete running, and each waiting its turn at none of its files settled, oldest first.
fn deletes(conn: &Connection, running: &BTreeMap<i64, Deleting>) -> Result<Vec<Deleting>> {
    let mut deletes: Vec<Deleting> = running.values().cloned().collect();
    for kind in kinds::DELETES {
        for (job_id, payload) in table::waiting(conn, kind)? {
            if running.contains_key(&job_id) {
                continue;
            }
            if let Some(line) = worker::waiting_line(job_id, kind, &payload) {
                deletes.push(line);
            }
        }
    }
    deletes.sort_by_key(|one| one.job_id);
    Ok(deletes)
}

/// A poisoned lock still holds what it held: one panicking copy must not stop the others' lines.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub struct JobQueue {
    inner: Arc<QueueInner>,
    threads: Mutex<Vec<JoinHandle<()>>>,
}

impl JobQueue {
    /// One worker per core but one, within bounds, and a reporter that sends progress as it changes.
    #[expect(clippy::too_many_arguments)]
    pub fn start(
        db_path: PathBuf,
        thumbs: PathBuf,
        ffmpeg: Option<Ffmpeg>,
        report: Report,
        announce: Announce,
        exported: AnnounceExport,
        moved: AnnounceMove,
        deleted: AnnounceDelete,
    ) -> JobQueue {
        let inner = Arc::new(QueueInner::new(
            db_path, thumbs, ffmpeg, report, announce, exported, moved, deleted,
        ));
        let workers = std::thread::available_parallelism()
            .map_or(MIN_WORKERS, |cores| cores.get().saturating_sub(1))
            .clamp(MIN_WORKERS, MAX_WORKERS);
        let mut threads = Vec::with_capacity(workers + 1);
        for _ in 0..workers {
            let inner = Arc::clone(&inner);
            threads.push(std::thread::spawn(move || work(&inner)));
        }
        let reporter = Arc::clone(&inner);
        threads.push(std::thread::spawn(move || tick(&reporter)));
        JobQueue {
            inner,
            threads: Mutex::new(threads),
        }
    }

    pub fn progress(&self) -> Result<Progress> {
        self.inner.progress(&db::open(&self.inner.db_path)?)
    }

    /// Stops a copy: one still waiting is taken off the queue, one running stops after the file
    /// in hand. `false` when there was nothing to stop.
    pub fn cancel_copy(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        self.inner.cancel_copy(conn, job_id)
    }

    /// Stops a move between drives: one still waiting is taken off the queue, one running stops
    /// after the file in hand. `false` when there was nothing to stop.
    pub fn cancel_move(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        self.inner.cancel_move(conn, job_id)
    }

    /// Stops a delete: one still waiting is taken off the queue, one running stops after the file
    /// in hand. `false` when there was nothing to stop, or it is emptying the Trash.
    pub fn cancel_delete(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        self.inner.cancel_delete(conn, job_id)
    }

    /// Stops an export, waiting or running, and leaves nothing of it behind. `false` when there
    /// was nothing to stop.
    pub fn cancel_export(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        self.inner.cancel_export(conn, job_id)
    }

    /// Stops the queue while the hold is kept: each copy, move, delete, export and waiting Empty Trash
    /// is cancelled, a walk stops before its next directory, and the hold waits for every job in
    /// flight to end. Nothing starts again until it is dropped.
    pub fn hold(&self) -> Result<Hold<'_>> {
        let inner = &*self.inner;
        inner.held.store(true, Ordering::Relaxed);
        let mut hold = Hold { inner, _gate: None };
        let conn = db::open(&inner.db_path)?;
        let progress = inner.progress(&conn)?;
        for copy in &progress.copies {
            inner.cancel_copy(&conn, copy.job_id)?;
        }
        for export in &progress.exports {
            inner.cancel_export(&conn, export.job_id)?;
        }
        for moving in &progress.moves {
            inner.cancel_move(&conn, moving.job_id)?;
        }
        for deleting in &progress.deletes {
            inner.cancel_delete(&conn, deleting.job_id)?;
        }
        hold._gate = Some(inner.gate.write().unwrap_or_else(PoisonError::into_inner));
        Ok(hold)
    }

    /// Asks every thread to finish, and waits for them no longer than the grace period.
    pub fn stop(&self) {
        self.inner.stop.store(true, Ordering::Relaxed);
        let Ok(mut threads) = self.threads.lock() else {
            return;
        };
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline && threads.iter().any(|thread| !thread.is_finished()) {
            std::thread::sleep(IDLE);
        }
        for thread in threads.drain(..) {
            if thread.is_finished() {
                let _ = thread.join();
            }
        }
    }
}

/// The queue stopped while the index is restored; it starts again when this is dropped.
pub struct Hold<'a> {
    inner: &'a QueueInner,
    _gate: Option<RwLockWriteGuard<'a, ()>>,
}

impl Drop for Hold<'_> {
    fn drop(&mut self) {
        self.inner.held.store(false, Ordering::Relaxed);
    }
}

fn work(inner: &QueueInner) {
    let Ok(mut conn) = db::open(&inner.db_path) else {
        eprintln!("a job worker could not open the database");
        return;
    };
    while !inner.stop.load(Ordering::Relaxed) {
        if inner.held.load(Ordering::Relaxed) {
            std::thread::sleep(IDLE);
            continue;
        }
        let open = inner.gate.read().unwrap_or_else(PoisonError::into_inner);
        if inner.held.load(Ordering::Relaxed) {
            continue;
        }
        let job = match table::claim(&mut conn) {
            Ok(Some(job)) => job,
            Ok(None) => {
                drop(open);
                std::thread::sleep(IDLE);
                continue;
            }
            Err(err) => {
                drop(open);
                eprintln!("a job worker could not claim a job: {err}");
                std::thread::sleep(TICK);
                continue;
            }
        };
        // A decoder that panics on one malformed file costs that job, never the app.
        let outcome =
            std::panic::catch_unwind(AssertUnwindSafe(|| worker::execute(inner, &mut conn, &job)));
        let _ = match outcome {
            Ok(Ok(worker::Done::Finished)) => {
                inner.completed.fetch_add(1, Ordering::Relaxed);
                table::complete(&conn, job.id)
            }
            Ok(Ok(worker::Done::Paused)) => table::release(&conn, job.id),
            Ok(Err(err)) => {
                let retry = job.attempt < kinds::MAX_ATTEMPTS && worker::is_transient(&err);
                table::fail(&conn, job.id, &Reason::of(&err), retry)
            }
            Err(_) => {
                eprintln!("job {}: the worker stopped on its file", job.id);
                table::fail(&conn, job.id, &Reason::Unreadable, false)
            }
        };
        drop(open);
    }
}

/// Sends progress once per tick, and only when it changed — which is also what makes a queue that
/// emptied within a single tick still say so.
fn tick(inner: &QueueInner) {
    let Ok(conn) = db::open(&inner.db_path) else {
        eprintln!("the progress reporter could not open the database");
        return;
    };
    let mut previous: Option<Progress> = None;
    while !inner.stop.load(Ordering::Relaxed) {
        std::thread::sleep(TICK);
        if let Some(progress) = next_report(inner, &conn, &mut previous) {
            (inner.report)(&progress);
        }
    }
}

/// What to report now, if anything: the thumbnails made since the last report, and the rest when
/// it changed. Each item made is reported once.
fn next_report(
    inner: &QueueInner,
    conn: &Connection,
    previous: &mut Option<Progress>,
) -> Option<Progress> {
    let mut progress = inner.progress(conn).ok()?;
    let thumbed = std::mem::take(&mut *lock(&inner.thumbed));
    if thumbed.is_empty() && previous.as_ref() == Some(&progress) {
        return None;
    }
    *previous = Some(progress.clone());
    progress.thumbed = thumbed;
    Some(progress)
}

/// Says the item's thumbnail or scrub frames have been made, in the next report.
fn thumbed(inner: &QueueInner, item_id: i64) {
    let mut made = lock(&inner.thumbed);
    if !made.contains(&item_id) {
        made.push(item_id);
    }
}

/// Queues a walk of every source, unless one is already waiting or running.
pub fn enqueue_index(conn: &Connection) -> Result<()> {
    if !table::is_queued(conn, kinds::INDEX, "{}")? {
        table::enqueue(conn, kinds::INDEX, "{}", kinds::PRIORITY_INDEX)?;
    }
    Ok(())
}

/// Queues a walk that starts after now, for a source just added: a walk already running listed
/// the sources before it existed.
pub fn enqueue_index_again(conn: &Connection) -> Result<()> {
    if !table::is_pending(conn, kinds::INDEX, "{}")? {
        table::enqueue(conn, kinds::INDEX, "{}", kinds::PRIORITY_INDEX)?;
    }
    Ok(())
}

/// Queues a walk of one folder's subtree, unless one for it is already waiting.
pub fn enqueue_folder_walk(conn: &Connection, folder_id: i64) -> Result<()> {
    let payload = serde_json::to_string(&kinds::FolderPayload { folder_id })?;
    if !table::is_pending(conn, kinds::INDEX_FOLDER, &payload)? {
        table::enqueue(conn, kinds::INDEX_FOLDER, &payload, kinds::PRIORITY_INDEX)?;
    }
    Ok(())
}

/// Queues an item's thumbnail, unless it is already waiting.
pub fn enqueue_thumb(conn: &Connection, item_id: i64) -> Result<()> {
    let payload = serde_json::to_string(&kinds::ItemPayload { item_id })?;
    if !table::is_pending(conn, kinds::THUMB, &payload)? {
        table::enqueue(conn, kinds::THUMB, &payload, kinds::PRIORITY_THUMB)?;
    }
    Ok(())
}

/// Queues a copy into a folder under a batch of its own, and returns the job that runs it.
pub fn enqueue_copy(conn: &Connection, folder_id: i64, paths: &[PathBuf]) -> Result<i64> {
    let payload = kinds::CopyPayload {
        batch_id: crate::db::journal::new_batch(),
        folder_id,
        paths: paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        whole: crate::fs::paste::whole(paths),
    };
    table::enqueue(
        conn,
        kinds::COPY_IN,
        &serde_json::to_string(&payload)?,
        kinds::PRIORITY_COPY,
    )
}

/// Queues a move of files into a folder under a batch of its own, and returns the job that runs it.
pub fn enqueue_move_items(conn: &Connection, item_ids: &[i64], into: i64) -> Result<i64> {
    enqueue_move(
        conn,
        kinds::MovePayload {
            batch_id: crate::db::journal::new_batch(),
            into,
            item_ids: item_ids.to_vec(),
            whole: u32::try_from(item_ids.len()).unwrap_or(u32::MAX),
        },
    )
}

/// Queues files sent to the Recycle Bin under a batch of its own, and returns the job that sends
/// them.
pub fn enqueue_trash(conn: &Connection, item_ids: &[i64]) -> Result<i64> {
    let payload = kinds::TrashPayload {
        batch_id: crate::db::journal::new_batch(),
        item_ids: item_ids.to_vec(),
        whole: u32::try_from(item_ids.len()).unwrap_or(u32::MAX),
    };
    table::enqueue(
        conn,
        kinds::TRASH,
        &serde_json::to_string(&payload)?,
        kinds::PRIORITY_COPY,
    )
}

/// Queues a folder's delete under a batch of its own, its `held` files going as `contents` says,
/// and returns the job that deletes it.
pub fn enqueue_delete_folder(
    conn: &Connection,
    folder_id: i64,
    contents: Contents,
    held: usize,
) -> Result<i64> {
    let payload = kinds::DeleteFolderPayload {
        batch_id: crate::db::journal::new_batch(),
        folder_id,
        contents,
        name: crate::db::folders::title(conn, folder_id)?.unwrap_or_default(),
        whole: u32::try_from(held).unwrap_or(u32::MAX),
        outright: 0,
    };
    table::enqueue(
        conn,
        kinds::DELETE_FOLDER,
        &serde_json::to_string(&payload)?,
        kinds::PRIORITY_COPY,
    )
}

/// Queues Empty Trash over the files it counted, and returns the job that empties them.
pub fn enqueue_empty(conn: &Connection, counted: Vec<Counted>) -> Result<i64> {
    table::enqueue(
        conn,
        kinds::EMPTY,
        &serde_json::to_string(&kinds::EmptyPayload {
            counted,
            deleted: 0,
            bytes: 0,
            gone: 0,
        })?,
        kinds::PRIORITY_COPY,
    )
}

fn enqueue_move(conn: &Connection, payload: kinds::MovePayload) -> Result<i64> {
    table::enqueue(
        conn,
        kinds::MOVE,
        &serde_json::to_string(&payload)?,
        kinds::PRIORITY_COPY,
    )
}

/// Queues an export of a scope into a zip at `dest`, and returns the job that writes it.
pub fn enqueue_export(
    conn: &Connection,
    scope: &Scope,
    naming: Naming,
    dest: &Path,
) -> Result<i64> {
    let gathered = export::gather(conn, scope)?;
    let payload = kinds::ExportPayload {
        scope: scope.clone(),
        naming,
        dest: dest.to_string_lossy().into_owned(),
        part: export::part_beside(dest).to_string_lossy().into_owned(),
        whole: u32::try_from(gathered.entries.len() + gathered.away.len()).unwrap_or(u32::MAX),
    };
    table::enqueue(
        conn,
        kinds::EXPORT,
        &serde_json::to_string(&payload)?,
        kinds::PRIORITY_COPY,
    )
}

/// An export a crash or a closing left is never taken up again: its job goes, and what it had
/// written with it.
pub fn abandon_exports(conn: &Connection) -> Result<()> {
    for payload in table::take_all(conn, kinds::EXPORT)? {
        if let Ok(payload) = serde_json::from_str::<kinds::ExportPayload>(&payload) {
            let _ = std::fs::remove_file(payload.part);
        }
    }
    Ok(())
}

/// Queues a video's scrub frames, unless they are already waiting.
pub fn enqueue_scrub(conn: &Connection, item_id: i64) -> Result<()> {
    let payload = serde_json::to_string(&kinds::ItemPayload { item_id })?;
    if !table::is_pending(conn, kinds::SCRUB, &payload)? {
        table::enqueue(conn, kinds::SCRUB, &payload, kinds::PRIORITY_SCRUB)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sources::{self, SourceKind};
    use std::path::Path;
    use std::sync::mpsc;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-queue")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("library/Trips")).unwrap();
        dir
    }

    #[test]
    fn a_copy_runs_off_this_thread_and_ends_by_saying_what_came_in_as_one_batch() {
        let dir = scratch("copy");
        std::fs::create_dir_all(dir.join("Downloads")).unwrap();
        image::DynamicImage::new_rgb8(32, 24)
            .save(dir.join("Downloads/IMG_5001.png"))
            .unwrap();
        std::fs::write(dir.join("Downloads/IMG_5002.jpg"), "b").unwrap();
        let db_path = dir.join("library.db");
        let mut conn = db::open(&db_path).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        crate::fs::walk::reconcile(&conn).unwrap();
        let root = crate::db::folders::source_root_folder(&conn, 1).unwrap();
        let trips = crate::db::folders::child_id(&conn, root, "Trips")
            .unwrap()
            .unwrap();
        let entries = [
            dir.join("Downloads/IMG_5001.png"),
            dir.join("Downloads/IMG_5002.jpg"),
        ];
        let job = enqueue_copy(&conn, trips, &entries).unwrap();
        assert_eq!(
            table::counts(&conn).unwrap().pending,
            0,
            "the walk's line counts no copy"
        );

        let (said, heard) = mpsc::channel();
        let queue = JobQueue::start(
            db_path,
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(move |copied| {
                let _ = said.send(copied.clone());
            }),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        let copied = heard.recv_timeout(Duration::from_secs(60)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !queue.progress().unwrap().copies.is_empty() && Instant::now() < deadline {
            std::thread::sleep(IDLE);
        }
        assert!(queue.progress().unwrap().copies.is_empty(), "its line goes");
        queue.stop();

        assert_eq!((copied.job_id, copied.to.as_str()), (job, "Trips"));
        assert_eq!((copied.whole, copied.cancelled), (2, false));
        assert!(copied.refused.is_empty(), "{:?}", copied.refused);
        let batch = copied.batch.unwrap();
        assert_eq!(batch.files, 2);
        assert!(dir.join("library/Trips/IMG_5001.png").is_file());
        assert!(
            !queue.cancel_copy(&conn, job).unwrap(),
            "nothing is left to stop"
        );
    }

    fn library_with_downloads(name: &str) -> (Connection, PathBuf, i64, [PathBuf; 2]) {
        let dir = scratch(name);
        std::fs::create_dir_all(dir.join("Downloads")).unwrap();
        let entries = [
            dir.join("Downloads/IMG_5001.jpg"),
            dir.join("Downloads/IMG_5002.jpg"),
        ];
        for entry in &entries {
            std::fs::write(entry, "bytes").unwrap();
        }
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        crate::fs::walk::reconcile(&conn).unwrap();
        let root = crate::db::folders::source_root_folder(&conn, 1).unwrap();
        let trips = crate::db::folders::child_id(&conn, root, "Trips")
            .unwrap()
            .unwrap();
        (conn, dir, trips, entries)
    }

    #[test]
    fn a_copy_waiting_its_turn_has_its_line_at_none_settled() {
        let (conn, dir, trips, entries) = library_with_downloads("copy-waiting");
        let job = enqueue_copy(&conn, trips, &entries).unwrap();
        let inner = QueueInner::new(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        assert_eq!(
            inner.progress(&conn).unwrap().copies,
            [Copying {
                job_id: job,
                folder_id: trips,
                to: "Trips".into(),
                done: 0,
                whole: 2,
            }]
        );
        assert_eq!(table::counts(&conn).unwrap().pending, 0);
    }

    #[test]
    fn a_copy_whose_folder_went_before_it_ran_says_why_it_stopped() {
        let (conn, dir, trips, entries) = library_with_downloads("copy-stopped");
        let job = enqueue_copy(&conn, trips, &entries).unwrap();
        crate::db::folders::retire_subtree_at(&conn, trips, crate::db::now()).unwrap();

        let (said, heard) = mpsc::channel();
        let queue = JobQueue::start(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(move |copied| {
                let _ = said.send(copied.clone());
            }),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        let copied = heard.recv_timeout(Duration::from_secs(60)).unwrap();
        queue.stop();

        assert_eq!((copied.job_id, copied.whole, copied.batch), (job, 2, None));
        assert_eq!(
            copied.stopped,
            Some(Reason::FolderGone {
                name: "Trips".into()
            })
        );
    }

    fn library_to_export(name: &str) -> (Connection, PathBuf, i64) {
        let dir = scratch(name);
        std::fs::write(dir.join("library/Trips/IMG_1.jpg"), "one").unwrap();
        std::fs::write(dir.join("library/Trips/IMG_2.jpg"), "two").unwrap();
        std::fs::create_dir_all(dir.join("Exports")).unwrap();
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        crate::fs::walk::reconcile(&conn).unwrap();
        let root = crate::db::folders::source_root_folder(&conn, 1).unwrap();
        let trips = crate::db::folders::child_id(&conn, root, "Trips")
            .unwrap()
            .unwrap();
        (conn, dir, trips)
    }

    fn hearing(dir: &Path, said: mpsc::Sender<Exported>) -> QueueInner {
        QueueInner::new(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(move |exported| {
                let _ = said.send(exported.clone());
            }),
            Box::new(|_| {}),
            Box::new(|_| {}),
        )
    }

    #[test]
    fn an_export_runs_off_this_thread_with_its_line_and_says_how_it_ended() {
        let (conn, dir, trips) = library_to_export("export");
        let dest = dir.join("Exports/Trips.zip");
        let scope = Scope::Branch { folder_id: trips };
        let job = enqueue_export(&conn, &scope, Naming::Keep, &dest).unwrap();
        let (said, heard) = mpsc::channel();
        assert_eq!(
            hearing(&dir, said.clone()).progress(&conn).unwrap().exports,
            [Exporting {
                job_id: job,
                zip: "Trips.zip".into(),
                path: dest.to_string_lossy().into_owned(),
                done: 0,
                whole: 2,
            }],
            "waiting its turn, at none settled"
        );
        assert_eq!(
            table::counts(&conn).unwrap().pending,
            0,
            "the walk's line counts no export"
        );

        let queue = JobQueue::start(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(move |exported| {
                let _ = said.send(exported.clone());
            }),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        let exported = heard.recv_timeout(Duration::from_secs(60)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !queue.progress().unwrap().exports.is_empty() && Instant::now() < deadline {
            std::thread::sleep(IDLE);
        }
        assert!(
            queue.progress().unwrap().exports.is_empty(),
            "its line goes"
        );
        queue.stop();

        assert_eq!((exported.job_id, exported.end), (job, End::Written));
        assert_eq!((exported.whole, exported.written), (2, 2));
        assert_eq!(
            (exported.zip.as_str(), exported.place.as_str()),
            ("Trips.zip", "Exports")
        );
        assert_eq!(
            exported.dir,
            dir.join("Exports").to_string_lossy().into_owned()
        );
        assert!(dest.is_file());
        assert!(
            !queue.cancel_export(&conn, job).unwrap(),
            "nothing is left to stop"
        );
    }

    #[test]
    fn cancelling_an_export_waiting_its_turn_ends_its_line_with_nothing_written() {
        let (conn, dir, trips) = library_to_export("export-cancel-waiting");
        let dest = dir.join("Exports/Trips.zip");
        let job = enqueue_export(
            &conn,
            &Scope::Branch { folder_id: trips },
            Naming::Folders,
            &dest,
        )
        .unwrap();
        let (said, heard) = mpsc::channel();
        let inner = hearing(&dir, said);
        assert!(inner.cancel_export(&conn, job).unwrap());
        let exported = heard.try_recv().expect("its line ends");
        assert_eq!(
            (exported.job_id, exported.end, exported.whole),
            (job, End::Cancelled, 2)
        );
        assert!(inner.progress(&conn).unwrap().exports.is_empty());
        assert!(!dest.exists());
        assert!(!inner.cancel_export(&conn, job).unwrap());
    }

    #[test]
    fn an_export_a_crash_left_is_never_taken_up_again_and_what_it_wrote_goes() {
        let (mut conn, dir, trips) = library_to_export("export-crash");
        let dest = dir.join("Exports/Trips.zip");
        enqueue_export(
            &conn,
            &Scope::Branch { folder_id: trips },
            Naming::Keep,
            &dest,
        )
        .unwrap();
        let payload: kinds::ExportPayload =
            serde_json::from_str(&table::waiting(&conn, kinds::EXPORT).unwrap()[0].1).unwrap();
        std::fs::write(&payload.part, "half a zip").unwrap();
        assert!(table::claim(&mut conn).unwrap().is_some());

        abandon_exports(&conn).unwrap();
        assert!(!Path::new(&payload.part).exists());
        assert!(!dest.exists());
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM job", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    struct Through;

    impl crate::fs::paste::Control for Through {
        fn halt(&self) -> Option<crate::fs::paste::Halt> {
            None
        }
        fn progress(&self, _done: u32, _whole: u32) {}
        fn landed(&self, _conn: &Connection, _item_id: i64, _kind: &str) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn cancelling_a_copy_waiting_after_a_crash_clears_what_the_crash_left_and_ends_its_line() {
        let (conn, dir, trips, entries) = library_with_downloads("copy-cancel-waiting");
        let job = enqueue_copy(&conn, trips, &entries).unwrap();
        let payload: kinds::CopyPayload =
            serde_json::from_str(&table::waiting_copies(&conn).unwrap()[0].1).unwrap();
        let batch = payload.batch_id.clone();
        crate::fs::paste::run(&conn, &batch, trips, &entries, &Through).unwrap();
        let landed = dir.join("library/Trips");
        let part = landed.join(format!(".{batch}.filmstrip-part"));
        std::fs::rename(landed.join("IMG_5002.jpg"), &part).unwrap();

        let (said, heard) = mpsc::channel();
        let inner = QueueInner::new(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(move |copied| {
                let _ = said.send(copied.clone());
            }),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        assert!(inner.cancel_copy(&conn, job).unwrap());
        let copied = heard.try_recv().expect("its line ends with what came in");
        assert!(copied.cancelled);
        assert_eq!((copied.job_id, copied.whole), (job, 2));
        assert_eq!(copied.batch.map(|batch| batch.files), Some(1));
        assert!(!part.exists(), "the part a crash left is cleared");
        assert!(inner.progress(&conn).unwrap().copies.is_empty());

        let back = crate::fs::undo::undo_batch(&conn, &batch).unwrap();
        assert!(back.stayed.is_empty(), "{:?}", back.stayed);
        assert_eq!(back.files_back, 1);
        assert!(!dir.join("library/Trips/IMG_5001.jpg").exists());
    }

    #[test]
    fn cancelling_a_waiting_copy_ends_its_line_even_when_its_library_has_been_removed() {
        let (conn, dir, trips, entries) = library_with_downloads("copy-cancel-removed");
        let job = enqueue_copy(&conn, trips, &entries).unwrap();
        sources::remove(&conn, 1).unwrap();

        let (said, heard) = mpsc::channel();
        let inner = QueueInner::new(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(move |copied| {
                let _ = said.send(copied.clone());
            }),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        let _ = inner.cancel_copy(&conn, job);
        let copied = heard.try_recv().expect("its line ends");
        assert_eq!((copied.job_id, copied.cancelled), (job, true));
        assert!(inner.progress(&conn).unwrap().copies.is_empty());
    }

    /// Trips holding IMG_1.jpg and IMG_2.jpg, and People empty.
    fn library_to_move(name: &str) -> (Connection, PathBuf, i64, i64, [i64; 2]) {
        let (conn, dir, trips) = library_to_export(name);
        std::fs::create_dir_all(dir.join("library/People")).unwrap();
        crate::fs::walk::reconcile(&conn).unwrap();
        let root = crate::db::folders::source_root_folder(&conn, 1).unwrap();
        let people = crate::db::folders::child_id(&conn, root, "People")
            .unwrap()
            .unwrap();
        let id = |name: &str| {
            crate::db::items::existing_by_disk_name(&conn, trips, name)
                .unwrap()
                .unwrap()
                .id
        };
        let ids = [id("IMG_1.jpg"), id("IMG_2.jpg")];
        (conn, dir, trips, people, ids)
    }

    fn hearing_moves(dir: &Path, said: mpsc::Sender<Moved>) -> QueueInner {
        QueueInner::new(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(move |moved| {
                let _ = said.send(moved.clone());
            }),
            Box::new(|_| {}),
        )
    }

    #[test]
    fn a_move_runs_off_this_thread_and_ends_by_saying_what_went_as_one_batch() {
        let (conn, dir, _, people, ids) = library_to_move("move");
        let job = enqueue_move_items(&conn, &ids, people).unwrap();
        let (said, heard) = mpsc::channel();
        assert_eq!(
            hearing_moves(&dir, said.clone())
                .progress(&conn)
                .unwrap()
                .moves,
            [Moving {
                job_id: job,
                folder_id: people,
                to: "People".into(),
                done: 0,
                whole: 2,
            }],
            "waiting its turn, at none settled"
        );
        assert_eq!(
            table::counts(&conn).unwrap().pending,
            0,
            "the walk's line counts no move"
        );

        let queue = JobQueue::start(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(move |moved| {
                let _ = said.send(moved.clone());
            }),
            Box::new(|_| {}),
        );
        let moved = heard.recv_timeout(Duration::from_secs(60)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while !queue.progress().unwrap().moves.is_empty() && Instant::now() < deadline {
            std::thread::sleep(IDLE);
        }
        assert!(queue.progress().unwrap().moves.is_empty(), "its line goes");
        queue.stop();

        assert_eq!((moved.job_id, moved.to.as_str()), (job, "People"));
        assert_eq!((moved.whole, moved.cancelled), (2, false));
        assert!(moved.refused.is_empty(), "{:?}", moved.refused);
        let batch = moved.batch.unwrap();
        assert_eq!(batch.files, 2);
        assert!(dir.join("library/People/IMG_1.jpg").is_file());
        assert!(!dir.join("library/Trips/IMG_1.jpg").exists());
        assert!(
            !queue.cancel_move(&conn, job).unwrap(),
            "nothing is left to stop"
        );

        let back = crate::fs::undo::undo_last(&conn).unwrap().unwrap();
        assert_eq!((back.batch.batch_id, back.files_back), (batch.batch_id, 2));
        assert!(dir.join("library/Trips/IMG_2.jpg").is_file());
    }

    #[test]
    fn a_move_waiting_after_a_crash_is_no_act_until_it_ends_and_cancel_ends_it_with_what_went() {
        let (conn, dir, trips, people, ids) = library_to_move("move-cancel-waiting");
        let job = enqueue_move_items(&conn, &ids, people).unwrap();
        let payload: kinds::MovePayload =
            serde_json::from_str(&table::waiting(&conn, kinds::MOVE).unwrap()[0].1).unwrap();
        let batch = payload.batch_id.clone();
        crate::fs::items::move_items(&conn, &ids[..1], people, &batch).unwrap();
        assert_eq!(crate::db::journal::latest_batch(&conn).unwrap(), None);
        assert!(crate::fs::undo::undo_batch(&conn, &batch).is_err());

        let (said, heard) = mpsc::channel();
        let inner = hearing_moves(&dir, said);
        assert!(inner.cancel_move(&conn, job).unwrap());
        let moved = heard.try_recv().expect("its line ends with what went");
        assert!(moved.cancelled);
        assert_eq!((moved.job_id, moved.whole), (job, 2));
        assert_eq!(moved.batch.map(|batch| batch.files), Some(1));
        assert!(inner.progress(&conn).unwrap().moves.is_empty());

        let back = crate::fs::undo::undo_last(&conn).unwrap().unwrap();
        assert_eq!((back.batch.batch_id, back.files_back), (batch, 1));
        assert_eq!(
            crate::db::items::folder_of(&conn, ids[0]).unwrap(),
            Some(trips)
        );
    }

    #[test]
    fn cancel_on_a_move_waiting_after_a_crash_clears_the_part_its_killed_run_left() {
        let (conn, dir, _, people, ids) = library_to_move("move-cancel-part");
        let job = enqueue_move_items(&conn, &ids, people).unwrap();
        let into = dir.join("library/People");
        std::fs::write(into.join(".IMG_2.jpg.filmstrip-part"), "half").unwrap();
        std::fs::write(into.join(".IMG_9.jpg.filmstrip-part"), "theirs").unwrap();

        let (said, heard) = mpsc::channel();
        let inner = hearing_moves(&dir, said);
        assert!(inner.cancel_move(&conn, job).unwrap());
        assert!(heard.try_recv().unwrap().cancelled);
        assert!(!into.join(".IMG_2.jpg.filmstrip-part").exists());
        assert!(into.join(".IMG_9.jpg.filmstrip-part").is_file());
        assert!(dir.join("library/Trips/IMG_2.jpg").is_file());
        assert!(!into.join("IMG_2.jpg").exists());
    }

    #[test]
    fn cancel_on_a_waiting_move_whose_part_cannot_be_cleared_still_ends_it() {
        let (conn, dir, _, people, ids) = library_to_move("move-cancel-removed");
        let job = enqueue_move_items(&conn, &ids, people).unwrap();
        sources::remove(&conn, 1).unwrap();

        let (said, heard) = mpsc::channel();
        let inner = hearing_moves(&dir, said);
        assert!(inner.cancel_move(&conn, job).unwrap());
        assert!(heard.try_recv().unwrap().cancelled);
    }

    fn hearing_deletes(dir: &Path, said: mpsc::Sender<Deleted>) -> QueueInner {
        QueueInner::new(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(move |deleted| {
                let _ = said.send(deleted.clone());
            }),
        )
    }

    /// Trips holding `count` files, IMG_0.jpg on; their ids.
    fn library_to_delete(name: &str, count: usize) -> (Connection, PathBuf, i64, Vec<i64>) {
        let (conn, dir, trips) = library_to_export(name);
        for one in ["IMG_1.jpg", "IMG_2.jpg"] {
            std::fs::remove_file(dir.join("library/Trips").join(one)).unwrap();
        }
        for n in 0..count {
            std::fs::write(dir.join(format!("library/Trips/IMG_{n}.jpg")), "bytes").unwrap();
        }
        crate::fs::walk::reconcile(&conn).unwrap();
        let ids = (0..count)
            .map(|n| {
                crate::db::items::existing_by_disk_name(&conn, trips, &format!("IMG_{n}.jpg"))
                    .unwrap()
                    .unwrap()
                    .id
            })
            .collect();
        (conn, dir, trips, ids)
    }

    /// Claims the job waiting and runs it on this thread, whose stand-in is the Recycle Bin.
    fn run_here(inner: &QueueInner, dir: &Path) -> worker::Done {
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        let job = table::claim(&mut conn).unwrap().unwrap();
        let done = worker::execute(inner, &mut conn, &job).unwrap();
        match done {
            worker::Done::Finished => table::complete(&conn, job.id).unwrap(),
            worker::Done::Paused => table::release(&conn, job.id).unwrap(),
        }
        done
    }

    /// Closes the app, as far as the queue knows, as this thread asks for its `nth` turn of the
    /// disk from now on.
    fn stop_at_turn(inner: &Arc<QueueInner>, nth: u32) {
        let inner = Arc::clone(inner);
        let mut asked = 0;
        crate::fs::just_after_queueing(move || {
            asked += 1;
            if asked == nth {
                inner.stop.store(true, Ordering::Relaxed);
            }
        });
    }

    #[test]
    fn a_delete_of_a_few_files_goes_at_once_and_of_more_runs_as_a_job_with_its_line() {
        let (conn, dir, _, ids) = library_to_delete("delete-job", kinds::AT_ONCE + 1);
        let few = crate::commands::start_trash(&conn, &ids[..kinds::AT_ONCE]).unwrap();
        let crate::commands::ItemsTrashed::Done {
            report,
            batch: Some(went),
        } = few
        else {
            panic!("a few go at once");
        };
        assert_eq!(report.trashed as usize, kinds::AT_ONCE);

        let rest = [ids[kinds::AT_ONCE], ids[0]];
        let crate::commands::ItemsTrashed::Started { job_id } =
            crate::commands::start_trash(&conn, &[&ids[..], &rest[..]].concat()).unwrap()
        else {
            panic!("more are a job");
        };
        let (said, heard) = mpsc::channel();
        let inner = hearing_deletes(&dir, said);
        let waiting = Deleting {
            job_id,
            kind: DeleteKind::Files,
            name: String::new(),
            done: 0,
            whole: 13,
        };
        assert_eq!(inner.progress(&conn).unwrap().deletes, [waiting]);
        assert_eq!(table::counts(&conn).unwrap().pending, 0);
        assert_eq!(
            crate::db::journal::latest_batch(&conn).unwrap(),
            Some(went.batch_id),
            "the job's batch is no act until it ends"
        );

        assert!(matches!(run_here(&inner, &dir), worker::Done::Finished));
        let Deleted::Files {
            job_id: ended,
            batch,
            report,
            whole,
            cancelled,
            stopped,
        } = heard.try_recv().unwrap()
        else {
            panic!("files were deleted");
        };
        assert_eq!(
            (ended, whole, cancelled, stopped),
            (job_id, 13, false, None)
        );
        assert_eq!(report.trashed, 1);
        assert!(
            report.refused.is_empty(),
            "the rest were in the Trash already, so passed over: {:?}",
            report.refused
        );
        assert_eq!(batch.map(|went| went.files), Some(1));
        assert!(inner.progress(&conn).unwrap().deletes.is_empty());
        assert!(
            !dir.join(format!("library/Trips/IMG_{}.jpg", kinds::AT_ONCE))
                .exists()
        );
    }

    #[test]
    fn a_folder_holding_more_files_than_go_at_once_is_deleted_as_a_job_with_its_line() {
        let (conn, dir, trips, _) = library_to_delete("delete-folder-job", kinds::AT_ONCE + 1);
        let few = crate::commands::start_folder_delete(&conn, trips, Some(Contents::Trash));
        let Ok(crate::commands::FolderDeleted::Started { job_id }) = few else {
            panic!("a job: {few:?}");
        };
        let (said, heard) = mpsc::channel();
        let inner = hearing_deletes(&dir, said);
        assert_eq!(
            inner.progress(&conn).unwrap().deletes,
            [Deleting {
                job_id,
                kind: DeleteKind::Folder,
                name: "Trips".into(),
                done: 0,
                whole: 11,
            }]
        );

        assert!(matches!(run_here(&inner, &dir), worker::Done::Finished));
        let Deleted::Folder {
            name,
            batch,
            report,
            cancelled,
            stopped,
            ..
        } = heard.try_recv().unwrap()
        else {
            panic!("a folder was deleted");
        };
        assert_eq!((name.as_str(), cancelled, stopped), ("Trips", false, None));
        assert!(report.deleted, "{report:?}");
        assert_eq!(batch.map(|went| went.files), Some(11));
        assert!(!dir.join("library/Trips").exists());

        let back = crate::fs::undo::undo_last(&conn).unwrap().unwrap();
        assert_eq!(back.files_back, 11);
        assert!(dir.join("library/Trips/IMG_0.jpg").is_file());
    }

    #[test]
    fn empty_trash_runs_as_a_job_with_its_line_and_no_cancel_once_it_runs() {
        let (conn, dir, _, ids) = library_to_delete("empty-job", 2);
        crate::fs::trash::trash_items(&conn, &ids, &crate::db::journal::new_batch()).unwrap();
        let asked = crate::fs::empty::to_empty(&conn).unwrap();
        let job_id = enqueue_empty(&conn, asked.files).unwrap();
        let (said, heard) = mpsc::channel();
        let inner = hearing_deletes(&dir, said);
        assert_eq!(
            inner.progress(&conn).unwrap().deletes[0].kind,
            DeleteKind::Empty
        );
        lock(&inner.deletes).insert(
            job_id + 1,
            Deleting {
                job_id: job_id + 1,
                kind: DeleteKind::Empty,
                name: String::new(),
                done: 1,
                whole: 2,
            },
        );
        assert!(
            !inner.cancel_delete(&conn, job_id + 1).unwrap(),
            "what has gone has gone"
        );
        lock(&inner.deletes).clear();

        assert!(matches!(run_here(&inner, &dir), worker::Done::Finished));
        let Deleted::Empty {
            emptied,
            cancelled,
            stopped,
            ..
        } = heard.try_recv().unwrap()
        else {
            panic!("the Trash was emptied");
        };
        assert_eq!((emptied.deleted, cancelled, stopped), (2, false, None));
        assert!(crate::fs::empty::to_empty(&conn).unwrap().files.is_empty());
    }

    #[test]
    fn a_hold_takes_each_waiting_delete_off_the_queue_and_ends_its_line() {
        let (conn, dir, trips, ids) = library_to_delete("delete-held", kinds::AT_ONCE + 1);
        let trash = enqueue_trash(&conn, &ids).unwrap();
        enqueue_delete_folder(&conn, trips, Contents::Trash, ids.len()).unwrap();
        enqueue_empty(&conn, Vec::new()).unwrap();
        let (said, heard) = mpsc::channel();
        let queue = JobQueue {
            inner: Arc::new(hearing_deletes(&dir, said)),
            threads: Mutex::new(Vec::new()),
        };
        let inner = &*queue.inner;

        let hold = queue.hold().unwrap();
        let ended: Vec<bool> = heard
            .try_iter()
            .map(|deleted| match deleted {
                Deleted::Files { cancelled, .. }
                | Deleted::Folder { cancelled, .. }
                | Deleted::Empty { cancelled, .. } => cancelled,
            })
            .collect();
        assert_eq!(ended, [true, true, true]);
        assert!(inner.progress(&conn).unwrap().deletes.is_empty());
        assert!(
            ids.iter()
                .all(|id| crate::db::items::is_live(&conn, *id).unwrap())
        );
        assert!(
            !inner.cancel_delete(&conn, trash).unwrap(),
            "nothing is left"
        );
        assert_eq!(table::counts(&conn).unwrap().pending, 0);
        drop(hold);
    }

    #[test]
    fn an_empty_trash_going_on_after_a_restart_counts_what_its_first_run_deleted() {
        let (conn, dir, _, ids) = library_to_delete("empty-resumed", 4);
        crate::fs::trash::trash_items(&conn, &ids, &crate::db::journal::new_batch()).unwrap();
        enqueue_empty(&conn, crate::fs::empty::to_empty(&conn).unwrap().files).unwrap();
        let (said, heard) = mpsc::channel();
        let inner = Arc::new(hearing_deletes(&dir, said));
        stop_at_turn(&inner, 2);

        assert!(matches!(run_here(&inner, &dir), worker::Done::Paused));
        assert!(heard.try_recv().is_err());
        assert_eq!(crate::fs::empty::to_empty(&conn).unwrap().files.len(), 2);

        inner.stop.store(false, Ordering::Relaxed);
        assert!(matches!(run_here(&inner, &dir), worker::Done::Finished));
        let Deleted::Empty { emptied, .. } = heard.try_recv().unwrap() else {
            panic!("the Trash was emptied");
        };
        assert_eq!((emptied.deleted, emptied.bytes), (4, 20));
        assert!(crate::fs::empty::to_empty(&conn).unwrap().files.is_empty());
    }

    #[test]
    fn a_folder_delete_going_on_after_a_restart_counts_what_its_first_run_deleted_for_good() {
        use crate::fs::recycle::tests::{Fake, Stand, stand_in_as};

        let (conn, dir, trips, ids) = library_to_delete("delete-folder-resumed", 4);
        let mut bin = Fake::new(Stand::Recycles(dir.join("bin")));
        bin.binless = vec![(dir.join("library/Trips"), "USB Drive (E:)".into())];
        stand_in_as(bin);
        enqueue_delete_folder(&conn, trips, Contents::Permanently, ids.len()).unwrap();
        let (said, heard) = mpsc::channel();
        let inner = Arc::new(hearing_deletes(&dir, said));
        stop_at_turn(&inner, 3);

        assert!(matches!(run_here(&inner, &dir), worker::Done::Paused));
        assert!(heard.try_recv().is_err());
        assert_eq!(crate::db::items::live_under(&conn, trips).unwrap().len(), 2);

        inner.stop.store(false, Ordering::Relaxed);
        assert!(matches!(run_here(&inner, &dir), worker::Done::Finished));
        let Deleted::Folder { report, batch, .. } = heard.try_recv().unwrap() else {
            panic!("a folder was deleted");
        };
        assert!(report.deleted, "{report:?}");
        assert_eq!((report.outright, batch), (4, None));
        assert!(!dir.join("library/Trips").exists());
    }

    /// Starting the queue on a fresh library walks it and thumbnails its pictures, off this thread.
    #[test]
    fn a_walk_indexes_a_library_and_its_pictures_get_thumbnails() {
        let dir = scratch("walk-and-thumbs");
        let picture = image::DynamicImage::new_rgb8(64, 48);
        picture.save(dir.join("library/Trips/cairo.png")).unwrap();
        std::fs::write(dir.join("library/notes.txt"), "not a picture").unwrap();

        let db_path = dir.join("library.db");
        let mut conn = db::open(&db_path).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        enqueue_index(&conn).unwrap();

        let (sent, received) = mpsc::channel();
        let queue = JobQueue::start(
            db_path,
            dir.join("thumbs"),
            None,
            Box::new(move |progress| {
                let _ = sent.send(progress.clone());
            }),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        let deadline = Instant::now() + Duration::from_secs(60);
        let mut settled = false;
        while !settled && Instant::now() < deadline {
            settled = received
                .recv_timeout(Duration::from_secs(1))
                .is_ok_and(|progress| progress.phase == Phase::Idle && progress.completed >= 2);
        }
        queue.stop();

        assert!(settled, "the queue reported itself idle after the work");
        let (width, height): (i64, i64) = conn
            .query_row(
                "SELECT width, height FROM item WHERE disk_name = 'cairo.png'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((width, height), (64, 48));
        let thumbnails = walkdir::WalkDir::new(dir.join("thumbs"))
            .into_iter()
            .flatten()
            .filter(|entry| entry.file_type().is_file())
            .count();
        assert_eq!(
            thumbnails, 1,
            "one picture, one thumbnail; the text file gets none"
        );
    }

    #[test]
    fn a_held_queue_starts_nothing_until_the_hold_is_dropped() {
        let dir = scratch("held");
        std::fs::write(dir.join("library/Trips/IMG_1.jpg"), "one").unwrap();
        let db_path = dir.join("library.db");
        let mut conn = db::open(&db_path).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        let queue = JobQueue::start(
            db_path,
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );

        let hold = queue.hold().unwrap();
        enqueue_index(&conn).unwrap();
        std::thread::sleep(Duration::from_secs(1));
        assert_eq!(table::counts(&conn).unwrap().pending, 1, "nothing starts");
        drop(hold);

        let deadline = Instant::now() + Duration::from_secs(60);
        while table::counts(&conn).unwrap().pending + table::counts(&conn).unwrap().running > 0
            && Instant::now() < deadline
        {
            std::thread::sleep(IDLE);
        }
        queue.stop();
        let walked: i64 = conn
            .query_row("SELECT COUNT(*) FROM item", [], |r| r.get(0))
            .unwrap();
        assert_eq!(walked, 1, "and it starts again once the hold goes");
    }

    #[test]
    fn a_folder_asked_for_twice_is_walked_once() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        enqueue_folder_walk(&conn, 7).unwrap();
        enqueue_folder_walk(&conn, 7).unwrap();
        enqueue_folder_walk(&conn, 8).unwrap();
        assert_eq!(table::counts(&conn).unwrap().pending, 2);
    }

    #[test]
    fn a_folder_read_again_through_the_queue_picks_up_a_new_picture_and_thumbnails_it() {
        let dir = scratch("folder-walk");
        let db_path = dir.join("library.db");
        let mut conn = db::open(&db_path).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        crate::fs::walk::reconcile(&conn).unwrap();
        let root = crate::db::folders::source_root_folder(&conn, 1).unwrap();
        let trips = crate::db::folders::child_id(&conn, root, "Trips")
            .unwrap()
            .unwrap();

        image::DynamicImage::new_rgb8(32, 24)
            .save(dir.join("library/Trips/later.png"))
            .unwrap();
        enqueue_folder_walk(&conn, trips).unwrap();

        let (sent, received) = mpsc::channel();
        let queue = JobQueue::start(
            db_path,
            dir.join("thumbs"),
            None,
            Box::new(move |progress| {
                let _ = sent.send(progress.clone());
            }),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        let deadline = Instant::now() + Duration::from_secs(60);
        let mut settled = false;
        while !settled && Instant::now() < deadline {
            settled = received
                .recv_timeout(Duration::from_secs(1))
                .is_ok_and(|progress| progress.phase == Phase::Idle && progress.completed >= 2);
        }
        queue.stop();

        assert!(settled, "the queue reported itself idle after the work");
        let width: i64 = conn
            .query_row(
                "SELECT width FROM item WHERE disk_name = 'later.png' AND deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(width, 32);
    }
}
