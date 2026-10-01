// Terms written the way `query::render` in Rust writes them, so a control's term reads back as
// what it was written from. tests/fixtures/query-terms.json holds both to the same cases.

/** What Rust's `char::is_whitespace` splits on; JS's `\s` differs at U+0085 and U+FEFF. */
const WHITESPACE =
  "\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const NEEDS_QUOTES = new RegExp(`[${WHITESPACE}()]`);

/** Quotes what would not read back as one word; every `\` is doubled before any `"` is escaped. */
export function quoteWord(value: string) {
  const quoted = value === "" || NEEDS_QUOTES.test(value) || value.toLowerCase() === "or";
  const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return quoted ? `"${escaped}"` : escaped;
}

/** `path:` from titles, the source's first; a title's own `\` and `/` are escaped, in that order. */
export function pathTerm(titles: readonly string[], exact = false) {
  const path = titles.map((title) => title.replaceAll("\\", "\\\\").replaceAll("/", "\\/"));
  return `path:${exact ? "=" : ""}${quoteWord(path.join("/"))}`;
}

export function bareTerm(value: string) {
  return quoteWord(value);
}

export function tagTerm(value: string) {
  return `tag:${quoteWord(value)}`;
}

export function labelTerm(key: string, value: string) {
  return `${key}:${quoteWord(value)}`;
}
