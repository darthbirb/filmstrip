//! The Windows Recycle Bin as one more place a file can go, and never a way to destroy one: a file
//! the bin cannot take is put back where it was and reported refused.
//! DECISIONS.md "Sending to the Recycle Bin".

use std::io;
use std::path::{Path, PathBuf};

use crate::fs::noclobber;

/// What a file is handed to. The shell's [`RecycleBin`] in the app; a stand-in under test, so no
/// test ever reaches the real one.
pub trait Bin {
    /// Asks for `file` to go. The shell may recycle it, delete it outright, or leave it; [`send`]
    /// finds out which from the disk, never from what this returns.
    fn take(&self, file: &Path) -> io::Result<()>;
}

/// What came of sending one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sent {
    /// It is in the Recycle Bin.
    Recycled,
    /// Nothing was there to send.
    Gone,
    /// The bin could not take it, so it is where it was, or under its second name beside it.
    Refused,
}

/// Sends a file to the Recycle Bin. A second name for it is made beside it first, so whatever the
/// shell does the file outlives it, and its count of names says what happened: the same, the bin
/// holds it under another and the second name goes; one fewer, it was deleted outright and is given
/// its own name back. Anything else is refused with the second name kept.
pub fn send(bin: &dyn Bin, file: &Path) -> io::Result<Sent> {
    let hold = hold_of(file);
    settle(file, &hold)?;
    match std::fs::symlink_metadata(file) {
        Ok(meta) if meta.is_file() => {}
        Ok(_) => return Ok(Sent::Refused),
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Sent::Gone),
        Err(err) => return Err(err),
    }
    if std::fs::hard_link(file, &hold).is_err() {
        return Ok(Sent::Refused);
    }
    let held = identity(&hold)?.links;
    let _ = bin.take(file);
    if std::fs::symlink_metadata(file).is_ok() {
        drop_hold(file, &hold)?;
        return Ok(Sent::Refused);
    }
    let left = identity(&hold)?.links;
    if left == held {
        std::fs::remove_file(&hold)?;
        return Ok(Sent::Recycled);
    }
    if left + 1 == held {
        noclobber::rename(&hold, file)?;
    }
    Ok(Sent::Refused)
}

/// The second name a file is held under while it is sent: beside it, hidden by its dot.
fn hold_of(file: &Path) -> PathBuf {
    let name = file.file_name().unwrap_or_default().to_string_lossy();
    file.with_file_name(format!(".{name}.recycling"))
}

/// The file a hold is the second name of, when `path` is one.
fn held_by(path: &Path) -> Option<PathBuf> {
    let name = path.file_name()?.to_str()?;
    let file = name.strip_prefix('.')?.strip_suffix(".recycling")?;
    (!file.is_empty()).then(|| path.with_file_name(file))
}

/// Settles a hold a send cut short left behind. Its count of names then is unknown, so it is never
/// taken for the bin's: a hold left alone is the file again, and goes on to be sent.
fn settle(file: &Path, hold: &Path) -> io::Result<()> {
    if identity(hold).is_err() {
        return Ok(());
    }
    if std::fs::symlink_metadata(file).is_ok() {
        return drop_hold(file, hold);
    }
    noclobber::rename(hold, file)
}

/// Puts back each hold under `dir` that no row `needs` as the file it holds, where that name is
/// free, and says how many; nothing is ever removed. One a row needs waits for that row's send.
pub fn sweep(dir: &Path, needs: &dyn Fn(&Path) -> bool) -> u32 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut put = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            put += sweep(&path, needs);
            continue;
        }
        let Some(file) = held_by(&path) else {
            continue;
        };
        if !kind.is_file() || needs(&file) || std::fs::symlink_metadata(&file).is_ok() {
            continue;
        }
        match noclobber::rename(&path, &file) {
            Ok(()) => put += 1,
            Err(err) => eprintln!("recycle: {} was not put back: {err}", path.display()),
        }
    }
    put
}

/// Removes the hold only while it is a second name of the file itself, never the last of one.
fn drop_hold(file: &Path, hold: &Path) -> io::Result<()> {
    let (file_is, hold_is) = (identity(file)?, identity(hold)?);
    if file_is.same_as(&hold_is) && hold_is.links >= 2 {
        std::fs::remove_file(hold)?;
        return Ok(());
    }
    Err(io::Error::other(format!(
        "{} is not a second name of {}",
        hold.display(),
        file.display()
    )))
}

