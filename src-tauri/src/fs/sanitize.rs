//! Names a filesystem will accept. A folder title and a `disk_name` are real
//! names on disk, so Windows' rules are the app's rules.

use crate::error::{AppError, Reason, Result};

/// What Windows refuses in a path component, plus the control range. NTFS
/// rejects both, and neither belongs in a name typed or arriving from outside.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Reserved device names, with or without an extension: `CON`, `CON.txt` and
/// `con` are refused identically.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// NTFS's per-component limit, in UTF-16 units. The 260-character path limit
/// depends on depth, which is unknown here.
const MAX_UNITS: usize = 255;

/// The longest suffix `suffix_until_free` adds: a hyphen and a hyphenated uuid.
const UNIQUE_SUFFIX_UNITS: usize = 37;

/// The most an extension takes, so its stem keeps a character, even a surrogate pair, beside the
/// longest suffix.
const MAX_EXT_UNITS: usize = MAX_UNITS - 1 - UNIQUE_SUFFIX_UNITS - 2;

fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `text` cut at a char boundary to at most `max` UTF-16 units.
fn cut(text: &str, max: usize) -> &str {
    let mut used = 0;
    for (at, c) in text.char_indices() {
        used += c.len_utf16();
        if used > max {
            return &text[..at];
        }
    }
    text
}

/// One component with what Windows refuses removed, trailing dots and spaces
/// trimmed, the length capped at `max` units and a reserved name suffixed.
/// Empty becomes `fallback`.
fn component(raw: &str, fallback: &str, max: usize) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !FORBIDDEN.contains(c) && !c.is_control())
        .collect();
    let mut cleaned = cut(cleaned.trim_start(), max)
        .trim_end_matches(['.', ' '])
        .to_string();
    if cleaned.is_empty() {
        cleaned = cut(fallback, max).to_string();
    }
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(&cleaned)) {
        cleaned.push('_');
    }
    cleaned
}

/// The first character a typed name holds that Windows refuses.
fn forbidden(raw: &str) -> Option<char> {
    raw.chars()
        .find(|c| FORBIDDEN.contains(c) || c.is_control())
}

/// A typed name holding a character Windows refuses is refused with it named, as Explorer does,
/// rather than written without it.
pub fn refuse_forbidden(typed: &str) -> Result<()> {
    match forbidden(typed) {
        Some(character) => Err(AppError::refused(Reason::ForbiddenCharacter {
            character: character.to_string(),
        })),
        None => Ok(()),
    }
}

/// A folder title as a directory name. Case is preserved exactly; this only
/// removes what a directory name cannot hold at all.
pub fn folder_title(raw: &str) -> String {
    component(raw, "Untitled", MAX_UNITS)
}

/// A file name, split at the last dot so the extension survives untouched —
/// an overlong name loses the end of its stem, never its extension.
pub fn file_name(raw: &str) -> String {
    match raw.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
            let ext = component(ext, "dat", MAX_EXT_UNITS);
            let stem = component(stem, "file", MAX_UNITS - 1 - units(&ext));
            format!("{stem}.{ext}")
        }
        _ => component(raw, "file", MAX_UNITS),
    }
}

