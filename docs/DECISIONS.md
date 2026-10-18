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

**Which `+` was pressed is the kind.** A folder becomes a source through one of two doorways —
navigation's Library caption, or the Sorting Box's own row — and nothing is asked once the picker
closes, because the answer was the button. Asking afterwards would mean a dialog after the picker's
dialog, and asking someone to choose between two words before they have seen either behave;
Settings › Sources is where a kind is corrected instead. The Sorting Box's `+` rests on its row
rather than appearing under the pointer, since it is the only way to nominate a sorting folder and a
hover-only control has no keyboard.

**A refused folder is an answer, not an error.** Four folders are turned away — the same one twice,
one inside a source, one holding a source, and the app's own — and each says so in a band at the
foot of the panel the add began from. Nothing is added and no row is selected in its place, because
selecting the row it overlaps would answer a question nobody asked.

**A place follows its folder**, as Artboards › Undo draws it. Each time the index is read again,
after an act of the app's own or a walk, where you stand is found again by the folder's id among
every live folder: moved, it takes you with it, with the tree opened down to its new place;
renamed, the breadcrumb says the new name; gone, you are in the nearest folder above it still
there. The pane's file went with a folder that went, so the pane empties rather than showing a
file as gone that the person has just deleted.

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

**Every transaction that may write takes the write lock as it begins**, through `db::begin` or
`db::in_transaction`, and `tags::atomically` does the same when no transaction is open. Idle
workers claim in `BEGIN IMMEDIATE` several times a second. A deferred transaction that has read
and then meets that lock as it writes is refused at once, without waiting out the busy timeout,
so an act would fail with "database is locked". Clippy refuses every rusqlite call that can open
a transaction outside `db::begin`: `Connection::transaction`, `unchecked_transaction`,
`transaction_with_behavior`, `savepoint` and `savepoint_with_name`, `Transaction::new` and
`new_unchecked`, and `Savepoint::new` and `with_name`. It cannot see SQL, so a raw `BEGIN` or an
outermost `SAVEPOINT` passed to `execute_batch` still gets past it; `tags::atomically` issues its
`SAVEPOINT` only inside a transaction already open.

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
writes nothing, so "Nothing outside the app folder" holds. Found nowhere, videos are not queued
at all, so no failures pile up, and the first launch that finds the pair picks them up.

