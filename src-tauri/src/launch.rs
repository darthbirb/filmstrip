//! Opening the index before the window, and what a launch that fails says before the app exits.
//! DECISIONS.md "A launch that fails says why".

use std::path::Path;

use rusqlite::Connection;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::error::{AppError, Reason};
use crate::{db, fs, jobs};

/// What failed before the window opened, and the step it failed in.
#[derive(Debug)]
pub struct Failure {
    step: Step,
    err: AppError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    Index,
    Start,
}

impl From<AppError> for Failure {
    fn from(err: AppError) -> Self {
        Failure {
            step: Step::Start,
            err,
        }
    }
}

impl From<tauri::Error> for Failure {
    fn from(err: tauri::Error) -> Self {
        AppError::from(err).into()
    }
}

/// The index at `path`, brought up to date and its interrupted work settled. A failed migration
/// leaves it as it was, so the next launch tries again.
pub fn open_index(path: &Path) -> Result<Connection, Failure> {
    let open = || -> crate::error::Result<Connection> {
        let mut conn = db::open(path)?;
        db::migrate(&mut conn)?;
        jobs::abandon_exports(&conn)?;
        db::jobs::requeue_running(&conn)?;
        jobs::enqueue_index(&conn)?;
        fs::trash::settle_unfinished_send(&conn)?;
        Ok(conn)
    };
    open().map_err(|err| Failure {
        step: Step::Index,
        err,
    })
}

const TITLE: &str = "Filmstrip Could Not Start";

/// What the message box says: what failed, then its reason's sentence, never the error's own
/// words, which go to the log.
pub fn said(failure: &Failure) -> String {
    let what = match failure.step {
        Step::Index => "Filmstrip could not open its index.",
        Step::Start => "Filmstrip could not start.",
    };
    format!("{what} {}", sentence(&Reason::of(&failure.err)))
}

/// The reasons a launch can meet, worded as `reasonSentence` words them in the interface.
fn sentence(reason: &Reason) -> String {
    match reason {
        Reason::Busy => "The index is busy. Try again in a moment.".into(),
        Reason::PermissionDenied => "Windows refused access.".into(),
        Reason::InUse => "Open in another app.".into(),
        Reason::DiskFull => "The disk is full.".into(),
        Reason::NameClash {
            path,
            first,
            second,
        } => format!("{first} and {second} are one name in {}.", path.join(" › ")),
        _ => "Something went wrong.".into(),
    }
}

/// Says why in a native message box, and exits once it is closed.
pub fn refuse(app: &AppHandle, failure: &Failure) {
    let handle = app.clone();
    app.dialog()
        .message(said(failure))
        .title(TITLE)
        .kind(MessageDialogKind::Error)
        .show(move |_| handle.exit(1));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{folders, sources};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-db/launch")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("library.db")
    }

    /// An index at schema 12, which matched names by folding ASCII only, holding a retired
    /// `Ägypten.jpg` beside a live `ägypten.jpg` in Pictures › Trips.
    fn written_before_name_fold(path: &Path) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("CREATE TABLE schema_version (version INTEGER NOT NULL);")
            .unwrap();
        for (version, sql) in db::MIGRATIONS.iter().filter(|(version, _)| *version < 13) {
            conn.execute_batch(sql).unwrap();
            conn.execute("INSERT INTO schema_version VALUES (?1)", [version])
                .unwrap();
        }
        let source = sources::add(
            &conn,
            Path::new("D:/Pictures"),
            "Pictures",
            sources::SourceKind::Library,
        )
        .unwrap();
        let root = folders::source_root_folder(&conn, source.id).unwrap();
        conn.execute(
            "INSERT INTO folder (source_id, parent_id, title, created_at) VALUES (?1, ?2, 'Trips', 0)",
            [source.id, root],
        )
        .unwrap();
        let trips = conn.last_insert_rowid();
        for (uuid, name, deleted_at) in [("a", "Ägypten.jpg", Some(5)), ("b", "ägypten.jpg", None)]
        {
            conn.execute(
                "INSERT INTO item (uuid, source_id, folder_id, disk_name, ext, size_bytes, mtime,
                                   kind, added_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, 'jpg', 9, 1, 'image', 2, ?5)",
                rusqlite::params![uuid, source.id, trips, name, deleted_at],
            )
            .unwrap();
        }
    }

    fn schema(path: &Path) -> (i64, i64) {
        let conn = Connection::open(path).unwrap();
        conn.query_row(
            "SELECT (SELECT MAX(version) FROM schema_version), (SELECT COUNT(*) FROM item)",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
    }

    #[test]
    fn an_index_holding_two_names_that_fold_together_is_said_and_left_as_it_was() {
        let path = scratch("name-clash");
        written_before_name_fold(&path);

        for _ in 0..2 {
            let failure = open_index(&path).unwrap_err();
            assert_eq!(
                Reason::of(&failure.err),
                Reason::NameClash {
                    path: vec!["Pictures".into(), "Trips".into()],
                    first: "Ägypten.jpg".into(),
                    second: "ägypten.jpg".into(),
                }
            );
            assert_eq!(
                said(&failure),
                "Filmstrip could not open its index. \
                 Ägypten.jpg and ägypten.jpg are one name in Pictures › Trips."
            );
            assert_eq!(schema(&path), (12, 2), "nothing in the index changed");
        }
    }

    #[test]
    fn a_launch_failure_is_said_in_fixed_words_never_the_error_s_own() {
        let index = |err| Failure {
            step: Step::Index,
            err,
        };
        let busy = AppError::Db(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            Some("database is locked".into()),
        ));
        assert_eq!(
            said(&index(busy)),
            "Filmstrip could not open its index. The index is busy. Try again in a moment."
        );
        let denied = AppError::Io(std::io::Error::from_raw_os_error(5));
        assert_eq!(
            said(&denied.into()),
            "Filmstrip could not start. Windows refused access."
        );
        let odd = AppError::invalid("journal row 12 does not read: expected value");
        assert_eq!(
            said(&odd.into()),
            "Filmstrip could not start. Something went wrong."
        );
    }
}
