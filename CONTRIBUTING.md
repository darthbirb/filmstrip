# Contributing

Filmstrip is built from a queue of GitHub issues, mostly by agents, and the interface follows
drawn sheets, so a large unsolicited change will likely collide with work in flight. Open an
issue first; it is the faster route.

## Getting it running

You need Node 24 (see `.nvmrc`), Rust stable 1.90 or newer, and Windows with Edge installed —
the tests drive the Edge you already have rather than downloading a browser. Elsewhere they fall
back to Playwright's Chromium (`tests/browser.ts`), and Tauri needs
[its prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npx --yes pnpm@12.4.1 install
npx --yes pnpm@12.4.1 tauri dev
```

Optionally, `git config core.hooksPath .githooks` once per clone: one hook refuses a commit on
`main`, the other a message that does not follow "Commits" below.

`pnpm` is deliberately not installed globally, and corepack cannot launch pnpm 12, so commands
go through `npx` at the pinned version.

## Before opening a pull request

Every gate in [AGENTS.md](AGENTS.md) "Commands" passes. CI runs the same set on Windows.

## Conventions

- **A new dependency is named in the pull request with its reason.** Versions are pinned
  exactly, and the supply-chain surface is kept deliberately small.
- Comments explain constraints that a future edit would break silently. Reasoning belongs in
  [docs/DECISIONS.md](docs/DECISIONS.md), which the source cites by heading.

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the rest.

## Branches, commits and pull requests

`main` is always green and always releasable. Every change reaches it through a pull request,
squash-merged, so `git log main` reads as one line per pull request.

### Branches

- **One branch per pull request**, cut from an up-to-date `main` and deleted once merged.
- **Named `type/topic`**: a commit type below, then two to four lowercase words in kebab case
  naming the outcome, not the mechanism — `feat/context-menus`, `fix/pane-thumbnail-flash`.
  Branches made by tools keep the names the tools give them.

### Pull requests

- **One outcome each**: a feature, a fix, a design pass, a tooling change. A description that
  needs "and also" is two pull requests. A fix found along the way is its own pull request,
  unless the work depends on it.
- **Small enough to review in one sitting**: roughly a thousand changed lines, not counting tests
  and generated bindings. A larger feature lands as several, the Rust side first.
- **The title is the squash commit's subject**, so it follows the commit format below; the Title
  check holds it to that. The description follows the template: what changes for someone using
  the app, how it was checked, what was left out, and the issue it closes.
- **It merges itself** by squash once Gates, Title and Review pass. Review is a status the
  independent reviewer sets on the head commit it passed; the queue then arms the merge. The
  Dependabot workflow does both for Dependabot's grouped patch and minor updates; its others go
  through the queue. `needs-human` holds it for the owner.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): what changes, in the imperative

Optional body, wrapped at 72 columns: why, when neither the diff nor docs/DECISIONS.md says.
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
  A design pass is `docs(design)`.
- **Scopes** name the area touched, as the code names it: `pane`, `grid`, `nav`, `tree`, `menu`,
  `settings`, `frame`, `window`, `zoom`, `ui`, `walk`, `jobs`, `db`, `ipc`, `thumbs`, `e2e`,
  `design`, `deps`. A change across the whole app leaves the scope out.
- **The subject** is lowercase, imperative, without a full stop, and 72 characters at most with
  its prefix. It says what changes, not how.
- **No trailers and no AI attribution.** Authorship is the commit's author.
- **Each commit passes the gates on its own**, so a branch can be bisected before it is squashed.

### Releases

Each day `main` has moved, the **Nightly** pre-release is replaced with a fresh
`Filmstrip.zip`: the portable `Filmstrip.exe`, with ffmpeg in `tools\` beside it. Run the Release workflow by hand for one sooner. A release proper is a tag on `main`, `vMAJOR.MINOR.PATCH`, built the same way
with notes drawn from the pull requests since the last tag. The version stays below 1.0 until
every capability in [docs/FEATURES.md](docs/FEATURES.md) is built.

## Licence

Contributions are accepted under [GPL-3.0-or-later](LICENSE), the project's own licence. The
name and mark are not covered by it — see [TRADEMARKS.md](TRADEMARKS.md).
