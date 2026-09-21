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

## The delete question has no shape for many sorting sources · DEFECT

The delete question names each sorting source on its own button beside the trash. The Notes leave the
case of many open: "where the answers should go when a person keeps six sorting sources. They wrap
today, which is honest and untidy; a band that scrolls is the next shape, and nothing needs it yet."
The question is going to be built, so what it does with more sorting sources than fit on one line has
to be drawn rather than left to wrap.

Draw the question with more sorting sources than its row holds, at the pane's narrowest grid width and
at 200%, and say in the note where the answers go once they no longer fit. The trash answer, the box
and cancel keep their places.

## The app's own right-click menus · DRAWN

Drawn on the Components sheet: a tile, a selection of five, a folder row, a source row and the pane's
picture, in sentence case with the verbs the pane's bar already uses. The menu key and Shift+F10 open
the same menus one tile-gap below the focused tile's or row's ring. A tree row renames in place, as
Settings renames a source. A folder's row makes, moves and deletes folders: New folder lands a row
already in its name field, Move to… is the file picker, and Delete asks only when the folder holds
something, naming each sorting source as its own answer, with a box that keeps the pick as the
default in Settings › Sources. A source's row makes a folder at its top level. Waiting on the defect
above. The folder verbs that change the disk also wait on the undo journal, FEATURES.md "Export and
undo".

## The way into full screen · DRAWN

At the left end of the pane's header, as `arrow-line-left`, and `arrow-line-right` to leave. In full
screen the fold button goes and nothing slides into its place.

## Labels in sentence case · DRAWN

A title is Title Case; every label on a button, a menu row or a tooltip is sentence case. The built app
already agrees except for the notices: **Retry these**, **Show the 31**, **Hide the list**.

## Lines only where they hold a fact · DRAWN

Nothing Chosen Yet, Nothing To Sort, Trash Is Empty, This Folder Is Empty and both No Sources Yet lose
their lines, and so does the Sources section's title. This File Has Gone names the path it was at, a
codec the window cannot play names its format in mono, and a folder of folders and an offline source
keep their counts. Pressing a source's remove turns its row into the warning, with Remove source and
Cancel; Escape puts the row back.

## Zoom and pan a picture in the pane · DRAWN

On the Pane sheet. The behaviour ports from ggallery as it stands. At fit nothing is on the picture;
off fit, one percentage plate a tile-inset inside the media area's bottom-left, which is also the way
back to fit and a tab stop only while it is there. The picture is clipped by the media area's rounded
inset at every magnification. Plus and minus zoom about the centre from the keyboard and 0 fits; a
video does not zoom; a multiple of fit and a centre point survive a resize, a fold and full screen,
and the next item starts at fit.

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
