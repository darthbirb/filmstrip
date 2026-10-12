---
name: queue
description: Work Filmstrip's issue queue from this session until it is empty — each issue built by a fresh builder subagent, reviewed by the independent reviewer subagent, fixed and re-reviewed until it passes, then merged once CI is green. Use when asked to run, work or continue the queue, or to land a pull request someone built.
---

# Work the queue

This session is the orchestrator. It holds only summaries: every issue is built and every review
is done in a subagent with a fresh context, so the session stays small however many issues it
takes. GitHub holds the state, so a run that stops (a usage limit, the app closing) resumes from
the issues and pull requests; "continue the queue" picks up where it left off.

## Each turn of the loop

0. **Auto mode.** The owner starts the session in Auto mode, so nothing waits on a prompt; the
   deny rules in `.claude/settings.json` still hold. In any other mode, say so and ask once.
1. **Resume first.** `git fetch --prune origin`. An open pull request that is neither a draft nor
   `needs-human` comes before new work: the owner's; one of Dependabot's whose head branch has no
   `/patch-and-minor-` (a major, or any GitHub Actions bump); or a grouped one of Dependabot's
   whose head has a failing Review or none. Route it by its head commit:
   - the latest review on that commit ends in `<!-- review: fail -->`: step 5;
   - the head carries the reviewer's Review = success: step 6;
   - otherwise (no review of that commit, or only the Hold workflow's failure): step 4.

   A Dependabot major is checked against its release notes and the gates; if it breaks
   something, label it `needs-human` with one comment on what breaks.
2. **Pick.** The open issue labelled `ready` and none of `in-progress`, `blocked` or
   `needs-human`, earliest milestone, lowest number first. None ready but some labelled `design`:
   start a `general-purpose` subagent: "Use the design-pass skill, up to and including opening
   its pull request; return the pull request number and its head commit", then steps 4 to 7.
   Neither: stop, and say the queue is empty.
3. **Build.** Start a `general-purpose` subagent in the foreground: "Use the deliver skill on
   issue #n, up to and including opening its pull request. Return the pull request number, its
   head commit, and a five-line summary of what changed and how it was checked." Wait for it.
   If it labelled the pull request `needs-human`, log it and go to the next issue.
4. **Review.** Start the `reviewer` subagent in the foreground with the pull request number. It
   posts its review and, on a pass, sets the Review status on the commit it reviewed. Wait for it.
5. **Fix, at most three rounds.** A fail: start a `general-purpose` subagent: "Use the deliver
   skill to address the latest review on pull request #n: fix every blocking and should-fix
   finding, and the nits that are plainly right, run the gates, push, and return the new head
   commit." Then **Review** again. Still failing after the third review: label the pull request
   `needs-human`, comment with what remains in dispute, and go on to the next issue.
6. **Land.** `gh pr merge <n> --squash --auto`, then `gh pr checks <n> --watch --required`. A red
   check is a fix round like any other (step 5), then Review again. Merged: take `in-progress`
   off, and close only an issue the pull request names with `Closes #n` that is still open. A
   design pass names its feature with `Refs #n`, so the feature stays open, `ready` to build.
7. **Log.** Append one line to `.queue/log.md` (git-ignored): the time, the issue, the pull
   request, the outcome (merged, needs-human, stopped), the review rounds, and anything the next
   run should know. Then the next turn.

## Rules

- Never merge, and never set the Review status, yourself: the reviewer marks the commit, and
  GitHub merges once Gates, Title and Review are green. Nothing bypasses `main`'s ruleset.
- Labelling a pull request `needs-human` holds it: the Hold workflow marks its head Review =
  failure. Take its armed merge off too (`gh pr merge <n> --disable-auto`).
- One issue at a time, each in its own subagent and branch. Never start a builder while another
  pull request of the owner's is waiting for review or a fix.
- The owner decides only what the `deliver` skill's "When the owner decides" names; everything
  else decides itself. A `needs-human` pull request waits for the owner while the queue goes on.
- When the queue empties, run the Release workflow (`gh workflow run release.yml`) if anything
  merged, so the Nightly in `latest\` (`scripts/update-latest.ps1`) is current.
