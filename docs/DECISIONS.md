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

Native decorations are off, so the app draws its own chrome. Zoom hotkeys are turned on
explicitly, because Tauri disables them by default and the app is meant to answer to zoom.

**The bar is Windows' own caption strip**, picked from three candidates on 12 September 2026:
32px tall, the mark and the name at the left, and minimise, maximise and close at 46px wide in
Windows' own glyphs, close turning red under the pointer. The title and the glyphs dim while
another window has focus. **It belongs to the window, not the app** — location and search go
in the frame below it. The candidates it beat were a 48px header that would have carried them,
and a strip that receded over the content until the pointer reached the top.

Drawing our own buttons costs two things a native title bar has: the snap-layout panel on
hovering maximise, and the system menu on right-clicking the bar.

The 640×480 minimum is provisional until the frame slice measures what actually fits.

## Testing in a real browser, never jsdom

jsdom reports every element as zero-sized, so anything about size, overflow, position or
visibility passes there and fails in life. Vitest's browser mode runs on the Edge already
installed on the machine, so no browser is downloaded and the numbers are real.

## The mark

The mark is a filmstrip: an opaque dark body, five sprocket holes above and five below, seven
colour frames across the window.

**Its colours are literal and stay literal** — no token, no `currentColor`. An identity that
changes with a theme is not an identity. `src/assets/mark.svg` is the only source, and every
icon is generated from it with `tauri icon`, rendered from the geometry rather than
screenshotted so no subpixel fringing is baked in. One composition at every size, 16px
included: at that size the frames read as a colour band, which is accepted.

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
