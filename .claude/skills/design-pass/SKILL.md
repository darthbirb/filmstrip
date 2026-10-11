---
name: design-pass
description: Draw what Filmstrip's design backlog asks for on a Claude Design canvas and bring the sheets back into docs/design, with no hand-off to the owner. Use when issues are labelled design, when docs/design/BACKLOG.md has entries not yet drawn, or when asked to draw or redraw a surface.
---

# A design pass

**The sheets in `docs/design/` are the source of truth.** A canvas is where they are drawn and
where the owner can look and comment; what is committed here is what gets built.

## The brief

`docs/design/BACKLOG.md`. Entries marked **DEFECT** first, then the rest in order. An entry not
marked **DRAWN** is to be drawn; an issue labelled `design` names its entry. Read
`docs/DESIGN.md` and `docs/DECISIONS.md` "The look" before drawing anything: every value comes
from the token sheet, and a value the sheet lacks is added there first.

## The canvas

The canvas's link is in `docs/design/README.md`. None yet: create one from the Design artifact
type (Artifact tool, `quickstart` with intent `design`), titled "Filmstrip", and write its link
into the README in the same commit as the sheets. Follow the Design type's own instructions for
every file it holds.

1. Make sure the canvas holds the committed sheets: for each `docs/design/<sheet>.dc.html`, the
   canvas file `project/<sheet>.dc.html`, byte for byte. Upload any that differ; the repository
   wins.
2. Draw on the sheet the subject already lives on, never a new file: update in place.
3. Read every changed sheet back from the canvas and copy it over `docs/design/<sheet>.dc.html`.
   A comment the owner left on the canvas is part of the brief.

## Close the loop

- Mark each drawn entry **DRAWN** in the backlog, and move its issue from `design` to `ready`.
- One commit per pass, `docs(design): …`, in its own pull request through the usual review.
  The reviewer checks it against the backlog entries and the token sheet.
- A new visual direction, rather than a surface drawn in the existing one, is the owner's call:
  label the pull request `needs-human`.
