//! An [`Expr`] back to text that reads as the same tree, and the writers a control uses to put a
//! term into the field. `src/lib/queryTerm.ts` writes terms by the same rules, held to them by a
//! shared fixture.

use super::ast::{Cmp, Expr, IsFlag, LabelMatch, StatusValue, Term};

pub fn render(expr: &Expr) -> String {
    match expr {
        Expr::And(parts) => parts.iter().map(conjunct).collect::<Vec<_>>().join(" "),
        Expr::Or(parts) => parts
            .iter()
            .map(|part| match part {
                Expr::Or(_) => format!("({})", render(part)),
                other => render(other),
            })
            .collect::<Vec<_>>()
            .join(" or "),
        Expr::Not(inner) => format!("-{}", render(inner)),
        Expr::Term(term) => render_term(term),
    }
}

/// A part of an AND, as the field shows it on its own: a group keeps its brackets, so the parts
/// joined again by spaces read as the same tree.
pub fn conjunct(expr: &Expr) -> String {
    match expr {
        Expr::And(_) | Expr::Or(_) => format!("({})", render(expr)),
        other => render(other),
    }
}

fn render_term(term: &Term) -> String {
    match term {
        Term::Path { path, exact } => {
            format!("path:{}{}", if *exact { "=" } else { "" }, quote_word(path))
        }
        Term::Tag { value, prefix } => {
            let star = if *prefix { "*" } else { "" };
            format!("tag:{}", quote_word(&format!("{value}{star}")))
        }
        Term::Label { key, value } => format!("{key}:{}", quote_word(&label_value(value))),
        // Only a value already starting `@` can go bare; any other needs the colon to read back.
        Term::AnyLabel {
            value: LabelMatch::Exact(v),
        } if v.starts_with('@') => quote_word(v),
        Term::AnyLabel { value } => format!(":{}", quote_word(&label_value(value))),
        Term::Bare { text } => quote_word(text),
        Term::Type(kind) => format!("type:{}", quote_word(kind)),
        Term::Year(year) => format!("year:{year}"),
        Term::DateRange { from, to } => date_range(*from, *to),
        Term::Duration { cmp, ms } => format!("dur:{}{}", sign(*cmp), duration(*ms)),
        Term::Size { cmp, bytes } => format!("size:{}{}", sign(*cmp), size(*bytes)),
        Term::Width { cmp, px } => format!("w:{}{px}", sign(*cmp)),
        Term::Height { cmp, px } => format!("h:{}{px}", sign(*cmp)),
        Term::Is(flag) => format!("is:{}", is_word(*flag)),
        Term::Status(status) => format!(
            "status:{}",
            match status {
                StatusValue::Wip => "wip",
                StatusValue::Complete => "complete",
                StatusValue::None => "none",
            }
        ),
    }
}

pub fn is_word(flag: IsFlag) -> &'static str {
    match flag {
        IsFlag::Favorite => "favorite",
        IsFlag::Untagged => "untagged",
        IsFlag::Sorting => "sorting",
        IsFlag::Trashed => "trashed",
    }
}

/// Quotes what would not read back as one word: a space, a bracket, nothing at all, or `or`.
/// Every `\` is doubled before every `"` is escaped, or the second would double the first's work.
fn quote_word(s: &str) -> String {
    let quoted = s.is_empty()
        || s.chars().any(|c| c.is_whitespace() || c == '(' || c == ')')
        || s.eq_ignore_ascii_case("or");
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
    if quoted {
        format!("\"{escaped}\"")
    } else {
        escaped
    }
}

/// `path:` from titles, the source's first. A title's own `\` and `/` are escaped, in that order.
pub fn path_term(titles: &[String], exact: bool) -> String {
    let path = titles
        .iter()
        .map(|title| title.replace('\\', "\\\\").replace('/', "\\/"))
        .collect::<Vec<_>>()
        .join("/");
    format!("path:{}{}", if exact { "=" } else { "" }, quote_word(&path))
}

pub fn bare_term(value: &str) -> String {
    quote_word(value)
}

pub fn tag_term(value: &str) -> String {
    format!("tag:{}", quote_word(value))
}

pub fn label_term(key: &str, value: &str) -> String {
    format!("{key}:{}", quote_word(value))
}

