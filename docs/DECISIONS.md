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

Everything the app writes lives beside its own executable: the index, thumbnails, backups and
WebView2's profile. A deleted file goes to the Windows Recycle Bin on its own drive, which is
Windows', not the app's: DECISIONS.md "The Trash is the Recycle Bin". `lib.rs` passes
`data_directory` to the window builder. Measured on 12 September 2026,
`%LOCALAPPDATA%\com.darthbirb.filmstrip` is never created — the builder call is sufficient on its
own.

The library is a folder the user chooses. Nothing in it is touched except when they ask.

## Places, not queries

Everything the navigation shows is somewhere on disk, and every item has a parent directory.

The predecessor modelled two of them as queries instead — the Sorting Box as `folder_id = None`,
the Trash as `is:trashed` — and the cost was structural rather than cosmetic: a row that could
never highlight because it had no scope to be in, no empty state to design, and nowhere for a
restore to put anything back.

The Sorting Box is the one that is plural. It is several real folders the user nominates, shown
as one surface — not one directory, and not a view over the index.

**Which doorway was taken is the kind.** A folder becomes a source through Add Source… or Add
Sorting Source…, and nothing is asked once the picker closes, because the answer was the doorway.
Asking afterwards would mean a dialog after the picker's dialog, and asking someone to choose
between two words before they have seen either behave; Settings › Sources is where a kind is
corrected instead. Add Source… is navigation's Library caption and the empty library's one move.
Add Sorting Source… stands on screen beside Add Source… in Settings › Sources and as the empty
Sorting Box's one move, and the Sorting Box's row menu and its grid's ground repeat it as a
shortcut, as a right-click repeats what the interface already does. It is never a button on the
row: a control inside a tree row is a second tab stop in a tree that is one, and a screen reader
names it in the row's name or not at all.

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

## Names as NTFS compares them

A directory cannot hold two names NTFS calls one, and a walk pairs what it finds on disk with
the rows it has by name, so folder titles and file names are matched as NTFS matches them.
SQLite's `NOCASE` folds ASCII only: `Ägypten` renamed to `ägypten` in Explorer read as one
folder gone and another arrived, and its files came back as new items without their tags.

The comparison is `NAME_FOLD`, a collation the app registers on every connection
(`db::compare_names`). It maps each UTF-16 unit through a fixed table in source
(`db::upcase`), taken once from Windows' own `RtlUpcaseUnicodeChar`. Only pairs that NTFS
refused to hold side by side in one directory were kept, and a test proves it again for every
pair. Unicode's own case mappings fold far more than NTFS does: `kız` and `kiz`, `5µm` and
`5μm`, `ιος` and `ΙΟΣ` sit side by side on disk. A fold that called them one name would have a
walk take one file for the other, and that loses identity. So the table errs toward folding
less: a pair it misses only brings the old gap back for that character.

The table is the Windows 7-era upcase. It holds the pairs Unicode 5.1 added and none from later
versions, which says Windows has kept it unchanged since, so every volume formatted from Windows
7 on shares it. Each NTFS volume keeps the table it was formatted with, though: one formatted by
an earlier Windows may fold fewer pairs, and could hold side by side two names the table calls
one. That takes a Glagolitic, Coptic or similar letter differing only in case within one folder,
rare enough to leave.

The table is data, never derived at runtime from the toolchain's or the system's Unicode
tables. A unique index must never see its collation's order change under it. If the table
ever changes, that change is a numbered migration that rebuilds the two indexes built with it.

Those two indexes keep names unique, so a lookup reads the index rather than every row in the
folder. A stored folded key would do the same, at the cost of every write keeping it.

Lengths are counted as NTFS counts them: 255 UTF-16 units a component, not 255 bytes. A cut
falls between characters, never inside one or between a surrogate pair's halves. A file name
loses the end of its stem, never its extension, and a suffix that makes a name unique cuts the
stem to fit (`fs::sanitize`).

## A walk only judges what it read

A walk retires whatever it did not find, so it may only judge what it actually read.
**An unreachable source is skipped entirely:** an unplugged drive reads as "the directory is not
there", and treating that as "everything in it was deleted" would empty the index for a source
that is merely away. **A sweep is scoped to one source:** a walk reads one root, so it can only
speak for that root's files and folders.

**The same holds mid-walk.** A drive can be unplugged halfway through its walk, and one directory
can refuse to open — access denied, a sharing violation — while the rest read. Both look like
"nothing here", so the walk collects its read errors per source: under a directory it could not
read in full, no item or folder is retired, and a file it found but could not read keeps its row.
A failure the walker cannot place keeps the whole source. A source whose root is not there once
its walk ends retires nothing at all and is not stamped as read, and a folder retires only while
its source's root is still there to show its directory gone. Nothing is recreated on the drive's
return, so tags, notes, covers and thumbnails stay on the rows they belong to.

**Hidden is a dot-name or a Windows attribute:** a name starting with a dot, or an entry carrying
the hidden or system attribute, as `System Volume Information` at a drive's root does. The walk
never reads them and a paste never copies them. A source's own root is always read, since a
drive's root carries both attributes.

A file whose size and modification time match its row is not opened again. That is the common
case, and what keeps walking an unchanged library cheap.

## Background work

**Anything slower than a moment runs on the job queue**, never inside a command: a walk, a
thumbnail. A command returns at once; worker threads, one per core but one and between two and
eight, each with its own connection, claim jobs from the `job` table in priority order. A walk
is queued at every launch.

**The table outlives the app.** A job that succeeds is deleted. One that fails is retried once
if the failure might pass — a locked file, a busy database — and otherwise kept with its reason
for the failure list. One left running at shutdown goes back to waiting at the next launch. A
decoder that panics on one file fails that job and nothing else.

**A walk queues thumbnails without holding up the app.** It looks in the cache for every
picture and video before it takes the write lock, then records what it found and queues what is
missing in one short transaction, so a library of 100,000 files never keeps an act waiting on
100,000 lookups. A thumbnail or scrub frames already waiting are not queued again; one being made
may have read the file before it changed, so it does not count. A source that cannot be reached
has nothing queued, and a job whose file, or whose source, went away while it waited ends without
a failure: the next walk retires a file deleted meanwhile, and queues one on a drive that comes
back. An unplugged drive, or files deleted in Explorer, never fill the failure list.

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
changed, so a queue that empties within a tick still says so. Each event also counts the walks
finished and names the items whose thumbnails were made since the last, so what shows them can
tell a new thumbnail from a changed place. The grid's half is in "The grid".

**Work in progress shows at the foot of the panel doing it**, drawn on 15 September 2026 and built
the day after: the walk's line grows above a baseline of what the library holds, and the baseline
never moves, so nothing in the tree shifts as the line comes and goes. Its bar is pewter rather
than red, because progress states a fact rather than raising an alarm. **What could not be read
goes above the grid instead**, where it stays in the way until it is dealt with: a banner on a
danger hairline, never a fill, that counts the failures, offers to try them again, and opens its
list in place rather than in a dialog. Neither is a dialog, and both leave when they are done.
Each row is the file's path from inside its source, as Explorer writes it, so two files of one
name in different folders read apart, with a way to go and look at it; a failed walk of a source's
own folder goes by the source's name. Copies, moves and exports count themselves on their own
lines, so they are left out of the list as they are out of its count.

## Reasons, never raw errors

**Every failure reaches the interface as a `Reason`, and the interface words it.** An error's
own text is written for whoever reads the code: SQLite's "database is locked", Windows' "Access is
denied. (os error 5)", a decoder's complaint, the app's own "journal row 12 does not read". None
of it is a sentence for the person using the app, and capitalising it does not make one. So
`AppError` crosses to the interface as its kind and a `Reason` only, `Reason::of` mapping the
disk's, the index's and the decoder's failures to the reasons they mean, and what the error said
goes to the log, which is the backend's standard error as everywhere else in it. What has no
reason of its own is `Other`, worded "Something went wrong": one fixed sentence the person can
trust is not a fragment of something else.

**Each reason has two forms**: a phrase for a banner's Reason column, and a sentence for after
the one that says what failed, which ends in one full stop and says what to do where there is
something to do: "The index is busy. Try again in a moment." The failure list keeps a job's
reason in the job table rather than its text, so the list words it as the undo banner does, under
the same heading.

## Acts say why they failed

