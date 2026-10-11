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

1. **Resume first.** `git fetch --prune origin`. An open pull request of the owner's that is not
   `needs-human` comes before new work: take it to **Review** below.
2. **Pick.** The open issue labelled `ready` and none of `in-progress`, `blocked` or
   `needs-human`, earliest milestone, lowest number first. None ready but some labelled `design`:
   run the `design-pass` skill in a builder subagent instead. Neither: stop, and say the queue is
   empty.
3. **Build.** Start a `general-purpose` subagent in the foreground: "Use the deliver skill on
   issue #n, up to and including opening its pull request. Return the pull request number, its
   head commit, and a five-line summary of what changed and how it was checked." Wait for it.
4. **Review.** Start the `reviewer` subagent in the foreground with the pull request number. It
   posts its review and, on a pass, sets the Review status on the commit it reviewed. Wait for it.
5. **Fix, at most three rounds.** A fail: start a `general-purpose` subagent: "Use the deliver
   skill to address the latest review on pull request #n: fix every blocking and should-fix
   finding, and the nits that are plainly right, run the gates, push, and return the new head
   commit." Then **Review** again. Still failing after the third review: label the pull request
   `needs-human`, comment with what remains in dispute, and go on to the next issue.
6. **Land.** `gh pr merge <n> --squash --auto`, then `gh pr checks <n> --watch --required`. A red
   check is a fix round like any other (step 5), then Review again. Merged: if the issue is still
   open, close it naming the pull request, and take `in-progress` off.
7. **Log.** Append one line to `.queue/log.md` (git-ignored): the time, the issue, the pull
   request, the outcome (merged, needs-human, stopped), the review rounds, and anything the next
   run should know. Then the next turn.

## Rules

- Never merge, and never set the Review status, yourself: the reviewer marks the commit, and
  GitHub merges once Gates, Title and Review are green. Nothing bypasses `main`'s ruleset.
- One issue at a time, each in its own subagent and branch. Never start a builder while another
  pull request of the owner's is waiting for review or a fix.
- The owner decides only what the `deliver` skill's "When the owner decides" names; everything
  else decides itself. A `needs-human` pull request waits for the owner while the queue goes on.
- When the queue empties, run the Release workflow (`gh workflow run release.yml`) if anything
  merged, so the Nightly in `latest\` (`scripts/update-latest.ps1`) is current.
