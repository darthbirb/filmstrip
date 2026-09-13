---
version: alpha
name: Filmstrip
description: A quiet, dense Windows surface for looking at your own pictures. Warm neutral chrome, no accent, colour kept for what it means.
colors:
  well: "#0e0e0e"
  ground: "#141414"
  panel: "#1b1b1b"
  inset: "#1f1f1f"
  raised: "#242424"
  raised-hi: "#2e2e2e"
  plate: "#b9b6b0"
  hatch: "#3c3a37"
  hatch-alt: "#333130"
  line: "#262626"
  line-control: "#303030"
  line-control-hi: "#3a3a3a"
  line-strong: "#6b6863"
  fg-hi: "#f4f3f1"
  fg: "#eceae7"
  fg-mid: "#a8a5a0"
  fg-dim: "#908c86"
  fg-faint: "#5c5a56"
  on-plate: "#17181a"
  on-plate-dim: "rgb(23 24 26 / 0.62)"
  focus: "#f2f2f2"
  wash: "rgb(255 255 255 / 0.09)"
  badge: "rgb(242 242 242 / 0.94)"
  danger: "#c25a4a"
  danger-press: "#a94f41"
  on-danger: "#f2f2f2"
typography:
  title:
    fontFamily: Segoe UI Variable Text
    fontSize: 1.0625rem
    lineHeight: 1.5rem
    fontWeight: 600
    letterSpacing: -0.02em
  row:
    fontFamily: Segoe UI Variable Text
    fontSize: 0.875rem
    lineHeight: 1.25rem
  ui:
    fontFamily: Segoe UI Variable Text
    fontSize: 0.8125rem
    lineHeight: 1.25rem
  small:
    fontFamily: Segoe UI Variable Text
    fontSize: 0.75rem
    lineHeight: 1rem
  eyebrow:
    fontFamily: Segoe UI Variable Text
    fontSize: 0.6875rem
    lineHeight: 1rem
    fontWeight: 600
    letterSpacing: 0.12em
  glyph:
    fontFamily: Segoe Fluent Icons
    fontSize: 0.625rem
    lineHeight: "1"
  icon:
    fontFamily: Segoe Fluent Icons
    fontSize: 1rem
    lineHeight: "1"
rounded:
  badge: 6px
  nested: 8px
  control: 10px
spacing:
  caption: 2.25rem
  caption-button: 2.875rem
  mark: 1.125rem
  toolbar: 2.75rem
  rail: 2.75rem
  splitter: 0.25rem
  grip: 1.625rem
  grip-width: 0.125rem
  bar-field: 1.75rem
  bar-search: 36rem
  row: 2.125rem
  row-inset: 0.5rem
  row-gap: 0.1875rem
  indent: 1rem
  chevron: 1.25rem
  control: 2rem
  segment-inset: 0.1875rem
  chip: 1.625rem
  badge: 1.25rem
  tile-gap: 0.375rem
  tile-inset: 0.5rem
  slider: 6rem
  slider-track: 0.1875rem
  slider-thumb: 0.875rem
