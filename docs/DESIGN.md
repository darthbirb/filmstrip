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
  line-danger: "rgb(194 90 74 / 0.45)"
  danger-wash: "rgb(194 90 74 / 0.1)"
  fg-hi: "#f4f3f1"
  fg: "#eceae7"
  fg-mid: "#a8a5a0"
  fg-dim: "#908c86"
  fg-faint: "#5c5a56"
  on-plate: "#17181a"
  on-plate-dim: "rgb(23 24 26 / 0.62)"
  on-plate-wash: "rgb(23 24 26 / 0.14)"
  focus: "#c25a4a"
  in-pane: "#f2f2f2"
  on-mark: "#141414"
  wash: "rgb(255 255 255 / 0.09)"
  veil: "rgb(10 10 10 / 0.82)"
  scrim: "rgb(10 10 10 / 0.55)"
  danger: "#c25a4a"
  danger-press: "#a94f41"
  on-danger: "#f2f2f2"
typography:
  title:
    fontFamily: IBM Plex Sans
    fontSize: 1.0625rem
    lineHeight: 1.5rem
    fontWeight: 600
    letterSpacing: -0.02em
  row:
    fontFamily: IBM Plex Sans
    fontSize: 0.875rem
    lineHeight: 1.25rem
  ui:
    fontFamily: IBM Plex Sans
    fontSize: 0.8125rem
    lineHeight: 1.25rem
  small:
    fontFamily: IBM Plex Sans
    fontSize: 0.75rem
    lineHeight: 1rem
  eyebrow:
    fontFamily: IBM Plex Sans
    fontSize: 0.6875rem
    lineHeight: 1rem
    fontWeight: 600
    letterSpacing: 0.12em
  micro:
    fontFamily: IBM Plex Sans
    fontSize: 0.625rem
    lineHeight: "1"
    fontWeight: 600
  wordmark:
    fontFamily: Archivo
    fontSize: 0.875rem
    lineHeight: 1.25rem
    fontWeight: 800
    letterSpacing: -0.035em
  glyph-small:
    fontFamily: Phosphor
    fontSize: 0.75rem
    lineHeight: "1"
  glyph:
    fontFamily: Phosphor
    fontSize: 0.9375rem
    lineHeight: "1"
  icon:
    fontFamily: Phosphor
    fontSize: 1.125rem
    lineHeight: "1"
  glyph-large:
    fontFamily: Phosphor
    fontSize: 2rem
    lineHeight: "1"
rounded:
  mark-badge: 5px
  badge: 6px
  nested: 8px
  control: 10px
spacing:
  caption: 2.25rem
  caption-button: 2.875rem
  mark: 1.125rem
  toolbar: 2.75rem
  rail: 2.75rem
  foot: 2.25rem
  progress: 0.1875rem
  splitter: 0.25rem
  grip: 1.625rem
  grip-width: 0.125rem
  bar-field: 1.75rem
  bar-search: 36rem
  row: 2.125rem
  row-inset: 0.5rem
  row-gap: 0.1875rem
  indent: 1.75rem
  chevron: 1.25rem
  control: 2rem
  chip: 1.625rem
  badge: 1.25rem
  mark-badge: 0.875rem
  tile-gap: 0.375rem
  tile-inset: 0.5rem
  strip: 6rem
  strip-inset: 0.375rem
  strip-step: 1.5rem
  strip-step-height: 3.25rem
  strip-fade: 3rem
  dialog: 41rem
  dialog-height: 27rem
  dialog-rail: 12rem
  note: 34ch
