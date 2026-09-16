# Design backlog

What the next Claude Design pass should draw. Each entry is one issue and the fix recommended
for it; once the fix is drawn and built, the entry is deleted. An entry marked **DRAWN** has
been through a pass already and is waiting to be built, so it does not need drawing again.

"The old drawing" is `old-ggallery-design.html` in this folder. Where an entry borrows from it,
take its structure and behaviour, and fit its values to the current token sheet: Plex, Phosphor,
the red focus ring, the white in-pane mark.

Always update the existing sheets in place. A new drawing belongs on the sheet its subject
already lives on, never in a file of its own.

## The pane: black bars around the picture · DRAWN

When a picture's shape differs from the pane's, the dark well shows above and below it, or on
either side, as black bars. They read as letterboxing rather than as part of the pane.

Let the picture sit straight on the panel, with its own rounded corners, so the space around it
is the pane itself rather than a darker box. Investigate whether the well should instead hug the
picture's shape.

## The pane: an action bar, and its own video controls · DRAWN

The pane has no actions. The old drawing had a bar under the picture: favourite and Move To… on
the left; Reveal In Explorer, Copy, Open With The Default App, Delete (in the red tint) and a ⋯
menu on the right. Videos also play with the window's native controls, which match nothing else
in the app.

Port the old drawing's pane nearly as it is (its "The pane · features/pane/" frames, and the
pane in "The main screen"): the 44px action bar under the picture, and its video controls, with
play and pause, a frame back and forward, a progress track, the time, mute and speed. Draw every
action; each button is built when the action behind it exists.

## Full-screen pane · DRAWN

There is no way to look at one picture with nothing else on screen.

A full-screen mode: the pane takes the whole window below the bar, with no navigation and no
grid, keeping its header, picture, action bar and filmstrip. One control in the pane's header
enters and leaves it, and Escape leaves; it works whether the pane is docked, folded or hidden.
The old drawing's "Full-window — the pane maximised" frame is the starting point. How it enters
and leaves belongs with "Motion" below.

## A folder's details · DRAWN

The grid's header says only where you are. A folder has more to know, and nowhere to show it:
how many items it holds, its labels and tags, and, in the schema already, a status, a favourite
flag, a note and a cover.

Make the grid's header a disclosure, as the pane's header is, taking the old drawing's folder
band: a chevron, the folder's title and its counts, then the header's own controls. Opened, it
drops a band with the cover beside rows for Path, Status, Labels, Tags and Note, in the same
rhythm as the pane's details. The Sorting Box and the Trash keep a plain header with no
disclosure.

## Counts in navigation · DRAWN

Only the Sorting Box shows a count, as plain text, though every folder knows how many items it
holds.

Every row with items carries its count in a small pill at its end, as the old drawing's top rows
do: 20px tall, the badge corner, raised on a hairline ring; on the selected plate, a dark wash
with on-plate ink. A folder counts its own items, not the ones below it.

## Motion · DRAWN

Navigation and the pane snap open and shut, the pane's details only fade in, and full screen
will need a way in and out.

Specify all of it, starting from the old drawing: a panel folds as one width change over 180ms
while its content cross-fades over 220ms, so it reads as the panel narrowing rather than two
panels swapping; the details push down over the same 180ms; full screen grows out of the pane.
Under reduced motion all of it is instant. Add the tokens it needs, as the old drawing's
motion/size and motion/swap.

## Scrubbing a video's tile · DRAWN

A video's tile shows one frame. In ggallery, running the pointer across a video's tile scrubbed
through it, left to right.

Moving the pointer across a video's tile shows the frame at that point in the clip. Draw what
shows while it scrubs, a thin position line along the tile's foot and the time under the pointer
in the length plate, and what a video with no scrub frames shows, since they need ffmpeg.

## Indexing progress and failures · DRAWN

Nothing on screen says the library is being read, or that files failed to be. The app already
tracks both, and can retry the failures.

Place the old drawing's two answers. A progress line at the foot of navigation, "Indexing
4,120… 62%", growing above a footer that never moves. And the banners above the grid: "31 files
could not be indexed" with Retry These and Show The 31, opening onto the failure list, and the
notice for a missing ffmpeg.

## Folded navigation still goes places · DRAWN

Folded, navigation leaves a rail holding only its unfold button.

As in the old drawing, the folded rail keeps the app's own places, the Sorting Box and the
Trash, as glyph buttons carrying their count pills, so a folded panel still gets you there.

## A scrubber for the grid · DRAWN

A large folder scrolls with a thin scrollbar, and reaching the middle of forty thousand pictures
is slow.

Consider the old drawing's scrubber: a 16px channel at the grid's edge with a square thumb, held
to jump anywhere; the position is the information. Investigate whether it replaces the
scrollbar or sits beside it. The pass that drew it recommends building the other ten first, and
only building this if the largest folders still feel unnavigable afterwards.

## Large numbers are drawn with a gap, and should have a comma

The count pills, the panel's footer and the indexing line all write four figures as "41 236",
grouped with a space. Windows writes that number "41,236", and so should the app.

Group every number in the drawings with a comma. The build already writes them the way the
machine does, which is the comma here, so this is the sheets catching up.

## The pane's state with no capture date kept the well

Entry 01 took the well out of the pane, and its block says the well is gone from every state on
the sheet. The state drawn for a file with no capture date still puts its picture in a `#0e0e0e`
box, at the old `0.25` inset rather than the new `0.5`.

Redraw that one state like the other eight: the picture on the panel, at the same inset.

## The empty states draw two glyph sizes the scale does not have

The six empty places are drawn with a `2.5rem` glyph, and the block says the shape of
`EmptyState.tsx` does not change — but that shape uses `glyph-large`, which the token sheet sets
at `2rem`, and the pane's own two empty states are drawn at `2rem`. The folder buttons under
"No Pictures Here" have the same trouble one size down: their folder glyph is `0.875rem`, where
the glyph scale names only `0.75`, `0.9375` and `1.125rem`. Both were built at the nearest named
size.

Either draw both at sizes the scale already names, or add the sizes to the token sheet with
names and say which surfaces use them.

## The pane's two empty states break the rule the components sheet states

The empty-places block settles the voice outright: Title Case on the title, an ordinary sentence
underneath. The pane sheet's own two empty states do not follow it — "Click a picture to see it
here." and "This file is no longer here." are sentences in the title's place. The built app
follows each sheet as drawn, so it now speaks both ways.

Redraw the pane's two titles in Title Case, so the one shape has one voice.

## The motion entry left no tokens behind

The Notes sheet says the Tokens sheet gained `size` and `swap` rows for the motion entry. The
Tokens sheet is unchanged: it still names only `quick` at 120ms and `reveal` at 180ms, and
defines `reveal` as the pane's details dropping in. The artboards then use 180ms for a panel
folding and for the folder band opening, and no drawing uses the 220ms cross-fade the entry
asked for.

Name, in the token sheet, the durations a panel's fold and the folder band actually use, and say
whether one duration covers the details, the fold and the band, or the fold takes its own.

## A button with nothing behind it, and a wrong cross-reference

Two smaller things in the same pass. The missing-ffmpeg banner carries a "How To Install It"
button, though the app cannot install ffmpeg or point anywhere that explains it, which breaks
the sheets' own rule that nothing is drawn with nothing behind it. And the folded rail's block
cites "the overlay from 06", where 06 is the motion entry, not the panel overlay.

Decide what the ffmpeg button does, or draw the banner without it; and point the rail's note at
the folded-panel overlay the frame already has.
