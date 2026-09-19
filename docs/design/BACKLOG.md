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

## The app's own right-click menus · DRAWN

The browser's menu is now suppressed everywhere but in a field, as the drawing says, so right-clicking
a tile or a row opens nothing. The app's own five menus are drawn and wait on the three defects below.

## The right-click menus and the pane's bar name the open verb differently · DEFECT

The menus' own rule is that every row is already a button in the pane's bar or a row in its ⋯, in the
same order. The two sheets disagree on the words. Components draws **Open With…** and **Reveal In
Explorer**; the Pane sheet draws the bar's button and ⋯ row as **Open with the default app** and
**Reveal in Explorer**, which is what is built. It is two differences, and both carry weight: an
ellipsis promises a chooser, where the built verb opens the default app with no question asked, and the
same `Menu.tsx` draws both menus, in two different cases.

Settle one verb and one case, and carry them on both sheets.

## Rename on a tree row has nowhere to happen · DEFECT

The folder row's menu and the source row's menu both offer **Rename**. Every other rename is drawn: a
tile's goes to the pane's Name row, and Settings renames a source by making its name a field where it
stands. Nothing draws a tree row being renamed — whether the row itself becomes a field, whether it
sends the person to Settings, or something else.

Draw a tree row being renamed.

## A menu opened from the keyboard is undrawn · DEFECT

The Notes list "what the menu key and Shift+F10 open" as open, and the right-click block never mentions
the keyboard. With the browser's menu suppressed, those two keys now open nothing at all, so a person
without a pointer has no way to any of the five menus.

Draw where a keyboard-opened menu lands against the focused tile or row.

## The way into full screen sits on the wrong side of the pane's header · DEFECT

The pane's header draws the full-screen button beside the button that folds the pane away, at the
header's right-hand end, so the two controls that do very different things sit together and the one
that grows the pane points nowhere in particular.

Draw the way into full screen on the opposite side of the header from the fold, and as an arrow that
says which way it goes. Say what it becomes in full screen, where there is nothing left to fold. The
old drawing has no such control to borrow from, so this one is drawn from scratch.

## A button's label is drawn in two cases at once · DEFECT

The Components sheet's own note settles the empty states on Title Case, "the same case the buttons
use". The button it draws under that note reads **Add a folder…**, and so does the one on the Pane
sheet. One of the two is wrong, and every text button in the app takes the answer: the doorways, the
notices' **Retry These** and **Show The 12**, and the folder buttons a folder of folders offers.

Settle the case for a button's label, say it in the sheet's own words, and redraw every button that
disagrees with it. The tooltip a glyph button carries is the same question.

## The line under an empty title explains the app to itself · DEFECT

Every empty state is drawn as a title and a sentence under it, and the sentences read as placeholder
copy: "Add a folder and Filmstrip will read it where it stands.", "Click a picture and it shows here,
and stays while you look elsewhere.", "Everything that came in has been filed. New files land here as
they are found.", "Deleted files wait here until you empty it, and can be put back.", "It was moved or
deleted outside the app, so there is nothing left to show." Settings carries the same voice in "Added
here, a folder is a library source."

None of them says anything the title and the button beside it do not. Draw the empty states without
explaining the app: the title, the one move worth offering, and a line only where it carries a fact
the person cannot see — a count, a name, a path. Where a line has nothing to add, draw none. This
is a rule for every sentence the app shows, not only the six here.

## Zoom and pan a picture in the pane

ggallery zoomed pictures in the pane and Filmstrip does not, which was an oversight rather than a
decision. The behaviour ports as it stands, verified against ggallery's own interaction code:

- The wheel zooms about the point under the pointer, starting from the scale the fitted picture is
  already drawn at, so the first notch out of fit does not jump.
- A notch is ×1.12 in or ×0.89 out, held between 0.1× and 12×.
- Dragging pans.
- Double-click returns to fit, and so does showing another item.
- Off fit, one small percentage readout appears, which is also the way back to fit; at fit there is
  no zoom furniture at all.

What is not drawn, and has to be:

- where the readout sits, at the pane's own width and in full screen, and what it looks like over a
  photograph
- the pointer: whether it says a picture can be dragged, and whether that changes while it is held
- whether the keyboard can zoom, and what returns to fit without a pointer
- whether a video zooms too, or only a picture
- what a zoomed picture does when the pane is resized, folded, or the item changes

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
