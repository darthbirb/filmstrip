//! Moving a file or a whole directory to where the index says it now belongs. On one drive that
//! is a rename; between drives it is a copy, checked, and only then the original's removal, so a
//! move cut short leaves the original where it was. DECISIONS.md "Undo".

use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};
use crate::fs::noclobber;

/// Windows' ERROR_NOT_SAME_DEVICE: a rename cannot cross from one drive to another.
const NOT_SAME_DEVICE: i32 = 17;

/// Moves `from` to `to`, refused with `AlreadyExists` when anything has that name, however late
/// it came.
pub fn relocate(from: &Path, to: &Path) -> Result<()> {
    match noclobber::rename(from, to) {
        Ok(()) => Ok(()),
        Err(err)
            if err.kind() == std::io::ErrorKind::CrossesDevices
                || err.raw_os_error() == Some(NOT_SAME_DEVICE) =>
        {
            copy_across(from, to)
        }
        Err(err) => Err(err.into()),
    }
}

/// Turns a refusal of a name already taken into `taken`, for a caller that can say where.
pub fn taken_as(taken: impl FnOnce() -> AppError) -> impl FnOnce(AppError) -> AppError {
    |err| match &err {
        AppError::Io(io) if io.kind() == std::io::ErrorKind::AlreadyExists => taken(),
        _ => err,
    }
}

/// The move between drives: everything copied and each copy's size checked against its original
/// before the original goes. Any failure removes what the copy wrote, and only that, and keeps
/// the original whole.
pub(crate) fn copy_across(from: &Path, to: &Path) -> Result<()> {
    let mut made = Vec::new();
    if let Err(err) = copy_into(from, to, from.is_dir(), &mut made) {
        for (_, copy) in made.iter().rev() {
            let _ = if copy.is_dir() {
                std::fs::remove_dir(copy)
            } else {
                std::fs::remove_file(copy)
            };
        }
        return Err(err);
    }
    // The copy is whole, so the move has happened and the index follows it; an original that will
    // not go, or anything that arrived in it since it was read, is left for the next walk.
    for (original, _) in made.iter().rev() {
        let _ = if original.is_dir() {
            std::fs::remove_dir(original)
        } else {
            std::fs::remove_file(original)
        };
    }
    Ok(())
}

/// Copies `from` to `to`, never onto anything there, recording each pair it wrote in `made`.
fn copy_into(
    from: &Path,
    to: &Path,
    is_dir: bool,
    made: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<()> {
    if is_dir {
        noclobber::make_dir(to)?;
        made.push((from.to_path_buf(), to.to_path_buf()));
        for entry in std::fs::read_dir(from)? {
            let entry = entry?;
            let is_dir = entry.file_type()?.is_dir();
            copy_into(&entry.path(), &to.join(entry.file_name()), is_dir, made)?;
        }
        return Ok(());
    }
    noclobber::copy(from, to)?;
    made.push((from.to_path_buf(), to.to_path_buf()));
    if std::fs::metadata(to)?.len() != std::fs::metadata(from)?.len() {
        return Err(AppError::invalid(format!(
            "{} did not copy whole",
            from.display()
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

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
