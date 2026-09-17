//! The command boundary: each command opens a connection on a blocking thread,
//! calls a plain function, and returns. DEVELOPMENT.md "The command boundary".

use std::path::{Component, Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use ts_rs::TS;

use crate::db::folders::{self, FolderNode};
use crate::db::items::{self, ItemDetail, ItemRow};
use crate::db::jobs::{self as job_table, Failure};
use crate::db::sources::{self, Refusal, Source, SourceKind};
use crate::db::tags::{self, EffectiveTag};
use crate::error::{AppError, Result};
use crate::fs::paths;
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

#[tauri::command]
pub async fn copy_item_file(state: State<'_, AppState>, item_id: i64) -> Result<()> {
    run(&state, move |conn| {
        crate::fs::clipboard::copy_file(&item_abs_path(conn, item_id)?)
    })
    .await
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

/// An item in full, with the paths to its file and its thumbnail.
pub fn detail_of(conn: &Connection, item_id: i64, thumbs: &Path) -> Result<Option<ItemDetail>> {
    let Some(mut detail) = items::detail(conn, item_id)? else {
        return Ok(None);
    };
    let file = paths::item_path(conn, detail.row.folder_id, &detail.row.disk_name)?;
    detail.path = file.to_string_lossy().into_owned();
    detail.row.thumb = thumb_of(&detail.row.uuid, thumbs);
    Ok(Some(detail))
}

pub fn source_summaries(conn: &Connection) -> Result<Vec<SourceSummary>> {
    sources::list(conn)?
        .into_iter()
        .map(|source| {
            let (item_count, total_bytes) = sources::item_stats(conn, source.id)?;
            Ok(SourceSummary {
                root_folder_id: folders::source_root_folder(conn, source.id)?,
                reachable: Path::new(&source.root).is_dir(),
                item_count,
                total_bytes,
                source,
            })
        })
        .collect()
}

/// Registers a directory as a source, titled after it unless a title is given.
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
    Ok(AddOutcome::Added {
        source: sources::add(conn, &root, &title, kind)?,
    })
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

        items::trash(&conn, id).unwrap();
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
