//! What each kind of job does. Runs on a worker thread, never on the window's.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use rusqlite::Connection;

use crate::db::jobs::{self as table, QueuedJob};
use crate::db::{self, items, journal, sources};
use crate::error::{AppError, Reason, Result};
use crate::fs::export as fs_export;
use crate::fs::paste::{self, Halt};
use crate::fs::stayed::Stayed;
use crate::fs::{items as fs_items, paths, relocate, walk};
use crate::jobs::kinds::{
    self, CopyPayload, ExportPayload, FolderPayload, ItemPayload, MovePayload,
};
use crate::jobs::{
    Copied, Copying, Exporting, Moved, Moving, QueueInner, enqueue_scrub, enqueue_thumb, exported,
    lock, thumbed,
};
use crate::media::ffmpeg::Ffmpeg;
use crate::media::probe::Probe;
use crate::media::{scrub, thumbs};

/// How a job that did not fail ended.
pub enum Done {
    Finished,
    /// Stopped partway as the app closed, to go on at the next launch.
    Paused,
}

pub fn execute(inner: &QueueInner, conn: &mut Connection, job: &QueuedJob) -> Result<Done> {
    let finished = |result: Result<()>| result.map(|()| Done::Finished);
    match job.kind.as_str() {
        kinds::INDEX => index(inner, conn),
        kinds::INDEX_FOLDER => finished(index_folder(
            inner,
            conn,
            serde_json::from_str(&job.payload)?,
        )),
        kinds::THUMB => finished(thumb(inner, conn, serde_json::from_str(&job.payload)?)),
        kinds::SCRUB => finished(scrub(inner, conn, serde_json::from_str(&job.payload)?)),
        kinds::COPY_IN => copy_in(inner, conn, job.id, serde_json::from_str(&job.payload)?),
        kinds::MOVE => move_across(inner, conn, job.id, &serde_json::from_str(&job.payload)?),
        kinds::EXPORT => {
            export(inner, conn, job.id, &serde_json::from_str(&job.payload)?);
            Ok(Done::Finished)
        }
        other => Err(AppError::invalid(format!("no job of the kind {other}"))),
    }
}

/// A copy into a folder, its line kept while it runs, and how it ended said once it has.
fn copy_in(
    inner: &QueueInner,
    conn: &Connection,
    job_id: i64,
    payload: CopyPayload,
) -> Result<Done> {
    let to = crate::fs::acts::name(conn, payload.folder_id).unwrap_or_default();
    let line = Copying {
        job_id,
        folder_id: payload.folder_id,
        to,
        done: 0,
        whole: payload.whole,
    };
    lock(&inner.copies).insert(job_id, line);
    let control = QueueControl { inner, job_id };
    let entries: Vec<PathBuf> = payload.paths.iter().map(PathBuf::from).collect();
    let ran = paste::run(
        conn,
        &payload.batch_id,
        payload.folder_id,
        &entries,
        &control,
    );
    let ended = match ran {
        Ok(outcome) if outcome.halted == Some(Halt::Stop) && outcome.stopped.is_none() => {
            return Ok(Done::Paused);
        }
        Ok(outcome) => Ended {
            whole: outcome.whole,
            refused: outcome.refused,
            cancelled: outcome.halted == Some(Halt::Cancel),
            stopped: outcome.stopped,
        },
        Err(err) => Ended {
            whole: paste::whole(&entries),
            refused: Vec::new(),
            cancelled: false,
            stopped: Some(Reason::of(&err)),
        },
    };
    announce(inner, conn, job_id, &payload, ended)?;
    Ok(Done::Finished)
}