components:
  window-bar:
    backgroundColor: "{colors.panel}"
    height: "{spacing.caption}"
  wordmark:
    textColor: "{colors.fg}"
    typography: "{typography.wordmark}"
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
  caption-button-open:
    backgroundColor: "{colors.raised-hi}"
    textColor: "{colors.fg}"
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
  glyph-button-disabled:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.fg-faint}"
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
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg-mid}"
    typography: "{typography.small}"
    rounded: "{rounded.badge}"
    height: "{spacing.badge}"
  tree-row-count-selected:
    backgroundColor: "{colors.on-plate-wash}"
    textColor: "{colors.on-plate}"
  tree-rule:
    backgroundColor: "{colors.line}"
  panel-foot:
    textColor: "{colors.fg-dim}"
    typography: "{typography.small}"
    height: "{spacing.foot}"
  progress-track:
    backgroundColor: "{colors.raised}"
    height: "{spacing.progress}"
  progress-fill:
    backgroundColor: "{colors.plate}"
  rail-button:
    textColor: "{colors.fg-mid}"
    typography: "{typography.icon}"
    rounded: "{rounded.control}"
    size: "{spacing.control}"
  rail-button-selected:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.on-plate}"
  rail-badge:
    backgroundColor: "{colors.raised-hi}"
    textColor: "{colors.fg}"
    typography: "{typography.micro}"
    rounded: "{rounded.mark-badge}"
    height: "{spacing.mark-badge}"
  rail-badge-selected:
    backgroundColor: "{colors.fg}"
    textColor: "{colors.on-plate}"
  notice:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.fg}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
  notice-warning:
    textColor: "{colors.danger}"
    borderColor: "{colors.line-danger}"
  breadcrumb-step:
    textColor: "{colors.fg-mid}"
    typography: "{typography.row}"
    rounded: "{rounded.nested}"
    height: "{spacing.control}"
  breadcrumb-title:
    textColor: "{colors.fg-hi}"
    typography: "{typography.title}"
  dropdown:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  dropdown-hover:
    backgroundColor: "{colors.raised-hi}"
  dropdown-menu:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.control}"
  dropdown-option:
    textColor: "{colors.fg-mid}"
    typography: "{typography.ui}"
    rounded: "{rounded.nested}"
    height: "{spacing.control}"
  dropdown-option-chosen:
    backgroundColor: "{colors.plate}"
    textColor: "{colors.on-plate}"
  tile:
    rounded: "{rounded.control}"
  tile-in-pane-badge:
    backgroundColor: "{colors.in-pane}"
    textColor: "{colors.on-mark}"
    typography: "{typography.eyebrow}"
    rounded: "{rounded.badge}"
    height: "{spacing.badge}"
  tile-duration:
    backgroundColor: "{colors.veil}"
    textColor: "{colors.fg}"
    typography: "{typography.small}"
    rounded: "{rounded.badge}"
    height: "{spacing.badge}"
  pane-picture:
    rounded: "{rounded.control}"
  pane-disclosure:
    textColor: "{colors.fg-mid}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  pane-disclosure-hover:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.fg}"
  pane-disclosure-open:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
  action-bar:
    backgroundColor: "{colors.panel}"
    height: "{spacing.toolbar}"
  action-button:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg-mid}"
    typography: "{typography.icon}"
    rounded: "{rounded.control}"
    size: "{spacing.control}"
  action-button-on:
    backgroundColor: "{colors.raised-hi}"
    textColor: "{colors.fg}"
  menu:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.control}"
  menu-item:
    textColor: "{colors.fg-mid}"
    typography: "{typography.ui}"
    rounded: "{rounded.nested}"
    height: "{spacing.control}"
  empty-state-glyph:
    textColor: "{colors.fg-faint}"
    typography: "{typography.glyph-large}"
  empty-state-action:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    height: "{spacing.control}"
  stand-in:
    backgroundColor: "{colors.inset}"
    rounded: "{rounded.control}"
  filmstrip:
    backgroundColor: "{colors.panel}"
    height: "{spacing.strip}"
    padding: "{spacing.strip-inset}"
  filmstrip-frame:
    rounded: "{rounded.control}"
  filmstrip-fade:
    backgroundColor: "{colors.panel}"
    width: "{spacing.strip-fade}"
  filmstrip-step:
    backgroundColor: "{colors.veil}"
    textColor: "{colors.fg}"
    typography: "{typography.glyph}"
    width: "{spacing.strip-step}"
    height: "{spacing.strip-step-height}"
  stat-chip:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.fg}"
    typography: "{typography.small}"
    rounded: "{rounded.nested}"
    height: "{spacing.chip}"
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
  settings-dialog:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.control}"
    width: "{spacing.dialog}"
    height: "{spacing.dialog-height}"
  settings-backdrop:
    backgroundColor: "{colors.scrim}"
  settings-rail:
    width: "{spacing.dialog-rail}"
  settings-section:
    backgroundColor: "{colors.raised-hi}"
    textColor: "{colors.fg-hi}"
    rounded: "{rounded.nested}"
    height: "{spacing.row}"
  settings-group:
    backgroundColor: "{colors.inset}"
    rounded: "{rounded.control}"
  settings-row:
    textColor: "{colors.fg}"
    typography: "{typography.ui}"
    height: "{spacing.toolbar}"
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

