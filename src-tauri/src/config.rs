//! `filmstrip.config.json`: only what has no home in the database — window
//! placement and interface preferences. DECISIONS.md "Nothing outside the app folder".

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

const CONFIG_NAME: &str = "filmstrip.config.json";

/// The app-owned directory beside the executable: the database, the cache, the
/// trash, WebView2's profile.
pub const APP_DATA_DIR: &str = "data";

/// Directory of the running executable — `src-tauri/target/debug` in development.
pub fn app_dir() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    exe.parent()
        .map(PathBuf::from)
        .ok_or_else(|| AppError::invalid("the executable has no parent directory"))
}

pub fn app_data_dir() -> Result<PathBuf> {
    Ok(app_dir()?.join(APP_DATA_DIR))
}

pub fn config_path() -> Result<PathBuf> {
    Ok(app_dir()?.join(CONFIG_NAME))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub window: Option<WindowState>,
    /// Whatever the interface keeps between sessions. Opaque on purpose: its
    /// shape belongs to the frontend, and nothing in Rust reads inside it.
    pub ui: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
}

impl Config {
    pub fn load() -> Config {
        config_path()
            .map(|path| Config::load_from(&path))
            .unwrap_or_default()
    }

    /// A missing or unreadable file is not an error: it means the defaults.
    pub fn load_from(path: &Path) -> Config {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<()> {
        self.save_to(&config_path()?)
    }

    pub fn save_to(&self, path: &Path) -> Result<()> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn set_window(state: WindowState) -> Result<()> {
        let mut config = Config::load();
        config.window = Some(state);
        config.save()
    }

    pub fn set_ui(preferences: serde_json::Value) -> Result<()> {
        let mut config = Config::load();
        config.ui = Some(preferences);
        config.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-config")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_interface_preferences_survive_a_round_trip_untouched() {
        let path = scratch("round-trip").join("filmstrip.config.json");
        let ui = serde_json::json!({ "scale": 1.25, "widths": { "nav": 18, "pane": 22 } });
        let config = Config {
            window: None,
            ui: Some(ui.clone()),
        };
        config.save_to(&path).unwrap();
        assert_eq!(Config::load_from(&path).ui, Some(ui));
    }

    #[test]
    fn a_missing_or_broken_file_means_the_defaults() {
        let dir = scratch("broken");
        assert!(Config::load_from(&dir.join("absent.json")).ui.is_none());
        std::fs::write(dir.join("broken.json"), "{ not json").unwrap();
        assert!(Config::load_from(&dir.join("broken.json")).ui.is_none());
    }
}
