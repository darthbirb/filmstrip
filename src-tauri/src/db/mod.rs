//! Connections and migrations. **All SQL lives under this module** — callers
//! use functions, never queries.

pub mod folders;
pub mod items;
pub mod sources;
pub mod tags;

use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::error::Result;

/// Applied in order, never edited once shipped.
const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("migrations/001_initial.sql"))];

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

/// **Foreign keys are off for the duration, and restored on every exit path.**
/// DEVELOPMENT.md "Gotchas".
pub fn migrate(conn: &mut Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let result = migrate_inner(conn);
    conn.pragma_update(None, "foreign_keys", "ON")?;
    result
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
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_version (version) VALUES (?1)",
            [version],
        )?;
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

/// Folds a tag or label term. **Folder titles never go through this** — a
/// title keeps the case it was typed in.
pub fn fold(text: &str) -> String {
    text.to_lowercase()
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
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
        assert_eq!(applied, 1);
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
