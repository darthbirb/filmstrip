// For tests: a glyph is a character of its own, from the icon font's private area, and a label's
// words are what is left without it.

const PRIVATE = new RegExp(
  `[${String.fromCodePoint(0xe000)}-${String.fromCodePoint(0xf8ff)}]`,
  "g",
);

/** The text, without the glyphs drawn in it. */
export function withoutGlyphs(text: string | null | undefined) {
  return (text ?? "").replace(PRIVATE, "").trim();
}
