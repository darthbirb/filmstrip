//! The desktop shell: one window, drawn without native chrome.

pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod fs;
pub mod jobs;
pub mod media;
pub mod query;

use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// Tauri's defaults, which `additional_browser_args` replaces rather than extends.
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Where Playwright attaches to the real window. DEVELOPMENT.md "Seeing the app".
#[cfg(debug_assertions)]
const DEBUG_PORT: u16 = 9322;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            fs::paths::ensure_app_dirs()?;
            let db_path = fs::paths::db_path()?;
            let thumbs = fs::paths::thumbs_dir()?;
            let mut conn = db::open(&db_path)?;
            db::migrate(&mut conn)?;
            jobs::abandon_exports(&conn)?;
            db::jobs::requeue_running(&conn)?;
            jobs::enqueue_index(&conn)?;
            let put = fs::recycle::sweep(&fs::paths::trash_dir()?);
            if put > 0 {
                eprintln!("trash: {put} held files put back");
            }

            // The window may load files from the sources, the thumbnail cache and the trash, where
            // a file waits to be restored; and nothing else.
            let scope = app.asset_protocol_scope();
            scope.allow_directory(&thumbs, true)?;
            scope.allow_directory(fs::paths::trash_dir()?, true)?;
            for source in db::sources::list(&conn)? {
                scope.allow_directory(&source.root, true)?;
            }

            // Looked for once, at launch. DECISIONS.md "Video and ffmpeg".
            let ffmpeg = media::ffmpeg::Ffmpeg::discover(&config::app_dir()?.join("tools"));
            match &ffmpeg {
                Some(found) => eprintln!("ffmpeg: {}", found.location().display()),
                None => eprintln!("ffmpeg: not found, so videos wait"),
            }

            let handle = app.handle().clone();
            let announcer = app.handle().clone();
            let exporter = app.handle().clone();
            let queue = jobs::JobQueue::start(
                db_path.clone(),
                thumbs.clone(),
                ffmpeg,
                Box::new(move |progress| {
                    let _ = handle.emit(jobs::PROGRESS_EVENT, progress);
                }),
                Box::new(move |copied| {
                    let _ = announcer.emit(jobs::COPIED_EVENT, copied);
                }),
                Box::new(move |exported| {
                    let _ = exporter.emit(jobs::EXPORTED_EVENT, exported);
                }),
            );
            let backups = fs::backups::Shelf::new(fs::paths::backups_dir()?);
            back_up_at_launch(app.handle().clone(), &backups, db_path.clone());
            app.manage(commands::AppState {
                db: db_path,
                thumbs,
                queue: std::sync::Arc::new(queue),
                backups,
            });

            // Beside the executable, never in the user's profile.
            // DECISIONS.md "Nothing outside the app folder".
            let webview_dir = config::app_data_dir()?.join("webview");

            #[cfg(debug_assertions)]
            let args = format!("{WEBVIEW_ARGS} --remote-debugging-port={DEBUG_PORT}");
            #[cfg(not(debug_assertions))]
            let args = WEBVIEW_ARGS.to_owned();

            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Filmstrip")
                .inner_size(1280.0, 820.0)
                .min_inner_size(640.0, 480.0)
                .decorations(false)
                .shadow(true)
                .data_directory(webview_dir)
                .additional_browser_args(&args)
                .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sources,
            commands::add_source,
            commands::pick_folder,
            commands::rename_source,
            commands::set_source_kind,
            commands::reveal_source,
            commands::reveal_folder,
            commands::reveal_held,
            commands::read_folder_again,
            commands::create_folder,
            commands::rename_folder,
            commands::move_folder,
            commands::move_items,
            commands::rename_item,
            commands::trash_items,
            commands::folder_file_count,
            commands::delete_folder,
            commands::undo_last,
            commands::undo_batch,
            commands::clipboard_files,
            commands::count_carried,
            commands::paste_files,
            commands::drop_files,
            commands::cancel_copy,
            commands::export_plan,
            commands::pick_export_zip,
            commands::start_export,
            commands::cancel_export,
            commands::reveal_path,
            commands::remove_source,
            commands::folder_children,
            commands::list_folders,
            commands::folder_items,
            commands::folder_item_ids,
            commands::folder_branch_files,
            commands::sorting_items,
            commands::trash_listing,
            commands::library_totals,
            commands::read_query,
            commands::search,
            commands::search_suggestions,
            commands::restore_items,
            commands::set_folder_favorite,
            commands::folder_detail,
            commands::set_folder_status,
            commands::set_folder_note,
            commands::folder_cover_choices,
            commands::set_folder_cover,
            commands::tag_offers,
            commands::add_folder_tag,
            commands::remove_folder_tag,
            commands::label_key_offers,
            commands::label_value_offers,
            commands::set_folder_label,
            commands::favourite_places,
            commands::destination_keys,
            commands::set_destination_key,
            commands::remove_destination_key,
            commands::item_tags,
            commands::add_item_tag,
            commands::remove_item_tag,
            commands::selection_tag_coverage,
            commands::add_items_tag,
            commands::remove_items_tag,
            commands::list_tags,
            commands::rename_tag,
            commands::merge_tags,
            commands::delete_tag,
            commands::label_key_clashes,
            commands::rename_label_key,
            commands::merge_label_keys,
            commands::delete_label_key,
            commands::rename_label_value,
            commands::merge_label_values,
            commands::delete_label_value,
            commands::item_detail,
            commands::item_path,
            commands::set_item_favorite,
            commands::reveal_item,
            commands::open_item,
            commands::copy_items,
            commands::copy_item_paths,
            commands::start_index,
            commands::index_progress,
            commands::index_failures,
            commands::retry_failed_jobs,
            commands::list_backups,
            commands::back_up_now,
            commands::restore_backup,
            commands::restore_forgets,
            commands::set_backups_kept,
            commands::launch_backup_refusal,
            commands::ui_preferences,
            commands::set_ui_preferences,
        ])
        .build(tauri::generate_context!())
        .expect("Filmstrip failed to start");

    app.run(|app, event| {
        if let RunEvent::Exit = event
            && let Some(state) = app.try_state::<commands::AppState>()
        {
            state.queue.stop();
        }
    });
}

