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

## A removed source's trashed files · DRAWN

Removing a source forgets its rows, the trashed ones too, and leaves their files in `data\trash`
where nothing shows, restores or expires them (#110). A restore that forgets a source added
since leaves the same.

By DECISIONS.md "Expiry goes to the Recycle Bin", they go to the Windows Recycle Bin. Draw the
remove question in Settings › Sources saying so with a count, and the restore question when the
backup forgets a source. Where the Recycle Bin cannot take a file, the file stays in the Trash
and the app says where, as #70 has it for expiry. Draw none trashed, some, a refused file and an
offline source.

Drawn in Artboards › Sources, "What removing does with its trashed files", and beside the
restore's question in Artboards › Backing up the index:

- The question adds "Its 2 files in the Trash go to the Recycle Bin." ("Its 1 file … goes"),
  counting the source's trashed rows, offline or not. With none it is unchanged.
- Remove Source sends each file, its row going with it, under the restore's line and bar
  ("Removing Pictures…", the share sent), Settings holding still; then the source goes.
- A file the Recycle Bin cannot take is never sent: it stays in the Trash under its row, the
  source is not removed, and the section's band says "Pictures was not removed. The Recycle Bin
  could not take 1 of its files, so it stays in the Trash." over `D:\Filmstrip\data\trash`.
- A restore's question adds "Archive was added since, so it is forgotten, and its 1 file in the
  Trash goes to the Recycle Bin.", naming several in a list with one count. The files go after
  the check and the hold, before the "before restore" backup; one refused stops the restore
  there, nothing swapped, with the band "The index was not restored. …".

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
