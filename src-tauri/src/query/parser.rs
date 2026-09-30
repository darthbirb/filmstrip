//! Text to [`Expr`], by recursive descent. SCHEMA.md "Query language" is the grammar. A `"…"`
//! span is one word, spaces and all, and composes with any key and with `-`. `\"` is a literal
//! quote and `\\` a literal backslash, quoted or not; no other `\` is special.

use std::fmt;

use serde::Serialize;
use ts_rs::TS;

use super::ast::{Cmp, Expr, IsFlag, LabelMatch, StatusValue, Term};
use crate::media::probe::days_from_civil;

/// Why a query does not read, and the byte offset in it where the trouble starts.
#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
    pub fault: Fault,
    pub at: usize,
}

/// The field says each in its own words. Components › "The field holds the query".
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Fault {
    /// Nothing but spaces.
    Empty,
    /// A `(` never closed, and the word just before it.
    UnclosedGroup { after: Option<String> },
    /// A `)` that closes nothing.
    UnopenedGroup,
    /// A `"` never closed, and the word it opens on.
    UnclosedQuote { before: Option<String> },
    /// A key that takes a certain shape of value, given another.
    BadValue { key: String, value: String },
    /// An `OR` or a `-` with nothing to act on.
    MissingTerm,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.fault {
            Fault::Empty => f.write_str("empty query"),
            Fault::UnclosedGroup { .. } => f.write_str("unclosed '('"),
            Fault::UnopenedGroup => f.write_str("unmatched ')'"),
            Fault::UnclosedQuote { .. } => f.write_str("unclosed '\"'"),
            Fault::BadValue { key, value } => write!(f, "'{value}' is not a value for '{key}:'"),
            Fault::MissingTerm => f.write_str("expected a term"),
        }
    }
}

pub fn parse(input: &str) -> Result<Expr, ParseError> {
    parse_conjuncts(input).map(|(expr, _)| expr)
}

/// As [`parse`], with the byte range each top-level conjunct was typed at, so the field can turn
/// exactly those words into terms.
pub fn parse_conjuncts(input: &str) -> Result<(Expr, Vec<(usize, usize)>), ParseError> {
    let tokens = tokenize(input)?;
    if tokens.is_empty() {
        return Err(ParseError {
            fault: Fault::Empty,
            at: 0,
        });
    }
    let mut parser = Parser {
        tokens: &tokens,
        pos: 0,
        end: input.len(),
    };
    let mut groups = vec![parser.parse_and()?];
    while matches!(parser.peek(), Some(Token { kind: Kind::Or, .. })) {
        parser.pos += 1;
        groups.push(parser.parse_and()?);
    }
    if let Some(token) = parser.peek() {
        return Err(ParseError {
            fault: Fault::UnopenedGroup,
            at: token.start,
        });
    }
    if groups.len() > 1 {
        let whole = (tokens[0].start, tokens[tokens.len() - 1].end);
        let parts = groups.into_iter().map(|group| join_and(group).0).collect();
        return Ok((Expr::Or(parts), vec![whole]));
    }
    let group = groups.pop().unwrap_or_default();
    let spans = group.iter().map(|(_, span)| *span).collect();
    Ok((join_and(group).0, spans))
}

/// One conjunct and the byte range it was read from.
type Spanned = (Expr, (usize, usize));

fn join_and(mut parts: Vec<Spanned>) -> Spanned {
    if parts.len() == 1 {
        return parts.pop().unwrap_or_else(|| unreachable!());
    }
    let span = (parts[0].1.0, parts[parts.len() - 1].1.1);
    (
        Expr::And(parts.into_iter().map(|(expr, _)| expr).collect()),
        span,
    )
}

#[derive(Debug, Clone, PartialEq)]
enum Kind {
    Open,
    Close,
    Or,
    Word(String),
}

#[derive(Debug, Clone)]
struct Token {
    kind: Kind,
    start: usize,
    end: usize,
}

