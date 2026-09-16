# Decisions

Why the code is the shape it is. Comments in the source cite these headings by exact title —
see DEVELOPMENT.md "Keeping the docs true".

## The stack

Tauri 2 and a Rust backend, because the app's real work is filesystem work and it must ship as
one small executable. React 19 for the interface: the accessible primitives and the
virtualisation libraries are all React-first, and it is the ecosystem with the most prior art
for the components this app needs.

**Base UI** for primitives — stable 1.x, written by the authors of Radix, and shadcn's default
since July 2026. Its components are copied in and styled onto our own tokens, never themed
from a vendor's defaults. **Tailwind v4** carries the token layer, with `@theme` and container
queries in the core. **Biome** lints and formats, one binary instead of a toolchain, and its
GritQL plugins can express project-specific rules later. **Vitest** for component tests,
**Playwright** for end-to-end.

**ts-rs** carries Rust types into TypeScript. **tauri-specta** would have generated the
command wrappers too, but it has been a release candidate since 2023; the wrappers are written
by hand instead, and a test holds them to the Rust side.

## Pinned versions and the supply chain

npm dependencies are pinned to exact versions; Rust's are held by the committed `Cargo.lock`,
which CI builds with `--locked`. pnpm 12 runs through `npx` at a version pinned with its
registry checksum. pnpm holds any release younger than 24 hours, refuses to run
a dependency's install scripts unless it has been allowed, and `trustPolicy: no-downgrade`
rejects a package whose publishing provenance has weakened — the shape of a hijacked release.

MCP servers in `.mcp.json` are pinned for the same reason: `@latest` in an agent's
configuration fetches whatever was published minutes ago, every time it starts.

## Nothing outside the app folder

Everything the app writes lives beside its own executable: the index, thumbnails, the trash,
and WebView2's profile. `lib.rs` passes `data_directory` to the window builder. Measured on 12
September 2026, `%LOCALAPPDATA%\com.darthbirb.filmstrip` is never created — the builder call
is sufficient on its own.

The library is a folder the user chooses. Nothing in it is touched except when they ask.

## Places, not queries

Everything the navigation shows is somewhere on disk, and every item has a parent directory.

The predecessor modelled two of them as queries instead — the Sorting Box as `folder_id = None`,
the Trash as `is:trashed` — and the cost was structural rather than cosmetic: a row that could
never highlight because it had no scope to be in, no empty state to design, and nowhere for a
restore to put anything back.

The Sorting Box is the one that is plural. It is several real folders the user nominates, shown
as one surface — not one directory, and not a view over the index.

## Renames made while the app was closed

A directory renamed or moved while the app is closed reads, on the next walk, as one folder
gone and another arrived. Without evidence that the files are the same, the walk cannot pair
them, so today the old folder's items are retired and the new folder's are indexed afresh —
their tags and thumbnails do not follow.

The evidence is content. Once files are hashed, a folder whose files reappear byte-identical
under a new directory can be recognised and reunited, keeping identity. Until hashing lands
this is a known gap, not a choice. A rename made through the app has no such problem: the app
moves the directory and records the move in one step.

## A walk only judges what it read

A walk retires whatever it did not find, so it may only judge what it actually read.
**An unreachable source is skipped entirely:** an unplugged drive reads as "the directory is not
there", and treating that as "everything in it was deleted" would empty the index for a source
that is merely away. **A sweep is scoped to one source:** a walk reads one root, so it can only
speak for that root's files and folders.

A file whose size and modification time match its row is not opened again. That is the common
case, and what keeps walking an unchanged library cheap.

## Background work

**Anything slower than a moment runs on the job queue**, never inside a command: a walk, a
thumbnail. A command returns at once; worker threads, one per core but one and between two and
eight, each with its own connection, claim jobs from the `job` table in priority order. A walk
is queued at every launch.