**The release carries its own**, so video needs nothing installed: `Filmstrip.zip` holds
`Filmstrip.exe` and `tools\` beside it, rather than a Tauri sidecar, which would make every
`cargo` build need the binaries present. The build is FFmpeg 9.0.2, the "essentials" build from
gyan.dev, fetched from its GitHub mirror by `scripts/fetch-ffmpeg.ps1`, which pins the URL and
SHA-256 and refuses anything else; CI's video tests run against the same download. It is GPLv3,
which the app's own GPL-3.0-or-later already accepts, so an LGPL build would buy nothing; gyan.dev
keeps every versioned release, where BtbN's builds are pruned, so the pin stays fetchable. Both
programs are static, two files and no DLLs. Its licence, its build notes and a notice naming the
source ship in `tools\` with it. A new version is a new pin: version, URL and checksum together.

**`media::ffmpeg` is the only place the app starts another program.** Every run has a limit — 30
seconds to probe, 60 to take a frame — and is killed past it, so one damaged file cannot hold a
worker; ggallery had none. Each file goes in as a `file:` input, so no file name is read as one
of ffmpeg's other protocols, and no console window flashes.

**A recording's rotation turns its shape.** A phone records a landscape sensor and a note to turn
it, and ffmpeg draws the frames upright, so the width and height the index keeps are swapped to
match. ggallery kept them unturned, and portrait videos laid out as landscape.

**The window plays what WebView2 plays**: H.264 MP4 and WebM, but not HEVC without its extension,
MKV or AVI. A video it cannot play keeps its poster and says so.

**A video's scrub frames are ten cells in one WebP**, each fitted to the thumbnail's 320px and
taken at the middle of its tenth of the clip, so a pointer anywhere in a slice shows the frame
that stands for it. They sit beside the thumbnail as `<uuid>.frames.webp`, under the cache the
window may already read. A `scrub` job makes them after a video's thumbnail, last in priority:
the dearest work per file and the least missed. Each cell is its own seek, where ggallery
decoded the whole clip in one pass; a seek costs the same in a two-hour film as in a short, so
no video can run past the frame limit, and a length that overstates the file only repeats the
last cell taken. Any other failure part-way fails the job like any other and writes nothing,
rather than leave a strip of repeats that is never remade. A strip always has ten cells and the
row says how many, from the constant, not the file: changing the count means remaking every
strip already made, since one that exists is never queued again.

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

**Nothing selects and nothing offers the browser's menu, except a field.** A drag across the
window highlighted words in blue and a right-click offered to print or copy a link to a highlight —
both said, plainly, that this was a web page. So `body` does not select, and the page's own menu is
turned off everywhere but in a field, where cut, copy, paste and the spell-checker live and the app
does not reimplement them. A field keeps its own text whatever it sits in. The pane's details do
not select either: the drawing names fields as the only exception, and copying a file is the bar's.

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

**A panel never gets narrower than a button's label.** A label wrapping inside a button is the
window saying it ran out of room, which the frame is supposed to have decided already. So a
button's label never wraps: it ends in an ellipsis instead, and the panel around it stops before
that. How much of a label is cut right now is how much narrower than its content the panel has
been made, which is what the panel measures. A floor that fell again the moment it was met would
fight the pointer, so within the same content the floor only ever rises, and it starts over when
the content or the text size changes. Nothing else in a panel sets a floor: a row's name, a path
and a count are all free to be cut, and say so by truncating.

**Clicking a picture opens the pane** when it is folded or hidden, since showing something in a
pane nobody can see does nothing: it docks where it fits, and opens over the grid where it does
not.

**A side panel is one box, not three.** Docked, folded to a rail, laid over the grid and filling
the window are four widths of the same element, with its rows and its rail two layers cross-fading
inside it. They were three separate trees until 17 September 2026, so every change between them was
a swap rather than a move: React rebuilt the pane on the way into full screen, which reloaded the
picture behind its thumbnail and started a playing video again from zero. The box keeps its place
in the row while it grows, so the grid never reflows under its own fade.

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

**A row's count is a pill**, drawn on 15 September 2026 and built the day after. A bare number at
the end of a row runs into the title beside it, where a plate ends the row and groups itself.
**It reads a place's own files, then everything at or below it, always both**, as `3/9`, `3/3`
and `0/0`; redrawn on 30 September 2026 after a library of nine files read as five, three of them
loose in the source and one in a folder folded shut, and again on 1 October when one figure where
the two agreed read as ambiguous, since a lone `3` could be either number. The own figure comes
first because it is what a click shows; the second is what folding hides, so a row reads the same
folded or open, and a folder of folders reads `0/9`. Every row has its pill, a source's and an
empty folder's included, so the column has no gaps to explain; the Sorting Box and the Trash read
`3/3` the same way. Two exceptions: an offline source shows only its word, since the app cannot
stand behind a count while the drive is away, and the folded rail's badges keep one figure,
because two do not fit a glyph's corner and neither place has subfolders.

**Choosing a row goes there; only its chevron, Right or a double-click opens it.** The tree is
one tab stop and follows the ARIA tree pattern: the arrow keys move and open, Enter goes. A
source that cannot be read is muted and marked offline but keeps its folders, since a walk never
empties it — see "A walk only judges what it read". Which folders are open is not yet kept
between sessions.

**Favourite places are a group of their own**, between the app's two places and the sources, a
rule either side, drawn by Claude Design and built on 25 September 2026, so a favourite is one
press away however deep it sits. Each row is a filled star, the place's name and the folder it is
in, since the tree around it is not there to say which Cairo; a source has no parent, and one
that is away is muted and says so. They are in name order. **Choosing one plates both of
its rows**: both are where you are standing, and the second says where the favourite lives, but
the tree does not open to show it. A favourite moved keeps its star; one deleted leaves the group,
and undoing the delete brings it back, since a retired folder keeps its flag. With none, there is
no group and no rule.

**Folded, navigation keeps the app's own two places**, drawn on 15 September 2026 and built the
day after. A rail holding nothing but its unfold button makes folding a trap for anyone who folded
to see more pictures, so the Sorting Box and the Trash stay as squares of glyph, each wearing its
count on the glyph's corner where a row would wear a pill. **Folders do not come with them**: an
arbitrary slice of a tree in a rail as wide as a header is tall would be a worse tree, not a
shorter one. A third square lays the whole tree over the grid instead, closing on a pick or on
Escape; the header's button is still the one that docks the panel for good. Favourite places stay in the tree's panel too: the rail holds only the two.

**Where you are shows as a breadcrumb** in the grid's header, and every step above the last goes
back to that folder.

**The foot says what the library holds and what it weighs**, drawn on 12 October 2026 and built
the day after: `41,236 items · 312 GB`. A count says how many, not how much, and a library of
videos and one of phone pictures read the same; the size is what tells someone their drive is
filling. The source count it used to carry moved into the totals a click on it opens, by kind,
since pictures and videos differ in size by orders of magnitude: a question asked while looking,
not a setting, so it is a click from the figure it breaks down rather than a page of Settings.
**In All is the library's sources only**: what waits in the Sorting Box is not in the library
yet, and the Trash is on its way out, so each has its own row. Files the walk keeps that are
neither picture nor video get a row of their own only when there are any, so the kinds always
add up. All of it is one grouped query over the index, read again with the tree, so every figure
moves when a move, a delete, a restore or a walk lands. **A source that is away is counted from
the index**, as its folders are listed from it, and the totals name it and say when it was last
read; the Sorting Box's header names a sorting source that is away, while its row keeps both
figures, since only one of several sources is gone. At the panel's least the line gives up whole
parts, "items" and then the size, and never a figure cut part-way.

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
September 2026, so a clip and a photograph no longer draw the same cell, after a filled play
glyph, as the component sheet draws it. **The pointer across it scrubs it**: the tile's width is
the clip's length, a line along its foot says where, and the length plate drops its glyph to
read the time under the pointer instead. Its frames are asked for only while the pointer is on
it. A video without them draws the line dashed and says *No Preview* opposite the length, unless
the in-pane plate holds that corner or the tile is too narrow for both. Nothing else is written
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

**Checking files is a gesture of its own**, drawn by Claude Design and built on 25 September
2026. A click shows a picture and never checks it; the box on the tile checks it, and so do Ctrl
and Shift with a click, as in Explorer, but a modified click never changes what the pane shows,
so Ctrl+clicking through twenty pictures does not flash twenty through the pane. Shift takes the
range from the last box checked in the grid's order and replaces the set, Ctrl+Shift adds it, and
with nothing checked the range starts at the file in the pane. **A selection belongs to the place
it was made in**: going elsewhere clears it, a folder renamed or moved under you keeps it, and a
file that leaves the grid leaves the set, while one that arrives, by a walk or an undo, is never
checked.

**What a set can do is a bar along the grid's foot**, a row of the grid's own column rather than
a tray over the pictures, since nothing in this app stands on a photograph but a tile's two marks.
It holds the count and its size, Select All, and the set's verbs in its menu's order, Favourite,
Move to…, Copy, Export… and Delete with the count again, so the bar and the menu never hold
different sets; in the Trash, Restore and Restore to…, as its pane's bar has them. Favourite reads
Remove Favourite only when every checked file is one already, so a mixed set is never
half-toggled. As the grid narrows the size goes first, then Select All, Export…, Copy, Tag…,
Favourite and Delete behind More; the count, Move to… and the clear stay. The pane's bar acts on the pane's file alone, checked or not. **What
a move or a delete could not carry stays checked**, so the bar counts what the banner lists and
the next act takes exactly them, and after a delete the pane shows the tile after the last one
gone.

**Select Everything Inside checks a folder's whole branch**, built on 12 October 2026 from a
folder's menu and a source's. It opens the folder and checks every file at or below it, in the
place's order; the grid goes on listing the folder's own files, checked, and the bar counts the
rest with them, so its count is what Move to…, Delete and the others take. Listing the branch in
the grid instead would be a view no sheet draws. The branch is read again whenever the library
or the grid's list changes, so a file that leaves it leaves the set; Select All and Ctrl+A add
the grid's files and keep the branch, and going elsewhere clears it, as it clears any set. A
drive that is away keeps the row, since checking reads only the index.

**The grid is one tab stop, and the keyboard reaches all of it.** Tab lands on the tile in the
pane, or the first; the arrows move the ring and nothing else, up and down keeping the column as
near as the rows allow, and Home, End and the page keys go further. Space is the box, Shift with a
move checks from the last one checked, and Enter shows the ringed tile in the pane; full screen is
the tile's menu or a double-click. Ctrl+A checks the whole place, the tiles scrolled away too, and
Escape clears it, after whatever else is open has closed. The ringed tile is drawn wherever the
scroll is, so the focus is never dropped with it.

**A tile dragged onto a row in navigation is Move to… that row**, drawn by Claude Design and built
on 26 September 2026, since the tree is always on screen: the same act, the same line after it and
the same banner when part of it stays. A checked tile carries the whole set and any other carries
itself alone, leaving the set as it was; a press that moves less than a tile-gap is a click. **The
ghost says what letting go will do before you let go**: the top picture with the rest stacked
behind it and the count, then the act over a row that takes it, lifted inside a pewter ring, or the
reason after the red prohibit over one that will not, which stays as it was under Windows' no-drop
pointer. Every folder, source and favourite row takes a drop, except the files' own folder, the
Trash, a drive that is away and the Sorting Box when it is more than one folder. It is a drag the
app draws itself, not the browser's, because only its own ghost can change its words on the way.
Held on a closed row for `--hold` the row opens, the tree scrolls near its edges, and Escape puts
the ghost away and moves nothing, keeping the set. The Trash's files are not dragged: Restore is
their one way out.

**The Trash is a place like any folder, with two differences**, drawn by Claude Design and built
on 25 September 2026. It runs newest first under a heading for each day something went, Today and
Yesterday and then the date, and a day starts a row of its own; the minute is in the pane's
Deleted row. **Each tile says where it came from**, in one line under the tile rather than on it,
because in the Trash that is what a person needs before putting it back: the folder's name only,
its whole path in the tooltip and the pane, and "gone" when that folder no longer stands, so a
refused Restore is not the first they hear of it. The line ellipsises and the tile never grows to
fit it. The Trash counts itself on its row, its rail square and its header, with its size there.

## Sorting a place

**A folder, the Sorting Box and a search each run in an order chosen in the grid's header**,
drawn on Artboards › Sorting a place and built on 13 October 2026 from ggallery's `order_clause`:
Date Taken, Date Added, Size, Length or Random, newest, largest or longest first until reversed.
Date Taken is the default everywhere and reads when a file was taken or else when it was
modified, as `year:` does, so a screenshot sits among the photographs of its day. **The order
is made in SQL**, never on the frontend, so the grid, the filmstrip and the pane moving on after
a delete all read one list in one order; a folder of 40,000 reorders well inside a second.

**A tie falls to the id, run the same way as the key**, so a reversed order is the first read
backwards, as ggallery found. **Length puts whatever has no length last either way**: reversing
turns the videos over, not the pictures to the front. **A random order is a seeded hash, not
`RANDOM()`**, so a walk finishing, a scroll or coming back to the folder never reshuffles it;
only Shuffle draws a new seed. ggallery added the seed to one multiplication, which made every
new seed the old order rotated; here the id is spread over a prime and squared twice, each half
of the seed entering a round of its own, so a new seed draws a new order, not the old one
rotated. Reverse is disabled in place while Random is the key, since a shuffle has no direction.

**Each kind of place keeps its own order**, in the interface's preferences: going from Cairo to
Trips keeps the folder's, and the Sorting Box can run oldest added first while folders run
newest taken. A key picked starts the way it reads first. **The Trash has no sort**: it runs by
the day each file left, and any other order would scatter its days. Reordering keeps the tiles
until the new order arrives, as a place read again does. As the header narrows the tile size
gives up its word first, then the sort, each keeping its glyph, which says the direction.

## A folder's details

**A folder's band is the pane's details one level up**, opened from the grid's header, as
Artboards › 04 draws it. Same caption column, same row, same chips: a folder and a file both have
a path, labels and tags, and should not need two vocabularies. The Sorting Box and the Trash keep a
plain header, having none of these.

- **Its tags start with its own, its name first, then what it inherits**, each folder above in
  path order from the source down, that folder's name before its tags. A tag carried at two levels
  shows once, where it is nearest, as a file inherits it.
- **The band stays open from folder to folder** for the session, closed when the app starts: a
  person who opened it once wants it on the next folder too, and a band that flashed open on
  every click would push the pictures down unasked.
- **What a folder knows about itself lives in the index**, so setting it is not journalled, as a
  favourite is not, and works while its drive is away. Only the counts and the cover's picker
  need the drive.
- **Escape abandons a note, and a click away keeps it.** Half a note is still what was meant, so
  leaving the box saves it, where a half-typed tag or name is dropped; Enter is a new line, since
  a note is prose, and Ctrl+Enter saves. Saved empty, the note is gone: none is no note.
- **A tag the folder already carries is refused where it is typed**, its own or one from above:
  adding it again would change nothing a search can see. The line names the folder it comes from,
  which is where it can be taken off. A folder's name is a tag only a rename changes, so it has no
  ×. Tags come several at a time, so the field stays open after each until Escape or a click away,
  which drop what was half typed.
- **A file's tags are the band's control in the pane's details**, as the Pane sheet's Tagging a
  file draws it: adding a tag to a folder and to a file is one act on a different thing, so one
  row serves both and only whose name its refusals use differs. A file takes tags, never a label,
  since a label is a fact about a place. What a file inherits is its folder's, and comes off
  there, so it shows sunk with no ×. Its own come first in the order they were added, then each
  folder's from the source down, that folder's name first.
- **A tag may be several words**, such as `new york`, as the owner decided on 12 October 2026. A
  place is often named in two, and splitting it would leave `new` and `york`, each true of far
  more than New York. It is kept folded, lowercase with one space between its words however it
  was typed, so `New  York` is the tag `new york`; a search folds what it reads the same way, and
  the chip's `tag:"new york"` finds what carries it.
- **A label is one fact with two parts**, so Add Label… closes once it is added, where Add Tag…
  stays open. A folder holds one value per key, as ggallery's did: a label answers a question,
  where or which trip, and a folder with two answers answers twice. A key it has is refused where
  it is typed and its value is changed with a click on it instead; one from above names the
  folder it comes from.
- **A key is given once down a branch**, as the owner decided on 12 October 2026: a folder may
  not override a key it inherits. So that the order they were added in no longer matters, a
  folder is also refused a key while a folder below it holds one, and the line names that folder,
  the nearest first, where it can be taken off. `tags::set_folder_label` refuses both as the band
  does; a folder changing the value of a key it already holds is not refused. `add_folder_tag`
  takes no key, so has none to refuse. A deleted folder below refuses nothing: holding the live
  tree to a label in the Trash would leave a key nobody can see blocking the one being given.
- **Where two values of a key do meet, the nearest wins.** Moving a labelled folder under
  another can still bring the two together, as can undoing the delete of a folder below that held
  the key while one above took it, and neither is refused for it: Cairo moved under Trips keeps
  `location: cairo` for its files while the rest of Trips' carry Egypt, and Cairo's band shows
  only its own. Resolving it where an item's tags are built holds however the folders arrived
  there. Taking Cairo's off lets Trips' reach its files.
- **Libraries indexed before the nearest value won are not rebuilt**, as the owner decided on
  12 October 2026: Filmstrip had not been used on a real library yet, so no migration rewrites
  `item_effective_tag`. A file that still carried both values would lose one the next time its
  folder, or one above it, had a tag or label changed.
- **The header's counts are the tree's, in words**: its own files here, then everything at or
  below it, the same two figures a pill shows. An offline source says `offline` instead.
- **A folder that holds anything always has a picture.** Its chosen cover while that file is live
  at or below it, else its first picture or video, nearest first. A search's folder card shows the
  same one, so the band and the card never disagree; ggallery never left a folder coverless either.

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
window. That menu is on screen always, because Rename lives in it. **Favourite is not yellow:** the predecessor's amber star is an accent
this app does not have, so the state is carried by the filled glyph and the raised plate, as every
other toggle carries it.

**Move to… and Delete joined the bar on 24 September 2026.** Move to… is the one worded button, and
stays beside Favourite at every width: the two change the library. **Delete keeps its place beside
the ⋯ at every width**, as every bar on the Pane sheet draws it; the sheet's ⋯ at 20rem also lists
Delete, which would be the one verb in two places at once, so the ⋯ holds only what has left the
bar. Delete asks nothing, because Undo is the answer to a delete. **When the pane was showing the
file, it moves on** to the file that takes its tile's place, or the one before when it was the
last, and to its empty state when none is left; "This File Has Gone" is for a file that went
outside the app, never for the person's own act.

**Rename is the Name row, where the name already is.** From the ⋯ or a file's menu it opens the
details if they are shut and turns that row into a field, the stem selected and the extension in
the field but outside the selection, so it can be changed on purpose and not by typing. A name
already taken is said under the field, which keeps it and holds Enter until it is edited; nothing
is renamed behind the person's back and no suffix is invented.

**Copy Path is a row, never a button**, added on 12 October 2026: the bar is drawn with three glyph
buttons, and a second copy glyph beside the first would be two squares no one could tell apart.
It lives in the ⋯ with Rename, directly after Copy once Copy has folded in, and in a file's menu
and a set's directly after Copy, with Copy's glyph, since the sheets draw no glyph for a path. The
clipboard gets text, the full Windows path, one to a line for a set. The index knows the path, so
a source that is away keeps the verb.

**A file in the Trash has the way back and nothing else**, drawn by Claude Design and built on 25
September 2026. Its bar holds Restore and Restore to…, worded and from the left, and no ⋯, since
nothing is left to fold; its menu holds the same two under Full Screen. Favourite, Move to… and
Rename would change a file that is not in the library, and Show in Explorer, Copy and Open with
Default App would hand Windows the name the Trash keeps it under, never the one it was given; all
of them are absent rather than greyed. Nothing purges: emptying the Trash is under Later. Its
details say where it came from and when it went, in place of where it is, and the Name row is
only its name. Restored from the Trash, the pane moves on as it does after a delete.

**A video plays on a plate of the app's own**, drawn by Claude Design and built on 12 October
2026, in place of the controls the window brings with it: play, the track, the time and the mute
on the one dark glass, over the picture's foot and as wide as the picture. **Its glyphs are one
size, the scale's `glyph`**: the drawing had the steps and the mute at two sizes the scale does
not name, and play is told apart by being the one filled and in white, not by a size of its own.
**What fits is measured, as in the action bar.** The total leaves first, its slash with it,
because the header row above already reads the same length; then the mute. The elapsed is on
screen nowhere else, so it never leaves, nor do play and the track, which holds a least width of
its own. Paused, the plate stays up; playing, it goes a moment after the pointer leaves the
picture, and comes back for the keyboard. Frame steps and a set of speeds are drawn and wait for
a frame rate the probe does not record yet.

**Full screen is a state of the pane, not a place you go**, drawn on 15 September 2026 and built
the day after. The pane takes the frame below the bar and keeps every part it has; the bar stays,
because native decorations are off and it is the only way left to close or minimise the window.
**The columns are hidden rather than dropped**, so the pane element survives the trip and its
picture is never reloaded, and the grid comes back where it was. The control sits at the other end
of the pane's header from the fold button, since the two do opposite things, as an arrow along the
edge that moves; in full screen the fold button goes rather than moves, since there is nothing left
to fold away from. Escape leaves, and leaving puts the pane back in exactly
the state it was in. Folded or hidden there is no header row to hold a control, so a double-click
on a tile is the way in; a single click still only shows it.

**A picture zooms as ggallery's did, but holds its zoom differently.** The wheel zooms about the
point under the pointer from the scale the picture already fits at, a drag pans, double-click fits,
and the next item starts at fit — ported as they were. ggallery held the zoom as a scale and a pan
in pixels, so a pane resized under a zoomed picture drifted off what was being looked at. Filmstrip
holds a multiple of the fitted scale and the image point at the centre of the view, so a resize, a
fold, the details opening or full screen re-fits and keeps the same view. ggallery's floor of a
tenth stays, lowered to the fitted scale for a picture too large to fit above it, which would
otherwise jump on its first notch. At fit there is no zoom furniture; off fit, one plate states the
scale and is the way back. A video does not zoom: its controls and its track already own the picture.

**Nothing stands in while the original loads.** A thumbnail under it showed for a split second
as a low copy of the picture, first small and then at the picture's size, and only when the
original was not already cached. An original the window cannot draw is stood in for by its
thumbnail, at the size the original would fit at, from the shape the index read when it made it.

**What the pane knows comes from the file.** Capture dates, a video's length and codec, and a
rotated recording's true shape are read when the thumbnail is made; "Capture dates" and "Video
and ffmpeg" above say how.

## Right-click menus

**A right-click is a shortcut to what the interface already does**, drawn by Claude Design and
built in part on 23 September 2026. A file's menu is the pane's bar in the bar's order; a folder's
and a source's hold the verbs the bar cannot reach because it is about a file. The browser's own
menu was already off everywhere but in a field, so until these a right-click, the menu key and
Shift+F10 did nothing at all.

- **A verb that does not exist yet is absent, never greyed.** A greyed row describes a feature at
  the moment it refuses it. A rule only stands
  between two groups that both hold rows, so an absent verb leaves no stray line, and a menu with
  nothing in it opens nothing.
- **What a drive that is away cannot do is absent too.** An offline source keeps Rename, Manage
  Sources and Remove Source, which touch only the index; it and its folders keep Favourite, Assign
  Key… and Select Everything Inside, as their band keeps what the index holds, and lose every verb
  that needs the folder on disk.
- **Favourite is on a folder's and a source's menu**, reading Remove Favourite when on, from
  either of the place's rows. It changes nothing on disk, so it is not journalled and a source
  that is away keeps it.
- **Assign Key… sits under Favourite**, since both mark a place to come back to, and ends with
  the key the folder holds. It opens the ten keys against the row, each with the folder it is on,
  "Free" or "gone" in the quiet ink, the folder's own on the plate, then No Key. Picking a key
  another folder holds moves it without a question: the row already said whose it was.
- **Search in Folder and Search in Source open the second group.** Each is Ctrl+F with the offer
  taken, for a place you are not standing in: it writes the place as the field's scope, replacing
  any scope it held and keeping its other terms, and leaves the caret in the field without running
  anything. A source that is away has none, as it has no Show in Explorer.
- **Select Everything Inside follows them**, on a folder's row and a source's, and on an offline
  one's too, since a set changes nothing until a verb acts on it. See "The grid".
- **Remove Source goes through the question Settings already asks.** It opens Sources with that
  source's row asking, Cancel focused. Forgetting a source drops the tags and notes on its files;
  a menu row must not do that in one press when the section that owns it asks first.
- **A checked tile opens the set's menu, and right-clicking never changes the set.** It is counted
  at its head, since it is the one menu that acts on more than one file, and holds the verbs that
  mean something for a set: Favourite, Move to…, Copy, Copy Path, Export…, and Delete with the
  count again; in the Trash, Restore and Restore to…. A tile with no check opens its own menu and the set stays
  checked, as a drag from it would, and that menu acts on that tile alone, so its Delete never
  reaches a tile out of sight.
- **Opening a menu changes nothing.** The pane keeps what it shows until a verb in the menu says
  otherwise, and Full Screen on a tile is that verb. While the pane is in full screen every file's
  menu, a filmstrip frame's included, leads with the way out.
- **The keyboard's menu hangs off the ring.** The menu key and Shift+F10 reach the page as a
  context menu event with no button, placed at the element's centre, so the element is the anchor
  instead: left edges met, the ring's 2px and its 2px gap, then a tile-gap. It flips above when the
  room below is shorter than the menu and slides along the window's edge rather than shrinking.
  Escape closes it and puts the focus back; a verb that takes the focus, as Rename does, keeps it.
- **The grid's ground opens its place's menu, under the place's name**, since it is not on the
  place's row: a folder's or a source's grid has the rows its row has, the Sorting Box's has Paste
  alone while the clipboard holds files, and a search and the Trash open nothing. A sorting
  source's folder, on its ground and on its favourite row, has Paste alone, plus its favourite
  verb, as its band does. A tile keeps its own. What a verb there opens, the keys, the picker or
  the Sorting Box's pick, opens where the menu did; Export…'s sheet hangs under the place's
  header, and Rename opens the place's own row in the tree, the folders above it opening first. A
  click on the ground keeps the focus there for the menu key, and a grid with no tile is a tab
  stop of its own, so the keyboard reaches the menu too.
- **A source is renamed on its own row**, with the same keys as its name field in Settings:
  sending someone to Settings to rename the row they are on would be the menu pointing at a place
  instead of doing the act. It edits the app's label for the source, never the folder.
- **A folder is renamed on its row too, and that one is on disk.** A name already there is said
  under the row, and Enter waits until it is edited; leaving the field then keeps the name it
  had, since what was typed cannot be used. The rename is an act like any other, with its line.
- **New Folder is a row before it is a folder.** It lands inside the folder, opened if it was
  shut, in its place in the order and already in the rename field, under the first of Windows' own
  names free there. Nothing is on disk until the name is given, by Enter or by leaving the field as
  a rename is; Escape or an empty name leaves nothing. A source's row has it too, since that row is
  the only one that stands for a source's top level.
- **Move to… for a folder is the files' picker**, with the same tree and the same Recent. A folder
  cannot go inside itself, so its own branch cannot be picked rather than being refused after the
  pick. A name already where it was going is the move's banner, the folder its one row.
- **Delete asks only when there is something to decide.** An empty folder goes at once. One with
  files asks where they go, in the banner's shape above the grid rather than in a dialog, with no
  answer pressed for you: each sorting source is its own answer, so the pick and the act are one
  press, then Delete Files Too, and × answers none. With no sorting source the Trash is the only
  answer, and nothing stands in for the missing ones.
- **The answers hold one line or all fold into one.** Two of six on the line and four behind a
  button would say the set is smaller than it is, so every sorting source is named, or none is and
  Move Files to… names them in its menu; a fold that still does not fit stacks. The test is the
  band's own line, never the window's width, so interface size and grid width fold it alike.
- **A box keeps the answer as the default**, "Always Move to the One I Choose", written into
  Settings › Sources, where it is changed or given up; with a default, the question is not asked.
  It is the only setting written by answering a question elsewhere, which is why the box says so.
- **A folder that stayed is the move's banner.** What went before the refusal stays gone and is
  one batch, undone from the foot's line; the banner holds what kept the folder, grouped by where
  each is, and Retry tries the rest again.
- **Refresh walks one folder's subtree**, as the launch walk walks a source, judging nothing
  outside it. **Only one walk runs at a time:** each retires what it did not see, so a folder walk
  beside the whole walk would have the whole walk retire what the folder walk had just found.

## Destination keys

**The ten digits move files to the folders used most**, drawn by Claude Design and built on 26
September 2026, as PRODUCT.md keeps them; ggallery's culler, a bar of keys over the grid, is cut,
and the keys need no furniture of their own. Letters stay free for the type-to-find the tree and
the picker already have, and ten is more folders than anyone keeps in their head. **A key names a
folder, not a path**, as ggallery's did, so a rename or a move keeps it, and a folder that goes
keeps its key, marked gone, because the delete that took it can be undone. Binding is a setting,
not an act on disk: it is not journalled and Ctrl+Z does not unbind. A key bound again moves
without a question, and a folder holds one key at most. A bound folder's rows carry the key
beside the count; the rail, which holds no folders, carries none.

**A press is Move to… that folder**, for what is checked, or for the file in the pane when nothing
is: the same act, the same line after it and the same banner, since the key is how it was asked
for and not a different act. When the pane's file goes, the pane moves on to the tile that took
its place, as after a delete, so sorting a place is a press per picture. Files already in the
folder are passed over without a word and only what moved is counted; when nothing would move,
the foot says "Already in Lisbon." in the refusal band. A free key is silent, like any key the app
does not use, but a key whose folder has gone did mean something, so its press says which key and
where the folder was. A key does nothing in a field, over a menu or Settings, or in the Trash,
whose only way out is Restore. The top row and the number pad are the same keys.

## Search

**The query's text is the whole state of a search**, as ggallery's was and as Claude Design drew
it on 29 September 2026. Every control that offers a term writes it into the text rather than
setting a filter the text does not show, so a search reads the same wherever it runs and can
always be typed by hand. The language is ggallery's, ported with its tests
(SCHEMA.md "Query language"); what changed on the way:

- **A path starts at a source.** ggallery had one library and matched a path's first title
  against every top-level folder; here the first title is a source's, so `path:Pictures/Trips`
  names one place even with several sources, and two sources sharing a title both answer.
- **`is:unsorted` became `is:sorting`**, the Sorting Box's own word, and means a file in a sorting
  source rather than a file with no folder, which cannot exist here.
- **The index holds the name on disk.** ggallery was dropping file names from its index because it
  renamed every file; Filmstrip keeps each file's own name, so the name you see is one you can find.
- **Terms whose tables do not exist yet are not read**: `source:`, `uploader:`, `is:duplicate`,
  `is:compressed` and `is:pending` arrive with downloads, duplicates and compression. Until then
  `source:x` reads as a label, as any unreserved key does.
- **A fault says where it is.** An unclosed `(` or `"` is reported with the character it starts at,
  so the field can name it and keep what read before it.

**A bare word is a union, not a fallback.** It matches a tag's or a label's value, a folder's title
and a word of the name all at once. Trying them in order would make tagging one file `beach` stop
`beach` from finding `bob_at_beach.jpg` anywhere, silently; a union is never quietly wrong, and a
result says how it matched. **A word finds what begins with it**: ggallery matched whole words, so
`root` found neither the folder `root1` nor a file `root_canal.jpg`, and a search that finds
nothing for the first half of a name reads as broken. The middle of a word still finds nothing,
which keeps short words from matching everything. **A folder matches what it carries itself**, never what its ancestors
or its files do, so a word finds a folder exactly when it finds that folder's own files through
the folder's tags. **A path only limits folders**: the folder a search is scoped to is where you
are, not a result.

**The field shows what it understood.** Folders, places, tags and labels become chips once a space
closes them, and words stay the words typed, so the field is the parse and not a guess at it.
**Ctrl+F** puts the caret there, as in Explorer and every browser; letters stay free for
type-to-find and digits are destination keys. **A search starts everywhere, and where you stand is
offered, never written**: a search is for finding something whose place is not known, and the
first build, which wrote the folder as the first term, hid what the wide search would have found.
The place sits dashed at the field's end, one Tab or one click away; taken, a folder writes
`path:`, the Sorting Box `is:sorting` and the Trash `is:trashed`, a chip like any other, so the
same text still means the same thing wherever it runs and Search Everywhere is only that term
removed. Tab takes the offer only with no row of the list plated; with one, it picks the row. **Typing moves
nothing; Enter runs the query**, because a grid that reflows under every letter is a grid nobody
can look at. A query that does not read runs nothing: the field names the character and the
results stay as they were.

**The list under the field offers terms for the word the text ends on**, by prefix: the words as
typed, then folders, tags and labels, eight rows at most. ggallery had nothing like it, so the
rules are Filmstrip's own:

- **Each kind takes a row in turn** until the eight are gone, so forty folders called `Day 1` to
  `Day 40` never push every tag and label off the list.
- **Folders come nearest the scope first**, and only from below it; tags and labels ignore the
  scope, since they cut across folders. Under `is:trashed` no folder is offered: nothing in the
  Trash is in one.
- **A folder's title is not offered as a tag.** Every folder carries its title as a tag, so each
  would show twice; its row as a folder already stands for it. A tag someone added is offered once
  something still carries it, most carried first.
- **A typed key narrows the list**: `path:` to folders, `tag:` to tags, a label's key to that key's
  values. `is:` and the keys that compare offer nothing, as the drawing has no row for them.
- **A folder picked replaces the scope**, since a query holds one place; any other pick replaces
  the word. A `-` typed before the word stays on the term.
- **Folder titles match without case in ASCII only**, which is SQLite's `LIKE`; tags and labels are
  stored folded, so they match in any script.

**A tag or a label in the pane's details is a search**, so the visible control PRODUCT.md asks for
sits where the term already is, and the syntax stays the fallback. **A click replaces the whole
query**: it is a new question about the whole library, and a new search starts everywhere, so a
taken scope goes with the rest and the field offers it again. **Ctrl+Click adds the term** and
keeps everything the query holds, scope included, as Ctrl+Click adds a tile to a set; it never
writes a scope, and a term the query already holds is not added twice.

**A search is a place**, as Artboards › A search is a place draws it, so the grid, the pane and
the selection work in it as anywhere. Its header names it by its terms and its back arrow, or
Escape once nothing else is open, returns to where the search began; no row in navigation is lit,
because none is this place. Folders come first, each saying what it matched. **A matched folder
has two targets**: the card is the folder, so a click goes into it and leaves the search, as a
row in navigation does; its glass is the search, so a click asks the same question inside that
folder, which takes the scope's place while the other terms stay. Each file says where it lives,
and a trashed one where it came from, keeping the Trash's verbs.

**Results come trashed first, then in the order chosen for searches**, as "Sorting a place"
says. A trashed file is found only when the query names the Trash; the drawing's Trash
scope writes `is:trashed`, so the two meet only when someone types both.

## Undo

**Every change the app makes on disk is journalled and can be undone, across a restart**, ported
from ggallery on 23 September 2026. It came before any verb that changes the disk, so none of
them ever existed without a way back. On screen since 24 September 2026, as Artboards › Undo draws
it.

- **The line has no timer.** An act ends with one line at the foot of navigation, in the slot the
  refusal band uses, and it stays until dismissed or replaced by the next news: a line gone
  before it is read is no way back at all. Ctrl+Z keeps working after it has gone, and after a
  restart, because the journal does.
- **Ctrl+Z belongs to a field while one has the focus**, and does nothing while Settings is open:
  the dialog holds the keyboard, and an undo behind it would change what the person cannot see.
  The one exception is the Tags section while its own line stands, since what that undo changes
  is the list in view (DECISIONS.md "The tags screen").
- **An undo that came back in part answers with the banner, not the line.** What stayed is
  something only the person can settle, so it sits over the grid, open, with Retry.
- **A row still in the Trash is never shown in Explorer**, which would show the name the Trash
  keeps it under. After an undo its button is Show in Trash, which goes there with the file in
  the pane; after a refused Restore it is Restore to…, since the answer is a place to choose.

- **The disk changes first, then the index and the journal together.** A disk that refuses leaves
  nothing claiming it succeeded, and a transaction that fails puts the disk back.
- **One act, one batch, one undo.** A batch comes back newest row first. Each row leaves the
  journal as it comes back and what failed stays, so trying again takes back only what stayed.
- **An undo never destroys.** A folder the app made is taken back only while it is still empty,
  on disk as well as in the index: files the index has not read yet would go with it otherwise.
- **One change to the disk at a time.** A walk that read a directory while a verb renamed it would
  find the old name gone and retire everything under it. So the walk takes a turn per source and
  a verb waits for the turn, which bounds the wait by one source's walk, never the whole pass.
- **A move between drives is a copy, checked, and only then the original's removal.** ggallery
  renamed, which cannot cross from one drive to another. A copy cut short is removed and the
  original stays whole; an original that will not go once its copy is whole is left for the next
  walk, so the index follows the copy and no file loses its identity. Both removals take only
  what the copy read and wrote, each directory only once empty: a file someone put in either
  meanwhile stays.
- **No move, rename or restore ever replaces what is there.** Checking a name and then moving
  onto it leaves a moment in which another program can take it, and `std::fs::rename` and
  `std::fs::copy` replace a file on Windows. So every move, rename, trash, restore and undo of
  one goes through `fs::relocate`, which renames with `fs::noclobber::rename` and copies between
  drives with `fs::noclobber::copy`, `CopyFileW` told to fail on an existing target; an undone
  folder delete makes its directory with `fs::noclobber::make_dir`, and never its parent's: a
  parent removed in Explorer stays removed, and the undo stays, saying it is gone. Each refuses
  a name taken in the same call that would write, and the refusal is reported as the name taken,
  as a check ahead of it would have been. No check is made ahead of it: it would only repeat the
  refusal.
- **A file keeps its own name wherever it moves.** ggallery suffixed a clashing name
  ("IMG_0031 (2).jpg"); Filmstrip refuses that one file and says where the name is taken, and the
  rest of the selection still moves. The picker drawn on the Pane sheet reports a clash and never
  resolves it for you.
- **An act is described from its own journal rows**: what kind of act, the names and places it
  touched, and how many files and folders it carried. A verb returns that description with its
  batch, and an undo reads it before anything comes back, so the line after yesterday's act,
  undone today, names it as well as the line after an act just made.
- **What stayed says where it is and why.** A verb or an undo that could not move something
  reports it as a row: the file or folder, the place it is still in, and a typed reason (the
  name is taken there, its folder is gone, another app has it open). The interface words each
  reason itself; the sentence Rust gives it is for logs.
- **A name held only by a file a walk found gone is freed** for the file arriving at it.
- **Restore is an act of its own, not an undo.** It takes a file out of the trash into the folder
  it left, or into one the person picks, under its own name; a name taken there is refused, never
  changed. A folder that has gone is found again by its place, title by title from its source, so
  making it again under the same name is how a refused restore resolves in place. Undoing a
  restore sends the file back as it was: from the folder it had left, at the moment it first went.
- **A trashed item gives up its name; a retired one keeps it.** `trashed_at` tells them apart. A
  file vanishing and coming back is the same file, so it keeps its tags. A file sent to the trash
  and then replaced under the same name is a different file: the newcomer is a new item, and the
  trashed one waits in the trash, untouched, until it is taken back.
- **The trash is a folder beside the executable**, as PRODUCT.md "Trash" has it, so a file on
  another drive is copied there. A file already gone from where the index has it is refused
  rather than trashed; the next walk retires it.
- **Deleting a folder moves or trashes what it holds first**, under the batch the folder's own
  deletion joins, so one undo takes back all of it. Moved to a sorting source, its files and its
  subfolders arrive at that source's top level as they were. The folder itself goes only once
  nothing is left in its directory but Windows' own litter (`desktop.ini`, `Thumbs.db`), which
  goes with it; any other file the app does not show keeps it in place and is named.
- **A source's own folder is not renamed on disk.** Its name in the app is the source's label, and
  its directory is the source's root; renaming that is removing one source and adding another.
- **Tagging a set is journalled too**, though it never touches the disk. A tag added to the
  checked files, or one of their own taken off them, is one transaction that writes one row for
  the whole set, so five thousand checked cost what five do, and the act ends with the Line and
  Undo as a move does. The row names exactly the files it changed, and for a removal when each had
  the tag, because a × on "3,120 of 5,000" forgets which files those were: typing the tag again
  would give it to all 5,000, and only the journal can put it back on the 3,120, in its place
  among each file's own. Undo works while a drive is away, since tags live in the index. One
  file's tag in the pane is not journalled: Add Tag… and its × are each other's way back.
  Artboards › Tagging a set.
- **The tags screen's renames, merges and deletes are journalled too**, one row per act
  (`retag`), for the same reason: a merge of `dawn` into `golden hour` forgets which files held
  which, and only the journal can split them again. DECISIONS.md "The tags screen".
- **The journal keeps everything for now.** Its rows are small, and what to prune is settled with
  the trash's limits.

## Bringing files in

**Files from Explorer come in by a copy, never a move**, built on 14 October 2026 from Artboards ›
Bringing files in, and ported from ggallery's `fs/paste.rs` with most of it changed on the way.
A paste or a drop takes nothing from where it was: the files are not the library's until they
arrive, and the originals stay as Explorer left them.

- **Under their own names, as a move is.** ggallery copied each file in under a fresh name of its
  own; here a file keeps its name and a name already taken is refused and reported in the banner,
  never suffixed and never overwritten (DECISIONS.md "Undo").
- **A folder comes in whole, its tree kept.** ggallery flattened a pasted folder into the one it
  landed in, because it had nowhere to put the shape; here every folder becomes a folder, at any
  depth. One whose name is taken stays out whole: merging it into the folder already there would
  scatter its files among another's.
- **What a walk never reads is never copied**: Windows' own litter and hidden entries. They would
  otherwise sit in the copied folders unseen, and keep an undo from taking those folders away.
- **The copy is a job**, so a camera card's thousand files never hold the window. Its line at the
  foot counts files, and its dismiss is Cancel, which finishes the file in hand and starts nothing
  more; what came in is one batch with its Undo, and what was never started is no failure.
- **No half file is ever left.** Each file is written under a hidden name beside where it goes,
  which a walk passes over, and given its own name only once it is whole, in the disk's turn. Its
  row and its journal row go in first, so a crash between the two leaves a row the next run knows
  is its own, never a file it would refuse as someone else's; a folder is made the same way. A
  copy the app's closing cuts short removes the file in hand and waits; at the next launch it goes
  on under the same batch, which is how it tells what it already brought in from a name someone
  else has taken, and it clears every hidden part left in the folders it went into.
- **A run starts by taking back what its journal claims but the disk does not hold.** Each row of
  the batch whose file is not live or not under its name is dropped and the file retired, whatever
  a walk made of it meanwhile: the launch's walk runs before the copy goes on, and retires the row
  a crash left. Kept, that row would name a file that never came in and its Undo could never
  finish. The file is then copied again, or refused if its original has gone. A folder the batch
  made whose directory is there already is taken as its own only while it holds nothing or
  something the batch brought in; one holding only what someone else put there stays theirs, and
  the copy's folder stays out whole. Holding something the batch brought in is enough, since a
  copy the closing paused goes on in folders that already hold what it brought and may have been
  added to meanwhile; a folder made after a crash never holds the batch's own files.
- **Cancel on a copy still waiting after a restart ends it as a running one ends**: what the crash
  left is taken back, its parts cleared, and its Line says what came in, with its Undo.
- **The rename into place refuses a name taken.** `std::fs::rename` replaces a file on Windows, and
  the turn keeps out only the app's own writers, so the name is given by `MoveFileExW` without
  `MOVEFILE_REPLACE_EXISTING`, which fails in the same call that would move. Not a hard link and a
  removal, which FAT32 and exFAT cards cannot do. Its paths are given in their verbatim form, as
  `std::fs` gives its own, so a name past the old 260-character limit moves as any other. The form
  is built from the absolute path, not from `canonicalize`, which opens the folder and fails on
  drives that cannot say where a handle points, as some RAM disks and encrypted volumes. The
  rename lives in `fs/noclobber.rs`, and every other move in the app goes through it ("Undo").
- **Where the copy goes is read again for each file.** A long copy outlives the folder's name: the
  app can rename or move it meanwhile, so each file and folder finds its folder's directory from
  its id in the turn, and its part is opened there in the turn too.
- **A copy is not an act until it has ended.** Its journal rows go in as it runs, but Ctrl+Z passes
  over the batch of a copy still waiting or running and takes the act before it, and its Undo is
  refused until it ends: taking back half a copy while it goes on would leave neither.
- **Retry carries each file back to the folder it was going into**, so a file left out from deep
  in a copied tree goes back into that tree, not the folder the copy started at. A copy goes into
  one folder, so a Retry over several starts one copy for each, each its own batch with its own
  Line, and Ctrl+Z takes back the newest of them first. That is meant: each is a copy of its own,
  and folding them into one batch would make the retry an act unlike any the person started.
- **Undo sends what came in to the Trash**, never straight off the disk, and takes away the folders
  the copy made once they are empty. Those folders are retired rather than forgotten, since the
  Trash still names them as where their files came from. A file the copy brought in that is
  gone from the index and the disk since is passed over: there is nothing left to send, and
  failing on it would hold the copy's Undo, and every Undo before it, for good.
- **Refused whole, before anything is queued**: a folder carried into itself or below itself, a
  drive that is away, and files that are all already where they would go. A mix copies the rest,
  and the banner names the ones already there.
- **A drag from Explorer scrolls the tree near its edges**, at a move's speed and in a move's band.
  Explorer reports the pointer only as it moves, so the scrolling runs on a timer of its own and
  goes on while the pointer rests there.
- **The clipboard is read when it may have changed**: as the window takes the focus, as a right
  button goes down, and after the app's own Copy. A menu reads that reading, since a menu opens
  at once and cannot wait on the clipboard.

## Exporting a zip

**A branch or a set leaves the library as one zip, and the library is only read**, built on 15
October 2026 from Artboards › Exporting a zip, and ported from ggallery's `fs/export.rs` with its
naming kept as one of two choices. An export moves, renames and tags nothing, so it is not in the
journal, has no Undo, never waits for a walk and never makes a move wait for it.

- **Windows' own save dialog comes first**, then one short sheet for the naming: a choice about
  names is only worth making once there is somewhere to write. The dialog opens in the last
  export's folder, or Documents, named after what is exported: the folder, or for a set the place
  it was checked in (Search Results for a search).
- **Keep Names or From Folders, and the tree either way.** ggallery only named from folders, and
  flattened a selection; here a branch is under its folder and a set under each file's path from
  its source, so two files of one name never meet. From Folders gives `Cairo - 2024-06-12-10-25-21`
  with the file's own extension: when it was taken, as the pane shows it (a camera's clock as
  written, a container's time in the local zone, DECISIONS.md "Capture dates"), or when it was
  modified with no date taken. A file at a source's top level is named for the source, and one at
  a sorting source's top level for the Sorting Box, as ggallery named an unfiled file. A name
  given twice in one folder of the zip, whatever the case, takes (2), (3) in the order the library
  read the files, so the same files always get the same names; Keep Names goes through the same
  step, which only two sources of one title can reach.
- **Entries go in path order**, a folder's own files before its folders, names A to Z whatever the
  case, and each is dated as its file is.
- **Stored, never compressed.** Pictures and videos are compressed already, so deflating them
  spends minutes to save nothing; a zip past 4 GB is still one file (zip64).
- **A drive that is away is never waited for.** Its files are counted on the sheet before anything
  is written and listed after in the banner, with no Retry, since the zip is finished; a set
  wholly away is refused before the dialog. A file that cannot be read when its turn comes, gone,
  open in another app or denied, is listed the same way and the rest go in. A file moved in the
  app while the export runs is read from where it went: a move changes the disk and then the index
  in one turn, so an export that finds a file gone takes the turn once and asks again.
- **No half zip is ever left.** The zip is written under a hidden name beside its own and given
  that name only once whole, by `fs::noclobber::rename` (DECISIONS.md "Bringing files in"), so a
  name taken meanwhile is refused and what was written removed. Cancel stops at once, mid-file,
  and removes it too, as does a failure. The app closing gives the export up: it is not taken up
  again at the next launch, and the launch removes what a crash left of one.
- **The app never replaces a file**, and Windows' dialog asks before a name that exists is
  replaced and cannot be told not to (tauri-plugin-dialog 2.8.2). No keeps the dialog open for
  another name; a Yes comes back and is refused in the band, and the sheet never opens.

## Backing up the index

**The index is backed up beside it, in `data\backups`, and any backup can be restored from
Settings**, built on 15 October 2026 from Artboards › Backing up the index, and ported from
ggallery's `db/backup.rs` with most of it changed on the way. The index holds everything the disk
does not: tags, labels, notes, statuses, covers, favourites, keys and the undo journal.

- **SQLite's own online backup, never a copy of the file.** ggallery copied `library.db` as it
  closed, after a checkpoint; here a backup is taken while the app runs and writes, so it is read
  in one step of the backup API, as of one moment, and whole even while a walk writes. Each is
  written under a hidden name beside its own and given it by `fs::noclobber::rename` only once
  whole, so a failed one leaves nothing half written. It keeps its own rollback journal, so it
  stands as one file.
- **One a day at launch, and by hand.** At launch, once the library has opened and off the
  window's thread, when the newest backup, however it was taken, is over a day old; Back Up Now
  takes one at once. The name records when and how: `index-<ms>-launch.db`, `-hand`, `-restore`.
  One refused at launch says so at the foot of navigation, and the app opens as ever.
- **The newest are kept, to a number Settings sets**: 3, 7, 14 or 30, seven until another is
  chosen. ggallery kept five, fixed. The number lives in `filmstrip.config.json`, not the index,
  which a restore replaces. Lowering it removes nothing until the next backup, which removes the
  oldest past it, so a slip of the dropdown is put back before it costs anything.
- **A restore checks the chosen backup whole first**, every page read, and refuses one that cannot
  be read, or that a later build wrote, before anything is written. Then the queue is held: each
  copy and export is stopped as its Cancel would, a walk stops before its next directory, and
  the restore waits for every job in flight. Then the index as it is is backed up, "before restore";
  then the chosen one is copied aside, brought to this build's schema, settled, and copied over the
  live index by the backup API in one write, so one that fails part way leaves the index as it
  was. Only once that has succeeded do the oldest go, and never the one restored: had it been the
  oldest, it stays past the number until the next backup. Rotating, queueing the walk and letting
  the window load from every source the restored index has follow it, and none of them can fail a
  restore that has swapped.
- **What a restore leaves as it is now.** The index goes back; the disk does not. The Trash is kept
  as it is now: a file in it since the backup is in it again from the folder it left, found by its
  source's root and the titles below it, with the folders on the way made retired where the
  backup has none. One from a source added since, or from a place the backup cannot find, loses
  its row as that source's other rows do, and its file is left in `data\trash` untouched: never
  shown, never restorable and never expiring, as when a source is removed, until #110 settles what
  becomes of such files. A row the backup has in the Trash whose file is no longer in
  `data\trash` is retired where it was, keeping its tags and uuid for the walk to find again, or
  dropped where a file there now has its name. The job queue starts empty but for the walk, which
  runs at once, so a copy or an export waiting in the backup never runs again and files moved or
  added since are found where they are. A source added since is forgotten, and its files on disk
  are left as they are.
- **Undo goes no further back than a restore.** The journal comes back as it was then, so restoring
  the "before restore" backup puts the index back whole, but what it holds describes a disk the
  walk has read again since. A restore records the newest journal row it kept in `setting`, and
  Ctrl+Z and Undo stop there.

## Expiry goes to the Recycle Bin

**An item that expires from the trash goes to the Windows Recycle Bin**, as the owner decided on
13 October 2026. Expiry is the trash keeping its own limits, not an act the person made, so
it may end what the app can take back, but it may not destroy: an item that outlives the time to
live, or goes while the trash is over its total size, gets one more chance outside the app. The
other answer, deleting it outright, would have made the trash the last chance and its limits a
promise the person has to keep in mind.

- **Restore and undo end at expiry.** From the Recycle Bin a file is Windows' to give back, and
  the app no longer holds it.
- **Purge stays the one irreversible act**, as PRD.md "What must always hold" has it: emptying the
  trash deletes outright, and it asks first.
- **An item over the per-item size goes where an expiry would**: refused by the trash, the delete
  offers to send it to the Recycle Bin instead.

## Settings

**A dialog over the window**, drawn by Claude Design and built on 14 September 2026. The frame is
three columns and stays three; a preference set once a month should not cost the grid a surface,
and Escape or a click outside leaves nothing behind. It is the only thing over the window, and
the only use of the scrim.

**A preference belongs there only when there is nowhere on screen to set it.** Today that is the
interface size, the grid's layout, and where a deleted folder's files go without asking. That
last one sits in Sources under the sorting sources it names, not under Appearance, so removing a
sorting source takes its default with it and the row falls back to asking; with no sorting source
there is nothing for it to name and the row is not there. The panel widths, which panels are folded, the tile size
and whether the pane's details are open all keep their controls where they are: a second control
for the same thing is a second thing to keep in sync.

**Destination Keys sits in the Library group, beside Sources**, not with the app's own shortcuts:
a key is about a folder in the library. It lists all ten keys, bound or free, so which are left
is read at a glance. A bound row is its key, its folder as a button that opens the Move to…
picker to choose another, its count and a ×; a free row offers Choose Folder…; one whose folder
has gone is in the red and says where it was, and keeps its key until it is freed or given to
another folder. The picker opens inside the dialog, since the window behind it is inert.

**A rail of sections, grouped and filtered**, because it will grow: tabs hold six or seven names
and then scroll, and a rail takes twenty. A section with nothing in it yet is not in the rail.

**No Save and no Cancel.** Every control writes as it is touched, 400ms after the last change, as
a splitter does. A dialog that can be cancelled implies a draft, and there is none.

## The tags screen

**The vocabulary is a section of Settings, Library › Tags, after Destination Keys**, as
Artboards › Tags draws it and built on 13 October 2026. It is tended now and then, not while
looking, so it does not take a place in navigation: everything navigation shows is somewhere on
disk, and a list of words is not.

- **The counts are what a search finds.** Files is every live file carrying the term, its own or
  from a folder; Folders is every live folder holding it itself. Both come from the index, so a
  source that is away is counted, and every act works while it is away.
- **A folder's name is in the list but is not the list's to change.** It is a tag every file
  below carries, and the counts would not add up without it. Rename, merge and delete take only
  the uses given by hand, and the question says so; a row that is only a name has no ⋯.
- **A deleted folder's name is not in the list.** Its row stays for undo and keeps its name's
  tag, which nothing in the list can change and no search finds, so a tag that is only such names
  is left out, and its delete and rename change nothing. A rename onto one takes that tag, as a
  merge would. A tag given by hand that is also one leaves the list once its last use goes.
- **A rename keeps the tag's id**, so nothing holding it moves. A name cannot be renamed, so a
  rename of a tag that is also a name moves its hand-given uses onto a new tag instead.
- **Renaming onto a tag that exists is a merge, and asks first.** The backend refuses a rename
  onto one; the row asks, and Merge Tags calls `merge_tags`. A merge moves every use given by hand
  onto the other, leaving no file or folder holding it twice, and forgets the first once nothing
  holds it. Keys and values are the same: `rename_label_key` refuses a key that exists, and
  `merge_label_keys` is what asking leads to.
- **A key merge keeps a key once down a branch**, as the band does: `vocabulary::key_clash`
  names the first folder holding the key that would land on one holding the other, itself, above
  or below, and a deleted folder holding both; the field refuses it where it is typed, and leaves it
  out of Merge Into…'s offers. A deleted folder's line says it was deleted, since nothing on
  screen shows it, but not that it is in the Trash: one whose files went to a sorting source, or
  whose directory a walk found gone, is not there. `label_key_clashes` answers for every other key at once as the field
  opens, and an Enter before the answer waits for it. A value never leaves its key, so a value's
  rename or merge is never refused.
- **Every act is one batch.** The row records each term it reworded, made or forgot and every
  `folder_tag` and `item_tag` row it moved or took away, so an undo puts each back under its own
  id and in its old place among a file's own. An id taken since gives the term another; a term's
  old words taken since fold that one back in.
- **What files carry is settled in one statement for the whole set**, nearest folder first, as
  `tags::rebuild_item` resolves one item, so a merge across five thousand files costs what a
  merge across five does.
- **Ctrl+Z works in the section while its line stands**, because the list it changes is in view;
  elsewhere in Settings it still does nothing, as DECISIONS.md "Undo" has it. In the filter or a
  field it is the field's own.

## Testing in a real browser, never jsdom

jsdom reports every element as zero-sized, so anything about size, overflow, position or
visibility passes there and fails in life. Vitest's browser mode runs on the Edge already
installed on a Windows machine, the engine WebView2 shares, so the numbers are real. Elsewhere
the same tests drive Chromium, the same engine; where the platforms differ (a right-click opens
its menu on press off Windows) the app works on both.

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
taken from ggallery's drawing was turned down. The sheets live in `docs/design/` and the
repository is their source of truth: a design pass draws the backlog in them directly and
commits them, with no hand-off in between. The earlier drawing stays
beside them as `ggallery-drawing.html`.

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