fn tokenize(input: &str) -> Result<Vec<Token>, ParseError> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut start = None;
    // Whether any of the word came from inside quotes: a quoted `or` is text, not the keyword.
    let mut quoted = false;
    let mut open_quote: Option<usize> = None;
    let mut chars = input.char_indices().peekable();

    let flush = |word: &mut String,
                 start: &mut Option<usize>,
                 quoted: &mut bool,
                 end: usize,
                 tokens: &mut Vec<Token>| {
        if let Some(from) = start.take() {
            let text = std::mem::take(word);
            let kind = if !*quoted && text.eq_ignore_ascii_case("or") {
                Kind::Or
            } else {
                Kind::Word(text)
            };
            tokens.push(Token {
                kind,
                start: from,
                end,
            });
        }
        *quoted = false;
    };

    while let Some((at, ch)) = chars.next() {
        match ch {
            '\\' if matches!(chars.peek(), Some((_, '\\' | '"'))) => {
                start.get_or_insert(at);
                if let Some((_, escaped)) = chars.next() {
                    word.push(escaped);
                }
            }
            '"' => {
                start.get_or_insert(at);
                quoted = true;
                open_quote = if open_quote.is_some() { None } else { Some(at) };
            }
            '(' | ')' if open_quote.is_none() => {
                flush(&mut word, &mut start, &mut quoted, at, &mut tokens);
                let kind = if ch == '(' { Kind::Open } else { Kind::Close };
                tokens.push(Token {
                    kind,
                    start: at,
                    end: at + 1,
                });
            }
            c if c.is_whitespace() && open_quote.is_none() => {
                flush(&mut word, &mut start, &mut quoted, at, &mut tokens);
            }
            c => {
                start.get_or_insert(at);
                word.push(c);
            }
        }
    }
    if let Some(at) = open_quote {
        let before = input[at + 1..].split_whitespace().next().map(str::to_owned);
        return Err(ParseError {
            fault: Fault::UnclosedQuote { before },
            at,
        });
    }
    flush(&mut word, &mut start, &mut quoted, input.len(), &mut tokens);
    Ok(tokens)
}

/// The word the text ends on, unescaped, and the byte it starts at: none after a space, a
/// bracket or `OR`. A quote still open is read as closed, since it is still being typed.
pub fn last_word(input: &str) -> Option<(usize, String)> {
    let (tokens, end) = match tokenize(input) {
        Ok(tokens) => (tokens, input.len()),
        Err(_) => (tokenize(&format!("{input}\"")).ok()?, input.len() + 1),
    };
    match tokens.last()? {
        Token {
            kind: Kind::Word(word),
            start,
            end: at,
        } if *at == end => Some((*start, word.clone())),
        _ => None,
    }
}

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
    /// Where the input ends, for a fault that is the input running out.
    end: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn missing(&self) -> ParseError {
        ParseError {
            fault: Fault::MissingTerm,
            at: self.peek().map_or(self.end, |token| token.start),
        }
    }

    /// Everything up to an `OR`, a `)` or the end, ANDed.
    fn parse_and(&mut self) -> Result<Vec<Spanned>, ParseError> {
        let mut parts = Vec::new();
        while let Some(token) = self.peek() {
            if matches!(token.kind, Kind::Or | Kind::Close) {
                break;
            }
            parts.push(self.parse_unary()?);
        }
        if parts.is_empty() {
            return Err(self.missing());
        }
        Ok(parts)
    }

    fn parse_or(&mut self) -> Result<Expr, ParseError> {
        let mut parts = vec![join_and(self.parse_and()?).0];
        while matches!(self.peek(), Some(Token { kind: Kind::Or, .. })) {
            self.pos += 1;
            parts.push(join_and(self.parse_and()?).0);
        }
        Ok(if parts.len() == 1 {
            parts.pop().unwrap_or_else(|| unreachable!())
        } else {
            Expr::Or(parts)
        })
    }

    fn parse_unary(&mut self) -> Result<Spanned, ParseError> {
        let Some(token) = self.peek().cloned() else {
            return Err(self.missing());
        };
        match token.kind {
            Kind::Open => {
                let after = match self.pos.checked_sub(1).map(|at| &self.tokens[at].kind) {
                    Some(Kind::Word(word)) => Some(word.clone()),
                    _ => None,
                };
                let unclosed = ParseError {
                    fault: Fault::UnclosedGroup { after },
                    at: token.start,
                };
                self.pos += 1;
                if self.peek().is_none() {
                    return Err(unclosed);
                }
                let inner = self.parse_or()?;
                match self.peek() {
                    Some(Token {
                        kind: Kind::Close,
                        end,
                        ..
                    }) => {
                        let end = *end;
                        self.pos += 1;
                        Ok((inner, (token.start, end)))
                    }
                    _ => Err(unclosed),
                }
            }
            Kind::Close => Err(ParseError {
                fault: Fault::UnopenedGroup,
                at: token.start,
            }),
            Kind::Or => Err(self.missing()),
            Kind::Word(word) => {
                self.pos += 1;
                let span = (token.start, token.end);
                let term = |text: &str| {
                    parse_term(text).map_err(|fault| ParseError {
                        fault,
                        at: token.start,
                    })
                };
                match word.strip_prefix('-') {
                    Some("") => Err(ParseError {
                        fault: Fault::MissingTerm,
                        at: token.start,
                    }),
                    Some(rest) => Ok((Expr::Not(Box::new(Expr::Term(term(rest)?))), span)),
                    None => Ok((Expr::Term(term(&word)?), span)),
                }
            }
        }
    }
}

