# Features

Everything ggallery's backend can do, and where Filmstrip stands against it. Filmstrip is that
backend again, more cleanly and with the behaviour Filmstrip chose instead: folders are read
where they stand rather than moved, and files keep their own names. Once this list is all
**built**, ggallery is finished with and new features start here.

The source for the ggallery column is its own `docs/FEATURES.md`, which lists its 64 commands,
and the tables in `docs/SCHEMA.md`. Its interface is not read.

**The four states.** **Built** — it works in the app. **Drawn** — Claude Design has drawn it and
it is waiting to be built. **Backlogged** — an entry in `docs/design/BACKLOG.md` waiting to be
drawn. **Not started** — neither.

## The library

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Register a folder as a source | Built | `add_source`, and both doorways |
| Several sources at once, library and sorting | Built | `list_sources`, `set_source_kind` |
| Rename a source | Built in Settings | `rename_source`; a tree row's rename is a DEFECT in the backlog |
| Remove a source, leaving the folder alone | Built | `remove_source` |
| Reveal a source in Explorer | Built | `reveal_source` |
| Remember the interface's own state | Built | `ui_preferences` |
| First-import review, then a move | **Dropped on purpose.** A folder is read where it stands, so there is nothing to review and nothing to move. |

## Reading what is there

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Walk every source in the background | Built | `start_index`, the job queue |
| Report progress | Built | the foot's indexing line |
| Report per-file failures, and retry them | Built | the notices above the grid |
| Thumbnails for pictures | Built | `thumb` jobs |
| Thumbnails for video, through ffmpeg | Built where ffmpeg is at hand | ffmpeg is not bundled yet |
| Read a file's shape, dates and length | Built | `probed_at`, `captured_at` |
| Scrub frames for a video's tile | Backlogged | "Scrubbing a video's tile" |

## Folders

| Capability | Filmstrip | Where |
| --- | --- | --- |
| The tree, and a folder's children | Built | `folder_children` |
| A folder's own details | Backlogged, and not in Rust | "A folder's details" |
| Create a folder | Not started | |
| Move a folder | Not started | |
| Delete a folder, choosing what happens to what is inside | Not started | |
| Rename a folder, on disk | Not started | |
| A folder's cover | Not started | `folder.cover_item_id` exists |
| A folder's status, notes, favourite | Not started | |
| A folder's labels and tags, inherited by everything under it | Not started | items inherit labels, and never own one |
| Every item id under a folder | Not started | |

## Items

| Capability | Filmstrip | Where |
| --- | --- | --- |
| List a folder's items | Built | `folder_items` |
| An item in full | Built | `item_detail`, the pane |
| The Sorting Box's items | Built | `sorting_items` |
| Favourite an item | Built | `set_item_favorite` |
| Reveal, open, copy the file | Built | the pane's bar |
| Sort by key and direction, random order held steady | Not started | |
| Move items between folders | Not started | |
| Delete items to the trash | Not started | |
| Paste files in, and take an OS drop | Not started | |
| Copy an item's path | Not started | |
| Counts: unsorted, trashed, totals, arrival duplicates | Partly | the foot counts items and sources |

## The pane

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Show the item that was clicked, and keep it | Built | |
| Details, and the tags on an item | Built | |
| A filmstrip of the place it came from | Built | |
| Full screen | Built | |
| **Zoom and pan a picture** | Backlogged | "Zoom in the pane" — the one thing missed rather than deferred |
| Video playback | Built, on the browser's own controls | a plate of its own is drawn, and volume is not yet kept between items |
| Frame steps and a named speed set | Backlogged | "The video plate…" |
| Several items at once, scaled to fit together | Not started | dragging items onto the pane, PRODUCT.md "The three panels" |
| A folder shown in the pane rather than an item | Not started | its own thing, not a second mode |
| Tiled compare and multi-view panes | **Dropped on purpose.** The pane has one mode. |

## Tags and labels

| Capability | Filmstrip | Where |
| --- | --- | --- |
| An item's effective tags, inherited live | Built | `item_tags` |
| Add or remove a tag on an item | Not started | an item owns tags only, never a label |
| A folder's inherited tags | Not started | |
| What a selection's tags cover | Not started | |
| The vocabulary, with counts; rename and delete a tag | Not started | |

## Search

| Capability | Filmstrip | Where |
| --- | --- | --- |
| A query language, compiled to SQL over an FTS index | Not started | the bar holds a dev stand-in |
| A page of results | Not started | |
| Folders and tags offered as controls that write the query | Not started | Filmstrip's own change: the syntax is the fallback |

## Selecting, triage and the trash

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Select in a grid, and act on the selection | Not started | |
| Move a selection somewhere | Not started | |
| Destination hotkeys | Not started | no migration yet |
| The trash as a place, with its own limits | Partly | the row and its empty state are built; nothing can be trashed yet |
| Purge the trash, the one irreversible act | Not started | |

## Export and undo

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Export a folder's subtree or a selection as a zip, as a job | Not started | Filmstrip's own change: renaming the files or keeping their own names is chosen at export |
| An undo journal that survives a restart | Not started | no migration yet |
| Undo the last batch, or a named one | Not started | |

## The interface

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Three panels, splitters, folding, the rail | Built | |
| The app's own window chrome | Built | |
| Settings | Built, with Sources in it | |
| The app's own right-click menus | Drawn, with three defects | the backlog |
| A scrubber for very large folders | Backlogged | |
| Compression review, duplicate detection, a storage screen, a tags screen | Not started | PRODUCT.md "Later" |
