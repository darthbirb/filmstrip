---
version: alpha
name: Filmstrip
description: A quiet, dense Windows surface for looking at your own pictures. The chrome recedes so the pictures carry the colour.
colors:
  ground: "oklch(0.2 0.006 205)"
  panel: "oklch(0.235 0.006 205)"
  raised: "oklch(0.28 0.006 205)"
  well: "oklch(0.16 0.006 205)"
  line: "oklch(1 0 0 / 0.08)"
  line-strong: "oklch(1 0 0 / 0.18)"
  fg: "oklch(0.95 0.006 205)"
  fg-muted: "oklch(0.72 0.006 205)"
  fg-faint: "oklch(0.52 0.006 205)"
  hover: "oklch(1 0 0 / 0.06)"
  press: "oklch(1 0 0 / 0.04)"
  selected: "oklch(1 0 0 / 0.1)"
  accent: "#3fb8c5"
  accent-hover: "#6ccdd6"
  on-accent: "oklch(0.16 0.006 205)"
  focus: "oklch(0.95 0.006 205)"
  danger: "#c42b1c"
  danger-press: "rgb(196 43 28 / 0.9)"
  on-danger: "#fafafa"
typography:
  title:
    fontFamily: Segoe UI Variable Display
    fontSize: 1.125rem
    lineHeight: 1.5rem
    fontWeight: 600
  ui:
    fontFamily: Segoe UI Variable Text
    fontSize: 0.875rem
    lineHeight: 1.25rem
  caption:
    fontFamily: Segoe UI Variable Text
    fontSize: 0.8125rem
    lineHeight: 1rem
  label:
    fontFamily: Segoe UI Variable Text
    fontSize: 0.75rem
    lineHeight: 1rem
  glyph:
    fontFamily: Segoe Fluent Icons
    fontSize: 0.625rem
    lineHeight: "1"
  icon:
    fontFamily: Segoe Fluent Icons
    fontSize: 1rem
    lineHeight: "1"
rounded:
  control: 4px
  surface: 8px
  tile: 2px
spacing:
  caption: 2.25rem
  caption-button: 2.875rem
  mark: 1rem
  toolbar: 2.5rem
  rail: 2.5rem
  splitter: 0.375rem
  bar-field: 1.75rem
  bar-search: 36rem
  row: 2rem
  row-inset: 0.25rem
  indent: 1rem
  chevron: 1rem
  control: 2rem
  chip: 1.375rem
  tile-gap: 0.25rem
  strip: 4rem
  slider: 6rem
  slider-track: 0.25rem
  slider-thumb: 0.875rem
components:
  button:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.fg}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  button-hover:
    backgroundColor: "{colors.selected}"
  button-quiet:
    textColor: "{colors.fg-muted}"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  button-accent-hover:
    backgroundColor: "{colors.accent-hover}"
  button-disabled:
    textColor: "{colors.fg-faint}"
  glyph-button:
    textColor: "{colors.fg-muted}"
    typography: "{typography.icon}"
    rounded: "{rounded.control}"
    size: "{spacing.rail}"
  caption-button:
    textColor: "{colors.fg}"
    typography: "{typography.glyph}"
    width: "{spacing.caption-button}"
    height: "{spacing.caption}"
  caption-button-close-hover:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
  segmented:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  segmented-chosen:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    typography: "{typography.caption}"
  slider:
    backgroundColor: "{colors.line-strong}"
    width: "{spacing.slider}"
    height: "{spacing.slider-track}"
  slider-fill:
    backgroundColor: "{colors.accent}"
  slider-thumb:
    backgroundColor: "{colors.fg}"
    size: "{spacing.slider-thumb}"
  search-field:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.fg}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    height: "{spacing.bar-field}"
  tree-row:
    textColor: "{colors.fg}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    height: "{spacing.row}"
  tree-row-hover:
    backgroundColor: "{colors.hover}"
  tree-row-selected:
    backgroundColor: "{colors.selected}"
  tile:
    backgroundColor: "{colors.hover}"
    rounded: "{rounded.tile}"
  filmstrip:
    height: "{spacing.strip}"
  disclosure-row:
    textColor: "{colors.fg}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    height: "{spacing.row}"
  facts:
    textColor: "{colors.fg-muted}"
    typography: "{typography.caption}"
  chip:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.fg}"
    typography: "{typography.caption}"
    rounded: "{rounded.control}"
    height: "{spacing.chip}"
  chip-inherited:
    textColor: "{colors.fg-muted}"
  panel:
    backgroundColor: "{colors.panel}"
  overlay:
    backgroundColor: "{colors.panel}"
  media-well:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.tile}"