/// `Eq` has no sign: `w:1920` is what anyone types.
fn sign(cmp: Cmp) -> &'static str {
    match cmp {
        Cmp::Eq => "",
        other => other.sql(),
    }
}

fn label_value(value: &LabelMatch) -> String {
    match value {
        LabelMatch::Exact(v) => v.clone(),
        LabelMatch::Prefix(v) => format!("{v}*"),
        LabelMatch::Present => "*".into(),
    }
}

/// The largest unit that is exact; the parser only takes whole seconds.
fn duration(ms: i64) -> String {
    if ms % 3_600_000 == 0 {
        format!("{}h", ms / 3_600_000)
    } else if ms % 60_000 == 0 {
        format!("{}m", ms / 60_000)
    } else {
        format!("{}s", ms / 1_000)
    }
}

fn size(bytes: i64) -> String {
    for (unit, shift) in [("gb", 30), ("mb", 20), ("kb", 10)] {
        if bytes != 0 && bytes % (1 << shift) == 0 {
            return format!("{}{unit}", bytes >> shift);
        }
    }
    bytes.to_string()
}

/// A whole year, month or day as itself, and anything else as an explicit range of days.
fn date_range(from: i64, to: i64) -> String {
    let (fy, fm, fd) = civil_from_days(from.div_euclid(86_400));
    let (ly, lm, ld) = civil_from_days(to.div_euclid(86_400) - 1);
    if (fm, fd, lm, ld) == (1, 1, 12, 31) && fy == ly {
        return format!("date:{fy}");
    }
    if fd == 1 && (fy, fm) == (ly, lm) && ld == days_in_month(ly, lm) {
        return format!("date:{fy}-{fm:02}");
    }
    if (fy, fm, fd) == (ly, lm, ld) {
        return format!("date:{fy}-{fm:02}-{fd:02}");
    }
    format!("date:{fy}-{fm:02}-{fd:02}..{ly}-{lm:02}-{ld:02}")
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        4 | 6 | 9 | 11 => 30,
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        _ => 31,
    }
}

