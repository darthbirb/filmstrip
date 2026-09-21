# Product

What the app does. Behaviour, not appearance.

## What it is

A gallery viewer first and a collection organiser second — the main activity is looking at
things, and everything else serves that. It runs locally against folders on the user's own
disk. No account, no network service, nothing uploaded.

## Folders and sources

**A folder is a real directory and an item is a real file under its own name.** The database
indexes the filesystem rather than replacing it. Moving an item moves the file; renaming a
folder renames the directory.

A **source** is a folder the user adds to the app. There can be several, and one source may
not sit inside another. Removing a source forgets the index and never the files.

Deleting a folder asks: move what is inside to the Sorting Box, or send it to the trash as
well. An empty folder goes without asking. With several sorting sources, moving asks which one,
and the answer can be kept as the default; Settings changes that default or goes back to asking
each time. With no sorting source there is no Sorting Box to move to, so the only answer is the
trash.

## The Sorting Box

**A real place, but not a single folder.** It is one or more *sorting sources* — folders the
user nominates for incoming files — shown together as one surface. An item sitting in it has a
real directory of its own: the Sorting Box is not a saved search, and it is not "no folder".

A sorting source may neither contain a library source nor sit inside one. Sorting an item moves
it on disk, out of its sorting source and into the library.

## Trash

A place: a folder in the app's own directory, with a maximum total size, a maximum size per
item, and a time to live, all adjustable by the user. What happens when an item expires — the
recycle bin, or deletion — is not settled yet.

## Tags and labels

**Tags** are single words and belong to items and folders. **Labels** are a key and a value,
and belong to folders only.

An item carries its own tags and inherits tags and labels from every folder above it; a folder
inherits from its ancestors too. **A value is never shown without its key** — a result matching
`Cairo` says it matched the label `Location: Cairo`, and says that it was a label rather than a
tag.

## Search

Terms scope by folder and by tag, and both are offered as **visible controls**. Typing the
syntax by hand is the fallback, never the intended path.

**Navigation is not a search.** A breadcrumb or a row in the navigation panel goes to that
folder.

## The three panels

Navigation on one side, the grid in the middle, the pane on the other. The pane shows the item
you clicked; clicking another replaces it, and dragging items onto it adds them, up to a limit —
several at once are scaled together so all of them are in sight. One mode, not a preview mode and
a grid mode.

Along the pane's foot, a filmstrip steps through the place the item was clicked in. The pane
keeps both while the user looks somewhere else.

## Triage

Not a screen. Select in any grid — a folder, the Sorting Box, the trash — and move the
selection somewhere. Destination hotkeys exist for the folders used most.

## Later

Built on the finished interface, not alongside it: compression with review before anything is
replaced, duplicate detection, a storage screen, a tags screen, trash limits and purging, a
blur toggle, and bundling ffmpeg and HandBrake so a release needs nothing downloaded.
