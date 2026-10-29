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
| Rename a source | Built | `rename_source`, in Settings and on its tree row |
| Remove a source, leaving the folder alone | Built | `remove_source`; its files in the Trash go to the Recycle Bin first, through `fs::recycle`, and one the bin cannot take keeps the source |
| Reveal a source in Explorer | Built | `reveal_source` |
| Remember the interface's own state | Built | `ui_preferences` |
| Back up the index beside it, at launch once a day and by hand, the newest kept | Built | `list_backups`, `back_up_now`, `set_backups_kept`, `launch_backup_refusal`; DECISIONS.md "Backing up the index". Filmstrip's own change: SQLite's online backup while the app runs, not a file copy as it closes, and the number kept is a setting |
| Restore the index from a backup | Built | `restore_backup`, on the backup's row in Settings › Backups; the Trash stays as it is now, and undo stops at the restore. A trashed file the restore forgets, from a source added since, goes to the Recycle Bin first, as a removed source's do |
| First-import review, then a move | **Dropped on purpose.** A folder is read where it stands, so there is nothing to review and nothing to move. |

## Reading what is there

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Walk every source in the background | Built | `start_index`, the job queue |
| Report progress | Built | the foot's indexing line |
| Report per-file failures, and retry them | Built | the notices above the grid |
| Thumbnails for pictures | Built | `thumb` jobs |
| Thumbnails for video, through ffmpeg | Built | the ffmpeg in `tools\` beside the app, else one on PATH |
| Read a file's shape, dates and length | Built | `probed_at`, `captured_at` |
| Scrub frames for a video's tile | Built | `scrub` jobs, the grid's video tiles |

## Folders

| Capability | Filmstrip | Where |
| --- | --- | --- |
| The tree, and a folder's children | Built | `folder_children` |
| Reveal a folder in Explorer | Built | `reveal_folder`, its row's menu |
| Read one folder again | Built | `read_folder_again`, its row's menu; ggallery walked only whole sources |
| A folder's own details | Built | `folder_detail`, the band under a folder's header |
| Create a folder | Built | `create_folder`, New Folder on a folder's and a source's menu, a row already in its name field |
| Move a folder | Built | `move_folder`, across drives too; Move to… on its menu, its own branch not a choice |
| Delete a folder, choosing what happens to what is inside | Built | `delete_folder`, `folder_file_count`; asks in a banner, and Settings › Sources keeps the answer |
| Rename a folder, on disk | Built | `rename_folder`, in its tree row, a name already there said under it |
| A folder's cover | Built | `folder_cover_choices`, `set_folder_cover`, the pencil on the band's cover, which takes only a live picture at or below the folder; the first picture stands in while none is chosen |
| A folder's status, notes, favourite | Built | favourite: `set_folder_favorite`, `favourite_places`, a group of its own in navigation and in the band; status: `set_folder_status`, the band's segmented group; notes: `set_folder_note`, written in the band |
| A folder's labels and tags, inherited by everything under it | Built | `add_folder_tag`, `set_folder_label`, `remove_folder_tag` and their offers, the band's Add Tag… and Add Label…; one value per key, and a key given once down a branch, refused above a folder that holds it as below one; where a move, or undoing a delete, brings two together, the nearest folder's; items inherit labels, and never own one |
| Every item id under a folder | Built | `folder_item_ids`, and `folder_branch_files` for the bar; Select Everything Inside on a folder's and a source's menu checks the whole branch, the bar counting the files below that the grid does not list |

## Items

| Capability | Filmstrip | Where |
| --- | --- | --- |
| List a folder's items | Built | `folder_items` |
| An item in full | Built | `item_detail`, the pane |
| The Sorting Box's items | Built | `sorting_items` |
| Favourite an item | Built | `set_item_favorite` |
| Reveal, open, copy the file | Built | the pane's bar |
| Sort by key and direction, random order held steady | Built | `folder_items`, `sorting_items` and `search` take the order; the grid's header chooses it per kind of place |
| Move items between folders | Built | `move_items`, Move to… on the pane's bar and a file's menu; a name already taken is reported, never changed |
| Delete items to the trash | Built | `trash_items`, Delete on the pane's bar and a file's menu; undo takes an item back |
| Rename a file, on disk | Built | `rename_item`, the pane's Name row; not in ggallery; a name already taken is refused |
| Paste files in, and take an OS drop | Built | `paste_files`, `drop_files`: Paste on a folder's, a source's and the Sorting Box's menus, on the rows and on the grid's ground, Ctrl+V, and a drop from Explorer on a row or a folder's grid, the tree scrolling near its edges; a copy as a job with Cancel, a name taken refused, never changed; undo sends what came in to the Trash |
| Copy an item's path | Built | `copy_item_paths`, Copy Path in a file's menu, a set's and the pane's ⋯; one path to a line |
| Counts: unsorted, trashed, totals, arrival duplicates | Partly | `library_totals`, one query: the foot says what the library holds and weighs, and opens its totals by kind with the Sorting Box, the Trash and the sources, any offline named; arrival duplicates wait for duplicate detection |

## The pane

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Show the item that was clicked, and keep it | Built | |
| Details, and the tags on an item | Built | |
| A filmstrip of the place it came from | Built | |
| Full screen | Built | |
| Zoom and pan a picture | Built | DECISIONS.md "The pane" |
| Video playback | Built, on a plate of its own | DECISIONS.md "The pane"; the mute is not yet kept between items |
| Frame steps, a named speed set and the volume | Drawn | #68, `docs/design/pane.dc.html`; waiting on the probe to record a frame rate |
| Several items at once, scaled to fit together | Built | #66, dragging files onto the pane adds them, twelve at most, at one scale in the rows that draw them largest; × takes one out, a click or Escape returns to one; videos loop muted, one at a time with sound |
| A folder shown in the pane rather than an item | Built | #67, its own thing, not a second mode: Show in Pane heads a folder's, a source's and a search's folder card's menu, offline too; its cover, name and count, the band's rows as its details, Open, Show in Explorer and the folder's menu on the bar, and a strip of its own files; DECISIONS.md "A folder in the pane" |
| Tiled compare and multi-view panes | **Dropped on purpose.** The pane has one mode. |

## Tags and labels

| Capability | Filmstrip | Where |
| --- | --- | --- |
| An item's effective tags, inherited live | Built | `item_tags`: its own as added, then each folder's from the source down |
| Add or remove a tag on an item | Built | `add_item_tag`, `remove_item_tag`, Add Tag… in the pane's details, the band's own control; an item owns tags only, never a label, and what it inherits comes off only at its folder; a tag may be several words, kept lowercase with one space between them |
| A folder's inherited tags | Built | `folder_detail`, in path order in the band, each where it is nearest |
| What a selection's tags cover | Built | `selection_tag_coverage`, `add_items_tag`, `remove_items_tag`; Tag… on the selection bar and the set's menu: each tag on all, on some with the count, or from which folder; added to every checked file that lacks it, or a file's own taken off every file that has it, each as one batch with the Line and Undo |
| The vocabulary, with counts; rename, merge and delete a tag | Built | `list_tags`, `rename_tag`, `merge_tags`, `delete_tag`, and the same for a label's keys and values; Settings › Library › Tags, sorted by its headings and filtered as you type, a click on a chip searching; each act one batch with the Line and Undo, Ctrl+Z in the section; a key merge refused where a branch would hold it twice. A folder's name is listed but only its hand-given uses change |

## Search

| Capability | Filmstrip | Where |
| --- | --- | --- |
| A query language, compiled to SQL over an FTS index | Built | `read_query`, `search`, `item_fts` and `folder_fts`; typed in the bar, its terms shown as chips, Ctrl+F; a path starts at a source, `is:sorting` for `is:unsorted` |
| A page of results | Built | a place of its own: matched folders as cards before the files, each file saying where it lives; the whole list at once, as every place is |
| Folders and tags offered as controls that write the query | Built | a search starts everywhere and where you stand is offered, one Tab or click away, and Search Everywhere removes it; a list under the field offers folders, tags and labels for the word being typed (`search_suggestions`); the pane's labels and tags search on a click and add on Ctrl+Click; Search in Folder and Search in Source on their menus; a matched folder's glass scopes the search to it. Filmstrip's own change: the syntax is the fallback |

## Selecting, triage and the trash

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Select in a grid, and act on the selection | Built | a box on each tile, Ctrl and Shift with a click, the keyboard; a bar at the grid's foot with Favourite, Tag…, Move to…, Copy and Delete, or Restore in the Trash |
| Move a selection somewhere | Built | the bar's Move to…, or dragged onto a row in navigation; one batch undone as one |
| Destination hotkeys | Built | `destination_keys`, `set_destination_key`, `remove_destination_key`; the digits 1 to 0, bound from a folder's menu or Settings, shown on its row, a press moving the set or the pane's file |
| The trash as a place, with its own limits | Partly | `trash_listing`, `library_totals`: newest first under a heading per day, each tile saying where it came from, counted on its row and header; there are no limits yet |
| Restore from the trash, or restore to another folder | Built | `restore_items`, journalled; Restore and Restore to… on a trashed file's bar and menu, refused into the banner |
| Purge the trash, the one irreversible act | Not started | |

## Export and undo

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Export a folder's subtree or a selection as a zip, as a job | Built | `export_plan`, `pick_export_zip`, `start_export`, `cancel_export`; DECISIONS.md "Exporting a zip". Filmstrip's own change: renaming the files or keeping their own names is chosen at export |
| An undo journal that survives a restart | Built | `journal`, DECISIONS.md "Undo"; the line at the foot of navigation, Ctrl+Z |
| Undo the last batch, or a named one | Built | Ctrl+Z takes the last, the line's Undo its own batch; no list of batches yet |

## The interface

| Capability | Filmstrip | Where |
| --- | --- | --- |
| Three panels, splitters, folding, the rail | Built | |
| The app's own window chrome | Built | |
| Settings | Built, with Sources, Destination Keys, Tags and Backups in it | |
| The app's own right-click menus | Built | on a tile, a set of checked tiles, a frame, the pane's picture, a folder and a source, every verb included |
| A scrubber for very large folders | Backlogged | |
| Compression review, duplicate detection, a storage screen | Not started | PRODUCT.md "Later" |
