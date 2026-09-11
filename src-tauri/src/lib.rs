//! The desktop shell: one window, drawn without native chrome.

pub mod config;
pub mod db;
pub mod error;
pub mod fs;

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Tauri's defaults, which `additional_browser_args` replaces rather than extends.
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Where Playwright attaches to the real window. DEVELOPMENT.md "Seeing the app".
#[cfg(debug_assertions)]
const DEBUG_PORT: u16 = 9322;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
                .zoom_hotkeys_enabled(true)
                .data_directory(webview_dir)
                .additional_browser_args(&args)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Filmstrip failed to start");
}