struct Identity {
    links: u32,
    volume: u64,
    index: u64,
}

impl Identity {
    fn same_as(&self, other: &Identity) -> bool {
        self.volume == other.volume && self.index == other.index
    }
}

#[cfg(windows)]
fn identity(path: &Path) -> io::Result<Identity> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, GetFileInformationByHandle,
    };

    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(path)?;
    // SAFETY: all-zero is a valid BY_HANDLE_FILE_INFORMATION, which the call fills in.
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: the handle is open for as long as `file` lives, and `info` outlives the call.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(Identity {
        links: info.nNumberOfLinks,
        volume: u64::from(info.dwVolumeSerialNumber),
        index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    })
}

#[cfg(unix)]
fn identity(path: &Path) -> io::Result<Identity> {
    use std::os::unix::fs::MetadataExt;

    let meta = std::fs::metadata(path)?;
    Ok(Identity {
        links: u32::try_from(meta.nlink()).unwrap_or(u32::MAX),
        volume: meta.dev(),
        index: meta.ino(),
    })
}

/// The shell's own Recycle Bin, which every send goes through in the app.
pub struct RecycleBin;

#[cfg(windows)]
impl Bin for RecycleBin {
    fn take(&self, file: &Path) -> io::Result<()> {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::{
            FO_DELETE, FOF_ALLOWUNDO, FOF_NO_UI, SHFILEOPSTRUCTW, SHFileOperationW,
        };

        const FLAGS: u16 = {
            let flags = FOF_ALLOWUNDO | FOF_NO_UI;
            assert!(flags >> 16 == 0, "the shell's flags fit its 16 bits");
            flags as u16
        };

        let full = std::path::absolute(file)?;
        let mut from: Vec<u16> = full.as_os_str().encode_wide().collect();
        // The shell takes no verbatim path, and its list ends in two NULs.
        let wide = |text: &str| text.encode_utf16().collect::<Vec<u16>>();
        if from.starts_with(&wide(r"\\?\")) && !from.starts_with(&wide(r"\\?\UNC\")) {
            from.drain(..4);
        }
        from.extend([0, 0]);
        let mut op = SHFILEOPSTRUCTW {
            wFunc: FO_DELETE,
            pFrom: from.as_ptr(),
            fFlags: FLAGS,
            ..Default::default()
        };
        // SAFETY: `from` is a double-NUL-terminated wide list that outlives the call.
        let code = unsafe { SHFileOperationW(&mut op) };
        if code != 0 || op.fAnyOperationsAborted != 0 {
            return Err(io::Error::other(format!(
                "the shell did not take it ({code:#x})"
            )));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
impl Bin for RecycleBin {
    fn take(&self, _file: &Path) -> io::Result<()> {
        Err(io::ErrorKind::Unsupported.into())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A stand-in for the shell, doing to each file what the real one might.
    pub(crate) enum Stand {
        /// Moves it into a folder of its own, on the same volume, as the Recycle Bin does.
        Recycles(PathBuf),
        /// Deletes it outright, as the shell does where the bin cannot take it.
        Deletes,
        /// Leaves it where it is and says so.
        Fails,
        /// Moves it as [`Stand::Recycles`] does, while something else gives it one more name there.
        Relinks(PathBuf),
    }

    pub(crate) struct Fake {
        pub(crate) stand: Stand,
        /// Names the shell refuses, deleting them outright, whatever it does with the rest.
        pub(crate) deletes: Vec<String>,
        pub(crate) asked: RefCell<Vec<PathBuf>>,
    }

    impl Fake {
        pub(crate) fn new(stand: Stand) -> Fake {
            Fake {
                stand,
                deletes: Vec::new(),
                asked: RefCell::default(),
            }
        }
    }

    impl Bin for Fake {
        fn take(&self, file: &Path) -> io::Result<()> {
            self.asked.borrow_mut().push(file.to_path_buf());
            let name = file.file_name().unwrap_or_default().to_string_lossy();
            if self.deletes.iter().any(|one| name.contains(one.as_str())) {
                return std::fs::remove_file(file);
            }
            match &self.stand {
                Stand::Recycles(bin) => {
                    std::fs::create_dir_all(bin)?;
                    std::fs::rename(file, bin.join(file.file_name().unwrap_or_default()))
                }
                Stand::Deletes => std::fs::remove_file(file),
                Stand::Fails => Err(io::Error::other("refused")),
                Stand::Relinks(bin) => {
                    std::fs::create_dir_all(bin)?;
                    let name = file.file_name().unwrap_or_default();
                    std::fs::rename(file, bin.join(name))?;
                    std::fs::hard_link(bin.join(name), bin.join("another"))
                }
            }
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-recycle")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("trash")).unwrap();
        dir
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut found: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        found.sort();
        found
    }

    /// `trash/one.jpg`, with `others` more names for it in `elsewhere/`, as a dedup tool or a
    /// link-based backup leaves a file.
    fn one_with_names(dir: &Path, others: u32) -> PathBuf {
        let file = dir.join("trash/one.jpg");
        std::fs::write(&file, "one").unwrap();
        std::fs::create_dir_all(dir.join("elsewhere")).unwrap();
        for other in 0..others {
            std::fs::hard_link(&file, dir.join(format!("elsewhere/{other}.jpg"))).unwrap();
        }
        file
    }

    #[test]
    fn a_file_the_bin_takes_is_in_it_and_nothing_is_left_beside_where_it_was() {
        for others in [0, 1, 2] {
            let dir = scratch(&format!("recycled-{others}"));
            let file = one_with_names(&dir, others);
            let bin = Fake::new(Stand::Recycles(dir.join("bin")));

            assert_eq!(send(&bin, &file).unwrap(), Sent::Recycled, "{others}");
            let recycled = dir.join("bin/one.jpg");
            assert_eq!(std::fs::read_to_string(&recycled).unwrap(), "one");
            assert_eq!(identity(&recycled).unwrap().links, others + 1);
            assert!(names(&dir.join("trash")).is_empty());
        }
    }

    #[test]
    fn a_file_the_shell_deletes_outright_is_put_back_and_refused() {
        let dir = scratch("deleted");
        let file = dir.join("trash/one.jpg");
        std::fs::write(&file, "one").unwrap();
        let bin = Fake::new(Stand::Deletes);

        assert_eq!(send(&bin, &file).unwrap(), Sent::Refused);
        assert_eq!(bin.asked.borrow().as_slice(), std::slice::from_ref(&file));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
        assert_eq!(names(&dir.join("trash")), ["one.jpg"]);
        assert_eq!(identity(&file).unwrap().links, 1);
    }

    #[test]
    fn a_file_with_another_name_elsewhere_the_shell_deletes_outright_is_put_back_and_refused() {
        for others in [1, 2] {
            let dir = scratch(&format!("deleted-linked-{others}"));
            let file = one_with_names(&dir, others);

            assert_eq!(
                send(&Fake::new(Stand::Deletes), &file).unwrap(),
                Sent::Refused
            );
            assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
            assert_eq!(names(&dir.join("trash")), ["one.jpg"]);
            assert_eq!(identity(&file).unwrap().links, others + 1);
        }
    }

    #[test]
    fn a_file_the_shell_leaves_is_refused_and_untouched() {
        for others in [0, 1] {
            let dir = scratch(&format!("left-{others}"));
            let file = one_with_names(&dir, others);

            assert_eq!(
                send(&Fake::new(Stand::Fails), &file).unwrap(),
                Sent::Refused
            );
            assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
            assert_eq!(names(&dir.join("trash")), ["one.jpg"]);
            assert_eq!(identity(&file).unwrap().links, others + 1);
        }
    }

    #[test]
    fn a_file_whose_names_change_otherwise_is_refused_and_kept_under_its_second_name() {
        let dir = scratch("relinked");
        let file = one_with_names(&dir, 1);
        let hold = hold_of(&file);

        let bin = Fake::new(Stand::Relinks(dir.join("bin")));
        assert_eq!(send(&bin, &file).unwrap(), Sent::Refused);
        assert_eq!(names(&dir.join("trash")), [".one.jpg.recycling"]);
        assert_eq!(std::fs::read_to_string(&hold).unwrap(), "one");

        let again = Fake::new(Stand::Recycles(dir.join("bin-again")));
        assert_eq!(send(&again, &file).unwrap(), Sent::Recycled);
        assert_eq!(again.asked.borrow().as_slice(), std::slice::from_ref(&file));
        assert!(names(&dir.join("trash")).is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.join("bin-again/one.jpg")).unwrap(),
            "one"
        );
    }

    #[test]
    fn a_file_already_gone_is_not_sent_and_counts_as_gone() {
        let dir = scratch("gone");
        let bin = Fake::new(Stand::Deletes);
        assert_eq!(send(&bin, &dir.join("trash/one.jpg")).unwrap(), Sent::Gone);
        assert!(bin.asked.borrow().is_empty());
    }

    #[test]
    fn a_hold_a_send_cut_short_left_is_settled_and_nothing_is_lost() {
        let dir = scratch("cut-short");
        let file = dir.join("trash/one.jpg");
        let hold = hold_of(&file);
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));

        // Cut short before the shell was asked: both names, one file.
        std::fs::write(&file, "one").unwrap();
        std::fs::hard_link(&file, &hold).unwrap();
        assert_eq!(send(&bin, &file).unwrap(), Sent::Recycled);
        assert!(names(&dir.join("trash")).is_empty());

        // Cut short after the shell deleted it outright: the hold is the file.
        std::fs::write(&hold, "two").unwrap();
        assert_eq!(
            send(&Fake::new(Stand::Fails), &file).unwrap(),
            Sent::Refused
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(names(&dir.join("trash")), ["one.jpg"]);

        // Cut short after the bin took it: the hold is the file again, and is sent once more.
        std::fs::hard_link(&file, &hold).unwrap();
        std::fs::rename(&file, dir.join("bin/two.jpg")).unwrap();
        let again = Fake::new(Stand::Recycles(dir.join("bin")));
        assert_eq!(send(&again, &file).unwrap(), Sent::Recycled);
        assert_eq!(again.asked.borrow().as_slice(), std::slice::from_ref(&file));
        assert!(names(&dir.join("trash")).is_empty());
        for twin in ["bin/two.jpg", "bin/one.jpg"] {
            assert_eq!(std::fs::read_to_string(dir.join(twin)).unwrap(), "two");
        }
    }

    #[test]
    fn a_lone_hold_with_another_name_elsewhere_is_put_back_never_taken_for_the_bins() {
        let dir = scratch("lone-linked");
        let file = dir.join("trash/one.jpg");
        let hold = hold_of(&file);
        std::fs::write(&hold, "one").unwrap();
        std::fs::create_dir_all(dir.join("elsewhere")).unwrap();
        std::fs::hard_link(&hold, dir.join("elsewhere/one.jpg")).unwrap();

        assert_eq!(
            send(&Fake::new(Stand::Fails), &file).unwrap(),
            Sent::Refused
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
        assert_eq!(names(&dir.join("trash")), ["one.jpg"]);
        assert_eq!(identity(&file).unwrap().links, 2);
    }

    #[test]
    fn a_hold_that_is_another_file_is_never_removed() {
        let dir = scratch("stranger");
        let file = dir.join("trash/one.jpg");
        std::fs::write(&file, "one").unwrap();
        std::fs::write(hold_of(&file), "another").unwrap();

        assert!(send(&Fake::new(Stand::Deletes), &file).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
        assert_eq!(std::fs::read_to_string(hold_of(&file)).unwrap(), "another");
    }

    #[test]
    fn the_sweep_puts_back_holds_no_row_needs_and_removes_nothing() {
        let dir = scratch("sweep");
        let shard = dir.join("trash/ab/cd");
        std::fs::create_dir_all(&shard).unwrap();
        let orphan = shard.join("orphan.jpg");
        std::fs::write(hold_of(&orphan), "orphan").unwrap();
        let needed = shard.join("needed.jpg");
        std::fs::write(hold_of(&needed), "needed").unwrap();
        let beside = shard.join("beside.jpg");
        std::fs::write(&beside, "beside").unwrap();
        std::fs::hard_link(&beside, hold_of(&beside)).unwrap();
        std::fs::write(shard.join(".recycling"), "not a hold").unwrap();

        let put = sweep(&dir.join("trash"), &|file| file == needed);

        assert_eq!(put, 1);
        assert_eq!(std::fs::read_to_string(&orphan).unwrap(), "orphan");
        assert_eq!(
            names(&shard),
            [
                ".beside.jpg.recycling",
                ".needed.jpg.recycling",
                ".recycling",
                "beside.jpg",
                "orphan.jpg"
            ]
        );
    }
}
