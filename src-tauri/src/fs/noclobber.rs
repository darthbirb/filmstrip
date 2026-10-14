//! A rename that refuses a name already taken: `std::fs::rename` replaces one on Windows, and this
//! fails with `AlreadyExists` in the very call that would move, so nothing is ever overwritten.
//! DECISIONS.md "Bringing files in".

use std::io;
use std::path::Path;

/// Gives `from` the name `to` within one volume, or fails without touching either when `to` is
/// taken.
#[cfg(windows)]
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    // Verbatim, as `std::fs` passes its own paths, or a name past MAX_PATH would not move.
    let wide = |path: &Path| -> io::Result<Vec<u16>> {
        let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
            return Err(io::Error::from(io::ErrorKind::InvalidInput));
        };
        let parent = if parent.as_os_str().is_empty() {
            Path::new(".")
        } else {
            parent
        };
        Ok(std::fs::canonicalize(parent)?
            .join(name)
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect())
    };
    let (from, to) = (wide(from)?, wide(to)?);
    // SAFETY: both are NUL-terminated wide strings that outlive the call.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::hard_link(from, to)?;
    std::fs::remove_file(from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-noclobber")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_free_name_is_taken() {
        let dir = scratch("free");
        std::fs::write(dir.join("part"), "new").unwrap();
        rename(&dir.join("part"), &dir.join("IMG_1.jpg")).unwrap();
        assert!(!dir.join("part").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("IMG_1.jpg")).unwrap(),
            "new"
        );
    }

    #[test]
    fn a_name_that_appeared_just_before_the_move_is_never_overwritten() {
        let dir = scratch("taken");
        std::fs::write(dir.join("part"), "new").unwrap();
        std::fs::write(dir.join("IMG_1.jpg"), "theirs").unwrap();
        let err = rename(&dir.join("part"), &dir.join("IMG_1.jpg")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            std::fs::read_to_string(dir.join("IMG_1.jpg")).unwrap(),
            "theirs"
        );
        assert_eq!(std::fs::read_to_string(dir.join("part")).unwrap(), "new");
    }

    #[test]
    fn a_name_past_the_old_path_limit_is_given_as_any_other() {
        let mut deep = scratch("long");
        while deep.as_os_str().len() < 300 {
            deep.push("a folder named long enough to pass the limit");
        }
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::write(deep.join("part"), "new").unwrap();
        let to = deep.join("IMG_1.jpg");
        assert!(to.as_os_str().len() > 260);
        rename(&deep.join("part"), &to).unwrap();
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "new");
        assert!(!deep.join("part").exists());
    }

    #[cfg(windows)]
    #[test]
    fn a_folder_is_renamed_and_never_onto_another() {
        let dir = scratch("folders");
        std::fs::create_dir(dir.join("Cairo")).unwrap();
        std::fs::create_dir(dir.join("Giza")).unwrap();
        let err = rename(&dir.join("Cairo"), &dir.join("Giza")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        rename(&dir.join("Cairo"), &dir.join("Luxor")).unwrap();
        assert!(dir.join("Luxor").is_dir() && dir.join("Giza").is_dir());
    }
}
