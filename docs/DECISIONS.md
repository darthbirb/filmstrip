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

Drawing our own buttons costs two things a native title bar has: the snap-layout panel on
hovering maximise, and the system menu on right-clicking the bar.

The 640×480 minimum is provisional until the frame slice measures what actually fits.

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

## The interface size

**Everything is sized in rem, so one number scales the whole interface.** The interface size is
that number: the root font size, from 80% to 200%, stepped with Ctrl+= and Ctrl+-, put back with
Ctrl+0, and kept in `filmstrip.config.json` along with the panel widths. It stacks with Windows'
text size and display scaling, which reach the WebView on their own.

**WebView2's zoom is off**, because two zooms would stack and make every measured size
ambiguous. The app's own is the one that is remembered.

The settings slice will give it a control on screen; until then it is keyboard only.

## Navigation

**One tree, as Explorer's navigation pane is**, picked from three candidates on 13 September
2026: the Sorting Box first, with the number of files waiting in it; then each library source,
its folders opening in place beneath it; then the Trash. The candidates it beat were a list of
places with the chosen source's folders in a second tree beneath, and a list that showed one
level at a time.

**Choosing a row goes there; only its chevron, Right or a double-click opens it.** The tree is
one tab stop and follows the ARIA tree pattern: the arrow keys move and open, Enter goes. A
source that cannot be read is muted and marked offline but keeps its folders, since a walk never
empties it — see "A walk only judges what it read". Which folders are open is not yet kept
between sessions.

**Where you are shows as a breadcrumb** in the grid's header, and every step above the last goes
back to that folder.

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

## Built in slices, not ported

The interface is built from scratch rather than carried across from its predecessor.

That predecessor spent four months matching a static drawing, surface by surface. It converged
per surface and never as a system: a typeface substitution sat at 97 call sites unnoticed, and
a toolbar cut buttons that would have fitted because someone had measured pixel thresholds by
hand and written them down. A drawing shows one width, one state, one text size — it cannot
express what a window does at another width, at 200% zoom, or on the third click.

What carries over is the backend, the product decisions, and those lessons. Not the markup.
