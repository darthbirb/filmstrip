# Design backlog

What the next Claude Design pass should draw. Each entry is one issue and the fix recommended
for it; once the fix is drawn and built, the entry is deleted. An entry marked **DRAWN** has
been through a pass already and is waiting to be built, so it does not need drawing again.

An entry marked **DEFECT** is a fault in what a pass drew — a contradiction between two sheets, a
drawing that disagrees with what is already built, or a state that was never drawn at all. Defects
are drawn before anything else and nothing is built from a sheet that carries one: a surface built
from an incomplete drawing is built twice.

"The old drawing" is `old-ggallery-design.html` in this folder. Where an entry borrows from it,
take its structure and behaviour, and fit its values to the current token sheet: Plex, Phosphor,
the red focus ring, the white in-pane mark.

Always update the existing sheets in place. A new drawing belongs on the sheet its subject
already lives on, never in a file of its own.

## Right-clicking outside the set says two things · DRAWN

Components › Right-click: the note now keeps the set, as Artboards › Selecting does.

Components › Right-click says a right-click on a tile with no check moves the selection to that
tile first, so a Delete never acts on tiles you cannot see. Artboards › Selecting's table says
the same right-click opens that tile's own menu and keeps the set. One of them has to go.

Keep the Artboards rule, since a drag from an unchecked tile already carries it alone and keeps
the set, and the tile's own menu acts on that tile only; rewrite the Components note to match.

## The drag's 0.6s hold is not in the token sheet · DRAWN

Tokens › Motion: hold, 600ms, a wait rather than a motion, kept to drop targets that open;
Artboards › Dragging onto a folder names it.

Artboards › Dragging onto a folder opens a closed row after the ghost is held over it for 0.6s.
The token sheet names 120, 180 and 220ms and nothing else, so the build would invent a number.

Add the hold to the token sheet as a named duration, and say where else it may be used.

## Two presses of a destination key are not drawn · DRAWN

Artboards › Destination keys: Already in Lisbon, a set partly in Inbox, and a free key.

Artboards › Destination keys draws a bound key and a broken one. It does not draw a key that is
free, nor a key whose folder is the one the files are already in, which is the folder you stand
in or, in the Sorting Box, a part of the set.

A free key does nothing and says nothing, as a key with no meaning does elsewhere. A key for the
files' own folder moves what is elsewhere and passes over the rest, and when nothing would move,
says so in the refusal band, "Already in Lisbon", as the drag's refusing row does.

## The selection's bar · DRAWN

Artboards › Selecting: the bar at the grid's foot, at 20rem, in the Trash, and after a move that
finished in part; Components › Right-click: the set's menu in the Trash.

A tile can be checked, and a set has a menu, but the Notes sheet says what can be done with a set
is not drawn, and that the room it needs is a bar along the grid's foot. Nor is the set's menu in
the Trash.

Draw the bar while anything is checked, taking the old drawing's selection bar: the count and
its size, Select All, and the set's verbs, Move to…, Delete 5 Files, Favourite, and a way to clear
it. In the Trash it holds Restore and Restore to… instead, and so does the set's menu there. A set
that finishes in part reads as the banner already drawn, with more rows.

## Selecting without the pointer on the box · DRAWN

Artboards › Selecting: the pointer's and the keyboard's keys, and what the selection keeps and
loses.

Only the box is drawn. Shift and Ctrl with a click, Ctrl+A and Escape are not, nor what Space does
on a tile, nor how the keyboard moves between tiles, which today are one tab stop each. Nor what
becomes of the selection when you go to another place, when a checked file leaves the grid by a
move, a delete or an undo, or while the pane shows a checked file.

Follow Windows Explorer: Shift+click takes a range from the last one checked, Ctrl+click toggles,
Ctrl+A takes the place, Escape clears. The selection belongs to the place it was made in and
clears when you leave; a file that leaves the grid leaves the selection.

## Dragging onto a folder · DRAWN

Artboards › Dragging onto a folder: the ghost, the accepting row, four refusals, the line after.

The tree is always on screen, and moving a set means opening the picker and finding the folder
again. Whether a tile or a set can be dragged onto a tree row or a favourite is not drawn.

Let it: a ghost that counts what it carries, a row that accepts, a row that refuses (the files'
own folder, the Trash, a source that is away), and the move's own undo line after the drop.

## Destination hotkeys · DRAWN

Artboards › Destination keys: the key on a row, Settings › Library, Assign Key…, and what a press
says; Components › Right-click: Assign Key… on a folder's and a source's menu.

PRODUCT.md keeps destination keys for the folders used most, and nothing draws them. ggallery
bound a key to a folder, not a path, so the key survives the folder's rename and move, and kept a
binding whose folder had gone, marked broken, since a delete can be undone. Its culler is cut.

A press moves the selection, or the pane's file when nothing is checked, and says so in the
move's own undo line. Bind keys in Settings › Library, a list of key, folder and its count, and
from Assign Key… on a folder's menu. Show a bound folder's key on its row in navigation, and a
broken binding in the red. Say which keys can be bound, and what a key already bound does when
it is bound again.

## The selection's right-click menu · DRAWN

Components › Right-click: the selection's menu, with its count at the head and "Delete 5 Files".
Everything else on a folder's and a source's menu is built; this waits on selecting.

## A folder's details · DRAWN

The grid's header says only where you are. A folder has more to know, and nowhere to show it:
how many items it holds, its labels and tags, and, in the schema already, a status, a favourite
flag, a note and a cover.

Make the grid's header a disclosure, as the pane's header is, taking the old drawing's folder
band: a chevron, the folder's title and its counts, then the header's own controls. Opened, it
drops a band with the cover beside rows for Path, Status, Labels, Tags and Note, in the same
rhythm as the pane's details. The Sorting Box and the Trash keep a plain header with no
disclosure.

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

## The video plate draws its glyphs at two sizes, and neither is in the scale · DRAWN

The frame steps and the mute are `0.8125rem` in the plate drawn at the pane's own width and
`0.875rem` in the wide rows beside it — the same two controls, drawn at two sizes. Neither size is
in the glyph scale, which names `0.75`, `0.9375` and `1.125rem`. The empty states were redrawn at
named sizes this pass, but glyphs at `0.875rem` still appear about thirty times across the pane and
artboard sheets, and `0.8125rem` about seven, including in the controls this pass drew.

Pick one size for the plate's glyphs, and either move every glyph onto a size the scale names or
add the missing sizes to the token sheet and say which surfaces use them.

## The narrow video plate drops the total time, and no rule says it may · DRAWN

The plate at the pane's own width reads `0:03`; every wider plate reads `0:03 / 0:12`. The block
gives the order things leave — the speed first, then the frame steps, then the mute — and says play,
the track and the time never leave. Losing half the time is not in that order, so either it is an
oversight or the time abbreviates and the rule has to say so.

Say what the time does as the plate narrows.
