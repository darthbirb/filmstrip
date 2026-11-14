//! Connections and migrations. **All SQL lives under this module** — callers
//! use functions, never queries.

pub mod backup;
pub mod details;
pub mod folders;
pub mod items;
pub mod jobs;
pub mod journal;
pub mod keys;
pub mod search;
pub mod sources;
pub mod suggest;
pub mod tags;
pub mod vocabulary;

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, Transaction, TransactionBehavior};

use crate::error::Result;

/// Applied in order, never edited once shipped.
const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("migrations/001_initial.sql")),
    (2, include_str!("migrations/002_jobs.sql")),
    (3, include_str!("migrations/003_probed.sql")),
    (4, include_str!("migrations/004_journal.sql")),
    (5, include_str!("migrations/005_trash.sql")),
    (6, include_str!("migrations/006_keys.sql")),
    (7, include_str!("migrations/007_search.sql")),
    (8, include_str!("migrations/008_indexed.sql")),
    (9, include_str!("migrations/009_folder_tag_rev.sql")),
    (10, include_str!("migrations/010_frame.sql")),
];

type Rewrite = fn(&Connection) -> Result<()>;

/// Rewrites of stored rows that SQL cannot express, applied in order after every SQL migration,
/// so each runs against the latest schema. Never edited once shipped. SCHEMA.md "Migrations".
const DATA_MIGRATIONS: &[(i64, Rewrite)] = &[(1, tags::refold)];

/// The schema this build writes. An index from a later one is not a backup it can restore.
pub fn latest_schema() -> i64 {
    MIGRATIONS.last().map_or(0, |(version, _)| *version)
}

/// A connection with the app's pragmas. One per thread: WAL allows one writer
/// beside any number of readers.
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(20))?;
    // Returns the mode it ended up in, so it has to be queried rather than set.
    let _: String = conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "cache_size", -32_000i64)?;
    Ok(conn)
}

/// A transaction holding the write lock from its first statement, so another connection's write
/// makes it wait out the busy timeout instead of refusing it. DECISIONS.md "Background work".
#[expect(clippy::disallowed_methods)]
pub fn begin(conn: &Connection) -> Result<Transaction<'_>> {
    Ok(Transaction::new_unchecked(
        conn,
        TransactionBehavior::Immediate,
    )?)
}

/// Runs `work` in a transaction from `begin`, committed only if it succeeds.
pub fn in_transaction<T>(
    conn: &Connection,
    work: impl FnOnce(&Connection) -> Result<T>,
) -> Result<T> {
    let tx = begin(conn)?;
    let out = work(&tx)?;
    tx.commit()?;
    Ok(out)
}

/// **Foreign keys are off for the duration, and restored on every exit path.**
/// DEVELOPMENT.md "Gotchas".
pub fn migrate(conn: &mut Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let result = migrate_inner(conn);
    // Not pragma_update: its name check can read the file, and so mask the migration's error.
    let restored = conn.execute_batch("PRAGMA foreign_keys=ON");
    result?;
    Ok(restored?)
}

fn migrate_inner(conn: &mut Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);")?;
    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |r| r.get(0),
    )?;

    for (version, sql) in MIGRATIONS {
        if *version <= current {
            continue;
        }
        let tx = begin(conn)?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            [version],
        )?;
        tx.commit()?;
    }

    conn.execute_batch("CREATE TABLE IF NOT EXISTS data_version (version INTEGER NOT NULL);")?;
    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM data_version",
        [],
        |r| r.get(0),
    )?;
    for (version, rewrite) in DATA_MIGRATIONS {
        if *version <= current {
            continue;
        }
        let tx = begin(conn)?;
        rewrite(&tx)?;
        tx.execute("INSERT INTO data_version (version) VALUES (?1)", [version])?;
        tx.commit()?;
    }
    Ok(())
}

/// Fold the write-ahead log back into the one file. A closed library is a
/// single file, safe to copy.
pub fn checkpoint(conn: &Connection) -> Result<()> {
    conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))?;
    Ok(())
}

