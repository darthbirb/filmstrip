//! The Windows Recycle Bin, where Delete sends a file and Restore takes it back from, and never a
//! way to destroy one: a file the bin cannot take is put back where it was and reported refused.
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

    /// Whether `name`, one of a file's full names, is inside this bin.
    fn holds(&self, name: &Path) -> bool;

    /// Forgets what the bin kept beside a file once the file has been taken back out of `binned`,
    /// so the bin no longer lists it.
    fn let_go(&self, binned: &Path) -> io::Result<()>;
}

/// Where the bin keeps a file it took: the name it gave it, and the file itself on its volume, by
/// which it is found again in the bin or back where it was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binned {
    pub path: PathBuf,
    pub file: String,
}

/// What came of sending one file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Sent {
    /// It is in the Recycle Bin.
    Recycled(Binned),
    /// Nothing was there to send.
    Gone,
    /// The bin could not take it, so it is where it was, or under its second name beside it.
    Refused,
}

/// Sends a file to the Recycle Bin. A second name made beside it first outlives whatever the shell
/// does, and the names it gains say what that was: one in the bin, recycled; none, given its name
/// back and refused. DECISIONS.md "Sending to the Recycle Bin".
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
    let (Ok(before), Ok(itself)) = (names_of(&hold), identity(&hold)) else {
        drop_hold(file, &hold)?;
        return Ok(Sent::Refused);
    };
    let _ = bin.take(file);
    if std::fs::symlink_metadata(file).is_ok() {
        drop_hold(file, &hold)?;
        return Ok(Sent::Refused);
    }
    let gained = |name: &PathBuf| !before.contains(name) && bin.holds(name);
    if let Some(binned) = names_of(&hold)
        .ok()
        .and_then(|names| names.into_iter().find(gained))
    {
        std::fs::remove_file(&hold)?;
        return Ok(Sent::Recycled(Binned {
            path: plain(&binned),
            file: itself.key(),
        }));
    }
    noclobber::rename(&hold, file)?;
    Ok(Sent::Refused)
}

/// The file at `path`, as [`Binned::file`] names it; nothing when no file is there.
pub fn file_at(path: &Path) -> Option<String> {
    let is_file = std::fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file());
    is_file
        .then(|| identity(path).ok().map(|found| found.key()))
        .flatten()
}

/// The serial of the volume `path` is on, at a drive letter or mounted at a folder, as
/// [`Binned::file`] begins; nothing when it cannot be reached.
pub fn volume_serial(path: &Path) -> Option<String> {
    #[cfg(windows)]
    let root = volume_of(path).ok()?;
    #[cfg(unix)]
    let root = path.ancestors().find(|dir| dir.is_dir())?.to_path_buf();
    serial_at(&root)
}

fn serial_at(dir: &Path) -> Option<String> {
    let is_dir = std::fs::metadata(dir).is_ok_and(|meta| meta.is_dir());
    is_dir
        .then(|| {
            identity(dir)
                .ok()
                .map(|found| format!("{:x}", found.volume))
        })
        .flatten()
}

/// The serial of the volume a file named as [`Binned::file`] names it is on.
pub fn serial_of(file: &str) -> &str {
    file.split_once('-').map_or(file, |(volume, _)| volume)
}

/// A verbatim name as the rest of the app writes one: `D:\…`, or `\\server\share\…`.
fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{unc}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path.to_path_buf(),
    }
}

/// The second name a file is held under while it is sent: beside it, hidden by its dot.
fn hold_of(file: &Path) -> PathBuf {
    let name = file.file_name().unwrap_or_default().to_string_lossy();
    file.with_file_name(format!(".{name}.recycling"))
}

/// Settles a hold a send cut short left behind. It is never taken for sent: a hold left alone is
/// the file again, and goes on to be sent.
fn settle(file: &Path, hold: &Path) -> io::Result<()> {
    if identity(hold).is_err() {
        return Ok(());
    }
    if std::fs::symlink_metadata(file).is_ok() {
        return drop_hold(file, hold);
    }
    noclobber::rename(hold, file)
}

/// Settles what a send of `file` cut short left beside it, as the next send of it would.
pub fn settle_beside(file: &Path) -> io::Result<()> {
    settle(file, &hold_of(file))
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

    fn key(&self) -> String {
        format!("{:x}-{:x}", self.volume, self.index)
    }
}