**An act the person asked for never fails in silence.** Show in Explorer, a copy, a favourite, a
note, a key, a move or a delete that the backend refuses says so at the foot, in the Band: what
could not be done, naming what it was done to, then the reason's sentence, as "Could not show
_DSC4411.ARW in Explorer. Windows refused access." A catch that turns a failure into nothing is
the one way this breaks, so a lint rule in `lint/` refuses `.catch(() => undefined)` and
`.catch(() => null)` under `src/app` and `src/ui`: an act catches with `failed(what)`, and work
nobody asked for, a read again after a job, a listener, a clip's play, with `unasked`, which says
by its name that there is nobody to tell. Settings sits over the foot, so it shows the same Band
at its own foot while it is open.

**A field keeps what was typed when its save fails.** A note that was not saved comes back open
with the text in it and says "Not saved." and why under it, where its keys were; a tag that was
not added is typed in its field again. Losing what someone wrote to a failure they were not told
about is the worst of these, because the text looked kept.

**A name Windows would refuse is refused, not cleaned.** Explorer refuses `\ / : * ? " < > |` in a
name with a tip; dropping the character instead leaves a name the person did not type. A rename
or a new folder holding one is refused with `ForbiddenCharacter`, the name field saying which.
Names the app makes itself, an export's zip and the folders inside it, are still made safe
quietly, since nobody typed them.

**The index that cannot be opened says so where the sources would be**, with Retry: with nothing
read there is nothing else for navigation to show, and an empty panel reads as an empty library.

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
the day after: `41,236 files · 312 GB`. A count says how many, not how much, and a library of
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
parts, "files" and then the size, and never a figure cut part-way.

## The grid

**Two layouts, and the user chooses**, decided on 13 September 2026 after comparing both live:
justified rows, where every picture keeps its shape and each row runs edge to edge, and uniform
squares, cropped to fill. Rows are the default. **The choice lives in Settings**, since 14
September 2026: it is made once and left alone, and the grid's header has the place's name to
hold first.

**The tile size stays in the header**, the one view preference people change while looking, as
one button naming the step it is on: Small, Medium, Large or Extra large, 8, 11, 15 and 20rem. A
named step says where the size is without a click, which two nudge buttons and a slider never
did. A size saved before the steps existed lands on the nearest. **Ctrl+wheel over the grid steps
it too**, as Explorer, Photos and XnView do, a notch a step and a touchpad's small turns gathered
into one; Ctrl+= and Ctrl+- stay with the interface size, as a browser's do.

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

**Background work patches tiles rather than reading the place again**, since 24 November 2026: a
place of 40,000 files read on every half-second report spent the window reading rows it already had.
Each report names the items whose thumbnails or scrub frames were made since the last, and the grid
reads only those and lays what changed over their tiles. A report reads the whole place again only
when files may have come, gone or moved: while a walk runs or after one ends, as a copy or a move
goes on, and when the queue starts or settles. Those reads wait out a window of a second, so however
often the reports come, the place is read at most once in it, and navigation counts a copy's or a
move's files again on a window of its own; an act of the app's own, a copy or a move ending among
them, still reads at once. A patched tile keeps its place, even when the capture date its thumbnail
read would sort it elsewhere, until the queue settles and the place is read again, so the grid does
not reshuffle under the pointer while thumbnails arrive.

**Every read is numbered, and only the newest answers.** A listing that answers after one asked
later is dropped, so a slow reply never brings back a file just moved away. A patch asked before
the last listing that landed is dropped too; one asked after a listing still on its way is laid
over that listing when it lands.

**Whether a thumbnail is made is read from the index**, never from the disk: `item.thumbed` and
`item.scrubbed`, set by the job that makes each and checked against the cache by every walk, for
videos too while ffmpeg is missing, so listing a place does not look for 40,000 files twice over.

**Empty is several different facts, and each says its own**, drawn on 15 September 2026 and built
the day after. A cleared Sorting Box, an emptied Trash, a folder holding only folders, a folder
holding nothing and a source that cannot be reached are five situations, and only the fourth is
really "no pictures here". They keep one shape so they do not read as five designs, and each
names the folder or source it is talking about. **Only a folder of folders and the Sorting Box
offer an action**: the first lists its folders as buttons, because going into one is the obvious
next move and the counts are already known, and an empty Sorting Box offers Add Sorting Source…,
the one way it fills, as "Places, not queries" says; a button that only restates the situation
is worse than no button. A place whose
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

**A screen reader hears where a tile stands and whether it is checked.** The files are an ARIA
grid, multi-selectable, of one-cell rows, one per file: each row says its place among all the
place's files, since only the rows near the view are drawn, and is selected while its file is
checked. The cell holds the tile and its box, a real checkbox named Select and the file's name,
as the acts say Select. A multi-select listbox would tell a tile the same way, but its option
cannot hold a checkbox, and the box is the pointer's way to check a file.

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

**Copy as Path is a row, never a button**, added on 12 October 2026: the bar is drawn with three glyph
buttons, and a second copy glyph beside the first would be two squares no one could tell apart.
It lives in the ⋯ with Rename, directly after Copy once Copy has folded in, and in a file's menu
and a set's directly after Copy, with Copy's glyph, since the sheets draw no glyph for a path. The
clipboard gets text, the full Windows path, one to a line for a set. The index knows the path, so
a source that is away keeps the verb.

**A file in the Trash has the way back and nothing else**, drawn by Claude Design and built on 25
September 2026. Its bar holds Restore and Restore to…, worded and from the left, and no ⋯, since
nothing is left to fold; its menu holds the same two under Full Screen. Favourite, Move to… and
Rename would change a file that is not in the library, and Show in Explorer, Copy and Open with
Default App would hand Windows the name the Recycle Bin keeps it under, never the one it was given;
all of them are absent rather than greyed. Nothing purges: emptying the Trash is under Later. Its
details say where it came from and when it went, in place of where it is, and the Name row is only
its name. Restored from the Trash, the pane moves on as it does after a delete.

**A move takes the pane on as a delete does**, settled on 25 November 2026: Move to…, a drop on a
row of navigation and a destination key are one act, and each moved the pane's file out of its
place while the pane stayed on it, the strip running through files with none of them ringed.
Triage tools advance after a move as after a delete. **It moves on only once the file has left
its place**, and the place itself is asked again after the move: a search that still finds the
file, the Sorting Box still holding it, or a file that was already in the folder the rest went to
keeps the pane on it, since no tile took its place. **A move between drives moves the pane on as
it starts**, not when its job ends: the file is already on its way, a press per picture would
otherwise wait out each copy, and the pane jumping seconds later would take the picture from
under whatever is being looked at by then. So whether it leaves is judged from where it is going:
out of a folder it does, and out of the Sorting Box unless into a sorting source. A search can
only be asked once the job lands, since it may find the file by its name or by the folder it
lived in, so there the pane stays on the file until then and moves on if the search has lost it.
One the job leaves where it was is named by its banner.

**The focus stays where the act was taken**, settled on 25 November 2026. Delete and Restore take
their file's bar with them, which dropped the focus to the page and sent a keyboard or screen
reader back to the top. The next file's bar gives the same button the focus, so Delete pressed
again deletes the next, and Move to… and Restore to… are back on their button once the picker
has done its work; when that bar has no such button, as a file restored inside a search
shows the library's bar, the strip's frame for the file takes it, or its picture once the strip
no longer runs through it, as a restored file leaves a search of the Trash. Only a focus that fell
to the page is taken back: one the act moved on purpose, as the question about a drive with no
Recycle Bin does, stays where it went. A pane left empty has nothing to take it.

**A video plays on a plate of the app's own**, drawn by Claude Design and built on 12 October
2026, in place of the controls the window brings with it: play, the track, the time and the mute
on the one dark glass, over the picture's foot and as wide as the picture. **Its glyphs are one
size, the scale's `glyph`**: the drawing had the steps and the mute at two sizes the scale does
not name, and play is told apart by being the one filled and in white, not by a size of its own.
**What fits is measured, as in the action bar.** The total leaves first, its slash with it,
because the header row above already reads the same length; then the mute. The elapsed is on
screen nowhere else, so it never leaves, nor do play and the track, which holds a least width of
its own. Paused, the plate stays up; playing, it goes a moment after the pointer leaves the
picture, and comes back for the keyboard.

**A frame step is a frame of the file's own rate, never a guess**, built on 29 October 2026. The
probe records one frame's length from the stream's average rate, else its base rate, and a step
lands in the middle of the next frame, so float error never shows the one before; it pauses
first, so a step always leaves the plate still. ggallery stepped a nominal 1/30s, which on a 24p
clip is a step to the wrong frame. **On a variable-rate file a step is the average frame**, so it
skips some real frames and repeats others: the file has one rate to read, and the base rate can
be a time base rather than anything its frames keep to. A file probed before the rate was read
keeps a plate without steps rather than being read again. **The speeds are a named four, 0.5× to
2×, in a list rather than a button that cycles**, since cycling makes going back one a press three
times; the list ends rather than wraps. The speed holds from video to video but is 1× at each
launch, because a clip found days later racing at 2× looks broken; volume and mute are saved
preferences, as the details' fold is. As the plate narrows the speed leaves before the steps,
being the one control about a preference rather than the clip, and the two steps leave together.

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

