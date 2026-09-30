//! A query once read: SCHEMA.md "Query language" as data. Only `db::search` turns it into SQL.

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    And(Vec<Expr>),
    Or(Vec<Expr>),
    Not(Box<Expr>),
    Term(Term),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Term {
    /// `path:Library/Trips` covers the folder and everything below it; `path:=` the folder alone.
    /// The first segment is a source's title.
    Path {
        path: String,
        exact: bool,
    },
    /// A tag, which has no key: `tag:beach`, or `tag:bea*` for a prefix.
    Tag {
        value: String,
        prefix: bool,
    },
    /// A label by its key: `location:cairo`, `location:ca*`, or `location:*` for any value.
    Label {
        key: String,
        value: LabelMatch,
    },
    /// A label's value under any key: `:cairo`, or a bare `@ana`.
    AnyLabel {
        value: LabelMatch,
    },
    /// A word with no key, matched every way it can be at once. DECISIONS.md "Search".
    Bare {
        text: String,
    },
    /// `type:video`, the item's kind.
    Type(String),
    /// `year:2024`, of the date it was taken, or else modified.
    Year(i32),
    /// `date:2024-06..2024-08`, resolved by the parser to `[from, to)` in seconds since 1970.
    DateRange {
        from: i64,
        to: i64,
    },
    Duration {
        cmp: Cmp,
        ms: i64,
    },
    /// `size:>100mb`, in binary units.
    Size {
        cmp: Cmp,
        bytes: i64,
    },
    Width {
        cmp: Cmp,
        px: i64,
    },
    Height {
        cmp: Cmp,
        px: i64,
    },
    Is(IsFlag),
    /// A folder's own status, matching that folder and everything below it.
    Status(StatusValue),
}

#[derive(Debug, Clone, PartialEq)]
pub enum LabelMatch {
    Exact(String),
    Prefix(String),
    /// `key:*`: the label is there, whatever its value.
    Present,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cmp {
    Lt,
    Le,
    Gt,
    Ge,
    Eq,
}

impl Cmp {
    pub fn sql(self) -> &'static str {
        match self {
            Cmp::Lt => "<",
            Cmp::Le => "<=",
            Cmp::Gt => ">",
            Cmp::Ge => ">=",
            Cmp::Eq => "=",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IsFlag {
    Favorite,
    /// Carries no tag of its own; what it inherits does not count.
    Untagged,
    /// In a sorting source, as the Sorting Box shows it.
    Sorting,
    /// In the Trash, which a query leaves out unless it asks.
    Trashed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusValue {
    Wip,
    Complete,
    /// Under no folder that carries a status, its own included.
    None,
}
