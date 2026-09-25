//! Putting a file on the Windows clipboard as a real file (`CF_HDROP`), so pasting into Explorer
//! produces the file itself rather than its path as text. PRODUCT.md "Folders and sources".

use std::path::PathBuf;

use clipboard_win::{Clipboard, raw};

use crate::error::{AppError, Result};

/// The clipboard has one owner at a time, and another program may be holding it for a moment.
fn open() -> Result<Clipboard> {
    Clipboard::new_attempts(10)
        .map_err(|err| AppError::invalid(format!("the clipboard would not open: {err}")))
}

/// Copies the files under the names they already have: nothing here is renamed on the way out.
pub fn copy_files(paths: &[PathBuf]) -> Result<()> {
    let list: Vec<String> = paths
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    let _clipboard = open()?;
    raw::set_file_list(&list)
        .map_err(|err| AppError::invalid(format!("the files would not copy: {err}")))
}
