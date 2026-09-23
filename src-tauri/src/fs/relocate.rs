//! Moving a file or a whole directory to where the index says it now belongs. On one drive that
//! is a rename; between drives it is a copy, checked, and only then the original's removal, so a
//! move cut short leaves the original where it was. DECISIONS.md "Undo".

use std::path::Path;

use crate::error::{AppError, Result};

/// Windows' ERROR_NOT_SAME_DEVICE: a rename cannot cross from one drive to another.
const NOT_SAME_DEVICE: i32 = 17;

/// Moves `from` to `to`, which must not exist yet.
pub fn relocate(from: &Path, to: &Path) -> Result<()> {
    if to.exists() {
        return Err(AppError::invalid(format!(
            "{} is already there",
            to.display()
        )));
    }
    match std::fs::rename(from, to) {
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

/// The move between drives: everything copied and each copy's size checked against its original
/// before the original goes. Any failure removes the partial copy and keeps the original whole.
pub(crate) fn copy_across(from: &Path, to: &Path) -> Result<()> {
    let copied = if from.is_dir() {
        copy_tree(from, to)
    } else {
        copy_file(from, to)
    };
    if let Err(err) = copied {
        let _ = if to.is_dir() {
            std::fs::remove_dir_all(to)
        } else {
            std::fs::remove_file(to)
        };
        return Err(err);
    }
    // The copy is whole, so the move has happened and the index follows it; an original that will
    // not go is left for the next walk, rather than stranding the copy outside the index.
    let _ = if from.is_dir() {
        std::fs::remove_dir_all(from)
    } else {
        std::fs::remove_file(from)
    };
    Ok(())
}

fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            copy_file(&entry.path(), &target)?;
        }
    }
    Ok(())
}

fn copy_file(from: &Path, to: &Path) -> Result<()> {
    let written = std::fs::copy(from, to)?;
    if written != std::fs::metadata(from)?.len() || std::fs::metadata(to)?.len() != written {
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