**The reference is the Claude Design project in `docs/design/`**: the token sheet, the component
sheet, the whole window at four sizes with Settings over it, the pane in each of its states, and
the notes that say why. Its values are carried into `app.css` and checked here; where the build
departs from the drawings, DECISIONS.md "The look" says so.

The chrome is a warm near-neutral that steps from dark to less dark; the pictures are the only
colour on screen. **There is no accent.** Selection is a neutral pewter plate. **Red means one
thing and is never decoration:** where the keyboard is, and close.

## Colors

| Role | For |
| --- | --- |
| `well` | A recess: a label chip's key half. |
| `ground` | The window body, the grid's surround, the gap a splitter sits in, the filter field. |
| `panel` | The bar, navigation, the pane, the grid's header row, the filmstrip, Settings. |
| `inset` | A sunk trough: a disabled control, an inherited chip, a group of settings, a tile still being read. |
| `raised`, `raised-hi` | A control at rest, and its hover, open or chosen state. |
| `plate`, `on-plate`, `on-plate-dim`, `on-plate-wash` | Selection, and only selection: a chosen place or option, its ink, its count, and the count pill's sunk plate. |
| `hatch`, `hatch-alt` | The stand-in for a picture whose thumbnail is not made yet. |
| `line`, `line-control`, `line-control-hi` | A panel's edge and the rule under a header; a control's ring; a ring on a raised-hi control. |
| `line-strong` | The ring a tile shows under the pointer; a strip step's under the pointer. |
| `fg-hi`, `fg`, `fg-mid`, `fg-dim` | Ink: titles; body; a control's label at rest; counts and captions. |
| `fg-faint` | Separators, a disabled glyph, an offline source's glyph, an unfocused window's caption glyphs; never text to be read. |
| `focus` | Where the keyboard is, and only that: a 2px ring, 2px clear of the element. |
| `in-pane`, `on-mark` | The item the pane shows: the ring drawn on its tile and frame, its plate, and the plate's ink. |
| `wash` | White at 9%, laid over something already filled when the pointer is on it. |
| `veil` | Dark glass over a picture, for what must read on any photograph: a video's length, the strip's steps. |
| `scrim` | Behind the Settings dialog; the window stays legible under it. |
| `danger`, `danger-press`, `on-danger` | The close button under the pointer, and destructive actions to come. |

**Contrast is measured, not asserted.** `fg-hi`, `fg`, `fg-mid` and `fg-dim` reach 4.5:1 on
`well`, `ground`, `panel` and `raised`; `focus` and `in-pane` reach 3:1 on each; `on-plate`
reaches 4.5:1 on the plate and `on-mark` on the in-pane plate. `src/styles/tokens.test.ts`
paints each and fails below.

## Typography

IBM Plex Sans, bundled, for everything but the wordmark: its figures are tabular, and this
interface is mostly counts, sizes, dimensions and dates. **The wordmark alone** is Archivo
ExtraBold. **Glyphs** are Phosphor, drawn by codepoint: the fill family in a navigation row or a
settings section, where the glyph names a thing, and the regular family on a control, where it
names an action. All three ship inside the app and are never fetched.

