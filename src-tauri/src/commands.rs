//! The command boundary: each command opens a connection on a blocking thread,
//! calls a plain function, and returns. DEVELOPMENT.md "The command boundary".

use std::path::{Component, Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use ts_rs::TS;

use crate::db::folders::{self, FolderEntry, FolderNode};
use crate::db::items::{self, ItemDetail, ItemRow};
use crate::db::jobs::{self as job_table, Failure};
use crate::db::journal;
use crate::db::sources::{self, Refusal, Source, SourceKind};
use crate::db::tags::{self, EffectiveTag};
use crate::error::{AppError, Result};
use crate::fs::acts::{self, Batch};
use crate::fs::folders::{self as fs_folders, Contents, DeleteReport};
use crate::fs::items::{self as fs_items, MoveReport};
use crate::fs::paths;
use crate::fs::trash::{self, RestoreReport, TrashReport, TrashSummary, Trashed};
use crate::fs::undo::{self, UndoReport};
use crate::jobs::{self, JobQueue, Progress};

pub struct AppState {
    pub db: PathBuf,
    pub thumbs: PathBuf,
    pub queue: JobQueue,
}

/// What came of offering the app a folder. A refusal is an answer, not an error:
/// nothing is added, nothing is selected, and the band says which of the four it
/// was. DECISIONS.md "Places, not queries".
#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum AddOutcome {
    Added { source: Source },
    Refused { why: Refusal, clash: Option<String> },
}

/// A source as the navigation and Settings show it.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SourceSummary {
    #[serde(flatten)]
    pub source: Source,
    pub root_folder_id: i64,
    /// False when its directory cannot be read — an unplugged drive, say.
    pub reachable: bool,
    pub item_count: i64,
    pub total_bytes: i64,
    /// Whether its own folder is a favourite place.
    pub favorite: bool,
}

#[tauri::command]
pub async fn list_sources(state: State<'_, AppState>) -> Result<Vec<SourceSummary>> {
    run(&state, source_summaries).await
}

/// The system's own picker, which the app adds no step of its own to. `None` is a
/// cancelled picker, which is not an error and is not reported.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<String>> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    let picked = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await?
        .map_err(AppError::invalid)?;
    Ok(picked.map(|path| path.to_string()))
}

#[tauri::command]
pub async fn add_source(
    app: AppHandle,
    state: State<'_, AppState>,
    root: String,
    kind: SourceKind,
    title: Option<String>,
) -> Result<AddOutcome> {
    let app_dir = crate::config::app_dir()?;
    let outcome = run(&state, move |conn| {
        in_transaction(conn, |tx| {
            register_source(tx, &root, kind, title.as_deref(), &app_dir)
        })
    })
    .await?;
    if let AddOutcome::Added { source } = &outcome {
        app.asset_protocol_scope()
            .allow_directory(&source.root, true)?;
    }
    Ok(outcome)
}

#[tauri::command]
pub async fn rename_source(state: State<'_, AppState>, id: i64, title: String) -> Result<()> {
    run(&state, move |conn| {
        in_transaction(conn, |tx| sources::rename(tx, id, &title))
    })
    .await
}

#[tauri::command]
pub async fn set_source_kind(state: State<'_, AppState>, id: i64, kind: SourceKind) -> Result<()> {
    run(&state, move |conn| {
        in_transaction(conn, |tx| sources::set_kind(tx, id, kind))
    })
    .await
}

/// A source's own folder in Explorer. An offline source has none to open.
#[tauri::command]
pub async fn reveal_source(app: AppHandle, state: State<'_, AppState>, id: i64) -> Result<()> {
    let root = run(&state, move |conn| {
        sources::get(conn, id)?
            .map(|source| source.root)
            .ok_or_else(|| AppError::invalid("that source is no longer in the index"))
    })
    .await?;
    app.opener()
        .reveal_item_in_dir(root)
        .map_err(AppError::invalid)
}

/// A folder's own directory in Explorer.
#[tauri::command]
pub async fn reveal_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: i64,
) -> Result<()> {
    let dir = run(&state, move |conn| folder_to_reveal(conn, folder_id)).await?;
    app.opener()
        .reveal_item_in_dir(dir)
        .map_err(AppError::invalid)
}

/// The file that kept a folder from being deleted, selected in Explorer; the folder itself when
/// nothing keeps it any more.
#[tauri::command]
pub async fn reveal_held(app: AppHandle, state: State<'_, AppState>, folder_id: i64) -> Result<()> {
    let path = run(&state, move |conn| {
        let dir = folder_to_reveal(conn, folder_id)?;
        Ok(fs_folders::first_unseen(&dir)?.unwrap_or(dir))
    })
    .await?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(AppError::invalid)
}

/// Where a folder is on disk; a folder the index has retired has nowhere to show.
pub fn folder_to_reveal(conn: &Connection, folder_id: i64) -> Result<PathBuf> {
    if !folders::is_live(conn, folder_id)? {
        return Err(AppError::invalid("that folder is no longer in the index"));
    }
    paths::folder_dir(conn, folder_id)
}

/// A folder the app made, and the batch that undoes it.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderMade {
    pub folder_id: i64,
    pub batch: Batch,
}

