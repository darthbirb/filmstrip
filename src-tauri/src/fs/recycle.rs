//! The Windows Recycle Bin, where Delete sends a file, Restore takes it back from and Empty Trash…
//! deletes it for good. A send never destroys one: a file the bin cannot take is put back where it
//! was and reported refused. DECISIONS.md "Sending to the Recycle Bin".

use std::io;
use std::path::{Path, PathBuf};

use crate::fs::noclobber;

/// What a file is handed to. The shell's [`RecycleBin`] in the app; a stand-in under test, so no
/// test ever reaches the real one.
pub trait Bin {
    /// Asks for `file` to go into the bin and never anywhere else, answering with the name the
    /// shell says it gave it there, when it says. [`send`] believes the disk over this wherever it
    /// can read the file's names.
    fn take(&self, file: &Path) -> io::Result<Option<PathBuf>>;

    /// Whether `name`, one of a file's full names, is inside this bin.
    fn holds(&self, name: &Path) -> bool;

    /// Forgets what the bin kept beside a file once the file has been taken back out of `binned`,
    /// so the bin no longer lists it.
    fn let_go(&self, binned: &Path) -> io::Result<()>;

    /// The drive `path` is on, as Explorer names it, when that drive has no Recycle Bin at all, so
    /// the shell would delete outright whatever is sent from it. Nothing when it has one, or when
    /// that cannot be told: a send from there still never deletes outright.
    fn binless(&self, path: &Path) -> Option<String>;
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
    /// Its path is too long for the shell to take, so it was never handed over.
    TooLong,
    /// It could not be given a second name, or that name's names could not be read, so it was
    /// never handed over: the code the disk refused it with, when it gave one.
    Unheld(Option<i32>),
    /// Sent without a second name, it left its folder, but the shell gave no name in the bin that
    /// is still the file, so where it went cannot be told.
    Untraced,
}

/// Sends a file to the Recycle Bin, held under a second name, kept until [`release`] once it is
/// recycled; `holding` is told the file and its names before the shell is asked.
/// DECISIONS.md "Sending to the Recycle Bin".
pub fn send(
    bin: &dyn Bin,
    file: &Path,
    holding: impl FnOnce(&str, &[PathBuf]) -> io::Result<()>,
) -> io::Result<Sent> {
    let hold = hold_of(file);
    settle(file, &hold)?;
    let was = match std::fs::symlink_metadata(file) {
        Ok(meta) if meta.is_file() => meta,
        Ok(_) => return Ok(Sent::Refused),
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(Sent::Gone),
        Err(err) => return Err(err),
    };
    if too_long_for_shell(file) {
        return Ok(Sent::TooLong);
    }
    if let Err(err) = link(file, &hold) {
        return match err.raw_os_error() {
            _ if err.kind() == io::ErrorKind::NotFound => Ok(Sent::Gone),
            Some(code) if no_second_name(code) => send_unlinked(bin, file, &was),
            code => Ok(Sent::Unheld(code)),
        };
    }
    let (before, itself) = match (names_of(&hold), identity(&hold)) {
        (Ok(before), Ok(itself)) => (before, itself),
        (Err(err), _) | (_, Err(err)) => {
            drop_hold(file, &hold)?;
            return Ok(Sent::Unheld(err.raw_os_error()));
        }
    };
    if let Err(err) = holding(&itself.key(), &before) {
        drop_hold(file, &hold)?;
        return Err(err);
    }
    let _ = bin.take(file);
    if std::fs::symlink_metadata(file).is_ok() {
        drop_hold(file, &hold)?;
        return Ok(Sent::Refused);
    }
    if let Some(binned) = gained(bin, &hold, &before) {
        return Ok(Sent::Recycled(Binned {
            path: binned,
            file: itself.key(),
        }));
    }
    noclobber::rename(&hold, file)?;
    Ok(Sent::Refused)
}

/// The name the second name's file gained in the bin since it had only `before`.
fn gained(bin: &dyn Bin, hold: &Path, before: &[PathBuf]) -> Option<PathBuf> {
    names_of(hold)
        .ok()?
        .into_iter()
        .find(|name| !before.contains(name) && bin.holds(name))
        .map(|name| plain(&name))
}

/// Whether the disk's `code` for a second name that could not be made says the file can never
/// have one there: a drive without hard links, or a file with all the names NTFS allows.
#[cfg(windows)]
fn no_second_name(code: i32) -> bool {
    use windows_sys::Win32::Foundation::{
        ERROR_INVALID_FUNCTION, ERROR_NOT_SUPPORTED, ERROR_TOO_MANY_LINKS,
    };

    [
        ERROR_INVALID_FUNCTION,
        ERROR_NOT_SUPPORTED,
        ERROR_TOO_MANY_LINKS,
    ]
    .contains(&(code as u32))
}

#[cfg(not(windows))]
fn no_second_name(_code: i32) -> bool {
    false
}

/// Sends a file that cannot have a second name, on what the shell says alone: refused unless the
/// disk says it left its path, and recycled only under a name the shell gave in the bin of the
/// file's own volume, with the file's size and last write.
fn send_unlinked(bin: &dyn Bin, file: &Path, was: &std::fs::Metadata) -> io::Result<Sent> {
    let volume = file.parent().and_then(volume_serial);
    let said = bin.take(file);
    match metadata_after(file) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        _ => return Ok(Sent::Refused),
    }
    let found = said
        .ok()
        .flatten()
        .filter(|at| bin.holds(at) && same_contents(was, at))
        .and_then(|at| Some((file_at(&at)?, at)))
        .filter(|(itself, _)| volume.as_deref() == Some(serial_of(itself)));
    Ok(match found {
        Some((itself, at)) => Sent::Recycled(Binned {
            path: plain(&at),
            file: itself,
        }),
        None => Sent::Untraced,
    })
}

fn same_contents(was: &std::fs::Metadata, at: &Path) -> bool {
    std::fs::symlink_metadata(at).is_ok_and(|now| {
        now.is_file()
            && now.len() == was.len()
            && now
                .modified()
                .ok()
                .is_some_and(|when| was.modified().ok() == Some(when))
    })
}

/// `TSF_DELETE_RECYCLE_IF_POSSIBLE`, which the shell sets on a file it is about to recycle.
const RECYCLES: u32 = 0x80;