**The table outlives the app.** A job that succeeds is deleted. One that fails is retried once
if the failure might pass — a locked file, a busy database — and otherwise kept with its error
for the failure list. One left running at shutdown goes back to waiting at the next launch. A
decoder that panics on one file fails that job and nothing else.

**Progress is pushed**, one `job-progress` event per half second and only when something
changed, so a queue that empties within a tick still says so.

**Work in progress shows at the foot of the panel doing it**, drawn on 15 September 2026 and built
the day after: the walk's line grows above a baseline of what the library holds, and the baseline
never moves, so nothing in the tree shifts as the line comes and goes. Its bar is pewter rather
than red, because progress states a fact rather than raising an alarm. **What could not be read
goes above the grid instead**, where it stays in the way until it is dealt with: a banner on a
danger hairline, never a fill, that counts the failures, offers to try them again, and opens its
list in place rather than in a dialog. Neither is a dialog, and both leave when they are done.

## Thumbnails

**320px on the longest edge, lossy WebP at quality 78**, as measured in ggallery: AVIF encoded
41 times slower for a 12% saving. A picture is decoded by what the file holds, never by its
extension; turned upright by its EXIF orientation; and keeps its transparency. A video's is a
frame a tenth of the way in, and never later than ten minutes: past the fades and black leaders
most clips open with, and early enough to still be the shot the file is about. A thumbnail is
named by the item's uuid, so a rename or a move never orphans one.

**Making a thumbnail is when a file is read.** A picture's width, height and capture date come
from the decode that makes it, a video's from ffprobe, so nothing opens a file twice.
`item.probed_at` records that it happened. A walk that finds a file changed clears it, and the
index job queues every live picture and video still uncleared or missing its thumbnail.

## Capture dates

**Only the file's own metadata dates it.** For a picture, EXIF's DateTimeOriginal, else
DateTimeDigitized; for a video, its container's creation time. Nothing is guessed. ggallery fell
back to the file's creation time, but copying a file on Windows stamps a new creation time and
keeps the modification time, so an imported library's "capture dates" were the day it was
copied. The pane shows the modification time as a row of its own, named for what it is.

EXIF's plain DateTime is not a capture date: editors rewrite it on every save. **A zeroed date is
no date** — a camera whose clock was never set writes zeros, and a container never stamped says
1904 or 1970.

**EXIF has no time zone in the common case**, so its time is kept as the camera's clock read as
UTC, and shown in UTC: as written, wherever the viewer is. A container's creation time is real
UTC, and is shown in local time. Sorting across the two can be out by a zone's offset, which is
the price of never inventing one.

## Video and ffmpeg

