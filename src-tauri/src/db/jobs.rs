//! The job table: what is waiting, what is running, and what failed. The runner is `crate::jobs`.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use ts_rs::TS;

use crate::db::{begin, folders, now};
use crate::error::{Reason, Result};
use crate::jobs::kinds::{COPY_IN, OWN_LINES, WALKS};

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
    conn.prepare_cached(
        "INSERT INTO job (kind, payload, status, priority, created_at)
         VALUES (?1, ?2, 'pending', ?3, ?4)",
    )?
    .execute(params![kind, payload, priority, now()])?;
    Ok(conn.last_insert_rowid())
}

/// Whether this exact job is already waiting or running.
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
    Ok(conn
        .prepare_cached(
            "SELECT EXISTS(SELECT 1 FROM job WHERE kind = ?1 AND payload = ?2 AND status = 'pending')",
        )?
        .query_row(params![kind, payload], |r| r.get(0))?)
}

/// Takes the most urgent waiting job and marks it running. The immediate transaction stops two
/// workers from taking the same one, and a walk waits while another walk runs.
pub fn claim(conn: &mut Connection) -> Result<Option<QueuedJob>> {
    let tx = begin(conn)?;
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

/// Back to waiting when another attempt is allowed; otherwise failed, keeping why.
pub fn fail(conn: &Connection, id: i64, reason: &Reason, retry: bool) -> Result<()> {
    conn.execute(
        "UPDATE job SET status = ?1, error = ?2 WHERE id = ?3",
        params![
            if retry { "pending" } else { "failed" },
            serde_json::to_string(reason)?,
            id
        ],
    )?;
    Ok(())
}

/// Back to waiting without counting as an attempt, for a job the app stopped partway as it closed.
pub fn release(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE job SET status = 'pending', attempts = MAX(attempts - 1, 0) WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Takes a copy, a move or an export off the queue while it waits, and returns its payload; nothing when
/// it is running or gone.
pub fn cancel_pending(conn: &Connection, id: i64, kind: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row(
            "DELETE FROM job WHERE id = ?1 AND kind = ?2 AND status = 'pending' RETURNING payload",
            params![id, kind],
            |r| r.get(0),
        )
        .optional()?)
}

/// Each copy not yet started, oldest first, with what it carries.
pub fn waiting_copies(conn: &Connection) -> Result<Vec<(i64, String)>> {
    waiting(conn, COPY_IN)
}

/// Each job of a kind not yet started, oldest first, with its payload.
pub fn waiting(conn: &Connection, kind: &str) -> Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, payload FROM job WHERE kind = ?1 AND status = 'pending' ORDER BY id",
    )?;
    let rows = stmt
        .query_map([kind], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Takes every job of a kind off the table, whatever its state, and returns their payloads.
pub fn take_all(conn: &Connection, kind: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("DELETE FROM job WHERE kind = ?1 RETURNING payload")?;
    let rows = stmt
        .query_map([kind], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// The walk's work and what it queues: a copy, a move and an export count themselves.
pub fn counts(conn: &Connection) -> Result<Counts> {
    let mut counts = Counts::default();
    let mut stmt = conn.prepare(
        "SELECT status, COUNT(*) FROM job
          WHERE kind NOT IN (SELECT value FROM json_each(?1)) GROUP BY status",
    )?;
    let rows = stmt.query_map([serde_json::to_string(&OWN_LINES)?], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
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

/// One failed job that counts in the walk's line, placed by the file or folder it was about, with
/// why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Failure {
    pub job_id: i64,
    pub kind: String,
    /// From inside its source down: the folders, then the file's own name; a source's own folder
    /// by the source's title. Empty for a job about no one file or folder.
    pub path: Vec<String>,
    pub item_id: Option<i64>,
    pub folder_id: Option<i64>,
    pub reason: Reason,
    pub attempts: i64,
}

pub fn failures(conn: &Connection) -> Result<Vec<Failure>> {
    let mut stmt = conn.prepare(
        "SELECT j.id, j.kind, j.error, j.attempts, i.id, i.disk_name, f.id,
                CASE WHEN f.parent_id IS NULL THEN s.title END
           FROM job j
           LEFT JOIN item i ON i.id = json_extract(j.payload, '$.itemId')
           LEFT JOIN folder f ON f.id = COALESCE(i.folder_id, json_extract(j.payload, '$.folderId'))
           LEFT JOIN source s ON s.id = f.source_id
          WHERE j.status = 'failed' AND j.kind NOT IN (SELECT value FROM json_each(?1))
          ORDER BY j.id",
    )?;
    let rows: Vec<_> = stmt
        .query_map([serde_json::to_string(&OWN_LINES)?], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, Option<i64>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<i64>>(6)?,
                r.get::<_, Option<String>>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut places: HashMap<i64, Vec<String>> = HashMap::new();
    rows.into_iter()
        .map(
            |(job_id, kind, error, attempts, item_id, name, folder_id, source)| {
                let mut path = match folder_id {
                    Some(id) if places.contains_key(&id) => places[&id].clone(),
                    Some(id) => {
                        let titles = folders::location(conn, id)?.titles;
                        places.insert(id, titles.clone());
                        titles
                    }
                    None => Vec::new(),
                };
                path.extend(name.or(source));
                Ok(Failure {
                    job_id,
                    kind,
                    path,
                    item_id,
                    folder_id,
                    reason: error
                        .and_then(|kept| serde_json::from_str(&kept).ok())
                        .unwrap_or(Reason::Other),
                    attempts,
                })
            },
        )
        .collect()
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
        fail(&conn, id, &Reason::InUse, true).unwrap();
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
        fail(&conn, broken, &Reason::Unsupported, false).unwrap();

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
    fn a_failure_is_placed_by_its_file_inside_its_source_with_its_reason() {
        let mut conn = conn();
        let source = sources::add(
            &conn,
            Path::new("D:/library"),
            "Library",
            SourceKind::Library,
        )
        .unwrap();
        let root = folders::source_root_folder(&conn, source.id).unwrap();
        let trips = folders::create(&conn, root, "Trips").unwrap();
        let cairo = folders::create(&conn, trips, "Cairo").unwrap();
        let item = items::upsert(
            &conn,
            &NewItem {
                uuid: "u".into(),
                source_id: source.id,
                folder_id: cairo,
                disk_name: "_DSC4411.ARW".into(),
                ext: "arw".into(),
                orig_name: "_DSC4411.ARW".into(),
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
        let thumb = enqueue(&conn, "thumb", &format!("{{\"itemId\":{item}}}"), 20).unwrap();
        let walk = enqueue(
            &conn,
            "index_folder",
            &format!("{{\"folderId\":{trips}}}"),
            100,
        )
        .unwrap();
        let refresh = enqueue(
            &conn,
            "index_folder",
            &format!("{{\"folderId\":{root}}}"),
            100,
        )
        .unwrap();
        let whole = enqueue(&conn, "index", "{}", 100).unwrap();
        for _ in 0..3 {
            claim(&mut conn).unwrap();
        }
        fail(&conn, thumb, &Reason::Unsupported, false).unwrap();
        fail(&conn, walk, &Reason::PermissionDenied, false).unwrap();
        fail(&conn, refresh, &Reason::Busy, false).unwrap();
        conn.execute(
            "UPDATE job SET status = 'failed', error = 'database is locked' WHERE id = ?1",
            [whole],
        )
        .unwrap();

        let failed = failures(&conn).unwrap();
        let placed: Vec<_> = failed
            .iter()
            .map(|one| (one.path.join("\\"), one.item_id, one.folder_id, &one.reason))
            .collect();
        assert_eq!(
            placed,
            [
                (
                    r"Trips\Cairo\_DSC4411.ARW".to_owned(),
                    Some(item),
                    Some(cairo),
                    &Reason::Unsupported
                ),
                (
                    "Trips".to_owned(),
                    None,
                    Some(trips),
                    &Reason::PermissionDenied
                ),
                ("Library".to_owned(), None, Some(root), &Reason::Busy),
                (String::new(), None, None, &Reason::Other),
            ]
        );
    }

    #[test]
    fn the_list_leaves_out_what_counts_itself_as_the_count_does() {
        let conn = conn();
        let walk = enqueue(&conn, "index", "{}", 100).unwrap();
        fail(&conn, walk, &Reason::Busy, false).unwrap();
        for kind in OWN_LINES {
            let own = enqueue(&conn, kind, "{\"folderId\":1}", 50).unwrap();
            fail(&conn, own, &Reason::DiskFull, false).unwrap();
        }

        let listed: Vec<i64> = failures(&conn)
            .unwrap()
            .iter()
            .map(|one| one.job_id)
            .collect();
        assert_eq!(listed, [walk]);
        assert_eq!(counts(&conn).unwrap().failed, 1);
    }
}