/// A move between drives, its line kept while it runs, and how it ended said once it has. One the
/// app's closing stopped goes on at the next launch under the same batch.
fn move_across(
    inner: &QueueInner,
    conn: &Connection,
    job_id: i64,
    payload: &MovePayload,
) -> Result<Done> {
    let line = Moving {
        job_id,
        folder_id: payload.into,
        to: crate::fs::acts::name(conn, payload.into).unwrap_or_default(),
        done: 0,
        whole: payload.whole,
    };
    lock(&inner.moves).insert(job_id, line);
    let control = MoveControl { inner, job_id };
    let mut ended = Ended {
        whole: payload.whole,
        refused: Vec::new(),
        cancelled: false,
        stopped: None,
    };
    let halted = match fs_items::move_watched(
        conn,
        &payload.item_ids,
        payload.into,
        &payload.batch_id,
        &control,
    ) {
        Ok(outcome) => {
            ended.refused = outcome.report.refused;
            ended.stopped = outcome.stopped;
            outcome.halted
        }
        Err(err) => {
            ended.stopped = Some(Reason::of(&err));
            None
        }
    };
    drop(control);
    if halted == Some(Halt::Stop) {
        return Ok(Done::Paused);
    }
    ended.cancelled = halted == Some(Halt::Cancel);
    announce_move(inner, conn, job_id, payload, ended)?;
    Ok(Done::Finished)
}

/// A move taken off the queue as it waited: the part a crash left of it is cleared, and it ends as
/// one cancelled while running does, with what a run before a restart moved, if any did.
pub fn moved_waiting(
    inner: &QueueInner,
    conn: &Connection,
    job_id: i64,
    payload: &MovePayload,
) -> Result<()> {
    // Its job is already gone, so its line ends even when the tidy cannot.
    let cleared = fs_items::clear_parts(conn, &payload.item_ids, payload.into);
    let ended = Ended {
        whole: payload.whole,
        refused: Vec::new(),
        cancelled: true,
        stopped: None,
    };
    announce_move(inner, conn, job_id, payload, ended)?;
    cleared
}

fn announce_move(
    inner: &QueueInner,
    conn: &Connection,
    job_id: i64,
    payload: &MovePayload,
    ended: Ended,
) -> Result<()> {
    (inner.moved)(&Moved {
        job_id,
        folder_id: payload.into,
        to: crate::fs::acts::name(conn, payload.into).unwrap_or_default(),
        batch: batch_of(conn, &payload.batch_id)?,
        whole: ended.whole,
        refused: ended.refused,
        cancelled: ended.cancelled,
        stopped: ended.stopped,
    });
    Ok(())
}

/// What a job's batch did, described; nothing when it wrote nothing.
fn batch_of(conn: &Connection, batch_id: &str) -> Result<Option<crate::fs::acts::Batch>> {
    if journal::batch(conn, batch_id)?.is_empty() {
        return Ok(None);
    }
    crate::fs::acts::describe(conn, batch_id).map(Some)
}

struct MoveControl<'a> {
    inner: &'a QueueInner,
    job_id: i64,
}

/// A move's line and its Cancel go when it ends, however it ends: a panic included.
impl Drop for MoveControl<'_> {
    fn drop(&mut self) {
        lock(&self.inner.moves).remove(&self.job_id);
        lock(&self.inner.cancelled).remove(&self.job_id);
    }
}

impl relocate::Control for MoveControl<'_> {
    fn halt(&self) -> Option<Halt> {
        halt_of(self.inner, self.job_id)
    }

    fn progress(&self, done: u32, whole: u32) {
        if let Some(line) = lock(&self.inner.moves).get_mut(&self.job_id) {
            line.done = done;
            line.whole = whole;
        }
    }
}

/// An export, its line kept while it runs, and how it ended said once it has. One the app's
/// closing stopped says nothing, and is not taken up again.
fn export(inner: &QueueInner, conn: &Connection, job_id: i64, payload: &ExportPayload) {
    let dest = Path::new(&payload.dest);
    let line = Exporting {
        job_id,
        zip: dest
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: payload.dest.clone(),
        done: 0,
        whole: payload.whole,
    };
    lock(&inner.exports).insert(job_id, line);
    let control = ExportControl { inner, job_id };
    let outcome = fs_export::run(
        conn,
        &payload.scope,
        payload.naming,
        dest,
        Path::new(&payload.part),
        &control,
    );
    drop(control);
    if !outcome.closed {
        (inner.exported)(&exported(job_id, payload, outcome));
    }
}

struct ExportControl<'a> {
    inner: &'a QueueInner,
    job_id: i64,
}

/// An export's line and its Cancel go when it ends, however it ends.
impl Drop for ExportControl<'_> {
    fn drop(&mut self) {
        lock(&self.inner.exports).remove(&self.job_id);
        lock(&self.inner.cancelled).remove(&self.job_id);
    }
}