**Left and Right step through the strip's place wherever the focus is in the pane, and anywhere in
full screen; Home and End go to its first and last**, settled on 24 November 2026. Every viewer
steps this way, and the strip alone answering, eight Tab presses from the picture, read as keys that
did nothing. A field, an open menu or list, a dialog and the video's track keep the keys first, and
so does a zoomed picture holding the focus: its arrows pan, and back at fit they step again. A step
taken from anywhere but the strip puts the focus on the new picture, since the bar and the picture
it was on go with the file; from the strip it stays on the frame. However full screen is entered,
the focus goes to the picture, so the first press steps. Several files in the pane do not step, as
the strip only stands on the first of them and a step would put the set down.

**Nothing stands in while the original loads.** A thumbnail under it showed for a split second
as a low copy of the picture, first small and then at the picture's size, and only when the
original was not already cached. An original the window cannot draw is stood in for by its
thumbnail, at the size the original would fit at, from the shape the index read when it made it.

**What the pane knows comes from the file.** Capture dates, a video's length and codec, and a
rotated recording's true shape are read when the thumbnail is made; "Capture dates" and "Video
and ffmpeg" above say how.

## Several files in the pane

**Files dragged onto the pane are drawn at one scale**, drawn by Claude Design on Pane › several
and built on 20 October 2026: one picture made of several, in the same pane and the same mode.
**"One scale" is one pixel scale**, the figure the zoom plate reads, so a 640-wide clip stands a
tenth as wide as a 6000-wide photograph beside it. Equal cells are the tiled compare PRD.md drops,
and one height in justified rows is equal cells by another measure.

- **The pane tries every split of the files, in the order added, into rows** and keeps the one
  that draws them largest. Scales within a millionth of the largest count as equal, which only
  absorbs rounding; of equal splits it keeps the fewest rows, then the earlier rows fuller, as
  text wraps. Ties are routine, since rows of one height reorder freely, and the rule leaves every
  set exactly one layout. The search is a table of the least height each run of files can take in
  so many rows, bisected on the scale, so it costs the same for every split there is.
- **The scale stops at 100%**, as a lone picture's does, and never draws any file past the media
  area. **One floor outranks the stop**, `pane-set-least`: no file is drawn under a badge and two
  insets on its shorter side, or two badges and three on its longer, so its × and a video's mute
  always fit. **The room outranks the floor**: a file the floor would push past the area is drawn
  at the most the area holds, in a band the floor's size across its row. The cap cuts back only
  the floor's lift; the set's scale already keeps every file inside the area.
- **Each file draws its original, never its thumbnail.** A 320px thumbnail swapped for the
  original as the room grows is the stand-in "The pane" turned down.
- **A drop adds, a click replaces.** Files dragged onto the open pane join the end of what it
  shows, in the order carried, or take its place while it shows nothing; a click anywhere shows
  one alone again. Each file keeps the place it was carried from, which it takes with it when it
  is shown alone; the strip stays on the first's. A file already shown is neither added nor
  counted, so a drop of only those is refused, as one into a full pane is; past the limit what
  fits goes in and the foot's Line says how many of how many, with no Undo since the library did
  not change. A folded pane's rail takes no drop, and Explorer's files are never taken: they are
  not in the index until they land in a folder.
- **The limit is twelve, a third of what held.** A set that holds still costs nothing to show, so
  the measure is one that draws every frame: on 26 October 2026, in the headless Edge the tests
  use on the owner's machine, a 1500 × 900 pane of 6000 × 4000 JPEG originals was resized every
  frame, down to half its width and back each second, so the set was laid out and drawn again at
  a new scale each time. Twelve, 24 and 36 held the display's 60 a second, no more than four
  frames in 300 late; 48 fell to 52 in one run of two, and 72 to 30. Twelve leaves the margin a
  slower machine and CI's runner need: there, the same day, twelve held 60 with at most one frame
  in 300 late, while 48 fell to 45 in one run and held 57 in another.
  `src/app/pane/set-frame-rate.timing.test.tsx` holds `pane-set` to it, run alone.
- **Every clip in the set plays while this machine keeps time with them, and the clips added last
  pause while it does not.** The owner's choice on #175: no fixed count, since one fixed count
  either holds back a machine with room or slows the picture on one without. Four 4K clips that
  CI decodes in software ran at about three-quarters of their pace, while the owner's machine held
  eight at 1080p60. Comparable players set no count either. The pane measures the clips it plays,
  `src/app/pane/keep-time.ts`, by what the bench counts below. That is the frames each dropped of
  those due, from `getVideoPlaybackQuality`, and its pace, how far its clock moved against the
  window's.
  - **It measures in two-second spans and judges by the last three.** A span is behind when the
    clips' pace is under 0.95 or they dropped 1% of their frames, the timing test's bounds. Two
    behind of the last three is a fall, so one hitch never is, as the test never takes one span
    either. The first span after any change is not measured, since a clip starting up is slow on
    any machine. A clip that looped in a span, or that runs under two spans, is left out of it,
    because its clock cannot tell a loop from a stall.
  - **A fall pauses as many as the measure says cannot hold.** The clips showed a share of the
    frames due at their pace: their pace times the share not dropped. That budget keeps the
    playing count times that share, over 0.95, rounded down, and the pane plays that many: at
    least one fewer than before, never under one. Twelve at 0.3 go to three in one step, not one a
    span. Clips pause from the end of the play order. The clip with the sound comes first, then the
    rest in the order added. A paused clip holds on the frame it reached, as clips past the old
    count held on their first, and nothing is drawn on it.
  - **After a calm spell, ten seconds with no fall, one more resumes**, and so on while there is
    room. **The count that fell waits a minute from the fall** before it is tried again, and twice
    as long each time it falls there again, up to eight minutes. A count that holds through a calm
    spell is forgotten. Without that wait, a machine one clip short would fall every sixteen
    seconds, over a third of the time with every clip slowed. A clip new to the set forgets the
    count that fell and its wait, since it may weigh less, but the lowered count stays and climbs
    from there. A clip taken out forgets nothing, since what is left weighs no more. **Once no clip
    that was playing at a fall is left in the set, the pane forgets every fall**, and every clip
    plays again as at first: no limit outlives the clips that set it. The pane never replaces a
    set whole: a drop adds clips, × takes one out, and files deleted or moved away leave it, so
    this is what lifts a limit as heavy clips are swapped for light ones. A hidden window is not
    measured, and the measure starts over once it shows.
  - **What each settled on**, twelve clips of each kind in the 1500 × 900 pane, on 14 November
    2026. The timing test waits until the count playing has not changed for fourteen seconds,
    which happens only once every clip plays or the pane waits on a count that fell. It then
    counts three five-second spans, and a change inside them starts the wait over. Each machine's
    column is how many clips it settled on playing, then what they dropped and their pace:

    | Clips         | Here | Dropped     | Pace        | CI   | Dropped    | Pace        |
    | ------------- | ---- | ----------- | ----------- | ---- | ---------- | ----------- |
    | Recorded WebM | 7–8  | 0 of 2726   | 0.986–1.000 | 8–10 | 0 of 7105  | 0.981–1.000 |
    | H.264 1080p30 | 12   | 8 of 5388   | 0.998–1.000 | 6–8  | 7 of 6272  | 0.977–1.000 |
    | H.264 1080p60 | 12   | 15 of 10786 | 0.997–1.000 | 4–5  | 11 of 8038 | 0.987–1.000 |
    | H.264 4K30    | 8–9  | 6 of 3598   | 0.999–1.000 | 2–3  | 7 of 2197  | 0.947–1.000 |

    Here the clips decode in hardware and the WebM in software, as above. The dropped frames and
    pace are from the second of four runs, and the counts span every run. Here, 4K settled on
    eight in three runs and nine in the fourth, and 1080p60 held all twelve in every run, where
    the probe below once saw three of twelve stand still. CI's runner decodes them all in
    software, and its column spans two of this pull request's Gates runs, 43587317817 and
    43589646232, dropped frames summed over both. The count a shared runner settles on varies:
    the first run gave the higher of each range, the second the lower, and every count kept time.
    4K settled on three, then on two, its middle span at 0.959 though one span fell to 0.947.
    HEVC is not counted, as below. The measure's numbers are not tokens: they draw nothing, and a
    test that needs them reads `KEEP`. The timing test holds all twelve 1080p30 clips playing
    where `mediaCapabilities` reports them decoded in hardware, so a pane that pauses more than
    it must fails there too.
  - **The timing test leaves out each loop's restart, as the pane's measure leaves out loops.**
    It reads every playing clip's clock at every frame, and from the frame a clock goes back to
    the frame it moves again, for up to one of the pane's spans, counts neither the clip's time
    nor the window's. A hold past that, and a stall anywhere else, count against the pace, as the
    pane counts a clock still held in the span after the loop. The table above counted a loop as the clip's length instead,
    so its lowest paces are partly loops. On CI on 15 November 2026, run 43669834508, every
    MP4 clip decoded in software held its clock at the start for 150 to 383 ms after each loop,
    and stood still nowhere else; the recorded WebM loops without a pause. Charged to the span,
    that put two 4K clips that looped in different spans at 0.931 and 0.925 in run 43667718288,
    a fail, while the pane, which never judges a span a clip looped in, kept both playing.

