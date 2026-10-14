//! The background queue: worker threads, each with its own connection, working through the job
//! table so the window never waits on a walk or a thumbnail. DECISIONS.md "Background work".

pub mod kinds;
pub mod worker;

use std::collections::{BTreeMap, HashSet};
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::{self, jobs as table};
use crate::error::{Reason, Result};
use crate::fs::acts::Batch;
use crate::fs::stayed::Stayed;
use crate::media::ffmpeg::Ffmpeg;

pub const PROGRESS_EVENT: &str = "job-progress";
pub const COPIED_EVENT: &str = "copy-done";

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

pub type Report = Box<dyn Fn(&Progress) + Send + Sync>;
pub type Announce = Box<dyn Fn(&Copied) + Send + Sync>;

pub struct QueueInner {
    db_path: PathBuf,
    thumbs: PathBuf,
    /// Videos are only read while this is here. DECISIONS.md "Video and ffmpeg".
    ffmpeg: Option<Ffmpeg>,
    stop: AtomicBool,
    walking: AtomicBool,
    completed: AtomicU64,
    report: Report,
    announce: Announce,
    copies: Mutex<BTreeMap<i64, Copying>>,
    cancelled: Mutex<HashSet<i64>>,
}

impl QueueInner {
    fn new(
        db_path: PathBuf,
        thumbs: PathBuf,
        ffmpeg: Option<Ffmpeg>,
        report: Report,
        announce: Announce,
    ) -> QueueInner {
        QueueInner {
            db_path,
            thumbs,
            ffmpeg,
            stop: AtomicBool::new(false),
            walking: AtomicBool::new(false),
            completed: AtomicU64::new(0),
            report,
            announce,
            copies: Mutex::new(BTreeMap::new()),
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
        })
    }
}

impl QueueInner {
    fn cancel_copy(&self, conn: &Connection, job_id: i64) -> Result<bool> {
        if let Some(payload) = table::cancel_pending(conn, job_id)? {
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
    pub fn start(
        db_path: PathBuf,
        thumbs: PathBuf,
        ffmpeg: Option<Ffmpeg>,
        report: Report,
        announce: Announce,
    ) -> JobQueue {
        let inner = Arc::new(QueueInner::new(db_path, thumbs, ffmpeg, report, announce));
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

fn work(inner: &QueueInner) {
    let Ok(mut conn) = db::open(&inner.db_path) else {
        eprintln!("a job worker could not open the database");
        return;
    };
    while !inner.stop.load(Ordering::Relaxed) {
        let job = match table::claim(&mut conn) {
            Ok(Some(job)) => job,
            Ok(None) => {
                std::thread::sleep(IDLE);
                continue;
            }
            Err(err) => {
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
                table::fail(&conn, job.id, &err.to_string(), retry)
            }
            Err(_) => table::fail(&conn, job.id, "the worker stopped on this file", false),
        };
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
        let Ok(progress) = inner.progress(&conn) else {
            continue;
        };
        if previous.as_ref() != Some(&progress) {
            (inner.report)(&progress);
            previous = Some(progress);
        }
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

pub fn enqueue_thumb(conn: &Connection, item_id: i64) -> Result<()> {
    let payload = serde_json::to_string(&kinds::ItemPayload { item_id })?;
    table::enqueue(conn, kinds::THUMB, &payload, kinds::PRIORITY_THUMB)?;
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
        );
        let _ = inner.cancel_copy(&conn, job);
        let copied = heard.try_recv().expect("its line ends");
        assert_eq!((copied.job_id, copied.cancelled), (job, true));
        assert!(inner.progress(&conn).unwrap().copies.is_empty());
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
