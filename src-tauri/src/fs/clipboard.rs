//! Putting a file on the Windows clipboard as a real file (`CF_HDROP`), so pasting into Explorer
//! produces the file itself, or its path as text when the path is what was asked for.
//! PRODUCT.md "Folders and sources".

use std::path::PathBuf;

#[cfg(windows)]
use clipboard_win::{Clipboard, options::NoClear, raw};

use crate::error::{AppError, Result};

#[cfg(any(windows, test))]
trait Board {
    fn empty(&mut self) -> Result<()>;
    fn add_files(&mut self, list: &[String]) -> Result<()>;
    fn add_text(&mut self, text: &str) -> Result<()>;
}

/// Copies the files under the names they already have: nothing here is renamed on the way out.
#[cfg(any(windows, test))]
fn put_files(board: &mut impl Board, paths: &[PathBuf]) -> Result<()> {
    let list: Vec<String> = paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    board.empty()?;
    board.add_files(&list)
}

/// Plain text, for pasting where a path is typed rather than where a file is dropped.
#[cfg(any(windows, test))]
fn put_text(board: &mut impl Board, text: &str) -> Result<()> {
    board.empty()?;
    board.add_text(text)
}

#[cfg(windows)]
struct System {
    _open: Clipboard,
}

/// The clipboard has one owner at a time, and another program may be holding it for a moment.
#[cfg(windows)]
fn open() -> Result<System> {
    Clipboard::new_attempts(10)
        .map(|open| System { _open: open })
        .map_err(|err| AppError::invalid(format!("the clipboard would not open: {err}")))
}

#[cfg(windows)]
impl Board for System {
    fn empty(&mut self) -> Result<()> {
        raw::empty()
            .map_err(|err| AppError::invalid(format!("the clipboard would not empty: {err}")))
    }

    fn add_files(&mut self, list: &[String]) -> Result<()> {
        raw::set_file_list_with(list, NoClear)
            .map_err(|err| AppError::invalid(format!("the files would not copy: {err}")))
    }

    fn add_text(&mut self, text: &str) -> Result<()> {
        raw::set_string_with(text, NoClear)
            .map_err(|err| AppError::invalid(format!("the text would not copy: {err}")))
    }
}

#[cfg(windows)]
pub fn copy_files(paths: &[PathBuf]) -> Result<()> {
    put_files(&mut open()?, paths)
}

#[cfg(windows)]
pub fn copy_text(text: &str) -> Result<()> {
    put_text(&mut open()?, text)
}

/// The app ships for Windows only; elsewhere it builds so the tests can run.
#[cfg(not(windows))]
pub fn copy_files(_paths: &[PathBuf]) -> Result<()> {
    Err(AppError::invalid(
        "copying files to the clipboard needs Windows",
    ))
}

#[cfg(not(windows))]
pub fn copy_text(_text: &str) -> Result<()> {
    Err(AppError::invalid("copying to the clipboard needs Windows"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Fake {
        files: Option<Vec<String>>,
        text: Option<String>,
    }

    impl Board for Fake {
        fn empty(&mut self) -> Result<()> {
            *self = Fake::default();
            Ok(())
        }

        fn add_files(&mut self, list: &[String]) -> Result<()> {
            self.files = Some(list.to_vec());
            Ok(())
        }

        fn add_text(&mut self, text: &str) -> Result<()> {
            self.text = Some(text.to_owned());
            Ok(())
        }
    }

    #[test]
    fn copy_after_copy_path_leaves_no_text_behind() {
        let mut board = Fake::default();
        put_text(&mut board, r"D:\Pictures\a.jpg").unwrap();
        put_files(&mut board, &[PathBuf::from(r"D:\Pictures\b.jpg")]).unwrap();
        assert_eq!(board.files, Some(vec![r"D:\Pictures\b.jpg".to_owned()]));
        assert_eq!(board.text, None);
    }

    #[test]
    fn copy_path_after_copy_leaves_no_files_behind() {
        let mut board = Fake::default();
        put_files(&mut board, &[PathBuf::from(r"D:\Pictures\a.jpg")]).unwrap();
        put_text(&mut board, r"D:\Pictures\b.jpg").unwrap();
        assert_eq!(board.text, Some(r"D:\Pictures\b.jpg".to_owned()));
        assert_eq!(board.files, None);
    }
}