- **The bounds were set from the test clip's edge.** Counted on 2 November 2026, before the pane
  measured itself, with the 37ms clip among twelve originals in a 1500 × 900 pane. These were runs
  of three five-second spans, three to nine runs a count over two or three probes. Each run counted
  the frames dropped of those due and the pace, how far the clips' own clocks moved against the
  window's. Pace was counted for four to six. Elsewhere it is the frames due a second over the 26.1
  a second, or 26.4 on CI, that clips keeping time showed.

  | Clips | Owner's machine, dropped        | Pace        | CI's runner, dropped | Pace        |
  | ----- | ------------------------------- | ----------- | -------------------- | ----------- |
  | 2     | 0 of 2352                       | 1.00        | 0 of 2384            | 1.00        |
  | 3     | 8 of 3530, in 1 of 9 spans      | 1.00        | 0 of 3574            | 1.00        |
  | 4     | 28 of 14113, in 3 of 27 spans   | 0.998–1.000 | 0 of 9534            | 1.000       |
  | 5     | 0 of 11778                      | 1.000       | 0 of 5960            | 1.000       |
  | 6     | 205 of 19096, in all 27 spans   | 0.895–0.902 | 0 of 14299           | 1.000       |
  | 8     | 260 of 6343                     | about 0.67  | 230 of 7353          | about 0.77  |
  | 10    | 597 of 6339                     | about 0.54  | 342 of 7399          | about 0.62  |
  | 12    | 841 of 6358                     | about 0.45  | 742 of 7587          | about 0.53  |

  Past the edge the clips share a fixed budget. Six to twelve were due about 141 frames a second
  between them here, however many there were, and eight to twelve about 165 on CI. So each clip
  falls behind and shows the picture slowed, which is why a fall's step is the share shown. The
  window held its 30 a second through six, and ran off it past. That clip is a MediaRecorder WebM,
  VP8 of flat colour at about 26 a second, which the browser decodes in software. Its budget does
  not carry to phone footage either way, so that is counted on its own, below.

  **One noisy span does not set the edge.** Three dropped 8 of 392 in one span of one run, and
  none in the rest. Four dropped in 3 of its 27 spans, 15 of 520 at most, while five above them
  dropped none in six runs, and six dropped in every span of every run. So a count is judged
  across spans, never by one, and the test takes the middle of three spans for both its bounds.
  One hitch on a shared runner then fails neither. **The dropped share alone does not see six:**
  its middle span dropped 0.84%, under the bound of one in a hundred, with the clips at 0.90. So
  pace is bounded too, at 0.95, halfway between 0.998, the slowest that held, and 0.902, the
  fastest that fell. No span is near the line: six's 30 spans here were due 694 to 719 frames,
  0.885 to 0.917 of what clips keeping time show, and four's lowest was 0.98.
- **Phone clips keep time where they decode in hardware, and 4K falls behind in software.**
  Counted on 14 November 2026 with clips the bundled ffmpeg makes as the test runs,
  `tests/footage.ts`, never committed or downloaded. Each is a moving test card under fresh grain,
  so every frame costs bits, 22 seconds long, at about what a phone records. That is H.264 High at
  1080p30 and 17 Mbit/s, 1080p60 and 25, and 4K30 and 45; and HEVC at 1080p60 and 15, and 4K30
  and 30. Four played among twelve originals in the 1500 × 900 pane, as above. These were runs of
  three five-second spans after a warm-up, two runs on each machine. The headless Edge here
  decodes them in hardware, as `mediaCapabilities` reports; CI's runner has no GPU and decodes
  them in software.

  | Clip          | Owner's machine, dropped | Pace  | CI's runner, dropped          | Pace        |
  | ------------- | ------------------------ | ----- | ----------------------------- | ----------- |
  | H.264 1080p30 | 0 of 3617                | 1.000 | 0 of 3616                     | 1.000       |
  | H.264 1080p60 | 0 of 7214                | 1.000 | 68 of 7216, in 5 of 6 spans   | 1.000       |
  | H.264 4K30    | 0 of 3611                | 1.000 | 372 of 2798, in all 6 spans   | 0.736–0.803 |

  **HEVC is not counted**: the tests' Edge reports it unsupported on both machines, so its tests
  skip and say so. Whether the app's WebView2 plays it depends on the machine's HEVC decoder.

  **Probed once each past and below four.** Here, 1080p60 held six and eight. At twelve none
  dropped, but the pace was 0.750 in every span, three of the twelve standing still. 4K30 held
  six; eight dropped 144 of 1209 in its first span, at 0.901, then held. Twelve were never all
  drawn within the bench's minute. In hardware the edge is a decoder's limit, well past four. On
  CI, 4K30 held one, two, and three, which dropped 6 of 1363 in one span, all at 1.000. 1080p60
  held three with none dropped, and five dropped 330 of 4509 in every span while keeping time.
  These counts are why no one count fits both machines.
- **The test clip waits 37ms between frames, 74 after its first, in two timers.**
  `src/dev/media.test.ts` holds every gap to the 33.3ms a window at 30 a second takes, and 34ms
  left no room to. A recording keeps whole milliseconds and its stamps sit off the pushes, by up
  to 3ms in CI's runs and quiet ones here, so 34ms showed 33 and 32 with no timer at fault, a late
  timer only ever lengthening a gap. The first frame a page records came up to 6ms late. One timer
  past 36ms lands on Windows' 15.6ms tick on the owner's machine and paces at 47ms, so the steady
  wait is two; the first gap, which only lengthens, can spare it. The average cannot be the
  measure: `setTimeout(33)` averaged 33.7ms there and 34 on CI, above the window, with up to two
  gaps in five at 33 or less. So the test also holds the usual gap 3ms clear of the window, which
  fails every run at 34ms. The counts of 26 October used 34ms, those of 2 November 37ms.
- **No pace bounds the stamps under heavy load, so the test can still fail there.** With 16
  above-normal CPU hogs on 8 logical cores, 1 of 216 fresh pages failed the minimum: its gaps ran
  74, 48, 32, 38 with every pushed gap 37.7ms or more, one frame stamped about 6ms off its
  neighbours, which neither rounding nor the first frame explains. 34ms under that load would
  have failed 23 of 72, shortest 29, and 18 of its 28 short gaps were not the first. Under 8
  normal-priority hogs 96 of 96 passed, and idle 24 of 24. The same load also left one clip 22
  gaps against the test's floor of more than 20, its playback having skipped frames. The pace is
  not widened again for either. Forgiving a short gap that repays a long one would change what
  the test's title promises, so that stays the owner's call.
- **Videos loop from the start, muted**, each with its own mute; giving one the sound takes it
  from the one that had it, so one plays aloud at a time.
- **A file with no shape stands in at the floor**, landscape, its extension on the hatch as the
  lone pane shows it: a file of another kind, or a picture whose original fails with no
  thumbnail when the index lacks its shape. Refusing it at the drop would turn away a file the
  pane already shows alone; drawn, it counts, takes the arrows' focus and its ×, as any file does.
- **The set is one tab stop.** The arrows move in reading order, Enter shows one alone, and Tab
  reaches the focused file's ×. × takes a file out and does nothing to it, the focus passing to
  the next, or the one before; the last but one leaves the ordinary pane, its picture focused.
  **Escape shows the first alone only with the focus in the pane**, and only once a menu, a drag,
  full screen, the folded pane open over the grid and a checked set have each taken their own
  Escape, whichever order their listeners were added in, so after a drop Escape in the
  grid still clears the grid's set and leaves the pane alone.
- **A file deleted, moved to another folder or gone leaves the set**, and the rest stay; only when
  every file goes does the pane move on, as after deleting the one it shows. A set has no one file
  for the bar or a destination key to act on, so the bar goes and a key with nothing checked
  moves nothing, its Line saying to check the ones to move.

