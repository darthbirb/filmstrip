# Product requirements

What Filmstrip must do to be finished, in the order it is built. How it behaves is in
PRODUCT.md, why it is built that way in DECISIONS.md, and what ggallery could do in FEATURES.md.
**Each capability here is a GitHub issue** with its acceptance criteria; the issue is where its
progress is tracked, and this document is where its place in the whole is.

## Who it is for

One person with a large personal collection of pictures and videos — tens of thousands of
files across several drives, some of which are not always plugged in — who wants to look
through it quickly and keep it in order without handing it to a service. Windows 11, a mouse
and a keyboard, any display size and text scale.

## What must always hold

- **Looking comes first.** Browsing a folder, opening a picture and stepping through its
  neighbours is instant; nothing else may slow it down.
- **The user's files are safe.** The app never overwrites, never loses a file halfway through a
  move, and every change on disk can be undone, across a restart. The one irreversible act is
  purging the trash, and it asks.
- **Folders stay real.** A folder is a directory and an item is a file under its own name;
  removing a source forgets the index and never the files (PRODUCT.md "Folders and sources").
- **Local and private.** No account, no network service, no telemetry. The release is a
  portable `Filmstrip.exe`, with the ffmpeg it uses in a `tools` folder beside it; its index,
  thumbnails and trash live in a `data` folder beside it too.
- **Scale.** A library of 100,000 items and a folder of 40,000 stay smooth: the grid scrolls at
  the display's frame rate and a folder opens in well under a second once indexed.
- **Offline sources degrade, never break.** A drive that is away keeps its folders, tags and
  labels visible and editable; only what needs the files waits for it.
- **Accessible.** Every action is reachable by keyboard, focus is always visible, text meets
  WCAG AA contrast, and the interface holds at 200% text size.
- **One design system.** Every surface is drawn first and built from the token sheet
  (DECISIONS.md "The scale is the arbiter").

## Milestones

Built in this order. A milestone is done when every issue in it is closed; the release that
closes it is tagged. Capabilities already built are in FEATURES.md and not repeated here.

### M1 · Finish browsing

The everyday loop, complete: a folder's details, a file's tags, video that plays like video,
and the small verbs ggallery had.

- A folder's details in a band under the grid's header (#51)
- Tagging a file in the pane, with the folder band's tag control (#54)
- The video plate: one glyph size from the scale, and the time as the plate narrows (#55)
- Scrubbing a video's tile, with scrub frames from ffmpeg (#56)
- Sorting a place by capture date, date added, size or length, either way, and a random order that holds (#57)
- Copy an item's path (#58)
- The counts the foot and the Sorting Box need: unsorted, trashed, totals (#59)

### M2 · Tags at scale

- What a selection's tags cover, and tagging a whole selection at once (#60)
- The tags screen: the vocabulary with counts; rename, merge and delete a tag (#61)
- Every item under a folder, for acting on a branch at once (#62)

### M3 · Files in and out

- Paste files in, and take a drop from Explorer, into a folder or the Sorting Box (#63)
- Export a folder's branch or a selection as a zip, as a background job, keeping the files'
  own names or naming them from their folders (#64)
- Backups of the index, kept beside it and restorable (#65)

### M4 · The pane, fuller

- Several items at once, scaled together, by dragging them onto the pane (#66)
- A folder shown in the pane: its cover, counts and details (#67)
- Frame steps and a named set of speeds on the video plate (#68)

### M5 · The trash, finished

- Limits on the trash's total size, per-item size and time to live, set in Settings (#70)
- What happens when an item expires — **decided: the Windows Recycle Bin** (#69)
- Purging the trash, the one irreversible act (#70)

### M6 · Self-contained

- ffmpeg bundled, so video thumbnails, probing and scrub frames need nothing installed (#71)
- A scrubber for very large folders, only if folders of 40,000 still feel slow to cross after M1 (#72)

### M7 · Later

Built on the finished interface (PRODUCT.md "Later"), each specified in its own issue when M6
closes: compression with review before anything is replaced, duplicate detection, a storage
screen, a blur toggle, and HandBrake bundled for compression.

## Out of scope

Decided against; reopening one is a decision for the owner, recorded in DECISIONS.md.

- Any network service, sync, sharing, accounts or downloads from the web
- First-import review and moving folders into a library: folders are read where they stand
- Tiled compare and multi-view panes: the pane has one mode
- Folder-name parsing, folder templates, and user-defined folder statuses
- Collections and albums; star ratings and colour labels — favourite is binary
- Hidden or PIN-protected folders; face recognition
- A masonry grid

## Open questions

Each is an issue labelled `needs-human` until the owner answers it, and the answer is written
here and in DECISIONS.md.

- Does compression replace originals in place once approved, or keep them in the trash?
