use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub type Result<T> = std::result::Result<T, AppError>;

/// Serialises as `{ kind, reason }`: the frontend branches on `kind` and words `reason` itself. What
/// the error said goes to the log, never to the interface. DECISIONS.md "Reasons, never raw errors".
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Invalid(String),

    #[error("{0}")]
    Media(String),

    /// A file or folder a verb would not touch, and why, in terms the interface words itself.
    #[error("{0}")]
    Refused(Reason),
}

/// Why one file or folder stayed where it was, or why anything failed. The interface writes each in
/// its own words; the sentence here is for logs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Reason {
    /// Something already has its name where it was going.
    NameTaken {
        place: String,
        name: String,
        folder: bool,
    },
    /// The folder it was going back to is no longer there.
    FolderGone {
        name: String,
    },
    /// Another program has it open.
    InUse,
    PermissionDenied,
    /// The index had it where the disk did not.
    NotOnDisk {
        name: String,
    },
    /// A file the app does not show keeps a folder from going.
    Holds {
        name: String,
        more: u32,
    },
    /// A file brought in where it already is: a copy could only clash with itself.
    AlreadyIn {
        place: String,
    },
    /// Its source's drive is away, so it was never read.
    Offline {
        source: String,
    },
    /// Its source was removed from the library, so the index no longer knows it.
    SourceRemoved {
        source: String,
    },
    DiskFull,
    /// Emptied from the Recycle Bin outside the app, so there is nothing left to bring back to the
    /// folder it was going to.
    GoneFromBin {
        name: String,
        place: String,
    },
    /// The Recycle Bin would not take it, so it is where it was.
    BinRefused,
    /// Its drive has no Recycle Bin, so it was never sent, and goes only when deleted for good.
    NoBin {
        drive: String,
    },
    /// Its path is longer than the shell takes, so it was never sent to the Recycle Bin.
    PathTooLong,
    /// Its drive could not give it the second name a send holds it by, so it was never sent.
    NoHardLinks {
        drive: String,
    },
    /// Other work held the index for longer than anything waits on it.
    Busy,
    /// The index no longer has it: a walk or another act took it out meanwhile.
    NotIndexed,
    /// Its file is in a format the app does not read.
    Unsupported,
    /// Its file could not be decoded, or its decoder stopped on it.
    Unreadable,
    /// A video waits on ffmpeg, which was not found.
    NoFfmpeg,
    /// A name typed with a character Windows refuses in a name.
    ForbiddenCharacter {
        character: String,
    },
    /// Two names Windows takes for one, side by side in one folder of an index written before the
    /// app compared names as NTFS does, so a migration could not bring the index up to date.
    NameClash {
        path: Vec<String>,
        first: String,
        second: String,
    },
    /// Anything else. What it said went to the log; the interface says one fixed thing.
    Other,
}

impl fmt::Display for Reason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Reason::NameTaken {
                place,
                name,
                folder,
            } => {
                let what = if *folder { "folder" } else { "file" };
                write!(f, "{place} already has a {what} named {name}")
            }
            Reason::FolderGone { name } => write!(f, "{name} is gone"),
            Reason::InUse => f.write_str("another app has it open"),
            Reason::PermissionDenied => f.write_str("permission denied"),
            Reason::NotOnDisk { name } => write!(f, "{name} is no longer on disk"),
            Reason::Holds { name, more: 0 } => write!(f, "it holds {name}"),
            Reason::Holds { name, more } => write!(f, "it holds {name} and {more} more"),
            Reason::AlreadyIn { place } => write!(f, "it is already in {place}"),
            Reason::Offline { source } => write!(f, "{source} is offline"),
            Reason::SourceRemoved { source } => write!(f, "{source} was removed"),
            Reason::DiskFull => f.write_str("the disk is full"),
            Reason::GoneFromBin { name, .. } => write!(f, "{name} is no longer in the Recycle Bin"),
            Reason::BinRefused => f.write_str("the Recycle Bin would not take it"),
            Reason::NoBin { drive } => write!(f, "{drive} has no Recycle Bin"),
            Reason::PathTooLong => f.write_str("its path is too long for the Recycle Bin"),
            Reason::NoHardLinks { drive } => write!(f, "{drive} cannot give it a hard link"),
            Reason::Busy => f.write_str("the index is busy"),
            Reason::NotIndexed => f.write_str("it is no longer in the index"),
            Reason::Unsupported => f.write_str("its format is not one the app reads"),
            Reason::Unreadable => f.write_str("its file could not be read"),
            Reason::NoFfmpeg => f.write_str("ffmpeg was not found"),
            Reason::ForbiddenCharacter { character } => {
                write!(f, "a name cannot contain {character:?}")
            }
            Reason::NameClash {
                path,
                first,
                second,
            } => write!(
                f,
                "{first} and {second} are one name in {}",
                path.join(" › ")
            ),
            Reason::Other => f.write_str("something went wrong"),
        }
    }
}

