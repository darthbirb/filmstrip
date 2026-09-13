//! What each kind of job does. Runs on a worker thread, never on the window's.

use std::sync::atomic::Ordering;

use rusqlite::Connection;

use crate::db::items;
use crate::db::jobs::{self as table, QueuedJob};
use crate::error::{AppError, Result};
use crate::fs::{paths, walk};
use crate::jobs::kinds::{self, ItemPayload};
use crate::jobs::{QueueInner, enqueue_thumb};
use crate::media::thumbs;

pub fn execute(inner: &QueueInner, conn: &mut Connection, job: &QueuedJob) -> Result<()> {
    match job.kind.as_str() {
        kinds::INDEX => index(inner, conn),
        kinds::THUMB => thumb(inner, conn, serde_json::from_str(&job.payload)?),
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

    let wanted: Vec<i64> = items::live_media(conn, inner.ffmpeg.is_some())?
        .into_iter()
        .filter(|media| !media.read || !inner.thumbs.join(paths::thumb_rel(&media.uuid)).is_file())
        .map(|media| media.id)
        .collect();
    let tx = conn.transaction()?;
    for id in wanted {
        enqueue_thumb(&tx, id)?;
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
        "video" => {
            let ffmpeg = inner
                .ffmpeg
                .as_ref()
                .ok_or_else(|| AppError::Media("ffmpeg is not available".into()))?;
            thumbs::video(ffmpeg, &source, &out)?
        }
        kind => {
            return Err(AppError::invalid(format!(
                "no thumbnail is made for a file of the kind {kind}"
            )));
        }
    };
    items::record_media(conn, payload.item_id, &learned)
}

/// A locked or busy file may work next time; a format the decoder cannot read never will.
pub fn is_transient(error: &AppError) -> bool {
    matches!(error, AppError::Io(_) | AppError::Db(_))
}
