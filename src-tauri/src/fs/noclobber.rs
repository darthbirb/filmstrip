//! Moves and copies that refuse a name already taken: `std::fs::rename` and `std::fs::copy`
//! replace one on Windows, and these fail with `AlreadyExists` in the very call that would write,
//! so nothing is ever overwritten. DECISIONS.md "Bringing files in".

use std::io;
use std::path::Path;

/// Gives `from` the name `to` within one volume, or fails without touching either when `to` is
/// taken.
#[cfg(windows)]
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    arriving(to);
    let (from, to) = (verbatim(from)?, verbatim(to)?);
    // SAFETY: both are NUL-terminated wide strings that outlive the call.
    if unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn rename(from: &Path, to: &Path) -> io::Result<()> {
    arriving(to);
    std::fs::hard_link(from, to)?;
    std::fs::remove_file(from)
}

/// Copies the file `from` to a new file `to`, or fails without touching `to` when it is taken.
#[cfg(windows)]
pub fn copy(from: &Path, to: &Path) -> io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::CopyFileW;

    arriving(to);
    let (from, to) = (verbatim(from)?, verbatim(to)?);
    // SAFETY: both are NUL-terminated wide strings that outlive the call.
    if unsafe { CopyFileW(from.as_ptr(), to.as_ptr(), 1) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn copy(from: &Path, to: &Path) -> io::Result<()> {
    arriving(to);
    let mut source = std::fs::File::open(from)?;
    let mut target = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)?;
    io::copy(&mut source, &mut target).map(|_| ())
}

/// Makes the directory `to`, or fails when anything is there already.
pub fn make_dir(to: &Path) -> io::Result<()> {
    arriving(to);
    std::fs::create_dir(to)
}

/// Verbatim, as `std::fs` passes its own paths, or a name past MAX_PATH would not move.
#[cfg(windows)]
fn verbatim(path: &Path) -> io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;

    let full: Vec<u16> = std::path::absolute(path)?
        .as_os_str()
        .encode_wide()
        .collect();
    let starts = |with: &str| full.starts_with(&with.encode_utf16().collect::<Vec<_>>());
    let (prefix, rest) = if starts(r"\\?\") || starts(r"\\.\") {
        ("", &full[..])
    } else if starts(r"\\") {
        (r"\\?\UNC\", &full[2..])
    } else {
        (r"\\?\", &full[..])
    };
    Ok(prefix
        .encode_utf16()
        .chain(rest.iter().copied())
        .chain(std::iter::once(0))
        .collect())
}

#[cfg(test)]
type Arrival = Box<dyn FnOnce(&Path)>;

#[cfg(test)]
thread_local! {
    static JUST_BEFORE: std::cell::RefCell<Option<Arrival>> =
        const { std::cell::RefCell::new(None) };
}

/// Runs `then` with the target of this thread's next move, copy or new directory, just before it
/// is written: where a test puts what appears at the last moment.
#[cfg(test)]
pub(crate) fn just_before_the_next(then: impl FnOnce(&Path) + 'static) {
    JUST_BEFORE.with(|hook| *hook.borrow_mut() = Some(Box::new(then)));
}

fn arriving(_to: &Path) {
    #[cfg(test)]
    if let Some(then) = JUST_BEFORE.with(|hook| hook.borrow_mut().take()) {
        then(_to);
    }
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
    fn a_copy_onto_a_name_that_appeared_just_before_it_is_refused_and_theirs_kept() {
        let dir = scratch("copy");
        std::fs::write(dir.join("IMG_1.jpg"), "ours").unwrap();
        copy(&dir.join("IMG_1.jpg"), &dir.join("IMG_2.jpg")).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("IMG_2.jpg")).unwrap(),
            "ours"
        );

        just_before_the_next(|to| std::fs::write(to, "theirs").unwrap());
        let err = copy(&dir.join("IMG_1.jpg"), &dir.join("IMG_3.jpg")).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            std::fs::read_to_string(dir.join("IMG_3.jpg")).unwrap(),
            "theirs"
        );
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

        std::fs::write(deep.join("part"), "newer").unwrap();
        let err = rename(&deep.join("part"), &to).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(&to).unwrap(), "new");
    }

    #[cfg(windows)]
    #[test]
    fn a_relative_name_is_given_where_it_is() {
        let dir = scratch("relative");
        std::fs::write(dir.join("part"), "new").unwrap();
        let here = std::env::current_dir().unwrap();
        let from = dir.strip_prefix(&here).unwrap().join("part");
        rename(&from, &from.with_file_name("IMG_1.jpg")).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("IMG_1.jpg")).unwrap(),
            "new"
        );
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