**ffmpeg is found, never installed.** At launch the app looks for `ffmpeg.exe` and `ffprobe.exe`
together in `tools\` beside the executable, then in any one directory on PATH. Reading PATH
writes nothing, so "Nothing outside the app folder" holds. Bundling it, so that a release needs
nothing downloaded, is under PRODUCT.md "Later". Without it videos are not queued at all, so no
failures pile up, and the first launch that finds it picks them up.

**`media::ffmpeg` is the only place the app starts another program.** Every run has a limit — 30
seconds to probe, 60 to take a frame — and is killed past it, so one damaged file cannot hold a
worker; ggallery had none. Each file goes in as a `file:` input, so no file name is read as one
of ffmpeg's other protocols, and no console window flashes.

**A recording's rotation turns its shape.** A phone records a landscape sensor and a note to turn
it, and ffmpeg draws the frames upright, so the width and height the index keeps are swapped to
match. ggallery kept them unturned, and portrait videos laid out as landscape.

**The window plays what WebView2 plays**: H.264 MP4 and WebM, but not HEVC without its extension,
MKV or AVI. A video it cannot play keeps its poster and says so. Scrub strips wait for a surface
that shows them.

## The window

Native decorations are off, so the app draws its own chrome. WebView2's own zoom stays off:
the app scales itself, as "The interface size" describes.

**The bar is Windows' own caption strip**, picked from three candidates on 12 September 2026:
36px tall — Windows draws 32, raised to seat the search field — the mark and the name at the left, and minimise, maximise and close at 46px wide in
Windows' own glyphs, close turning red under the pointer. The title and the glyphs dim while
another window has focus. The candidates it beat were a 48px header and a strip that receded
over the content until the pointer reached the top.

**Search lives in the bar**, as VS Code's command centre does, chosen with the frame on
12 September 2026. It is centred on the window, not on the gap between the title and the
buttons, and it narrows before anything else has to give. Everything else the app shows sits in
the frame below.

**The gear for Settings sits in the bar**, before the caption buttons and at their width, as
Claude Design drew it on 14 September 2026: Settings belongs to the window rather than to any one
column, the same reason search is there.

Drawing our own buttons costs two things a native title bar has: the snap-layout panel on
hovering maximise, and the system menu on right-clicking the bar.

**The 640×480 minimum holds**: the bar, the grid's header and the Settings dialog fit it at
200%, as the tests measure. Whether a smaller window would also hold is not yet measured.

## The frame

**Three docked columns — navigation, the grid, the pane — each with a header row of its own**,
picked from three candidates on 12 September 2026. The grid's header holds the location; the
side panels' hold the buttons that hide them. The candidates it beat were one toolbar across the
window with header-less panels beneath, and a pane floating over the grid's edge.

**Widths are the user's, in rem.** A splitter between two columns drags, answers to the arrow
keys and resets on double-click, and rem keeps a chosen width in proportion when the text size
or the zoom changes. Widths, and which panels are hidden, are kept between sessions.

**A panel folds because it did not fit**, never at a breakpoint. The frame measures its own
width against the columns' actual widths and the grid's minimum: the pane folds first, then
navigation, and the grid never does. A folded panel leaves a rail at the window's edge, and its
button opens the panel over the grid until Escape or a click elsewhere. A panel hidden by hand
behaves the same way.

**Clicking a picture opens the pane** when it is folded or hidden, since showing something in a
pane nobody can see does nothing: it docks where it fits, and opens over the grid where it does
not.

## The interface size

**Everything is sized in rem, so one number scales the whole interface.** The interface size is
that number: the root font size, from 80% to 200%, stepped with Ctrl+= and Ctrl+-, put back with
Ctrl+0, and kept in `filmstrip.config.json` along with the panel widths. It stacks with Windows'
text size and display scaling, which reach the WebView on their own.

**WebView2's zoom is off**, because two zooms would stack and make every measured size
ambiguous. The app's own is the one that is remembered.

**Five named steps: 80, 100, 125, 150 and 200%**, chosen in Settings as well as stepped with the
keys, since 14 September 2026. People pick a size and leave it, and a finer range would offer a
precision nothing uses. A size saved under the older eight steps lands on the nearest of the five.

## Navigation

**One tree, as Explorer's navigation pane is**, picked from three candidates on 13 September
2026: the Sorting Box, with the number of files waiting in it, and each library source, its
folders opening in place beneath it. The candidates it beat were a list of places with the chosen
source's folders in a second tree beneath, and a list that showed one level at a time.

**The Sorting Box and the Trash sit together at the top, above a rule**, as Claude Design drew
them on 14 September 2026. They are the app's own two places: they never move and never nest, and
nobody looking for one should have to read past a tree to find it. **Nesting is indentation
alone**, one step a level; a guide line per level competed with the panel's edge for the little
structure the chrome has, and the chevrons already say which rows have children.

**A row's count is a pill, and counts its own items only**, drawn on 15 September 2026 and built
the day after. A bare number at the end of a row runs into the title beside it, where a plate
ends the row and groups itself. A place with nothing of its own carries no pill at all: a nought
in a plate is a number to read and dismiss on every empty folder in the tree, and an absence says
the same thing in no ink. A source's row has no pill either, because the index counts a source
whole rather than counting what sits loose in its root.

**Choosing a row goes there; only its chevron, Right or a double-click opens it.** The tree is
one tab stop and follows the ARIA tree pattern: the arrow keys move and open, Enter goes. A
source that cannot be read is muted and marked offline but keeps its folders, since a walk never
empties it — see "A walk only judges what it read". Which folders are open is not yet kept
between sessions.

**Folded, navigation keeps the app's own two places**, drawn on 15 September 2026 and built the
day after. A rail holding nothing but its unfold button makes folding a trap for anyone who folded
to see more pictures, so the Sorting Box and the Trash stay as squares of glyph, each wearing its
count on the glyph's corner where a row would wear a pill. **Folders do not come with them**: an
arbitrary slice of a tree in a rail as wide as a header is tall would be a worse tree, not a
shorter one. A third square lays the whole tree over the grid instead, closing on a pick or on
Escape; the header's button is still the one that docks the panel for good.

**Where you are shows as a breadcrumb** in the grid's header, and every step above the last goes
back to that folder.

## The grid

**Two layouts, and the user chooses**, decided on 13 September 2026 after comparing both live:
justified rows, where every picture keeps its shape and each row runs edge to edge, and uniform
squares, cropped to fill. Rows are the default. **The choice lives in Settings**, since 14
September 2026: it is made once and left alone, and the grid's header has the place's name to
hold first.

**The tile size stays in the header**, the one view preference people change while looking, as
one button naming the step it is on: Small, Medium, Large or Extra large, 8, 11, 15 and 20rem. A
named step says where the size is without a click, which two nudge buttons and a slider never
did. A size saved before the steps existed lands on the nearest.

**A video's tile writes its length** in the corner opposite the in-pane plate, decided on 14
September 2026, so a clip and a photograph no longer draw the same cell. Nothing else is written
on a tile.

**Only the rows near the view are drawn**, a screen's height above and below, so a folder of
thousands scrolls like one of ten. The layout is computed off the main thread, and every grid on
a page numbers its requests from one counter, so two grids never take each other's layout. The
layout and the tile size are kept with the other preferences.

**A picture without a thumbnail yet lays out square**, and takes its real shape once the
thumbnail job has read its size.

**While a place is read, stand-ins hold its shape**: rows of trough-coloured blocks in
photograph shapes at the tile size, as the component sheet draws them, never a spinner over the
grid. A place read again because background work moved on keeps its tiles meanwhile.

**Empty is several different facts, and each says its own**, drawn on 15 September 2026 and built
the day after. A cleared Sorting Box, an emptied Trash, a folder holding only folders, a folder
holding nothing and a source that cannot be reached are five situations, and only the fourth is
really "no pictures here". They keep one shape so they do not read as five designs, and each
names the folder or source it is talking about. **Only a folder of folders offers an action**,
listing them as buttons, because going into one is the obvious next move and the counts are
already known; a button that only restates the situation is worse than no button. A place whose
folders are not known yet says nothing at all rather than guessing at "empty", and an unreachable
source says what it last held — see "A walk only judges what it read".

## The pane

**The picture, a row that opens onto what is known, and a filmstrip**: the predecessor's
arrangement, described by the user once three structures of this repository's own had been
turned down live on 13 September 2026, and re-derived from ggallery's drawing.

- **The header row carries the item's shape and size**, beside the fold button. It is a
  disclosure: opened, the details push down from under it, and whether it is open is a saved
  preference, so it holds from one item to the next.
- **The file's name is the last of the details, not a headline.** An item is a real file under
  its own name, so there is one name to show; a heading only assistive technology reads keeps
  the pane findable.
- **The picture takes the rest**, at its own shape, standing on the panel. It had sat in a
  recessed well until 16 September 2026; the well was a fixed box, so a picture of another shape
  showed it as black bars above and below, and a well sized to the picture would be a mount board
  around someone's photograph. The picture carries the app's one corner and nothing is drawn
  behind it.
- **The filmstrip runs through the place the item was clicked in**, not whatever the grid shows
  now: the pane keeps what it shows while the user looks elsewhere, and its strip keeps with it.
  Like the grid, it draws only the frames near the scroll, so a folder of thousands costs what a
  folder of ten does.
- **Its steps float over its ends**, with the panel fading in behind them, as Claude Design drew
  it on 14 September 2026. Two buttons beside the strip took 88px of a 320px pane and stood on
  nothing; the fade says the strip runs on, and shows two more frames.
- **Nothing is drawn with nothing behind it.** The drawing's back arrow and mode switch still
  wait for history and sets to exist, and PRODUCT.md "The three panels" keeps one mode. The action
  bar no longer waits.

**The action bar holds what the app can do to the file**, drawn by Claude Design and built on 16
September 2026: favourite at the left, and reveal, copy and open filling in from the right.
**What fits is measured, never written down** — each button that does not fit moves into a menu
under a ⋯ glyph, so the list of what the app can do to a file never depends on the width of the
window. The drawing keeps that menu on screen always, because Rename lives in it; until Rename has
a command behind it the menu appears only when it holds something, since a control that cannot act
is worse than an absence. **Favourite is not yellow:** the predecessor's amber star is an accent
this app does not have, so the state is carried by the filled glyph and the raised plate, as every
other toggle carries it. Move To…, Rename… and Delete are drawn but absent, each waiting on a
command and two of them on a drawing of what they open.

**Full screen is a state of the pane, not a place you go**, drawn on 15 September 2026 and built
the day after. The pane takes the frame below the bar and keeps every part it has; the bar stays,
because native decorations are off and it is the only way left to close or minimise the window.
**The columns are hidden rather than dropped**, so the pane element survives the trip and its
picture is never reloaded, and the grid comes back where it was. The control sits in the pane's
header beside the fold button, and in full screen the fold button goes rather than moves, since
there is nothing left to fold away from. Escape leaves, and leaving puts the pane back in exactly
the state it was in. Folded or hidden there is no header row to hold a control, so a double-click
on a tile is the way in; a single click still only shows it.

**What the pane knows comes from the file.** Capture dates, a video's length and codec, and a
rotated recording's true shape are read when the thumbnail is made; "Capture dates" and "Video
and ffmpeg" above say how.

## Settings

**A dialog over the window**, drawn by Claude Design and built on 14 September 2026. The frame is
three columns and stays three; a preference set once a month should not cost the grid a surface,
and Escape or a click outside leaves nothing behind. It is the only thing over the window, and
the only use of the scrim.

**A preference belongs there only when there is nowhere on screen to set it.** Today that is the
interface size and the grid's layout. The panel widths, which panels are folded, the tile size
and whether the pane's details are open all keep their controls where they are: a second control
for the same thing is a second thing to keep in sync.

**A rail of sections, grouped and filtered**, because it will grow: tabs hold six or seven names
and then scroll, and a rail takes twenty. A section with nothing in it yet is not in the rail.

**No Save and no Cancel.** Every control writes as it is touched, 400ms after the last change, as
a splitter does. A dialog that can be cancelled implies a draft, and there is none.

## Testing in a real browser, never jsdom

jsdom reports every element as zero-sized, so anything about size, overflow, position or
visibility passes there and fails in life. Vitest's browser mode runs on the Edge already
installed on the machine, so no browser is downloaded and the numbers are real.

## The mark

The mark is a filmstrip: an opaque dark body, and five colour frames parted by dark gaps, each
with one sprocket hole centred above it and one below. Picked on 13 September 2026 over four
frames, and over frames run together.

**Its colours are literal and stay literal** — no token, no `currentColor`. An identity that
changes with a theme is not an identity. `src/assets/mark.svg` is the only source, and every
icon is generated from it with `tauri icon`, rendered from the geometry rather than
screenshotted so no subpixel fringing is baked in. One composition at every size, 16px
included, and a test holds the SVG to it.

## The scale is the arbiter

Every radius, height, type size, duration and colour comes from the token layer in
`src/styles/app.css`. A component may look however it looks, but it may not invent a number.

Sizes are in `rem`, so one root font-size moves everything at once. **"Does it fit" is
measured, never enumerated:** no hand-written pixel breakpoints. A control that does not fit
collapses because it did not fit, not because the window crossed a number somebody wrote down
once and never re-measured.

**Tailwind's own palette, radii, text sizes and shadows are cleared**, set on 13 September
2026, so a class from them does nothing and a stray number cannot slip in through a familiar
name. Contrast is measured by a test rather than trusted.

## The design file

**`docs/DESIGN.md` describes the look, in Google's open DESIGN.md format** (Apache-2.0, opened
on 21 April 2026): tokens as front matter, then fixed sections from the overview to do's and
don'ts. It is the convention coding agents now read for a design system, and it keeps the look
in the same repository as the code, in plain text.

**`app.css` stays the one place a value lives.** DESIGN.md repeats the base look's tokens so an
agent can read them without parsing CSS, and `check:docs` fails the moment the two differ.
Google's CLI for the format could lint and export it, but it is alpha and would be a dependency;
the few checks that matter here are a page of our own script.

**It grows with the app.** Each feature that adds a shape adds it there: the primitive, its
states, its tokens. Nothing is described ahead of the feature that uses it.

## The look

**Drawn in Claude Design and built from its files**, since 14 September 2026, after the look
taken from ggallery's drawing was turned down. For each new surface Claude writes a prompt
carrying its features, states and decisions; Claude Design, which reads this repository but never
changes it, draws the surface; its files land in `docs/design/` and are built from there. The
earlier drawing stays beside them as `old-ggallery-design.html`.

**What it holds:** warm near-neutral surfaces a step apart; warm grey ink in four weights; **no
accent**, since the pictures are the colour; controls one height on a hairline ring, with one
corner; a hatch where a picture is still to come. **Two marks, told apart by shape rather than
hue:** the item the pane shows carries a white ring drawn inside its tile and a white plate with
an eye; keyboard focus is a red ring outside, the same red as close. One white ring used to mean
both, and both can be on screen at once.

**Where the build departs from the drawings:**

- **Every control is 2rem tall**, the dropdowns in Settings and every menu option included,
  where the drawings used 28px in places. The token sheet says no other control height exists.
- **A chosen option wears the selection plate in every menu**; the tile-size drawing used a check
  on a lighter row instead.
- **Settings' rail sits on the panel and its captions are Plex**: the drawing's `#181818` and Plex
  Mono are in no scale, and the second would be a third bundled face.
