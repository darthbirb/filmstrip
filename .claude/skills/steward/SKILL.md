---
name: steward
description: Conventions for driving a Filmstrip pull request to merged — CI, the Review gate, auto-merge, needs-human and Dependabot. Read when acting on pull-request events.
---

# Stewarding a pull request

- **Merging is automatic.** The Auto-merge workflow arms every pull request the owner or
  Dependabot opens; it merges by squash, its title the commit subject, once Gates, Title and
  Review pass. No session merges anything itself.
- **Review** passes when the latest pull-request review on the head commit, posted by the
  repository's owner account, ends in `<!-- review: pass -->`. Every push needs a fresh review;
  run the `reviewer` agent again after fixing findings, and post its body unchanged.
- **`needs-human`** holds a pull request until the owner removes the label. Never remove it
  yourself.
- **Dependabot:** patch and minor updates merge on green, by themselves. A major update gets
  `needs-human` with one comment on what breaks, unless its release notes and the gates show
  nothing does.
- **Commits and descriptions carry no AI attribution**: no co-author trailer, no generated-by
  line. They are authored as the repository's owner.
- **A red `main`** is fixed before anything else lands.