components:
  window-bar:
    backgroundColor: "{colors.panel}"
    height: "{spacing.caption}"
  caption-button:
    textColor: "{colors.fg-mid}"
    typography: "{typography.glyph}"
    width: "{spacing.caption-button}"
    height: "{spacing.caption}"
  caption-button-hover:
    backgroundColor: "{colors.raised-hi}"
    textColor: "{colors.fg}"
  caption-button-close-hover:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
  panel:
    backgroundColor: "{colors.panel}"
  panel-header:
    height: "{spacing.toolbar}"
  panel-caption:
    textColor: "{colors.fg-dim}"
    typography: "{typography.eyebrow}"
  splitter-grip:
    backgroundColor: "{colors.line-control}"
    width: "{spacing.grip-width}"
    height: "{spacing.grip}"
  glyph-button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg-mid}"
    typography: "{typography.icon}"
    rounded: "{rounded.control}"
    size: "{spacing.control}"
  glyph-button-hover:
    backgroundColor: "{colors.raised-hi}"
    textColor: "{colors.fg}"
  tree-row:
    textColor: "{colors.fg-mid}"
    typography: "{typography.row}"
    rounded: "{rounded.control}"
    height: "{spacing.row}"
  tree-row-hover:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.fg}"
  tree-row-selected:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.on-plate}"
  tree-row-count:
    textColor: "{colors.fg-dim}"
    typography: "{typography.small}"
  breadcrumb-step:
    textColor: "{colors.fg-mid}"
    typography: "{typography.row}"
    rounded: "{rounded.nested}"
    height: "{spacing.control}"
  breadcrumb-title:
    textColor: "{colors.fg-hi}"
    typography: "{typography.title}"
  segmented:
    backgroundColor: "{colors.inset}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
    padding: "{spacing.segment-inset}"
  segmented-option:
    textColor: "{colors.fg-mid}"
    typography: "{typography.ui}"
    rounded: "{rounded.nested}"
  segmented-option-chosen:
    backgroundColor: "{colors.raised-hi}"
    textColor: "{colors.fg}"
  slider:
    backgroundColor: "{colors.line-control-hi}"
    width: "{spacing.slider}"
    height: "{spacing.slider-track}"
  slider-fill:
    backgroundColor: "{colors.fg-mid}"
  slider-thumb:
    backgroundColor: "{colors.fg}"
    size: "{spacing.slider-thumb}"
  tile:
    rounded: "{rounded.control}"
  tile-in-pane-badge:
    backgroundColor: "{colors.badge}"
    textColor: "{colors.on-plate}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.badge}"
    height: "{spacing.badge}"
  media-well:
    backgroundColor: "{colors.well}"
    rounded: "{rounded.control}"
  facts-term:
    textColor: "{colors.fg-dim}"
    typography: "{typography.eyebrow}"
  facts-value:
    textColor: "{colors.fg-mid}"
    typography: "{typography.ui}"
  chip-tag:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    typography: "{typography.small}"
    height: "{spacing.chip}"
  chip-tag-inherited:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.fg-dim}"
  chip-label-key:
    backgroundColor: "{colors.well}"
    textColor: "{colors.fg-dim}"
    rounded: "{rounded.nested}"
  chip-label-value:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
---

# Design

How Filmstrip looks. The values live in `src/styles/app.css`; this file says what each is for,
and `check:docs` fails when the two disagree. It follows Google's open DESIGN.md format: the
tokens above, then its sections in its order. DECISIONS.md "The design file" says why.

**It describes only what is built.** Each feature adds its own shapes here as it lands, so a
token or a component with nothing using it yet does not exist in this file.

## Overview

**Reading this as:** a dense Windows utility for people looking at their own photos and videos
for hours, in a quiet, photo-first language.

**The reference is ggallery's drawing**, `docs/design/Filmstrip.dc.html` in that repository,
frozen there. Its values are re-derived and checked here, never lifted with its markup, and
where this departs from it DECISIONS.md "The look" says why.

The chrome is a warm near-neutral that steps from dark to less dark; the pictures are the only
colour on screen. **There is no accent.** Selection is a neutral pewter plate, and colour is
kept for what it means: so far only red, for the close button and what destroys.

## Colors

| Role | For |
| --- | --- |
| `well` | A recess: the stage behind a picture shown large. |
| `ground` | The window body and the grid's surround. |
| `panel` | The bar, navigation, the pane, the grid's header row. |
| `inset` | A segmented control's trough; an inherited chip. |
| `raised`, `raised-hi` | A control at rest, and its hover or chosen state. |
| `plate`, `on-plate`, `on-plate-dim` | Selection, and only selection: a selected row, its text, its count. |
| `hatch`, `hatch-alt` | The stand-in for a picture whose thumbnail is not made yet. |
| `line`, `line-control`, `line-control-hi` | A panel's edge; a control's ring; a ring on a raised-hi control. |
| `line-strong` | The ring a tile shows under the pointer. |
| `fg-hi`, `fg`, `fg-mid`, `fg-dim` | Ink: titles; body; a control's label at rest; counts and captions. |
| `fg-faint` | Separators and an unfocused window's caption glyphs; never text to be read. |
| `focus` | The keyboard focus ring, and the ring on the tile the pane is showing. |
| `wash` | White at 9%, laid over something already filled when the pointer is on it. |
| `badge` | The one light plate over a picture: the tile the pane is showing. |
| `danger`, `danger-press`, `on-danger` | The close button under the pointer, and destructive actions to come. |

**Contrast is measured, not asserted.** `fg-hi`, `fg`, `fg-mid` and `fg-dim` reach 4.5:1 on
`well`, `ground`, `panel` and `raised`; `focus` reaches 3:1 on each; `on-plate` reaches 4.5:1 on
the plate. `src/styles/tokens.test.ts` paints each and fails below.

## Typography

Segoe UI Variable Text, installed with every copy of Windows 11 and never fetched. Glyphs are
Segoe Fluent Icons. Counts, sizes and dates set in tabular figures.

