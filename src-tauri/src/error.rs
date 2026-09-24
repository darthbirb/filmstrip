use std::fmt;

use serde::Serialize;
use ts_rs::TS;

pub type Result<T> = std::result::Result<T, AppError>;

/// Serialises as `{ kind, message }`, so the frontend branches on `kind`.
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

/// Why one file or folder stayed where it was. The interface writes each in its own words; the
/// sentence here is for logs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
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
    /// Anything else, in the words it came with.
    Other {
        message: String,
    },
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
            Reason::Other { message } => f.write_str(message),
        }
    }
}

impl Reason {
    /// Why an error kept something where it was: its own reason, or what the disk said.
    pub fn of(err: &AppError) -> Reason {
        match err {
            AppError::Refused(reason) => reason.clone(),
            AppError::Io(io) => Reason::of_io(io),
            other => Reason::Other {
                message: other.to_string(),
            },
        }
    }

    fn of_io(err: &std::io::Error) -> Reason {
        // Windows' sharing and lock violations: another program holds the file open.
        match err.raw_os_error() {
            Some(32 | 33) => Reason::InUse,
            _ if err.kind() == std::io::ErrorKind::PermissionDenied => Reason::PermissionDenied,
            _ => Reason::Other {
                message: err.to_string(),
            },
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
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<image::ImageError> for AppError {
    fn from(e: image::ImageError) -> Self {
        AppError::Media(e.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Invalid(e.to_string())
    }
}
