//! What expiry sent to the Recycle Bin, kept after each file's row is forgotten, the files the bin
//! last refused, and library files on their way there. DECISIONS.md "Expiry goes to the Recycle Bin".

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::db::now;
use crate::error::Result;
use crate::fs::expiry::Limit;

/// A file that expired: its name, the folder it had left for the trash, and the limit that sent it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gone {
    pub item_id: i64,
    pub name: String,
    pub folder_id: i64,
    pub limit: Limit,
}

pub fn record(conn: &Connection, gone: &Gone) -> Result<()> {
    let (days, bytes) = match gone.limit {
        Limit::Age { days } => (Some(days), None),
        Limit::Size { bytes } => (None, Some(bytes)),
    };
    conn.execute(
        "INSERT OR REPLACE INTO expired (item_id, disk_name, folder_id, days, bytes, expired_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![gone.item_id, gone.name, gone.folder_id, days, bytes, now()],
    )?;
    Ok(())
}

/// The file an id named, when expiry sent it to the Recycle Bin and no row has taken the id since.
pub fn of(conn: &Connection, item_id: i64) -> Result<Option<Gone>> {
    Ok(conn
        .query_row(
            "SELECT disk_name, folder_id, days, bytes FROM expired
              WHERE item_id = ?1 AND NOT EXISTS(SELECT 1 FROM item WHERE id = ?1)",
            params![item_id],
            |r| {
                let days: Option<u32> = r.get(2)?;
                let bytes: Option<i64> = r.get(3)?;
                Ok(Gone {
                    item_id,
                    name: r.get(0)?,
                    folder_id: r.get(1)?,
                    limit: match days {
                        Some(days) => Limit::Age { days },
                        None => Limit::Size {
                            bytes: bytes.unwrap_or_default(),
                        },
                    },
                })
            },
        )
        .optional()?)
}

const REFUSED: &str = "expiry_refused";

/// The files the Recycle Bin refused at the last run, which stay in the trash.
pub fn refused(conn: &Connection) -> Result<Vec<i64>> {
    let text: Option<String> = conn
        .query_row(
            "SELECT value FROM setting WHERE key = ?1",
            params![REFUSED],
            |r| r.get(0),
        )
        .optional()?;
    Ok(text
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

pub fn set_refused(conn: &Connection, ids: &[i64]) -> Result<()> {
    conn.execute(
        "INSERT INTO setting (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![REFUSED, serde_json::to_string(ids)?],
    )?;
    Ok(())
}

const RECYCLING: &str = "recycling";

/// Every library file whose send to the Recycle Bin has not settled: each is kept until its send
/// returns, or until a launch settles what one cut short left beside it.
pub fn recycling(conn: &Connection) -> Result<Vec<PathBuf>> {
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

pub fn add_recycling(conn: &Connection, file: &Path) -> Result<()> {
    let mut files = recycling(conn)?;
    if !files.iter().any(|one| one == file) {
        files.push(file.to_path_buf());
    }
    keep_recycling(conn, &files)
}

pub fn settled_recycling(conn: &Connection, file: &Path) -> Result<()> {
    let mut files = recycling(conn)?;
    files.retain(|one| one != file);
    keep_recycling(conn, &files)
}

fn keep_recycling(conn: &Connection, files: &[PathBuf]) -> Result<()> {
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
