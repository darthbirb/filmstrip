//! `filmstrip.config.json`, beside the executable and nowhere else.
//!
//! Sources live in the database. This file holds only what has no other home:
//! where the window was, and the interface's own preferences.
//! DECISIONS.md "Nothing outside the app folder".

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};

const CONFIG_NAME: &str = "filmstrip.config.json";

/// The app-owned directory beside the executable: the database, the cache, the
/// trash, WebView2's profile.
pub const APP_DATA_DIR: &str = "data";

/// Directory the running executable sits in. In development that is
/// `src-tauri/target/debug`, which is correct — what the app writes belongs
/// beside whichever binary is running.
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
    /// Panel widths, folded states, tile size — whatever the interface keeps
    /// between sessions. Deliberately opaque: the shape belongs to the
    /// frontend, and nothing in Rust reads inside it, so nothing in Rust
    /// changes when it grows.
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
    /// A missing or unreadable file is not an error: it means the defaults.
    pub fn load() -> Config {
        let Ok(path) = config_path() else {
            return Config::default();
        };
        let Ok(text) = std::fs::read_to_string(path) else {
            return Config::default();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }

    pub fn save(&self) -> Result<()> {
        std::fs::create_dir_all(app_dir()?)?;
        std::fs::write(config_path()?, serde_json::to_string_pretty(self)?)?;
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
