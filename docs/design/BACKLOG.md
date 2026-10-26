# Design backlog

What the next Claude Design pass should draw. Each entry is one issue and the fix recommended
for it; once the fix is drawn and built, the entry is deleted. An entry marked **DRAWN** has
been through a pass already and is waiting to be built, so it does not need drawing again.

An entry marked **DEFECT** is a fault in what a pass drew — a contradiction between two sheets, a
drawing that disagrees with what is already built, or a state that was never drawn at all. Defects
are drawn before anything else and nothing is built from a sheet that carries one: a surface built
from an incomplete drawing is built twice.

"The old drawing" is `ggallery-drawing.html` in this folder. Where an entry borrows from it,
take its structure and behaviour, and fit its values to the current token sheet: Plex, Phosphor,
the red focus ring, the white in-pane mark.

Always update the existing sheets in place. A new drawing belongs on the sheet its subject
already lives on, never in a file of its own.

## The grid's ground in Components › Right-click · DEFECT

Components › Right-click, under "Where there is no menu, nothing opens", still says the grid's
bare ground offers no menu of its own, while Artboards › Bringing files in draws the place's menu
on it, with Paste, and the app builds that. The artboard wins: take the grid's bare ground out of
that sentence, and draw the ground's menu there beside the rows' as the place's own, under its
name.

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

## Frame steps, speeds and the volume on the video plate · DRAWN

The plate replaced the window's controls with play, the track, the time and the mute (#68). It
still needs a frame back and forward, a fixed set of speeds, a way to set the volume, and keys.

Drawn in Pane › 02, the column beside "A video", in the built plate's own values:

- Seven controls: play, the two frame steps, the track, the time, the mute, then the speed's
  figure. As the plate narrows the speed goes first, then both steps together, then the total,
  then the mute; play, the track and the elapsed never leave. Measured, never a width: the
  drawing's rows are at 200, 170, 130 and 100px.
- A step is one frame at the length the probe reads, and pauses first if the clip is playing. At
  the first frame the back step is `fg-faint` and does nothing; at the last, the forward one. A
  file with no frame rate has no steps.
- The speeds are 0.5×, 1×, 1.5× and 2×, in a dropdown's list opening upward from the figure, its
  right edge on the plate's. The figure is `fg-mid` at 1× and `in-pane` off it. The speed holds
  from video to video until the app closes and is 1× at launch.
- The volume rises over the mute under the pointer, in the speed list's surface and height. A
  click on the glyph still mutes; a click, drag or wheel on the column sets the level and
  unmutes; Up and Down on the focused mute move it a tenth. Volume and mute are saved
  preferences.
- Keys, while the focus is on the video or in its plate: `,` and `.` step, `<` and `>` change the
  speed without wrapping, Space plays and pauses, `M` mutes. The video takes the focus as a
  zoomable picture does.