/// A new folder inside another, on disk and in the index. DECISIONS.md "Undo".
#[tauri::command]
pub async fn create_folder(
    state: State<'_, AppState>,
    parent_id: i64,
    title: String,
) -> Result<FolderMade> {
    run(&state, move |conn| {
        let batch_id = journal::new_batch();
        let folder_id = fs_folders::create(conn, parent_id, &title, &batch_id)?;
        Ok(FolderMade {
            folder_id,
            batch: acts::describe(conn, &batch_id)?,
        })
    })
    .await
}

/// A folder renamed on disk; the batch that undoes it, or nothing when the name did not change.
#[tauri::command]
pub async fn rename_folder(
    state: State<'_, AppState>,
    folder_id: i64,
    title: String,
) -> Result<Option<Batch>> {
    run(&state, move |conn| {
        let batch_id = journal::new_batch();
        let changed = fs_folders::rename(conn, folder_id, &title, &batch_id)?;
        described(conn, changed, &batch_id)
    })
    .await
}

/// A folder moved into another with everything in it; the batch that undoes it, or nothing when it
/// was already there.
#[tauri::command]
pub async fn move_folder(
    state: State<'_, AppState>,
    folder_id: i64,
    parent_id: i64,
) -> Result<Option<Batch>> {
    run(&state, move |conn| {
        let batch_id = journal::new_batch();
        let moved = fs_folders::move_into(conn, folder_id, parent_id, &batch_id)?;
        described(conn, moved, &batch_id)
    })
    .await
}

/// The batch an act wrote, described, or nothing when the act changed nothing.
fn described(conn: &Connection, changed: bool, batch_id: &str) -> Result<Option<Batch>> {
    changed.then(|| acts::describe(conn, batch_id)).transpose()
}

/// What a move of files did, and the batch that undoes it when anything went.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ItemsMoved {
    pub batch: Option<Batch>,
    pub report: MoveReport,
}

/// Files moved into a folder, each under its own name; a name already taken there is reported.
#[tauri::command]
pub async fn move_items(
    state: State<'_, AppState>,
    item_ids: Vec<i64>,
    folder_id: i64,
) -> Result<ItemsMoved> {
    run(&state, move |conn| {
        let batch_id = journal::new_batch();
        let report = fs_items::move_items(conn, &item_ids, folder_id, &batch_id)?;
        Ok(ItemsMoved {
            batch: described(conn, report.moved > 0, &batch_id)?,
            report,
        })
    })
    .await
}

/// A file renamed where it is; the batch that undoes it, or nothing when the name did not change.
#[tauri::command]
pub async fn rename_item(
    state: State<'_, AppState>,
    item_id: i64,
    name: String,
) -> Result<Option<Batch>> {
    run(&state, move |conn| {
        let batch_id = journal::new_batch();
        let changed = fs_items::rename(conn, item_id, &name, &batch_id)?;
        described(conn, changed, &batch_id)
    })
    .await
}

/// What sending files to the trash did, and the batch that undoes it when anything went.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ItemsTrashed {
    pub batch: Option<Batch>,
    pub report: TrashReport,
}

/// Files sent to the app's trash, out of their folders, to wait there until taken back.
#[tauri::command]
pub async fn trash_items(state: State<'_, AppState>, item_ids: Vec<i64>) -> Result<ItemsTrashed> {
    run(&state, move |conn| {
        let batch_id = journal::new_batch();
        let report = trash::trash_items(conn, &item_ids, &batch_id)?;
        Ok(ItemsTrashed {
            batch: described(conn, report.trashed > 0, &batch_id)?,
            report,
        })
    })
    .await
}

/// What restoring files did, and the batch that undoes it when anything came back.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ItemsRestored {
    pub batch: Option<Batch>,
    pub report: RestoreReport,
}

/// Files out of the trash: each into the folder it left, or all into `folder_id` when one is given.
#[tauri::command]
pub async fn restore_items(
    state: State<'_, AppState>,
    item_ids: Vec<i64>,
    folder_id: Option<i64>,
) -> Result<ItemsRestored> {
    run(&state, move |conn| {
        let batch_id = journal::new_batch();
        let report = trash::restore_items(conn, &item_ids, folder_id, &batch_id)?;
        Ok(ItemsRestored {
            batch: described(conn, report.restored > 0, &batch_id)?,
            report,
        })
    })
    .await
}

/// How many files are at or below a folder: none, and deleting it asks nothing.
#[tauri::command]
pub async fn folder_file_count(state: State<'_, AppState>, folder_id: i64) -> Result<u32> {
    run(&state, move |conn| {
        Ok(items::live_under(conn, folder_id)?.len() as u32)
    })
    .await
}

/// What deleting a folder did, and the batch that undoes whatever of it happened.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FolderDeleted {
    pub batch: Option<Batch>,
    pub report: DeleteReport,
}

/// A folder deleted; one that holds files needs `contents` to say where they go.
#[tauri::command]
pub async fn delete_folder(
    state: State<'_, AppState>,
    folder_id: i64,
    contents: Option<Contents>,
) -> Result<FolderDeleted> {
    run(&state, move |conn| {
        let batch_id = journal::new_batch();
        let report = fs_folders::delete(conn, folder_id, contents, &batch_id)?;
        let journalled = !journal::batch(conn, &batch_id)?.is_empty();
        Ok(FolderDeleted {
            batch: described(conn, journalled, &batch_id)?,
            report,
        })
    })
    .await
}

