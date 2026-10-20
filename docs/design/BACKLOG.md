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

## A removed source's trashed files · DRAWN

Removing a source forgets its rows, the trashed ones too, and leaves their files in `data\trash`
where nothing shows, restores or expires them (#110). A restore that drops a trashed row, from
a source added since or any place the backup cannot find, leaves the same.

By DECISIONS.md "Expiry goes to the Recycle Bin", they go to the Windows Recycle Bin. Draw the
remove question in Settings › Sources saying so with a count, and the restore question when the
backup forgets a source. Where the Recycle Bin cannot take a file, the file stays in the Trash
and the app says where, as #70 has it for expiry. Draw none trashed, some, a refused file and an
offline source.

Drawn in Artboards › Sources, "What removing does with its trashed files", and beside the
restore's question in Artboards › Backing up the index:

- The question adds "Its 2 files in the Trash go to the Recycle Bin." ("Its 1 file … goes"),
  counting the source's trashed rows, offline or not. With none it is unchanged.
- Remove Source sends each file, its row going with it, under the restore's line and bar
  ("Removing Pictures…", the share sent), Settings holding still; then the source goes.
- A file the Recycle Bin cannot take is never sent: it stays in the Trash under its row, and
  the rest are still sent. With any refused the source is not removed, and the section's band
  counts them all: "Pictures was not removed. The Recycle Bin could not take 1 of its files, so
  it stays in the Trash." over `D:\Filmstrip\data\trash`.
- Every trashed row the restore would drop has its file sent, not only a source added since:
  any whose place the backup cannot find by its source's root (`place` in
  `src-tauri/src/db/backup.rs`). The question adds "Archive was added since, so it is forgotten,
  and its 3 files in the Trash go to the Recycle Bin.", naming several in a list with one count
  that takes in every row it drops.
- The files go after the check and the hold, before the "before restore" backup, under the
  restore's own line, the bar's share covering them with the other steps. The restore carries on
  past a refusal as a remove does; with any refused it stops before that backup, nothing
  swapped, with the band "The index was not restored. The Recycle Bin could not take 2 of
  Archive's 3 files in the Trash, so they stay there."
- The sends stand if the backup or the swap fails after them. The failure line adds what went:
  "The index could not be restored. The disk is full. Archive's 3 files in the Trash went to the
  Recycle Bin; the index is otherwise as it was." When this is built, DECISIONS.md "Backing up
  the index", which says a restore that fails part way leaves the index as it was, and the
  failure message in `src/app/settings/Backups.tsx` change with it.

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

## Several files in the pane · DRAWN

Dragging files onto the pane adds them to what it shows, scaled together so all are in sight
(#66, PRODUCT.md "The three panels").

Drawn in Pane › several:

- One scale for all, the scale the zoom plate reads: each file at its own shape against its own
  pixels. The pane tries every split of the files, in the order added, into rows and keeps the
  one drawing them largest, ties to fewer rows; rows centred, each file on its row's middle line,
  `tile-gap` apart. Recomputed for any change of room.
- The header reads "3 Files · 6.9 MB" and is not a disclosure. The bar goes. The strip stays on
  the first file's place; every file shown wears the in-pane mark on its tile and frame.
- A tile or a set dragged onto the pane: the whole pane wears the accepting row's 2px pewter ring
  and the ghost reads "Add 2 files to the pane", or "Show 2 files in the pane" over an empty pane
  or a folder, which they replace. Files join at the end. Explorer's files are not taken.
- `pane-set` is 12 on the token sheet until measured. Past it, what fits is added in the order
  carried ("Add 2 of 5 files to the pane"), then the line "Added 2 of 5 files to the pane. It
  shows 12 at most." with no Undo. Full: "The pane shows 12 at most", refused. A file already
  shown is not added or counted; all of them: "Already in the pane".
- Videos loop from the start, muted, each with a mute plate at its bottom-left; unmuting one
  mutes the one that had the sound, and the saved mute is not changed.
- Under the pointer or focus a file shows × (Remove from Pane) at its top-right. The set is one
  tab stop: arrows move between files in reading order, Enter shows one alone, Tab reaches its ×;
  removal passes the focus to the next, or the one before.
- A click on any file, in the grid, the strip or the pane, shows it alone. Escape shows the first
  alone, after leaving full screen if in it. A file deleted, moved away or gone leaves the set.
  A folded pane takes no drop.

## A folder in the pane · DRAWN

A folder can be shown in the pane rather than a file: its cover, counts and details (#67).

Drawn in Pane › folder, and as the first row of every folder and source menu in Components ›
Right-click and Artboards › Bringing files in:

- Show in Pane heads a folder's, a source's and a folder card's menu. The header carries the
  folder's name, ending in an ellipsis, and its count pill, which never leaves; offline, the word
  `offline`.
- The cover stands in the picture's place at its own shape, the band's cover rule and pencil
  with it, and does not zoom. The details are the band's rows, one component in both places,
  behind the pane's own disclosure and its saved preference.
- The bar: Open Cairo, the one worded button, which never leaves and goes into the folder; Show
  in Explorer, which folds into the ⋯; the ⋯ holding the folder's menu without Show in Pane.
  Rename opens the folder's tree row; once the folder is deleted the pane shows nothing.
- The strip runs through the folder's own files, none ringed; a frame or the forward step shows
  that file with the folder as its place. No own files, no strip.
- Offline: the grid's offline empty state in the picture's place, no strip, no Show in Explorer,
  and the ⋯ keeps the offline row's three. Empty: "This Folder Is Empty". Gone outside the app:
  "This Folder Has Gone" over its path, the fold alone in the header and no bar.
