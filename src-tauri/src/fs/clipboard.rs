//! Putting a file on the Windows clipboard as a real file (`CF_HDROP`), so pasting into Explorer
//! produces the file itself rather than its path as text. PRODUCT.md "Folders and sources".

use std::path::Path;

use clipboard_win::{raw, Clipboard};

use crate::error::{AppError, Result};

/// The clipboard has one owner at a time, and another program may be holding it for a moment.
fn open() -> Result<Clipboard> {
    Clipboard::new_attempts(10)
        .map_err(|err| AppError::invalid(format!("the clipboard would not open: {err}")))
}

/// Copies the file under the name it already has: nothing here is renamed on the way out.
pub fn copy_file(path: &Path) -> Result<()> {
    let _clipboard = open()?;
    raw::set_file_list(&[path.to_string_lossy().to_string()])
        .map_err(|err| AppError::invalid(format!("the file would not copy: {err}")))
}