#[cfg(windows)]
fn identity(path: &Path) -> io::Result<Identity> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES,
        FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle,
    };

    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
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

#[cfg(windows)]
const LONGEST: u32 = 32_768;

#[cfg(windows)]
fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain([0]).collect()
}

#[cfg(windows)]
fn unwide(text: &[u16]) -> PathBuf {
    use std::os::windows::ffi::OsStringExt;
    let end = text
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(text.len());
    std::ffi::OsString::from_wide(&text[..end]).into()
}

/// `path` in full and verbatim, the form every name here is read and compared in.
#[cfg(windows)]
fn verbatim(path: &Path) -> io::Result<PathBuf> {
    Ok(unwide(&noclobber::verbatim(path)?))
}

/// The root of the volume `path` is on, as its names under it are given.
#[cfg(windows)]
fn volume_of(path: &Path) -> io::Result<PathBuf> {
    use windows_sys::Win32::Storage::FileSystem::GetVolumePathNameW;

    let mut root = vec![0u16; LONGEST as usize];
    let path = noclobber::verbatim(path)?;
    // SAFETY: the path is NUL-terminated, and `root` is as long as the length the call is given.
    if unsafe { GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), LONGEST) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unwide(&root))
}

#[cfg(test)]
thread_local! {
    static UNREADABLE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Makes every file's names unreadable on this thread, as on a drive that cannot list them.
#[cfg(test)]
fn names_unreadable() {
    UNREADABLE.set(true);
}

/// Every full name the file at `path` has, on its volume, verbatim.
#[cfg(windows)]
fn names_of(path: &Path) -> io::Result<Vec<PathBuf>> {
    use windows_sys::Win32::Foundation::{ERROR_HANDLE_EOF, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        FindClose, FindFirstFileNameW, FindNextFileNameW,
    };

    #[cfg(test)]
    if UNREADABLE.get() {
        return Err(io::ErrorKind::Unsupported.into());
    }
    let path = verbatim(path)?;
    let volume = volume_of(&path)?;
    let mut name = vec![0u16; LONGEST as usize];
    let mut length = LONGEST;
    // SAFETY: the path is NUL-terminated, and `name` is as long as `length` says.
    let find =
        unsafe { FindFirstFileNameW(wide(&path).as_ptr(), 0, &mut length, name.as_mut_ptr()) };
    if find == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    let mut names = Vec::new();
    let ended = loop {
        let relative = unwide(&name);
        names.push(volume.join(relative.strip_prefix(r"\").unwrap_or(&relative)));
        name.fill(0);
        length = LONGEST;
        // SAFETY: `find` is open until closed below, and `name` is as long as `length` says.
        if unsafe { FindNextFileNameW(find, &mut length, name.as_mut_ptr()) } == 0 {
            break io::Error::last_os_error();
        }
    };
    // SAFETY: `find` came from FindFirstFileNameW and is closed once.
    unsafe { FindClose(find) };
    if ended.raw_os_error() != Some(ERROR_HANDLE_EOF as i32) {
        return Err(ended);
    }
    Ok(names)
}

#[cfg(unix)]
fn names_of(_path: &Path) -> io::Result<Vec<PathBuf>> {
    Err(io::ErrorKind::Unsupported.into())
}

/// The bin the app's verbs send to and take back from: the shell's [`RecycleBin`], and under test
/// each test thread's own stand-in, so no test can reach the real one.
pub struct Shell;

#[cfg(not(test))]
impl Bin for Shell {
    fn take(&self, file: &Path) -> io::Result<()> {
        RecycleBin.take(file)
    }

    fn holds(&self, name: &Path) -> bool {
        RecycleBin.holds(name)
    }

    fn let_go(&self, binned: &Path) -> io::Result<()> {
        RecycleBin.let_go(binned)
    }
}

#[cfg(test)]
impl Bin for Shell {
    fn take(&self, file: &Path) -> io::Result<()> {
        tests::stand_in().take(file)
    }

    fn holds(&self, name: &Path) -> bool {
        tests::stand_in().holds(name)
    }

    fn let_go(&self, binned: &Path) -> io::Result<()> {
        tests::stand_in().let_go(binned)
    }
}

/// The shell's own Recycle Bin.
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

        if cfg!(test) {
            panic!("{} was handed to the real Recycle Bin", file.display());
        }

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

    fn holds(&self, name: &Path) -> bool {
        let (Ok(name), Ok(volume)) = (verbatim(name), volume_of(name)) else {
            return false;
        };
        name.strip_prefix(&volume)
            .ok()
            .and_then(|rest| rest.components().next())
            .is_some_and(|first| first.as_os_str().eq_ignore_ascii_case("$Recycle.Bin"))
    }

    /// The shell keeps a file as `$R…` beside a record of where it came from, `$I…`, which it
    /// lists the file by; the record goes once the file has, as the shell's own restore does.
    fn let_go(&self, binned: &Path) -> io::Result<()> {
        let Some(rest) = binned
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("$R").or_else(|| name.strip_prefix("$r")))
        else {
            return Ok(());
        };
        let record = binned.with_file_name(format!("$I{rest}"));
        if !self.holds(&record) || std::fs::symlink_metadata(binned).is_ok() {
            return Ok(());
        }
        match std::fs::remove_file(&record) {
            Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
            done => done,
        }
    }
}

#[cfg(not(windows))]
impl Bin for RecycleBin {
    fn take(&self, _file: &Path) -> io::Result<()> {
        Err(io::ErrorKind::Unsupported.into())
    }

    fn holds(&self, _name: &Path) -> bool {
        false
    }

    fn let_go(&self, _binned: &Path) -> io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::fs::{settled_names, settles_to};
    use std::cell::RefCell;
    use std::rc::Rc;

    thread_local! {
        static STAND_IN: RefCell<Option<Rc<Fake>>> = const { RefCell::new(None) };
    }

    /// This thread's stand-in for the shell, which [`Shell`] hands every file to: one that
    /// recycles into a folder of the test's own, unless the test has set another.
    pub(crate) fn stand_in() -> Rc<Fake> {
        STAND_IN.with(|cell| {
            Rc::clone(cell.borrow_mut().get_or_insert_with(|| {
                let test = std::thread::current()
                    .name()
                    .unwrap_or("unnamed")
                    .replace("::", "-");
                let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("target/test-bin")
                    .join(test);
                let _ = std::fs::remove_dir_all(&dir);
                Rc::new(Fake::new(Stand::Recycles(dir)))
            }))
        })
    }

    /// Sets this thread's stand-in, for a test that has the shell do something else, or that
    /// reads what it was asked.
    pub(crate) fn stand_in_as(fake: Fake) -> Rc<Fake> {
        let fake = Rc::new(fake);
        STAND_IN.with(|cell| *cell.borrow_mut() = Some(Rc::clone(&fake)));
        fake
    }

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
        /// Deletes it outright, while something else gives its second name one more name here.
        DeletesWhileLinked(PathBuf),
    }

    pub(crate) struct Fake {
        pub(crate) stand: Stand,
        /// Names the shell refuses, deleting them outright, whatever it does with the rest.
        pub(crate) deletes: Vec<String>,
        pub(crate) asked: RefCell<Vec<PathBuf>>,
        /// Each name a file was taken back out of.
        pub(crate) let_go: RefCell<Vec<PathBuf>>,
    }

    impl Fake {
        pub(crate) fn new(stand: Stand) -> Fake {
            Fake {
                stand,
                deletes: Vec::new(),
                asked: RefCell::default(),
                let_go: RefCell::default(),
            }
        }

        /// The folder it recycles into, as a bin of its own.
        pub(crate) fn dir(&self) -> Option<&Path> {
            match &self.stand {
                Stand::Recycles(bin) | Stand::Relinks(bin) => Some(bin),
                _ => None,
            }
        }
    }

    /// A name in `bin` for `file`: its own, or, once that is taken, one the bin makes up, as the
    /// shell's own does for every file.
    fn binned_name(bin: &Path, file: &Path) -> PathBuf {
        let name = file.file_name().unwrap_or_default().to_string_lossy();
        let mut at = bin.join(&*name);
        let mut made = 0;
        while std::fs::symlink_metadata(&at).is_ok() {
            made += 1;
            at = bin.join(format!("$R{made}-{name}"));
        }
        at
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
                    std::fs::rename(file, binned_name(bin, file))
                }
                Stand::Deletes => std::fs::remove_file(file),
                Stand::Fails => Err(io::Error::other("refused")),
                Stand::Relinks(bin) => {
                    std::fs::create_dir_all(bin)?;
                    let name = file.file_name().unwrap_or_default();
                    std::fs::rename(file, bin.join(name))?;
                    std::fs::hard_link(bin.join(name), bin.join("another"))
                }
                Stand::DeletesWhileLinked(outside) => {
                    std::fs::remove_file(file)?;
                    std::fs::hard_link(hold_of(file), outside)
                }
            }
        }

        fn holds(&self, name: &Path) -> bool {
            let (Stand::Recycles(bin) | Stand::Relinks(bin)) = &self.stand else {
                return false;
            };
            let lower = |path: &Path| {
                let text = path.to_string_lossy().to_lowercase();
                PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
            };
            lower(name).starts_with(lower(bin))
        }

        fn let_go(&self, binned: &Path) -> io::Result<()> {
            self.let_go.borrow_mut().push(binned.to_path_buf());
            Ok(())
        }
    }

    fn recycled(sent: Sent) -> bool {
        matches!(sent, Sent::Recycled(_))
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-recycle")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("trash")).unwrap();
        dir
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

            let recycled = dir.join("bin/one.jpg");
            let sent = send(&bin, &file).unwrap();
            assert_eq!(
                sent,
                Sent::Recycled(Binned {
                    path: recycled.clone(),
                    file: file_at(&recycled).unwrap(),
                }),
                "{others}"
            );
            assert_eq!(std::fs::read_to_string(&recycled).unwrap(), "one");
            assert_eq!(identity(&recycled).unwrap().links, others + 1);
            settles_to(&dir.join("trash"), &[]);
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
        settles_to(&dir.join("trash"), &["one.jpg"]);
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
            settles_to(&dir.join("trash"), &["one.jpg"]);
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
            settles_to(&dir.join("trash"), &["one.jpg"]);
            assert_eq!(identity(&file).unwrap().links, others + 1);
        }
    }

    #[test]
    fn a_file_the_bin_takes_while_it_gains_a_name_there_is_still_recycled() {
        let dir = scratch("relinked");
        let file = one_with_names(&dir, 1);

        let bin = Fake::new(Stand::Relinks(dir.join("bin")));
        assert!(recycled(send(&bin, &file).unwrap()));
        settles_to(&dir.join("trash"), &[]);
        assert_eq!(
            std::fs::read_to_string(dir.join("bin/one.jpg")).unwrap(),
            "one"
        );
        assert_eq!(identity(&dir.join("bin/one.jpg")).unwrap().links, 3);
    }

    #[test]
    fn a_file_deleted_outright_while_it_gains_a_name_elsewhere_is_put_back_and_refused() {
        for others in [0, 1] {
            let dir = scratch(&format!("deleted-relinked-{others}"));
            let file = one_with_names(&dir, others);
            let outside = dir.join("elsewhere/outside.jpg");

            let bin = Fake::new(Stand::DeletesWhileLinked(outside.clone()));
            assert_eq!(send(&bin, &file).unwrap(), Sent::Refused, "{others}");
            settles_to(&dir.join("trash"), &["one.jpg"]);
            assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
            assert_eq!(identity(&file).unwrap().links, others + 2);
            assert!(
                identity(&file)
                    .unwrap()
                    .same_as(&identity(&outside).unwrap())
            );
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_file_has_every_one_of_its_names_and_the_shells_bin_is_at_its_volumes_root() {
        let dir = scratch("names");
        let file = one_with_names(&dir, 2);

        let lower = |paths: Vec<PathBuf>| -> Vec<PathBuf> {
            let mut lowered: Vec<PathBuf> = paths
                .iter()
                .map(|path| PathBuf::from(path.to_string_lossy().to_lowercase()))
                .collect();
            lowered.sort();
            lowered
        };
        assert_eq!(
            lower(names_of(&file).unwrap()),
            lower(
                [
                    dir.join("elsewhere/0.jpg"),
                    dir.join("elsewhere/1.jpg"),
                    file.clone(),
                ]
                .iter()
                .map(|path| verbatim(path).unwrap())
                .collect()
            )
        );

        let volume = volume_of(&dir).unwrap();
        let shell = RecycleBin;
        assert!(shell.holds(&volume.join(r"$Recycle.Bin\S-1-5-21\$RAB12CD.jpg")));
        assert!(shell.holds(&volume.join(r"$RECYCLE.BIN\S-1-5-21\$RAB12CD.jpg")));
        assert!(!shell.holds(&dir.join(r"$Recycle.Bin\S-1-5-21\$RAB12CD.jpg")));
        assert!(!shell.holds(&file));
        let plain = volume.to_string_lossy().replace(r"\\?\", "");
        assert!(shell.holds(&Path::new(&plain).join(r"$Recycle.Bin\S-1-5-21\$RAB12CD.jpg")));
    }

    #[cfg(windows)]
    #[test]
    fn a_file_whose_second_name_is_past_max_path_is_still_recycled() {
        let dir = scratch("long");
        let trash = dir.join("trash");
        let room = 255 - trash.as_os_str().len();
        let file = trash.join(format!("{}.jpg", "a".repeat(room - 5)));
        assert!(file.as_os_str().len() < 260 && hold_of(&file).as_os_str().len() >= 260);
        std::fs::write(&file, "one").unwrap();
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));

        assert!(recycled(send(&bin, &file).unwrap()));
        settles_to(&trash, &[]);
        assert_eq!(
            settled_names(&dir.join("bin"), |seen| seen.len() == 1).len(),
            1
        );
    }

    #[test]
    fn a_file_whose_names_cannot_be_read_is_refused_and_never_handed_to_the_shell() {
        let dir = scratch("unreadable");
        let file = one_with_names(&dir, 1);
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));
        names_unreadable();

        assert_eq!(send(&bin, &file).unwrap(), Sent::Refused);
        assert!(bin.asked.borrow().is_empty());
        settles_to(&dir.join("trash"), &["one.jpg"]);
        assert_eq!(identity(&file).unwrap().links, 2);
        assert!(!dir.join("bin").exists());
    }

    #[test]
    fn a_name_already_in_the_bin_never_counts_as_the_send() {
        for deleted in [true, false] {
            let dir = scratch(&format!("in-bin-already-{deleted}"));
            let file = dir.join("trash/one.jpg");
            std::fs::write(&file, "one").unwrap();
            std::fs::create_dir_all(dir.join("bin")).unwrap();
            std::fs::hard_link(&file, dir.join("bin/$Rold.jpg")).unwrap();
            let mut bin = Fake::new(Stand::Recycles(dir.join("bin")));
            if deleted {
                bin.deletes.push("one".into());
            }

            let sent = send(&bin, &file).unwrap();
            if deleted {
                assert_eq!(sent, Sent::Refused);
                settles_to(&dir.join("trash"), &["one.jpg"]);
                assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
                settles_to(&dir.join("bin"), &["$Rold.jpg"]);
            } else {
                assert!(recycled(sent));
                settles_to(&dir.join("trash"), &[]);
                settles_to(&dir.join("bin"), &["$Rold.jpg", "one.jpg"]);
            }
        }
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
        assert!(recycled(send(&bin, &file).unwrap()));
        settles_to(&dir.join("trash"), &[]);

        // Cut short after the shell deleted it outright: the hold is the file.
        std::fs::write(&hold, "two").unwrap();
        assert_eq!(
            send(&Fake::new(Stand::Fails), &file).unwrap(),
            Sent::Refused
        );
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "two");
        settles_to(&dir.join("trash"), &["one.jpg"]);

        // Cut short after the bin took it: the hold is the file again, and is sent once more.
        std::fs::hard_link(&file, &hold).unwrap();
        std::fs::rename(&file, dir.join("bin/two.jpg")).unwrap();
        let again = Fake::new(Stand::Recycles(dir.join("bin")));
        let Sent::Recycled(binned) = send(&again, &file).unwrap() else {
            panic!("not recycled");
        };
        assert_eq!(again.asked.borrow().as_slice(), std::slice::from_ref(&file));
        settles_to(&dir.join("trash"), &[]);
        for twin in [dir.join("bin/two.jpg"), binned.path] {
            assert_eq!(std::fs::read_to_string(twin).unwrap(), "two");
        }
        assert_eq!(
            std::fs::read_to_string(dir.join("bin/one.jpg")).unwrap(),
            "one"
        );
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
        settles_to(&dir.join("trash"), &["one.jpg"]);
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
    fn letting_go_of_a_file_outside_the_bin_never_removes_its_neighbour() {
        let dir = scratch("let-go");
        let record = dir.join("trash/$IABC123.jpg");
        std::fs::write(&record, "a record").unwrap();

        RecycleBin.let_go(&dir.join("trash/$RABC123.jpg")).unwrap();
        assert_eq!(std::fs::read_to_string(&record).unwrap(), "a record");
    }
}
