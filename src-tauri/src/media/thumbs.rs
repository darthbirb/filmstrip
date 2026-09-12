//! Thumbnails: 320px on the longest edge, lossy WebP at quality 78. Making one is also where a
//! file is read for its shape and its dates. DECISIONS.md "Thumbnails".

use std::path::Path;

use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageFormat};

use crate::error::Result;
use crate::media::ffmpeg::Ffmpeg;
use crate::media::probe::{self, Probe};

pub const EDGE: u32 = 320;
pub const QUALITY: f32 = 78.0;
/// A source at least this many times the target is boxed down first; one filtered pass from a
/// 6000px original costs more than the encode.
const BOX_FIRST_RATIO: u32 = 4;
/// A poster is taken a tenth of the way in, past the fades and black leaders most clips open
/// with, and never later than this.
const POSTER_LATEST_SECS: f64 = 600.0;

/// Writes a picture's thumbnail to `out`, and returns its upright size and when it was taken.
pub fn picture(source: &Path, out: &Path) -> Result<Probe> {
    let mut decoder = crate::media::open_image(source)?.into_decoder()?;
    let taken = decoder
        .exif_metadata()
        .ok()
        .flatten()
        .and_then(probe::exif_captured_at);
    let orientation = decoder.orientation()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);

    let mut learned = Probe {
        width: Some(image.width().into()),
        height: Some(image.height().into()),
        ..Probe::default()
    };
    learned.captured(taken, "exif");
    write_webp(&fit(image, EDGE), out)?;
    Ok(learned)
}

/// Writes a video's thumbnail to `out` from a poster frame, and returns what ffprobe reported.
pub fn video(ffmpeg: &Ffmpeg, source: &Path, out: &Path) -> Result<Probe> {
    let learned = probe::video(&ffmpeg.probe(source)?);
    let at = learned
        .duration_ms
        .map_or(0.0, |ms| (ms as f64 / 10_000.0).min(POSTER_LATEST_SECS));
    // A length that overstates the file seeks past its end; its first frame still stands for it.
    let png = ffmpeg.frame(source, at, EDGE).or_else(|error| {
        if at > 0.0 {
            ffmpeg.frame(source, 0.0, EDGE)
        } else {
            Err(error)
        }
    })?;
    let frame = image::load_from_memory_with_format(&png, ImageFormat::Png)?;
    write_webp(&fit(frame, EDGE), out)?;
    Ok(learned)
}

/// Downscaled to fit `edge` on the longest side, keeping its shape.
pub fn fit(image: DynamicImage, edge: u32) -> DynamicImage {
    let (width, height) = (image.width(), image.height());
    if width <= edge && height <= edge {
        return image;
    }
    let scale = f64::from(edge) / f64::from(width.max(height));
    let target_width = ((f64::from(width) * scale).round() as u32).max(1);
    let target_height = ((f64::from(height) * scale).round() as u32).max(1);
    let image = if width / target_width >= BOX_FIRST_RATIO {
        image.thumbnail(target_width * 2, target_height * 2)
    } else {
        image
    };
    image.resize_exact(target_width, target_height, FilterType::Triangle)
}

