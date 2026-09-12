//! Thumbnails: 320px on the longest edge, lossy WebP at quality 78. DECISIONS.md "Thumbnails".

use std::path::Path;

use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder};
use rusqlite::Connection;

use crate::db::items;
use crate::error::{AppError, Result};
use crate::fs::paths;

pub const EDGE: u32 = 320;
pub const QUALITY: f32 = 78.0;
/// A source at least this many times the target is boxed down first; one filtered pass from a
/// 6000px original costs more than the encode.
const BOX_FIRST_RATIO: u32 = 4;

/// Writes an item's thumbnail under `thumbs`, and returns the picture's size as it is shown.
pub fn generate(conn: &Connection, item_id: i64, thumbs: &Path) -> Result<(i64, i64)> {
    let file =
        items::file_of(conn, item_id)?.ok_or_else(|| AppError::invalid("the item is gone"))?;
    let source = paths::item_path(conn, file.folder_id, &file.disk_name)?;
    let image = decode_upright(&source)?;
    let size = (i64::from(image.width()), i64::from(image.height()));
    write_webp(
        &fit(image, EDGE),
        &thumbs.join(paths::thumb_rel(&file.uuid)),
    )?;
    Ok(size)
}

/// Decodes a picture and applies its EXIF orientation, so a photo taken sideways stands upright.
pub fn decode_upright(path: &Path) -> Result<DynamicImage> {
    let mut decoder = crate::media::open_image(path)?.into_decoder()?;
    let orientation = decoder.orientation()?;
    let mut image = DynamicImage::from_decoder(decoder)?;
    image.apply_orientation(orientation);
    Ok(image)
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
    use crate::db;
    use crate::db::folders;
    use crate::db::items::NewItem;
    use crate::db::sources::{self, SourceKind};
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/test-thumbs")
            .join(name);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("library")).unwrap();
        dir
    }

    /// A library holding one file, and the item standing for it.
    fn library_with(dir: &Path, name: &str, bytes: &[u8]) -> (Connection, i64) {
        let root = dir.join("library");
        std::fs::write(root.join(name), bytes).unwrap();
        let mut conn = Connection::open_in_memory().unwrap();
        db::migrate(&mut conn).unwrap();
        let source = sources::add(&conn, &root, "Library", SourceKind::Library).unwrap();
        let folder = folders::source_root_folder(&conn, source.id).unwrap();
        let id = items::upsert(
            &conn,
            &NewItem {
                uuid: "abcdef12".into(),
                source_id: source.id,
                folder_id: folder,
                disk_name: name.into(),
                ext: paths::extension_of(name),
                orig_name: name.into(),
                hash: None,
                size_bytes: bytes.len() as i64,
                mtime: 0,
                kind: "image".into(),
                width: None,
                height: None,
                duration_ms: None,
                codec: None,
                bitrate: None,
                captured_at: None,
                captured_src: None,
            },
        )
        .unwrap();
        (conn, id)
    }

    fn encoded(image: DynamicImage, format: image::ImageFormat) -> Vec<u8> {
        let mut bytes = std::io::Cursor::new(Vec::new());
        image.write_to(&mut bytes, format).unwrap();
        bytes.into_inner()
    }

    fn thumbnail(dir: &Path) -> DynamicImage {
        image::open(dir.join("thumbs").join(paths::thumb_rel("abcdef12"))).unwrap()
    }

    #[test]
    fn a_thumbnail_fits_the_longest_edge_and_reports_the_picture_size() {
        let dir = scratch("fits");
        let png = encoded(DynamicImage::new_rgb8(640, 320), image::ImageFormat::Png);
        let (conn, id) = library_with(&dir, "wide.png", &png);

        assert_eq!(
            generate(&conn, id, &dir.join("thumbs")).unwrap(),
            (640, 320)
        );
        let thumb = thumbnail(&dir);
        assert_eq!((thumb.width(), thumb.height()), (320, 160));
    }

    #[test]
    fn a_file_whose_extension_lies_is_decoded_by_its_content() {
        let dir = scratch("lying");
        let jpeg = encoded(DynamicImage::new_rgb8(120, 80), image::ImageFormat::Jpeg);
        let (conn, id) = library_with(&dir, "IMG_0001.PNG", &jpeg);
        assert_eq!(generate(&conn, id, &dir.join("thumbs")).unwrap(), (120, 80));
    }

    #[test]
    fn transparency_survives_into_the_thumbnail() {
        let dir = scratch("alpha");
        let png = encoded(DynamicImage::new_rgba8(40, 40), image::ImageFormat::Png);
        let (conn, id) = library_with(&dir, "cutout.png", &png);
        generate(&conn, id, &dir.join("thumbs")).unwrap();
        assert!(thumbnail(&dir).color().has_alpha());
    }

    /// A JPEG carrying EXIF orientation 6, as a phone held upright writes a landscape sensor's image.
    #[test]
    fn a_photo_taken_sideways_is_turned_upright() {
        let dir = scratch("upright");
        let jpeg = encoded(DynamicImage::new_rgb8(40, 20), image::ImageFormat::Jpeg);
        let tiff: [u8; 26] = [
            b'I', b'I', 0x2A, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0,
            0, 0,
        ];
        let mut rotated = jpeg[..2].to_vec();
        rotated.extend_from_slice(&[0xFF, 0xE1, 0, 34]);
        rotated.extend_from_slice(b"Exif\0\0");
        rotated.extend_from_slice(&tiff);
        rotated.extend_from_slice(&jpeg[2..]);
        let (conn, id) = library_with(&dir, "portrait.jpg", &rotated);

        assert_eq!(generate(&conn, id, &dir.join("thumbs")).unwrap(), (20, 40));
    }

    #[test]
    fn a_file_that_is_not_an_image_fails_with_a_reason() {
        let dir = scratch("broken");
        let (conn, id) = library_with(&dir, "broken.jpg", b"\xff\xd8\xff\xe0\x00\x10JFIF\x00");
        let error = generate(&conn, id, &dir.join("thumbs")).unwrap_err();
        assert!(!error.to_string().is_empty());
    }
}
