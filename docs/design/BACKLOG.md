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

## Every label in Title Case, in reviewed words · DRAWN

Components › Words gives the case rule, the small words that stay lowercase, and every label that
changed and why. Every built label follows it: the pane's bar and its tooltips, every menu row, the
fold buttons, the failures banner's Retry, Show Files and Hide Files, the empty titles ("Nothing to
Sort"), Settings' rail and rows, and the foot's "last indexed". The three lines the pass cut come out
of the build too.

## The app's own right-click menus: the verbs that change the disk · DRAWN

Drawn on the Components sheet; what exists is built, DECISIONS.md "Right-click menus". What waits,
on the undo journal (FEATURES.md "Export and undo"): a file's Move to…, Rename and Delete, and a
folder's New Folder, Move to…, Rename and Delete. New Folder lands a row already in its name field,
and on a source's row makes a folder at its top level. Move to… is the file picker, with a folder's
own descendants refused in it. A folder's Rename is the in-place field with its Taken state. Delete
asks only when the folder holds something, naming each sorting source as its own answer, with a box
that keeps the pick as the default in Settings › Sources; more sorting sources than the line holds
fold into one Move Files to…. A source's menu opens under its heading, the eyebrow in `fg-dim`. The
selection's menu, with its count and "Delete 5 Files", waits on selecting.

## Favourite places · DRAWN

Components › Places, "Favourite places": a group of their own between the app's two places and the
sources, each row a star, the name and its parent; choosing one plates both its rows. Not in the
folded rail. Favourite joins a folder's and a source's menu, reading Remove Favourite when on.

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

## Undo, on screen · DRAWN

Artboards › Undo: after an act, one line at the foot of navigation in the refusal band's slot,
saying what it did, with Undo and no timer; Ctrl+Z does the same wherever the focus is not in a
field, across a restart; "Nothing to undo." once; an undo that came back in part opens the failures
banner with Retry. Folded, the rail keeps the Undo button. The two defects below finish it.

## Undo's line is drawn for four acts of seven · DEFECT

The table under Artboards › Undo gives the line after an act and after undoing it for a file's move,
a file's delete, a rename, New Folder and a folder deleted with its files moved. It has no line for:

- a folder's Move to…
- a folder deleted with its files sent to the Trash
- an empty folder deleted
- a move that finished only in part: the failures banner opens over the grid, but the sheet does
  not say whether the foot also offers Undo for the files that did move

Nor does it say what Ctrl+Z shows while navigation is folded: "Nothing to undo." has no sentence
slot in the rail, and nothing says whether it shows at all. Recommended: add the missing rows to
the table and draw the folded rail's "Nothing to undo."

## An undo that brings nothing back, or leaves a folder behind, is not drawn · DEFECT

The banner is drawn for one case: 3 of 5 files back, the two that stayed all in one folder, under
the heading "Still in Cairo". Nothing is drawn for:

- **An undo that brought nothing back.** "0 of 1 files are back in Trips" is what the drawn banner
  would say when a rename cannot be taken back because the old name is now in use.
- **A folder that stayed.** A folder's rename, move or delete can be refused on the way back, like
  a file's. The banner's rows are files.
- **What stayed is in more than one place.** Undoing a folder deleted with its files moved to Inbox
  leaves what could not come back in Inbox and in its subfolders. The heading names one place.
- **A file that stayed in the Trash.** Each row has Show in Explorer. The Trash is the app's own
  folder, where a file is kept under a generated name; showing it there shows nothing the person can use.

Recommended: draw these four in the banner's own shape, and say what each row's button does when
the file is in the Trash.

## The Move to… picker is 16rem, on no token · DEFECT

The Pane sheet draws the picker at 16rem, and its note calls that both "menu width" and "a 16rem
menu". The Tokens sheet's new `menu` row says every menu is 14rem. Recommended: draw the picker at
`menu`, or add a named width for it to the token sheet and say why it is wider.

## A selection's menu still says a delete cannot be undone · DEFECT

Components › Right-click, under the selection's menu: "a mis-set selection is not recoverable" and
Delete "is the row that cannot be undone". Delete sends files to the Trash and undo brings them
back. Recommended: rewrite the note. It does not block: the selection's menu waits on selecting.
