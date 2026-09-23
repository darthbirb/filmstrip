//! The job table: what is waiting, what is running, and what failed. The runner is `crate::jobs`.

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::now;
use crate::error::Result;
use crate::jobs::kinds::WALKS;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedJob {
    pub id: i64,
    pub kind: String,
    pub payload: String,
    /// Which attempt this is, counting from one.
    pub attempt: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    pub pending: i64,
    pub running: i64,
    pub failed: i64,
}

pub fn enqueue(conn: &Connection, kind: &str, payload: &str, priority: i64) -> Result<i64> {
    conn.execute(
        "INSERT INTO job (kind, payload, status, priority, created_at)
         VALUES (?1, ?2, 'pending', ?3, ?4)",
        params![kind, payload, priority, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Whether this exact job is already waiting or running. It scans the table, so a walk asks
/// once, never once per file.
pub fn is_queued(conn: &Connection, kind: &str, payload: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM job
                        WHERE kind = ?1 AND payload = ?2 AND status IN ('pending', 'running'))",
        params![kind, payload],
        |r| r.get(0),
    )?)
}

/// Whether this exact job is waiting to start. One already running may have read too early.
pub fn is_pending(conn: &Connection, kind: &str, payload: &str) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM job WHERE kind = ?1 AND payload = ?2 AND status = 'pending')",
        params![kind, payload],
        |r| r.get(0),
    )?)
}

/// Takes the most urgent waiting job and marks it running. The immediate transaction stops two
/// workers from taking the same one, and a walk waits while another walk runs.
pub fn claim(conn: &mut Connection) -> Result<Option<QueuedJob>> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let job = tx
        .query_row(
            "SELECT id, kind, payload, attempts + 1 FROM job
              WHERE status = 'pending'
                AND NOT (kind IN (?1, ?2) AND EXISTS(
                    SELECT 1 FROM job WHERE status = 'running' AND kind IN (?1, ?2)))
              ORDER BY priority DESC, id
              LIMIT 1",
            params![WALKS[0], WALKS[1]],
            |r| {
                Ok(QueuedJob {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    payload: r.get(2)?,
                    attempt: r.get(3)?,
                })
            },
        )
        .optional()?;
    if let Some(job) = &job {
        tx.execute(
            "UPDATE job SET status = 'running', attempts = ?1 WHERE id = ?2",
            params![job.attempt, job.id],
        )?;
    }
    tx.commit()?;
    Ok(job)
}

pub fn complete(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM job WHERE id = ?1", params![id])?;
    Ok(())
}

/// Back to waiting when another attempt is allowed; otherwise failed, keeping the error.
pub fn fail(conn: &Connection, id: i64, error: &str, retry: bool) -> Result<()> {
    conn.execute(
        "UPDATE job SET status = ?1, error = ?2 WHERE id = ?3",
        params![if retry { "pending" } else { "failed" }, error, id],
    )?;
    Ok(())
}

pub fn counts(conn: &Connection) -> Result<Counts> {
    let mut counts = Counts::default();
    let mut stmt = conn.prepare("SELECT status, COUNT(*) FROM job GROUP BY status")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
    for row in rows {
        match row? {
            (status, n) if status == "pending" => counts.pending = n,
            (status, n) if status == "running" => counts.running = n,
            (status, n) if status == "failed" => counts.failed = n,
            _ => {}
        }
    }
    Ok(counts)
}

/// Jobs a crash or a hurried shutdown left running go back to waiting.
pub fn requeue_running(conn: &Connection) -> Result<usize> {
    Ok(conn.execute(
        "UPDATE job SET status = 'pending' WHERE status = 'running'",
        [],
    )?)
}

/// Failures describe the walk that produced them; a new walk starts clean.
pub fn clear_failed(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM job WHERE status = 'failed'", [])?)
}

pub fn retry_failed(conn: &Connection) -> Result<usize> {
    Ok(conn.execute(
        "UPDATE job SET status = 'pending', attempts = 0, error = NULL WHERE status = 'failed'",
        [],
    )?)
}

/// One failed job, named by the file it was about, with what went wrong.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Failure {
    pub job_id: i64,
    pub kind: String,
    pub name: String,
    pub error: String,
    pub attempts: i64,
}