impl Reason {
    /// Why an error kept something where it was: its own reason, or what the disk, the index or
    /// the decoder said, worded. What the error itself said goes to the log.
    pub fn of(err: &AppError) -> Reason {
        let reason = match err {
            AppError::Refused(reason) => return reason.clone(),
            AppError::Io(io) => Reason::of_io(io),
            AppError::Db(db) => Reason::of_db(db),
            AppError::Media(_) => Reason::Unreadable,
            AppError::Json(_) | AppError::Invalid(_) => Reason::Other,
        };
        eprintln!("{err} (said as: {reason})");
        reason
    }

    pub fn of_io(err: &std::io::Error) -> Reason {
        // Windows' sharing and lock violations: another program holds the file open.
        match err.raw_os_error() {
            Some(32 | 33) => Reason::InUse,
            // ERROR_HANDLE_DISK_FULL and ERROR_DISK_FULL.
            Some(39 | 112) => Reason::DiskFull,
            _ if err.kind() == std::io::ErrorKind::StorageFull => Reason::DiskFull,
            _ if err.kind() == std::io::ErrorKind::PermissionDenied => Reason::PermissionDenied,
            _ => Reason::Other,
        }
    }

    fn of_db(err: &rusqlite::Error) -> Reason {
        use rusqlite::ErrorCode;
        match err.sqlite_error_code() {
            Some(ErrorCode::DiskFull) => Reason::DiskFull,
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked) => Reason::Busy,
            Some(ErrorCode::PermissionDenied) => Reason::PermissionDenied,
            _ => Reason::Other,
        }
    }
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Io(_) => "io",
            AppError::Db(_) => "db",
            AppError::Json(_) => "json",
            AppError::Invalid(_) => "invalid",
            AppError::Media(_) => "media",
            AppError::Refused(_) => "refused",
        }
    }

    pub fn invalid(message: impl fmt::Display) -> Self {
        AppError::Invalid(message.to_string())
    }

    pub fn refused(reason: Reason) -> Self {
        AppError::Refused(reason)
    }
}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("reason", &Reason::of(self))?;
        st.end()
    }
}

impl From<image::ImageError> for AppError {
    fn from(e: image::ImageError) -> Self {
        match e {
            image::ImageError::Unsupported(_) => AppError::refused(Reason::Unsupported),
            other => AppError::Media(other.to_string()),
        }
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        match e {
            zip::result::ZipError::Io(io) => AppError::Io(io),
            other => AppError::Invalid(other.to_string()),
        }
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Invalid(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_refusal_carries_its_reason_so_the_interface_can_word_it() {
        let taken = AppError::refused(Reason::NameTaken {
            place: "Trips".into(),
            name: "Cairo".into(),
            folder: true,
        });
        assert_eq!(
            serde_json::to_value(&taken).unwrap(),
            json!({
                "kind": "refused",
                "reason": { "kind": "nameTaken", "place": "Trips", "name": "Cairo", "folder": true }
            })
        );
    }

    #[test]
    fn every_error_reaches_the_interface_as_a_reason_and_never_in_its_own_words() {
        let errors = [
            AppError::invalid("journal row 12 does not read: expected value"),
            AppError::Io(std::io::Error::from_raw_os_error(5)),
            AppError::Db(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
                Some("database is locked".into()),
            )),
            AppError::Media("ffmpeg failed: moov atom not found".into()),
        ];
        for err in errors {
            let sent = serde_json::to_string(&err).unwrap();
            assert!(!sent.contains(&err.to_string()), "{sent}");
            assert!(sent.contains("\"reason\""), "{sent}");
        }
        assert_eq!(
            serde_json::to_value(AppError::invalid("no")).unwrap(),
            json!({ "kind": "invalid", "reason": { "kind": "other" } })
        );
    }

    fn sqlite(code: std::ffi::c_int) -> AppError {
        AppError::Db(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(code),
            None,
        ))
    }

