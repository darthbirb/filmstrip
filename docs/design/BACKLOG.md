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

## Adding a source · DRAWN

The app cannot be used at all: `add_source` and `remove_source` exist in Rust and are tested, but
nothing in the interface calls either, so a real library can never be pointed at. Navigation's
no-sources state is a bare line of text where the components sheet draws the doorway properly —
a glyph, "No sources yet.", "Add a folder and Filmstrip will read it where it stands." and an
**Add a folder…** button.

Build the drawn empty state as it stands. What is undrawn, and what this entry asks for:

- **What Add a folder… opens.** Presumably the system's own folder picker, which needs a plugin the
  app does not have yet. Say whether it is that or something of the app's own.
- **How a source's kind is chosen.** `SourceKind` is `library` or `sorting`, and DECISIONS.md
  "Places, not queries" says the Sorting Box is "several real folders the user nominates" — so
  nominating one has to be possible somewhere, and nothing draws where.
- **Where sources are managed afterwards.** Settings has one section, Appearance. Removing a source,
  renaming it, and seeing that one is offline all have nowhere to happen.

## Right-click is the browser's menu · DRAWN

Right-clicking anywhere offers Edge's own menu — print, copy link to highlight, and the rest — which
says plainly that this is a web page. Suppressing it is a fix and needs no drawing, but it leaves
the question of what should be there instead.

Draw whether the app has a context menu at all and, if so, on what: a tile, a tree row, the pane's
picture. The action menu is already built in `src/ui/Menu.tsx` and the pane's action bar already
names what the app can do to a file, so the shape exists; what is undrawn is which of those actions
a right-click offers, and what a right-click on a *selection* of several tiles offers instead.

## The refusal band and the indexing line want the same slot · DEFECT

A refusal is drawn at the foot of navigation, "in the slot the indexing line uses". The indexing
line lives there too, and both can be live at once: a walk from a source added earlier is still
running when a second folder is refused. Nothing says what happens then — whether the band takes
the slot and the line waits, whether they stack, or whether the foot grows to hold both.

Draw the two together. The same question applies at the foot of Settings › Sources, where the band
is drawn a second time.

## Two stand-in cards disagree with the empty places on their own sheet · DEFECT

The component sheet draws the same two states twice and words them differently. Under "Standing in
for something" they read **No pictures here.** and **Archive is not reachable.**; in the empty
places block they read **No Pictures Here** and **Archive Is Offline**, which is what `EmptyPlace.tsx`
has built. It is the fault that was fixed for the no-sources state, still present on two more cards.

Carry the empty places block's wording onto both cards, so one sheet says one thing.

## A glyph in the folder's band is at a size the scale does not name · DEFECT

The "Set a cover" affordance in the folder band draws its glyph at 1.25rem. The scale names four
glyph sizes — 0.75, 0.9375, 1.125 and 2rem — and 1.25 is not one of them. It is the last glyph in
the set that is off the scale, and the band is the next surface to be built.

Move it onto a size the scale names.

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
