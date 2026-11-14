pub mod acts;
pub mod backups;
pub mod clipboard;
pub mod export;
pub mod folders;
pub mod items;
pub mod noclobber;
pub mod paste;
pub mod paths;
pub mod recycle;
pub mod relocate;
pub mod sanitize;
pub mod stayed;
pub mod trash;
pub mod undo;
pub mod walk;

use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

static DISK: Mutex<()> = Mutex::new(());

/// One change to the library's disk at a time. A walk takes a turn per source and a verb takes one
/// for its whole change, so neither reads the other half-done. DECISIONS.md "Undo".
pub fn turn() -> MutexGuard<'static, ()> {
    DISK.lock().unwrap_or_else(PoisonError::into_inner)
}

/// How long a directory just emptied may hold another program's file before it stays.
pub(crate) const PASSING: Duration = Duration::from_millis(250);

/// Removes a directory files have just left, only ever while it is empty, trying again while
/// another program's file passes through it. DECISIONS.md "Undo".
pub(crate) fn take_away(dir: &Path) -> std::io::Result<()> {
    take_away_within(dir, PASSING)
}

/// `take_away` tried once, for a directory around one where something stayed: it cannot empty.
pub(crate) fn take_away_once(dir: &Path) -> std::io::Result<()> {
    take_away_within(dir, Duration::ZERO)
}

fn take_away_within(dir: &Path, passing: Duration) -> std::io::Result<()> {
    let until = Instant::now() + passing;
    loop {
        #[cfg(test)]
        TAKING_AWAY.with(|hook| {
            if let Some(then) = hook.borrow_mut().as_mut() {
                then(dir);
            }
        });
        match std::fs::remove_dir(dir) {
            Err(err)
                if err.kind() == std::io::ErrorKind::DirectoryNotEmpty
                    && Instant::now() < until =>
            {
                std::thread::sleep(Duration::from_millis(1));
            }
            done => return done,
        }
    }
}

#[cfg(test)]
pub(crate) type Meanwhile = Box<dyn FnMut(&Path)>;

#[cfg(test)]
thread_local! {
    static TAKING_AWAY: std::cell::RefCell<Option<Meanwhile>> =
        const { std::cell::RefCell::new(None) };
}

/// Runs `then` with each directory this thread's `take_away` removes from now on, just before each
/// try at it: where a test puts what another program leaves there.
#[cfg(test)]
pub(crate) fn just_before_taking_away(then: impl FnMut(&Path) + 'static) {
    TAKING_AWAY.with(|hook| *hook.borrow_mut() = Some(Box::new(then)));
}

/// The names in `dir`, sorted.
#[cfg(test)]
fn names_in(dir: &std::path::Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// The names in `dir` once `settled` holds of them, or as they are after five seconds. Some
/// programs put a file of their own beside one just written or moved away, and take it back a
/// moment later. DECISIONS.md "Undo".
#[cfg(test)]
pub(crate) fn settled_names(
    dir: &std::path::Path,
    settled: impl Fn(&[String]) -> bool,
) -> Vec<String> {
    let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut seen = names_in(dir);
    while !settled(&seen) && std::time::Instant::now() < until {
        std::thread::sleep(std::time::Duration::from_millis(1));
        seen = names_in(dir);
    }
    seen
}

/// Holds `dir` to exactly `names`, once another program's passing file has gone.
#[cfg(test)]
pub(crate) fn settles_to(dir: &std::path::Path, names: &[&str]) {
    assert_eq!(settled_names(dir, |seen| seen == names), names);
}

/// Removes `file` once another program that opened it, as some do a file just written, lets go.
#[cfg(test)]
pub(crate) fn remove_once_let_go(file: &std::path::Path) {
    const SHARING_VIOLATION: i32 = 32;
    let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match std::fs::remove_file(file) {
            Err(err)
                if err.raw_os_error() == Some(SHARING_VIOLATION)
                    && std::time::Instant::now() < until =>
            {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            done => return done.unwrap(),
        }
    }
}
