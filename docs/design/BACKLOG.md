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

## A search starts scoped to where you stand · DEFECT

Components › "The field holds the query, and shows it as terms" has focus write where you stand
as the query's first term, so a search typed in Cairo searches Cairo. Tried against a real
library, that is the wrong default: a search is for finding something whose place is not known,
and the narrow answer hides what the wide one would have found.

A search covers every source and the Sorting Box unless the person asks for less. The place they
stand in, a folder, the Sorting Box or the Trash, is offered as a scope one Tab or one click away,
and is never written for them. How it is offered is for this pass to decide.

Redraw everything the old default reaches: the field on focus and on Ctrl+F; the scope typed in
the Sorting Box and in the Trash, which is still the only way a trashed file reaches results; the
results header and Nothing Matched, whose Search Everywhere assumed a scope to remove; the
suggestion list's folders, drawn as under the scope; and "One scope per query". The scope stays a
term in the text, read, removed and typed like any other.

## A source's row shows no count

In navigation every folder's row ends in a count and a source's row has none, so the files lying
directly in a source's own folder cannot be seen from the tree. A library of nine files read as
five: three lay in the source itself and one in a folder folded shut.

Give a source's row its count, by the rule the entry below settles for folders.

## A folder's count hides what is below it

A folder's row counts only the files directly in it. A folder of folders reads as empty, and
nothing says how much a branch holds.

Show both where they differ: the folder's own files, then everything at or below it, as `3/9`;
one number where the two are equal. Draw it on a folder's row, a source's row, the Sorting Box and
the Trash if the rule reaches them, and the other places a count is shown: a destination key's
row in Settings, the picker, and the folder buttons of No Pictures Here. Say whether a row folded
shut and the same row opened show the same thing.

## Folders and tags as controls · DRAWN

The controls that write a term are not drawn anywhere. Draw each: a tag or a label in the pane's
details, a folder's right-click menu (Search in Folder), and a matched folder among results, where
going into the folder and scoping the search to it are two different things. Say whether a click
replaces the query or adds its term, and which modifier does the other.

Not built yet, and reopened by the defect above: the drawn rule, a click replaces the query and
drops the scope and Ctrl+Click adds the term and keeps it, was made for a search that starts
scoped. Say what each does once it does not.

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
