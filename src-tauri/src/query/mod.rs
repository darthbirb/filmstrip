//! The query language: text to a tree and back. Nothing here knows the schema; `db::search`
//! turns the tree into SQL. SCHEMA.md "Query language".

pub mod ast;
pub mod parser;
pub mod render;

use serde::Serialize;
use ts_rs::TS;

pub use ast::{Cmp, Expr, IsFlag, LabelMatch, StatusValue, Term};
pub use parser::{Fault, ParseError, parse, parse_conjuncts, split_path_segments};
pub use render::{bare_term, conjunct, label_term, path_term, render};

/// What the field understood of its text: the terms read, and why the rest did not read.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct Reading {
    pub terms: Vec<QueryTerm>,
    pub fault: Option<QueryFault>,
}

/// One part of the query's top-level AND, and where in the text it was typed, counted in UTF-16
/// units as the field counts.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct QueryTerm {
    /// The part as text that reads back as itself.
    pub text: String,
    pub shape: Shape,
    pub start: usize,
    pub end: usize,
}

/// The shape a part takes in the field: a folder, a place, a tag and a label as the details draw
/// them, and anything else as the words it was typed as.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum Shape {
    Path {
        titles: Vec<String>,
        exact: bool,
    },
    Place {
        #[ts(type = "\"sorting\" | \"trash\"")]
        place: String,
    },
    Tag {
        value: String,
    },
    Label {
        key: String,
        value: String,
    },
    Text,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct QueryFault {
    pub why: Fault,
    /// Where it starts, in UTF-16 units.
    pub at: usize,
}

/// Reads the field's text. A fault keeps the terms typed before it, which read on their own.
pub fn read(input: &str) -> Reading {
    match parse_conjuncts(input) {
        Ok((expr, spans)) => Reading {
            terms: terms_of(input, &expr, &spans),
            fault: None,
        },
        Err(err) => {
            let before = &input[..err.at];
            let terms = match parse_conjuncts(before) {
                Ok((expr, spans)) => terms_of(input, &expr, &spans),
                Err(_) => Vec::new(),
            };
            Reading {
                terms,
                fault: Some(QueryFault {
                    why: err.fault,
                    at: units(input, err.at),
                }),
            }
        }
    }
}

fn terms_of(input: &str, expr: &Expr, spans: &[(usize, usize)]) -> Vec<QueryTerm> {
    let parts: Vec<&Expr> = match expr {
        Expr::And(parts) if parts.len() == spans.len() => parts.iter().collect(),
        whole => vec![whole],
    };
    parts
        .into_iter()
        .zip(spans)
        .map(|(part, &(start, end))| QueryTerm {
            text: conjunct(part),
            shape: shape_of(part),
            start: units(input, start),
            end: units(input, end),
        })
        .collect()
}

fn shape_of(part: &Expr) -> Shape {
    let Expr::Term(term) = part else {
        return Shape::Text;
    };
    match term {
        Term::Path { path, exact } => Shape::Path {
            titles: split_path_segments(path),
            exact: *exact,
        },
        Term::Is(IsFlag::Sorting) => Shape::Place {
            place: "sorting".into(),
        },
        Term::Is(IsFlag::Trashed) => Shape::Place {
            place: "trash".into(),
        },
        Term::Tag {
            value,
            prefix: false,
        } => Shape::Tag {
            value: value.clone(),
        },
        Term::Label {
            key,
            value: LabelMatch::Exact(value),
        } => Shape::Label {
            key: key.clone(),
            value: value.clone(),
        },
        _ => Shape::Text,
    }
}

/// A byte offset as the number of UTF-16 units before it.
fn units(input: &str, at: usize) -> usize {
    input[..at].encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shapes(input: &str) -> Vec<(String, Shape)> {
        read(input)
            .terms
            .into_iter()
            .map(|term| (term.text, term.shape))
            .collect()
    }

    #[test]
    fn folders_places_tags_and_labels_take_shapes_and_the_rest_stays_text() {
        assert_eq!(
            shapes("path:Library/Cairo is:trashed tag:dawn time:dawn giza -tag:x (a or b)"),
            [
                (
                    "path:Library/Cairo".into(),
                    Shape::Path {
                        titles: vec!["Library".into(), "Cairo".into()],
                        exact: false
                    }
                ),
                (
                    "is:trashed".into(),
                    Shape::Place {
                        place: "trash".into()
                    }
                ),
                (
                    "tag:dawn".into(),
                    Shape::Tag {
                        value: "dawn".into()
                    }
                ),
                (
                    "time:dawn".into(),
                    Shape::Label {
                        key: "time".into(),
                        value: "dawn".into()
                    }
                ),
                ("giza".into(), Shape::Text),
                ("-tag:x".into(), Shape::Text),
                ("(a or b)".into(), Shape::Text),
            ]
        );
    }

    #[test]
    fn a_term_says_where_it_was_typed_in_the_fields_units() {
        let terms = read("é tag:dawn").terms;
        assert_eq!(
            (terms[1].start, terms[1].end),
            (2, 10),
            "é is one unit, not two bytes"
        );
        assert!(read("x").fault.is_none());
    }

    #[test]
    fn what_reads_before_a_fault_is_kept() {
        let reading = read("path:Library/Cairo giza (sphinx OR pyramid");
        let texts: Vec<_> = reading
            .terms
            .iter()
            .map(|term| term.text.as_str())
            .collect();
        assert_eq!(texts, ["path:Library/Cairo", "giza"]);
        assert_eq!(
            reading.fault,
            Some(QueryFault {
                why: Fault::UnclosedGroup {
                    after: Some("giza".into())
                },
                at: 24
            })
        );
        assert_eq!(read("  ").fault.map(|fault| fault.why), Some(Fault::Empty));
    }

    #[test]
    fn a_reading_crosses_to_the_window_in_camel_case() {
        let json = serde_json::to_value(read("tag:a (b")).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "terms": [{ "text": "tag:a", "shape": { "kind": "tag", "value": "a" }, "start": 0, "end": 5 }],
                "fault": { "why": { "kind": "unclosedGroup", "after": "tag:a" }, "at": 6 }
            })
        );
    }
}
