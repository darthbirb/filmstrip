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

## The offline band refuses what an offline source's menu still does · DRAWN

Artboards › 04 "A source's own band" draws Pictures offline as read-only, Favourite included,
reading "Not a favourite". But the build keeps every act on an offline source that touches only
the index: its menu still has Favourite, Assign Key… and Rename, and loses only what needs the
drive (DECISIONS.md "Right-click menus"). A folder's status, labels, tags and note are in the index
too. So the band refuses an act the row beside it offers.

The folders below an offline root still show in navigation and can be gone into, and their band
is not drawn either.

Draw the offline band in line with what an offline source can still do, on Pictures and on a
folder below it.

## The folder band's edit controls open nothing · DRAWN

Artboards › 04 draws Add Label…, Add Tag…, Set Cover, Change Cover and Add Note… as controls, and
stops there. Nothing shows what a click on each one opens, how a label's key and value or a tag
are typed and confirmed, how a chip already on the folder is removed, how a note is written,
edited, saved and abandoned, or how a cover is chosen and cleared. Nor what the keyboard does in
any of them, or what shows when a value is refused, such as a tag the folder already carries.

A folder's title tag is its name, and goes only when the folder is renamed.

Draw each one through to the end.

## Tagging a file · DRAWN

The pane's details show a file's tags, its own and those inherited from its folders, and offer
no way to change them. In ggallery a file's tags were added and removed by hand.

A file takes tags only, never a label. Inherited tags belong to a folder and cannot be removed from
the file.

Draw adding and removing a file's own tags in the pane's details. It is the same act as the folder
band's Add Tag…, so the two should be one control.

## A folder's details · DRAWN

The grid's header says only where you are. A folder has more to know, and nowhere to show it:
how many items it holds, its labels and tags, and, in the schema already, a status, a favourite
flag, a note and a cover.

Make the grid's header a disclosure, as the pane's header is, taking the old drawing's folder
band: a chevron, the folder's title and its counts, then the header's own controls. Opened, it
drops a band with the cover beside rows for Path, Status, Labels, Tags and Note, in the same
rhythm as the pane's details. The Sorting Box and the Trash keep a plain header with no
disclosure.

Its counts read in the count pill's terms, as redrawn, always both parts: `3 here · 9 in all`,
`3 here · 3 in all`, `0 here · 0 in all`.

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