## A folder in the pane

**A folder can stand where a file stands**, drawn by Claude Design on Pane › folder and built on
26 October 2026. It is its own thing, not a second mode: the pane keeps its four parts, and only
what fills them changes, as a video fills them differently from a photograph. There is no switch
and no way in but Show in Pane; a click on any file leaves it.

- **Show in Pane heads every folder's and source's menu**, on its row, its favourite's row, the
  grid's ground and a search's folder card, as Full Screen heads a tile's, since both only look;
  the pane's own ⋯ leaves it out. An offline one keeps it, since the pane reads only the index. A sorting
  source's folder has none: its band has no rows to show. Shown again, the same folder stays.
- **The details are the band's rows**, one component in both places, behind the pane's own
  disclosure and its saved preference, so a change in one shows in the other at once.
- **The cover is the band's, at its own shape**, the original of the file that stands for it,
  with its pencil and Cover plate; `folder_detail` names that file. It does not zoom: it stands
  for the folder. An original the window cannot draw gives way to its thumbnail, and with neither
  its extension stands in, as for a file, so the pencil is always there to choose another.
- **The bar is the folder's menu laid out**, as a file's bar is its tile's: Open, the one worded
  button, never leaves and goes there, its row selected, the pane keeping the folder; Show in
  Explorer folds into the ⋯ when Open's whole name and two squares do not fit; the ⋯ holds every
  other row in the menu's order, read from navigation's menu each time it is drawn.
- **The strip runs through the folder's own files, none of them ringed**; a frame or the forward
  step shows that file, the folder becoming the place it was clicked in.
- **The pane follows the folder, not its path**, so a move or a rename inside the app keeps it.
  Deleted in the app, or its source removed, the pane shows nothing, as after deleting a file;
  "This Folder Has Gone" over its path is for a folder that went any other way.

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
  Sources and Remove Source, which touch only the index, never the drive;
  it and its folders keep Favourite, Assign
  Key… and Select Everything Inside, as their band keeps what the index holds, and lose every verb
  that needs the folder on disk.
- **Favourite is on a folder's and a source's menu**, reading Remove Favourite when on, from
  either of the place's rows. It changes nothing on disk, so it is not journalled and a source
  that is away keeps it.
- **Assign Key… sits under Favourite**, since both mark a place to come back to, and ends with
  the key the folder holds. It opens the ten keys against the row, each with the folder it is on,
  "Free" or "gone" in the quiet ink, the folder's own on the plate, then Remove Key. Picking a key
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
  mean something for a set: Favourite, Move to…, Copy, Copy as Path, Export…, and Delete with the
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
  while the clipboard holds files and Add Sorting Source… after it, and a search and the Trash open
  nothing. A sorting source's folder, on its ground and on its favourite row, has Paste alone, plus
  its favourite verb, as its band does. A tile keeps its own. What a verb there opens, the keys, the
  picker or the Sorting Box's pick, opens where the menu did; Export…'s sheet hangs under the
  place's header, and Rename opens the place's own row in the tree, the folders above it opening
  first. A click on the ground keeps the focus there for the menu key, and a grid with no tile is a
  tab stop of its own, so the keyboard reaches the menu too.
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
its place, as after any move (DECISIONS.md "The pane"), so sorting a place is a press per
picture. Files already in the folder are passed over without a word and only what moved is
counted; when nothing would move, the foot says "Already in Lisbon." in the refusal band. A free key is silent, like any key the app
does not use, but a key whose folder has gone did mean something, so its press says which key and
where the folder was. A key does nothing in a field, over a menu, a question or Settings, or in
the Trash, whose only way out is Restore. The top row and the number pad are the same keys.

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
The place sits dashed at the field's end, one click away, and one Tab once something is typed:
**an empty field passes Tab on**, so tabbing through the bar moves the focus and writes nothing,
and the offer shows its Tab key only while Tab would take it. Taken, a folder writes
`path:`, the Sorting Box `is:sorting` and the Trash `is:trashed`, a chip like any other, so the
same text still means the same thing wherever it runs and Search Everywhere is only that term
removed. Tab takes the offer only with no row of the list plated; with one, it picks the row. **Typing moves
nothing; Enter runs the query**, because a grid that reflows under every letter is a grid nobody
can look at. A query that does not read runs nothing: the field names the character and the
results stay as they were. **Escape takes back one thing at a time**: the list, then what did not
read, then what was typed, which leaves the field holding the query the grid shows, or nothing in
a place, and gives the focus back to wherever it was before the field took it.

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

**A search describes all its folders at once.** Each folder's path, counts, cover and what it
matched come from one statement per kind for the whole result, and every list of ids is bound as
one JSON array read through `json_each`, never one `?` per id, since SQLite refuses more than
32,766 `?`s in one statement.

**Results come trashed first, then in the order chosen for searches**, as "Sorting a place"
says. A trashed file is found only when the query names the Trash; the drawing's Trash
scope writes `is:trashed`, so the two meet only when someone types both.

## Undo

**Every change the app makes on disk is journalled and can be undone, across a restart**, ported
from ggallery on 23 September 2026. It came before any verb that changes the disk, so none of
them ever existed without a way back. On screen since 24 September 2026, as Artboards › Undo draws
it. Two acts delete for good, and both ask first: Empty Trash…, and Delete on a drive with no bin
(DECISIONS.md "The Trash is the Recycle Bin").

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

