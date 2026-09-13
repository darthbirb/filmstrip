// Material Symbols Rounded ligature names, so each glyph is named once. Glyph draws them.
export const GLYPHS = {
  minimize: "remove",
  maximize: "crop_square",
  restore: "filter_none",
  close: "close",
  hideLeft: "left_panel_close",
  showLeft: "left_panel_open",
  hideRight: "right_panel_close",
  showRight: "right_panel_open",
  chevronRight: "chevron_right",
  chevronDown: "expand_more",
  back: "arrow_left_alt",
  folder: "folder",
  source: "hard_drive",
  sortingBox: "inbox",
  trash: "delete",
  search: "search",
  view: "visibility",
} as const;

export type GlyphName = keyof typeof GLYPHS;