| Role | Size and line | For |
| --- | --- | --- |
| `title` | 17 on 24, semibold, tight | The place the grid shows; the dialog's name. |
| `row` | 14 on 20 | A navigation row; a step back in the breadcrumb. |
| `ui` | 13 on 20 | The working size: a control's label, a fact's value, a setting, prose. |
| `small` | 12 on 16 | A count, a chip, a video's length. |
| `eyebrow` | 11 on 16, semibold, spaced, capitals | A panel's caption, a fact's term, a group of settings, the in-pane plate. |
| `wordmark` | 14 on 20, extra bold, tight | The name beside the mark in the bar. |
| `glyph-small`, `glyph`, `icon` | 12, 15 and 18 | The maximise square, the in-pane eye, a dropdown's caret. Caption glyphs, chevrons, a strip step, a menu option. A control's or a row's glyph. |
| `glyph-large` | 32 | The glyph that stands in an empty pane or an empty place. |

## Layout

**Everything is in rem**, so the interface size scales it all at once, and "does it fit" is
measured, never a breakpoint. DECISIONS.md "The interface size" has the reasoning.

- **The bar** is `caption` tall. **Every column's header row** is `toolbar` tall, so their rules
  meet in one line. A folded panel leaves a `rail` that is as wide as a header is tall.
- **Between columns**, a `splitter`-wide gap of ground holds a small grip.
- **Controls** are `control` tall, and no other control height exists. **Navigation rows** are
  `row` tall, inset from the panel edge by `row-inset`, `row-gap` apart; a level of nesting is one
  `indent` and nothing else.
- **Tiles** are `tile-gap` apart; what sits on a tile sits `tile-inset` from its corner.
- **The pane** stacks its details when opened, at most half its height; the picture, taking the
  rest and standing on the panel; and a `strip`-tall filmstrip, its frames `strip-inset` from its top and bottom and
  `tile-gap` apart, each the `--aspect-strip` shape whatever the picture's own. Its ends are
  padded clear of the steps that float over them.
- **Settings** is `dialog` wide and `dialog-height` tall, never more than the window, with a
  `dialog-rail`-wide rail of sections.

## Elevation & Depth

Depth is lightness first: `well`, `ground`, `panel` and `raised` step apart, and a hairline of
`line` marks a panel's edge. One shadow exists, `shadow-overlay`: a folded panel opened over the
grid at `--z-overlay`, the Settings dialog, and an open menu. Menus and the dialog sit in the
browser's top layer, so nothing clips them.

## Shapes

Three radii: `control` for a control, a row, a tile, a menu and the dialog; `nested` for anything
inside one, such as an option or a label chip; `badge` for a small plate over a picture. A tag is
a pill, so the two chip families differ by shape, never by height; a strip step is a pill too.

## Components

Every state is designed: at rest, under the pointer, pressed, keyboard focus, and current or
chosen where it applies. **Hover is one step lighter in the same neutral, never a hue.** Focus is
a 2px `focus` ring outside the element, only for the keyboard; a control flush to the window's
edge, or an option flush in a menu, takes it inside. Pressing steps back toward the rest surface.

- **Glyph.** A square 1em across, drawn from its Phosphor codepoint; it takes its size and ink
  from where it sits. Filled names a thing, outlined names an action; the pane's panel glyph is
  the navigation's, mirrored.
- **Wordmark.** The mark and the name in `wordmark`, in `fg`, falling to `fg-dim` while another
  window has focus.
- **Caption buttons.** Windows' own proportions, glyphs in `fg-mid`, one step lighter under the
  pointer; close turns `danger`. The gear for Settings sits before them at their width and stays
  `raised-hi` while Settings is open. While another window has focus they fall to `fg-faint`.
- **Panels.** `panel`, a `line` at the edge facing the grid, a header row with the panel's name in
  `eyebrow` capitals and its fold button.
