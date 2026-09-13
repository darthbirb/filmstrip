//! What a file says about itself beyond its bytes: its shape, its length, when it was taken.
//! Nothing here guesses; what a file does not say stays `None`. DECISIONS.md "Capture dates".

use exif::{In, Reader, Tag, Value};
use serde_json::Value as Json;

/// What reading a file taught, in the terms the index keeps.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Probe {
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub codec: Option<String>,
    pub bitrate: Option<i64>,
    pub captured_at: Option<i64>,
    /// Where `captured_at` came from: `exif` or `container`.
    pub captured_src: Option<String>,
}

impl Probe {
    pub fn captured(&mut self, at: Option<i64>, source: &str) {
        if let Some(at) = at {
            self.captured_at = Some(at);
            self.captured_src = Some(source.to_owned());
        }
    }
}

/// When the shutter fired, else when the picture was digitised, from a raw EXIF block.
pub fn exif_captured_at(raw: Vec<u8>) -> Option<i64> {
    let raw = match raw.strip_prefix(b"Exif\0\0") {
        Some(tiff) => tiff.to_vec(),
        None => raw,
    };
    let exif = Reader::new().read_raw(raw).ok()?;
    [Tag::DateTimeOriginal, Tag::DateTimeDigitized]
        .into_iter()
        .find_map(|tag| match &exif.get_field(tag, In::PRIMARY)?.value {
            Value::Ascii(values) => {
                let at = exif::DateTime::from_ascii(values.first()?).ok()?;
                civil(
                    at.year.into(),
                    at.month.into(),
                    at.day.into(),
                    at.hour.into(),
                    at.minute.into(),
                    at.second.into(),
                )
            }
            _ => None,
        })
}

