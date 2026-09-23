# Contributing

The project is early and the interface is being built slice by slice, so large unsolicited
changes are likely to collide with work in progress. An issue first is usually the faster
route.

## Getting it running

You need Node 24 (see `.nvmrc`), Rust stable 1.85 or newer, and Windows with Edge installed —
the tests drive the Edge you already have rather than downloading a browser.

```bash
npx --yes pnpm@12.4.1 install
npx --yes pnpm@12.4.1 tauri dev
```

Once per clone, point git at the repository's hooks. One refuses a commit on `main`, which is a
mistake that is tedious to undo afterwards; the other refuses a commit message that does not
follow the format under "Commits" below:

```bash
git config core.hooksPath .githooks
```

`pnpm` is deliberately not installed globally, and corepack cannot launch pnpm 12, so commands
go through `npx` at the pinned version.

## Before opening a pull request

```bash
npx --yes pnpm@12.4.1 lint
npx --yes pnpm@12.4.1 check
npx --yes pnpm@12.4.1 test
npx --yes pnpm@12.4.1 test:e2e
cargo check --manifest-path src-tauri/Cargo.toml
```

CI runs the same set on Windows.

## Conventions

- **Don't add a dependency without discussing it first.** Versions are pinned exactly, and the
  supply-chain surface is kept deliberately small.
- Comments explain constraints that a future edit would break silently. Reasoning belongs in
  [docs/DECISIONS.md](docs/DECISIONS.md), which the source cites by heading.

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the rest: ports, how to look at the running app,
and how the tests are meant to be used.

## Branches, commits and pull requests

`main` is always green and always releasable. Every change reaches it through a pull request,
merged with a merge commit, so `git log --first-parent main` reads as the list of pull requests
and `git log` shows every step inside them. Nothing is ever force-pushed to `main`.

### Branches

- **One branch per pull request**, cut from an up-to-date `main` and deleted once merged.
- **Named `type/topic`.** The type is one of the commit types below; the topic is two to four
  lowercase words in kebab case naming the outcome, not the mechanism.

| Good | Not |
| --- | --- |
| `feat/context-menus` | `menus-2` |
| `fix/zoom-drag-waits-for-wheel` | `zoom-test-race` |
| `fix/pane-thumbnail-flash` | `thumb-stand-in` |
| `ci/prebundle-react-dom` | `ci-cold-reload` |
| `docs/design-pass-5` | `drawn-fixes` |

Dependabot's branches keep the names it gives them.

### Pull requests

- **One outcome each**: a feature slice, a fix, a design import, a tooling change. A description
  that needs "and also" is two pull requests.
- **A fix found while building something else is its own pull request**, unless the work depends
  on it; then it is its own commit inside that one.
- **Small enough to review in one sitting**: roughly a thousand changed lines, not counting tests
  and generated bindings. A larger slice lands as several, the Rust side before the interface
  that uses it.
- **The title is the merge commit's subject**, so it follows the commit format below and ends up
  in `main`'s first-parent history as `feat(menu): right-click menus for files, folders and
  sources (#26)`. The description says what changed for someone using the app, how it was
  checked, and what was deliberately left out.
- **CI passes before merging.** A red `main` is fixed before anything else lands.

### Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): what changes, in the imperative

Optional body, wrapped at 72 columns: why, when neither the diff nor docs/DECISIONS.md says.
```

- **Types:** `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
  A design import from Claude Design is `docs(design)`.
- **Scopes** name the area touched, as the code names it: `pane`, `grid`, `nav`, `tree`, `menu`,
  `settings`, `frame`, `window`, `zoom`, `ui`, `walk`, `jobs`, `db`, `ipc`, `thumbs`, `e2e`,
  `design`, `deps`. A change across the whole app leaves the scope out.
- **The subject** is lowercase, imperative, without a full stop, and 72 characters at most with
  its prefix. It says what changes, not how: `fix(pane): draw no thumbnail while the original
  loads`, not `fix: update Media.tsx`.
- **No trailers.** Authorship is the commit's author.
- **Atomic.** Each commit has one reason to exist and passes every gate on its own, so
  `git bisect` can land anywhere. Formatting and regenerated bindings go in the commit that
  caused them, never in one of their own.
- **Tidy before merging.** "Fix lint" and "oops" commits are folded into the commit they belong
  to (`git commit --fixup`, then `git rebase --autosquash main`) before the pull request is
  merged. Force-pushing a branch that is not yet merged is fine; rewriting `main` is not.

### Releases

A release is a tag on `main`, `vMAJOR.MINOR.PATCH`, with the portable `Filmstrip.exe` attached
and notes drawn from the first-parent history since the last tag. The version stays below 1.0
until every capability in [docs/FEATURES.md](docs/FEATURES.md) is built.

## Licence

Contributions are accepted under [GPL-3.0-or-later](LICENSE), the project's own licence. The
name and mark are not covered by it — see [TRADEMARKS.md](TRADEMARKS.md).