---

# Design

How Filmstrip looks. The values live in `src/styles/app.css`; this file says what each is for,
and `check:docs` fails when the two disagree. It follows Google's open DESIGN.md format: the
tokens above, then its sections in its order. DECISIONS.md "The design file" says why.

## Overview

**Reading this as:** a dense Windows utility for people looking at their own photos and videos
for hours, in a quiet, photo-first language, on Windows 11's own metrics.

Picture it in the evening at a desk, a library open for an hour at a time. The pictures are the
only colour on screen. The chrome is a dark neutral so that nothing tints how a photo reads, and
it is dark because a picture reads truest against a dark surround. Controls are small and exact,
like the tools people already use on Windows, and nothing performs.

**Dials:** variance 2 (a tool's alignment, not a composition), motion 3 (colour and state
only), density 7 (many rows, many tiles, no cards).

## Colors

**Two tiers.** A neutral ramp (`--ref-n-0` to `--ref-n-9`) and the mark's five colours are raw
values. Components never name them; they name the roles below, and a look changes the raw
values or the mapping.

| Role | For |
| --- | --- |
| `ground` | Behind the grid: the surround every picture is judged against. |
| `panel` | Navigation, the pane, the bar, and an overlay's body. |
| `raised` | Something lifted off a panel: the chosen segment. |
| `well` | Behind a picture shown large, where it does not fill its frame. |
| `line`, `line-strong` | Hairlines between regions; the slider's empty track and an inherited chip's edge. |
| `fg`, `fg-muted`, `fg-faint` | Text and glyphs: primary, secondary, unavailable. |
| `hover`, `press`, `selected` | Translucent fills that layer over any surface. |
| `accent`, `accent-hover`, `on-accent` | The one colour the chrome allows, and text set on it. |
| `focus` | The keyboard focus ring. |
| `danger`, `danger-press`, `on-danger` | The close button under the pointer, and destructive actions. |