/// What `ffprobe -show_format -show_streams` reported about a video. A creation time of zero,
/// QuickTime's 1904 or Unix's 1970, is how a container says it was never set.
pub fn video(report: &Json) -> Probe {
    let mut probe = Probe::default();
    let stream = report["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "video"));
    if let Some(stream) = stream {
        let (width, height) = (stream["width"].as_i64(), stream["height"].as_i64());
        // ffmpeg draws a rotated recording's frames upright, so the shape it is shown at turns too.
        (probe.width, probe.height) = if rotation(stream).rem_euclid(180) == 90 {
            (height, width)
        } else {
            (width, height)
        };
        probe.codec = stream["codec_name"].as_str().map(str::to_owned);
    }
    let format = &report["format"];
    probe.duration_ms = number(&format["duration"])
        .filter(|secs| *secs > 0.0)
        .map(|secs| (secs * 1000.0).round() as i64);
    probe.bitrate = number(&format["bit_rate"]).map(|bits| bits as i64);
    let created = format["tags"]["creation_time"]
        .as_str()
        .and_then(parse_iso8601)
        .filter(|at| *at > 0);
    probe.captured(created, "container");
    probe
}

/// Degrees a recording asks to be turned: the display matrix newer ffmpeg reports, or the older tag.
fn rotation(stream: &Json) -> i64 {
    let matrix = stream["side_data_list"]
        .as_array()
        .into_iter()
        .flatten()
        .find_map(|data| data["rotation"].as_f64());
    let tag = stream["tags"]["rotate"]
        .as_str()
        .and_then(|text| text.parse::<f64>().ok());
    matrix.or(tag).map_or(0, |degrees| degrees.round() as i64)
}

/// ffprobe writes its numbers as strings.
fn number(value: &Json) -> Option<f64> {
    value
        .as_str()
        .and_then(|text| text.parse::<f64>().ok())
        .or_else(|| value.as_f64())
        .filter(|n| n.is_finite())
}

/// `2024-06-12T10:33:21.000000Z`, the shape containers write.
fn parse_iso8601(text: &str) -> Option<i64> {
    let (date, time) = text.split_once(['T', ' '])?;
    let time = time.split(['.', 'Z', '+']).next()?;
    let mut date = date.splitn(3, '-').map(str::parse::<i64>);
    let mut time = time.splitn(3, ':').map(str::parse::<i64>);
    civil(
        date.next()?.ok()?,
        date.next()?.ok()?,
        date.next()?.ok()?,
        time.next()?.ok()?,
        time.next()?.ok()?,
        time.next().unwrap_or(Ok(0)).ok()?,
    )
}

/// Seconds since 1970 for a date and time read as UTC, or `None` for one that cannot be, such as
/// the zeros a camera writes when its clock was never set.
fn civil(year: i64, month: i64, day: i64, hour: i64, minute: i64, second: i64) -> Option<i64> {
    let valid = year > 0
        && (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && (0..24).contains(&hour)
        && (0..60).contains(&minute)
        && (0..=60).contains(&second);
    valid.then(|| days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// Howard Hinnant's `days_from_civil`: days since 1970-01-01 in the proleptic Gregorian calendar.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// A little-endian EXIF block holding an orientation and dates, as `(tag, "YYYY:MM:DD hh:mm:ss")`.
#[cfg(test)]
pub fn exif_block(orientation: Option<u16>, dates: &[(u16, &str)]) -> Vec<u8> {
    let mut first: Vec<[u32; 4]> = Vec::new();
    if let Some(turn) = orientation {
        first.push([0x0112, 3, 1, u32::from(turn)]);
    }
    let sub_at = 8 + 2 + 12 * (first.len() + usize::from(!dates.is_empty())) + 4;
    if !dates.is_empty() {
        first.push([0x8769, 4, 1, sub_at as u32]);
    }
    let mut text_at = sub_at + 2 + 12 * dates.len() + 4;
    let (mut sub, mut texts) = (Vec::new(), Vec::new());
    for (tag, date) in dates {
        let text = format!("{date}\0").into_bytes();
        sub.push([u32::from(*tag), 2, text.len() as u32, text_at as u32]);
        text_at += text.len();
        texts.extend(text);
    }
    let mut out = b"II*\0\x08\0\0\0".to_vec();
    let mut write = |entries: &[[u32; 4]]| {
        out.extend((entries.len() as u16).to_le_bytes());
        for [tag, kind, count, value] in entries {
            out.extend((*tag as u16).to_le_bytes());
            out.extend((*kind as u16).to_le_bytes());
            out.extend(count.to_le_bytes());
            out.extend(value.to_le_bytes());
        }
        out.extend(0u32.to_le_bytes());
    };
    write(&first);
    if !sub.is_empty() {
        write(&sub);
    }
    out.extend(texts);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const TAKEN: u16 = 0x9003;
    const DIGITISED: u16 = 0x9004;

    #[test]
    fn dates_count_seconds_from_1970() {
        assert_eq!(civil(1970, 1, 1, 0, 0, 0), Some(0));
        assert_eq!(civil(2000, 3, 1, 0, 0, 0), Some(951_868_800));
        assert_eq!(civil(2024, 6, 12, 10, 33, 21), Some(1_718_188_401));
        assert_eq!(civil(2024, 2, 29, 0, 0, 0), Some(1_709_164_800));
    }

    #[test]
    fn a_photo_says_when_it_was_taken() {
        let block = exif_block(None, &[(TAKEN, "2024:06:12 10:33:21")]);
        assert_eq!(exif_captured_at(block.clone()), Some(1_718_188_401));

        let mut behind_signature = b"Exif\0\0".to_vec();
        behind_signature.extend(block);
        assert_eq!(exif_captured_at(behind_signature), Some(1_718_188_401));
    }

    #[test]
    fn the_digitised_date_stands_in_when_the_taken_date_is_missing() {
        let block = exif_block(None, &[(DIGITISED, "2000:03:01 00:00:00")]);
        assert_eq!(exif_captured_at(block), Some(951_868_800));
    }

    #[test]
    fn a_camera_whose_clock_was_never_set_says_nothing() {
        let block = exif_block(None, &[(TAKEN, "0000:00:00 00:00:00")]);
        assert_eq!(exif_captured_at(block), None);
        assert_eq!(exif_captured_at(exif_block(Some(1), &[])), None);
        assert_eq!(exif_captured_at(b"not exif".to_vec()), None);
    }

    #[test]
    fn a_video_reports_its_shape_length_codec_and_date() {
        let report = json!({
            "streams": [
                { "codec_type": "audio", "codec_name": "aac" },
                { "codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080 }
            ],
            "format": {
                "duration": "12.345",
                "bit_rate": "8000000",
                "tags": { "creation_time": "2024-06-12T10:33:21.000000Z" }
            }
        });
        assert_eq!(
            video(&report),
            Probe {
                width: Some(1920),
                height: Some(1080),
                duration_ms: Some(12_345),
                codec: Some("h264".into()),
                bitrate: Some(8_000_000),
                captured_at: Some(1_718_188_401),
                captured_src: Some("container".into()),
            }
        );
    }

    /// A phone held upright records a landscape sensor and a note to turn it.
    #[test]
    fn a_video_recorded_sideways_is_shown_at_its_turned_shape() {
        let turned = |stream: serde_json::Value| {
            let probe = video(&json!({ "streams": [stream], "format": {} }));
            (probe.width, probe.height)
        };
        let base = json!({ "codec_type": "video", "width": 1920, "height": 1080 });
        let with = |extra: serde_json::Value| {
            let mut stream = base.clone();
            stream
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            stream
        };

        let matrix = with(json!({ "side_data_list": [{ "rotation": -90 }] }));
        assert_eq!(turned(matrix), (Some(1080), Some(1920)));
        let tagged = with(json!({ "tags": { "rotate": "90" } }));
        assert_eq!(turned(tagged), (Some(1080), Some(1920)));
        let upside_down = with(json!({ "side_data_list": [{ "rotation": 180 }] }));
        assert_eq!(turned(upside_down), (Some(1920), Some(1080)));
    }

    #[test]
    fn a_container_date_of_zero_was_never_set() {
        for zero in ["1904-01-01T00:00:00.000000Z", "1970-01-01T00:00:00.000000Z"] {
            let report = json!({ "format": { "tags": { "creation_time": zero } } });
            assert_eq!(video(&report).captured_at, None, "{zero}");
        }
        assert_eq!(parse_iso8601("nonsense"), None);
        assert_eq!(video(&json!({})), Probe::default());
    }
}
