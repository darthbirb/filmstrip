//! What a batch did, read back from its journal rows in the terms the line at the foot of
//! navigation is written in, both after the act and after undoing it. DECISIONS.md "Undo".

use std::collections::BTreeSet;

use rusqlite::Connection;
use serde::Serialize;
use serde::de::DeserializeOwned;
use ts_rs::TS;

use crate::db::journal::{
    self, Entry, FolderCreated, FolderDeleted, FolderMoved, FolderRenamed, ItemMoved, ItemTrashed,
};
use crate::db::{folders, items};
use crate::error::{AppError, Result};

/// One act, and how many files and folders it holds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Batch {
    pub batch_id: String,
    pub act: Act,
    /// Every file the act carried, those inside a moved folder included.
    pub files: u32,
    pub folders: u32,
}

/// What the act was. Places are named as navigation names them; `from` is `None` when the files
/// came from more than one folder, and `one` names the file when there was only one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Act {
    /// Files moved into one folder, with any folders that went with them.
    Move {
        from: Option<String>,
        to: String,
        one: Option<String>,
    },
    MoveFolder {
        name: String,
        from: String,
        to: String,
    },
    /// Files sent to the trash.
    Delete {
        from: Option<String>,
        one: Option<String>,
    },
    RenameFolder {
        from: String,
        to: String,
    },
    CreateFolder {
        name: String,
        parent: String,
    },
    /// A folder deleted; `into` names the sorting source its contents went to, and is `None`
    /// when they went to the trash with it or it held nothing.
    DeleteFolder {
        name: String,
        parent: String,
        into: Option<String>,
    },
}

/// Describes a batch still in the journal.
pub fn describe(conn: &Connection, batch_id: &str) -> Result<Batch> {
    let entries = journal::batch(conn, batch_id)?;
    let (files, folders) = count(conn, &entries)?;
    Ok(Batch {
        batch_id: batch_id.to_string(),
        act: act(conn, &entries)?,
        files,
        folders,
    })
}

/// How many files and folders the rows still hold: a moved folder carries the files under it.
pub fn count(conn: &Connection, entries: &[Entry]) -> Result<(u32, u32)> {
    let (mut files, mut folders_held) = (0, 0);
    for entry in entries {
        match entry.op.as_str() {
            journal::ITEM_MOVE | journal::ITEM_TRASH => files += 1,
            journal::FOLDER_MOVE => {
                let moved: FolderMoved = forward(entry)?;
                files += items::live_under(conn, moved.folder_id)?.len() as u32;
                folders_held += 1;
            }
            _ => folders_held += 1,
        }
    }
    Ok((files, folders_held))
}

fn act(conn: &Connection, entries: &[Entry]) -> Result<Act> {
    let of = |op: &'static str| entries.iter().filter(move |entry| entry.op == op);
    if let Some(entry) = of(journal::FOLDER_DELETE).next() {
        let deleted: FolderDeleted = forward(entry)?;
        // What a deleted folder held went to one sorting source's own folder, if anywhere.
        let into = match (
            of(journal::ITEM_MOVE).next(),
            of(journal::FOLDER_MOVE).next(),
        ) {
            (Some(entry), _) => Some(name(conn, forward::<ItemMoved>(entry)?.to_folder_id)?),
            (None, Some(entry)) => Some(name(conn, forward::<FolderMoved>(entry)?.to_parent_id)?),
            (None, None) => None,
        };
        return Ok(Act::DeleteFolder {
            name: name(conn, deleted.folder_id)?,
            parent: parent_name(conn, deleted.folder_id)?,
            into,
        });
    }
    if let Some(entry) = of(journal::FOLDER_CREATE).next() {
        let made: FolderCreated = forward(entry)?;
        return Ok(Act::CreateFolder {
            name: name(conn, made.folder_id)?,
            parent: name(conn, made.parent_id)?,
        });
    }
    if let Some(entry) = of(journal::FOLDER_RENAME).next() {
        let renamed: FolderRenamed = forward(entry)?;
        return Ok(Act::RenameFolder {
            from: renamed.from,
            to: renamed.to,
        });
    }
    let trashed: Vec<ItemTrashed> = of(journal::ITEM_TRASH)
        .map(forward)
        .collect::<Result<_>>()?;
    let moved: Vec<ItemMoved> = of(journal::ITEM_MOVE).map(forward).collect::<Result<_>>()?;
    let carried: Vec<FolderMoved> = of(journal::FOLDER_MOVE)
        .map(forward)
        .collect::<Result<_>>()?;
    if !trashed.is_empty() {
        let ids: Vec<i64> = trashed.iter().map(|one| one.item_id).collect();
        let origins = ids
            .iter()
            .map(|id| items::file_of(conn, *id).map(|file| file.map_or(0, |file| file.folder_id)))
            .collect::<Result<BTreeSet<i64>>>()?;
        return Ok(Act::Delete {
            from: only(conn, origins)?,
            one: one_name(conn, &ids)?,
        });
    }
    if let ([folder], []) = (carried.as_slice(), moved.as_slice()) {
        return Ok(Act::MoveFolder {
            name: name(conn, folder.folder_id)?,
            from: name(conn, folder.from_parent_id)?,
            to: name(conn, folder.to_parent_id)?,
        });
    }
    let to = moved
        .first()
        .map(|one| one.to_folder_id)
        .or_else(|| carried.first().map(|folder| folder.to_parent_id))
        .ok_or_else(|| AppError::invalid("there is nothing left of that act"))?;
    let origins = moved
        .iter()
        .map(|one| one.from_folder_id)
        .chain(carried.iter().map(|folder| folder.from_parent_id))
        .collect();
    let ids: Vec<i64> = moved.iter().map(|one| one.item_id).collect();
    Ok(Act::Move {
        from: only(conn, origins)?,
        to: name(conn, to)?,
        one: if carried.is_empty() {
            one_name(conn, &ids)?
        } else {
            None
        },
    })
}

/// A folder as navigation names it: a source's own folder goes by the source's title.
fn name(conn: &Connection, folder_id: i64) -> Result<String> {
    Ok(folders::ancestry(conn, folder_id)?
        .pop()
        .map(|crumb| crumb.title)
        .unwrap_or_default())
}

fn parent_name(conn: &Connection, folder_id: i64) -> Result<String> {
    match folders::parent(conn, folder_id)? {
        Some(parent) => name(conn, parent),
        None => Ok(String::new()),
    }
}

/// The one folder a set of files came from, or nothing when there were several.
fn only(conn: &Connection, origins: BTreeSet<i64>) -> Result<Option<String>> {
    match origins.into_iter().collect::<Vec<_>>().as_slice() {
        [folder] => name(conn, *folder).map(Some),
        _ => Ok(None),
    }
}

fn one_name(conn: &Connection, ids: &[i64]) -> Result<Option<String>> {
    match ids {
        [id] => Ok(items::file_of(conn, *id)?.map(|file| file.disk_name)),
        _ => Ok(None),
    }
}

/// The journal is JSON that outlives the code that wrote it, so a row that no longer reads is an
/// error for this act, never a crash.
fn forward<T: DeserializeOwned>(entry: &Entry) -> Result<T> {
    serde_json::from_value(entry.forward.clone())
        .map_err(|err| AppError::invalid(format!("journal row {} does not read: {err}", entry.id)))
}