/// Reverses whatever the app did last, in this session or an earlier one.
#[tauri::command]
pub async fn undo_last(state: State<'_, AppState>) -> Result<Option<UndoReport>> {
    run(&state, undo::undo_last).await
}

/// Reverses one batch by id, as a notice offering Undo names it.
#[tauri::command]
pub async fn undo_batch(state: State<'_, AppState>, batch_id: String) -> Result<UndoReport> {
    run(&state, move |conn| undo::undo_batch(conn, &batch_id)).await
}

/// The walk the app runs at launch, aimed at one folder and everything under it.
#[tauri::command]
pub async fn read_folder_again(state: State<'_, AppState>, folder_id: i64) -> Result<()> {
    run(&state, move |conn| {
        jobs::enqueue_folder_walk(conn, folder_id)
    })
    .await
}

#[tauri::command]
pub async fn remove_source(state: State<'_, AppState>, id: i64) -> Result<()> {
    run(&state, move |conn| {
        in_transaction(conn, |tx| sources::remove(tx, id))
    })
    .await
}

#[tauri::command]
pub async fn folder_children(
    state: State<'_, AppState>,
    folder_id: i64,
) -> Result<Vec<FolderNode>> {
    run(&state, move |conn| folders::children(conn, folder_id)).await
}

/// Every live folder in the library, for a picker that shows the whole tree and filters it.
#[tauri::command]
pub async fn list_folders(state: State<'_, AppState>) -> Result<Vec<FolderEntry>> {
    run(&state, folders::every_live).await
}

#[tauri::command]
pub async fn folder_items(state: State<'_, AppState>, folder_id: i64) -> Result<Vec<ItemRow>> {
    let thumbs = state.thumbs.clone();
    run(&state, move |conn| {
        Ok(with_thumbnails(items::in_folder(conn, folder_id)?, &thumbs))
    })
    .await
}

#[tauri::command]
pub async fn sorting_items(state: State<'_, AppState>) -> Result<Vec<ItemRow>> {
    let thumbs = state.thumbs.clone();
    run(&state, move |conn| {
        Ok(with_thumbnails(items::in_sorting(conn)?, &thumbs))
    })
    .await
}

/// A folder or a source marked a favourite place, or not.
#[tauri::command]
pub async fn set_folder_favorite(
    state: State<'_, AppState>,
    folder_id: i64,
    favorite: bool,
) -> Result<()> {
    run(&state, move |conn| {
        folders::set_favorite(conn, folder_id, favorite)
    })
    .await
}

/// A favourite place as navigation's group shows it: the way down to it, the files directly in
/// it, and whether its source can be read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FavouritePlace {
    pub folder_id: i64,
    pub source_id: i64,
    /// From the source's own folder, by the source's title, down to the place.
    pub path: Vec<folders::Crumb>,
    pub item_count: i64,
    pub reachable: bool,
}

#[tauri::command]
pub async fn favourite_places(state: State<'_, AppState>) -> Result<Vec<FavouritePlace>> {
    run(&state, favourites).await
}

