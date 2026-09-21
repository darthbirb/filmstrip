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

## A folder row's menu says folders are never moved or deleted · DEFECT

The Components sheet's folder-row menu holds Rename, Reveal in Explorer and Read it again, and its note
explains the gap: "this app moves files, never folders, and deleting a folder is not something it can
do." PRODUCT.md "Folders and sources" says the opposite: "Deleting a folder asks: move what is inside to
the Sorting Box, or send it to the trash as well. An empty folder goes without asking." And every
ggallery capability comes over, which includes creating a folder, moving one and deleting one
(FEATURES.md "Folders").

Draw a folder row's menu with New folder, Move to… and Delete beside what it already holds, in the
menus' own order and case, and say where each one opens: the name field a new folder starts as, the
picker Move to… already uses for files, and the question deleting a folder with something in it asks.
Correct the note. A source's row keeps Remove source and has no Delete or Move to…, since removing is
what a source has instead.

## The keyboard's menu is drawn at one distance and described at another · DEFECT

The note puts a menu opened from the keyboard "4px clear of the 2px ring and its 2px gap", which is
8px below a tile. The markup puts it at `calc(100% + 4px)`, 4px below the tile, which lands it on the
ring's outer edge rather than clear of it. A row is drawn 4px under its edge. Neither distance is a
token, and the sheets' own rule is that nothing but the ring and the hairlines carries a pixel.

Settle one distance, measured from the ring where the anchor has one outside it, and name it from the
tokens rather than in pixels.

## Three lines still explain the app to itself · DEFECT

The last pass settled the rule: a line under a title carries a count, a name, a path or a query, or
there is no line. Three lines were drawn past it.

- **This Folder Is Empty** keeps "Nothing is in People, on disk or in the index." The Notes count the
  lines that went and the lines that stayed, and this one is in neither list, so it was not looked at.
- **Settings › Sources** gains a line under the section title that was not there before: "Three folders,
  read where they stand." with sources, and "No folders yet." without — the second directly above a
  **No Sources Yet** title that says the same thing.
- **A codec the window cannot play** keeps "The window can't open .mkv files, so this is its
  thumbnail." The format is a fact; the rest explains the picture.

Carry all three onto the rule. The Sources section also keeps its warning that removing a source drops
the tags and notes on its files. That is not a count, a name, a path or a query, so either it is the
rule's one stated exception — a warning before something that cannot be undone — or it moves to where
the removing happens. Say which, in the rule's own words.

## A zoomed picture both keeps and loses its corner and gap · DEFECT

The zoom block's last heading reads "Off fit, the picture has no corners and no gap", and the paragraph
under it says "Bigger than the media area, it fills that area exactly — the corner stays, the gap stays,
and what is cropped is cropped by the pane's own edge." The readout is placed against "the picture's
bottom-left corner", which is off screen once a picture is bigger than the area.

"Bigger than the media area" also has two directions. A panorama zoomed until it overflows sideways but
not vertically, and any picture zoomed out below fit, still show their own bottom edge inside the area.

Settle whether a zoomed picture is clipped by the media area's rounded inset or runs to the pane's edge,
and anchor the readout to something that is always on screen: the media area's corner, whatever the
picture is doing.

## The app's own right-click menus · DRAWN

Drawn on the Components sheet: a tile, a selection of five, a folder row, a source row and the pane's
picture, in sentence case with the verbs the pane's bar already uses. The menu key and Shift+F10 open
the same menus against the focused tile or row. A tree row renames in place, as Settings renames a
source. Waiting on the two defects above; a folder's rename also needs a command that does not exist.

## The way into full screen · DRAWN

At the left end of the pane's header, as `arrow-line-left`, and `arrow-line-right` to leave. In full
screen the fold button goes and nothing slides into its place.

## Labels in sentence case · DRAWN

A title is Title Case; every label on a button, a menu row or a tooltip is sentence case. The built app
already agrees except for the notices: **Retry these**, **Show the 31**, **Hide the list**.

## Empty states without their explanations · DRAWN

Nothing Chosen Yet, Nothing To Sort, Trash Is Empty and both No Sources Yet lose their lines; This File
Has Gone names the path it was at; a folder of folders and an offline source keep the count their line
carries. Waiting on the defect above for the three that were missed.

## Zoom and pan a picture in the pane · DRAWN

On the Pane sheet. The behaviour ports from ggallery as it stands. At fit nothing is on the picture;
off fit, one percentage plate, which is also the way back to fit and a tab stop only while it is there.
Plus and minus zoom about the centre from the keyboard and 0 fits; a video does not zoom; a multiple of
fit and a centre point survive a resize, a fold and full screen, and the next item starts at fit.
Waiting on the defect above.

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
