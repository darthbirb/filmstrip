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

## The Trash's limits, expiry and emptying · DRAWN

#70. The Trash keeps to a time to live, a total size and a size per file, set in Settings, and
can be emptied. Expiry goes to the Windows Recycle Bin, as DECISIONS.md "Expiry goes to the
Recycle Bin" has it, through `fs::recycle::send`.

Drawn in Artboards › The Trash's limits:

- **Settings › Library › Trash**, after Backups: the head with what the Trash holds against its
  total and Empty Trash… in `danger`, three dropdown rows (Keep For, Total Size, Size per File,
  each ending in No Limit; 30 Days, 25 GB and 5 GB the first), and one line on where an item
  goes. A lowered limit sends nothing at once: the line says what the next hourly run will send
  and when. Also drawn: a dropdown open, no limits, nothing in the Trash (no Empty Trash…),
  emptying, and the window's least with the keyboard on a dropdown.
- **Empty Trash…'s question**, in the row question's shape under the head: how many files, how
  much space, and that they do not go to the Recycle Bin. Cancel has the focus.
- **A file too large for the Trash**: Delete refuses it before it moves and asks above the grid,
  in the question's shape, with Send to Recycle Bin in `danger` and × keeping it. In a set, the
  rest go to the Trash as one batch and the banner lists the refused ones with their sizes. A file
  larger than Total Size is refused the same way. The bin refusing the send keeps the file where
  it was and says so.
- **The foot**: expiry by age, by size, and both, each with no Undo. Its line keeps the slot's
  rule, one at a time and the newest replacing the other: it replaces an act's line, and a Band
  or the next act's line replaces it; Ctrl+Z still reaches the act. The Recycle Bin refusing an
  expired file keeps it in the Trash, still counting toward Total Size, and says so once, again
  only when the count of refused files grows, with Show in Trash. After Empty Trash, and Empty
  Trash with files that would not go.
- **A restore that loses the race to expiry**: the Trash's restore banner, with the expired rows
  under their own heading, In the Recycle Bin, and no row button; Retry only while a row still in
  the Trash could succeed. A Ctrl+Z on a delete some or all of whose files expired is the same.
- **Size per File** is asked only at Delete; lowering it sends nothing from the Trash.

When built: the `recycle` glyph is new to the app's bundle. DECISIONS.md "The pane" still says
nothing purges and emptying the Trash is under Later, and "Undo" says the journal's pruning
is settled with the trash's limits; both change with the build.
