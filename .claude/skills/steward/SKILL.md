---
name: steward
description: Conventions for driving a Filmstrip pull request to merged — CI, the Review gate, auto-merge, needs-human and Dependabot. Read when acting on pull-request events.
---

# Stewarding a pull request

- **Merging is automatic.** Every pull request merges by squash, with its title as the commit
  subject, once the required checks pass: Gates on Windows and Linux, Title, and Review. Enable
  auto-merge with the squash method; never merge by hand on red.
- **Review** passes when the latest pull-request review on the head commit, posted by the
  repository's owner account, ends in `<!-- review: pass -->`. Every push needs a fresh review;
  run the `reviewer` agent again after fixing findings, and post its body unchanged.
- **`needs-human`** holds a pull request until the owner removes the label. Never remove it
  yourself.
- **Dependabot:** patch and minor updates merge on green. Enable auto-merge on them. A major
  update gets `needs-human` with one comment on what breaks, unless its release notes and the
  gates show nothing does.
- **Commits and descriptions carry no AI attribution**: no co-author trailer, no generated-by
  line. They are authored as the repository's owner.
- **A red `main`** is fixed before anything else lands.