/// Howard Hinnant's `civil_from_days`, the inverse of `media::probe::days_from_civil`.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::query::{parse, split_path_segments};

    fn round_trips(query: &str) {
        let expr = parse(query).unwrap_or_else(|e| panic!("{query:?} does not read: {e}"));
        let text = render(&expr);
        let again = parse(&text).unwrap_or_else(|e| panic!("{query:?} rendered {text:?}: {e}"));
        assert_eq!(expr, again, "{query:?} rendered {text:?}, a different tree");
    }

    #[test]
    fn every_kind_of_term_reads_back_as_itself() {
        for query in [
            "path:Library/Ana",
            "path:=Library/Ana",
            "tag:beach",
            "tag:bea*",
            "location:cairo",
            "location:ca*",
            "location:*",
            ":@ana",
            ":cairo",
            ":ca*",
            "@ana",
            "sunset",
            "type:video",
            "year:2024",
            "date:2024-06..2024-08",
            "date:2024-06",
            "date:2024",
            "date:2024-06-15",
            "date:1969-12-31",
            "dur:>30s",
            "dur:5m",
            "dur:2h",
            "size:>100mb",
            "size:1gb",
            "size:512kb",
            "size:100",
            "size:0",
            "w:>=1920",
            "h:<800",
            "is:favorite",
            "is:untagged",
            "is:sorting",
            "is:trashed",
            "status:wip",
            "status:complete",
            "status:none",
            "-tag:blurry",
            "(a or b) c",
            "a b or c d",
            "(a or b) or c",
            "((a b) c)",
            "\"pinned folder\"",
            "tag:\"foo bar\"",
            "path:\"My Trip/Day One\"",
            "say\\\"hi",
            "path:rock\\/pop",
            "say\\\\hi",
            "\"a b\\\\\"",
            "\"\"",
        ] {
            round_trips(query);
        }
    }

    #[test]
    fn a_whole_period_renders_as_itself() {
        let text = |query: &str| render(&parse(query).unwrap());
        assert_eq!(text("date:2024"), "date:2024");
        assert_eq!(
            text("date:2024-02"),
            "date:2024-02",
            "a leap February is whole"
        );
        assert_eq!(text("date:2024-06-15"), "date:2024-06-15");
        assert_eq!(text("date:2024-06..2024-08"), "date:2024-06-01..2024-08-31");
        assert_eq!(text("size:1073741824"), "size:1gb");
        assert_eq!(text("dur:3600s"), "dur:1h");
        assert_eq!(text("dur:90s"), "dur:90s");
        assert_eq!(text("w:=1920"), "w:1920");
    }

    #[test]
    fn a_conjunct_keeps_its_group() {
        let expr = parse("(a or b) \"pinned folder\" c").unwrap();
        let Expr::And(parts) = &expr else {
            panic!("an AND")
        };
        let texts: Vec<_> = parts.iter().map(conjunct).collect();
        assert_eq!(texts, ["(a or b)", "\"pinned folder\"", "c"]);
        assert_eq!(parse(&texts.join(" ")).unwrap(), expr);
    }

    #[test]
    fn civil_days_go_both_ways() {
        for days in [-1, 0, 59, 10_957, 19_723, 19_782, 2_932_896] {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(crate::media::probe::days_from_civil(y, m, d), days);
        }
    }

    /// The same cases `src/lib/queryTerm.test.ts` reads, so the two writers cannot drift apart.
    #[test]
    fn the_writers_agree_with_the_shared_fixture() {
        let text = include_str!("../../../tests/fixtures/query-terms.json");
        let cases: Vec<serde_json::Value> = serde_json::from_str(text).unwrap();
        assert!(!cases.is_empty());
        let string = |value: &serde_json::Value| value.as_str().unwrap().to_owned();
        for case in &cases {
            let args = case["args"].as_array().unwrap();
            let written = match case["fn"].as_str().unwrap() {
                "quoteWord" => quote_word(&string(&args[0])),
                "pathTerm" => {
                    let titles: Vec<String> =
                        args[0].as_array().unwrap().iter().map(string).collect();
                    path_term(&titles, args[1].as_bool().unwrap())
                }
                "bareTerm" => bare_term(&string(&args[0])),
                "labelTerm" => label_term(&string(&args[0]), &string(&args[1])),
                "tagTerm" => tag_term(&string(&args[0])),
                other => panic!("no writer named {other}"),
            };
            assert_eq!(written, case["expected"].as_str().unwrap(), "{case}");
        }
    }

    /// A folder whose titles use the escapes themselves still comes back as those titles.
    #[test]
    fn a_path_term_names_exactly_the_titles_it_was_written_from() {
        for titles in [
            vec!["Music", "rock/pop"],
            vec!["a\\", "b"],
            vec!["a/b"],
            vec!["Ana's \"Big\" Trip"],
            vec!["(a)", "b c", "\\/"],
        ] {
            let titles: Vec<String> = titles.into_iter().map(str::to_owned).collect();
            for exact in [false, true] {
                let text = path_term(&titles, exact);
                let Expr::Term(Term::Path { path, exact: read }) = parse(&text).unwrap() else {
                    panic!("{text:?} is not a path")
                };
                assert_eq!(read, exact);
                assert_eq!(split_path_segments(&path), titles, "{text:?}");
            }
        }
    }

    // Generated trees and titles, so the round trip holds beyond the cases anyone thought to list.

    use crate::media::probe::days_from_civil;
    use crate::query::parser::KEYS;
    use proptest::prelude::*;

    fn ident() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9]{0,6}"
    }

    /// Sometimes two words, which a term can only hold quoted.
    fn phrase() -> impl Strategy<Value = String> {
        prop_oneof![
            ident(),
            (ident(), ident()).prop_map(|(a, b)| format!("{a} {b}"))
        ]
    }

    fn label_match() -> impl Strategy<Value = LabelMatch> {
        prop_oneof![
            phrase().prop_map(LabelMatch::Exact),
            phrase().prop_map(LabelMatch::Prefix),
            Just(LabelMatch::Present),
        ]
    }

    fn cmp() -> impl Strategy<Value = Cmp> {
        prop_oneof![
            Just(Cmp::Lt),
            Just(Cmp::Le),
            Just(Cmp::Gt),
            Just(Cmp::Ge),
            Just(Cmp::Eq)
        ]
    }

    /// Every term the parser can produce. A label's key is never a reserved one, and a bare word
    /// is never `or`: the parser reads those as something else, so no tree holds them.
    fn term() -> impl Strategy<Value = Term> {
        let year_start = |year: i64| days_from_civil(year, 1, 1) * 86_400;
        prop_oneof![
            (phrase(), any::<bool>()).prop_map(|(path, exact)| Term::Path { path, exact }),
            (phrase(), any::<bool>()).prop_map(|(value, prefix)| Term::Tag { value, prefix }),
            (
                ident().prop_filter("a reserved key", |key| !KEYS.contains(&key.as_str())),
                label_match()
            )
                .prop_map(|(key, value)| Term::Label { key, value }),
            label_match().prop_map(|value| Term::AnyLabel { value }),
            phrase()
                .prop_filter("the keyword", |text| text != "or")
                .prop_map(|text| Term::Bare { text }),
            ident().prop_map(Term::Type),
            (1970i32..2100).prop_map(Term::Year),
            (0i64..50, 0i64..50).prop_map(move |(a, b)| Term::DateRange {
                from: year_start(2000 + a.min(b)),
                to: year_start(2001 + a.max(b)),
            }),
            (cmp(), 0i64..48).prop_map(|(cmp, hours)| Term::Duration {
                cmp,
                ms: hours * 3_600_000
            }),
            (cmp(), 0i64..64).prop_map(|(cmp, gb)| Term::Size {
                cmp,
                bytes: gb << 30
            }),
            (cmp(), 0i64..8000).prop_map(|(cmp, px)| Term::Width { cmp, px }),
            (cmp(), 0i64..8000).prop_map(|(cmp, px)| Term::Height { cmp, px }),
            prop_oneof![
                Just(IsFlag::Favorite),
                Just(IsFlag::Untagged),
                Just(IsFlag::Sorting),
                Just(IsFlag::Trashed)
            ]
            .prop_map(Term::Is),
            prop_oneof![
                Just(StatusValue::Wip),
                Just(StatusValue::Complete),
                Just(StatusValue::None)
            ]
            .prop_map(Term::Status),
        ]
    }

    /// A `-` only ever negates one term, and a group never holds one part: the parser makes
    /// neither, so neither is generated.
    fn expr() -> impl Strategy<Value = Expr> {
        let leaf = prop_oneof![
            term().prop_map(Expr::Term),
            term().prop_map(|term| Expr::Not(Box::new(Expr::Term(term)))),
        ];
        leaf.prop_recursive(3, 32, 4, |inner| {
            prop_oneof![
                prop::collection::vec(inner.clone(), 2..4).prop_map(Expr::And),
                prop::collection::vec(inner, 2..4).prop_map(Expr::Or),
            ]
        })
    }

    /// Titles made of the very characters the escapes give meaning to.
    fn wild_titles() -> impl Strategy<Value = Vec<String>> {
        let character = prop::sample::select(vec!['a', 'z', '0', '\\', '"', '/', '(', ')', ' ']);
        let title = prop::collection::vec(character, 1..8)
            .prop_map(|chars| chars.into_iter().collect::<String>());
        prop::collection::vec(title, 1..5)
    }

    proptest! {
        #![proptest_config(ProptestConfig { cases: 512, ..ProptestConfig::default() })]

        #[test]
        fn any_tree_renders_to_text_that_reads_as_itself(tree in expr()) {
            let text = render(&tree);
            let again = parse(&text);
            prop_assert_eq!(again.as_ref(), Ok(&tree), "rendered {:?}", text);
        }

        #[test]
        fn any_titles_come_back_from_the_path_term_written_from_them(
            titles in wild_titles(),
            exact in any::<bool>(),
        ) {
            let text = path_term(&titles, exact);
            let parsed = parse(&text);
            let Ok(Expr::Term(Term::Path { path, exact: read })) = parsed else {
                return Err(TestCaseError::fail(format!("{text:?} read as {parsed:?}")));
            };
            prop_assert_eq!(read, exact);
            prop_assert_eq!(split_path_segments(&path), titles, "{:?}", text);
        }
    }
}
