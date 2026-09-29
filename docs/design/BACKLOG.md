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

## Typing a search · DRAWN

Components › Search field draws the field at rest and nothing else. Search is the next slice, and
PRODUCT.md "Search" asks that terms scope by folder and by tag through visible controls, with the
syntax as the fallback. A query's text is the whole state of a search: anything a control offers
writes into that text rather than setting a hidden filter.

Draw the field focused, from a click and from a key (name the key), and while typing: a dropdown
of suggestions that each write a term — folders by their path, tags, and labels as `Key: Value` —
each saying what kind of term it is, since a value is never shown without its key. Draw the
keyboard through the list, and the raw syntax typed by hand. Draw a finished query in the field
as its terms, each removable: the terms are the parse, so what shows is what was understood.
Draw a query that does not parse, an unclosed `(` or `"`: what the field says, and that the
results stay where they were.

## Scoping to where you are · DRAWN

"Nothing Matched" says "No file in Cairo matches", so a search typed inside a folder searches
that folder. How that scope shows is not drawn. Since the query's text is the whole state, the
scope is a `path:` term like any other.

Draw the scope in the field, and both ways to widen it: Search Everywhere, and removing the term.
Say what a search typed in the Sorting Box or the Trash covers.

## Folders and tags as controls · DRAWN

The controls that write a term are not drawn anywhere. Draw each: a tag or a label in the pane's
details, a folder's right-click menu (Search in Folder), and a matched folder among results, where
going into the folder and scoping the search to it are two different things. Say whether a click
replaces the query or adds its term, and which modifier does the other.

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