impl fs_export::Control for ExportControl<'_> {
    fn halt(&self) -> Option<Halt> {
        halt_of(self.inner, self.job_id)
    }

    fn progress(&self, done: u32, whole: u32) {
        if let Some(line) = lock(&self.inner.exports).get_mut(&self.job_id) {
            line.done = done;
            line.whole = whole;
        }
    }
}

/// Why a job stops before its next file: the app closing, or its Cancel.
fn halt_of(inner: &QueueInner, job_id: i64) -> Option<Halt> {
    if inner.stop.load(Ordering::Relaxed) {
        Some(Halt::Stop)
    } else if lock(&inner.cancelled).contains(&job_id) {
        Some(Halt::Cancel)
    } else {
        None
    }
}

/// A copy taken off the queue as it waited, after a restart or before it ever ran: what a crash
/// left of it is cleared, and it ends as one cancelled while running does.
pub fn cancel_waiting(
    inner: &QueueInner,
    conn: &Connection,
    job_id: i64,
    payload: &CopyPayload,
) -> Result<()> {
    // Its job is already gone, so its line ends even when the tidy cannot.
    let abandoned = paste::abandon(conn, &payload.batch_id, payload.folder_id);
    let ended = Ended {
        whole: payload.whole,
        refused: Vec::new(),
        cancelled: true,
        stopped: None,
    };
    announce(inner, conn, job_id, payload, ended)?;
    abandoned
}

struct Ended {
    whole: u32,
    refused: Vec<Stayed>,
    cancelled: bool,
    stopped: Option<Reason>,
}

fn announce(
    inner: &QueueInner,
    conn: &Connection,
    job_id: i64,
    payload: &CopyPayload,
    ended: Ended,
) -> Result<()> {
    (inner.announce)(&Copied {
        job_id,
        folder_id: payload.folder_id,
        to: crate::fs::acts::name(conn, payload.folder_id).unwrap_or_default(),
        batch: batch_of(conn, &payload.batch_id)?,
        whole: ended.whole,
        refused: ended.refused,
        cancelled: ended.cancelled,
        stopped: ended.stopped,
    });
    Ok(())
}

struct QueueControl<'a> {
    inner: &'a QueueInner,
    job_id: i64,
}

/// A copy's line and its Cancel go when it ends, however it ends: a panic included.
impl Drop for QueueControl<'_> {
    fn drop(&mut self) {
        lock(&self.inner.copies).remove(&self.job_id);
        lock(&self.inner.cancelled).remove(&self.job_id);
    }
}

impl paste::Control for QueueControl<'_> {
    fn halt(&self) -> Option<Halt> {
        halt_of(self.inner, self.job_id)
    }

    fn progress(&self, done: u32, whole: u32) {
        if let Some(line) = lock(&self.inner.copies).get_mut(&self.job_id) {
            line.done = done;
            line.whole = whole;
        }
    }

    /// A picture's thumbnail is queued as it lands, and a video's while ffmpeg is at hand.
    fn landed(&self, conn: &Connection, item_id: i64, kind: &str) -> Result<()> {
        if kind == "image" || (kind == "video" && self.inner.ffmpeg.is_some()) {
            enqueue_thumb(conn, item_id)?;
        }
        Ok(())
    }
}

/// Walks every source, then queues every picture, and every video once ffmpeg is at hand, that
/// changed since it was last read or has lost its thumbnail. A hold or the app closing stops it
/// before its next directory, to walk again from the start.
fn index(inner: &QueueInner, conn: &mut Connection) -> Result<Done> {
    table::clear_failed(conn)?;
    inner.walking.store(true, Ordering::Relaxed);
    let halt = || inner.held.load(Ordering::Relaxed) || inner.stop.load(Ordering::Relaxed);
    let walked = walk::reconcile_until(conn, &halt);
    walked_once(inner);
    if walked?.is_none() {
        return Ok(Done::Paused);
    }
    queue_thumbs(inner, conn)?;
    Ok(Done::Finished)
}