- **The dialog takes the control's 10px corner**, not a fourth radius of 12.
- **One dark glass, `veil`, for everything over a picture**: a video's length, which the drawings
  left open, and the filmstrip's steps.
- **Filmstrip frames fill the strip less its inset**, as the component sheet has them.

**Its fonts ship inside the app**, since the content security policy forbids fetching one: IBM
Plex Sans in two weights (SIL OFL 1.1, `@fontsource/ibm-plex-sans`, Latin), Archivo ExtraBold for
the wordmark alone (SIL OFL 1.1, `@fontsource/archivo`), and Phosphor's regular and fill icons
(MIT, `@phosphor-icons/web`). All allow bundling in an open-source app. Only Phosphor's two woff2
files are bundled, about 280 KB, where its own stylesheets would bring every fallback format;
glyphs are drawn by codepoint, and a test holds each to the package's stylesheet.

## Built in slices, not ported

The interface is built from scratch rather than carried across from its predecessor.

That predecessor spent four months matching a static drawing, surface by surface. It converged
per surface and never as a system: a typeface substitution sat at 97 call sites unnoticed, and
a toolbar cut buttons that would have fitted because someone had measured pixel thresholds by
hand and written them down. A drawing shows one width, one state, one text size — it cannot
express what a window does at another width, at 200% zoom, or on the third click.

What carries over is the backend, the product decisions, and those lessons. Not the markup, and
not the look: since 14 September 2026 that comes from Claude Design; see "The look".