/// What the shell said of the one file an operation deletes, and what the app answered it.
/// DECISIONS.md "Sending to the Recycle Bin".
#[derive(Debug, Default)]
struct Watch {
    asked: bool,
    stopped: bool,
    placed: Option<PathBuf>,
}

impl Watch {
    /// Before the shell deletes the file: whether it may, which is only into the bin.
    fn before_delete(&mut self, flags: u32) -> bool {
        let recycles = flags & RECYCLES != 0;
        self.asked = true;
        self.stopped |= !recycles;
        recycles
    }

    /// Once it has, the name it gave the file in the bin, if it gave one.
    fn after_delete(&mut self, deleted: bool, newly: Option<PathBuf>) {
        if deleted && self.asked && !self.stopped {
            self.placed = newly;
        }
    }

    /// What the operation came to: refused when it failed, was stopped, or deleted without
    /// asking first; otherwise the name the file was given in the bin, when the shell said.
    fn outcome(self, performed: io::Result<()>, aborted: bool) -> io::Result<Option<PathBuf>> {
        performed?;
        if aborted || self.stopped || !self.asked {
            return Err(io::Error::other("the Recycle Bin did not take it"));
        }
        Ok(self.placed)
    }
}

/// Where the bin put `file` when a send was cut short after the shell took it: a name its second
/// name gained there since it had only `before`, while it is still the file `itself` and not
/// still at its own path.
pub fn found_in_bin(
    bin: &dyn Bin,
    file: &Path,
    itself: &str,
    before: &[PathBuf],
) -> Option<Binned> {
    let hold = hold_of(file);
    if file_at(file).as_deref() == Some(itself) || identity(&hold).ok()?.key() != itself {
        return None;
    }
    gained(bin, &hold, before).map(|path| Binned {
        path,
        file: itself.to_owned(),
    })
}

/// Removes the second name a recycled file kept, once its send is recorded: only while it is
/// still the file `itself` with a name besides. Any other is settled as a cut-short send's is.
pub fn release(file: &Path, itself: &str) -> io::Result<()> {
    let hold = hold_of(file);
    match identity(&hold) {
        Err(_) => Ok(()),
        Ok(found) if found.key() == itself && found.links >= 2 => std::fs::remove_file(&hold),
        Ok(_) => settle(file, &hold),
    }
}

/// Deletes for good the file the bin keeps as `binned`, then the bin's record of it: only a name
/// inside the bin, and only while it is still the file `itself` names.
/// DECISIONS.md "Emptying the Trash".
pub fn purge(bin: &dyn Bin, binned: &Path, itself: &str) -> io::Result<()> {
    if !bin.holds(binned) {
        return Err(io::Error::other(format!(
            "{} is not in the Recycle Bin",
            binned.display()
        )));
    }
    destroy(binned, itself)?;
    if let Err(err) = bin.let_go(binned) {
        eprintln!(
            "recycle: the bin's record of {} stays: {err}",
            binned.display()
        );
    }
    Ok(())
}

fn not_itself(path: &Path) -> io::Error {
    io::Error::other(format!(
        "{} is not the file the Trash sent there",
        path.display()
    ))
}

/// Removes the one name `path` while it is the file `itself` names: read and deleted through one
/// handle, so nothing can take the name between the two. Its other names, if any, stay.
#[cfg(windows)]
fn destroy(path: &Path, itself: &str) -> io::Result<()> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{
        ERROR_INVALID_FUNCTION, ERROR_INVALID_PARAMETER, ERROR_NOT_SUPPORTED,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        DELETE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_DISPOSITION_FLAG_DELETE, FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
        FILE_DISPOSITION_FLAG_POSIX_SEMANTICS, FILE_DISPOSITION_INFO, FILE_DISPOSITION_INFO_EX,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, FileDispositionInfo, FileDispositionInfoEx, SetFileInformationByHandle,
    };

    let file = std::fs::OpenOptions::new()
        .access_mode(DELETE | FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(path)?;
    let (found, attributes) = held(&file)?;
    if attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || found.key() != itself
    {
        return Err(not_itself(path));
    }
    let set = |class, info: *const core::ffi::c_void, size: usize| {
        // SAFETY: the handle is open for as long as `file` lives, and `info` points at `size` bytes
        // of the structure `class` names, which outlives the call.
        unsafe { SetFileInformationByHandle(file.as_raw_handle(), class, info, size as u32) != 0 }
    };
    let ex = FILE_DISPOSITION_INFO_EX {
        Flags: FILE_DISPOSITION_FLAG_DELETE
            | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS
            | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
    };
    if set(
        FileDispositionInfoEx,
        (&raw const ex).cast(),
        size_of::<FILE_DISPOSITION_INFO_EX>(),
    ) {
        return Ok(());
    }
    let err = io::Error::last_os_error();
    let older = [
        ERROR_INVALID_PARAMETER,
        ERROR_NOT_SUPPORTED,
        ERROR_INVALID_FUNCTION,
    ];
    if !err
        .raw_os_error()
        .is_some_and(|code| older.contains(&(code as u32)))
    {
        return Err(err);
    }
    let plain = FILE_DISPOSITION_INFO { DeleteFile: true };
    if set(
        FileDispositionInfo,
        (&raw const plain).cast(),
        size_of::<FILE_DISPOSITION_INFO>(),
    ) {
        return Ok(());
    }
    Err(io::Error::last_os_error())
}

#[cfg(unix)]
fn destroy(path: &Path, itself: &str) -> io::Result<()> {
    let is_file = std::fs::symlink_metadata(path)?.is_file();
    if !is_file || identity(path)?.key() != itself {
        return Err(not_itself(path));
    }
    std::fs::remove_file(path)
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
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE,
    };

    let file = std::fs::OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(path)?;
    held(&file).map(|(found, _)| found)
}

/// What an open file is, and its attributes.
#[cfg(windows)]
fn held(file: &std::fs::File) -> io::Result<(Identity, u32)> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    // SAFETY: all-zero is a valid BY_HANDLE_FILE_INFORMATION, which the call fills in.
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: the handle is open for as long as `file` lives, and `info` outlives the call.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let found = Identity {
        links: info.nNumberOfLinks,
        volume: u64::from(info.dwVolumeSerialNumber),
        index: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
    };
    Ok((found, info.dwFileAttributes))
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
    static UNLINKABLE: std::cell::Cell<Option<i32>> = const { std::cell::Cell::new(None) };
    static UNSEEN: std::cell::Cell<Option<i32>> = const { std::cell::Cell::new(None) };
}

