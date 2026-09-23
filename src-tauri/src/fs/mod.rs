pub mod clipboard;
pub mod folders;
pub mod items;
pub mod paths;
pub mod relocate;
pub mod sanitize;
pub mod undo;
pub mod walk;

use std::sync::{Mutex, MutexGuard, PoisonError};

static DISK: Mutex<()> = Mutex::new(());

/// One change to the library's disk at a time. A walk takes a turn per source and a verb takes one
/// for its whole change, so neither reads the other half-done. DECISIONS.md "Undo".
pub fn turn() -> MutexGuard<'static, ()> {
    DISK.lock().unwrap_or_else(PoisonError::into_inner)
}