- **What an undo took back can be redone, until the next act.** Ctrl+Y and Ctrl+Shift+Z, and
  Redo on the line after an undo, carry it out again, as Explorer and Lightroom do: the owner asked
  for it after the interface audit (#246). The rows an undo took back stay in the journal, marked
  undone, rather than going, so whatever forgets or drops a file from the journal reaches them
  too and a redo answers per file as an undo does: what cannot go again stays in the banner with
  Retry, saying why. Each undo marks its rows one higher than the last, so redo walks back
  through the undos the last first, and each row redone is journalled again as the newest, so
  Ctrl+Z takes it back once more. A new act drops the redo as it writes its first row, since what
  it would put back no longer follows from what is there; so does a file deleted for good, by
  Empty Trash… or on a drive with no bin, and a restore of the index. A tags screen act does not
  wait for the disk, so a redo checks each row is still undone before carrying it out, and stops
  at the first that is not: what it carried out is journalled, and nothing after the new act is. **A redo never deletes for
  good:** a file whose drive has lost its bin since stays, as an undo's does, and nothing that
  cannot be undone is ever offered as a redo, since it was never journalled. A folder an undo
  took away keeps its title for the redo, made again under a new id; a tags screen act is carried
  out again by the words its line names, since its undo can give terms back under other ids.
- **The disk changes first, then the index and the journal together.** A disk that refuses leaves
  nothing claiming it succeeded, and a transaction that fails puts the disk back.
- **One act, one batch, one undo.** A batch comes back newest row first. Each row leaves the
  batch as it comes back and what failed stays, so trying again takes back only what stayed.
- **An undo never destroys.** A folder the app made is taken back only while it is still empty,
  on disk as well as in the index: files the index has not read yet would go with it otherwise.
- **A folder that will not go is tried again for a quarter of a second.** Some programs put a
  file of their own beside one just written as it moves away and take it back a millisecond or
  two later: on the owner's machine, `A.JPG.tmp` beside `a.jpg`. An undo straight after a copy
  moves exactly such files out, and the folder they leave would otherwise stay, said to hold
  something it no longer does. Only the removal is tried again, which the disk refuses while
  anything is in the directory, so a file that stays still keeps its folder. A folder deleted
  and the originals a move between drives leaves behind go the same way, through
  `fs::take_away`; a delete also looks again, for as long, while it finds a file it does not
  show, and names the file that kept the folder when one stays. A directory around one where
  something stayed cannot empty, so it is tried once and not waited on.
- **One change to the disk at a time.** A walk that read a directory while a verb renamed it would
  find the old name gone and retire everything under it. So the walk takes a turn per source and
  a verb waits for the turn, which bounds the wait by one source's walk, never the whole pass.
- **The journal is found by what it is about, never read whole** (#220). Each row's files and
  folders are kept in `journal_subject` beside it, indexed, so letting go of a file emptied from
  the bin reads the few rows about it, not every row's JSON: emptying 10,000 files against a
  journal of 200,000 rows was 10,000 scans of all of it inside the disk's turn. Triggers add a
  row's subjects as it is written and take them as it goes, so no path that writes or drops a row
  can leave them behind. An update has no trigger: rewriting every subject of thousands of tag rows
  to take one file out of each cost more than the rest of letting go together, so the one rewrite
  that takes files out of rows deletes just their subjects. The look and Empty Trash… read each
  folder's directory and each bin's volume once, not per file, and Empty Trash… lets go of what it
  deleted 200 files to a transaction, under the turn of the last of them. The bounds, each
  with its timing test against a journal of 200,000 rows: 10,000 files let go of the journal at
  once well inside a second; a look in the bin that finds 10,000 emptied inside five seconds;
  Empty Trash… of 10,000 inside ten, one turn of the disk per file as it always was.
- **A move between drives is a copy, checked, and only then the original's removal.** ggallery
  renamed, which cannot cross from one drive to another. A copy cut short is removed and the
  original stays whole; an original that will not go once its copy is whole is left for the next
  walk, so the index follows the copy and no file loses its identity. Both removals take only
  what the copy read and wrote, each directory only once empty: a file someone put in either
  meanwhile stays.
- **A move of files between drives is a job**, as a copy in is, since a card's worth of files
  copied inside the command held the window and every other verb with no progress and no Cancel.
  The command decides by the drive or share each path names: files moving on one drive are
  renamed at once, as before, and a selection with any file going to another drive goes on the
  queue whole, one batch and one undo. A drive mounted in a folder is judged the drive around it,
  so its move copies inside the command as it always did. The move has a line at the foot as a
  copy has, "Moving to Lisbon…", whose dismiss is Cancel Move, and ends with the Line and Undo for
  what went and the banner for what stayed.
  - **Files go one to a turn**, each moved whole or left where it was, so Cancel finishes the file
    in hand and starts no other, and a walk or another verb waits for one file, never the
    selection. A folder the move is going into that goes meanwhile stops it, and the foot says
    why. A move on one drive, inside the command, keeps one turn for the whole selection, as it
    always did: it is quick, and a walk between its files would read it half done.
  - **A folder still moves inside the command**, between drives too, in one turn for its whole
    tree, each copy flushed before any original goes. On the queue, a folder whose originals were
    still being taken away when the app closed came back as two folders, or as a hidden one the
    index lost when the resumed move could not run: its drive away, the move cancelled or held
    by a restore, the folder renamed first. A folder moved between drives is rarer than a card's
    files, and the window waiting for it costs less than either.
  - **Copies arrive under a hidden part name and are named only once whole**, as a paste's do:
    `.Lisbon.filmstrip-part` beside the place, copied, checked and flushed, then renamed onto
    the name, refused if anything took it meanwhile. The app's closing stops the file in hand,
    `CopyFileExW` cancelled from its progress routine, rather than waiting out a film the
    shutdown's grace cannot cover; that file's part is taken away, so nothing is ever left at the
    real name half written for the resumed move to be refused by. A folder's copy inside the
    command arrives the same way, its whole tree under one part. A part a crash left is cleared
    before the move goes on, or as the move waiting after it is cancelled: what the copy would
    have written there, and only that, read from the part itself and never through a link in it,
    so nothing outside the part can go.
  - **A move the app's closing stops goes on at the next launch** under the same batch, passing
    over what already went. Until it ends its batch is no act: Ctrl+Z passes over it and its Undo
    is refused, as a copy's is ("Bringing files in"). Restoring the index cancels it first, as
    it does a copy.
- **Each copy is flushed to its drive before any original goes.** `CopyFileW` returns once
  Windows holds the bytes, not once the drive does, so a USB drive pulled or power lost seconds
  after a move would otherwise leave copies short or empty and the originals gone. So each file is
  written through with `fs::flush`, `sync_all`, as it is checked, and the removals start only once
  every copy is. A read-only copy cannot be opened to flush, so it gives up the attribute for the
  flush and takes it back after: a crash between the two costs the attribute, never the bytes.
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
  trashed one waits in the Recycle Bin, untouched, until it is taken back.
- **The Trash is the Windows Recycle Bin**, on each file's own drive, as PRODUCT.md "Trash" has
  it and DECISIONS.md "The Trash is the Recycle Bin" says why. A file already gone from where the
  index has it is refused rather than trashed; the next walk retires it.
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
- **A file emptied from the Recycle Bin outside the app ends its way back.** A Ctrl+Z or Restore
  that reaches it lists it under Gone from the Recycle Bin, retires its row and drops the journal
  row that sent it there, so no later undo acts on it. DECISIONS.md "The Trash is the Recycle Bin".

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
  else has taken, and it clears every hidden part left in the folders it went into. The part is
  flushed to its drive with `fs::flush` before it takes its name, so the index never trusts a file
  a drive pulled or a power cut left holding zeros ("Undo").
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
  failing on it would hold the copy's Undo, and every Undo before it, for good. One on a drive
  with no Recycle Bin stays where it is and lets the act go ("A drive with no Recycle Bin").
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
  the restore waits for every job in flight. Then the index as it is is backed up, "before
  restore"; then the chosen one is copied aside, brought to this build's schema, settled, and
  copied over the live index by the backup API in one write, so one that fails part way leaves the
  index as it was. Only once that has
  succeeded do the oldest go, and never the one restored: had it been the
  oldest, it stays past the number until the next backup. Rotating, queueing the walk and letting
  the window load from every source the restored index has follow it, and none of them can fail a
  restore that has swapped.
- **What a restore leaves as it is now.** The index goes back; the disk does not. The Trash is kept
  as it is now: a file in it since the backup is in it again from the folder it left, found by its
  source's root and the titles below it, with the folders on the way made retired where the backup
  has none, with where the Recycle Bin keeps its file. One from a source added since, or from a
  place the backup cannot find, is forgotten as that source's other rows are, and its file stays in
  the Recycle Bin, as a removed source's do; the question names the sources and counts the files
  beforehand. Nothing is sent, so nothing can be refused. A row the backup has in the Trash whose
  file is no longer where the bin kept it is retired where it was, keeping its tags and uuid for
  the walk to find again, or dropped where a file there now has its name. The job queue starts
  empty but for the walk, which runs at once, so a copy or an export waiting in the backup never
  runs again and files moved or added since are found where they are. A source added since is
  forgotten, and its files on disk are left as they are.
- **Undo goes no further back than a restore.** The journal comes back as it was then, so restoring
  the "before restore" backup puts the index back whole, but what it holds describes a disk the
  walk has read again since. A restore records the newest journal row it kept in `setting`, and
  Ctrl+Z and Undo stop there.

## The Trash is the Recycle Bin

**Delete sends a file to the Windows Recycle Bin on its own drive, and the Trash lists what the
library sent there**, as the owner decided on 15 November 2026 and built for #192 from Artboards ›
The Trash in the Recycle Bin. It replaced `data\trash`, a folder of the app's own beside the
executable, with the three limits it kept and the hourly run that expired files from it to the
Recycle Bin (#184), and Delete's refusal of a file too large for it (#186). That folder copied a
file across drives to keep it, and kept limits beside the ones Windows already keeps for each
drive's bin; and expiry still ended in the Recycle Bin. Now there is one place a deleted file
waits, where Explorer can see it too.

- **Each trashed row records where the bin keeps its file.** The send already reads the file's
  names before and after the shell takes it (DECISIONS.md "Sending to the Recycle Bin"), and the
  name it gained under `$Recycle.Bin` is the shell's own name for it there, `$R…`. That name goes
  in `item.bin_path`, and the file's identity, its volume's serial and its index on it, in
  `item.bin_file`, so a file is known by what it is rather than by a name another file could
  take. No crate reads the bin: listing it through the shell's namespace means COM and every file
  in every drive's bin, where the send has already seen the one name it needs.
- **Restore, Restore to… and Ctrl+Z move the file back out**, from its name in the bin to its
  folder or the one picked, by the same no-clobber move the app's other moves use, under its own
  name; a taken name or a gone folder keeps it in the Trash as before. Once the file is out, the
  shell's record of it, `$I…` beside it, is removed too, so Explorer's bin stops listing a file it
  no longer holds, as the shell's own restore does. Only a record inside the bin whose file has
  gone is ever removed.
- **The Trash looks in the bin at launch and whenever it opens.** At launch the window asks once
  it has opened, never before it is built, since a look reads every trashed file on disk and a
  Trash of thousands kept the window from appearing for seconds (#220). The look reads without the
  disk's turn, and takes it only once it found something to change, looking at each of those
  files again under it before writing, so a Trash whose files are all still in the bin never holds
  up a verb. Each trashed file is looked for
  by its identity, at its name in the bin and then at its own path. Still in the bin, it stays.
  Back at its path, put back from Explorer, it is restored in the index, tags and all, as if
  Restore had done it; a row a walk made for it meanwhile, under the name it took back, is
  forgotten. In neither, it was emptied outside the app: its row retires where it was, keeping its
  name and tags, as a walk retires a file it finds gone, and the journal lets it go in the same
  transaction, as it lets go of a file Empty Trash… deleted (DECISIONS.md "Emptying the Trash").
  The look has already said the file left the Trash, so Ctrl+Z passes over it to the act before;
  a folder deleted with its files goes from the journal with the last of them, and is never made
  again empty. A look that changed anything, either way, can take a whole act from the journal: a
  forgotten row leaves every tagging it was the last file of. So an act's line still at the foot
  then asks `can_undo` of its batch, and one the journal no longer holds loses its Undo, its
  sentence kept, since an Undo there could only say "Nothing to undo."; removing a source asks
  the same, and Empty Trash… already puts its own line in its place. A drive that is away is
  left until it is back, and so is one where another volume answers at its letter or folder,
  since its serial is not the one `bin_file` names: that volume's bin is not where the file went.
  A row with no record of where the bin keeps it is retired too: only a build before this one
  made such rows, and no library predates it.
- **A Restore or Ctrl+Z that reaches a file emptied from the bin says so**, before any look has
  found it: listed under Gone from the Recycle Bin, with no row button, its row retired. Retry
  stays only while a row still in the Trash could succeed.
- **A row forgotten rather than retired leaves the journal with it.** Retiring keeps a name
  another file holds by then, so that row is forgotten instead, and the journal forgets it in the
  same transaction (SCHEMA.md "The undo journal"): an undo of the act that sent it reports it by
  the name and folder kept on its rows, and never stops on it or reaches a file given its id
  since. The look in the bin lets go of its file's journal rows before forgetting it, so it leaves
  no mark. The mark keeps why the row went, since that is what the undo says: a file a Restore or
  Ctrl+Z found emptied from the bin is listed under Gone from the Recycle Bin; one whose name a
  file the app put there, or one put back from the bin in Explorer, took is No longer on disk, under Gone from its folder; a
  removed source's is "Phone was removed", under Gone from that source. A removed source's
  folder is reported the same way, and a file or folder still in the library whose row names a
  folder of the removed source says "Phone was removed" under Still in where it is now. None of
  them is tried again; only that last kind has a way to look, being still there.
- **Any folder a row names ties it to that folder's source.** A row naming a removed source's
  folder is let go even when the undo would not go through that folder, as a move whose origin
  was in it: only a marked row keeps the removed folder's title for its line, since the id may
  name another folder by then, and the file stays where the later act put it.
- **The bin refusing a file leaves it where it was.** The send never deletes outright, so a file
  too large for the bin, or on a drive whose bin is off, stays in its folder and the foot says so;
  the rest of a set are one batch with Undo. A drive with no Recycle Bin at all, which Windows
  would delete from outright, asks first (DECISIONS.md "A drive with no Recycle Bin").
- **A removed source's trashed files stay in the bin**, and so do those a restore of the index
  forgets. Their rows are forgotten; their files are already in the Recycle Bin, on the drive each
  came from, for Explorer to put back or empty. Nothing is sent, so nothing can be refused, and
  removing a source is the index forgetting rows again. Artboards › Sources, "What removing does
  with its trashed files".
- **A drive's own Recycle Bin is never walked.** A source at a drive's root holds `$Recycle.Bin`,
  where Delete now sends the library's files; walked, they would come back in as new files in a
  folder of that name.
- **`data\trash` is never touched.** A folder of that name from an earlier build is neither read,
  emptied nor deleted; the app no longer makes one.
- **Two acts cannot be undone, and both ask first**, as PRD.md "What must always hold" has it.
  Empty Trash… deletes for good only what the library sent to the bin
  (DECISIONS.md "Emptying the Trash"), and Delete on a drive with no bin only the files it asked
  about (DECISIONS.md "A drive with no Recycle Bin").
- **Tests never reach the real bin.** Every send goes through `fs::recycle::Shell`, which in a
  test build hands the file to a stand-in of the test's own thread, recycling into a folder under
  `target`; the real `RecycleBin` refuses to run in one.

## Emptying the Trash

**Empty Trash… deletes for good the files the library sent to the Recycle Bin, and nothing else
in it**, as the owner decided on 15 November 2026 and built for #194 from Artboards › The Trash in
the Recycle Bin. It lives in Settings › Trash, one question away, since the Trash place keeps only
the way back; a single file is never purged from the app, as Explorer's bin can do that.

- **Only what the question counted.** Asking reads each trashed row and the name the bin keeps its
  file under, `bin_path`; the answer hands those pairs back. A row taken out of the Trash since, or
  sent there again under a new name, is passed over, so a file deleted while the question waits
  joins the Trash after it and stays.
- **Each file found again, by what it is.** Under the disk's turn, one file at a time, the row is
  looked for as the Trash looks (DECISIONS.md "The Trash is the Recycle Bin"): at `bin_path` with
  the identity `bin_file` names, then at its own path. A restore or an undo between two files takes
  its file out of reach.
- **Deleted through the handle that read it.** `fs::recycle::purge` refuses a name the bin does not
  hold, opens the `$R…` name without following a link and never a directory, reads the file's
  volume and index from that handle, and only while they are `bin_file`'s marks that same handle
  for deletion, read-only or not. Nothing can take the name between the reading and the deleting.
  Only that one name goes: a file with other names outside the bin, from a dedup tool or a
  link-based backup, keeps them. The `$I…` record beside it is then removed as a restore removes
  it, only inside the bin and only once `$R…` is gone.
- **One no longer there, or that would not go, is skipped and said.** Emptied outside the app, its
  row retires; put back from Explorer, it is restored in the index; either way it was no longer in
  the Recycle Bin. One open in another app, on a drive that is away, or whose name in the bin is
  no longer its own stays in the Trash under its row, whole, and Empty Trash… asks again for it.
- **One file that cannot be finished never stops the rest** (#219). Anything that fails for one
  file, the disk or the index, keeps that file in the Trash with why, and the empty goes on to the
  next, so a failure at file 3,000 of 10,000 still empties the other 9,999 and counts them. The
  foot counts what went and what stayed, and the banner over the grid lists each that stayed,
  under Still in the Trash, with its reason and Show in Trash; there is no Retry, since Empty
  Trash… asks again for what is left.
- **The row retires and the journal lets it go.** A deleted file's row retires where it was, as
  the Trash retires one emptied outside the app, and every journal row about it alone goes in the
  same transaction, its id leaving every row about several (SCHEMA.md "The undo journal"). The
  rows of up to 200 deleted files go in one transaction, under the disk's turn, once the last of
  them is deleted, each only while it is still in the Trash under the name it was deleted from. Nothing
  of the act is journalled, so Ctrl+Z skips the emptied files and undoes the act before them; an
  earlier move or rename of a file now gone never sticks an undo. A folder deleted with its files
  goes from the journal with the last of them, so Ctrl+Z never makes it again empty; one deleted
  with no file in it keeps its undo. A row that fails to retire after its file went is retired by
  the next look in the bin, which lets its journal go the same way.
- **Nothing to cancel.** What has gone has gone, so the head counts as it goes with the walk's bar
  where the button was, and the foot says when it is done; leaving Settings loses nothing.
- **Tests never reach the real bin.** In a test build `Shell::holds` is the stand-in's, so only a
  folder of the test's own can be emptied, and each test writes the files it deletes.

## Sending to the Recycle Bin

**`fs::recycle::send` hands a file to the shell's Recycle Bin and never lets it be destroyed**,
built on 20 October 2026 for #110, and since #192 the way every Delete goes. The Recycle Bin cannot
take every file: a drive with none, such as a removable one or a network share, the bin turned off,
or a file over its quota. There the shell deletes it outright, and asking it not to means a dialog,
which the app never shows on its behalf.

- **A second name first, then its names, then the shell, then its names again.** Before the
  shell is asked, the file is given a second name beside it by a hard link, and that file's names
  are read through `FindFirstFileNameW`. The bin moves a file within its own volume, so a file it
  took gains a name under that volume's `$Recycle.Bin`. Only with a name there that was not there
  before is the file counted as sent; its second name goes once the Trash has recorded it, so a
  stop between the two still finds it. Otherwise, and when its names cannot be read afterwards,
  the second name is given the file's own name back and the file is refused. Whatever the shell
  answers, the disk says which happened, so a refusal is never mistaken for a send. The count of
  names, compared before and after, is not enough: something on the disk giving the file a name
  elsewhere while the shell deletes it outright leaves the count unchanged, with the file in
  neither the Trash nor the bin. A user's file can already have other names, from a dedup tool or
  a link-based backup, and keeps them into the Trash, since trashing within a volume is a rename;
  one can even be in the bin already, when the user recycled another of its names. Those never
  count as the send, being there before it.
- **A file whose names cannot be read is never sent.** A drive or filter that cannot list a
  file's names, or one without hard links, would leave the app unable to tell a send from a
  delete; read only after the shell, it turned a file the bin took into a refusal, and every retry
  left one more copy in the bin. So the names are read before the shell is asked, and where they
  cannot be, the second name is removed and the file refused without asking. Names are read in
  verbatim form, as `std::fs` and `noclobber` pass theirs, since the second name is longer than
  the file's and can pass MAX_PATH where the file does not.
- **What a cut-short send left is settled at the next.** A crash between the steps leaves the
  second name. Beside the file it is removed. Alone, it is the file again, put back and sent once
  more, unless the launch finds the bin took it, as the next bullet says; at worst the bin then
  holds the same file twice. A second name that is not the same file is never removed.
- **A send the bin took before the app stopped is in the Trash at the next launch**, built for
  #215. Before the shell is asked, the send's mark keeps the item, its act, the file's identity
  and every name it has; the second name stays until the row is recorded. At launch a mark whose
  row already names that file in the bin only lets the second name go. Otherwise a name the second
  name gained in the bin since is where the bin put it, and the row is recorded as the send would
  have: in the Trash with its tags, under its act, so one undo still brings it back. The look in
  the bin that follows finds it there, or retires it if the bin was emptied while the app was
  closed. The row must still be the file the mark names, live at that path: a source removed
  while its drive was away can free its items' ids for another source's files, and such a mark
  only settles the second name as above, as does one with no such name in the bin. A name the
  file had in the bin before is never taken for the send's, and another file that took the
  file's name meanwhile does not stop it being recorded. Removing a source leaves its marks, since
  each still has a second name beside its file to settle once that folder is reached.
- **The send says where the bin put it**: the name the file gained under `$Recycle.Bin`, and its
  identity, read from the second name before the shell is asked, since the file keeps it in the
  bin. DECISIONS.md "The Trash is the Recycle Bin".
- **`SHFileOperationW`, not `IFileOperation`.** The newer interface can refuse an outright delete
  before it happens, but only through a COM sink the app would have to implement; the second name
  gets the same promise from one flat call. Why the bin refused a file is not told apart: too
  large, the bin off, or a delete outright are all the Recycle Bin refusing, and a send that fails
  on the disk is said in the log.
- **What the shell is never asked is refused with its own reason** (#219). `SHFileOperationW`
  takes no path of MAX_PATH or longer, so such a file is refused before its second name is made,
  as a path too long for the Recycle Bin, rather than handed over to fail as the bin's refusal.
  A file that cannot be given its second name, or whose names cannot be read, is refused naming
  its drive, as Explorer names it, since the drive is what lacks hard links: a fixed exFAT or FAT
  drive has a bin, but no way for the send to tell a recycle from a delete. When the disk says the
  file itself is the cause, another app holding it or access denied, that reason is given instead.
  Whether such a drive should send another way is left open; the reason says which it was.
- **The second name is made in the file's own folder.** Delete hands `send` a file where it is,
  so its second name is made there, hidden by its dot from the walk, and nothing else would ever
  find it. Its mark joins the list in `setting.recycling` before the send and leaves only once
  the send has been recorded and its second name let go. A send that fails partway keeps it; a
  later send of the same file settles what that one left before marking its own. At launch each
  one whose folder can be reached is settled as the cut-short bullets above say. One on a drive
  that is away waits for a launch that finds it. The rest of the library is never swept for
  second names.
- **Tests never reach the real bin.** The shell is behind the `Bin` trait, which also says
  whether a name is inside it and lets go of the record it keeps; the tests' stand-in recycles
  into a folder of its own, deletes outright or refuses, while the second name and the file's
  names are real. Its files start with
  one name and with several, one of them already in the bin, and gain one from outside while the
  shell acts. Names that cannot be read are made so by a switch only tests have.

## A drive with no Recycle Bin

**Delete asks before it deletes outright a file on a drive with no Recycle Bin**, a USB stick, an
SD card or a network share, as the owner decided on 15 November 2026 and built for #193 from
Artboards › The Trash in the Recycle Bin. Windows deletes outright whatever is sent from such a
drive, so the send could only ever refuse it; asking is the one way such a file can go.

- **Told apart before anything is sent, by the drive's kind.** Windows keeps a Recycle Bin on a
  fixed drive only, so `fs::recycle::Bin::binless` reads the kind of the volume a file is on
  (`GetDriveTypeW` on the root `GetVolumePathNameW` gives): removable, remote, a disc or a RAM
  disk has no bin. A file the bin merely refuses, too large for it or with the bin turned off, is
  on a fixed drive and keeps the send's own refusal. A kind that cannot be read counts as a bin,
  where the send still never deletes outright; an external disk Windows reports as fixed has a
  bin of its own.
- **The drive is named as Explorer names it**: its label and letter, `USB Drive (E:)` when it has
  no label, and a share as `Photos (\\nas)`. The shell's own display name needs COM on the thread,
  which the app's blocking threads do not set up.
- **The send refuses such a file without asking the shell**, with a reason of its own, so nothing
  that reaches `trash_items` without the question, an undo of a restore onto such a drive among
  them, is ever deleted outright.
- **One question for the whole selection.** `binless_items` names the files on such drives under
  each drive, with their sizes; the rest go to the Recycle Bin at once as one batch with Undo,
  and only the others are asked about. Cancel has the focus, so Enter and Escape both keep them.
- **Asking leaves full screen.** The question is drawn above the grid, which full screen hides
  and makes inert, and Delete is reachable there from the pane's bar and the file's menu; the
  sheet draws no question over the pane, so the pane docks again to ask.
- **Delete Permanently removes each file and retires its row**, as a walk retires a file it finds
  gone, keeping its name and tags. Nothing is journalled: there is nothing to bring back, so the
  foot has no Undo and Ctrl+Z reaches the act before it. `delete_for_good` checks each file again
  and never deletes outright one whose drive has a bin. A read-only file is refused before it is
  touched, and one open in another app is refused by the disk, so a file that would not go is
  whole where it was, and the foot names it.
- **A folder's delete asks the same in its own question**: Delete Files Too becomes Delete Files
  Permanently, `Contents::Permanently`, whose files on such a drive go outright and any others to
  the bin, and the folder goes once they have. The folder's delete is journalled unless files
  went for good and none to the bin, since then nothing would come back with it; one emptied
  while the question waited goes with Undo, as any empty folder does. The foot counts the two
  apart, and is left as it was when no file went: the banner over the grid says it all, and
  Ctrl+Z still reaches the act before.
- **An undo that would send a file to such a drive's bin lets the act go**, as one that finds a
  file emptied from the bin does. Undoing a copy onto the drive, or a Restore to… into it, sends
  the file to the Recycle Bin, which the drive has not got, so the row would fail every time and
  hold every Ctrl+Z on it, and every act before it, for good. Its row leaves the journal and the
  banner names it, still where it is, under the drive's reason, with no Retry; a folder the copy
  made that still holds anything goes the same way. The copy is journalled all the same, rather
  than left out with no Undo: its rows are what a copy the app's closing stops goes on from, and
  are how it tidies a crash ("Bringing files in"), and a journal written before this keeps such
  rows. Nothing is ever deleted outright to undo a copy; Delete asks for that, as above.
- **Tests never delete outside their own folder.** The stand-in for the shell names folders of
  the test's own as drives with no bin, so what is deleted outright is a file the test wrote.

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

**Trash sits in the Library group, after Backups**: how many files the library has in the Recycle
Bin and their size in the section's head, with Empty Trash… at its end, and two lines under it on
where a deleted file goes. It keeps no limits, since the Recycle Bin keeps Windows' own for each
drive. DECISIONS.md "The Trash is the Recycle Bin" and "Emptying the Trash".

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

## Testing main on a schedule

A commit the Dependabot workflow's auto-merge lands has no push run, because the workflow's own
token made the push. Starting one from that workflow does not work: it ends as soon as it arms
the merge, long before GitHub makes it, so a `workflow_run` on it or a dispatch from it would
run before the merge lands, and the merge itself, made with the same token, starts no workflow.
A run dispatched with that token would also belong to the bot, and nobody would be mailed when
it failed. A personal access token would fix both, but no long-lived secret is kept on GitHub. A
daily scheduled run has none of these problems: it covers a merge made any way, its failure
mails the owner, and run two hours before the Nightly it settles whether that commit is fit to
build. The cost is up to a day between a merge and its test, which Dependabot's weekly updates
can bear.

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