/// Makes a file sent without a second name unreadable on this thread once the shell has had it,
/// with the disk's `code`, as on a drive that stops answering.
#[cfg(test)]
fn unseen_after(code: i32) {
    UNSEEN.set(Some(code));
}

/// What the disk says of `file` once the shell has had it.
fn metadata_after(file: &Path) -> io::Result<std::fs::Metadata> {
    #[cfg(test)]
    if let Some(code) = UNSEEN.get() {
        return Err(io::Error::from_raw_os_error(code));
    }
    std::fs::symlink_metadata(file)
}

/// Makes every file's names unreadable on this thread, as on a drive that cannot list them.
#[cfg(test)]
fn names_unreadable() {
    UNREADABLE.set(true);
}

/// Makes every second name fail on this thread with the disk's `code`, as on a drive without hard
/// links, or for a file another app holds.
#[cfg(test)]
pub(crate) fn links_fail(code: i32) {
    UNLINKABLE.set(Some(code));
}

/// Gives `file` the second name `hold`.
fn link(file: &Path, hold: &Path) -> io::Result<()> {
    #[cfg(test)]
    if let Some(code) = UNLINKABLE.get() {
        return Err(io::Error::from_raw_os_error(code));
    }
    std::fs::hard_link(file, hold)
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

/// `file` as the shell is handed it: in full, and verbatim only on a share, since the shell takes
/// no other verbatim path.
#[cfg(windows)]
fn shell_form(file: &Path) -> io::Result<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;

    let full = std::path::absolute(file)?;
    let mut form: Vec<u16> = full.as_os_str().encode_wide().collect();
    let wide = |text: &str| text.encode_utf16().collect::<Vec<u16>>();
    if form.starts_with(&wide(r"\\?\")) && !form.starts_with(&wide(r"\\?\UNC\")) {
        form.drain(..4);
    }
    Ok(form)
}

/// Whether `file`'s path is longer than the shell takes, MAX_PATH with its NUL.
#[cfg(windows)]
fn too_long_for_shell(file: &Path) -> bool {
    use windows_sys::Win32::Foundation::MAX_PATH;

    shell_form(file).is_ok_and(|form| form.len() >= MAX_PATH as usize)
}

#[cfg(not(windows))]
fn too_long_for_shell(_file: &Path) -> bool {
    false
}

/// The drive `path` is on, as Explorer names it, whatever its kind; its root when that cannot be
/// read.
pub fn drive_of(path: &Path) -> String {
    #[cfg(windows)]
    if let Some((root, kind)) = drive_at(path) {
        return drive_name(&root, kind, volume_label(&root));
    }
    path.ancestors()
        .last()
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

/// The root of the drive `path` is on, plain, and its kind, as `GetDriveTypeW` gives it.
#[cfg(windows)]
fn drive_at(path: &Path) -> Option<(PathBuf, u32)> {
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    let root = plain(&volume_of(path).ok()?);
    // SAFETY: the root is NUL-terminated and outlives the call.
    let kind = unsafe { GetDriveTypeW(wide(&root).as_ptr()) };
    Some((root, kind))
}

/// The bin the app's verbs send to and take back from: the shell's [`RecycleBin`], and under test
/// each test thread's own stand-in, so no test can reach the real one.
pub struct Shell;

#[cfg(not(test))]
impl Bin for Shell {
    fn take(&self, file: &Path) -> io::Result<Option<PathBuf>> {
        RecycleBin.take(file)
    }

    fn holds(&self, name: &Path) -> bool {
        RecycleBin.holds(name)
    }

    fn let_go(&self, binned: &Path) -> io::Result<()> {
        RecycleBin.let_go(binned)
    }

    fn binless(&self, path: &Path) -> Option<String> {
        RecycleBin.binless(path)
    }
}

#[cfg(test)]
impl Bin for Shell {
    fn take(&self, file: &Path) -> io::Result<Option<PathBuf>> {
        tests::stand_in().take(file)
    }

    fn holds(&self, name: &Path) -> bool {
        tests::stand_in().holds(name)
    }

    fn let_go(&self, binned: &Path) -> io::Result<()> {
        tests::stand_in().let_go(binned)
    }

    fn binless(&self, path: &Path) -> Option<String> {
        tests::stand_in().binless(path)
    }
}

/// The shell's own Recycle Bin.
pub struct RecycleBin;

#[cfg(windows)]
impl Bin for RecycleBin {
    fn take(&self, file: &Path) -> io::Result<Option<PathBuf>> {
        if cfg!(test) {
            panic!("{} was handed to the real Recycle Bin", file.display());
        }

        let mut from = shell_form(file)?;
        from.push(0);
        std::thread::Builder::new()
            .spawn(move || operation::recycle(&from))?
            .join()
            .map_err(|_| io::Error::other("the shell's thread stopped"))?
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

    /// Windows keeps a Recycle Bin on a fixed drive only: a removable one, a network share, a disc
    /// or a RAM disk has none. A drive whose kind cannot be read counts as having one.
    fn binless(&self, path: &Path) -> Option<String> {
        use windows_sys::Win32::System::WindowsProgramming::{
            DRIVE_CDROM, DRIVE_RAMDISK, DRIVE_REMOTE, DRIVE_REMOVABLE,
        };

        let (root, kind) = drive_at(path)?;
        matches!(
            kind,
            DRIVE_REMOVABLE | DRIVE_REMOTE | DRIVE_CDROM | DRIVE_RAMDISK
        )
        .then(|| drive_name(&root, kind, volume_label(&root)))
    }
}

/// The shell's `IFileOperation`, with a sink that answers [`Watch`]'s word on each callback.
#[cfg(windows)]
mod operation {
    use std::cell::RefCell;
    use std::io;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;

    use windows::Win32::Foundation::E_ABORT;
    use windows::Win32::System::Com::{
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE, CoCreateInstance,
        CoInitializeEx, CoTaskMemFree, CoUninitialize,
    };
    use windows::Win32::UI::Shell::{
        FOF_ALLOWUNDO, FOF_NO_UI, FOFX_RECYCLEONDELETE, FileOperation, IFileOperation,
        IFileOperationProgressSink, IFileOperationProgressSink_Impl, IShellItem,
        SHCreateItemFromParsingName, SIGDN_FILESYSPATH,
    };
    use windows_core::{ComObject, HRESULT, PCWSTR, Ref, implement};

    use super::Watch;

    #[implement(IFileOperationProgressSink)]
    struct Sink(RefCell<Watch>);

    /// Sends the one file `path` names, NUL-terminated, on a thread of its own: the operation needs
    /// a single-threaded apartment, which no other thread of the app is asked to be.
    pub(super) fn recycle(path: &[u16]) -> io::Result<Option<PathBuf>> {
        // SAFETY: this thread is the operation's own, so its apartment is set up here first and
        // torn down after every COM object made on it is gone.
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).ok()?;
            let done = perform(path);
            CoUninitialize();
            done
        }
    }

    fn perform(path: &[u16]) -> io::Result<Option<PathBuf>> {
        // SAFETY: `path` is NUL-terminated and outlives every call given it.
        unsafe {
            let op: IFileOperation = CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
            op.SetOperationFlags(FOF_ALLOWUNDO | FOF_NO_UI | FOFX_RECYCLEONDELETE)?;
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None)?;
            let sink = ComObject::new(Sink(RefCell::default()));
            op.DeleteItem(&item, &sink.to_interface::<IFileOperationProgressSink>())?;
            let performed = op.PerformOperations().map_err(io::Error::from);
            let aborted = op
                .GetAnyOperationsAborted()
                .map_or(true, |any| any.as_bool());
            sink.0.take().outcome(performed, aborted)
        }
    }

    /// Where `item` is on disk.
    fn path_of(item: &IShellItem) -> Option<PathBuf> {
        // SAFETY: the name the shell allocates is read once, then freed as it asks.
        unsafe {
            let name = item.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let path = std::ffi::OsString::from_wide(name.as_wide()).into();
            CoTaskMemFree(Some(name.0.cast_const().cast()));
            Some(path)
        }
    }

    impl IFileOperationProgressSink_Impl for Sink_Impl {
        fn PreDeleteItem(&self, flags: u32, _item: Ref<IShellItem>) -> windows_core::Result<()> {
            if self.0.borrow_mut().before_delete(flags) {
                Ok(())
            } else {
                Err(E_ABORT.into())
            }
        }

        fn PostDeleteItem(
            &self,
            _flags: u32,
            _item: Ref<IShellItem>,
            deleted: HRESULT,
            newly: Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            let placed = newly.as_ref().and_then(path_of);
            self.0.borrow_mut().after_delete(deleted.is_ok(), placed);
            Ok(())
        }

        fn StartOperations(&self) -> windows_core::Result<()> {
            Ok(())
        }

        fn FinishOperations(&self, _result: HRESULT) -> windows_core::Result<()> {
            Ok(())
        }

        fn PreRenameItem(
            &self,
            _flags: u32,
            _item: Ref<IShellItem>,
            _name: &PCWSTR,
        ) -> windows_core::Result<()> {
            Ok(())
        }

        fn PostRenameItem(
            &self,
            _flags: u32,
            _item: Ref<IShellItem>,
            _name: &PCWSTR,
            _result: HRESULT,
            _newly: Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            Ok(())
        }

        fn PreMoveItem(
            &self,
            _flags: u32,
            _item: Ref<IShellItem>,
            _folder: Ref<IShellItem>,
            _name: &PCWSTR,
        ) -> windows_core::Result<()> {
            Ok(())
        }

        fn PostMoveItem(
            &self,
            _flags: u32,
            _item: Ref<IShellItem>,
            _folder: Ref<IShellItem>,
            _name: &PCWSTR,
            _result: HRESULT,
            _newly: Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            Ok(())
        }

        fn PreCopyItem(
            &self,
            _flags: u32,
            _item: Ref<IShellItem>,
            _folder: Ref<IShellItem>,
            _name: &PCWSTR,
        ) -> windows_core::Result<()> {
            Ok(())
        }

        fn PostCopyItem(
            &self,
            _flags: u32,
            _item: Ref<IShellItem>,
            _folder: Ref<IShellItem>,
            _name: &PCWSTR,
            _result: HRESULT,
            _newly: Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            Ok(())
        }

        fn PreNewItem(
            &self,
            _flags: u32,
            _folder: Ref<IShellItem>,
            _name: &PCWSTR,
        ) -> windows_core::Result<()> {
            Ok(())
        }

        fn PostNewItem(
            &self,
            _flags: u32,
            _folder: Ref<IShellItem>,
            _name: &PCWSTR,
            _template: &PCWSTR,
            _attributes: u32,
            _result: HRESULT,
            _newly: Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            Ok(())
        }

        fn UpdateProgress(&self, _total: u32, _done: u32) -> windows_core::Result<()> {
            Ok(())
        }

        fn ResetTimer(&self) -> windows_core::Result<()> {
            Ok(())
        }

        fn PauseTimer(&self) -> windows_core::Result<()> {
            Ok(())
        }

        fn ResumeTimer(&self) -> windows_core::Result<()> {
            Ok(())
        }
    }
}

