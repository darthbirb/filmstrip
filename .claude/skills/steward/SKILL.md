---
name: steward
description: Conventions for driving a Filmstrip pull request to merged — CI, the Review status, auto-merge, needs-human and Dependabot. Read when acting on pull-request events.
---

# Stewarding a pull request

- **The queue lands it.** The `queue` skill runs the `reviewer` subagent on the head commit; on a
  pass it arms `gh pr merge <n> --squash --auto`, and GitHub squashes it, its title the commit
  subject, once Gates, Title and Review pass on `main`'s ruleset. Nothing bypasses them
  (`--admin` is denied).
- **Review** is a commit status the `reviewer` agent sets on the commit it reviewed, and only on
  a pass, after posting its review ending in `<!-- review: pass -->`. A push makes a new head
  with no status, so it needs a fresh review. No other session or agent sets it.
- **`needs-human`** holds a pull request for the owner: the reviewer sets no status on it and the
  queue arms no merge. Never remove the label yourself.
- **Dependabot:** the Dependabot workflow marks its head commits reviewed and arms the merge, so
  patch and minor updates merge on green by themselves. A major update gets `needs-human` with
  one comment on what breaks, unless its release notes and the gates show nothing does; take its
  armed merge off with `gh pr merge <n> --disable-auto` when labelling it.
- **Commits and descriptions carry no AI attribution**: no co-author trailer, no generated-by
  line. They are authored as the repository's owner.
- **A red `main`** is fixed before anything else lands.
