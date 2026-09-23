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

## The app's own right-click menus: the verbs that change the disk · DRAWN

Drawn on the Components sheet; what exists is built, DECISIONS.md "Right-click menus". What waits,
on the undo journal (FEATURES.md "Export and undo"): a file's Move to…, Rename and Delete, and a
folder's New folder, Move to…, Rename and Delete. New folder lands a row already in its name field,
and on a source's row makes a folder at its top level. Move to… is the file picker, with a folder's
own descendants refused in it. A folder's Rename is the in-place field with its Taken state. Delete
asks only when the folder holds something, naming each sorting source as its own answer, with a box
that keeps the pick as the default in Settings › Sources; more sorting sources than the line holds
fold into one Move them to…. The selection's menu, with its count and "Delete five files", waits on
selecting.

## A menu's heading is drawn off the token sheet · DEFECT

A source's menu opens under "Source" and a selection's under "5 files", both drawn in `#6e6e6e`,
mono at 0.6875rem with 0.08em tracking. None of that colour or tracking is a token; the nearest is
`eyebrow` at 0.12em in `fg-faint`. Recommended: draw the heading from the sheet's own type and
colour. Until then a source's menu is built without it.

## A keyboard menu's flip still says 4px, and the menu's width is on no sheet · DEFECT

Components › Right-click, "The keyboard's menu hangs off the ring", says it flips above "the same
4px clear of the ring"; its cards and the Notes settle one distance, the ring's 4px then a
tile-gap. Every sheet draws menus 14rem wide, and the token sheet names no width for them; the
build carries it as `menu`. Recommended: correct the sentence, and add the width to the token
sheet. Neither blocks: the build follows the settled distance and the drawn width.

## Where a favourite place shows

Components draws Favourite on a folder's and a source's menu, but nothing shows which places are
favourites, and the Artboards sheet leaves "whether favourite folders belong in the rail" open. A
verb whose result nobody can see is not built. Recommended: draw where a favourite place shows, a
mark on its row or a place of their own, and Favourite joins both menus.

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

## Undo, on screen

Everything the app changes on disk can be undone, across a restart (DECISIONS.md "Undo"), but
nothing is drawn for it: the Notes sheet says so. Draw what follows an act that can be undone, the
way back from it, and Ctrl+Z; what an undo that came back only in part says, naming what stayed;
and what Ctrl+Z does when there is nothing left to undo.