pub fn failures(conn: &Connection) -> Result<Vec<Failure>> {
    let mut stmt = conn.prepare(
        "SELECT j.id, j.kind, COALESCE(i.disk_name, j.kind),
                COALESCE(j.error, 'unknown error'), j.attempts
           FROM job j
           LEFT JOIN item i ON i.id = json_extract(j.payload, '$.itemId')
          WHERE j.status = 'failed'
          ORDER BY j.id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Failure {
                job_id: r.get(0)?,
                kind: r.get(1)?,
                name: r.get(2)?,
                error: r.get(3)?,
                attempts: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::items::{self, NewItem};
    use crate::db::sources::{self, SourceKind};
    use crate::db::{self, folders};
    use std::path::Path;

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    #[test]
    fn the_most_urgent_job_goes_first_then_the_oldest() {
        let mut conn = conn();
        let routine = enqueue(&conn, "thumb", "{}", 20).unwrap();
        let urgent = enqueue(&conn, "index", "{}", 100).unwrap();
        let later = enqueue(&conn, "thumb", "{\"n\":2}", 20).unwrap();

        let order: Vec<i64> =
            std::iter::from_fn(|| claim(&mut conn).unwrap().map(|job| job.id)).collect();
        assert_eq!(order, [urgent, routine, later]);
        assert_eq!(counts(&conn).unwrap().running, 3);
    }

    #[test]
    fn a_walk_waits_while_another_walk_runs_and_other_work_goes_past_it() {
        let mut conn = conn();
        let whole = enqueue(&conn, "index", "{}", 100).unwrap();
        let folder = enqueue(&conn, "index_folder", "{\"folderId\":4}", 100).unwrap();
        let thumb = enqueue(&conn, "thumb", "{}", 20).unwrap();

        assert_eq!(claim(&mut conn).unwrap().map(|job| job.id), Some(whole));
        assert_eq!(claim(&mut conn).unwrap().map(|job| job.id), Some(thumb));
        assert_eq!(claim(&mut conn).unwrap(), None);
        complete(&conn, whole).unwrap();
        assert_eq!(claim(&mut conn).unwrap().map(|job| job.id), Some(folder));
    }

    #[test]
    fn a_claimed_job_is_not_claimed_again() {
        let mut conn = conn();
        enqueue(&conn, "thumb", "{}", 20).unwrap();
        assert!(claim(&mut conn).unwrap().is_some());
        assert!(claim(&mut conn).unwrap().is_none());
    }

    #[test]
    fn attempts_count_from_one_and_survive_a_retry() {
        let mut conn = conn();
        let id = enqueue(&conn, "thumb", "{}", 20).unwrap();
        assert_eq!(claim(&mut conn).unwrap().unwrap().attempt, 1);
        fail(&conn, id, "locked", true).unwrap();
        assert_eq!(claim(&mut conn).unwrap().unwrap().attempt, 2);
    }

    #[test]
    fn success_removes_a_job_and_failure_keeps_it_with_its_error() {
        let mut conn = conn();
        let done = enqueue(&conn, "thumb", "{}", 20).unwrap();
        let broken = enqueue(&conn, "thumb", "{\"n\":2}", 20).unwrap();
        claim(&mut conn).unwrap();
        claim(&mut conn).unwrap();
        complete(&conn, done).unwrap();
        fail(&conn, broken, "not an image", false).unwrap();

        assert_eq!(
            counts(&conn).unwrap(),
            Counts {
                pending: 0,
                running: 0,
                failed: 1
            }
        );
        assert_eq!(retry_failed(&conn).unwrap(), 1);
        assert_eq!(
            claim(&mut conn).unwrap().unwrap().attempt,
            1,
            "a retry starts over"
        );
    }

    #[test]
    fn jobs_left_running_go_back_to_waiting() {
        let mut conn = conn();
        enqueue(&conn, "index", "{}", 100).unwrap();
        claim(&mut conn).unwrap();
        assert_eq!(requeue_running(&conn).unwrap(), 1);
        assert_eq!(counts(&conn).unwrap().pending, 1);
    }

    #[test]
    fn a_failure_is_named_after_the_file_it_was_about() {
        let mut conn = conn();
        let source = sources::add(
            &conn,
            Path::new("D:/library"),
            "Library",
            SourceKind::Library,
        )
        .unwrap();
        let root = folders::source_root_folder(&conn, source.id).unwrap();
        let item = items::upsert(
            &conn,
            &NewItem {
                uuid: "u".into(),
                source_id: source.id,
                folder_id: root,
                disk_name: "broken.jpg".into(),
                ext: "jpg".into(),
                orig_name: "broken.jpg".into(),
                hash: None,
                size_bytes: 1,
                mtime: 0,
                kind: "image".into(),
                width: None,
                height: None,
                duration_ms: None,
                codec: None,
                bitrate: None,
                captured_at: None,
                captured_src: None,
            },
        )
        .unwrap();
        let id = enqueue(&conn, "thumb", &format!("{{\"itemId\":{item}}}"), 20).unwrap();
        claim(&mut conn).unwrap();
        fail(&conn, id, "not an image", false).unwrap();

        let [failure] = failures(&conn).unwrap().try_into().unwrap();
        assert_eq!(
            (failure.name.as_str(), failure.error.as_str()),
            ("broken.jpg", "not an image")
        );
    }
}