fn parse_term(word: &str) -> Result<Term, Fault> {
    if let Some(rest) = word.strip_prefix(':') {
        return Ok(Term::AnyLabel {
            value: label_match(rest),
        });
    }
    if let Some((key, value)) = word.split_once(':') {
        return keyed(key, value);
    }
    if word.starts_with('@') {
        return Ok(Term::AnyLabel {
            value: LabelMatch::Exact(word.to_owned()),
        });
    }
    Ok(Term::Bare {
        text: word.to_owned(),
    })
}

fn label_match(value: &str) -> LabelMatch {
    match value {
        "*" => LabelMatch::Present,
        _ => match value.strip_suffix('*') {
            Some(stem) => LabelMatch::Prefix(stem.to_owned()),
            None => LabelMatch::Exact(value.to_owned()),
        },
    }
}

/// A path's segments, `/` between them. `\/` is a `/` inside a title and `\\` a `\`; a `\`
/// before anything else is itself. Empty segments are dropped.
pub fn split_path_segments(path: &str) -> Vec<String> {
    let mut segments = Vec::new();
    let mut current = String::new();
    let mut chars = path.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '\\' if matches!(chars.peek(), Some('\\' | '/')) => {
                if let Some(escaped) = chars.next() {
                    current.push(escaped);
                }
            }
            '/' => segments.push(std::mem::take(&mut current)),
            c => current.push(c),
        }
    }
    segments.push(current);
    segments.retain(|segment| !segment.is_empty());
    segments
}

/// The keys the language reserves; any other key names a label.
pub const KEYS: &[&str] = &[
    "path", "tag", "type", "year", "date", "dur", "size", "w", "h", "is", "status",
];

fn keyed(key: &str, value: &str) -> Result<Term, Fault> {
    let bad = || Fault::BadValue {
        key: key.to_owned(),
        value: value.to_owned(),
    };
    let lower = key.to_ascii_lowercase();
    let compared = |to: fn(Cmp, i64) -> Term| {
        let (cmp, rest) = comparison(value);
        rest.parse::<i64>().map(|n| to(cmp, n)).map_err(|_| bad())
    };
    match lower.as_str() {
        "path" => Ok(match value.strip_prefix('=') {
            Some(exact) => Term::Path {
                path: exact.to_owned(),
                exact: true,
            },
            None => Term::Path {
                path: value.to_owned(),
                exact: false,
            },
        }),
        "tag" => Ok(match value.strip_suffix('*') {
            Some(stem) => Term::Tag {
                value: stem.to_owned(),
                prefix: true,
            },
            None => Term::Tag {
                value: value.to_owned(),
                prefix: false,
            },
        }),
        "type" => Ok(Term::Type(value.to_ascii_lowercase())),
        "year" => value.parse().map(Term::Year).map_err(|_| bad()),
        "date" => date_range(value).ok_or_else(bad),
        "dur" => {
            let (cmp, rest) = comparison(value);
            duration(rest)
                .map(|ms| Term::Duration { cmp, ms })
                .ok_or_else(bad)
        }
        "size" => {
            let (cmp, rest) = comparison(value);
            size(rest)
                .map(|bytes| Term::Size { cmp, bytes })
                .ok_or_else(bad)
        }
        "w" => compared(|cmp, px| Term::Width { cmp, px }),
        "h" => compared(|cmp, px| Term::Height { cmp, px }),
        "is" => match value.to_ascii_lowercase().as_str() {
            "favorite" | "favourite" => Ok(Term::Is(IsFlag::Favorite)),
            "untagged" => Ok(Term::Is(IsFlag::Untagged)),
            "sorting" => Ok(Term::Is(IsFlag::Sorting)),
            "trashed" => Ok(Term::Is(IsFlag::Trashed)),
            _ => Err(bad()),
        },
        "status" => match value.to_ascii_lowercase().as_str() {
            "wip" => Ok(Term::Status(StatusValue::Wip)),
            "complete" => Ok(Term::Status(StatusValue::Complete)),
            "none" => Ok(Term::Status(StatusValue::None)),
            _ => Err(bad()),
        },
        _ => Ok(Term::Label {
            key: key.to_owned(),
            value: label_match(value),
        }),
    }
}

