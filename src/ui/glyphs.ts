// Segoe Fluent Icons code points, so each glyph is named once. They render in --font-glyph.
export const GLYPHS = {
  minimize: "\uE921",
  maximize: "\uE922",
  restore: "\uE923",
  close: "\uE8BB",
  dockLeft: "\uE90C",
  dockRight: "\uE90D",
} as const;

export type Glyph = keyof typeof GLYPHS;
