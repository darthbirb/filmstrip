//! Moving a file or a whole directory to where the index says it now belongs. On one drive that
//! is a rename; between drives it is a copy, checked, and only then the original's removal, so a
//! move cut short leaves the original where it was. DECISIONS.md "Undo".

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};
use crate::fs::paste::Halt;
use crate::fs::{flush, noclobber, take_away, take_away_once};

/// Windows' ERROR_NOT_SAME_DEVICE: a rename cannot cross from one drive to another.
const NOT_SAME_DEVICE: i32 = 17;

/// What long disk work answers to while it runs: being stopped, and saying how far it has got.
pub trait Control {
    fn halt(&self) -> Option<Halt>;
    fn progress(&self, done: u32, whole: u32);
}

/// Work run inside a command, which nothing stops and nobody watches.
pub struct Unwatched;

impl Control for Unwatched {
    fn halt(&self) -> Option<Halt> {
        None
    }
    fn progress(&self, _done: u32, _whole: u32) {}
}

/// Work a test watches: never stopped, each count handed to `0`.
#[cfg(test)]
pub(crate) struct Hearing<F: Fn(u32, u32)>(pub F);

#[cfg(test)]
impl<F: Fn(u32, u32)> Control for Hearing<F> {
    fn halt(&self) -> Option<Halt> {
        None
    }
    fn progress(&self, done: u32, whole: u32) {
        (self.0)(done, whole);
    }
}

/// Work a test stops with `halt` once `after` of its files are settled, hearing each count.
#[cfg(test)]
pub(crate) struct HaltAfter {
    pub after: u32,
    pub halt: Halt,
    pub heard: std::cell::RefCell<Vec<(u32, u32)>>,
}

#[cfg(test)]
impl HaltAfter {
    pub(crate) fn new(after: u32, halt: Halt) -> HaltAfter {
        HaltAfter {
            after,
            halt,
            heard: std::cell::RefCell::new(Vec::new()),
        }
    }
}

#[cfg(test)]
impl Control for HaltAfter {
    fn halt(&self) -> Option<Halt> {
        let done = self.heard.borrow().last().map_or(0, |(done, _)| *done);
        (done >= self.after).then_some(self.halt)
    }
    fn progress(&self, done: u32, whole: u32) {
        self.heard.borrow_mut().push((done, whole));
    }
}

/// Moves `from` to `to`, refused with `AlreadyExists` when anything has that name, however late
/// it came.
pub fn relocate(from: &Path, to: &Path) -> Result<()> {
    relocate_watched(from, to, &Unwatched).map(|_| ())
}

/// `relocate`, answering to `control` between the files a move between drives copies, and to
/// Stop within the one in hand. Stopped, it takes away what it copied and leaves `from` whole, and
/// says why it stopped.
pub fn relocate_watched(from: &Path, to: &Path, control: &impl Control) -> Result<Option<Halt>> {
    match noclobber::rename(from, to) {
        Ok(()) => Ok(None),
        Err(err)
            if err.kind() == std::io::ErrorKind::CrossesDevices
                || err.raw_os_error() == Some(NOT_SAME_DEVICE) =>
        {
            copy_across_watched(from, to, control)
        }
        Err(err) => Err(err.into()),
    }
}

/// Whether a move from `from` into `dir` is a copy between drives, judged by the drive or share
/// each path names. A drive mounted in a folder is judged the drive around it, and then copies as
/// any move between drives does, inside the act that asked for it.
pub fn crosses_drives(from: &Path, dir: &Path) -> bool {
    drive_of(from) != drive_of(dir)
}

fn drive_of(path: &Path) -> Option<String> {
    use std::path::{Component, Prefix};
    match path.components().next()? {
        Component::Prefix(prefix) => Some(match prefix.kind() {
            Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
                char::from(letter).to_ascii_lowercase().to_string()
            }
            Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => format!(
                "//{}/{}",
                server.to_string_lossy().to_lowercase(),
                share.to_string_lossy().to_lowercase()
            ),
            _ => prefix.as_os_str().to_string_lossy().to_lowercase(),
        }),
        _ => None,
    }
}

