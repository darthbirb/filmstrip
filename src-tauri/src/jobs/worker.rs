//! What each kind of job does. Runs on a worker thread, never on the window's.

use std::collections::BTreeSet;

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

/// Walks every source, then queues a thumbnail for each picture that changed or never had one.
fn index(inner: &QueueInner, conn: &mut Connection) -> Result<()> {
    table::clear_failed(conn)?;
    let mut wanted = BTreeSet::new();
    inner
        .walking
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let walked = walk::reconcile_with(conn, &mut |id, kind| {
        if kind == "image" {
            wanted.insert(id);
        }
    });
    inner
        .walking
        .store(false, std::sync::atomic::Ordering::Relaxed);
    walked?;

    for (id, uuid) in items::live_images(conn)? {
        if !inner.thumbs.join(paths::thumb_rel(&uuid)).is_file() {
            wanted.insert(id);
        }
    }
    let tx = conn.transaction()?;
    for id in wanted {
        enqueue_thumb(&tx, id)?;
    }
    tx.commit()?;
    Ok(())
}

fn thumb(inner: &QueueInner, conn: &Connection, payload: ItemPayload) -> Result<()> {
    let (width, height) = thumbs::generate(conn, payload.item_id, &inner.thumbs)?;
    items::set_dimensions(conn, payload.item_id, width, height)
}

/// A locked or busy file may work next time; a format the decoder cannot read never will.
pub fn is_transient(error: &AppError) -> bool {
    matches!(error, AppError::Io(_) | AppError::Db(_))
}
