//! The command boundary: each command opens a connection on a blocking thread,
//! calls a plain function, and returns. DEVELOPMENT.md "The command boundary".

use std::path::{Component, Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use crate::db::folders::{self, FolderNode};
use crate::db::items::{self, ItemRow};
use crate::db::sources::{self, Source, SourceKind};
use crate::db::tags::{self, EffectiveTag};
use crate::error::{AppError, Result};
use crate::fs::paths;
use crate::fs::walk::{self, WalkReport};

pub struct AppState {
    pub db: PathBuf,
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

#[tauri::command]
pub async fn add_source(
    state: State<'_, AppState>,
    root: String,
    kind: SourceKind,
    title: Option<String>,
) -> Result<Source> {
    let app_dir = crate::config::app_dir()?;
    run(&state, move |conn| {
        in_transaction(conn, |tx| {
            register_source(tx, &root, kind, title.as_deref(), &app_dir)
        })
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

#[tauri::command]
pub async fn folder_items(state: State<'_, AppState>, folder_id: i64) -> Result<Vec<ItemRow>> {
    run(&state, move |conn| items::in_folder(conn, folder_id)).await
}

#[tauri::command]
pub async fn item_tags(state: State<'_, AppState>, item_id: i64) -> Result<Vec<EffectiveTag>> {
    run(&state, move |conn| tags::item_effective_tags(conn, item_id)).await
}

#[tauri::command]
pub async fn reconcile(state: State<'_, AppState>) -> Result<WalkReport> {
    run(&state, walk::reconcile).await
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
) -> Result<Source> {
    let root = checked_root(conn, raw_root, app_dir)?;
    let title = match title.map(str::trim) {
        Some(title) if !title.is_empty() => title.to_string(),
        _ => root.file_name().map_or_else(
            || root.display().to_string(),
            |name| name.to_string_lossy().into_owned(),
        ),
    };
    sources::add(conn, &root, &title, kind)
}

/// An existing absolute directory, clear of every registered source and of the
/// app's own folder. Reads the disk; never writes to it.
fn checked_root(conn: &Connection, raw: &str, app_dir: &Path) -> Result<PathBuf> {
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
        return Err(AppError::invalid(
            "a source may not sit inside the app folder",
        ));
    }
    if let Some(clash) = sources::nesting_conflict(&sources::list(conn)?, &root) {
        return Err(AppError::invalid(format!(
            "{} overlaps the source {}",
            root.display(),
            clash.title
        )));
    }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
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

    fn register(conn: &Connection, dir: &Path, app: &Path) -> Result<Source> {
        register_source(conn, dir.to_str().unwrap(), SourceKind::Library, None, app)
    }

    #[test]
    fn a_source_is_titled_after_its_folder_unless_named() {
        let base = scratch("titled");
        let app = app_dir(&base);
        std::fs::create_dir_all(base.join("Holiday Pics")).unwrap();
        std::fs::create_dir_all(base.join("dump")).unwrap();
        let conn = conn();

        let plain = register(&conn, &base.join("Holiday Pics"), &app).unwrap();
        let dump = format!("{}/", base.join("dump").display());
        let named =
            register_source(&conn, &dump, SourceKind::Sorting, Some("  Incoming "), &app).unwrap();

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

        for dir in [
            library.join("inner"),
            library.clone(),
            app.join("data"),
            app.clone(),
        ] {
            let outcome = register(&conn, &dir, &app);
            assert!(outcome.is_err(), "{} should be refused", dir.display());
        }
        assert_eq!(sources::list(&conn).unwrap().len(), 1);
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
                    .filter(|arg| arg != "state")
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
