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
not sit inside another. Removing a source forgets the index and never the files in its folder;
its files in the trash stay in the Windows Recycle Bin, out of the app.

Deleting a folder asks: move what is inside to the Sorting Box, or send it to the trash as
well. An empty folder goes without asking. Each sorting source is its own answer, and one can be kept
as the default: from then on a folder with files in it moves there without asking at all, until
Settings changes the default or goes back to asking each time. With no sorting source there is no Sorting Box to move to, so the only answer is the
trash.

Files copied in Explorer are pasted into a folder or the Sorting Box, and files dragged from
Explorer are dropped on one. Either way they are **copied in, never moved**, under their own names,
a folder with its tree; a name already taken there is reported and left out. The copy runs in the
background with a Cancel, and one Undo sends everything it brought in to the trash. On a drive
with no Recycle Bin, a USB stick, an SD card or a network share, there is no trash to send it to:
the Undo leaves it where it is, the banner names the drive, and the next Ctrl+Z undoes the act
before. Undoing Restore to… into a folder on such a drive leaves the file there the same way.

A folder's branch, or any checked files, can be **exported as one zip**. Windows' save dialog says
where, and the files keep their own names or are named from their folders and when each was
taken; the tree is kept either way. The library is only read: the export runs in the background
with a Cancel, files on a drive that is away are skipped and listed, and a zip goes only under a
name that is free, so nothing is ever replaced. A folder with no files in it says so, and asks
nothing.

## The Sorting Box

**A real place, but not a single folder.** It is one or more *sorting sources* — folders the
user nominates for incoming files — shown together as one surface. An item sitting in it has a
real directory of its own: the Sorting Box is not a saved search, and it is not "no folder".

A sorting source may neither contain a library source nor sit inside one. Sorting an item moves
it on disk, out of its sorting source and into the library.

## Trash

**The Windows Recycle Bin, on each file's own drive.** Delete sends a file there, and the Trash
lists what the library sent: Restore, Restore to… and Ctrl+Z take a file back out, its tags with
it. The Trash keeps no limits of its own, since the Recycle Bin keeps Windows'; Settings › Trash
says how many files the library has there and the space they take. Nothing else in the bin is the
Trash's.

A file the Recycle Bin will not take, too large for it or on a drive whose bin is off, stays where
it was, and the foot says so; nothing is deleted outright. In a set the rest go, with Undo. One
the app never hands to the bin stays the same way and the banner says why: a path too long for
the Recycle Bin, or a drive without hard links, named, such as an exFAT disk.

A drive with no Recycle Bin at all, a USB stick, an SD card or a network share, asks first, once
for the whole selection: the drive, how many files and how much space, and that they go for good
with no Undo. Cancel has the focus. In a mixed selection the rest go to the bin at once, with
Undo, and only these are asked about; a folder's Delete Files Too becomes Delete Files
Permanently there, and the folder goes once its files have. A file that would not go, open in
another app or read-only, stays where it was, and the foot names it.

The Trash looks in the bin at launch and whenever it opens. A file emptied from the bin outside
the app leaves the Trash, its row retired, and Ctrl+Z skips it as it skips a file Empty Trash…
deleted. One put back from Explorer is restored in the index, tags and all. When the look, or
removing a source, leaves an act with nothing to undo, the act's line at the foot keeps its
sentence and loses its Undo. A Restore or Ctrl+Z that reaches a file emptied from the bin before
the Trash has looked says so, under Gone from the Recycle Bin. Emptying the library's files from
the bin, and Delete on a drive with no bin, are the only ways the app deletes a file outright, and
both ask first.

Empty Trash…, in Settings › Trash while the Trash holds anything, deletes for good the files the
library sent to the Recycle Bin and leaves the rest of the bin as it is. Its question says how
many files and how much space, that only these go, and that Undo cannot bring them back; Cancel
has the focus. Emptying counts in the section's head as it goes, and a file deleted meanwhile
stays. The foot says when it is done, with no Undo: Ctrl+Z skips the emptied files and undoes
the act before them. A file no longer in the bin, or one that would not go, is skipped and said;
one that would not go stays in the Trash, for Show in Trash to find and Empty Trash… to ask again,
and the rest still go. The banner lists each one that stayed, with why.

## Tags and labels

**Tags** are lowercase, may be several words such as `new york`, and belong to items and
folders. **Labels** are a key and a value, and belong to folders only.

An item carries its own tags and inherits tags and labels from every folder above it; a folder
inherits from its ancestors too. **A value is never shown without its key** — a result matching
`Cairo` says it matched the label `Location: Cairo`, and says that it was a label rather than a
tag.

A set of checked files is tagged at once. Its Tag… says which tags every one of them carries,
which only some do and on how many, and which folder gives each that comes from one; a tag added
there goes on every file that lacks it, and one taken off comes off every file that holds it as
its own.

The library's vocabulary is tended in Settings › Tags: every tag and label key with the files
that carry it and the folders that hold it, sorted and filtered as you type. A tag, a key or a
value is renamed, merged into another or deleted where its row stands, and each comes back with
Undo. A folder's name is listed too, but only renaming the folder changes it.

## Search

Terms scope by folder and by tag, and both are offered as **visible controls**. Typing the
syntax by hand is the fallback, never the intended path.

**Navigation is not a search.** A breadcrumb or a row in the navigation panel goes to that
folder.

## The three panels

Navigation on one side, the grid in the middle, the pane on the other. The pane shows the item
you clicked; clicking another replaces it, and dragging items onto it adds them, up to a limit —
several at once are scaled together so all of them are in sight. Every clip among them plays,
unless the machine falls behind with them; then the ones added last pause until it keeps up. One
mode, not a preview mode and a grid mode. A folder can be shown there too, from its menu: its
cover, its counts and its details, so it can be looked at without leaving the place you are in.

Along the pane's foot, a filmstrip steps through the place the item was clicked in. The pane
keeps both while the user looks somewhere else.

## Triage

Not a screen. Select in any grid — a folder, the Sorting Box, the trash — and move the
selection somewhere. Destination hotkeys exist for the folders used most.

## Keys

An organiser on Windows takes Explorer's keys. None of them reaches past a text field, which
keeps its own. Delete, Ctrl+C, Ctrl+Shift+C and the digits act on what is checked, or on the file
in the pane when nothing is. Held, Delete and the digits act once, and a second press before the
files have gone sends nothing more.

- **Delete** sends the files to the Recycle Bin, as the bar's Delete does.
- **F2** renames the focused tile's file, or the focused folder in navigation.
- **Ctrl+C** copies the files, and **Ctrl+Shift+C** their paths.
- **Ctrl+V** pastes into the place the grid shows.
- **Ctrl+Z** undoes the newest act, and **Ctrl+Y** or **Ctrl+Shift+Z** redoes what it undid,
  until a new act replaces it. The line at the foot after an undo offers Redo too.
- **Ctrl+A** checks the whole place, and **Escape** clears it.
- **Ctrl+F** goes to the search field.
- **1 to 0** move the files to the folders bound to them.
- **Ctrl+wheel** over the grid steps the tile size; **Ctrl+=**, **Ctrl+-** and **Ctrl+0** set the
  size of the whole interface.

## Later

Built on the finished interface, not alongside it: compression with review before anything is
replaced, duplicate detection, a storage screen, a
blur toggle, and bundling HandBrake as ffmpeg already is, so a release needs nothing downloaded.