    #[test]
    fn the_index_s_own_failures_map_to_reasons() {
        for code in [rusqlite::ffi::SQLITE_BUSY, rusqlite::ffi::SQLITE_LOCKED] {
            assert_eq!(Reason::of(&sqlite(code)), Reason::Busy, "code {code}");
        }
        assert_eq!(
            Reason::of(&sqlite(rusqlite::ffi::SQLITE_PERM)),
            Reason::PermissionDenied
        );
        assert_eq!(
            Reason::of(&sqlite(rusqlite::ffi::SQLITE_CORRUPT)),
            Reason::Other
        );
        assert_eq!(
            Reason::of(&AppError::Db(rusqlite::Error::QueryReturnedNoRows)),
            Reason::Other
        );
    }

    #[test]
    fn the_disk_s_failures_map_to_reasons() {
        let io = |code| AppError::Io(std::io::Error::from_raw_os_error(code));
        assert_eq!(
            Reason::of(&io(5)),
            Reason::PermissionDenied,
            "access denied"
        );
        assert_eq!(Reason::of(&io(32)), Reason::InUse, "sharing violation");
        assert_eq!(Reason::of(&io(33)), Reason::InUse, "lock violation");
        let denied = AppError::Io(std::io::ErrorKind::PermissionDenied.into());
        assert_eq!(Reason::of(&denied), Reason::PermissionDenied);
        let odd = AppError::Io(std::io::ErrorKind::InvalidData.into());
        assert_eq!(Reason::of(&odd), Reason::Other);
    }

    #[test]
    fn a_decoder_s_failures_map_to_reasons() {
        let unsupported: AppError =
            image::ImageError::Unsupported(image::error::UnsupportedError::from_format_and_kind(
                image::error::ImageFormatHint::Unknown,
                image::error::UnsupportedErrorKind::Format(image::error::ImageFormatHint::Unknown),
            ))
            .into();
        assert_eq!(Reason::of(&unsupported), Reason::Unsupported);
        let damaged: AppError = image::ImageError::Decoding(
            image::error::DecodingError::from_format_hint(image::error::ImageFormatHint::Unknown),
        )
        .into();
        assert_eq!(Reason::of(&damaged), Reason::Unreadable);
        let ffmpeg = AppError::Media("ffmpeg failed: moov atom not found".into());
        assert_eq!(Reason::of(&ffmpeg), Reason::Unreadable);
        assert_eq!(
            Reason::of(&AppError::refused(Reason::NoFfmpeg)),
            Reason::NoFfmpeg
        );
    }

    #[test]
    fn a_reason_kept_in_the_job_table_reads_back() {
        for reason in [
            Reason::Busy,
            Reason::Other,
            Reason::NoBin { drive: "E:".into() },
        ] {
            let kept = serde_json::to_string(&reason).unwrap();
            assert_eq!(serde_json::from_str::<Reason>(&kept).unwrap(), reason);
        }
    }

    #[test]
    fn a_disk_with_no_room_left_says_it_is_full() {
        for code in [39, 112] {
            let full = AppError::Io(std::io::Error::from_raw_os_error(code));
            assert_eq!(Reason::of(&full), Reason::DiskFull, "os error {code}");
        }
        let full = AppError::Io(std::io::ErrorKind::StorageFull.into());
        assert_eq!(Reason::of(&full), Reason::DiskFull);
        let full = AppError::Db(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL),
            None,
        ));
        assert_eq!(
            Reason::of(&full),
            Reason::DiskFull,
            "SQLite's own word for it"
        );
    }
}
