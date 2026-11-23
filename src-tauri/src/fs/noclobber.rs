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

/// Copies the file `from` to a new file `to`, or fails without touching `to` when it is taken,
/// asking `stop` as each part of it is written: `Ok(false)` once it says so, and then nothing of
/// `to` is left. `to` is a copy's own part, so it runs no test's last-moment arrival.
#[cfg(windows)]
pub fn copy_unless(from: &Path, to: &Path, stop: &dyn Fn() -> bool) -> io::Result<bool> {
    use windows_sys::Win32::Foundation::{ERROR_REQUEST_ABORTED, HANDLE};
    use windows_sys::Win32::Storage::FileSystem::{
        COPY_FILE_FAIL_IF_EXISTS, CopyFileExW, PROGRESS_CANCEL, PROGRESS_CONTINUE,
    };

    unsafe extern "system" fn asked(
        _total: i64,
        _done: i64,
        _stream: i64,
        _stream_done: i64,
        _number: u32,
        _reason: u32,
        _from: HANDLE,
        _to: HANDLE,
        data: *const core::ffi::c_void,
    ) -> u32 {
        // SAFETY: `data` is the `&dyn Fn` below, alive for the whole of the call that passes it.
        let stop = unsafe { &*data.cast::<&dyn Fn() -> bool>() };
        if stop() {
            PROGRESS_CANCEL
        } else {
            PROGRESS_CONTINUE
        }
    }

    let (from, to) = (verbatim(from)?, verbatim(to)?);
    let data: *const &dyn Fn() -> bool = &stop;
    // SAFETY: both paths are NUL-terminated wide strings, and `data` points at `stop`; all three
    // outlive the call, which runs `asked` on this thread only.
    let copied = unsafe {
        CopyFileExW(
            from.as_ptr(),
            to.as_ptr(),
            Some(asked),
            data.cast(),
            std::ptr::null_mut(),
            COPY_FILE_FAIL_IF_EXISTS,
        )
    };
    if copied != 0 {
        return Ok(true);
    }
    let err = io::Error::last_os_error();
    if err.raw_os_error() == Some(ERROR_REQUEST_ABORTED as i32) {
        return Ok(false);
    }
    Err(err)
}

#[cfg(not(windows))]
pub fn copy_unless(from: &Path, to: &Path, stop: &dyn Fn() -> bool) -> io::Result<bool> {
    if stop() {
        return Ok(false);
    }
    let mut source = std::fs::File::open(from)?;
    let mut target = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)?;
    io::copy(&mut source, &mut target).map(|_| true)
}

/// Makes the directory `to`, or fails when anything is there already.
pub fn make_dir(to: &Path) -> io::Result<()> {
    arriving(to);
    std::fs::create_dir(to)
}

/// Verbatim, as `std::fs` passes its own paths, or a name past MAX_PATH would not move.
#[cfg(windows)]
pub(crate) fn verbatim(path: &Path) -> io::Result<Vec<u16>> {
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
    fn a_copy_onto_a_name_taken_is_refused_and_theirs_kept() {
        let dir = scratch("copy");
        std::fs::write(dir.join("IMG_1.jpg"), "ours").unwrap();
        assert!(copy_unless(&dir.join("IMG_1.jpg"), &dir.join("IMG_2.jpg"), &|| false).unwrap());
        assert_eq!(
            std::fs::read_to_string(dir.join("IMG_2.jpg")).unwrap(),
            "ours"
        );

        std::fs::write(dir.join("IMG_3.jpg"), "theirs").unwrap();
        let err =
            copy_unless(&dir.join("IMG_1.jpg"), &dir.join("IMG_3.jpg"), &|| false).unwrap_err();
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