/// Turns a refusal of a name already taken into `taken`, for a caller that can say where.
pub fn taken_as(taken: impl FnOnce() -> AppError) -> impl FnOnce(AppError) -> AppError {
    |err| match &err {
        AppError::Io(io) if io.kind() == std::io::ErrorKind::AlreadyExists => taken(),
        _ => err,
    }
}

/// The move between drives: copied under a hidden part name, each copy checked and flushed, then
/// given its name, and only then any original removed. Any failure removes what the copy wrote,
/// and only that, and keeps the original whole.
#[cfg(test)]
pub(crate) fn copy_across(from: &Path, to: &Path) -> Result<()> {
    copy_across_watched(from, to, &Unwatched).map(|_| ())
}

/// The move between drives, stopped before a file when `control` says so, as a failure is, and
/// within the file in hand when the app is closing. A part a stopped or cut-short copy of `from`
/// left is cleared first.
pub(crate) fn copy_across_watched(
    from: &Path,
    to: &Path,
    control: &impl Control,
) -> Result<Option<Halt>> {
    if std::fs::symlink_metadata(to).is_ok() {
        return Err(std::io::Error::from(std::io::ErrorKind::AlreadyExists).into());
    }
    let part = part_beside(to);
    clear_part(from, &part);
    let mut copy = Across {
        made: Vec::new(),
        control,
    };
    let mut copied = copy.copy(from, &part, from.is_dir());
    if matches!(copied, Ok(None)) {
        copied = noclobber::rename(&part, to)
            .map(|()| None)
            .map_err(AppError::from);
    }
    if !matches!(copied, Ok(None)) {
        remove_deepest_first(copy.made.iter().map(|(_, copy)| copy.as_path()));
        return copied;
    }
    // The copy is whole, so the move has happened and the index follows it; an original that will
    // not go, or anything that arrived in it since it was read, is left for the next walk.
    remove_deepest_first(copy.made.iter().map(|(original, _)| original.as_path()));
    Ok(None)
}

/// Hidden, so a walk passes it over; named after `to`, so a copy that goes on after a restart
/// finds what it left.
fn part_beside(to: &Path) -> PathBuf {
    let name = to.file_name().unwrap_or_default().to_string_lossy();
    let kept: String = name.chars().take(PART_NAME_KEPT).collect();
    to.with_file_name(format!(".{kept}.filmstrip-part"))
}

/// Within a file name's 255, with room for the part's own dot and suffix.
const PART_NAME_KEPT: usize = 200;

/// Takes away the part a move of `from` to `to` that a crash cut short left, for a move that will
/// not run again.
pub fn clear_part_of(from: &Path, to: &Path) {
    clear_part(from, &part_beside(to));
}

/// Takes away a part of `from` that a copy the app's closing or a crash cut short left: each file
/// and folder in it that mirrors one in `from`, deepest first, folders once empty. It walks the
/// part itself and never follows nor removes a link there, so nothing outside the part can go.
fn clear_part(from: &Path, part: &Path) {
    let mut stayed_in: HashSet<PathBuf> = HashSet::new();
    let walk = walkdir::WalkDir::new(part)
        .follow_root_links(false)
        .contents_first(true);
    for entry in walk {
        let entry = match entry {
            Ok(entry) => entry,
            Err(err) => {
                if let Some(parent) = err.path().and_then(Path::parent) {
                    stayed_in.insert(parent.to_path_buf());
                }
                continue;
            }
        };
        let path = entry.path();
        let there = match path.strip_prefix(part) {
            Ok(rel) if !rel.as_os_str().is_empty() => from.join(rel),
            _ => from.to_path_buf(),
        };
        let kind = entry.file_type();
        let removed = if kind.is_file() && there.is_file() {
            std::fs::remove_file(path)
        } else if kind.is_dir() && there.is_dir() {
            if stayed_in.contains(path) {
                take_away_once(path)
            } else {
                take_away(path)
            }
        } else {
            Err(std::io::ErrorKind::Other.into())
        };
        if removed.is_err()
            && let Some(parent) = path.parent()
        {
            stayed_in.insert(parent.to_path_buf());
        }
    }
}

