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

## The tags screen · DRAWN

Issue #61. Nothing lists the library's tags, so a misspelt one stays misspelt on every file.

Artboards › Tags. A section of Settings, Library › Tags, after Destination Keys: every tag, then
every label key with its values, each with the files that carry it and the folders that hold it,
sortable by its column headings and filtered as you type; an unused tag says so. A click on a chip
closes Settings and searches. A tag's ⋯ renames, merges or deletes where the row stands: renaming
onto a tag that exists, after folding, asks to merge on the row; delete asks with its count. A
key's ⋯ renames, merges or deletes it, and a value's renames, merges within its key, or deletes it.
A folder's name is listed but only its hand-given uses change. Renaming or merging a key is
refused where it would give a folder a key one above or below it holds, in the band's words. Each
act ends with the Line at the section's foot, with Undo, and Ctrl+Z in the section takes it back.
