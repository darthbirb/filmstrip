//! Reading pictures: decoding by what a file holds, and making thumbnails from it.

pub mod thumbs;

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use crate::error::Result;

/// Opens an image with the decoder its content calls for, never its extension: phones save JPEG
/// data under `.PNG`, and trusting the name fails every one of those files.
pub fn open_image(path: &Path) -> Result<image::ImageReader<BufReader<File>>> {
    Ok(image::ImageReader::open(path)?.with_guessed_format()?)
}
