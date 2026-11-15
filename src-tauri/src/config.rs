//! `filmstrip.config.json`: only what has no home in the database — window placement,
//! interface preferences, how many backups of the database are kept, and the trash's limits.
//! DECISIONS.md "Nothing outside the app folder".

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
    /// How many of the index's backups are kept. Here rather than in the index, which a restore
    /// replaces.
    pub backups_kept: Option<u32>,
    /// The trash's limits, here for the same reason.
    pub trash: Option<TrashLimits>,
}

/// The trash's three limits, each one of the answers Settings offers, `None` for No Limit. A file
/// that has none of them has the first answers. DECISIONS.md "Expiry goes to the Recycle Bin".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export)]
pub struct TrashLimits {
    pub keep_days: Option<u32>,
    pub total_gb: Option<u32>,
    pub file_gb: Option<u32>,
}

impl Default for TrashLimits {
    fn default() -> TrashLimits {
        TrashLimits {
            keep_days: Some(30),
            total_gb: Some(25),
            file_gb: Some(5),
        }
    }
}

/// One of the trash's limits, as Settings names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TrashLimit {
    KeepFor,
    TotalSize,
    SizePerFile,
}

impl TrashLimit {
    /// The answers its dropdown offers before No Limit: days, or gigabytes.
    pub fn answers(self) -> &'static [u32] {
        match self {
            TrashLimit::KeepFor => &[7, 14, 30, 90, 365],
            TrashLimit::TotalSize => &[10, 25, 50, 100, 250],
            TrashLimit::SizePerFile => &[1, 2, 5, 10, 25],
        }
    }
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

    /// The number of backups kept: one of the four Settings offers, seven until another is chosen.
    pub fn backups_kept(&self) -> u32 {
        self.backups_kept
            .filter(|kept| BACKUPS_KEPT.contains(kept))
            .unwrap_or(BACKUPS_KEPT_FIRST)
    }

    /// The trash's limits, any that is not one of its dropdown's answers taken as its first.
    pub fn trash_limits(&self) -> TrashLimits {
        let set = self.trash.unwrap_or_default();
        let first = TrashLimits::default();
        let kept = |limit: TrashLimit, value: Option<u32>, first: Option<u32>| match value {
            Some(value) if !limit.answers().contains(&value) => first,
            value => value,
        };
        TrashLimits {
            keep_days: kept(TrashLimit::KeepFor, set.keep_days, first.keep_days),
            total_gb: kept(TrashLimit::TotalSize, set.total_gb, first.total_gb),
            file_gb: kept(TrashLimit::SizePerFile, set.file_gb, first.file_gb),
        }
    }

    pub fn set_trash_limit(limit: TrashLimit, value: Option<u32>) -> Result<()> {
        if value.is_some_and(|value| !limit.answers().contains(&value)) {
            return Err(AppError::invalid(format!(
                "{value:?} is not an answer to {limit:?}"
            )));
        }
        let mut config = Config::load();
        let mut set = config.trash_limits();
        match limit {
            TrashLimit::KeepFor => set.keep_days = value,
            TrashLimit::TotalSize => set.total_gb = value,
            TrashLimit::SizePerFile => set.file_gb = value,
        }
        config.trash = Some(set);
        config.save()
    }

    pub fn set_backups_kept(kept: u32) -> Result<()> {
        if !BACKUPS_KEPT.contains(&kept) {
            return Err(AppError::invalid(format!(
                "{kept} is not a number of backups to keep"
            )));
        }
        let mut config = Config::load();
        config.backups_kept = Some(kept);
        config.save()
    }
}

/// The answers Backups to Keep offers.
pub const BACKUPS_KEPT: [u32; 4] = [3, 7, 14, 30];
pub const BACKUPS_KEPT_FIRST: u32 = 7;

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
            backups_kept: None,
            trash: None,
        };
        config.save_to(&path).unwrap();
        assert_eq!(Config::load_from(&path).ui, Some(ui));
    }

    #[test]
    fn backups_kept_are_seven_until_one_of_the_four_answers_is_chosen() {
        let path = scratch("kept").join("filmstrip.config.json");
        assert_eq!(Config::load_from(&path).backups_kept(), 7);
        std::fs::write(&path, r#"{ "backupsKept": 14 }"#).unwrap();
        assert_eq!(Config::load_from(&path).backups_kept(), 14);
        std::fs::write(&path, r#"{ "backupsKept": 5 }"#).unwrap();
        assert_eq!(
            Config::load_from(&path).backups_kept(),
            7,
            "not an answer offered"
        );
    }

    #[test]
    fn the_trash_keeps_30_days_and_25_gb_until_another_answer_or_no_limit_is_chosen() {
        let path = scratch("trash").join("filmstrip.config.json");
        let first = TrashLimits {
            keep_days: Some(30),
            total_gb: Some(25),
            file_gb: Some(5),
        };
        assert_eq!(Config::load_from(&path).trash_limits(), first);
        std::fs::write(
            &path,
            r#"{ "trash": { "keepDays": null, "totalGb": 100, "fileGb": 3 } }"#,
        )
        .unwrap();
        assert_eq!(
            Config::load_from(&path).trash_limits(),
            TrashLimits {
                keep_days: None,
                total_gb: Some(100),
                file_gb: Some(5),
            },
            "No Limit is kept, and an answer never offered is the first"
        );
        std::fs::write(&path, r#"{ "trash": { "totalGb": 10 } }"#).unwrap();
        assert_eq!(Config::load_from(&path).trash_limits().keep_days, Some(30));
    }

    #[test]
    fn a_missing_or_broken_file_means_the_defaults() {
        let dir = scratch("broken");
        assert!(Config::load_from(&dir.join("absent.json")).ui.is_none());
        std::fs::write(dir.join("broken.json"), "{ not json").unwrap();
        assert!(Config::load_from(&dir.join("broken.json")).ui.is_none());
    }
}
