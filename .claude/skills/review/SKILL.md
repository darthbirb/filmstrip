---
name: review
description: Review a Filmstrip pull request, or the current branch's diff against main, to this repository's bar — correctness, tests, the design system, code quality, docs and scope — and return a verdict of pass or fail. Use before opening a pull request (self-review) and as the independent reviewer agent's checklist.
---

# Review

The bar is **excellent, not acceptable**. A pull request passes when a careful senior engineer
who owns this codebase would merge it without a follow-up. Anything they would ask to change
first is a finding.

## Gather

1. The change: `gh pr view <n>` and `gh pr diff <n>` for a pull request, with the issue it
   closes (`gh issue view`), or `git diff origin/main...HEAD` for a branch.
2. What it was meant to do: the linked issue's outcome and acceptance criteria, and the section
   of `docs/PRD.md` it implements.
3. The context of every changed hunk: read whole functions and their callers, not just the diff.
4. The rules it must keep: `AGENTS.md`, every `DECISIONS.md` section the touched code cites,
   `docs/DESIGN.md` for anything visible, `docs/SCHEMA.md` for anything stored.
5. For a port, the ggallery original at `../ggallery`, side by side.

## Check

Work through every heading. A finding names the file and line, what is wrong, a concrete case
that shows it, and the fix.

**Does what it says.** Every acceptance criterion is met, and a test proves each one. Walk the
edge cases the feature invites: an empty place, one item, forty thousand items, an offline
source, a name with Unicode or a reserved character, a long path, a second click before the
first finished, the window at its narrowest.

**Keeps the user's files safe.** Anything in `src-tauri/` that moves, renames, deletes or
writes a file: is it journalled for undo, does it refuse rather than overwrite, does a failure
halfway leave the original whole, does it work across drives? A migration: does it run on a
populated library, and is it tested on one?

**Tested properly.** A change in behaviour has a test that fails without it. Tests assert what
a person sees or what the data holds, not implementation details. Visual checks sweep more than
one size. No fixed sleeps, no skipped or loosened tests, no snapshot written to pass.

**Built from the design system.** No number a token does not supply; colours, sizes and
durations come from `src/styles/app.css`. A new shape is added to `docs/DESIGN.md`. What is on
screen matches its sheet in `docs/design/`. Real buttons, labels and roles; the keyboard
reaches everything; focus is visible and lands somewhere sensible.

**Clean code.** Names say what things are. No dead code, no duplicated logic, no speculative
options. Functions do one thing. Types are precise; no `any`, no `unwrap` outside tests. The
command boundary holds: a wrapper in `src/ipc/commands.ts`, registration in `lib.rs`, an answer
in the dev mock, bindings regenerated.

**Fast enough.** Nothing per item crosses IPC in a loop; nothing quadratic over a folder's
items; long work runs as a job, never on the UI thread.

**Docs true.** `docs/FEATURES.md` shows the new state. Why it is built this way is in
`DECISIONS.md` when it is not obvious; comments are three lines at most and cite headings that
exist.

**One outcome.** Nothing unrelated rides along. A new dependency is named in the description
with its reason.

## Verify before reporting

Run the gates that bear on a finding (`AGENTS.md` "Commands") or reproduce it in the browser.
Drop any finding you cannot show. Do not report style that the linters already own.

## Report

Rank findings **blocking** (wrong, unsafe, untested, or off the design system), **should fix**
(the owner would ask for it before merging), **nit** (optional). The verdict is **pass** only
with no blocking and no should-fix findings.

Return the review body in this shape; the last line is the verdict the Review status follows:

```markdown
**Verdict: pass** — one line on what was checked.

### Blocking
- `path:line` — finding, the case that shows it, the fix.

### Should fix
- …

### Nits
- …

<!-- review: pass -->
```

Omit empty sections. For a fail, the last line is `<!-- review: fail -->`.
