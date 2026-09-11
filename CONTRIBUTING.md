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

Once per clone, point git at the repository's hooks. The only one refuses a
commit on `main`, which is a mistake that is tedious to undo afterwards:

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

- Branch off `main`; pull requests are squash-merged, so the title and description become the
  commit.
- Commit messages are a single lowercase subject line.
- **Don't add a dependency without discussing it first.** Versions are pinned exactly, and the
  supply-chain surface is kept deliberately small.
- Comments explain constraints that a future edit would break silently. Reasoning belongs in
  [docs/DECISIONS.md](docs/DECISIONS.md), which the source cites by heading.

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the rest: ports, how to look at the running app,
and how the tests are meant to be used.

## Licence

Contributions are accepted under [GPL-3.0-or-later](LICENSE), the project's own licence. The
name and mark are not covered by it — see [TRADEMARKS.md](TRADEMARKS.md).