/// Removes what `made` lists, each directory listed before what is in it, as far as it will go. A
/// directory around one where something stayed is tried once, not given the time a passing file is.
fn remove_deepest_first<'a>(made: impl DoubleEndedIterator<Item = &'a Path>) {
    let mut stayed_in = HashSet::new();
    for path in made.rev() {
        let removed = if !path.is_dir() {
            std::fs::remove_file(path)
        } else if stayed_in.contains(path) {
            take_away_once(path)
        } else {
            take_away(path)
        };
        if removed.is_err()
            && let Some(parent) = path.parent()
        {
            stayed_in.insert(parent);
        }
    }
}

/// A copy between drives as it goes: each pair it wrote.
struct Across<'a, C: Control> {
    made: Vec<(PathBuf, PathBuf)>,
    control: &'a C,
}

impl<C: Control> Across<'_, C> {
    /// Copies `from` to `to`, never onto anything there, recording each pair it wrote; stopped
    /// before the next file once `control` says so, or within this one as the app closes.
    fn copy(&mut self, from: &Path, to: &Path, is_dir: bool) -> Result<Option<Halt>> {
        if let Some(halt) = self.control.halt() {
            return Ok(Some(halt));
        }
        if is_dir {
            std::fs::create_dir(to)?;
            self.made.push((from.to_path_buf(), to.to_path_buf()));
            for entry in std::fs::read_dir(from)? {
                let entry = entry?;
                let is_dir = entry.file_type()?.is_dir();
                if let Some(halt) = self.copy(&entry.path(), &to.join(entry.file_name()), is_dir)? {
                    return Ok(Some(halt));
                }
            }
            return Ok(None);
        }
        let control = self.control;
        if !noclobber::copy_unless(from, to, &|| control.halt() == Some(Halt::Stop))? {
            let _ = std::fs::remove_file(to);
            return Ok(Some(Halt::Stop));
        }
        self.made.push((from.to_path_buf(), to.to_path_buf()));
        if std::fs::metadata(to)?.len() != std::fs::metadata(from)?.len() {
            return Err(AppError::invalid(format!(
                "{} did not copy whole",
                from.display()
            )));
        }
        flush_copy(to)?;
        Ok(None)
    }
}

