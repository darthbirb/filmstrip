//! ffmpeg and ffprobe: **the only programs the app starts.** Found in `tools\` beside the app,
//! else on PATH; nothing is installed. DECISIONS.md "Video and ffmpeg".

use std::ffi::OsStr;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::error::{AppError, Result};

/// A probe reads headers and a frame decodes a few seconds at most; a file still going past these
/// is treated as unreadable rather than left holding a worker.
const PROBE_LIMIT: Duration = Duration::from_secs(30);
const FRAME_LIMIT: Duration = Duration::from_secs(60);

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
pub struct Ffmpeg {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
}

impl Ffmpeg {
    /// Both programs from `tools`, else both from one directory on PATH; one alone is no use.
    pub fn discover(tools: &Path) -> Option<Ffmpeg> {
        Self::discover_on(tools, std::env::var_os("PATH").as_deref())
    }

    fn discover_on(tools: &Path, path: Option<&OsStr>) -> Option<Ffmpeg> {
        Self::pair_in(tools)
            .or_else(|| std::env::split_paths(path?).find_map(|dir| Self::pair_in(&dir)))
    }

    /// The pinned build `scripts/fetch-ffmpeg.ps1` puts in `target/tools`, else one on PATH.
    #[cfg(test)]
    pub fn for_tests() -> Option<Ffmpeg> {
        Self::discover(&Path::new(env!("CARGO_MANIFEST_DIR")).join("target/tools"))
    }

    fn pair_in(dir: &Path) -> Option<Ffmpeg> {
        let ffmpeg = dir.join(executable("ffmpeg"));
        let ffprobe = dir.join(executable("ffprobe"));
        (ffmpeg.is_file() && ffprobe.is_file()).then_some(Ffmpeg { ffmpeg, ffprobe })
    }

    pub fn location(&self) -> &Path {
        &self.ffmpeg
    }

    /// `ffprobe -show_format -show_streams`, parsed.
    pub fn probe(&self, file: &Path) -> Result<serde_json::Value> {
        let input = input(file);
        let args = [
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &input,
        ];
        Ok(serde_json::from_slice(&run(
            &self.ffprobe,
            &args,
            PROBE_LIMIT,
        )?)?)
    }

    /// One frame at `at_secs`, upright, within `edge` on its longest side, as PNG.
    pub fn frame(&self, file: &Path, at_secs: f64, edge: u32) -> Result<Vec<u8>> {
        self.frame_if_any(file, at_secs, edge)?
            .ok_or_else(|| AppError::Media(format!("ffmpeg found no frame at {at_secs:.3}s")))
    }

    /// As `frame`, but a moment past the file's end, where ffmpeg finds no frame, is nothing.
    pub fn frame_if_any(&self, file: &Path, at_secs: f64, edge: u32) -> Result<Option<Vec<u8>>> {
        let input = input(file);
        let at = format!("{at_secs:.3}");
        let scale = format!("scale={edge}:{edge}:force_original_aspect_ratio=decrease");
        let args = [
            "-v",
            "error",
            "-nostdin",
            "-ss",
            &at,
            "-i",
            &input,
            "-frames:v",
            "1",
            "-vf",
            &scale,
            "-f",
            "image2pipe",
            "-c:v",
            "png",
            "-",
        ];
        let png = run(&self.ffmpeg, &args, FRAME_LIMIT)?;
        Ok((!png.is_empty()).then_some(png))
    }
}

fn executable(stem: &str) -> String {
    if cfg!(windows) {
        format!("{stem}.exe")
    } else {
        stem.to_owned()
    }
}

/// The file protocol spelled out, so no file name is ever taken for another of ffmpeg's protocols.
fn input(file: &Path) -> String {
    format!("file:{}", file.display())
}