- **Glyph button.** A `control` square on `raised` with a `line-control` ring. Disabled, it sinks
  to `inset` on a `line` ring, its glyph `fg-faint`.
- **Tree row.** Chevron, glyph, name and count. At rest the name is `fg-mid`; under the pointer a
  `wash`; selected, a `plate` with `on-plate` ink. An offline source is `fg-dim` with an
  `fg-faint` glyph. The app's own places sit above a `line` rule.
- **Count pill.** A row's own item count, `badge` tall at the `badge` corner, on `raised` with a
  `line-control` ring; on a selected row it sinks to `on-plate-wash` with `on-plate` ink. A place
  with no items of its own carries no pill, and an offline source shows its word instead.
- **Rail button.** A folded panel's place: a `control` square holding a filled glyph, `plate` with
  `on-plate` ink when it is where you are, a `wash` under the pointer otherwise. Its count rides the
  glyph's top-right corner as a `mark-badge` plate in `micro` figures, ringed in the panel's own
  colour to hold it off the glyph; on the selected square it inverts to `fg` with `on-plate` ink.
- **Panel foot.** Pinned under a panel: a `foot`-tall baseline of what the library holds, in
  `small` `fg-dim`, and above it, only while a walk runs, its line and a `progress`-thin track on
  `raised` filling with `plate`. The baseline never moves; the line appears above it and leaves.
- **Notice.** A banner above the grid on `panel` at the `control` corner, holding a glyph, a line,
  its actions and a dismiss. What needs a decision takes a `line-danger` hairline and a `danger`
  glyph, never a fill; what is only worth knowing takes the ordinary `line-control` ring. Its list
  opens in place beneath it rather than in a dialog.
- **Breadcrumb.** Folders above as quiet `row` steps back, the place itself as the `title`.
- **Dropdown.** One named choice: a `control`-tall button on `raised` naming what it is on, a
  caret after it, opening a menu of every choice beneath it on `raised` with the overlay shadow.
  The chosen option wears the `plate`. The keyboard opens it with the arrows and Escape puts it
  away. The tile size is one, with the grid glyph before its step.
- **Tile.** The picture cropped to a `control`-cornered cell, over the hatch until its thumbnail
  exists. A `line-strong` ring under the pointer. The tile the pane shows carries an `in-pane`
  ring drawn inside its edge and an *In pane* plate with an eye, which never wraps and drops its
  words on a tile narrower than `--container-badge`. A video's tile writes its length on `veil`
  in the opposite corner. Keyboard focus is the `focus` ring outside, so both can show at once.
- **The pane's picture.** Sized by its own shape and centred in what the pane has left, at the
  `control` corner, with nothing drawn behind it: the space around it is the pane.
- **Pane disclosure.** The pane's header row: a chevron and the item's shape, length and size in
  tabular `ui` figures. A `wash` under the pointer; opened, it rests on `raised` in `fg` and the
  chevron turns down.
- **Action bar.** A `toolbar`-tall row between the picture and the filmstrip, holding what the app
  can do to the file. Favourite sits at the left and never leaves; the rest fill from the right, and
  each one that does not fit moves into a menu under a `more` glyph. What fits is measured against
  the real width, never a width written down. Favourite marks itself with the filled glyph on a
  `raised-hi` plate and never a hue: a flag needing a colour to be legible is drawn too small.
- **Menu.** A list of actions on `raised` at the `control` corner under the overlay shadow, opened from
  a glyph button and anchored to it. A dropdown offers a choice and marks the one taken; a menu
  marks nothing, because every row in it is a thing to do rather than a thing to be.
- **Full screen.** The pane takes the frame below the bar, keeping its header, picture and
  filmstrip and losing only the columns beside it. Its control is a glyph button in the pane's
  header, before the fold button; in full screen it wears the pressed state and the fold button is
  gone. The header row keeps its height, its disclosure and its figures either way.
- **Filmstrip.** A frame for each item in the place, the one shown centred and carrying the
  `in-pane` ring, the rest sitting back at `--strip-rest` until the pointer is on one. The panel
  fades in over both ends, and a pill-shaped step floats on `veil` over each; at the first or last
  frame its step falls to `fg-faint`.