/// Every live favourite place, in name order.
pub fn favourites(conn: &Connection) -> Result<Vec<FavouritePlace>> {
    let mut places = folders::favourites(conn)?
        .into_iter()
        .map(|(folder_id, item_count)| {
            let source_id = folders::location(conn, folder_id)?.source_id;
            let reachable = sources::get(conn, source_id)?
                .is_some_and(|source| Path::new(&source.root).is_dir());
            Ok(FavouritePlace {
                folder_id,
                source_id,
                path: folders::ancestry(conn, folder_id)?,
                item_count,
                reachable,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    places.sort_by_cached_key(|place| {
        place
            .path
            .last()
            .map(|crumb| crumb.title.to_lowercase())
            .unwrap_or_default()
    });
    Ok(places)
}

/// What the trash holds, the most recent first, each with the folder it left.
#[tauri::command]
pub async fn trash_listing(state: State<'_, AppState>) -> Result<Vec<Trashed>> {
    let thumbs = state.thumbs.clone();
    run(&state, move |conn| {
        let mut held = trash::listing(conn)?;
        for one in &mut held {
            one.row.thumb = thumb_of(&one.row.uuid, &thumbs);
        }
        Ok(held)
    })
    .await
}

/// How many files the trash holds, and their size.
#[tauri::command]
pub async fn trash_summary(state: State<'_, AppState>) -> Result<TrashSummary> {
    run(&state, trash::summary).await
}

#[tauri::command]
pub async fn item_tags(state: State<'_, AppState>, item_id: i64) -> Result<Vec<EffectiveTag>> {
    run(&state, move |conn| tags::item_effective_tags(conn, item_id)).await
}

/// One item in full for the pane, or nothing once it is gone.
#[tauri::command]
pub async fn item_detail(state: State<'_, AppState>, item_id: i64) -> Result<Option<ItemDetail>> {
    let thumbs = state.thumbs.clone();
    run(&state, move |conn| detail_of(conn, item_id, &thumbs)).await
}

/// Where an item's file was, for a pane showing one that has gone: a retired row still knows.
#[tauri::command]
pub async fn item_path(state: State<'_, AppState>, item_id: i64) -> Result<Option<String>> {
    run(&state, move |conn| last_path(conn, item_id)).await
}

/// Favourite is binary and acts on a selection, so one call covers any number of items.
#[tauri::command]
pub async fn set_item_favorite(
    state: State<'_, AppState>,
    item_ids: Vec<i64>,
    favorite: bool,
) -> Result<()> {
    run(&state, move |conn| {
        items::set_favorite(conn, &item_ids, favorite)
    })
    .await
}

/// The two escape hatches an app that indexes someone elses files owes them: show me where it is,
/// and open it in whatever I normally use. DECISIONS.md "The pane".
#[tauri::command]
pub async fn reveal_item(app: AppHandle, state: State<'_, AppState>, item_id: i64) -> Result<()> {
    let path = run(&state, move |conn| item_abs_path(conn, item_id)).await?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(AppError::invalid)
}

#[tauri::command]
pub async fn open_item(app: AppHandle, state: State<'_, AppState>, item_id: i64) -> Result<()> {
    let path = run(&state, move |conn| item_abs_path(conn, item_id)).await?;
    app.opener()
        .open_path(path.to_string_lossy().to_string(), None::<String>)
        .map_err(AppError::invalid)
}

/// One file or a whole selection, on the clipboard as files, so Explorer pastes the files themselves.
#[tauri::command]
pub async fn copy_items(state: State<'_, AppState>, item_ids: Vec<i64>) -> Result<()> {
    run(&state, move |conn| {
        crate::fs::clipboard::copy_files(&item_abs_paths(conn, &item_ids)?)
    })
    .await
}

/// Every file's path, in the order asked for; one no longer in the index refuses them all.
fn item_abs_paths(conn: &Connection, item_ids: &[i64]) -> Result<Vec<PathBuf>> {
    item_ids.iter().map(|&id| item_abs_path(conn, id)).collect()
}

/// Queues a walk of every source; asking again while one waits or runs does nothing.
#[tauri::command]
pub async fn start_index(state: State<'_, AppState>) -> Result<()> {
    run(&state, jobs::enqueue_index).await
}

#[tauri::command]
pub async fn index_progress(state: State<'_, AppState>) -> Result<Progress> {
    state.queue.progress()
}

#[tauri::command]
pub async fn index_failures(state: State<'_, AppState>) -> Result<Vec<Failure>> {
    run(&state, job_table::failures).await
}

#[tauri::command]
pub async fn retry_failed_jobs(state: State<'_, AppState>) -> Result<usize> {
    run(&state, job_table::retry_failed).await
}

#[tauri::command]
pub async fn ui_preferences() -> Result<Option<serde_json::Value>> {
    Ok(crate::config::Config::load().ui)
}

#[tauri::command]
pub async fn set_ui_preferences(preferences: serde_json::Value) -> Result<()> {
    crate::config::Config::set_ui(preferences)
}

/// Off the main thread, which a synchronous command would block.
async fn run<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(&Connection) -> Result<T> + Send + 'static,
) -> Result<T> {
    let path = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || work(&crate::db::open(&path)?)).await?
}

fn in_transaction<T>(conn: &Connection, work: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    let tx = conn.unchecked_transaction()?;
    let out = work(&tx)?;
    tx.commit()?;
    Ok(out)
}

/// Fills in the thumbnail path on each row whose thumbnail has been made.
pub fn with_thumbnails(mut rows: Vec<ItemRow>, thumbs: &Path) -> Vec<ItemRow> {
    for row in &mut rows {
        row.thumb = thumb_of(&row.uuid, thumbs);
    }
    rows
}

fn thumb_of(uuid: &str, thumbs: &Path) -> Option<String> {
    let path = thumbs.join(paths::thumb_rel(uuid));
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

/// Where an item file actually is, or an error once the index no longer holds it.
fn item_abs_path(conn: &Connection, item_id: i64) -> Result<PathBuf> {
    let file = items::file_of(conn, item_id)?
        .ok_or_else(|| AppError::invalid("that file is no longer in the index"))?;
    paths::item_path(conn, file.folder_id, &file.disk_name)
}

/// The path an item's file had when it was last read, live, retired or in the trash; nothing for
/// no such item.
pub fn last_path(conn: &Connection, item_id: i64) -> Result<Option<String>> {
    let Some(file) = items::file_of(conn, item_id)? else {
        return Ok(None);
    };
    let path = file_path(conn, item_id, &file)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Where a file is: in its folder, or where the trash keeps it under its uuid.
fn file_path(conn: &Connection, item_id: i64, file: &items::ItemFile) -> Result<PathBuf> {
    if items::is_trashed(conn, item_id)? {
        return paths::trash_path(&file.uuid, &file.disk_name);
    }
    paths::item_path(conn, file.folder_id, &file.disk_name)
}

/// An item in full, with the paths to its file and its thumbnail.
pub fn detail_of(conn: &Connection, item_id: i64, thumbs: &Path) -> Result<Option<ItemDetail>> {
    let Some(mut detail) = items::detail(conn, item_id)? else {
        return Ok(None);
    };
    let file = if detail.trashed_at.is_some() {
        paths::trash_path(&detail.row.uuid, &detail.row.disk_name)?
    } else {
        paths::item_path(conn, detail.row.folder_id, &detail.row.disk_name)?
    };
    detail.path = file.to_string_lossy().into_owned();
    detail.row.thumb = thumb_of(&detail.row.uuid, thumbs);
    Ok(Some(detail))
}

pub fn source_summaries(conn: &Connection) -> Result<Vec<SourceSummary>> {
    sources::list(conn)?
        .into_iter()
        .map(|source| {
            let (item_count, total_bytes) = sources::item_stats(conn, source.id)?;
            let root_folder_id = folders::source_root_folder(conn, source.id)?;
            Ok(SourceSummary {
                favorite: folders::is_favorite(conn, root_folder_id)?,
                root_folder_id,
                reachable: Path::new(&source.root).is_dir(),
                item_count,
                total_bytes,
                source,
            })
        })
        .collect()
}

/// Registers a directory as a source, titled after it unless a title is given, and queues its walk.
pub fn register_source(
    conn: &Connection,
    raw_root: &str,
    kind: SourceKind,
    title: Option<&str>,
    app_dir: &Path,
) -> Result<AddOutcome> {
    let root = match checked_root(conn, raw_root, app_dir)? {
        Ok(root) => root,
        Err(refused) => return Ok(refused),
    };
    let title = match title.map(str::trim) {
        Some(title) if !title.is_empty() => title.to_string(),
        _ => root.file_name().map_or_else(
            || root.display().to_string(),
            |name| name.to_string_lossy().into_owned(),
        ),
    };
    let source = sources::add(conn, &root, &title, kind)?;
    jobs::enqueue_index_again(conn)?;
    Ok(AddOutcome::Added { source })
}

/// An existing absolute directory, clear of every registered source and of the app's
/// own folder. The four a picker can hand over come back as a refusal to show; the
/// three it cannot produce — a relative path, a `..`, a file — stay errors.
fn checked_root(
    conn: &Connection,
    raw: &str,
    app_dir: &Path,
) -> Result<std::result::Result<PathBuf, AddOutcome>> {
    let root = PathBuf::from(raw.trim());
    if !root.is_absolute() {
        return Err(AppError::invalid(
            "a source needs a full path, drive included",
        ));
    }
    if root.components().any(|part| part == Component::ParentDir) {
        return Err(AppError::invalid("a source path may not contain `..`"));
    }
    if !root.is_dir() {
        return Err(AppError::invalid(format!(
            "{} is not a folder",
            root.display()
        )));
    }
    let root: PathBuf = root.components().collect();
    if paths::same_dir(&root, app_dir) || paths::contains(app_dir, &root) {
        return Ok(Err(AddOutcome::Refused {
            why: Refusal::AppFolder,
            clash: None,
        }));
    }
    if let Some((why, clash)) = sources::nesting_conflict(&sources::list(conn)?, &root) {
        return Ok(Err(AddOutcome::Refused {
            why,
            clash: Some(clash.title.clone()),
        }));
    }
    Ok(Ok(root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::fs::walk;
    use std::collections::BTreeSet;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-commands")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A stand-in for the app folder, so no test goes near the real one.
    fn app_dir(base: &Path) -> PathBuf {
        let dir = base.join("app");
        std::fs::create_dir_all(dir.join("data")).unwrap();
        dir
    }

    fn conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        conn
    }

    fn register(conn: &Connection, dir: &Path, app: &Path) -> Result<AddOutcome> {
        register_source(conn, dir.to_str().unwrap(), SourceKind::Library, None, app)
    }

    /// The source a taken folder produced; a refusal here is the test failing.
    fn added(outcome: AddOutcome) -> Source {
        match outcome {
            AddOutcome::Added { source } => source,
            AddOutcome::Refused { why, clash } => panic!("refused as {why:?} against {clash:?}"),
        }
    }

    #[test]
    fn a_source_is_titled_after_its_folder_unless_named() {
        let base = scratch("titled");
        let app = app_dir(&base);
        std::fs::create_dir_all(base.join("Holiday Pics")).unwrap();
        std::fs::create_dir_all(base.join("dump")).unwrap();
        let conn = conn();

        let plain = added(register(&conn, &base.join("Holiday Pics"), &app).unwrap());
        let dump = format!("{}/", base.join("dump").display());
        let named = added(
            register_source(&conn, &dump, SourceKind::Sorting, Some("  Incoming "), &app).unwrap(),
        );

        assert_eq!(plain.title, "Holiday Pics");
        assert_eq!(named.title, "Incoming");
        assert_eq!(named.kind, SourceKind::Sorting);
        assert!(
            !named.root.ends_with(['/', '\\']),
            "stored without a trailing separator"
        );
    }

    #[test]
    fn a_root_that_is_not_an_existing_absolute_folder_is_refused() {
        let base = scratch("refused");
        let app = app_dir(&base);
        let conn = conn();
        let missing = base.join("not-there");
        let climbing = format!("{}/../refused", base.display());

        for raw in ["", "photos", missing.to_str().unwrap(), climbing.as_str()] {
            let outcome = register_source(&conn, raw, SourceKind::Library, None, &app);
            assert!(outcome.is_err(), "{raw:?} should be refused");
        }
        assert!(sources::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_root_overlapping_a_source_or_the_app_folder_is_refused() {
        let base = scratch("overlap");
        let app = app_dir(&base);
        let library = base.join("library");
        std::fs::create_dir_all(library.join("inner")).unwrap();
        let conn = conn();
        register(&conn, &library, &app).unwrap();

        // Each says which of the four it was, since each has its own sentence in the band.
        let outside = base.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        for (dir, why, clash) in [
            (library.join("inner"), Refusal::Inside, Some("library")),
            (library.clone(), Refusal::Same, Some("library")),
            (base.clone(), Refusal::Contains, Some("library")),
            (app.join("data"), Refusal::AppFolder, None),
            (app.clone(), Refusal::AppFolder, None),
        ] {
            let outcome = register(&conn, &dir, &app).unwrap();
            let AddOutcome::Refused {
                why: got,
                clash: against,
            } = outcome
            else {
                panic!("{} should be refused", dir.display());
            };
            assert_eq!(got, why, "{} refused for the wrong reason", dir.display());
            assert_eq!(against.as_deref(), clash, "{}", dir.display());
        }
        // A folder that overlaps nothing is still taken, so the refusals are not a blanket no.
        added(register(&conn, &outside, &app).unwrap());
        assert_eq!(sources::list(&conn).unwrap().len(), 2);
    }

    #[test]
    fn an_added_source_is_walked_even_when_a_walk_is_already_running() {
        let base = scratch("queued");
        let app = app_dir(&base);
        let (first, second) = (base.join("first"), base.join("second"));
        std::fs::create_dir_all(&first).unwrap();
        std::fs::create_dir_all(&second).unwrap();
        let mut conn = conn();
        added(register(&conn, &first, &app).unwrap());
        assert!(job_table::is_pending(&conn, "index", "{}").unwrap());

        // The first walk starts, having listed only the first source.
        job_table::claim(&mut conn).unwrap().unwrap();
        added(register(&conn, &second, &app).unwrap());
        assert!(job_table::is_pending(&conn, "index", "{}").unwrap());
    }

    #[test]
    fn a_walked_source_can_be_browsed_from_its_summary_down_to_its_items() {
        let base = scratch("browse");
        let app = app_dir(&base);
        let library = base.join("library");
        std::fs::create_dir_all(library.join("Trips/Cairo")).unwrap();
        std::fs::write(library.join("Trips/Cairo/pyramid.jpg"), "abc").unwrap();
        std::fs::write(library.join("Trips/ticket.png"), "de").unwrap();
        let conn = conn();
        register(&conn, &library, &app).unwrap();
        walk::reconcile(&conn).unwrap();

        let [summary] = source_summaries(&conn).unwrap().try_into().unwrap();
        assert!(summary.reachable);
        assert_eq!((summary.item_count, summary.total_bytes), (2, 5));

        let [trips] = folders::children(&conn, summary.root_folder_id)
            .unwrap()
            .try_into()
            .unwrap();
        assert_eq!(
            (trips.title.as_str(), trips.child_count, trips.item_count),
            ("Trips", 1, 1)
        );
        let [ticket] = items::in_folder(&conn, trips.id)
            .unwrap()
            .try_into()
            .unwrap();
        assert_eq!(
            (ticket.disk_name.as_str(), ticket.kind.as_str()),
            ("ticket.png", "image")
        );
    }

    #[test]
    fn a_folder_shows_where_it_is_until_the_index_retires_it() {
        let base = scratch("reveal-folder");
        let app = app_dir(&base);
        let library = base.join("library");
        std::fs::create_dir_all(library.join("Trips")).unwrap();
        let conn = conn();
        register(&conn, &library, &app).unwrap();
        walk::reconcile(&conn).unwrap();
        let [summary] = source_summaries(&conn).unwrap().try_into().unwrap();
        let [trips] = folders::children(&conn, summary.root_folder_id)
            .unwrap()
            .try_into()
            .unwrap();
        assert_eq!(
            folder_to_reveal(&conn, trips.id).unwrap(),
            library.join("Trips")
        );

        std::fs::remove_dir_all(library.join("Trips")).unwrap();
        walk::reconcile(&conn).unwrap();
        assert!(folder_to_reveal(&conn, trips.id).is_err());
    }

    #[test]
    fn a_file_gone_from_disk_still_says_where_it_was() {
        let base = scratch("gone");
        let app = app_dir(&base);
        let library = base.join("library");
        std::fs::create_dir_all(library.join("Trips")).unwrap();
        std::fs::write(library.join("Trips/ticket.png"), "de").unwrap();
        let conn = conn();
        register(&conn, &library, &app).unwrap();
        walk::reconcile(&conn).unwrap();
        let [summary] = source_summaries(&conn).unwrap().try_into().unwrap();
        let [trips] = folders::children(&conn, summary.root_folder_id)
            .unwrap()
            .try_into()
            .unwrap();
        let [ticket] = items::in_folder(&conn, trips.id)
            .unwrap()
            .try_into()
            .unwrap();

        std::fs::remove_file(library.join("Trips/ticket.png")).unwrap();
        walk::reconcile(&conn).unwrap();

        assert!(
            detail_of(&conn, ticket.id, &base).unwrap().is_none(),
            "the item is gone"
        );
        let was = last_path(&conn, ticket.id).unwrap().unwrap();
        assert!(
            was.ends_with("ticket.png") && was.contains("Trips"),
            "{was}"
        );
        assert_eq!(last_path(&conn, 9_999).unwrap(), None);
    }

    #[test]
    fn favourite_places_list_by_name_and_a_deleted_one_leaves_until_its_undo() {
        let base = scratch("favourites");
        let app = app_dir(&base);
        let library = base.join("Pictures");
        std::fs::create_dir_all(library.join("Trips/Lisbon")).unwrap();
        std::fs::create_dir_all(library.join("Trips/Cairo")).unwrap();
        std::fs::write(library.join("Trips/Cairo/pyramid.jpg"), "p").unwrap();
        let conn = conn();
        register(&conn, &library, &app).unwrap();
        walk::reconcile(&conn).unwrap();
        let [summary] = source_summaries(&conn).unwrap().try_into().unwrap();
        let trips = folders::child_id(&conn, summary.root_folder_id, "Trips")
            .unwrap()
            .unwrap();
        let cairo = folders::child_id(&conn, trips, "Cairo").unwrap().unwrap();
        let lisbon = folders::child_id(&conn, trips, "Lisbon").unwrap().unwrap();
        folders::set_favorite(&conn, lisbon, true).unwrap();
        folders::set_favorite(&conn, cairo, true).unwrap();
        folders::set_favorite(&conn, summary.root_folder_id, true).unwrap();

        let titles = |places: &[FavouritePlace]| -> Vec<String> {
            places
                .iter()
                .map(|place| place.path.last().unwrap().title.clone())
                .collect()
        };
        let listed = favourites(&conn).unwrap();
        assert_eq!(titles(&listed), ["Cairo", "Lisbon", "Pictures"]);
        assert_eq!(listed[0].item_count, 1);
        assert!(listed[0].reachable);
        let [source] = source_summaries(&conn).unwrap().try_into().unwrap();
        assert!(source.favorite);
        assert!(folders::children(&conn, trips).unwrap()[0].favorite);

        let batch = journal::new_batch();
        fs_folders::delete(&conn, lisbon, None, &batch).unwrap();
        assert_eq!(titles(&favourites(&conn).unwrap()), ["Cairo", "Pictures"]);
        undo::undo_batch(&conn, &batch).unwrap();
        assert_eq!(
            titles(&favourites(&conn).unwrap()),
            ["Cairo", "Lisbon", "Pictures"]
        );
    }

    #[test]
    fn a_selection_copies_as_every_file_in_its_order_and_a_gone_one_stops_it() {
        let base = scratch("copy-items");
        let app = app_dir(&base);
        let library = base.join("Pictures");
        std::fs::create_dir_all(library.join("Cairo")).unwrap();
        std::fs::write(library.join("Cairo/a.jpg"), "a").unwrap();
        std::fs::write(library.join("Cairo/b.jpg"), "b").unwrap();
        let conn = conn();
        register(&conn, &library, &app).unwrap();
        walk::reconcile(&conn).unwrap();
        let [summary] = source_summaries(&conn).unwrap().try_into().unwrap();
        let cairo = folders::child_id(&conn, summary.root_folder_id, "Cairo")
            .unwrap()
            .unwrap();
        let [a, b] = items::in_folder(&conn, cairo)
            .unwrap()
            .try_into()
            .unwrap_or_else(|_| panic!("two files in Cairo"));

        let paths = item_abs_paths(&conn, &[b.id, a.id]).unwrap();
        let names: Vec<_> = paths.iter().map(|path| path.file_name().unwrap()).collect();
        assert_eq!(names, ["b.jpg", "a.jpg"]);
        assert!(paths.iter().all(|path| path.starts_with(&library)));
        assert!(item_abs_paths(&conn, &[a.id, 999]).is_err());
    }

    #[test]
    fn an_unplugged_source_is_listed_as_unreachable_not_empty() {
        let base = scratch("unplugged");
        let app = app_dir(&base);
        let drive = base.join("drive");
        std::fs::create_dir_all(&drive).unwrap();
        std::fs::write(drive.join("a.jpg"), "a").unwrap();
        let conn = conn();
        register(&conn, &drive, &app).unwrap();
        walk::reconcile(&conn).unwrap();

        std::fs::remove_dir_all(&drive).unwrap();
        walk::reconcile(&conn).unwrap();

        let [summary] = source_summaries(&conn).unwrap().try_into().unwrap();
        assert!(!summary.reachable);
        assert_eq!(summary.item_count, 1, "what it held is still indexed");
    }

    #[test]
    fn a_row_carries_its_thumbnail_only_once_one_has_been_made() {
        let thumbs = scratch("thumbnails").join("thumbs");
        let row = |uuid: &str| ItemRow {
            id: 1,
            uuid: uuid.into(),
            folder_id: 1,
            disk_name: "a.jpg".into(),
            ext: "jpg".into(),
            kind: "image".into(),
            size_bytes: 1,
            mtime: 0,
            width: None,
            height: None,
            duration_ms: None,
            favorite: false,
            thumb: None,
        };
        let made = thumbs.join(paths::thumb_rel("abcdef12"));
        std::fs::create_dir_all(made.parent().unwrap()).unwrap();
        std::fs::write(&made, "webp").unwrap();

        let rows = with_thumbnails(vec![row("abcdef12"), row("99887766")], &thumbs);
        assert_eq!(
            rows[0].thumb.as_deref(),
            Some(made.to_string_lossy().as_ref())
        );
        assert_eq!(rows[1].thumb, None);
    }

    #[test]
    fn an_items_detail_names_its_file_and_every_folder_down_to_it() {
        let base = scratch("detail");
        let app = app_dir(&base);
        let library = base.join("library");
        std::fs::create_dir_all(library.join("Trips/Cairo")).unwrap();
        std::fs::write(library.join("Trips/Cairo/pyramid.jpg"), "abc").unwrap();
        let conn = conn();
        let root = library.to_str().unwrap();
        register_source(&conn, root, SourceKind::Library, Some("Pictures"), &app).unwrap();
        walk::reconcile(&conn).unwrap();
        let id: i64 = conn
            .query_row("SELECT id FROM item", [], |r| r.get(0))
            .unwrap();
        let thumbs = base.join("thumbs");

        let detail = detail_of(&conn, id, &thumbs).unwrap().unwrap();
        assert_eq!(
            PathBuf::from(&detail.path),
            library.join("Trips").join("Cairo").join("pyramid.jpg")
        );
        let titles: Vec<_> = detail.folders.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(
            titles,
            ["Pictures", "Trips", "Cairo"],
            "the source by its title, then each folder"
        );
        assert_eq!(
            detail.folders.last().map(|c| c.id),
            Some(detail.row.folder_id)
        );
        assert_eq!(detail.source_kind, SourceKind::Library);

        items::retire(&conn, id).unwrap();
        assert_eq!(
            detail_of(&conn, id, &thumbs).unwrap(),
            None,
            "a trashed item is gone"
        );
    }

    /// Tauri finds a command by name and an argument by its camelCase key, and
    /// nothing checks either until a call fails at runtime.
    #[test]
    fn every_command_is_registered_and_wrapped_with_matching_arguments() {
        let declared = declared_commands(include_str!("commands.rs"));
        let registered = registered_commands(include_str!("lib.rs"));
        let invoked = invocations(include_str!("../../src/ipc/commands.ts"));

        let names: BTreeSet<String> = declared.iter().map(|(name, _)| name.clone()).collect();
        let invoked_names: BTreeSet<String> =
            invoked.iter().map(|(name, _)| name.clone()).collect();
        assert_eq!(
            registered, names,
            "lib.rs registers every command, and nothing else"
        );
        assert_eq!(
            invoked_names, names,
            "src/ipc/commands.ts wraps every command, and nothing else"
        );

        for (name, args) in &declared {
            let (_, payload) = invoked.iter().find(|(invoked, _)| invoked == name).unwrap();
            for key in args.iter().map(|arg| camel(arg)) {
                let sent = payload
                    .split(|c: char| !c.is_alphanumeric())
                    .any(|word| word == key);
                assert!(sent, "{name} is invoked without `{key}`");
            }
        }
    }

    /// Each command's name and its arguments, `state` aside.
    fn declared_commands(source: &str) -> Vec<(String, Vec<String>)> {
        let marker = concat!("#[tauri", "::command]");
        source
            .split(marker)
            .skip(1)
            .map(|chunk| {
                let (name, rest) = chunk.split_once("fn ").unwrap().1.split_once('(').unwrap();
                let params = rest.split_once(')').unwrap().0;
                let args = params
                    .split(',')
                    .filter_map(|param| param.split_once(':'))
                    .map(|(arg, _)| arg.trim().to_string())
                    .filter(|arg| arg != "state" && arg != "app")
                    .collect();
                (name.trim().to_string(), args)
            })
            .collect()
    }

    fn registered_commands(lib: &str) -> BTreeSet<String> {
        let list = lib.split_once("generate_handler![").unwrap().1;
        list.split_once(']')
            .unwrap()
            .0
            .split(',')
            .map(|name| name.trim().trim_start_matches("commands::").to_string())
            .filter(|name| !name.is_empty())
            .collect()
    }

    /// Each `invoke<T>("name", …)` line, as the name and the rest of its line.
    fn invocations(wrappers: &str) -> Vec<(String, String)> {
        wrappers
            .lines()
            .filter_map(|line| {
                let call = line.split_once("invoke<")?.1.split_once("(\"")?.1;
                let (name, rest) = call.split_once('"')?;
                Some((name.to_string(), rest.to_string()))
            })
            .collect()
    }

    fn camel(snake: &str) -> String {
        let mut out = String::new();
        let mut upper = false;
        for c in snake.chars() {
            match c {
                '_' => upper = true,
                c if upper => {
                    out.extend(c.to_uppercase());
                    upper = false;
                }
                c => out.push(c),
            }
        }
        out
    }
}
