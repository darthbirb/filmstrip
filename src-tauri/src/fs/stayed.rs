//! What a verb or an undo could not move, and where it still is: the rows of the banner that
//! reports it, grouped there by where each stayed. DECISIONS.md "Undo".

use rusqlite::Connection;
use serde::Serialize;
use ts_rs::TS;

use crate::db::{folders, items};
use crate::error::{AppError, Reason, Result};

/// One file or folder that stayed where it was, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Stayed {
    pub kind: Thing,
    pub id: i64,
    pub name: String,
    pub at: Whereabouts,
    pub reason: Reason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Thing {
    File,
    Folder,
}

/// Where something that stayed is now: a folder, named from its source's own folder down, or
/// the app's trash.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Whereabouts {
    Folder {
        #[serde(rename = "folderId")]
        folder_id: i64,
        path: Vec<String>,
    },
    Trash,
}

/// A file that stayed, and where it is.
pub fn file(conn: &Connection, item_id: i64, err: &AppError) -> Result<Stayed> {
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    let at = if items::is_trashed(conn, item_id)? {
        Whereabouts::Trash
    } else {
        folder_at(conn, file.folder_id)?
    };
    Ok(Stayed {
        kind: Thing::File,
        id: item_id,
        name: file.disk_name,
        at,
        reason: Reason::of(err),
    })
}

/// A folder that stayed, and the folder it is in.
pub fn folder(conn: &Connection, folder_id: i64, err: &AppError) -> Result<Stayed> {
    let at = folders::parent(conn, folder_id)?.unwrap_or(folder_id);
    Ok(Stayed {
        kind: Thing::Folder,
        id: folder_id,
        name: folders::title(conn, folder_id)?.unwrap_or_default(),
        at: folder_at(conn, at)?,
        reason: Reason::of(err),
    })
}

fn folder_at(conn: &Connection, folder_id: i64) -> Result<Whereabouts> {
    let path = folders::ancestry(conn, folder_id)?
        .into_iter()
        .map(|crumb| crumb.title)
        .collect();
    Ok(Whereabouts::Folder { folder_id, path })
}
