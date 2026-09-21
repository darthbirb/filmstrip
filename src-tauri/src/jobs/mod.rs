//! The background queue: worker threads, each with its own connection, working through the job
//! table so the window never waits on a walk or a thumbnail. DECISIONS.md "Background work".

pub mod kinds;
pub mod worker;

use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::{self, jobs as table};
use crate::error::Result;
use crate::media::ffmpeg::Ffmpeg;

pub const PROGRESS_EVENT: &str = "job-progress";

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
    pub pending: i64,
    pub running: i64,
    pub failed: i64,
    /// Jobs finished since launch.
    pub completed: u64,
}

pub type Report = Box<dyn Fn(&Progress) + Send + Sync>;

pub struct QueueInner {
    db_path: PathBuf,
    thumbs: PathBuf,
    /// Videos are only read while this is here. DECISIONS.md "Video and ffmpeg".
    ffmpeg: Option<Ffmpeg>,
    stop: AtomicBool,
    walking: AtomicBool,
    completed: AtomicU64,
    report: Report,
}

impl QueueInner {
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
        })
    }
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
    ) -> JobQueue {
        let inner = Arc::new(QueueInner {
            db_path,
            thumbs,
            ffmpeg,
            stop: AtomicBool::new(false),
            walking: AtomicBool::new(false),
            completed: AtomicU64::new(0),
            report,
        });
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
            Ok(Ok(())) => {
                inner.completed.fetch_add(1, Ordering::Relaxed);
                table::complete(&conn, job.id)
            }
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

pub fn enqueue_thumb(conn: &Connection, item_id: i64) -> Result<()> {
    let payload = serde_json::to_string(&kinds::ItemPayload { item_id })?;
    table::enqueue(conn, kinds::THUMB, &payload, kinds::PRIORITY_THUMB)?;
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
}
