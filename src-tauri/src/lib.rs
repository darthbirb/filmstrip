//! The desktop shell: one window, drawn without native chrome.

use std::path::PathBuf;

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Tauri's defaults, which `additional_browser_args` replaces rather than extends.
const WEBVIEW_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

/// Where Playwright attaches to the real window. DEVELOPMENT.md "Seeing the app".
#[cfg(debug_assertions)]
const DEBUG_PORT: u16 = 9322;

/// Everything the app writes lives beside its executable. DECISIONS.md "Nothing outside the app folder".
fn app_dir() -> PathBuf {
    let exe = std::env::current_exe().expect("the executable's own path is readable");
    exe.parent().expect("the executable sits in a directory").to_path_buf()
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
                .data_directory(app_dir().join("data").join("webview"))
                .additional_browser_args(&args)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Filmstrip failed to start");
}