/// Keeps an alpha channel when the picture has one, so transparent areas stay transparent.
pub fn write_webp(image: &DynamicImage, out: &Path) -> Result<()> {
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let encoded = if image.color().has_alpha() {
        let rgba = image.to_rgba8();
        webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height()).encode(QUALITY)
    } else {
        let rgb = image.to_rgb8();
        webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height()).encode(QUALITY)
    };
    std::fs::write(out, &*encoded)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-thumbs")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn encoded(image: DynamicImage, format: ImageFormat) -> Vec<u8> {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        bytes.into_inner()
    }

    /// A JPEG carrying `exif` in an APP1 segment, where cameras put it.
    fn with_exif(jpeg: &[u8], exif: &[u8]) -> Vec<u8> {
        let mut out = jpeg[..2].to_vec();
        out.extend([0xFF, 0xE1]);
        out.extend(((2 + 6 + exif.len()) as u16).to_be_bytes());
        out.extend(b"Exif\0\0");
        out.extend(exif);
        out.extend(&jpeg[2..]);
        out
    }

    /// Writes `bytes` as `name`, thumbnails it, and returns what was learned and the thumbnail.
    fn thumbnail_of(test: &str, name: &str, bytes: &[u8]) -> Result<(Probe, DynamicImage)> {
        let dir = scratch(test);
        let source = dir.join(name);
        std::fs::write(&source, bytes).unwrap();
        let out = dir.join("thumb.webp");
        let learned = picture(&source, &out)?;
        Ok((learned, image::open(&out).unwrap()))
    }

    #[test]
    fn a_thumbnail_fits_the_longest_edge_and_reports_the_picture_size() {
        let png = encoded(DynamicImage::new_rgb8(640, 320), ImageFormat::Png);
        let (learned, thumb) = thumbnail_of("fits", "wide.png", &png).unwrap();
        assert_eq!((learned.width, learned.height), (Some(640), Some(320)));
        assert_eq!((thumb.width(), thumb.height()), (320, 160));
    }

    #[test]
    fn a_file_whose_extension_lies_is_decoded_by_its_content() {
        let jpeg = encoded(DynamicImage::new_rgb8(120, 80), ImageFormat::Jpeg);
        let (learned, _) = thumbnail_of("lying", "IMG_0001.PNG", &jpeg).unwrap();
        assert_eq!((learned.width, learned.height), (Some(120), Some(80)));
    }

    #[test]
    fn transparency_survives_into_the_thumbnail() {
        let png = encoded(DynamicImage::new_rgba8(40, 40), ImageFormat::Png);
        let (_, thumb) = thumbnail_of("alpha", "cutout.png", &png).unwrap();
        assert!(thumb.color().has_alpha());
    }

    /// EXIF orientation 6, as a phone held upright writes a landscape sensor's image.
    #[test]
    fn a_photo_taken_sideways_is_turned_upright() {
        let jpeg = encoded(DynamicImage::new_rgb8(40, 20), ImageFormat::Jpeg);
        let rotated = with_exif(&jpeg, &probe::exif_block(Some(6), &[]));
        let (learned, thumb) = thumbnail_of("upright", "portrait.jpg", &rotated).unwrap();
        assert_eq!((learned.width, learned.height), (Some(20), Some(40)));
        assert_eq!((thumb.width(), thumb.height()), (20, 40));
    }

    #[test]
    fn a_photo_carries_its_capture_date_into_what_is_learned() {
        let jpeg = encoded(DynamicImage::new_rgb8(40, 20), ImageFormat::Jpeg);
        let exif = probe::exif_block(Some(1), &[(0x9003, "2024:06:12 10:33:21")]);
        let (learned, _) = thumbnail_of("taken", "taken.jpg", &with_exif(&jpeg, &exif)).unwrap();
        assert_eq!(learned.captured_at, Some(1_718_188_401));
        assert_eq!(learned.captured_src.as_deref(), Some("exif"));

        let plain = encoded(DynamicImage::new_rgb8(40, 20), ImageFormat::Png);
        let (learned, _) = thumbnail_of("untaken", "plain.png", &plain).unwrap();
        assert_eq!(learned.captured_at, None, "no date is guessed");
    }

    #[test]
    fn a_file_that_is_not_an_image_fails_with_a_reason() {
        let broken = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00";
        let error = thumbnail_of("broken", "broken.jpg", broken).unwrap_err();
        assert!(!error.to_string().is_empty());
    }

    /// CI has no ffmpeg; `cargo test -- --ignored` runs this where there is one.
    #[test]
    #[ignore = "needs ffmpeg and ffprobe on PATH"]
    fn a_video_recorded_sideways_gets_an_upright_poster_and_its_turned_shape() {
        let ffmpeg = Ffmpeg::discover(Path::new("no-tools-here")).expect("ffmpeg on PATH");
        let dir = scratch("video");
        let (plain, turned) = (dir.join("plain.mp4"), dir.join("turned.mp4"));
        let make = |args: &[&str]| {
            let status = std::process::Command::new(ffmpeg.location())
                .args(["-v", "error", "-nostdin", "-y"])
                .args(args)
                .status()
                .unwrap();
            assert!(status.success());
        };
        let source = "testsrc=duration=2:size=320x180:rate=10";
        make(&[
            "-f",
            "lavfi",
            "-i",
            source,
            "-pix_fmt",
            "yuv420p",
            plain.to_str().unwrap(),
        ]);
        make(&[
            "-display_rotation",
            "90",
            "-i",
            plain.to_str().unwrap(),
            "-c",
            "copy",
            turned.to_str().unwrap(),
        ]);

        let out = dir.join("thumb.webp");
        let learned = video(&ffmpeg, &turned, &out).unwrap();
        assert_eq!((learned.width, learned.height), (Some(180), Some(320)));
        assert!(
            learned
                .duration_ms
                .is_some_and(|ms| (1_900..=2_100).contains(&ms))
        );
        let poster = image::open(&out).unwrap();
        assert!(
            poster.height() > poster.width(),
            "the poster stands upright"
        );
    }
}
