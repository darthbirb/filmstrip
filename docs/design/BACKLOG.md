# Design backlog

What the next Claude Design pass should draw. Each entry is one issue and the fix recommended
for it; once the fix is drawn and built, the entry is deleted. An entry marked **DRAWN** has
been through a pass already and is waiting to be built, so it does not need drawing again.

An entry marked **DEFECT** is a fault in what a pass drew — a contradiction between two sheets, a
drawing that disagrees with what is already built, or a state that was never drawn at all. Defects
are drawn before anything else and nothing is built from a sheet that carries one: a surface built
from an incomplete drawing is built twice.

"The old drawing" is `ggallery-drawing.html` in this folder. Where an entry borrows from it,
take its structure and behaviour, and fit its values to the current token sheet: Plex, Phosphor,
the red focus ring, the white in-pane mark.

Always update the existing sheets in place. A new drawing belongs on the sheet its subject
already lives on, never in a file of its own.

## The grid's ground in Components › Right-click · DEFECT

Components › Right-click, under "Where there is no menu, nothing opens", still says the grid's
bare ground offers no menu of its own, while Artboards › Bringing files in draws the place's menu
on it, with Paste, and the app builds that. The artboard wins: take the grid's bare ground out of
that sentence, and draw the ground's menu there beside the rows' as the place's own, under its
name.

## Scrubbing a video's tile · DRAWN

A video's tile shows one frame. In ggallery, running the pointer across a video's tile scrubbed
through it, left to right.

Moving the pointer across a video's tile shows the frame at that point in the clip. Draw what
shows while it scrubs, a thin position line along the tile's foot and the time under the pointer
in the length plate, and what a video with no scrub frames shows, since they need ffmpeg.

## A scrubber for the grid · DRAWN

A large folder scrolls with a thin scrollbar, and reaching the middle of forty thousand pictures
is slow.

Consider the old drawing's scrubber: a 16px channel at the grid's edge with a square thumb, held
to jump anywhere; the position is the information. Investigate whether it replaces the
scrollbar or sits beside it. The pass that drew it recommends building the other ten first, and
only building this if the largest folders still feel unnavigable afterwards.

## Delete to the Recycle Bin, and restore from it · DRAWN

#192. Delete sends a file to the Windows Recycle Bin on its own drive, not into `data\trash`, and
the Trash lists what the library sent there. The Trash's limits, expiry and the too-large refusal
go. Replaces what Artboards › The Trash's limits drew for #70 and #186.

Drawn in Artboards › The Trash in the Recycle Bin:

- **Settings › Library › Trash** without its limits: the head with how many files the library
  has in the bin and their size, Empty Trash… in `danger`, and two lines under it on where a
  deleted file goes and what a drive with no bin does. Nothing in the Trash drops Empty Trash….
- **The foot for a file the bin refused**: alone, it stays where it was and the line says it may
  be too large for the bin or the bin off, with nothing deleted; in a set, the rest are one batch
  with Undo and the refused one is named.
- **Restore from the bin**: the Trash's restore banner gains a heading, Gone from the Recycle
  Bin, for a file emptied from the bin outside the app, with no row button; Retry only while a
  row under Still in the Trash could succeed. A taken name and a gone folder stay as The Trash,
  holding files draws them. One already back at its path counts as restored.
- **Reconciling** at launch and when the Trash opens: gone from the bin and not back, the row
  retires; back at its path, it is restored in the index.

Redrawn with it, by the owner's decision of 2026-11-15:

- **Removing a source**, in Artboards › Sources ("What removing does with its trashed files"):
  files the library already sent to the bin stay there. The question says how many of the
  source's files are in the Recycle Bin and that they stay there, out of the app; removing
  forgets their rows, sends nothing and so cannot be refused. An offline source's trashed files
  are in its own drive's bin and are counted from the index the same way. The sending bar and
  the refusal band go.
- **A backup restore that forgets rows**, in Artboards › Backups ("Restore… · a source added
  since"): the question names the source and counts its files in the Recycle Bin, which stay
  there; nothing is sent while restoring. "Not restored · the Recycle Bin cannot take a file"
  goes.

## Ask before deleting on a drive with no Recycle Bin · DRAWN

#193. A file on a USB stick, an SD card or a network share has no Recycle Bin to go to.

Drawn in Artboards › The Trash in the Recycle Bin, "A drive with no Recycle Bin":

- **The question above the grid**, once for the selection, in the question's shape: the drive
  by its label and letter, how many files and how much space, that they go for good and Undo
  cannot bring them back. Delete Permanently in `danger`, Cancel with the focus.
- **A mixed set**: the rest go to the bin at once with Undo; the banner lists the asked ones under
  their drive with their sizes. A selection wholly on two such drives names both in the head,
  and three or more are counted.
- **A folder's question** says it once rather than asking twice: Delete Files Too becomes Delete
  Files Permanently, with the drive's line under the answers, and × has the focus.
- **The foot**: deleted for good with no Undo, and a file that would not go staying where it was.
  Also drawn: the window's least, a long name wrapping, the keyboard on Delete Permanently.

## Empty the library's files from the Recycle Bin · DRAWN

#194. Empty Trash… deletes for good only what the library sent to the bin.

Drawn in Artboards › The Trash in the Recycle Bin:

- **The question**, in the row question's shape under the section's head: how many files, how
  much space, that only these go and the rest of the bin is left as it is, and that Undo cannot
  bring them back. Empty Trash in `danger`, Cancel with the focus. Also at the window's least.
- **Emptying**: the head counts as it goes with the walk's bar where the button was; nothing to
  cancel; a file deleted meanwhile joins the Trash after it and stays.
- **The foot**: after Empty Trash, with no Undo, Ctrl+Z skipping to the act before; and files
  skipped, two gone from the bin and one that would not go, with Show in Trash.
