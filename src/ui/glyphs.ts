// Each glyph's Phosphor icon and its codepoint, the same in both families. shapes.test holds them to the package.
export const GLYPHS = {
  minimize: { icon: "minus", code: 0xe32a },
  maximize: { icon: "square", code: 0xe45e },
  restore: { icon: "copy", code: 0xe1ca },
  close: { icon: "x", code: 0xe4f6 },
  settings: { icon: "gear", code: 0xe270 },
  panel: { icon: "sidebar-simple", code: 0xec24 },
  chevronLeft: { icon: "caret-left", code: 0xe138 },
  chevronRight: { icon: "caret-right", code: 0xe13a },
  chevronDown: { icon: "caret-down", code: 0xe136 },
  folder: { icon: "folder", code: 0xe24a },
  folderOpen: { icon: "folder-open", code: 0xe256 },
  source: { icon: "hard-drives", code: 0xe2a0 },
  sortingBox: { icon: "tray", code: 0xe4aa },
  trash: { icon: "trash", code: 0xe4a6 },
  view: { icon: "eye", code: 0xe220 },
  image: { icon: "image", code: 0xe2ca },
  tileSize: { icon: "grid-four", code: 0xe296 },
  rows: { icon: "rows", code: 0xe5a2 },
  squares: { icon: "squares-four", code: 0xe464 },
  appearance: { icon: "monitor", code: 0xe32e },
  search: { icon: "magnifying-glass", code: 0xe30c },
} as const;

export type GlyphName = keyof typeof GLYPHS;