/// `>=` and `<=` before `>`, `<` and `=`, so `>=` is never `>` and a number starting `=`.
fn comparison(s: &str) -> (Cmp, &str) {
    for (sign, cmp) in [
        (">=", Cmp::Ge),
        ("<=", Cmp::Le),
        (">", Cmp::Gt),
        ("<", Cmp::Lt),
        ("=", Cmp::Eq),
    ] {
        if let Some(rest) = s.strip_prefix(sign) {
            return (cmp, rest);
        }
    }
    (Cmp::Eq, s)
}

fn number_and_unit(s: &str) -> (&str, &str) {
    let at = s.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(s.len());
    s.split_at(at)
}

fn duration(s: &str) -> Option<i64> {
    let (number, unit) = number_and_unit(s);
    let n: i64 = number.parse().ok()?;
    let seconds = match unit.to_ascii_lowercase().as_str() {
        "s" => n,
        "m" => n * 60,
        "h" => n * 3_600,
        _ => return None,
    };
    Some(seconds * 1_000)
}

/// Binary units, as the file's own byte count is read.
fn size(s: &str) -> Option<i64> {
    let (number, unit) = number_and_unit(s);
    let n: i64 = number.parse().ok()?;
    let scale = match unit.to_ascii_lowercase().as_str() {
        "" | "b" => 1,
        "kb" => 1 << 10,
        "mb" => 1 << 20,
        "gb" => 1 << 30,
        _ => return None,
    };
    Some(n * scale)
}

#[derive(Clone, Copy)]
enum Span {
    Year,
    Month,
    Day,
}

/// `2024`, `2024-06` or `2024-06-15`, and how much of the calendar it names.
fn civil(s: &str) -> Option<(i64, i64, i64, Span)> {
    let parts: Vec<&str> = s.split('-').collect();
    let (y, m, d, span) = match parts.as_slice() {
        [y] => (y.parse().ok()?, 1, 1, Span::Year),
        [y, m] => (y.parse().ok()?, m.parse().ok()?, 1, Span::Month),
        [y, m, d] => (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?, Span::Day),
        _ => return None,
    };
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then_some((y, m, d, span))
}

fn day_start(y: i64, m: i64, d: i64) -> i64 {
    days_from_civil(y, m, d) * 86_400
}

/// The first moment after the period starting at that date.
fn period_end(y: i64, m: i64, d: i64, span: Span) -> i64 {
    match span {
        Span::Year => day_start(y + 1, 1, 1),
        Span::Month if m == 12 => day_start(y + 1, 1, 1),
        Span::Month => day_start(y, m + 1, 1),
        Span::Day => day_start(y, m, d) + 86_400,
    }
}

