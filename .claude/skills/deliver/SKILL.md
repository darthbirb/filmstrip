---
name: deliver
description: Build one Filmstrip issue up to an open pull request — pick it, port and build it, verify it, self-review it, and open the pull request; or address the latest review on one. Review and merging are the queue skill's. Use when asked to work the next issue or a named issue, and inside the queue skill's builder subagents.
---

# Deliver an issue

The queue is GitHub issues on `darthbirb/filmstrip`. Everything a session needs to resume lives
there and in the pull requests: never keep progress only in the conversation.

## 1. Ready the workspace

- `git fetch --prune origin`, then work from `origin/main`. GitHub is reached with the `gh` CLI.
- ggallery sits at `../ggallery`. It is a reference: never edit, install or run anything in it.
- `git status` clean before switching branches; work in a dirty checkout is someone else's, so
  stop and say so.
- Run on its own, open pull requests come first (`gh pr list --author @me`): one that is red,
  conflicted or has review findings is finished before new work.

## 2. Pick the issue

Asked for a number: take it. Otherwise the open issue labelled `ready` and none of
`in-progress`, `blocked` or `needs-human`, in the earliest milestone, lowest number first.
Label it `in-progress` (`gh issue edit <n> --add-label in-progress`). Nothing `ready`: stop and say so; if issues wait on `design`, run the
`design-pass` skill instead.

## 3. Understand it

Read the issue, its section of `docs/PRD.md`, its sheet in `docs/design/`, every
`docs/DECISIONS.md` section the touched code cites, and the ggallery modules it names
(`docs/DEVELOPMENT.md` "Porting from ggallery"). Plan the change before writing it; anything in
`src-tauri/` that moves the user's files gets its plan written into the pull request.

## 4. Build it

- A branch `type/topic` from `origin/main`.
- Rust before the interface that uses it. A bug fix starts with the test that reproduces it; a
  change in behaviour lands with a test that fails without it.
- Commits in Conventional Commits form, each one passing the gates on its own.
- Update `docs/FEATURES.md`, and `docs/DESIGN.md` for any new shape, in the same branch.

## 5. Verify it

Every gate in `AGENTS.md` "Commands", all green. Then look at it: the dev server on 1422 and the
Playwright MCP, at several widths, against the sheet it was drawn on; and for anything the mock
cannot show, the real window (`docs/DEVELOPMENT.md` "Seeing the app"). Screenshots are evidence
for you, never a substitute for the gates.

## 6. Review it

1. Self-review with the `review` skill against `origin/main...HEAD`; fix what it finds.
2. Push, and open the pull request: the title is the squash commit's subject, the body follows
   `.github/pull_request_template.md` and says `Closes #n`.
3. Stop there and return the pull request number and its head commit. The independent review,
   the fix rounds and the merge are the `queue` skill's, steps 4 to 6; a session working one
   issue on its own follows them for its pull request.

## 7. Address a review

Asked to address the latest review on a pull request: check out its branch, fix every blocking
and should-fix finding and the nits that are plainly right, each fix with the test that fails
without it; run every gate, push, and return the new head commit. A finding you judge wrong is
answered in one comment on the pull request with the evidence, not silently skipped. A red
check is root-caused and fixed the same way, never skipped.

## When the owner decides

Label the pull request `needs-human`, say in one comment exactly what is being asked, and
return; the queue goes on to the next issue. Only for: a change that deletes or moves the user's files in a way the
app did not before, a migration that rewrites existing data, a new visual direction the sheets
do not settle, or a requirement the PRD contradicts or leaves open. Everything else decides
itself by the PRD, the sheets and `DECISIONS.md`.

## Keeping the queue going

The `queue` skill runs this skill in a fresh subagent per issue until the queue is empty. Usage
limits pause a run, not the work: the next one resumes from the issues and pull requests.
