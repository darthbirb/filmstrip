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

## Bringing files in from Explorer · DRAWN

Issue #63. Files copied or dragged in Explorer cannot be brought into a folder or the Sorting Box.

Artboards › Bringing files in. A drag from Explorer draws the app's own ghost under Explorer's
picture, the hatch where the picture will be, and says the act before it lands: Copy 3 files to
Lisbon over a row that takes it, lifted as for a move, and the reason in red over one that will not
(the files' own folder, a folder onto itself, the Trash, a drive that is away). A folder's grid
takes it as its row does, inside a 2px pewter ring; a search, the Trash and an offline grid do not
light. The Sorting Box with more than one sorting source asks which at the pointer on release.
Paste 3 Files follows New Folder on a folder's and a source's menu, counts what the clipboard
holds, and is absent when it holds no files; the grid's ground opens its place's menu under the
place's name, and the Sorting Box's row has Paste alone. Ctrl+V pastes into the place the grid
shows. The copy is a job with its own line at the foot and a Cancel; it ends with the Line and
Undo, which sends what came in to the Trash. A name already taken is reported in the banner, never
changed, and a folder whose name is taken stays out whole. A Paste of files already in the place is
refused in the band, Already in Cairo; a mix copies the rest and the banner names the others, with
no Retry. Drawn: over a row, four refusals, over a folder's grid, over a search, the Sorting Box's
pick, Paste on the menus, the Sorting Box's row, Ctrl+V with nothing and refused, the job's line,
two jobs and the walk, the Line with the counts moved, cancelled partway, after Undo, a folder with
its tree, names taken, a folder's name taken, a mix some of it already there, and Paste where it
already is.

## Exporting a zip · DRAWN

Issue #64. A branch or a selection cannot leave the library as one file.

Artboards › Exporting a zip. Export… follows Show in Explorer on a folder's and a source's menu,
and Copy Path on the set's menu and Copy on the selection bar, shedding behind More after Select
All. Windows' save dialog comes first, then a sheet in the menu's surface and width, against
what asked, says how the files are named: Keep Names or From Folders, a segmented pair, with the
first file as it will be in the zip, the zip it will write, and Export and Cancel. The tree is
kept either way; From Folders names a file from its folder and when it was taken, (2) and (3)
after a name already given in that folder, in the order the library read them. A file on a drive
that is away is said before and skipped; a set wholly away is refused before the dialog. The
export is a job with its own line and Cancel, and a cancelled or failed one leaves no zip.
Drawn: the sheet on the bar, From Folders, from a folder's menu, part away, all away, exporting,
exported with Show in Explorer, cancelled, the zip not written, exported in part with the banner,
and what the zip holds.

## Backing up the index · DRAWN

Issue #65. The index holds everything the disk does not, and nothing keeps a copy of it.

Artboards › Backing up the index. Settings › Library › Backups, after Tags: its name, how many are
kept and what they weigh, and Back Up Now; Backups to Keep, 3, 7, 14 or 30; then the backups
newest first, each with when, how it was taken (at launch, by hand, before restore), its size and
Restore…. Restore… asks on the row, in the row question's shape, and keeps the index as it was
as a backup first; a backup that cannot be read is refused at the section's foot and the index is
untouched. Lowering the number removes nothing until the next backup. Drawn: the whole dialog,
asking, restoring, restored with the way back on top, unreadable, the dropdown open, lowered,
the 640px window, thirty kept, none yet, one being written, and a backup refused in Settings and
at launch.
