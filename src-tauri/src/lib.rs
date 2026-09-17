//! The desktop shell: one window, drawn without native chrome.

pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod fs;
pub mod jobs;
pub mod media;

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
            db::jobs::requeue_running(&conn)?;
            jobs::enqueue_index(&conn)?;

            // The window may load files from the sources and the thumbnail cache, and nothing else.
            let scope = app.asset_protocol_scope();
            scope.allow_directory(&thumbs, true)?;
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
            let queue = jobs::JobQueue::start(
                db_path.clone(),
                thumbs.clone(),
                ffmpeg,
                Box::new(move |progress| {
                    let _ = handle.emit(jobs::PROGRESS_EVENT, progress);
                }),
            );
            app.manage(commands::AppState {
                db: db_path,
                thumbs,
                queue,
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
            commands::remove_source,
            commands::folder_children,
            commands::folder_items,
            commands::sorting_items,
            commands::item_tags,
            commands::item_detail,
            commands::set_item_favorite,
            commands::reveal_item,
            commands::open_item,
            commands::copy_item_file,
            commands::start_index,
            commands::index_progress,
            commands::index_failures,
            commands::retry_failed_jobs,
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