/// A drive as Explorer names it: its label and its letter, `USB Drive (E:)`, a share and its
/// server, `Photos (\\nas)`, or, unlabelled, by what kind of drive it is.
#[cfg(windows)]
fn drive_name(root: &Path, kind: u32, label: Option<String>) -> String {
    use windows_sys::Win32::System::WindowsProgramming::{
        DRIVE_CDROM, DRIVE_RAMDISK, DRIVE_REMOTE, DRIVE_REMOVABLE,
    };

    let text = root.to_string_lossy();
    let text = text.trim_end_matches('\\');
    if let Some(unc) = text.strip_prefix(r"\\") {
        let (server, share) = unc.split_once('\\').unwrap_or((unc, unc));
        return format!(r"{share} (\\{server})");
    }
    let label = label.filter(|label| !label.is_empty()).unwrap_or_else(|| {
        match kind {
            DRIVE_REMOVABLE => "USB Drive",
            DRIVE_REMOTE => "Network Drive",
            DRIVE_CDROM => "CD Drive",
            DRIVE_RAMDISK => "RAM Disk",
            _ => "Local Disk",
        }
        .to_owned()
    });
    format!("{label} ({text})")
}

/// The label a volume was given, when it can be read.
#[cfg(windows)]
fn volume_label(root: &Path) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::GetVolumeInformationW;

    let mut label = vec![0u16; 261];
    // SAFETY: the root is NUL-terminated, `label` is as long as the length the call is given, and
    // every other buffer is null with no length.
    let read = unsafe {
        GetVolumeInformationW(
            wide(root).as_ptr(),
            label.as_mut_ptr(),
            label.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    (read != 0).then(|| unwide(&label).to_string_lossy().into_owned())
}

#[cfg(not(windows))]
impl Bin for RecycleBin {
    fn take(&self, _file: &Path) -> io::Result<Option<PathBuf>> {
        Err(io::ErrorKind::Unsupported.into())
    }

    fn holds(&self, _name: &Path) -> bool {
        false
    }

    fn let_go(&self, _binned: &Path) -> io::Result<()> {
        Ok(())
    }

    fn binless(&self, _path: &Path) -> Option<String> {
        None
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
        /// Moves it as [`Stand::Recycles`] does, and the app stops before the shell returns.
        Stops(PathBuf),
        /// Moves it as [`Stand::Recycles`] does, and another file takes its name before the send
        /// returns.
        Occupied(PathBuf, RefCell<Option<PathBuf>>),
        /// Moves it as [`Stand::Recycles`] does, and says it gave it the second name instead.
        Misplaces(PathBuf, PathBuf),
    }

    pub(crate) struct Fake {
        pub(crate) stand: Stand,
        /// Names the shell deletes outright, saying it recycles them, whatever it does with the
        /// rest.
        pub(crate) deletes: Vec<String>,
        /// Names the shell says it cannot recycle, as for a file too large for the bin.
        pub(crate) unrecyclable: Vec<String>,
        pub(crate) asked: RefCell<Vec<PathBuf>>,
        /// Each name a file was taken back out of.
        pub(crate) let_go: RefCell<Vec<PathBuf>>,
        /// Folders standing for drives with no Recycle Bin, each with the drive's name.
        pub(crate) binless: Vec<(PathBuf, String)>,
    }

    impl Fake {
        pub(crate) fn new(stand: Stand) -> Fake {
            Fake {
                stand,
                deletes: Vec::new(),
                unrecyclable: Vec::new(),
                asked: RefCell::default(),
                let_go: RefCell::default(),
                binless: Vec::new(),
            }
        }

        /// The folder it recycles into, as a bin of its own.
        pub(crate) fn dir(&self) -> Option<&Path> {
            match &self.stand {
                Stand::Recycles(bin)
                | Stand::Relinks(bin)
                | Stand::Stops(bin)
                | Stand::Occupied(bin, _)
                | Stand::Misplaces(bin, _) => Some(bin),
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

    impl Fake {
        /// What the stand does with a file the shell goes on to delete, and the name it says it
        /// gave it in the bin.
        fn act(&self, file: &Path) -> io::Result<Option<PathBuf>> {
            let name = file.file_name().unwrap_or_default().to_string_lossy();
            if self.deletes.iter().any(|one| name.contains(one.as_str())) {
                return std::fs::remove_file(file).map(|()| None);
            }
            let recycle = |bin: &Path| -> io::Result<PathBuf> {
                std::fs::create_dir_all(bin)?;
                let at = binned_name(bin, file);
                std::fs::rename(file, &at)?;
                Ok(at)
            };
            match &self.stand {
                Stand::Recycles(bin) => recycle(bin).map(Some),
                Stand::Deletes => std::fs::remove_file(file).map(|()| None),
                Stand::Fails => Err(io::Error::other("refused")),
                Stand::Relinks(bin) => {
                    std::fs::create_dir_all(bin)?;
                    let name = file.file_name().unwrap_or_default();
                    std::fs::rename(file, bin.join(name))?;
                    std::fs::hard_link(bin.join(name), bin.join("another"))?;
                    Ok(Some(bin.join(name)))
                }
                Stand::DeletesWhileLinked(outside) => {
                    std::fs::remove_file(file)?;
                    std::fs::hard_link(hold_of(file), outside).map(|()| None)
                }
                Stand::Stops(bin) => {
                    recycle(bin)?;
                    panic!("the app stopped");
                }
                Stand::Occupied(bin, taken) => {
                    let at = recycle(bin)?;
                    *taken.borrow_mut() = Some(file.to_path_buf());
                    Ok(Some(at))
                }
                Stand::Misplaces(bin, said) => {
                    recycle(bin)?;
                    Ok(Some(said.clone()))
                }
            }
        }
    }

    impl Bin for Fake {
        /// Asks the app's own [`Watch`] before the stand acts, as the shell asks the sink, with
        /// the flags the shell would give a file it can recycle or one it cannot.
        fn take(&self, file: &Path) -> io::Result<Option<PathBuf>> {
            self.asked.borrow_mut().push(file.to_path_buf());
            let name = file.file_name().unwrap_or_default().to_string_lossy();
            let recyclable = !self
                .unrecyclable
                .iter()
                .any(|one| name.contains(one.as_str()));
            let mut watch = Watch::default();
            if !watch.before_delete(if recyclable { RECYCLES } else { 0 }) {
                return watch.outcome(Ok(()), true);
            }
            let done = self.act(file);
            let newly = done.as_ref().ok().cloned().flatten();
            watch.after_delete(done.is_ok(), newly);
            watch.outcome(done.map(|_| ()), false)
        }

        fn holds(&self, name: &Path) -> bool {
            if let Stand::Occupied(_, taken) = &self.stand
                && let Some(file) = taken.borrow_mut().take()
            {
                std::fs::write(file, "theirs").unwrap();
            }
            let Some(bin) = self.dir() else {
                return false;
            };
            plain_lower(name).starts_with(plain_lower(bin))
        }

        fn let_go(&self, binned: &Path) -> io::Result<()> {
            self.let_go.borrow_mut().push(binned.to_path_buf());
            Ok(())
        }

        fn binless(&self, path: &Path) -> Option<String> {
            self.binless
                .iter()
                .find(|(drive, _)| plain_lower(path).starts_with(plain_lower(drive)))
                .map(|(_, name)| name.clone())
        }
    }

    /// A path as the stand-in compares it: plain, and in lower case.
    fn plain_lower(path: &Path) -> PathBuf {
        let text = path.to_string_lossy().to_lowercase();
        PathBuf::from(text.strip_prefix(r"\\?\").unwrap_or(&text))
    }

    /// A send with nothing to mark, its second name let go as soon as the bin has the file.
    fn send(bin: &dyn Bin, file: &Path) -> io::Result<Sent> {
        let sent = super::send(bin, file, |_, _| Ok(()))?;
        if let Sent::Recycled(binned) = &sent {
            release(file, &binned.file)?;
        }
        Ok(sent)
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

    /// How long `path` is as the shell counts it, in UTF-16 units.
    #[cfg(windows)]
    fn units(path: &Path) -> usize {
        use std::os::windows::ffi::OsStrExt;
        path.as_os_str().encode_wide().count()
    }

    #[cfg(windows)]
    #[test]
    fn a_file_whose_second_name_is_past_max_path_is_still_recycled() {
        let dir = scratch("long");
        let trash = dir.join("trash");
        let room = 255 - units(&trash);
        let file = trash.join(format!("{}.jpg", "a".repeat(room - 5)));
        assert!(units(&file) < 260 && units(&hold_of(&file)) >= 260);
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

        assert_eq!(send(&bin, &file).unwrap(), Sent::Unheld(None));
        assert!(bin.asked.borrow().is_empty());
        settles_to(&dir.join("trash"), &["one.jpg"]);
        assert_eq!(identity(&file).unwrap().links, 2);
        assert!(!dir.join("bin").exists());
    }

    #[test]
    fn a_file_that_cannot_be_given_a_second_name_is_never_handed_to_the_shell_and_says_why() {
        let dir = scratch("unlinkable");
        let file = one_with_names(&dir, 0);
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));
        links_fail(87);

        assert_eq!(send(&bin, &file).unwrap(), Sent::Unheld(Some(87)));
        assert!(bin.asked.borrow().is_empty());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
        settles_to(&dir.join("trash"), &["one.jpg"]);
        assert_eq!(identity(&file).unwrap().links, 1);
    }

    #[test]
    fn a_file_gone_before_its_second_name_is_made_counts_as_gone() {
        let dir = scratch("unlinkable-gone");
        let file = one_with_names(&dir, 0);
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));
        links_fail(2);

        assert_eq!(send(&bin, &file).unwrap(), Sent::Gone);
        assert!(bin.asked.borrow().is_empty());
    }

    /// What the disk says of a second name on a drive without hard links, and of one past the
    /// names NTFS allows a file.
    #[cfg(windows)]
    const NO_SECOND_NAME: [i32; 3] = [1, 50, 1142];

    #[cfg(windows)]
    #[test]
    fn a_file_that_can_never_have_a_second_name_is_recycled_where_the_shell_says() {
        for code in NO_SECOND_NAME {
            let dir = scratch(&format!("linkless-{code}"));
            let file = one_with_names(&dir, 0);
            let bin = Fake::new(Stand::Recycles(dir.join("bin")));
            links_fail(code);

            let recycled = dir.join("bin/one.jpg");
            assert_eq!(
                send(&bin, &file).unwrap(),
                Sent::Recycled(Binned {
                    path: recycled.clone(),
                    file: file_at(&recycled).unwrap(),
                }),
                "{code}"
            );
            assert_eq!(bin.asked.borrow().as_slice(), std::slice::from_ref(&file));
            assert_eq!(std::fs::read_to_string(&recycled).unwrap(), "one");
            settles_to(&dir.join("trash"), &[]);
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_file_the_shell_says_it_cannot_recycle_is_never_deleted_on_any_drive() {
        for code in [None, Some(1), Some(1142)] {
            let at = code.map_or("linked".to_owned(), |code| code.to_string());
            let dir = scratch(&format!("unrecyclable-{at}"));
            let file = one_with_names(&dir, 1);
            let mut bin = Fake::new(Stand::Deletes);
            bin.unrecyclable.push("one".into());
            if let Some(code) = code {
                links_fail(code);
            }

            assert_eq!(send(&bin, &file).unwrap(), Sent::Refused, "{at}");
            assert_eq!(bin.asked.borrow().as_slice(), std::slice::from_ref(&file));
            assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
            settles_to(&dir.join("trash"), &["one.jpg"]);
            assert_eq!(identity(&file).unwrap().links, 2);

            assert_eq!(
                send(&Fake::new(Stand::Fails), &file).unwrap(),
                Sent::Refused
            );
            settles_to(&dir.join("trash"), &["one.jpg"]);
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_file_without_a_second_name_is_never_recorded_under_a_name_that_is_not_it() {
        let dir = scratch("linkless-untraced");
        let file = dir.join("trash/one.jpg");
        links_fail(1);

        std::fs::write(&file, "one").unwrap();
        assert_eq!(
            send(&Fake::new(Stand::Deletes), &file).unwrap(),
            Sent::Untraced
        );

        std::fs::create_dir_all(dir.join("bin")).unwrap();
        let other = dir.join("bin/$Rother.jpg");
        std::fs::write(&other, "another").unwrap();
        let outside = dir.join("outside.jpg");
        for said in [other.clone(), outside.clone()] {
            std::fs::write(&file, "one").unwrap();
            std::fs::copy(&file, &outside).unwrap();
            let bin = Fake::new(Stand::Misplaces(dir.join("bin"), said));
            assert_eq!(send(&bin, &file).unwrap(), Sent::Untraced);
        }
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "another");
        settles_to(&dir.join("bin"), &["$R1-one.jpg", "$Rother.jpg", "one.jpg"]);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_without_a_second_name_the_disk_cannot_answer_for_is_refused_not_gone() {
        const NOT_READY: i32 = 21;
        for code in [NOT_READY, 32] {
            let dir = scratch(&format!("linkless-unseen-{code}"));
            let file = one_with_names(&dir, 0);
            links_fail(1);
            unseen_after(code);

            assert_eq!(
                send(&Fake::new(Stand::Fails), &file).unwrap(),
                Sent::Refused,
                "{code}"
            );
            assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
        }
    }

    #[test]
    fn with_a_second_name_the_name_the_shell_says_it_gave_is_never_the_one_recorded() {
        let dir = scratch("linked-misplaced");
        let file = one_with_names(&dir, 0);
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        let other = dir.join("bin/$Rother.jpg");
        std::fs::write(&other, "one").unwrap();
        let bin = Fake::new(Stand::Misplaces(dir.join("bin"), other.clone()));

        let recycled = dir.join("bin/one.jpg");
        assert_eq!(
            send(&bin, &file).unwrap(),
            Sent::Recycled(Binned {
                path: recycled.clone(),
                file: file_at(&recycled).unwrap(),
            })
        );
        assert_ne!(file_at(&other), file_at(&recycled));
        settles_to(&dir.join("trash"), &[]);
    }

    #[test]
    fn the_sink_lets_the_shell_delete_only_into_the_bin() {
        let others = 0x1 | 0x400 | 0x2000;
        for (flags, recycles) in [
            (RECYCLES, true),
            (RECYCLES | others, true),
            (0, false),
            (others, false),
        ] {
            let mut watch = Watch::default();
            assert_eq!(watch.before_delete(flags), recycles, "{flags:#x}");
            watch.after_delete(true, Some(PathBuf::from("bin/$R1.jpg")));
            let outcome = watch.outcome(Ok(()), !recycles);
            assert_eq!(
                outcome.ok(),
                recycles.then(|| Some(PathBuf::from("bin/$R1.jpg"))),
                "{flags:#x}"
            );
        }
    }

    #[test]
    fn the_sink_says_where_the_file_went_only_when_the_shell_asked_first_and_it_went() {
        let bin = || Some(PathBuf::from("bin/$R1.jpg"));
        let asked = |deleted, newly: Option<PathBuf>| {
            let mut watch = Watch::default();
            assert!(watch.before_delete(RECYCLES));
            watch.after_delete(deleted, newly);
            watch
        };
        let went = |watch: Watch| watch.outcome(Ok(()), false).unwrap();
        assert_eq!(went(asked(true, bin())), bin());
        assert_eq!(went(asked(true, None)), None);
        assert_eq!(went(asked(false, bin())), None);
        assert!(asked(true, bin()).outcome(Ok(()), true).is_err());
        let failed = Err(io::Error::other("failed"));
        assert!(asked(true, bin()).outcome(failed, false).is_err());

        let mut unasked = Watch::default();
        unasked.after_delete(true, bin());
        assert!(unasked.outcome(Ok(()), false).is_err());

        let mut stopped = Watch::default();
        assert!(!stopped.before_delete(0));
        stopped.after_delete(true, bin());
        assert!(stopped.outcome(Ok(()), false).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn the_sink_reads_the_flag_the_shell_sets() {
        use windows::Win32::UI::Shell::TSF_DELETE_RECYCLE_IF_POSSIBLE;
        assert_eq!(RECYCLES, TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_whose_path_is_past_max_path_is_never_handed_to_the_shell_and_is_too_long() {
        let dir = scratch("too-long");
        let trash = dir.join("trash");
        for (room, sent) in [(259, None), (260, Some(Sent::TooLong))] {
            let name = format!("{}.jpg", "a".repeat(room - units(&trash) - 5));
            let file = trash.join(&name);
            assert_eq!(units(&file), room);
            std::fs::write(&file, "one").unwrap();
            let bin = Fake::new(Stand::Recycles(dir.join("bin")));

            let got = send(&bin, &file).unwrap();

            if let Some(sent) = sent {
                assert_eq!(got, sent);
                assert!(bin.asked.borrow().is_empty());
                assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
                settles_to(&trash, &[name.as_str()]);
                assert_eq!(identity(&file).unwrap().links, 1);
            } else {
                assert!(recycled(got), "{room}");
                settles_to(&trash, &[]);
            }
        }
    }

    #[cfg(windows)]
    #[test]
    fn any_drive_is_named_as_explorer_names_it() {
        let dir = scratch("drive-of");
        let root = volume_of(&dir).unwrap();
        let letter = plain(&root)
            .to_string_lossy()
            .trim_end_matches('\\')
            .to_owned();

        let named = drive_of(&dir.join("trash/one.jpg"));

        assert!(named.ends_with(&format!(" ({letter})")), "{named}");
        assert_eq!(drive_of(&dir), named);
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
    fn a_recycled_file_keeps_its_second_name_until_its_send_is_released() {
        let dir = scratch("kept");
        let file = one_with_names(&dir, 0);
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));
        let told = RefCell::new(None);

        let Sent::Recycled(binned) = super::send(&bin, &file, |itself, before| {
            *told.borrow_mut() = Some((itself.to_owned(), before.to_vec()));
            Ok(())
        })
        .unwrap() else {
            panic!("not recycled");
        };
        let (itself, before) = told.into_inner().unwrap();
        assert_eq!(itself, binned.file);
        assert_eq!(before.len(), 2);
        settles_to(&dir.join("trash"), &[".one.jpg.recycling"]);

        release(&file, &binned.file).unwrap();
        settles_to(&dir.join("trash"), &[]);
        assert_eq!(identity(&binned.path).unwrap().links, 1);
    }

    #[test]
    fn a_send_whose_names_cannot_be_kept_never_asks_the_shell() {
        let dir = scratch("unkept");
        let file = one_with_names(&dir, 0);
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));

        let sent = super::send(&bin, &file, |_, _| Err(io::Error::other("no room")));
        assert!(sent.is_err());
        assert!(bin.asked.borrow().is_empty());
        settles_to(&dir.join("trash"), &["one.jpg"]);
        assert_eq!(identity(&file).unwrap().links, 1);
    }

    /// `trash/one.jpg` held under its second name, with every name it has then.
    fn one_held(dir: &Path) -> (PathBuf, String, Vec<PathBuf>) {
        let file = dir.join("trash/one.jpg");
        std::fs::hard_link(&file, hold_of(&file)).unwrap();
        let before = names_of(&hold_of(&file)).unwrap();
        (file.clone(), identity(&file).unwrap().key(), before)
    }

    #[test]
    fn a_send_cut_short_once_the_bin_took_the_file_finds_it_by_the_name_it_gained_there() {
        let dir = scratch("cut-after-take");
        std::fs::write(dir.join("trash/one.jpg"), "one").unwrap();
        let (file, itself, before) = one_held(&dir);
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));
        assert!(found_in_bin(&bin, &file, &itself, &before).is_none());

        bin.take(&file).unwrap();

        let found = found_in_bin(&bin, &file, &itself, &before).unwrap();
        assert_eq!(found.path, dir.join("bin/one.jpg"));
        assert_eq!(found.file, itself);
        assert!(found_in_bin(&bin, &file, "another", &before).is_none());
        std::fs::write(&file, "theirs").unwrap();
        assert_eq!(found_in_bin(&bin, &file, &itself, &before), Some(found));
        std::fs::remove_file(&file).unwrap();
        release(&file, &itself).unwrap();
        settles_to(&dir.join("trash"), &[]);
    }

    #[test]
    fn a_send_cut_short_finds_nothing_by_a_name_the_file_had_in_the_bin_before() {
        let dir = scratch("cut-in-bin-already");
        std::fs::write(dir.join("trash/one.jpg"), "one").unwrap();
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        std::fs::hard_link(dir.join("trash/one.jpg"), dir.join("bin/$Rold.jpg")).unwrap();
        let (file, itself, before) = one_held(&dir);
        let bin = Fake::new(Stand::Deletes);
        bin.take(&file).unwrap();

        let looked = Fake::new(Stand::Recycles(dir.join("bin")));
        assert!(found_in_bin(&looked, &file, &itself, &before).is_none());
        settle_beside(&file).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
        settles_to(&dir.join("trash"), &["one.jpg"]);
    }

    #[test]
    fn releasing_a_second_name_that_is_the_last_of_its_file_puts_it_back() {
        let dir = scratch("release-lone");
        std::fs::write(dir.join("trash/one.jpg"), "one").unwrap();
        let (file, itself, _) = one_held(&dir);
        std::fs::remove_file(&file).unwrap();

        release(&file, &itself).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "one");
        settles_to(&dir.join("trash"), &["one.jpg"]);
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

    #[cfg(windows)]
    #[test]
    fn a_fixed_drive_has_a_recycle_bin_and_one_without_is_named_as_explorer_names_it() {
        use windows_sys::Win32::System::WindowsProgramming::{DRIVE_REMOTE, DRIVE_REMOVABLE};

        let dir = scratch("drive");
        assert_eq!(RecycleBin.binless(&dir.join("trash/one.jpg")), None);

        let stick = Path::new(r"E:\");
        assert_eq!(
            drive_name(stick, DRIVE_REMOVABLE, Some("HOLIDAY".into())),
            "HOLIDAY (E:)"
        );
        assert_eq!(
            drive_name(stick, DRIVE_REMOVABLE, Some(String::new())),
            "USB Drive (E:)"
        );
        assert_eq!(drive_name(stick, DRIVE_REMOVABLE, None), "USB Drive (E:)");
        assert_eq!(
            drive_name(Path::new(r"Z:\"), DRIVE_REMOTE, None),
            "Network Drive (Z:)"
        );
        assert_eq!(
            drive_name(Path::new(r"\\nas\Photos\"), DRIVE_REMOTE, Some("x".into())),
            r"Photos (\\nas)"
        );
    }

    /// `trash/one.jpg`, with `others` more names elsewhere, sent into `bin/` beside it.
    fn binned_one(dir: &Path, others: u32) -> (Fake, Binned) {
        let file = one_with_names(dir, others);
        let bin = Fake::new(Stand::Recycles(dir.join("bin")));
        let Sent::Recycled(binned) = send(&bin, &file).unwrap() else {
            panic!("not recycled");
        };
        (bin, binned)
    }

    #[test]
    fn a_purge_deletes_the_bins_name_for_the_file_and_its_record_and_its_other_names_stay() {
        let dir = scratch("purge");
        let (bin, binned) = binned_one(&dir, 1);

        purge(&bin, &binned.path, &binned.file).unwrap();

        assert!(std::fs::symlink_metadata(&binned.path).is_err());
        settles_to(&dir.join("bin"), &[]);
        assert_eq!(bin.let_go.borrow().as_slice(), [binned.path]);
        let elsewhere = dir.join("elsewhere/0.jpg");
        assert_eq!(std::fs::read_to_string(&elsewhere).unwrap(), "one");
        assert_eq!(identity(&elsewhere).unwrap().links, 1);
    }

    #[test]
    fn a_purge_never_deletes_a_name_outside_the_bin_even_of_the_file_itself() {
        let dir = scratch("purge-outside");
        let (bin, binned) = binned_one(&dir, 1);
        let elsewhere = dir.join("elsewhere/0.jpg");

        assert!(purge(&bin, &elsewhere, &binned.file).is_err());

        assert_eq!(std::fs::read_to_string(&elsewhere).unwrap(), "one");
        assert_eq!(std::fs::read_to_string(&binned.path).unwrap(), "one");
        assert!(bin.let_go.borrow().is_empty());
    }

    #[test]
    fn a_purge_never_deletes_another_file_that_took_the_bins_name() {
        let dir = scratch("purge-another");
        let (bin, binned) = binned_one(&dir, 0);
        std::fs::remove_file(&binned.path).unwrap();
        std::fs::write(&binned.path, "another").unwrap();

        assert!(purge(&bin, &binned.path, &binned.file).is_err());

        assert_eq!(std::fs::read_to_string(&binned.path).unwrap(), "another");
        assert!(bin.let_go.borrow().is_empty());
    }

    #[test]
    fn a_purge_never_removes_a_directory_at_the_bins_name() {
        let dir = scratch("purge-directory");
        let (bin, binned) = binned_one(&dir, 0);
        std::fs::remove_file(&binned.path).unwrap();
        std::fs::create_dir(&binned.path).unwrap();
        std::fs::write(binned.path.join("inside.txt"), "inside").unwrap();

        assert!(purge(&bin, &binned.path, &binned.file).is_err());

        assert!(binned.path.join("inside.txt").is_file());
    }

    #[test]
    fn a_read_only_file_in_the_bin_is_purged_all_the_same() {
        let dir = scratch("purge-read-only");
        let (bin, binned) = binned_one(&dir, 0);
        let mut permissions = std::fs::metadata(&binned.path).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&binned.path, permissions).unwrap();

        purge(&bin, &binned.path, &binned.file).unwrap();

        settles_to(&dir.join("bin"), &[]);
    }

    #[cfg(windows)]
    #[test]
    fn a_file_in_the_bin_another_app_has_open_is_not_purged_and_stays_whole() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = scratch("purge-in-use");
        let (bin, binned) = binned_one(&dir, 0);
        let open = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&binned.path)
            .unwrap();

        let refused = purge(&bin, &binned.path, &binned.file);
        drop(open);

        assert!(refused.is_err());
        assert_eq!(std::fs::read_to_string(&binned.path).unwrap(), "one");
        assert!(bin.let_go.borrow().is_empty());
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