- **Empty state.** A `glyph-large` glyph in `fg-faint` over a semibold line of `ui` and a note in
  `small`, the note held to a `note` measure. One shape for every empty place, with its own glyph
  and its own words: a cleared Sorting Box, an emptied Trash, a folder of folders, an empty folder,
  an unreachable source, and the pane with nothing clicked or a file gone. Where there is one move
  worth offering it follows as `control`-tall buttons on `raised`; most places have none.
- **Stand-in.** A tile still being read: `inset` at the `control` corner, in rows of photograph
  shapes at the tile size, filling the view until the place's tiles arrive. Never a spinner.
- **Stat chip.** A measured value, a shape, a length or a size, on `raised` at `nested` corners.
  The kind of file after them is the same chip in `fg-mid`.
- **Facts.** Terms in `eyebrow` capitals, in a column as wide as the longest of them, values in
  `fg-mid`, each row the height of a chip.
- **Chip.** A tag is a pill, raised with a ring; inherited, it sinks to `inset`. A label splits into
  a sunk key and its value, and is never shown without the key.
- **Settings.** A dialog over the `scrim`: a header with its `title` and a close button; a rail of
  sections grouped under `eyebrow` captions, with a filter field on `ground` above them, the one
  shown on `raised-hi`; and the section's settings as rows in an `inset` group, each a label and
  its control.
- **Band.** What could not be done, at the foot of the panel it was asked from: a sentence, the
  folder's path under it in `--font-mono`, and a dismiss, on a `danger-wash` ground. There is only
  ever one, and a second refusal replaces it rather than stacking.
- **Segmented.** A value with few enough answers to show them all at once, the one it is on filled
  on `raised-hi` inside an `inset` trough. Real radios, so the arrow keys move between them.
- **Source row.** In Settings, two lines: the source's glyph, its name as a field where it stands,
  its count — or the walk, while one runs — its kind as a segmented group, then reveal and remove;
  its path beneath in `--font-mono`. One that cannot be read keeps its remove and loses its reveal.
- **Push-down.** A box arriving under the row above it: it grows from no height, lifts the
  `--push-lift` it started above where it settles, and fades, all as one move. Closed, it is out of
  sight and out of the tab order rather than sitting at no height. The pane's details and the
  indexing line are the same shape, and the folder's band will be.

**Three durations, and what moves is always a box changing size.** `--motion-size` (180ms) is every
box that changes size: a panel folding, a push-down, the pane growing to full screen.
`--motion-swap` (220ms) is content cross-fading *under* a size change, and only ever with one — the
longer of the two, so the box settles before the fade finishes rather than under it.
`--motion-quick` (120ms) is a colour, a chevron turning and a frame's opacity. All three take
`--ease-out`, and all three go to zero under reduced motion. Nothing else moves: the pane's
contents are replaced without a transition, the grid never animates its layout, the strip never
scrolls smoothly, the splitter follows the pointer exactly, and nothing animates on first paint.

## Do's and Don'ts

- **Do** take every size, colour, radius and duration from a token. A value the scale has no name
  for gets a name in `app.css` and here, in the same change as the feature that needs it.
- **Don't** reach for Tailwind's own palette, radii, text sizes or shadows: they are cleared.
- **Don't** give selection a hue, or use red for anything but focus and what destroys.
- **Don't** write on a tile beyond the in-pane plate and a video's length.
- **Don't** animate what the keyboard does, or anything repeated all day.
- **Don't** show sample data on a surface. A surface shows only what it knows.

## Keeping this file true

- The front matter lists every colour, radius, spacing and text token `app.css` defines, at the
  same values. `check:docs` fails on a difference, on a token either side is missing, and on a
  component that names a token that does not exist.
- A feature that adds a shape adds its primitive to `src/ui/` and its entry here, and its states
  are checked on the real surface, in the real window.
