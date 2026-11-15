//! Library files on their way to the Recycle Bin, kept until each send has settled.
//! DECISIONS.md "Sending to the Recycle Bin".

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

use crate::error::Result;

const RECYCLING: &str = "recycling";

/// Every library file whose send to the Recycle Bin has not settled: each is kept until its send
/// returns, or until a launch settles what one cut short left beside it.
pub fn unsettled(conn: &Connection) -> Result<Vec<PathBuf>> {
    let text: Option<String> = conn
        .query_row(
            "SELECT value FROM setting WHERE key = ?1",
            params![RECYCLING],
            |r| r.get(0),
        )
        .optional()?;
    Ok(text
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

pub fn add(conn: &Connection, file: &Path) -> Result<()> {
    let mut files = unsettled(conn)?;
    if !files.iter().any(|one| one == file) {
        files.push(file.to_path_buf());
    }
    keep(conn, &files)
}

pub fn settled(conn: &Connection, file: &Path) -> Result<()> {
    let mut files = unsettled(conn)?;
    files.retain(|one| one != file);
    keep(conn, &files)
}

fn keep(conn: &Connection, files: &[PathBuf]) -> Result<()> {
    if files.is_empty() {
        conn.execute("DELETE FROM setting WHERE key = ?1", params![RECYCLING])?;
    } else {
        conn.execute(
            "INSERT INTO setting (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![RECYCLING, serde_json::to_string(files)?],
        )?;
    }
    Ok(())
}
