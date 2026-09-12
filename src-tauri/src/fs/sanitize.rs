//! Names a filesystem will accept. A folder title and a `disk_name` are real
//! names on disk, so Windows' rules are the app's rules.

/// What Windows refuses in a path component, plus the control range. NTFS
/// rejects both, and neither belongs in a name typed or arriving from outside.
const FORBIDDEN: &[char] = &['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Reserved device names, with or without an extension: `CON`, `CON.txt` and
/// `con` are refused identically.
const RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// NTFS's per-component limit. The 260-character path limit depends on depth,
/// which is unknown here.
const MAX_COMPONENT_LEN: usize = 255;

/// One component with what Windows refuses removed, trailing dots and spaces
/// trimmed, a reserved name suffixed and the length capped. Empty becomes `fallback`.
fn component(raw: &str, fallback: &str) -> String {
    let mut cleaned: String = raw
        .chars()
        .filter(|c| !FORBIDDEN.contains(c) && !c.is_control())
        .collect();
    cleaned = cleaned
        .trim_end_matches(['.', ' '])
        .trim_start()
        .to_string();

    if cleaned.is_empty() {
        cleaned = fallback.to_string();
    }
    if RESERVED.iter().any(|r| r.eq_ignore_ascii_case(&cleaned)) {
        cleaned.push('_');
    }
    if cleaned.len() > MAX_COMPONENT_LEN {
        cleaned.truncate(MAX_COMPONENT_LEN);
        cleaned = cleaned.trim_end_matches(['.', ' ']).to_string();
        if cleaned.is_empty() {
            cleaned = fallback.chars().take(MAX_COMPONENT_LEN).collect();
        }
    }
    cleaned
}

/// A folder title as a directory name. Case is preserved exactly; this only
/// removes what a directory name cannot hold at all.
pub fn folder_title(raw: &str) -> String {
    component(raw, "Untitled")
}

/// A file name, split at the last dot so the extension survives untouched —
/// an extension is never itself the reason a name is truncated.
pub fn file_name(raw: &str) -> String {
    match raw.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() && !ext.is_empty() => {
            format!("{}.{}", component(stem, "file"), component(ext, "dat"))
        }
        _ => component(raw, "file"),
    }
}

/// Appends " (2)", " (3)"… before the extension until `taken` says it is free.
pub fn suffix_until_free(base: &str, mut taken: impl FnMut(&str) -> bool) -> String {
    if !taken(base) {
        return base.to_string();
    }
    let (stem, ext) = match base.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() => (s.to_string(), Some(e.to_string())),
        _ => (base.to_string(), None),
    };
    for n in 2..10_000 {
        let candidate = match &ext {
            Some(ext) => format!("{stem} ({n}).{ext}"),
            None => format!("{stem} ({n})"),
        };
        if !taken(&candidate) {
            return candidate;
        }
    }
    // Unreachable in practice — ten thousand siblings sharing a stem — but the
    // caller still needs a name back.
    format!("{stem}-{}", uuid::Uuid::new_v4())
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
        assert_eq!(folder_title(&"a".repeat(400)).len(), MAX_COMPONENT_LEN);
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
