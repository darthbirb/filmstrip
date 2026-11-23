//! Library files on their way to the Recycle Bin, kept until each send has settled.
//! DECISIONS.md "Sending to the Recycle Bin".

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::Result;

const RECYCLING: &str = "recycling";

/// One send not yet settled: the file, the item it is and the act it is part of, and once its
/// second name is made, the file itself and every name it had before the shell was asked.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sending {
    pub file: PathBuf,
    pub item_id: i64,
    pub batch_id: Option<String>,
    pub itself: Option<String>,
    pub before: Vec<PathBuf>,
}

impl Sending {
    pub fn new(file: &Path, item_id: i64, batch_id: Option<&str>) -> Sending {
        Sending {
            file: file.to_path_buf(),
            item_id,
            batch_id: batch_id.map(str::to_owned),
            itself: None,
            before: Vec::new(),
        }
    }
}

/// Every send to the Recycle Bin that has not settled: each is kept until its send has been
/// recorded, or until a launch settles what one cut short left.
pub fn unsettled(conn: &Connection) -> Result<Vec<Sending>> {
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

pub fn add(conn: &Connection, sending: &Sending) -> Result<()> {
    let mut all = unsettled(conn)?;
    all.retain(|one| one.file != sending.file);
    all.push(sending.clone());
    keep(conn, &all)
}

/// Records what the file is, and every name it has, before the shell is asked to take it.
pub fn holding(conn: &Connection, file: &Path, itself: &str, before: &[PathBuf]) -> Result<()> {
    let mut all = unsettled(conn)?;
    for one in all.iter_mut().filter(|one| one.file == file) {
        one.itself = Some(itself.to_owned());
        one.before = before.to_vec();
    }
    keep(conn, &all)
}

pub fn settled(conn: &Connection, file: &Path) -> Result<()> {
    let mut all = unsettled(conn)?;
    all.retain(|one| one.file != file);
    keep(conn, &all)
}

fn keep(conn: &Connection, all: &[Sending]) -> Result<()> {
    if all.is_empty() {
        conn.execute("DELETE FROM setting WHERE key = ?1", params![RECYCLING])?;
    } else {
        conn.execute(
            "INSERT INTO setting (key, value) VALUES (?1, ?2)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            params![RECYCLING, serde_json::to_string(all)?],
        )?;
    }
    Ok(())
}
