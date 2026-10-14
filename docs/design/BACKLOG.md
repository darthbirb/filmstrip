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

Issue #112. Issue #63 built the rest; two parts of Artboards › Bringing files in wait. The grid's
ground, between the tiles or under the last row, opens its place's menu under the place's name, with
Paste, as the place's row does; the Sorting Box's ground has Paste alone. And a drag from Explorer
near the tree's top or foot scrolls the tree, as a move's drag does.

## Exporting a zip · DRAWN

Issue #64. A branch or a selection cannot leave the library as one file.

Artboards › Exporting a zip. Export… follows Show in Explorer on a folder's and a source's menu,
and Copy Path on the set's menu and Copy on the selection bar, shedding behind More after Select
All. Windows' save dialog comes first, then a sheet in the menu's surface and width, against what
asked, says how the files are named: Keep Names or From Folders, a segmented pair, with the first
file as it will be in the zip, the zip it will write, and Export and Cancel. The tree is kept
either way; From Folders names a file from its folder and when it was taken, (2) and (3) after a
name already given in that folder, in the order the library read them; a source's own files are
named for the source, a sorting source's for the Sorting Box. A file on a drive that is away is
said before and skipped; a set wholly away is refused before the dialog. The export is a job with
its own line and Cancel, and a cancelled or failed one leaves no zip. The app never replaces a
file. Windows' save dialog asks whether to replace a name that exists, which the dialog plugin
cannot turn off; No keeps it open for another name, and a Yes is refused in the band, Filmstrip
never replaces a file. Trips.zip is already in Exports. For #64, the finished zip goes into place
by a step that refuses an existing name: std::fs::hard_link then removing the temporary file, or
MoveFileExW without MOVEFILE_REPLACE_EXISTING, never std::fs::rename, which replaces on Windows.
Drawn: the sheet on the bar, From Folders, from a folder's menu, part away, all away, a name taken,
exporting, exported with Show in Explorer, cancelled, the zip not written, exported in part with
the banner, and what the zip holds.

## Backing up the index · DRAWN

Issue #65. The index holds everything the disk does not, and nothing keeps a copy of it.

Artboards › Backing up the index. Settings › Library › Backups, after Tags: its name, how many are
kept and what they weigh, and Back Up Now; Backups to Keep, 3, 7, 14 or 30; then the backups newest
first, each with when, how it was taken (at launch, by hand, before restore), its size and
Restore…. Restore… asks on the row, in the row question's shape, and keeps the index as it was as a
backup first; a backup that cannot be read is refused at the section's foot and the index is
untouched. The chosen one is checked before the current index is backed up, and the oldest go only
once the swap has succeeded, never the one restored. A restore keeps the Trash as it is now, each
trashed item with its chain of folders, retired, and one from a source added since goes as that
source's other rows do; it starts the job queue empty but for the walk. Lowering the number
removes nothing until the next backup, and marks every row that will not be among the newest after
it. Drawn: the whole dialog, asking, restoring, restored with the way back on top, unreadable, the
dropdown open, lowered, the 640px window, thirty kept, none yet, one being written, and a backup
refused in Settings and at launch.
