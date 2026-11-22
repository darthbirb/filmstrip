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

/// Moves `from` to `to`, refused with `AlreadyExists` when anything has that name, however late
/// it came.
pub fn relocate(from: &Path, to: &Path) -> Result<()> {
    relocate_watched(from, to, &Unwatched).map(|_| ())
}

/// `relocate`, answering to `control` between the files a move between drives copies. Stopped,
/// it takes away what it copied and leaves `from` whole, and says why it stopped.
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

/// The move between drives: everything copied, each copy's size checked against its original and
/// each flushed to its drive before any original goes. Any failure removes what the copy wrote,
/// and only that, and keeps the original whole.
#[cfg(test)]
pub(crate) fn copy_across(from: &Path, to: &Path) -> Result<()> {
    copy_across_watched(from, to, &Unwatched).map(|_| ())
}

/// The move between drives, stopped between files when `control` says so, as a failure is.
pub(crate) fn copy_across_watched(
    from: &Path,
    to: &Path,
    control: &impl Control,
) -> Result<Option<Halt>> {
    let mut copy = Across {
        made: Vec::new(),
        control,
        done: 0,
        whole: files_under(from),
    };
    control.progress(0, copy.whole);
    let copied = copy.copy(from, to, from.is_dir());
    if !matches!(copied, Ok(None)) {
        remove_deepest_first(copy.made.iter().map(|(_, copy)| copy.as_path()));
        return copied;
    }
    // The copy is whole, so the move has happened and the index follows it; an original that will
    // not go, or anything that arrived in it since it was read, is left for the next walk.
    remove_deepest_first(copy.made.iter().map(|(original, _)| original.as_path()));
    Ok(None)
}

/// Every file at or under `path`, as the copy will meet them.
fn files_under(path: &Path) -> u32 {
    let count = walkdir::WalkDir::new(path)
        .into_iter()
        .flatten()
        .filter(|entry| !entry.file_type().is_dir())
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
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

/// A copy between drives as it goes: each pair it wrote, and how many files are whole.
struct Across<'a, C: Control> {
    made: Vec<(PathBuf, PathBuf)>,
    control: &'a C,
    done: u32,
    whole: u32,
}

impl<C: Control> Across<'_, C> {
    /// Copies `from` to `to`, never onto anything there, recording each pair it wrote; stopped
    /// before the next file once `control` says so.
    fn copy(&mut self, from: &Path, to: &Path, is_dir: bool) -> Result<Option<Halt>> {
        if let Some(halt) = self.control.halt() {
            return Ok(Some(halt));
        }
        if is_dir {
            noclobber::make_dir(to)?;
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
        noclobber::copy(from, to)?;
        self.made.push((from.to_path_buf(), to.to_path_buf()));
        if std::fs::metadata(to)?.len() != std::fs::metadata(from)?.len() {
            return Err(AppError::invalid(format!(
                "{} did not copy whole",
                from.display()
            )));
        }
        flush_copy(to)?;
        self.done = (self.done + 1).min(self.whole);
        self.control.progress(self.done, self.whole);
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
        let cairo = dir.join("Cairo");
        noclobber::just_before_the_next(move |_| {
            noclobber::just_before_the_next(move |_| {
                noclobber::just_before_the_next(move |to| {
                    std::fs::write(cairo.join("theirs.jpg"), "theirs").unwrap();
                    std::fs::write(to, "their stars").unwrap();
                });
            });
        });

        assert!(copy_across(&dir.join("from/Cairo"), &dir.join("Cairo")).is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/theirs.jpg")).unwrap(),
            "theirs"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/Night/stars.jpg")).unwrap(),
            "their stars"
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
            noclobber::just_before_the_next(move |_| {
                noclobber::just_before_the_next(move |_| {
                    std::fs::write(night.join("a-late.jpg"), "late").unwrap();
                });
            });
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
                (dir.join("Cairo/Night/stars.jpg"), true),
                (dir.join("Cairo/pyramid.jpg"), true),
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
        assert_eq!(flushed.take(), [(dir.join("pyramid.jpg"), true)]);
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

    /// Cancels once `after` files are whole, keeping every count it was given.
    struct CancelAfter {
        after: u32,
        said: RefCell<Vec<(u32, u32)>>,
    }

    impl Control for CancelAfter {
        fn halt(&self) -> Option<Halt> {
            let done = self.said.borrow().last().map_or(0, |(done, _)| *done);
            (done >= self.after).then_some(Halt::Cancel)
        }
        fn progress(&self, done: u32, whole: u32) {
            self.said.borrow_mut().push((done, whole));
        }
    }

    #[test]
    fn a_folder_copy_across_cancelled_between_files_leaves_every_file_where_it_was() {
        let dir = scratch("cancelled");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/a-pyramid.jpg"), "pyramid").unwrap();
        std::fs::write(dir.join("from/Cairo/b-sphinx.jpg"), "sphinx").unwrap();
        std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();
        let control = CancelAfter {
            after: 1,
            said: RefCell::new(Vec::new()),
        };

        let halted =
            copy_across_watched(&dir.join("from/Cairo"), &dir.join("Cairo"), &control).unwrap();
        assert_eq!(halted, Some(Halt::Cancel));
        assert_eq!(control.said.take(), [(0, 3), (1, 3)]);
        assert!(!dir.join("Cairo").exists(), "nothing of the copy is left");
        for (name, bytes) in [
            ("a-pyramid.jpg", "pyramid"),
            ("b-sphinx.jpg", "sphinx"),
            ("Night/stars.jpg", "stars"),
        ] {
            let original = dir.join("from/Cairo").join(name);
            assert_eq!(std::fs::read_to_string(original).unwrap(), bytes);
        }
    }

    #[test]
    fn a_folder_copy_across_counts_each_file_as_it_is_whole() {
        let dir = scratch("counted");
        std::fs::create_dir_all(dir.join("from/Cairo/Night")).unwrap();
        std::fs::write(dir.join("from/Cairo/pyramid.jpg"), "pyramid").unwrap();
        std::fs::write(dir.join("from/Cairo/Night/stars.jpg"), "stars").unwrap();
        let control = CancelAfter {
            after: u32::MAX,
            said: RefCell::new(Vec::new()),
        };

        let halted =
            copy_across_watched(&dir.join("from/Cairo"), &dir.join("Cairo"), &control).unwrap();
        assert_eq!(halted, None);
        assert_eq!(control.said.take(), [(0, 2), (1, 2), (2, 2)]);
        assert!(!dir.join("from/Cairo").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("Cairo/Night/stars.jpg")).unwrap(),
            "stars"
        );
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