/// One folder's subtree walked again, then the same thumbnails queued as after a whole walk.
fn index_folder(inner: &QueueInner, conn: &mut Connection, payload: FolderPayload) -> Result<()> {
    inner.walking.store(true, Ordering::Relaxed);
    let walked = walk::reconcile_folder(conn, payload.folder_id);
    walked_once(inner);
    walked?;
    queue_thumbs(inner, conn)
}

fn walked_once(inner: &QueueInner) {
    inner.walking.store(false, Ordering::Relaxed);
    inner.walks.fetch_add(1, Ordering::Relaxed);
}

/// Queues what a reachable source's pictures, and its videos once ffmpeg is at hand, still lack:
/// a thumbnail for one unread or without it, then a read video's scrub frames. The index is told
/// what the cache holds of every picture and video, ffmpeg or not.
fn queue_thumbs(inner: &QueueInner, conn: &mut Connection) -> Result<()> {
    let looked = look_in_cache(inner, conn)?;
    queue_looked(inner, conn, &looked)
}

struct Looked {
    media: items::LiveMedia,
    thumbed: bool,
    scrubbed: bool,
    here: bool,
}

/// What the cache holds of every live picture and video, looked for without the write lock.
/// DECISIONS.md "Background work".
fn look_in_cache(inner: &QueueInner, conn: &Connection) -> Result<Vec<Looked>> {
    let here: HashSet<i64> = sources::list(conn)?
        .into_iter()
        .filter(|source| Path::new(&source.root).is_dir())
        .map(|source| source.id)
        .collect();
    let cached = |rel: String| inner.thumbs.join(rel).is_file();
    Ok(items::live_media(conn)?
        .into_iter()
        .map(|media| Looked {
            thumbed: cached(paths::thumb_rel(&media.uuid)),
            scrubbed: media.scrubs && cached(paths::frames_rel(&media.uuid)),
            here: here.contains(&media.source_id),
            media,
        })
        .collect())
}