**One accent, from the mark.** It marks what is current (the tile on show, the filmstrip's frame),
fills the slider, and fills the one action a surface leads with. It never colours a block of text
or decorates.

**Contrast is measured, not asserted.** In every look, `fg` and `fg-muted` reach 4.5:1 on
`ground`, `panel`, `raised` and `well`; `accent` and `focus` reach 3:1 on each; text on the
accent and on danger reaches 4.5:1. `src/styles/tokens.test.ts` paints each role and fails below.

## Typography

Segoe UI Variable, installed with every copy of Windows 11 and never fetched: Text for the
interface, Display for titles. Glyphs are Segoe Fluent Icons. Numbers that line up (counts,
sizes, dimensions, lengths, dates) use `font-numeric` with tabular figures.

| Role | Size and line | For |
| --- | --- | --- |
| `title` | 18 on 24, semibold | The pane's heading; a section in a dialog. |
| `ui` | 14 on 20 | Tree rows, buttons, anything read as a label. |
| `caption` | 13 on 16 | Secondary text, facts, chips, the bar. |
| `label` | 12 on 16 | The smallest text; dev readouts. |
| `glyph`, `icon` | 10 and 16 | Caption and chevron glyphs; panel and button glyphs. |

A step up the hierarchy comes from size and weight together, never from size alone.

## Layout

**Everything is in rem**, so the interface size scales it all at once, and "does it fit" is
measured, never a breakpoint. DECISIONS.md "The interface size" has the reasoning.

- **The frame** is the bar (`caption`, 36px), then three columns: navigation, the grid, the pane.
  Each column heads itself with a `toolbar` row. Folded panels leave a `rail`.
- **Rows** are `row` tall, indented by `indent` per level, and inset from the panel's edge by
  `row-inset`. **Controls** are `control` tall.
- **Tiles** are `tile-gap` apart; the filmstrip is `strip` tall.
- **Spacing** between unnamed things uses Tailwind's quarter-rem steps. A size that recurs gets a
  name here instead.

## Elevation & Depth

Depth is lightness, not shadow: `well`, `ground`, `panel` and `raised` step apart, and a hairline
separates regions of the same step. One shadow exists, `shadow-overlay`, for a folded panel
opened over the grid, which sits at `--z-overlay`. Nothing else floats yet; menus and dialogs
will add their levels here.

## Shapes

Three radii and no others: `control` for anything pressed or typed into, `surface` for panels
and overlays that stand free, `tile` for pictures. A shape inside another takes the inner radius.
Nothing is a pill, and no card holds another card.

## Components

Every shape here is a primitive in `src/ui/`, and every state is designed: rest, under the
pointer, pressed, keyboard focus, unavailable, and current where it applies. The specimen sheet
(the dev footer's `specimen`) shows each over the current look and the open library.

- **Button.** Standard is faintly filled, quiet fills only under the pointer, accent is the one
  action a surface leads with. Pressed as a toggle it takes `selected`. A press scales it to
  `--press-scale`; unavailable, it loses its fill and goes `fg-faint`.
- **Glyph button.** A `rail`-sized square with one glyph, its label as its tooltip.
- **Caption button.** Windows' own proportions; close turns `danger` under the pointer.
- **Segmented.** A few exclusive choices in one `hover` trough; the chosen one is `raised`.
- **Slider.** A thin track that fills with the accent up to its value, and a round thumb.
- **Search field.** A `hover` field led by the search glyph; it deepens to `selected` while typed in.
- **Tree row.** Chevron, glyph, label, and a count at its end in numeric figures. Selected rows
  take `selected`; a source that cannot be read is muted and says why.
- **Tile.** The picture, cropped to its cell. A veil of `hover` under the pointer; the tile on
  show in the pane carries an inset accent ring.
- **Filmstrip.** One row of tiles at `strip` height, each keeping its picture's shape within
  limits, the current one ringed; arrows step along it.
- **Disclosure.** A row that opens to show more: a chevron, a label, and a summary at its end
  while closed. It opens at once.
- **Facts.** Terms in `fg-muted` and values in `fg`, two aligned columns.
- **Chip.** A tag, or a label always showing its key. Filled when the item carries it itself,
  outlined when a folder passes it down.

**Motion is filtered by frequency.** Colour changes take `--motion-quick` (120ms) on the strong
ease-out. A button's press scale is the only movement. Nothing the keyboard does animates, and
nothing that happens tens of times a minute does: tiles, rows, the disclosure. Every transition
turns off under reduced motion.

## Do's and Don'ts

- **Do** take every size, colour, radius and duration from a token. A value the scale has no name
  for gets a name in `app.css` and here, in the same change.
- **Don't** reach for Tailwind's own palette, radii, text sizes or shadows: they are cleared, and
  the classes do nothing.
- **Don't** colour the chrome. One accent, used for what is current and what leads.
- **Don't** animate what the keyboard does, or anything repeated all day.
- **Don't** use side-stripe borders, gradient text, glass, shadows paired with borders, nested
  cards or pills.
- **Don't** show sample data on a surface. A surface shows only what it knows.
- **Don't** write em dashes in interface copy.

## Directions under consideration

Three looks on these tokens, switched live in the dev footer or with keys 1 to 3. The base is
the first; when one is chosen it becomes the base, the others are deleted, this section goes,
and DECISIONS.md records the choice.

- **Layered.** Windows 11's own manner: cool neutrals that step apart, 4px controls, 8px
  surfaces, rows inset from the panel edge, the mark's cyan as the accent.
- **Darkroom.** Deeper and flatter: near-black warm neutrals, regions split by hairlines rather
  than lightness, 2px corners and square tiles packed tight, Bahnschrift for titles and numbers,
  the mark's yellow as the accent and the focus ring.
- **Grey card.** Pictures on a true, untinted mid-grey, the surround photographers judge colour
  against, with darker chrome around it, softer 6px and 10px corners, tiles set apart like prints,
  and a lifted mark green as the accent.

## Keeping this file true

- The front matter lists the base look's tokens at the values `app.css` gives them.
  `check:docs` fails on a difference, on a token either side is missing, and on a component that
  names a token that does not exist.
- A slice that adds a shape adds its primitive to `src/ui/`, its entry here under Components and
  in the front matter, and its states to the specimen sheet.
- Google's own linter for the format is not used: it would be a new dependency, and it is alpha.