| Role | Size and line | For |
| --- | --- | --- |
| `title` | 17 on 24, semibold, tight | The place the grid shows; the pane's heading. |
| `row` | 14 on 20 | A navigation row; a step back in the breadcrumb. |
| `ui` | 13 on 20 | The working size: a control's label, a fact's value, prose. |
| `small` | 12 on 16 | A count, a chip. |
| `eyebrow` | 11 on 16, semibold, spaced, capitals | A panel's caption, a fact's term, the in-pane mark. |
| `glyph`, `icon` | 10 and 16 | Chevrons and caption glyphs; control glyphs. |

## Layout

**Everything is in rem**, so the interface size scales it all at once, and "does it fit" is
measured, never a breakpoint. DECISIONS.md "The interface size" has the reasoning.

- **The bar** is `caption` tall. **Every column's header row** is `toolbar` tall, so their rules
  meet in one line. A folded panel leaves a `rail` that is as wide as a header is tall.
- **Between columns**, a `splitter`-wide gap of ground holds a small grip.
- **Controls** are `control` tall. **Navigation rows** are `row` tall, inset from the panel edge by
  `row-inset`, `row-gap` apart.
- **Tiles** are `tile-gap` apart; what sits on a tile sits `tile-inset` from its corner.

## Elevation & Depth

Depth is lightness first: `well`, `ground`, `panel` and `raised` step apart, and a hairline of
`line` marks a panel's edge. One shadow exists, `shadow-overlay`, for a folded panel opened over
the grid at `--z-overlay`.

## Shapes

Three radii: `control` for a control, a row and a tile; `nested` for anything inside a control,
such as a segment or a label chip; `badge` for a small plate. A tag is a pill, so the two chip
families differ by shape, never by height.

## Components

Every state is designed: at rest, under the pointer, pressed, keyboard focus, and current or
chosen where it applies. **Hover is one step lighter in the same neutral, never a hue.** Focus is
a 2px `focus` ring outside the element, only for the keyboard; a control flush to the window's
edge takes it inside. Pressing steps back toward the rest surface.

- **Caption buttons.** Windows' own proportions, glyphs in `fg-mid`, one step lighter under the
  pointer; close turns `danger`. While another window has focus they fall to `fg-faint`.
- **Panels.** `panel`, a `line` at the edge facing the grid, a header row with the panel's name in
  `eyebrow` capitals and its fold button.
- **Glyph button.** A `control` square on `raised` with a `line-control` ring.
- **Tree row.** Chevron, glyph, name and count. At rest the name is `fg-mid`; under the pointer a
  `wash`; selected, a `plate` with `on-plate` ink, its count dimmed.
- **Breadcrumb.** Folders above as quiet `row` steps back, the place itself as the `title`.
- **Segmented.** One `inset` trough on a `line-control` ring; the chosen segment is `raised-hi`
  and semibold.
- **Slider.** A thin track, filled in `fg-mid` up to its value, and a round thumb.
- **Tile.** The picture cropped to a `control`-cornered cell, over the hatch until its thumbnail
  exists. A `line-strong` ring under the pointer; the tile the pane shows carries a `focus` ring
  and an *In pane* badge.
- **Facts.** Terms in `eyebrow` capitals, in a column as wide as the longest of them, values in
  `fg-mid`, each row the height of a chip.
- **Chip.** A tag is a pill, raised with a ring; inherited, it sinks to `inset`. A label splits into
  a sunk key and its value, and is never shown without the key.

**Motion is filtered by frequency.** Colour changes take `--motion-quick` (120ms) ease-out and
turn off under reduced motion. Nothing the keyboard does animates.

## Do's and Don'ts

- **Do** take every size, colour, radius and duration from a token. A value the scale has no name
  for gets a name in `app.css` and here, in the same change as the feature that needs it.
- **Don't** reach for Tailwind's own palette, radii, text sizes or shadows: they are cleared.
- **Don't** give selection a hue. The plate is neutral; a colour means a state.
- **Don't** animate what the keyboard does, or anything repeated all day.
- **Don't** show sample data on a surface. A surface shows only what it knows.

## Keeping this file true

- The front matter lists every colour, radius, spacing and text token `app.css` defines, at the
  same values. `check:docs` fails on a difference, on a token either side is missing, and on a
  component that names a token that does not exist.
- A feature that adds a shape adds its primitive to `src/ui/` and its entry here, and its states
  are checked on the real surface, in the real window.