fn queue_looked(inner: &QueueInner, conn: &mut Connection, looked: &[Looked]) -> Result<()> {
    let tx = db::begin(conn)?;
    for one in looked {
        let media = &one.media;
        if one.thumbed != media.thumbed {
            items::set_thumbed(&tx, media.id, one.thumbed)?;
        }
        if one.scrubbed != media.scrubbed {
            items::set_scrubbed(&tx, media.id, one.scrubbed)?;
        }
        if !one.here || (media.video && inner.ffmpeg.is_none()) {
            continue;
        }
        if !media.read || !one.thumbed {
            enqueue_thumb(&tx, media.id)?;
        } else if media.scrubs && !one.scrubbed {
            enqueue_scrub(&tx, media.id)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Makes an item's thumbnail, and records what reading its file taught.
fn thumb(inner: &QueueInner, conn: &Connection, payload: ItemPayload) -> Result<()> {
    let Some(file) = items::file_of(conn, payload.item_id)? else {
        return Ok(());
    };
    let made = make_thumb(inner, conn, &file);
    let Some(learned) = unless_away(conn, payload.item_id, &file, made)? else {
        return Ok(());
    };
    record(conn, payload.item_id, &file.kind, &learned)?;
    items::set_thumbed(conn, payload.item_id, true)?;
    thumbed(inner, payload.item_id);
    Ok(())
}

fn make_thumb(inner: &QueueInner, conn: &Connection, file: &items::ItemFile) -> Result<Probe> {
    let source = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    let out = inner.thumbs.join(paths::thumb_rel(&file.uuid));
    match file.kind.as_str() {
        "image" => thumbs::picture(&source, &out),
        "video" => thumbs::video(ffmpeg_of(inner)?, &source, &out),
        kind => Err(AppError::invalid(format!(
            "no thumbnail is made for a file of the kind {kind}"
        ))),
    }
}

/// A file that could not be read because it or its source went away is not a failure: the next
/// walk retires it, or queues it again once its drive is back.
fn unless_away<T>(
    conn: &Connection,
    item_id: i64,
    file: &items::ItemFile,
    made: Result<T>,
) -> Result<Option<T>> {
    let err = match made {
        Ok(made) => return Ok(Some(made)),
        Err(err) => err,
    };
    let root_here = items::live_root(conn, item_id)?.is_some_and(|root| Path::new(&root).is_dir());
    let file_here = root_here
        && paths::item_path(conn, file.folder_id, &file.disk_name).is_ok_and(|path| path.is_file());
    if file_here { Err(err) } else { Ok(None) }
}

/// Records what a thumbnail's read taught, and queues a video's scrub frames after it.
fn record(conn: &Connection, item_id: i64, kind: &str, learned: &Probe) -> Result<()> {
    items::record_media(conn, item_id, learned)?;
    if kind == "video" && learned.duration_ms.is_some_and(|ms| ms > 0) {
        enqueue_scrub(conn, item_id)?;
    }
    Ok(())
}

/// Makes a video's scrub frames, from the length its thumbnail's probe recorded.
fn scrub(inner: &QueueInner, conn: &Connection, payload: ItemPayload) -> Result<()> {
    let Some(file) = items::file_of(conn, payload.item_id)? else {
        return Ok(());
    };
    let length = file
        .duration_ms
        .filter(|_| file.kind == "video")
        .ok_or_else(|| AppError::invalid("only a video with a length has scrub frames"))?;
    let made = paths::item_path(conn, file.folder_id, &file.disk_name).and_then(|source| {
        let out = inner.thumbs.join(paths::frames_rel(&file.uuid));
        scrub::make(ffmpeg_of(inner)?, &source, length, &out)
    });
    if unless_away(conn, payload.item_id, &file, made)?.is_none() {
        return Ok(());
    }
    items::set_scrubbed(conn, payload.item_id, true)?;
    thumbed(inner, payload.item_id);
    Ok(())
}

fn ffmpeg_of(inner: &QueueInner) -> Result<&Ffmpeg> {
    inner
        .ffmpeg
        .as_ref()
        .ok_or_else(|| AppError::Media("ffmpeg is not available".into()))
}

/// A locked or busy file may work next time; a format the decoder cannot read never will.
pub fn is_transient(error: &AppError) -> bool {
    matches!(error, AppError::Io(_) | AppError::Db(_))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, sources, sources::SourceKind};
    use std::path::Path;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-worker")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("library")).unwrap();
        std::fs::create_dir_all(dir.join("tools")).unwrap();
        dir
    }

    /// A queue that believes ffmpeg is at hand: two empty programs in its tools.
    fn queue_in(dir: &Path) -> QueueInner {
        let tools = dir.join("tools");
        for stem in ["ffmpeg", "ffprobe"] {
            let name = if cfg!(windows) {
                format!("{stem}.exe")
            } else {
                stem.to_owned()
            };
            std::fs::write(tools.join(name), "").unwrap();
        }
        QueueInner::new(
            dir.join("library.db"),
            dir.join("thumbs"),
            Ffmpeg::discover(&tools),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        )
    }

    fn library(dir: &Path, names: &[&str]) -> (Connection, Vec<(i64, String)>) {
        for name in names {
            std::fs::write(dir.join("library").join(name), "bytes").unwrap();
        }
        let mut conn = db::open(&dir.join("library.db")).unwrap();
        db::migrate(&mut conn).unwrap();
        sources::add(&conn, &dir.join("library"), "Library", SourceKind::Library).unwrap();
        walk::reconcile(&conn).unwrap();
        let ids = names
            .iter()
            .map(|name| {
                conn.query_row(
                    "SELECT id, uuid FROM item WHERE disk_name = ?1",
                    [name],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap()
            })
            .collect();
        (conn, ids)
    }

    fn queued(conn: &Connection) -> Vec<(String, i64)> {
        let mut stmt = conn
            .prepare("SELECT kind, payload FROM job WHERE status = 'pending' ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
            .map(|row| {
                let (kind, payload) = row.unwrap();
                let payload: ItemPayload = serde_json::from_str(&payload).unwrap();
                (kind, payload.item_id)
            })
            .collect()
    }

    fn made(inner: &QueueInner, rel: String) {
        let path = inner.thumbs.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "webp").unwrap();
    }

    fn length(ms: Option<i64>) -> Probe {
        Probe {
            width: Some(320),
            height: Some(180),
            duration_ms: ms,
            ..Probe::default()
        }
    }

    #[test]
    fn a_videos_scrub_frames_are_queued_after_its_thumbnail_and_a_pictures_never() {
        let dir = scratch("after-thumb");
        let (conn, ids) = library(&dir, &["clip.mp4", "still.mp4", "photo.png"]);
        let [(clip, _), (still, _), (photo, _)] = ids.as_slice() else {
            unreachable!()
        };
        record(&conn, *clip, "video", &length(Some(12_000))).unwrap();
        record(&conn, *still, "video", &length(None)).unwrap();
        record(&conn, *photo, "image", &length(None)).unwrap();
        assert_eq!(queued(&conn), [(kinds::SCRUB.to_owned(), *clip)]);

        record(&conn, *clip, "video", &length(Some(12_000))).unwrap();
        assert_eq!(queued(&conn).len(), 1, "one waiting is enough");
    }

    #[test]
    fn a_walk_queues_scrub_frames_for_a_read_video_still_missing_them() {
        let dir = scratch("walk-queues");
        let inner = queue_in(&dir);
        let names = [
            "missing.mp4",
            "made.mp4",
            "unread.mp4",
            "short.mp4",
            "photo.png",
        ];
        let (mut conn, ids) = library(&dir, &names);
        let [missing, done, unread, short, photo] = ids.as_slice() else {
            unreachable!()
        };
        for (id, uuid) in [missing, done, short, photo] {
            made(&inner, paths::thumb_rel(uuid));
            let ms = (id != &short.0 && id != &photo.0).then_some(12_000);
            items::record_media(&conn, *id, &length(ms)).unwrap();
        }
        made(&inner, paths::frames_rel(&done.1));

        queue_thumbs(&inner, &mut conn).unwrap();
        assert_eq!(
            queued(&conn),
            [
                (kinds::SCRUB.to_owned(), missing.0),
                (kinds::THUMB.to_owned(), unread.0),
            ]
        );
    }

    fn cached(conn: &Connection, id: i64) -> (bool, bool) {
        conn.query_row(
            "SELECT thumbed, scrubbed FROM item WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn a_walk_tells_the_index_what_the_cache_holds_of_each_file() {
        let dir = scratch("walk-records-cache");
        let inner = queue_in(&dir);
        let (mut conn, ids) = library(&dir, &["clip.mp4", "lost.png", "photo.png"]);
        let [(clip, clip_uuid), (lost, _), (photo, photo_uuid)] = ids.as_slice() else {
            unreachable!()
        };
        items::record_media(&conn, *clip, &length(Some(12_000))).unwrap();
        made(&inner, paths::thumb_rel(clip_uuid));
        made(&inner, paths::frames_rel(clip_uuid));
        made(&inner, paths::thumb_rel(photo_uuid));
        items::set_thumbed(&conn, *lost, true).unwrap();
        items::set_scrubbed(&conn, *lost, true).unwrap();

        queue_thumbs(&inner, &mut conn).unwrap();
        assert_eq!(cached(&conn, *clip), (true, true));
        assert_eq!(cached(&conn, *photo), (true, false));
        assert_eq!(
            cached(&conn, *lost),
            (false, false),
            "its cache was cleared"
        );
    }

    #[test]
    fn without_ffmpeg_a_walk_still_tells_the_index_what_the_cache_holds_of_each_video() {
        let dir = scratch("walk-records-cache-no-ffmpeg");
        let inner = QueueInner::new(
            dir.join("library.db"),
            dir.join("thumbs"),
            None,
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
            Box::new(|_| {}),
        );
        let (mut conn, ids) = library(&dir, &["lost.mp4", "kept.mp4"]);
        let [(lost, _), (kept, kept_uuid)] = ids.as_slice() else {
            unreachable!()
        };
        for id in [lost, kept] {
            items::record_media(&conn, *id, &length(Some(12_000))).unwrap();
        }
        items::set_thumbed(&conn, *lost, true).unwrap();
        items::set_scrubbed(&conn, *lost, true).unwrap();
        made(&inner, paths::thumb_rel(kept_uuid));
        made(&inner, paths::frames_rel(kept_uuid));

        queue_thumbs(&inner, &mut conn).unwrap();
        assert_eq!(
            cached(&conn, *lost),
            (false, false),
            "its cache was cleared"
        );
        assert_eq!(cached(&conn, *kept), (true, true));
        assert!(queued(&conn).is_empty(), "videos wait for ffmpeg");
    }

    #[test]
    fn two_walks_queue_one_job_per_item() {
        let dir = scratch("walked-twice");
        let inner = queue_in(&dir);
        let (mut conn, ids) = library(&dir, &["clip.mp4", "photo.png"]);
        let [(clip, clip_uuid), (photo, _)] = ids.as_slice() else {
            unreachable!()
        };
        items::record_media(&conn, *clip, &length(Some(12_000))).unwrap();
        made(&inner, paths::thumb_rel(clip_uuid));

        queue_thumbs(&inner, &mut conn).unwrap();
        queue_thumbs(&inner, &mut conn).unwrap();
        assert_eq!(
            queued(&conn),
            [
                (kinds::SCRUB.to_owned(), *clip),
                (kinds::THUMB.to_owned(), *photo),
            ]
        );
    }

    /// A second source, walked while its drive was in and then unplugged; its one picture's id.
    fn unplugged(dir: &Path, conn: &Connection) -> i64 {
        let away = dir.join("away");
        std::fs::create_dir_all(&away).unwrap();
        std::fs::write(away.join("far.png"), "bytes").unwrap();
        sources::add(conn, &away, "Away", SourceKind::Library).unwrap();
        walk::reconcile(conn).unwrap();
        std::fs::remove_dir_all(&away).unwrap();
        conn.query_row("SELECT id FROM item WHERE disk_name = 'far.png'", [], |r| {
            r.get(0)
        })
        .unwrap()
    }

    #[test]
    fn a_source_that_cannot_be_reached_has_nothing_queued() {
        let dir = scratch("walk-offline");
        let inner = queue_in(&dir);
        let (mut conn, ids) = library(&dir, &["photo.png"]);
        let far = unplugged(&dir, &conn);
        items::set_thumbed(&conn, far, true).unwrap();

        queue_thumbs(&inner, &mut conn).unwrap();
        assert_eq!(queued(&conn), [(kinds::THUMB.to_owned(), ids[0].0)]);
        assert_eq!(
            cached(&conn, far),
            (false, false),
            "the cache is on this disk, so the index still learns what it holds"
        );
    }

    #[test]
    fn a_job_whose_source_went_away_is_not_a_failure() {
        let dir = scratch("job-offline");
        let inner = queue_in(&dir);
        let (conn, ids) = library(&dir, &["broken.png", "clip.mp4"]);
        let [(broken, _), (clip, _)] = ids.as_slice() else {
            unreachable!()
        };
        items::record_media(&conn, *clip, &length(Some(12_000))).unwrap();
        let far = unplugged(&dir, &conn);
        let item = |item_id| ItemPayload { item_id };

        assert!(thumb(&inner, &conn, item(*broken)).is_err(), "it is here");
        assert!(scrub(&inner, &conn, item(*clip)).is_err(), "it is here");
        assert!(thumb(&inner, &conn, item(far)).is_ok());

        std::fs::remove_dir_all(dir.join("library")).unwrap();
        assert!(thumb(&inner, &conn, item(*broken)).is_ok());
        assert!(scrub(&inner, &conn, item(*clip)).is_ok());
        assert_eq!(cached(&conn, *broken), (false, false));
        assert_eq!(cached(&conn, *clip), (false, false));
    }

    #[test]
    fn a_job_for_an_item_since_removed_is_not_a_failure() {
        let dir = scratch("job-gone");
        let inner = queue_in(&dir);
        let (conn, ids) = library(&dir, &["gone.png"]);
        std::fs::remove_file(dir.join("library/gone.png")).unwrap();
        walk::reconcile(&conn).unwrap();

        assert!(thumb(&inner, &conn, ItemPayload { item_id: ids[0].0 }).is_ok());
        let removed = ItemPayload { item_id: 9_999 };
        assert!(thumb(&inner, &conn, removed).is_ok());
    }

    #[test]
    fn a_job_whose_file_was_deleted_before_a_walk_noticed_is_not_a_failure() {
        let dir = scratch("job-file-deleted");
        let inner = queue_in(&dir);
        let (conn, ids) = library(&dir, &["deleted.png", "clip.mp4"]);
        let [(deleted, _), (clip, _)] = ids.as_slice() else {
            unreachable!()
        };
        items::record_media(&conn, *clip, &length(Some(12_000))).unwrap();
        let read_at = |id: i64| -> Option<i64> {
            conn.query_row("SELECT probed_at FROM item WHERE id = ?1", [id], |r| {
                r.get(0)
            })
            .unwrap()
        };
        let clip_read = read_at(*clip);
        std::fs::remove_file(dir.join("library/deleted.png")).unwrap();
        std::fs::remove_file(dir.join("library/clip.mp4")).unwrap();

        assert!(thumb(&inner, &conn, ItemPayload { item_id: *deleted }).is_ok());
        assert!(scrub(&inner, &conn, ItemPayload { item_id: *clip }).is_ok());
        assert!(items::is_live(&conn, *deleted).unwrap(), "no walk ran");
        assert_eq!(read_at(*deleted), None, "nothing was recorded");
        assert_eq!(read_at(*clip), clip_read);
        assert_eq!(cached(&conn, *deleted), (false, false));
        assert_eq!(cached(&conn, *clip), (false, false));
        assert!(queued(&conn).is_empty());
    }

    #[test]
    fn progress_counts_each_walk_that_ends() {
        let dir = scratch("walks-counted");
        let inner = queue_in(&dir);
        let (mut conn, _) = library(&dir, &["photo.png"]);
        let root: i64 = conn
            .query_row("SELECT id FROM folder WHERE parent_id IS NULL", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(inner.progress(&conn).unwrap().walks, 0);

        index_folder(&inner, &mut conn, FolderPayload { folder_id: root }).unwrap();
        index(&inner, &mut conn).unwrap();
        assert_eq!(inner.progress(&conn).unwrap().walks, 2);
    }

    #[test]
    fn a_thumbnail_and_scrub_frames_made_are_recorded_and_reported_once() {
        let dir = scratch("made-reported");
        let inner = queue_in(&dir);
        let (conn, ids) = library(&dir, &["photo.png"]);
        let [(photo, _)] = ids.as_slice() else {
            unreachable!()
        };
        image::RgbImage::new(4, 3)
            .save(dir.join("library/photo.png"))
            .unwrap();

        thumb(&inner, &conn, ItemPayload { item_id: *photo }).unwrap();
        assert_eq!(cached(&conn, *photo), (true, false));

        let mut previous = None;
        let first = crate::jobs::next_report(&inner, &conn, &mut previous).unwrap();
        assert_eq!(first.thumbed, [*photo]);
        assert_eq!(
            crate::jobs::next_report(&inner, &conn, &mut previous),
            None,
            "nothing else changed"
        );
    }

    mod timing {
        use super::*;

        #[test]
        #[ignore = "timing: runs alone, one test at a time"]
        fn a_walk_over_a_hundred_thousand_waiting_pictures_holds_the_write_lock_under_two_seconds()
        {
            let dir = scratch("timing-queue");
            let inner = queue_in(&dir);
            let (mut conn, _) = library(&dir, &[]);
            let root: i64 = conn
                .query_row("SELECT id FROM folder WHERE parent_id IS NULL", [], |r| {
                    r.get(0)
                })
                .unwrap();
            let tx = db::begin(&conn).unwrap();
            for n in 0..100_000_i64 {
                tx.execute(
                    "INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, size_bytes,
                                       mtime, kind, added_at)
                     VALUES ('u' || ?1, 1, ?2, ?1 || '.jpg', 'jpg', 1, 1, 'image', 1)",
                    rusqlite::params![n, root],
                )
                .unwrap();
            }
            tx.commit().unwrap();
            queue_thumbs(&inner, &mut conn).unwrap();

            let looked = look_in_cache(&inner, &conn).unwrap();
            let started = std::time::Instant::now();
            queue_looked(&inner, &mut conn, &looked).unwrap();
            let held = started.elapsed();

            assert_eq!(queued(&conn).len(), 100_000);
            assert!(held < std::time::Duration::from_secs(2), "held it {held:?}");
        }
    }
}
