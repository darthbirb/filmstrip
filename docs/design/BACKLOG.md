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

## Tagging a selection · DRAWN

Issue #60. With several files checked, nothing says which tags they carry, and a tag goes on one
file at a time, in the pane.

Artboards › Tagging a set. The selection bar gains Tag… after Favourite, and the set's menu the
same row. It opens a sheet over the grid in the menu's surface and width, a tile-gap above the
button: the count at its head, the shared tag field with its offers and refusals, then the tags
the set carries, its own first and each folder's after, in path order. A chip with no count is on
every checked file; a count, `3 of 5`, says how many carry it; a heading says whose it is. Enter
adds a tag to every checked file that lacks it, a chip's + does the same, and × takes a file's own
tag off every file that has it; an inherited chip has neither. Drawn: open, typed with a
several-word tag folded, added, under the pointer, refused, a search's set across two folders,
5,000 checked while read and read, behind More at the grid's narrowest, from the keyboard, and one
file.

## The tags screen · DRAWN

Issue #61. Nothing lists the library's tags, so a misspelt one stays misspelt on every file.

Artboards › The tags in the library. A section of Settings, Library › Tags, after Destination
Keys: every tag, then every label key with its values, each with the files that carry it and the
folders that hold it, sortable by its column headings and filtered as you type; an unused tag says
so. A click on a chip closes Settings and searches. Its ⋯ renames, merges or deletes where the row
stands: renaming onto a tag that exists, after folding, asks to merge on the row; delete asks with
its count. A folder's name is listed but only its hand-given uses change. Renaming or merging a
key is refused where it would give a folder a key one above or below it holds, in the band's
words. Each act ends with the Line at the section's foot, with Undo.