/// Appends " (2)", " (3)"… before the extension until `taken` says it is free, cutting the stem
/// so the name stays within the limit.
pub fn suffix_until_free(base: &str, mut taken: impl FnMut(&str) -> bool) -> String {
    if !taken(base) {
        return base.to_string();
    }
    let (stem, ext) = match base.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() && units(e) <= MAX_EXT_UNITS => (s, Some(e)),
        _ => (base, None),
    };
    let with = |suffix: String| {
        let tail = match ext {
            Some(ext) => format!("{suffix}.{ext}"),
            None => suffix,
        };
        format!("{}{tail}", cut(stem, MAX_UNITS - units(&tail)))
    };
    for n in 2..10_000 {
        let candidate = with(format!(" ({n})"));
        if !taken(&candidate) {
            return candidate;
        }
    }
    with(format!("-{}", uuid::Uuid::new_v4()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_what_a_filesystem_refuses() {
        assert_eq!(folder_title("A/B:C*D?"), "ABCD");
        assert_eq!(folder_title("Vacation. "), "Vacation");
        assert_eq!(folder_title("///"), "Untitled");
    }

    #[test]
    fn names_the_first_character_windows_refuses() {
        assert_eq!(forbidden("Cairo: day 2?"), Some(':'));
        assert_eq!(forbidden("tab\there"), Some('\t'));
        assert_eq!(forbidden("Giza (2).jpg"), None);
    }

    #[test]
    fn renames_a_reserved_device_name() {
        assert_eq!(folder_title("CON"), "CON_");
        assert_eq!(folder_title("con"), "con_");
        assert_eq!(file_name("NUL.txt"), "NUL_.txt");
    }

    #[test]
    fn an_extension_survives_sanitising_the_stem() {
        assert_eq!(file_name("my:photo.jpg"), "myphoto.jpg");
    }

    #[test]
    fn caps_an_overlong_component() {
        assert_eq!(folder_title(&"a".repeat(400)).len(), MAX_UNITS);
    }

    #[test]
    fn a_name_is_measured_in_utf16_units_not_bytes() {
        let arabic = "\u{645}".repeat(130);
        assert_eq!(folder_title(&arabic), arabic);
        assert_eq!(file_name(&format!("{arabic}.jpg")), format!("{arabic}.jpg"));

        let cjk = "\u{5199}".repeat(200);
        assert_eq!(folder_title(&cjk), cjk);
    }

    #[test]
    fn an_overlong_non_ascii_name_is_cut_at_a_char_boundary() {
        let arabic = folder_title(&"\u{645}".repeat(300));
        assert_eq!(arabic, "\u{645}".repeat(MAX_UNITS));

        let cjk = file_name(&format!("{}.jpg", "\u{5199}".repeat(300)));
        assert_eq!(cjk, format!("{}.jpg", "\u{5199}".repeat(MAX_UNITS - 4)));

        let emoji = folder_title(&"\u{1F600}".repeat(200));
        assert_eq!(emoji, "\u{1F600}".repeat(MAX_UNITS / 2));
        let emoji = file_name(&format!("{}.mov", "\u{1F600}".repeat(200)));
        assert_eq!(
            emoji,
            format!("{}.mov", "\u{1F600}".repeat((MAX_UNITS - 4) / 2))
        );
    }

    #[test]
    fn even_the_last_suffix_keeps_a_stem_and_the_limit() {
        let base = format!("{}.{}", "\u{1F600}".repeat(19), "e".repeat(MAX_EXT_UNITS));
        assert_eq!(file_name(&base), base);
        let free = suffix_until_free(&base, |_| true);
        assert!(free.starts_with('\u{1F600}'), "{free}");
        assert!(free.ends_with(&format!(".{}", "e".repeat(MAX_EXT_UNITS))));
        assert!(units(&free) <= MAX_UNITS);
    }

    #[test]
    fn a_suffix_never_takes_a_name_past_the_limit() {
        let long = format!("{}.jpg", "\u{1F600}".repeat(125));
        let free = suffix_until_free(&long, |c| c == long);
        assert!(free.ends_with(" (2).jpg"));
        assert!(units(&free) <= MAX_UNITS);
    }

    proptest::proptest! {
        #[test]
        fn any_name_comes_back_whole_and_within_the_limit(raw in "\\PC{0,400}") {
            for name in [folder_title(&raw), file_name(&raw)] {
                proptest::prop_assert!(!name.is_empty());
                proptest::prop_assert!(units(&name) <= MAX_UNITS);
            }
            let name = file_name(&raw);
            let free = suffix_until_free(&name, |c| c == name);
            proptest::prop_assert!(units(&free) <= MAX_UNITS);
        }
    }

    #[test]
    fn suffixing_finds_the_first_free_slot() {
        let taken = ["photo.jpg", "photo (2).jpg"];
        assert_eq!(
            suffix_until_free("photo.jpg", |c| taken.contains(&c)),
            "photo (3).jpg"
        );
        assert_eq!(suffix_until_free("photo.jpg", |_| false), "photo.jpg");
    }
}
