//! What each kind of job does. Runs on a worker thread, never on the window's.

use std::sync::atomic::Ordering;

use rusqlite::Connection;

use crate::db::items;
use crate::db::jobs::{self as table, QueuedJob};
use crate::error::{AppError, Result};
use crate::fs::{paths, walk};
use crate::jobs::kinds::{self, FolderPayload, ItemPayload};
use crate::jobs::{QueueInner, enqueue_scrub, enqueue_thumb};
use crate::media::ffmpeg::Ffmpeg;
use crate::media::probe::Probe;
use crate::media::{scrub, thumbs};

pub fn execute(inner: &QueueInner, conn: &mut Connection, job: &QueuedJob) -> Result<()> {
    match job.kind.as_str() {
        kinds::INDEX => index(inner, conn),
        kinds::INDEX_FOLDER => index_folder(inner, conn, serde_json::from_str(&job.payload)?),
        kinds::THUMB => thumb(inner, conn, serde_json::from_str(&job.payload)?),
        kinds::SCRUB => scrub(inner, conn, serde_json::from_str(&job.payload)?),
        other => Err(AppError::invalid(format!("no job of the kind {other}"))),
    }
}

/// Walks every source, then queues every picture, and every video once ffmpeg is at hand, that
/// changed since it was last read or has lost its thumbnail.
fn index(inner: &QueueInner, conn: &mut Connection) -> Result<()> {
    table::clear_failed(conn)?;
    inner.walking.store(true, Ordering::Relaxed);
    let walked = walk::reconcile(conn);
    inner.walking.store(false, Ordering::Relaxed);
    walked?;
    queue_thumbs(inner, conn)
}

/// One folder's subtree walked again, then the same thumbnails queued as after a whole walk.
fn index_folder(inner: &QueueInner, conn: &mut Connection, payload: FolderPayload) -> Result<()> {
    inner.walking.store(true, Ordering::Relaxed);
    let walked = walk::reconcile_folder(conn, payload.folder_id);
    inner.walking.store(false, Ordering::Relaxed);
    walked?;
    queue_thumbs(inner, conn)
}

/// Every picture, and every video once ffmpeg is at hand, not yet read or missing its thumbnail;
/// and every video read since, with its thumbnail, still missing its scrub frames.
fn queue_thumbs(inner: &QueueInner, conn: &mut Connection) -> Result<()> {
    let media = items::live_media(conn, inner.ffmpeg.is_some())?;
    let tx = conn.transaction()?;
    for one in media {
        let cached = |rel: String| inner.thumbs.join(rel).is_file();
        if !one.read || !cached(paths::thumb_rel(&one.uuid)) {
            enqueue_thumb(&tx, one.id)?;
        } else if one.scrubs && !cached(paths::frames_rel(&one.uuid)) {
            enqueue_scrub(&tx, one.id)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Makes an item's thumbnail, and records what reading its file taught.
fn thumb(inner: &QueueInner, conn: &Connection, payload: ItemPayload) -> Result<()> {
    let file = items::file_of(conn, payload.item_id)?
        .ok_or_else(|| AppError::invalid("the item is gone"))?;
    let source = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    let out = inner.thumbs.join(paths::thumb_rel(&file.uuid));
    let learned = match file.kind.as_str() {
        "image" => thumbs::picture(&source, &out)?,
        "video" => thumbs::video(ffmpeg_of(inner)?, &source, &out)?,
        kind => {
            return Err(AppError::invalid(format!(
                "no thumbnail is made for a file of the kind {kind}"
            )));
        }
    };
    record(conn, payload.item_id, &file.kind, &learned)
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
    let file = items::file_of(conn, payload.item_id)?
        .ok_or_else(|| AppError::invalid("the item is gone"))?;
    let length = file
        .duration_ms
        .filter(|_| file.kind == "video")
        .ok_or_else(|| AppError::invalid("only a video with a length has scrub frames"))?;
    let source = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    let out = inner.thumbs.join(paths::frames_rel(&file.uuid));
    scrub::make(ffmpeg_of(inner)?, &source, length, &out)
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
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU64};

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
        QueueInner {
            db_path: dir.join("library.db"),
            thumbs: dir.join("thumbs"),
            ffmpeg: Ffmpeg::discover(&tools),
            stop: AtomicBool::new(false),
            walking: AtomicBool::new(false),
            completed: AtomicU64::new(0),
            report: Box::new(|_| {}),
        }
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
}