/// Once the library has opened, a backup when the newest is over a day old, off the window's
/// thread. A refusal is said at the foot of navigation, and the app opens as ever.
fn back_up_at_launch(
    app: tauri::AppHandle,
    shelf: &fs::backups::Shelf,
    db_path: std::path::PathBuf,
) {
    let dir = shelf.dir.clone();
    let writing = shelf.writing();
    let taking = shelf.taking();
    let launched = shelf.launched();
    std::thread::spawn(move || {
        let taken = (|| -> error::Result<()> {
            fs::backups::clear_parts(&dir)?;
            if !fs::backups::due(&dir)? {
                return Ok(());
            }
            let _writing = writing
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let _taking = fs::backups::Taking::new(taking);
            let conn = db::open(&db_path)?;
            let keep = config::Config::load().backups_kept();
            fs::backups::back_up(&conn, &dir, fs::backups::Taken::Launch, keep)?;
            Ok(())
        })();
        launched(taken.err().as_ref().map(error::Reason::of));
        let _ = app.emit(commands::BACKUPS_CHANGED_EVENT, ());
    });
}

#[cfg(test)]
mod tests {
    fn minor(version: &str) -> &str {
        let end = version
            .match_indices('.')
            .nth(1)
            .map_or(version.len(), |(at, _)| at);
        &version[..end]
    }

    #[test]
    fn the_tauri_crate_and_its_npm_packages_share_a_minor_release() {
        let package: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        for name in ["@tauri-apps/api", "@tauri-apps/cli"] {
            let npm = package["devDependencies"][name]
                .as_str()
                .or_else(|| package["dependencies"][name].as_str())
                .unwrap_or_else(|| panic!("package.json names {name}"));
            assert_eq!(
                minor(npm),
                minor(tauri::VERSION),
                "{name} {npm} against the tauri crate {}; tauri build refuses a mismatch",
                tauri::VERSION
            );
        }
    }
}