/// Writes a copy through to its drive. A read-only copy cannot be opened to write, so it gives up
/// the attribute for the flush and takes it back after.
fn flush_copy(copy: &Path) -> Result<()> {
    let mut permissions = std::fs::metadata(copy)?.permissions();
    let read_only = permissions.readonly();
    if read_only {
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(copy, permissions.clone())?;
    }
    let flushed = std::fs::OpenOptions::new()
        .write(true)
        .open(copy)
        .and_then(|file| flush(&file, copy));
    if read_only {
        permissions.set_readonly(true);
        std::fs::set_permissions(copy, permissions)?;
    }
    Ok(flushed?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs::settles_to;
    use std::cell::{Cell, RefCell};
    use std::path::PathBuf;
    use std::rc::Rc;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-relocate")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_move_onto_something_already_there_is_refused_and_both_stay() {
        let dir = scratch("refused");
        std::fs::write(dir.join("a.jpg"), "a").unwrap();
        std::fs::write(dir.join("b.jpg"), "b").unwrap();
        assert!(relocate(&dir.join("a.jpg"), &dir.join("b.jpg")).is_err());
        assert_eq!(std::fs::read_to_string(dir.join("b.jpg")).unwrap(), "b");
        assert!(dir.join("a.jpg").is_file());
    }

    #[test]
    fn a_move_onto_a_name_that_appeared_just_before_it_is_refused_and_both_stay() {
        let dir = scratch("late");
        std::fs::write(dir.join("a.jpg"), "a").unwrap();
        noclobber::just_before_the_next(|to| std::fs::write(to, "theirs").unwrap());
        let err = relocate(&dir.join("a.jpg"), &dir.join("b.jpg")).unwrap_err();
        assert!(matches!(&err, AppError::Io(io) if io.kind() == std::io::ErrorKind::AlreadyExists));
        assert_eq!(
            std::fs::read_to_string(dir.join("b.jpg")).unwrap(),
            "theirs"
        );
        assert_eq!(std::fs::read_to_string(dir.join("a.jpg")).unwrap(), "a");
    }

    #[test]
    fn a_copy_across_onto_a_file_that_appeared_just_before_it_is_refused_and_both_stay() {
        let dir = scratch("late-copy");
        std::fs::write(dir.join("a.jpg"), "a").unwrap();
        noclobber::just_before_the_next(|to| std::fs::write(to, "theirs").unwrap());
        assert!(copy_across(&dir.join("a.jpg"), &dir.join("b.jpg")).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("b.jpg")).unwrap(),
            "theirs"
        );
        assert_eq!(std::fs::read_to_string(dir.join("a.jpg")).unwrap(), "a");
    }

    #[test]
    fn a_copy_across_onto_a_folder_that_appeared_just_before_it_leaves_theirs_whole() {
        let dir = scratch("late-tree");
        std::fs::create_dir_all(dir.join("from/Cairo")).unwrap();
        std::fs::write(dir.join("from/Cairo/pyramid.jpg"), "pyramid").unwrap();
        noclobber::just_before_the_next(|to| {
            std::fs::create_dir(to).unwrap();
            std::fs::write(to.join("theirs.jpg"), "theirs").unwrap();
        });

        assert!(copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/theirs.jpg")).unwrap(),
            "theirs"
        );
        assert!(!dir.join("Cairo/pyramid.jpg").exists());
        assert!(dir.join("from/Cairo/pyramid.jpg").is_file());
    }

    #[test]
    fn a_copy_across_given_up_keeps_what_others_put_in_the_folders_it_made() {
        let dir = scratch("given-up");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();
        let part = dir.join(".Cairo.filmstrip-part");
        noclobber::just_before_the_next(move |to| {
            std::fs::write(part.join("theirs.jpg"), "theirs").unwrap();
            std::fs::write(to, "their Cairo").unwrap();
        });

        assert!(copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join(".Cairo.filmstrip-part/theirs.jpg")).unwrap(),
            "theirs"
        );
        assert!(!dir.join(".Cairo.filmstrip-part/Night").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo")).unwrap(),
            "their Cairo"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("from/Cairo/Night/stars.jpg")).unwrap(),
            "stars"
        );
    }

    #[test]
    fn a_file_that_arrives_in_a_folder_while_it_is_copied_across_is_never_removed_with_it() {
        let dir = scratch("arrives");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();
        let night = dir.join("from/Cairo/Night");
        // Named to sort before the file being copied, so the folder's reading has passed it.
        noclobber::just_before_the_next(move |_| {
            std::fs::write(night.join("a-late.jpg"), "late").unwrap();
        });

        copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/Night/stars.jpg")).unwrap(),
            "stars"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("from/Cairo/Night/a-late.jpg")).unwrap(),
            "late"
        );
        assert!(!dir.join("from/Cairo/Night/stars.jpg").exists());
    }

    fn theirs_passes_through_the_next_directory_taken_away() -> Rc<Cell<u32>> {
        let tries = Rc::new(Cell::new(0));
        let counted = Rc::clone(&tries);
        let mut first = None;
        crate::fs::just_before_taking_away(move |at| {
            if first.get_or_insert_with(|| at.to_path_buf()) != at {
                return;
            }
            counted.set(counted.get() + 1);
            match counted.get() {
                1 => std::fs::write(at.join("PYRAMID.JPG.tmp"), "theirs").unwrap(),
                2 => crate::fs::remove_once_let_go(&at.join("PYRAMID.JPG.tmp")),
                _ => {}
            }
        });
        tries
    }

    #[test]
    fn a_folder_copied_across_leaves_once_another_programs_file_has_passed_through_it() {
        let dir = scratch("passing");
        std::fs::create_dir_all(dir.join("from/Cairo")).unwrap();
        std::fs::write(dir.join("from/Cairo/pyramid.jpg"), "pyramid").unwrap();
        let tries = theirs_passes_through_the_next_directory_taken_away();

        copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).unwrap();
        assert!(!dir.join("from/Cairo").exists());
        assert_eq!(tries.get(), 2);
        settles_to(&dir.join("Cairo"), &["pyramid.jpg"]);
    }

    #[test]
    fn a_folder_around_one_where_a_file_stayed_is_tried_once() {
        let dir = scratch("stayed-two-deep");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();
        let tried = Rc::new(RefCell::new(Vec::new()));
        let seen = Rc::clone(&tried);
        crate::fs::just_before_taking_away(move |at| {
            if seen.borrow().is_empty() {
                std::fs::write(at.join("theirs.jpg"), "theirs").unwrap();
            }
            seen.borrow_mut().push(at.to_path_buf());
        });

        copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).unwrap();
        let tries_at = |at: &Path| tried.borrow().iter().filter(|tried| *tried == at).count();
        assert!(tries_at(&dir.join("from/Cairo/Night")) > 1);
        assert_eq!(tries_at(&dir.join("from/Cairo")), 1);
        assert_eq!(
            std::fs::read_to_string(dir.join("from/Cairo/Night/theirs.jpg")).unwrap(),
            "theirs"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/Night/stars.jpg")).unwrap(),
            "stars"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_half_copy_goes_once_another_programs_file_has_passed_through_it() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = scratch("passing-cut-short");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/Night/a-first.jpg"), "first").unwrap();
        std::fs::write(dir.join("from/Cairo/Night/z-held.jpg"), "held").unwrap();
        let _held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(dir.join("from/Cairo/Night/z-held.jpg"))
            .unwrap();
        let tries = theirs_passes_through_the_next_directory_taken_away();

        assert!(copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).is_err());
        assert!(!dir.join("Cairo").exists(), "the half copy is gone");
        assert_eq!(tries.get(), 2);
        assert!(dir.join("from/Cairo/Night/a-first.jpg").is_file());
    }

    // The same copy runs between drives; tested here on one, where a rename would have done.
    #[test]
    fn a_tree_copied_across_arrives_whole_and_only_then_leaves() {
        let dir = scratch("tree");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/pyramid.jpg"), "pyramid").unwrap();
        std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();

        copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/pyramid.jpg")).unwrap(),
            "pyramid"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/Night/stars.jpg")).unwrap(),
            "stars"
        );
        assert!(!dir.join("from/Cairo").exists());
    }

    /// Each file this thread flushes from now on, with whether every one of `originals` was still
    /// there as it was.
    fn flushes_while(originals: &[PathBuf]) -> Rc<RefCell<Vec<(PathBuf, bool)>>> {
        let flushed = Rc::new(RefCell::new(Vec::new()));
        let seen = Rc::clone(&flushed);
        let originals = originals.to_vec();
        crate::fs::just_after_flushing(move |path| {
            let all_there = originals.iter().all(|original| original.is_file());
            seen.borrow_mut().push((path.to_path_buf(), all_there));
        });
        flushed
    }

    #[test]
    fn every_copy_across_is_flushed_before_any_original_goes() {
        let dir = scratch("flushed");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/pyramid.jpg"), "pyramid").unwrap();
        std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();
        let flushed = flushes_while(&[
            dir.join("from/Cairo/pyramid.jpg"),
            dir.join("from/Cairo/Night/stars.jpg"),
        ]);

        copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).unwrap();
        let mut flushed = flushed.take();
        flushed.sort();
        assert_eq!(
            flushed,
            [
                (dir.join(".Cairo.filmstrip-part/Night/stars.jpg"), true),
                (dir.join(".Cairo.filmstrip-part/pyramid.jpg"), true),
            ]
        );
        assert!(!dir.join("from/Cairo").exists());
    }

    #[test]
    fn a_read_only_file_copied_across_is_flushed_and_stays_read_only() {
        let dir = scratch("read-only");
        let original = dir.join("from/pyramid.jpg");
        std::fs::create_dir_all(dir.join("from")).unwrap();
        std::fs::write(&original, "pyramid").unwrap();
        let mut permissions = std::fs::metadata(&original).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&original, permissions).unwrap();
        let flushed = flushes_while(std::slice::from_ref(&original));

        copy_across(&original, &dir.join("pyramid.jpg")).unwrap();
        assert_eq!(
            flushed.take(),
            [(dir.join(".pyramid.jpg.filmstrip-part"), true)]
        );
        let copy = std::fs::metadata(dir.join("pyramid.jpg")).unwrap();
        assert!(copy.permissions().readonly());
        assert_eq!(
            std::fs::read_to_string(dir.join("pyramid.jpg")).unwrap(),
            "pyramid"
        );
        assert!(!original.exists());
        let mut permissions = copy.permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(dir.join("pyramid.jpg"), permissions).unwrap();
    }

    /// Stops, as the app's closing does, from the moment `within` is begun.
    struct StopWithin {
        within: PathBuf,
        stopped: Cell<bool>,
    }

    impl Control for StopWithin {
        fn halt(&self) -> Option<Halt> {
            if self.within.exists() {
                self.stopped.set(true);
            }
            self.stopped.get().then_some(Halt::Stop)
        }
        fn progress(&self, _done: u32, _whole: u32) {}
    }

    fn big() -> Vec<u8> {
        (0..4 << 20).map(|at: u32| at as u8).collect()
    }

    #[cfg(windows)]
    #[test]
    fn a_file_stopped_partway_leaves_nothing_at_its_name_and_goes_on_whole_after() {
        let dir = scratch("stopped-file");
        std::fs::create_dir_all(dir.join("from")).unwrap();
        std::fs::write(dir.join("from/film.mp4"), big()).unwrap();
        let control = StopWithin {
            within: dir.join(".film.mp4.filmstrip-part"),
            stopped: Cell::new(false),
        };

        let halted =
            copy_across_watched(&dir.join("from/film.mp4"), &dir.join("film.mp4"), &control)
                .unwrap();
        assert_eq!(halted, Some(Halt::Stop));
        assert!(control.stopped.get());
        assert!(!dir.join("film.mp4").exists());
        assert!(!dir.join(".film.mp4.filmstrip-part").exists());
        assert_eq!(std::fs::read(dir.join("from/film.mp4")).unwrap(), big());

        let resumed = copy_across_watched(
            &dir.join("from/film.mp4"),
            &dir.join("film.mp4"),
            &Unwatched,
        )
        .unwrap();
        assert_eq!(resumed, None);
        assert_eq!(std::fs::read(dir.join("film.mp4")).unwrap(), big());
        assert!(!dir.join("from/film.mp4").exists());
    }

    #[test]
    fn a_part_a_crash_left_is_cleared_before_the_move_goes_on() {
        let dir = scratch("crash-part");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/pyramid.jpg"), "pyramid").unwrap();
        std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();
        std::fs::create_dir_all(dir.join(".Cairo.filmstrip-part/Night")).unwrap();
        std::fs::write(dir.join(".Cairo.filmstrip-part/pyramid.jpg"), "pyramid").unwrap();
        std::fs::write(dir.join(".Cairo.filmstrip-part/Night/stars.jpg"), "st").unwrap();

        copy_across_watched(&dir.join("from/Cairo"), &dir.join("Cairo"), &Unwatched).unwrap();
        assert!(!dir.join(".Cairo.filmstrip-part").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/Night/stars.jpg")).unwrap(),
            "stars"
        );
        assert!(!dir.join("from/Cairo").exists());
    }

    /// A junction at `link` to `target`, as anyone can make one.
    #[cfg(windows)]
    fn junction(link: &Path, target: &Path) {
        use std::os::windows::{fs::OpenOptionsExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        };
        use windows_sys::Win32::System::IO::DeviceIoControl;
        use windows_sys::Win32::System::Ioctl::FSCTL_SET_REPARSE_POINT;
        use windows_sys::Win32::System::SystemServices::IO_REPARSE_TAG_MOUNT_POINT;

        std::fs::create_dir(link).unwrap();
        let target = target.to_string_lossy().replace('/', "\\");
        let mut name: Vec<u16> = format!(r"\??\{target}").encode_utf16().collect();
        let named = u16::try_from(name.len() * 2).unwrap();
        name.extend([0, 0]);
        let mut buffer = Vec::new();
        buffer.extend(IO_REPARSE_TAG_MOUNT_POINT.to_le_bytes());
        buffer.extend(u16::try_from(8 + name.len() * 2).unwrap().to_le_bytes());
        for field in [0, 0, named, named + 2, 0] {
            buffer.extend(u16::to_le_bytes(field));
        }
        for unit in name {
            buffer.extend(unit.to_le_bytes());
        }
        let dir = std::fs::OpenOptions::new()
            .write(true)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS)
            .open(link)
            .unwrap();
        let mut returned = 0;
        // SAFETY: the handle is open for the whole call, and `buffer` is a whole mount point's
        // reparse data of the length given.
        let set = unsafe {
            DeviceIoControl(
                dir.as_raw_handle(),
                FSCTL_SET_REPARSE_POINT,
                buffer.as_ptr().cast(),
                u32::try_from(buffer.len()).unwrap(),
                std::ptr::null_mut(),
                0,
                &mut returned,
                std::ptr::null_mut(),
            )
        };
        assert_ne!(set, 0, "{}", std::io::Error::last_os_error());
    }

    #[cfg(windows)]
    #[test]
    fn a_link_in_a_part_or_as_it_is_never_followed_as_the_part_is_cleared() {
        for (name, link) in [
            ("linked-in-part", ".Cairo.filmstrip-part/Night"),
            ("linked-part", ".Cairo.filmstrip-part"),
        ] {
            let dir = scratch(name);
            std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
            std::fs::write(dir.join("from/Cairo/pyramid.jpg"), "pyramid").unwrap();
            std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();
            std::fs::create_dir_all(dir.join("elsewhere/Night")).unwrap();
            std::fs::write(dir.join("elsewhere/pyramid.jpg"), "theirs").unwrap();
            std::fs::write(dir.join("elsewhere/stars.jpg"), "theirs").unwrap();
            std::fs::write(dir.join("elsewhere/Night/stars.jpg"), "theirs").unwrap();
            std::fs::create_dir_all(dir.join(".Cairo.filmstrip-part")).unwrap();
            if link == ".Cairo.filmstrip-part" {
                std::fs::remove_dir(dir.join(link)).unwrap();
            }
            junction(&dir.join(link), &dir.join("elsewhere"));

            assert!(copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).is_err());
            for theirs in ["pyramid.jpg", "stars.jpg", "Night/stars.jpg"] {
                let at = dir.join("elsewhere").join(theirs);
                assert_eq!(std::fs::read_to_string(at).unwrap(), "theirs", "{name}");
            }
            assert_eq!(
                std::fs::read_to_string(dir.join("from/Cairo/Night/stars.jpg")).unwrap(),
                "stars"
            );
            assert!(!dir.join("Cairo").exists());
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_move_crosses_drives_only_between_two_drives_or_shares() {
        let crosses = |a: &str, b: &str| crosses_drives(Path::new(a), Path::new(b));
        assert!(!crosses(r"D:\Pictures\Cairo", r"d:\Archive"));
        assert!(!crosses(r"\\?\D:\Pictures", r"D:\Archive"));
        assert!(crosses(r"D:\Pictures", r"E:\Archive"));
        assert!(!crosses(r"\\nas\photos\Cairo", r"\\NAS\Photos\Lisbon"));
        assert!(crosses(r"\\nas\photos", r"\\nas\videos"));
        assert!(crosses(r"\\nas\photos", r"D:\Archive"));
    }

    #[cfg(windows)]
    #[test]
    fn a_copy_cut_short_leaves_the_original_whole_and_no_half_copy_behind() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = scratch("cut-short");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/a-first.jpg"), "first").unwrap();
        std::fs::write(dir.join("from/Cairo/Night/z-held.jpg"), "held").unwrap();
        // Held open with no sharing, as another program editing it would: the copy cannot read it.
        let _held = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(dir.join("from/Cairo/Night/z-held.jpg"))
            .unwrap();

        assert!(copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).is_err());
        assert!(dir.join("from/Cairo/a-first.jpg").is_file());
        assert!(dir.join("from/Cairo/Night/z-held.jpg").exists());
        assert!(!dir.join("Cairo").exists(), "the half copy is gone");
    }
}
