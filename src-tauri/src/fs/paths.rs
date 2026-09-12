//! The only place database rows become paths on disk. Path handling anywhere
//! else is a bug, even where it works.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::config;
use crate::db::{folders, sources};
use crate::error::{AppError, Result};

pub fn db_path() -> Result<PathBuf> {
    Ok(config::app_data_dir()?.join("library.db"))
}

pub fn cache_dir() -> Result<PathBuf> {
    Ok(config::app_data_dir()?.join("cache"))
}

pub fn thumbs_dir() -> Result<PathBuf> {
    Ok(cache_dir()?.join("thumbs"))
}

pub fn trash_dir() -> Result<PathBuf> {
    Ok(config::app_data_dir()?.join("trash"))
}

/// Creates the app-owned tree. Touches nothing inside any source.
pub fn ensure_app_dirs() -> Result<()> {
    for dir in [
        config::app_data_dir()?,
        cache_dir()?,
        thumbs_dir()?,
        trash_dir()?,
    ] {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}

/// A folder's real directory: its source's root, then every title between that
/// root and the folder itself.
pub fn folder_dir(conn: &Connection, folder_id: i64) -> Result<PathBuf> {
    let location = folders::location(conn, folder_id)?;
    let source = sources::get(conn, location.source_id)?.ok_or_else(|| {
        AppError::invalid(format!(
            "folder {folder_id} names a source that is not registered"
        ))
    })?;
    let mut dir = PathBuf::from(source.root);
    for title in &location.titles {
        dir.push(title);
    }
    Ok(dir)
}

/// The file behind an item. Every item has a folder, so every item has a
/// directory — DECISIONS.md "Places, not queries".
pub fn item_path(conn: &Connection, folder_id: i64, disk_name: &str) -> Result<PathBuf> {
    Ok(folder_dir(conn, folder_id)?.join(disk_name))
}

/// `<uuid>` → `ab/cd/<uuid>.webp`: two levels keep any one directory to a few
/// hundred entries at a hundred thousand items.
pub fn thumb_rel(uuid: &str) -> String {
    let clean: String = uuid.chars().filter(char::is_ascii_alphanumeric).collect();
    let a = clean.get(0..2).unwrap_or("00");
    let b = clean.get(2..4).unwrap_or("00");
    format!("{a}/{b}/{uuid}.webp")
}

/// Whether two paths name one directory. Windows ignores case and takes either
/// separator, so `==` cannot answer this.
pub fn same_dir(a: &Path, b: &Path) -> bool {
    if let (Ok(a), Ok(b)) = (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        return a == b;
    }
    fn key(path: &Path) -> String {
        path.to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    }
    key(a) == key(b)
}

/// Lowercase extension without the dot.
pub fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::db::sources::SourceKind;

    fn library() -> (Connection, i64) {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let source = sources::add(
            &conn,
            Path::new("D:/library"),
            "Library",
            SourceKind::Library,
        )
        .unwrap();
        let root = folders::source_root_folder(&conn, source.id).unwrap();
        (conn, root)
    }

    #[test]
    fn a_sources_own_folder_is_its_root_with_nothing_appended() {
        let (conn, root) = library();
        assert_eq!(
            folder_dir(&conn, root).unwrap(),
            PathBuf::from("D:/library")
        );
    }

    #[test]
    fn a_nested_folder_joins_every_title_onto_the_root() {
        let (conn, root) = library();
        let people = folders::create(&conn, root, "People").unwrap();
        let ana = folders::create(&conn, people, "Ana").unwrap();

        assert_eq!(
            folder_dir(&conn, ana).unwrap(),
            PathBuf::from("D:/library/People/Ana")
        );
        assert_eq!(
            item_path(&conn, ana, "holiday.jpg").unwrap(),
            PathBuf::from("D:/library/People/Ana/holiday.jpg")
        );
    }

    #[test]
    fn a_file_in_a_sorting_source_resolves_into_that_source() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let incoming = sources::add(
            &conn,
            Path::new("D:/incoming"),
            "Incoming",
            SourceKind::Sorting,
        )
        .unwrap();
        let root = folders::source_root_folder(&conn, incoming.id).unwrap();

        assert_eq!(
            item_path(&conn, root, "DSC_0001.jpg").unwrap(),
            PathBuf::from("D:/incoming/DSC_0001.jpg")
        );
    }

    #[test]
    fn thumbnails_shard_by_the_first_four_characters() {
        assert_eq!(thumb_rel("abcdef12"), "ab/cd/abcdef12.webp");
    }

    #[test]
    fn extensions_come_back_lowercase_and_undotted() {
        assert_eq!(extension_of("Holiday.JPG"), "jpg");
        assert_eq!(extension_of("no-extension"), "");
    }
}
