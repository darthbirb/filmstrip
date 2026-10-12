---
name: design-pass
description: Draw what Filmstrip's design backlog asks for, directly in the sheets in docs/design, with no hand-off to the owner. Use when issues are labelled design, when docs/design/BACKLOG.md has entries not yet drawn, or when asked to draw or redraw a surface.
---

# A design pass

**The sheets in `docs/design/` are the source of truth**, and a session draws in them directly:
each is one HTML page of `<x-dc>` markup that `support.js` renders. Nothing is drawn anywhere
that is not committed here.

## The brief

`docs/design/BACKLOG.md`. Entries marked **DEFECT** first, then the rest in order. An entry not
marked **DRAWN** is to be drawn; an issue labelled `design` names its entry, or adds one. Before
drawing, read `docs/DESIGN.md`, `docs/DECISIONS.md` "The look" and "The scale is the arbiter",
and the sheet the subject lives on.

## Drawing

1. Draw on the sheet the subject already lives on, beside the surfaces it belongs with; never a
   new file. Keep the sheet's own structure: its artboards, their labels, their notes.
2. Every value comes from the token sheet (`tokens.dc.html`). A value it lacks is added there
   first, with the surfaces that use it, and to `src/styles/app.css` and `docs/DESIGN.md` when
   the feature is built.
3. Draw every state the feature has, not only the resting one: empty, one, many, offline, a
   long name, focus, hover, disabled, an error, and the narrowest width.
4. Look at it: serve the folder (`npx --yes pnpm@12.4.1 exec vite docs/design --port 1423`) and
   screenshot the changed artboards with the Playwright MCP. Fix what does not read before
   committing. Stop the server after.

## Close the loop

- Never draw for an issue labelled `blocked`. Label each issue the pass takes `in-progress` as
  it starts, so no other pass or build picks it up.
- Mark each drawn entry **DRAWN** in the backlog. Leave the issue's `design` label: it moves to
  `ready` when the pass merges (the `queue` skill, step 6), never before.
- One pull request per pass, titled `docs(design): …`, through the usual review; the reviewer
  holds it to the backlog entries and the token sheet. It names a feature it drew with
  `Refs #n`, never `Closes #n`, so the feature stays open to be built; only an issue that asks
  for drawing alone is closed by it.
- A new visual direction, rather than a surface drawn in the existing one, is the owner's call:
  label the pull request `needs-human`.
- A Claude Design canvas may be used to draw or to show the owner, if one is to hand; what is
  committed is still the sheet in this folder.
