//! Scrub frames: frames through a video, side by side in one WebP, of which a tile shows one cell
//! at a time as the pointer crosses it. DECISIONS.md "Video and ffmpeg".

use std::path::Path;

use image::imageops::FilterType;
use image::{DynamicImage, GenericImage, ImageFormat, RgbImage};

use crate::error::{AppError, Result};
use crate::media::ffmpeg::Ffmpeg;
use crate::media::thumbs::{self, EDGE};

/// How many cells a strip holds, always: a clip too short for them all repeats its last.
pub const FRAMES: u32 = 10;

/// When each cell is taken: the middle of each of the clip's equal slices, so a pointer anywhere
/// in a slice shows the frame that stands for all of it.
pub fn moments(duration_ms: i64) -> Vec<f64> {
    let slice = duration_ms as f64 / 1000.0 / f64::from(FRAMES);
    (0..FRAMES)
        .map(|cell| slice * (f64::from(cell) + 0.5))
        .collect()
}

/// Writes a video's scrub frames to `out`, one seek per cell.
pub fn make(ffmpeg: &Ffmpeg, source: &Path, duration_ms: i64, out: &Path) -> Result<()> {
    if duration_ms <= 0 {
        return Err(AppError::Media(
            "a video without a length has no scrub frames".into(),
        ));
    }
    let pngs = taken(moments(duration_ms), |at| {
        ffmpeg.frame_if_any(source, at, EDGE)
    })?;
    let frames = pngs
        .iter()
        .map(|png| Ok(image::load_from_memory_with_format(png, ImageFormat::Png)?))
        .collect::<Result<Vec<_>>>()?;
    thumbs::write_webp(&strip(&frames)?, out)
}

/// What `take` gives at each moment in turn, up to the first that finds nothing: a length that
/// overstates the file seeks past its end, and every later moment would too. Any failure is the
/// whole strip's, so a strip is never written from frames cut short by a passing fault.
fn taken<T>(
    moments: impl IntoIterator<Item = f64>,
    mut take: impl FnMut(f64) -> Result<Option<T>>,
) -> Result<Vec<T>> {
    let mut frames = Vec::with_capacity(FRAMES as usize);
    for at in moments {
        match take(at)? {
            Some(frame) => frames.push(frame),
            None => break,
        }
    }
    Ok(frames)
}

/// The frames side by side, each at the first one's size, the last repeated to fill the strip.
pub fn strip(frames: &[DynamicImage]) -> Result<DynamicImage> {
    let first = frames
        .first()
        .ok_or_else(|| AppError::Media("no scrub frame could be taken".into()))?;
    let (width, height) = (first.width(), first.height());
    let mut strip = RgbImage::new(width * FRAMES, height);
    for cell in 0..FRAMES {
        let frame = frames.get(cell as usize).or(frames.last()).unwrap_or(first);
        let frame = if (frame.width(), frame.height()) == (width, height) {
            frame.to_rgb8()
        } else {
            frame
                .resize_exact(width, height, FilterType::Triangle)
                .to_rgb8()
        };
        strip
            .copy_from(&frame, cell * width, 0)
            .map_err(|error| AppError::Media(error.to_string()))?;
    }
    Ok(DynamicImage::ImageRgb8(strip))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;
    use std::path::PathBuf;

    fn solid(width: u32, height: u32, shade: u8) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_pixel(
            width,
            height,
            Rgb([shade, shade, shade]),
        ))
    }

    fn shade_of(strip: &DynamicImage, cell: u32, width: u32) -> u8 {
        strip.to_rgb8().get_pixel(cell * width + width / 2, 0)[0]
    }

    #[test]
    fn each_cell_stands_at_the_middle_of_its_slice_of_the_clip() {
        let at = moments(20_000);
        assert_eq!(at.len(), FRAMES as usize);
        assert!((at[0] - 1.0).abs() < 1e-9);
        assert!((at[9] - 19.0).abs() < 1e-9);
    }

    #[test]
    fn the_frames_stand_side_by_side_in_order() {
        let frames: Vec<_> = (0..FRAMES).map(|n| solid(32, 18, n as u8 * 20)).collect();
        let strip = strip(&frames).unwrap();
        assert_eq!((strip.width(), strip.height()), (32 * FRAMES, 18));
        assert_eq!(shade_of(&strip, 0, 32), 0);
        assert_eq!(shade_of(&strip, 3, 32), 60);
        assert_eq!(shade_of(&strip, 9, 32), 180);
    }

    #[test]
    fn a_clip_that_gave_fewer_frames_repeats_its_last_to_fill_the_strip() {
        let strip = strip(&[solid(20, 10, 40), solid(20, 10, 90)]).unwrap();
        assert_eq!(strip.width(), 20 * FRAMES);
        assert_eq!(shade_of(&strip, 1, 20), 90);
        assert_eq!(shade_of(&strip, 9, 20), 90);
    }

    #[test]
    fn a_frame_of_another_size_is_fitted_to_the_cell() {
        let strip = strip(&[solid(20, 10, 40), solid(40, 20, 90)]).unwrap();
        assert_eq!((strip.width(), strip.height()), (20 * FRAMES, 10));
        assert_eq!(shade_of(&strip, 1, 20), 90);
    }

    #[test]
    fn frames_stop_at_the_first_moment_past_the_end_of_the_file() {
        let mut calls = 0;
        let frames = taken(moments(20_000), |at| {
            calls += 1;
            Ok((at < 5.0).then_some(at))
        })
        .unwrap();
        assert_eq!(frames, [1.0, 3.0]);
        assert_eq!(calls, 3);
    }

    #[test]
    fn a_failure_part_way_through_fails_the_strip_rather_than_cutting_it_short() {
        let mut calls = 0;
        let error = taken(moments(20_000), |at| {
            calls += 1;
            if calls == 3 {
                Err(AppError::Io(std::io::Error::other("the drive went away")))
            } else {
                Ok(Some(at))
            }
        })
        .unwrap_err();
        assert!(crate::jobs::worker::is_transient(&error), "{error}");
        assert_eq!(calls, 3);
    }

    #[test]
    fn no_frame_at_all_is_a_failure_with_a_reason() {
        let error = strip(&[]).unwrap_err();
        assert!(error.to_string().contains("no scrub frame"), "{error}");
    }

    #[test]
    #[ignore = "needs ffmpeg: scripts/fetch-ffmpeg.ps1, or on PATH"]
    fn a_video_gets_a_strip_of_frames_through_it() {
        let ffmpeg = Ffmpeg::for_tests().expect("ffmpeg in target/tools or on PATH");
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-scrub");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let clip: PathBuf = dir.join("clip.mp4");
        let status = std::process::Command::new(ffmpeg.location())
            .args(["-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i"])
            .arg("testsrc=duration=4:size=320x180:rate=10")
            .args(["-pix_fmt", "yuv420p"])
            .arg(&clip)
            .status()
            .unwrap();
        assert!(status.success());

        let out = dir.join("clip.frames.webp");
        make(&ffmpeg, &clip, 4_000, &out).unwrap();
        let strip = image::open(&out).unwrap();
        assert_eq!((strip.width(), strip.height()), (320 * FRAMES, 180));

        let past_the_end = dir.join("long.frames.webp");
        make(&ffmpeg, &clip, 40_000, &past_the_end).unwrap();
        assert_eq!(image::open(&past_the_end).unwrap().width(), 320 * FRAMES);
    }
}
