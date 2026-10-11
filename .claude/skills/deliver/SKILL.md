---
name: deliver
description: Take one Filmstrip issue from the queue to merged — pick it, port and build it, verify it, open the pull request, get it independently reviewed, and drive it to an automatic merge. Use when asked to work the next issue, a named issue, or to keep working the queue; scripts/agent.ps1 starts every session here.
---

# Deliver an issue

The queue is GitHub issues on `darthbirb/filmstrip`. Everything a session needs to resume lives
there and in the pull requests: never keep progress only in the conversation.

## 1. Ready the workspace

- `git fetch --prune origin`, then work from `origin/main`. GitHub is reached with the `gh` CLI.
- ggallery sits at `../ggallery`. It is a reference: never edit, install or run anything in it.
- Open pull requests come first (`gh pr list --author @me`). If one is red, conflicted or has
  review findings, finish it before taking new work.

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
3. Independent review: run the `reviewer` agent with the pull request number. Post its body
   unchanged: `gh pr review <n> --comment --body-file <file>`. A fail: fix every blocking and
   should-fix finding, push, and run the reviewer again, until it passes on the head commit.
   Nits that are plainly right ride along in the next push.

## 7. Land it

The Auto-merge workflow arms the pull request as it opens; it merges itself, by squash, once
Gates, Title and Review are green. Watch it with `gh pr checks <n> --watch --required`: a
failure is yours to root-cause and fix, never to skip; then review and watch again. The
session ends when `gh pr view <n> --json state` says MERGED. The issue closes itself; take the
`in-progress` label off if it is still there.

## When the owner decides

Label the pull request `needs-human`, say in one comment exactly what is being asked, and move
on to the next issue. Only for: a change that deletes or moves the user's files in a way the
app did not before, a migration that rewrites existing data, a new visual direction the sheets
do not settle, or a requirement the PRD contradicts or leaves open. Everything else decides
itself by the PRD, the sheets and `DECISIONS.md`.

## Keeping the queue going

`scripts/agent.ps1` runs one session per issue until the queue is empty. Usage limits pause a
session, not the work: the next one resumes from the issues and pull requests.