/// Folds a tag or label term: lowercase, trimmed, one space between its words. **Folder titles
/// never go through this** — a title keeps the case it was typed in. SCHEMA.md "Tags and labels".
pub fn fold(text: &str) -> String {
    text.to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Another connection holding the write lock on the index at `path`, as a claiming worker does,
/// let go only once SQLite makes `waiting` wait for it. `waiting` refused at once, without
/// waiting, finds the lock still held.
#[cfg(test)]
pub(crate) fn hold_write_lock(path: &Path, waiting: &mut Connection) {
    use std::cell::RefCell;

    thread_local! {
        static HELD: RefCell<Option<Connection>> = const { RefCell::new(None) };
    }
    fn release(_: i32) -> bool {
        HELD.with_borrow_mut(|held| held.take())
            .map(|other| other.execute_batch("COMMIT").unwrap())
            .is_some()
    }

    let other = open(path).unwrap();
    other.execute_batch("BEGIN IMMEDIATE").unwrap();
    HELD.set(Some(other));
    waiting.busy_handler(Some(release)).unwrap();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrating_twice_changes_nothing() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();

        let applied: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(applied, MIGRATIONS.len() as i64);
        let rewritten: i64 = conn
            .query_row("SELECT COUNT(*) FROM data_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rewritten, DATA_MIGRATIONS.len() as i64);
    }

    #[test]
    fn migration_10_leaves_a_populated_library_as_it_was_with_no_frame_read() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE schema_version (version INTEGER NOT NULL);")
            .unwrap();
        for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version < 10) {
            conn.execute_batch(sql).unwrap();
            conn.execute("INSERT INTO schema_version VALUES (?1)", [version])
                .unwrap();
        }
        let source = sources::add(
            &conn,
            Path::new("D:/library"),
            "Library",
            sources::SourceKind::Library,
        )
        .unwrap();
        conn.execute(
            "INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, size_bytes, mtime, kind,
                               width, height, duration_ms, codec, bitrate, added_at, probed_at)
             VALUES ('u', ?1, ?2, 'clip.mp4', 'mp4', 9, 1, 'video',
                     1920, 1080, 12000, 'h264', 8000000, 2, 3)",
            [
                source.id,
                folders::source_root_folder(&conn, source.id).unwrap(),
            ],
        )
        .unwrap();

        migrate(&mut conn).unwrap();

        let (read_at, codec, frame): (Option<i64>, String, Option<i64>) = conn
            .query_row(
                "SELECT probed_at, codec, frame_us FROM item WHERE uuid = 'u'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            read_at,
            Some(3),
            "a file read before keeps that it was read"
        );
        assert_eq!(codec, "h264");
        assert_eq!(frame, None);
    }

    #[test]
    fn a_failed_migration_returns_its_own_error_with_foreign_keys_back_on() {
        use std::cell::RefCell;
        use std::io::Write;
        use std::path::PathBuf;

        thread_local! {
            static GARBLE: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
        }
        fn garble_and_give_up(_: i32) -> bool {
            if let Some(path) = GARBLE.with_borrow_mut(|path| path.take()) {
                std::fs::OpenOptions::new()
                    .write(true)
                    .open(path)
                    .and_then(|mut file| file.write_all(&[0xAB; 100]))
                    .unwrap();
            }
            false
        }

        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-db/garbled");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("library.db");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE t (x INTEGER); BEGIN IMMEDIATE;")
            .unwrap();
        let mut conn = Connection::open(&path).unwrap();
        GARBLE.set(Some(path));
        conn.busy_handler(Some(garble_and_give_up)).unwrap();

        let err = migrate(&mut conn).unwrap_err();

        assert!(
            matches!(
                &err,
                crate::error::AppError::Db(e)
                    if e.sqlite_error_code() == Some(rusqlite::ErrorCode::DatabaseBusy)
            ),
            "the migration's own error, not the closing pragma's: {err}"
        );
        let on: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(on, 1);
    }

    #[test]
    fn an_item_cannot_exist_outside_a_folder() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();

        let sql = "INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, size_bytes, mtime, kind, added_at)
                   VALUES ('u', 1, NULL, 'a.jpg', 'jpg', 1, 0, 'image', 0)";
        assert!(
            conn.execute(sql, []).is_err(),
            "folder_id is NOT NULL by design"
        );
    }
}