/// `2024-06..2024-08`, both named periods whole, or one period alone.
fn date_range(value: &str) -> Option<Term> {
    let (from, to) = value.split_once("..").unwrap_or((value, value));
    let (fy, fm, fd, _) = civil(from)?;
    let (ty, tm, td, span) = civil(to)?;
    Some(Term::DateRange {
        from: day_start(fy, fm, fd),
        to: period_end(ty, tm, td, span),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn term(query: &str) -> Term {
        match parse(query).unwrap() {
            Expr::Term(term) => term,
            other => panic!("expected one term, got {other:?}"),
        }
    }

    fn bare(text: &str) -> Expr {
        Expr::Term(Term::Bare { text: text.into() })
    }

    fn fault(query: &str) -> (Fault, usize) {
        let err = parse(query).unwrap_err();
        (err.fault, err.at)
    }

    #[test]
    fn a_bare_word_and_two_of_them_anded() {
        assert_eq!(
            term("sunset"),
            Term::Bare {
                text: "sunset".into()
            }
        );
        assert_eq!(
            parse("sunset beach").unwrap(),
            Expr::And(vec![bare("sunset"), bare("beach")])
        );
    }

    #[test]
    fn a_path_covers_below_or_only_itself() {
        assert_eq!(
            term("path:Library/Ana"),
            Term::Path {
                path: "Library/Ana".into(),
                exact: false
            }
        );
        assert_eq!(
            term("path:=Library/Ana"),
            Term::Path {
                path: "Library/Ana".into(),
                exact: true
            }
        );
    }

    #[test]
    fn tags_exact_and_by_prefix() {
        assert_eq!(
            term("tag:beach"),
            Term::Tag {
                value: "beach".into(),
                prefix: false
            }
        );
        assert_eq!(
            term("tag:bea*"),
            Term::Tag {
                value: "bea".into(),
                prefix: true
            }
        );
    }

    #[test]
    fn labels_by_key_by_value_and_present() {
        assert_eq!(
            term("location:cairo"),
            Term::Label {
                key: "location".into(),
                value: LabelMatch::Exact("cairo".into())
            }
        );
        assert_eq!(
            term("location:*"),
            Term::Label {
                key: "location".into(),
                value: LabelMatch::Present
            }
        );
        assert_eq!(
            term(":@ana"),
            Term::AnyLabel {
                value: LabelMatch::Exact("@ana".into())
            }
        );
        assert_eq!(term("@ana"), term(":@ana"));
    }

    #[test]
    fn an_unknown_key_is_a_label_not_a_fault() {
        assert_eq!(
            term("bogus:x"),
            Term::Label {
                key: "bogus".into(),
                value: LabelMatch::Exact("x".into())
            }
        );
    }

    #[test]
    fn kind_year_and_dates() {
        assert_eq!(term("type:video"), Term::Type("video".into()));
        assert_eq!(term("year:2024"), Term::Year(2024));
        assert_eq!(
            term("date:2024-06..2024-08"),
            Term::DateRange {
                from: day_start(2024, 6, 1),
                to: day_start(2024, 9, 1)
            }
        );
        assert_eq!(
            term("date:2024-06"),
            Term::DateRange {
                from: day_start(2024, 6, 1),
                to: day_start(2024, 7, 1)
            }
        );
        assert_eq!(
            term("date:2024-12-31"),
            Term::DateRange {
                from: day_start(2024, 12, 31),
                to: day_start(2025, 1, 1)
            }
        );
    }

    #[test]
    fn lengths_sizes_and_shapes_compare() {
        assert_eq!(
            term("dur:>30s"),
            Term::Duration {
                cmp: Cmp::Gt,
                ms: 30_000
            }
        );
        assert_eq!(
            term("dur:5m"),
            Term::Duration {
                cmp: Cmp::Eq,
                ms: 300_000
            }
        );
        assert_eq!(
            term("size:>100mb"),
            Term::Size {
                cmp: Cmp::Gt,
                bytes: 100 << 20
            }
        );
        assert_eq!(
            term("w:>=1920"),
            Term::Width {
                cmp: Cmp::Ge,
                px: 1920
            }
        );
        assert_eq!(
            term("h:<=1080"),
            Term::Height {
                cmp: Cmp::Le,
                px: 1080
            }
        );
    }

    #[test]
    fn every_is_and_status() {
        for (text, flag) in [
            ("is:favorite", IsFlag::Favorite),
            ("is:untagged", IsFlag::Untagged),
            ("is:sorting", IsFlag::Sorting),
            ("is:trashed", IsFlag::Trashed),
        ] {
            assert_eq!(term(text), Term::Is(flag), "{text}");
        }
        assert_eq!(term("status:wip"), Term::Status(StatusValue::Wip));
        assert_eq!(term("status:none"), Term::Status(StatusValue::None));
    }

    #[test]
    fn negation_grouping_and_or() {
        assert_eq!(
            parse("-tag:blurry").unwrap(),
            Expr::Not(Box::new(Expr::Term(Term::Tag {
                value: "blurry".into(),
                prefix: false
            })))
        );
        assert_eq!(
            parse("(a or b) c").unwrap(),
            Expr::And(vec![Expr::Or(vec![bare("a"), bare("b")]), bare("c")])
        );
        assert_eq!(
            parse("a b OR c d").unwrap(),
            Expr::Or(vec![
                Expr::And(vec![bare("a"), bare("b")]),
                Expr::And(vec![bare("c"), bare("d")]),
            ]),
            "OR splits the whole sequence, not the words either side"
        );
    }

    #[test]
    fn quotes_hold_spaces_parens_and_the_word_or() {
        assert_eq!(
            term("\"pinned folder\""),
            Term::Bare {
                text: "pinned folder".into()
            }
        );
        assert_eq!(
            term("tag:\"foo bar\""),
            Term::Tag {
                value: "foo bar".into(),
                prefix: false
            }
        );
        assert_eq!(
            parse("-\"pinned folder\"").unwrap(),
            Expr::Not(Box::new(bare("pinned folder")))
        );
        assert_eq!(term("\"or\""), Term::Bare { text: "or".into() });
        assert_eq!(
            term("\"a(b)c\""),
            Term::Bare {
                text: "a(b)c".into()
            }
        );
    }

    #[test]
    fn a_backslash_escapes_a_quote_or_itself_and_nothing_else() {
        assert_eq!(
            term("\"say \\\"hi\\\"\""),
            Term::Bare {
                text: "say \"hi\"".into()
            }
        );
        assert_eq!(
            term("say\\\"hi"),
            Term::Bare {
                text: "say\"hi".into()
            }
        );
        assert_eq!(
            term("a\\\\b"),
            Term::Bare {
                text: "a\\b".into()
            }
        );
        assert_eq!(
            term("\"a b\\\\\""),
            Term::Bare {
                text: "a b\\".into()
            }
        );
        assert_eq!(
            term("back\\slash"),
            Term::Bare {
                text: "back\\slash".into()
            }
        );
    }

    #[test]
    fn a_path_splits_on_slashes_but_not_escaped_ones() {
        assert_eq!(split_path_segments("Library/Ana"), ["Library", "Ana"]);
        assert_eq!(split_path_segments("rock\\/pop"), ["rock/pop"]);
        assert_eq!(split_path_segments("a\\\\/b"), ["a\\", "b"]);
        assert_eq!(split_path_segments("/Library//Ana/"), ["Library", "Ana"]);
    }

    #[test]
    fn each_fault_says_where_it_starts() {
        assert_eq!(fault(""), (Fault::Empty, 0));
        assert_eq!(fault("   "), (Fault::Empty, 0));
        assert_eq!(
            fault("cairo giza (sphinx OR pyramid"),
            (
                Fault::UnclosedGroup {
                    after: Some("giza".into())
                },
                11
            )
        );
        assert_eq!(fault("("), (Fault::UnclosedGroup { after: None }, 0));
        assert_eq!(fault("tag:a)"), (Fault::UnopenedGroup, 5));
        assert_eq!(
            fault("cairo \"old town"),
            (
                Fault::UnclosedQuote {
                    before: Some("old".into())
                },
                6
            )
        );
        assert_eq!(
            fault("year:abcd"),
            (
                Fault::BadValue {
                    key: "year".into(),
                    value: "abcd".into()
                },
                0
            )
        );
        assert_eq!(fault("a or"), (Fault::MissingTerm, 4));
        assert_eq!(fault("a -"), (Fault::MissingTerm, 2));
        assert!(parse("is:bogus").is_err());
    }

    #[test]
    fn each_conjunct_keeps_the_range_it_was_typed_at() {
        let (_, spans) = parse_conjuncts("path:Library  dawn (a or b) -tag:x").unwrap();
        assert_eq!(spans, [(0, 12), (14, 18), (19, 27), (28, 34)]);
        let (_, whole) = parse_conjuncts("a or b").unwrap();
        assert_eq!(whole, [(0, 6)], "a top-level OR is one conjunct");
    }
}