/// Runs a program until it exits or `limit` passes, and returns what it printed.
fn run(program: &Path, args: &[&str], limit: Duration) -> Result<Vec<u8>> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn()?;
    // Each pipe drains on its own thread: a program blocked on a full pipe never exits.
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let name = program
        .file_stem()
        .map_or_else(|| "a tool".into(), |stem| stem.to_string_lossy());

    let deadline = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Media(format!(
                "{name} gave up after {}s",
                limit.as_secs_f32()
            )));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let out = stdout.join().unwrap_or_default();
    if !status.success() {
        let err = stderr.join().unwrap_or_default();
        let err = String::from_utf8_lossy(&err);
        let reason = err.lines().map(str::trim).rfind(|line| !line.is_empty());
        return Err(AppError::Media(format!(
            "{name} failed: {}",
            reason.unwrap_or("it said nothing")
        )));
    }
    Ok(out)
}

fn drain(pipe: Option<impl Read + Send + 'static>) -> JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        bytes
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-ffmpeg")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ffmpeg_is_only_taken_with_ffprobe_beside_it() {
        let tools = scratch("pair");
        std::fs::write(tools.join(executable("ffmpeg")), "").unwrap();
        assert!(Ffmpeg::pair_in(&tools).is_none());

        std::fs::write(tools.join(executable("ffprobe")), "").unwrap();
        let found = Ffmpeg::pair_in(&tools).unwrap();
        assert_eq!(found.location(), tools.join(executable("ffmpeg")));
    }

    fn pair(name: &str) -> PathBuf {
        let dir = scratch(name);
        for stem in ["ffmpeg", "ffprobe"] {
            std::fs::write(dir.join(executable(stem)), "").unwrap();
        }
        dir
    }

    #[test]
    fn the_bundled_pair_comes_before_one_on_path() {
        let (bundled, on_path) = (pair("bundled"), pair("on-path"));
        let path = std::env::join_paths([scratch("empty"), on_path.clone()]).unwrap();

        let found = Ffmpeg::discover_on(&bundled, Some(&path)).unwrap();
        assert_eq!(found.location(), bundled.join(executable("ffmpeg")));

        let missing = bundled.join("missing");
        let found = Ffmpeg::discover_on(&missing, Some(&path)).unwrap();
        assert_eq!(found.location(), on_path.join(executable("ffmpeg")));

        assert!(Ffmpeg::discover_on(&missing, None).is_none());
    }

    /// The platform's shell, and the flag that hands it one line to run.
    const SHELL: (&str, &str) = if cfg!(windows) {
        ("cmd", "/c")
    } else {
        ("sh", "-c")
    };

    #[test]
    fn what_a_program_prints_comes_back_and_a_failure_says_why() {
        let limit = Duration::from_secs(20);
        let (shell, flag) = SHELL;
        let out = run(Path::new(shell), &[flag, "echo filmstrip"], limit).unwrap();
        assert_eq!(String::from_utf8_lossy(&out).trim(), "filmstrip");

        let line = if cfg!(windows) {
            "echo broken 1>&2 & exit 3"
        } else {
            "echo broken 1>&2; exit 3"
        };
        let error = run(Path::new(shell), &[flag, line], limit).unwrap_err();
        assert_eq!(error.to_string(), format!("{shell} failed: broken"));
    }

    #[test]
    fn a_program_still_running_at_its_limit_is_stopped() {
        let started = Instant::now();
        // Run directly, not through a shell, so stopping it stops the program itself.
        let (program, args): (&str, &[&str]) = if cfg!(windows) {
            ("ping", &["-n", "30", "127.0.0.1"])
        } else {
            ("sleep", &["30"])
        };
        let error = run(Path::new(program), args, Duration::from_millis(500)).unwrap_err();
        assert!(error.to_string().contains("gave up"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn a_file_is_always_named_through_the_file_protocol() {
        assert_eq!(
            input(Path::new("D:/clips/concat:a.mp4")),
            "file:D:/clips/concat:a.mp4"
        );
    }
}
