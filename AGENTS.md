# Filmstrip

A gallery viewer and collection organiser for Windows, in that order — the main activity is
looking at things. It runs against folders on your own disk: no account, no network service.

Tauri 2 · Rust · React 19 · TypeScript · Vite · Tailwind v4 · Base UI · SQLite.

## Commands

`pnpm` is not on `PATH`, and corepack cannot launch pnpm 12. Everything goes through the
pinned version:

- `npx --yes pnpm@12.4.1 install` — install
- `npx --yes pnpm@12.4.1 dev -- --port 1422` — dev server for checking the UI
- `npx --yes pnpm@12.4.1 tauri dev` — the real app in its own window
- `npx --yes pnpm@12.4.1 lint | check | test | test:e2e` — the four frontend gates
- `npx --yes pnpm@12.4.1 check:docs` — doc pointers resolve and comments stay short
- `cargo test --manifest-path src-tauri/Cargo.toml` — the Rust gate; CI adds fmt and clippy

## Ports

**1420 belongs to `tauri dev`.** Claude's own dev server runs on **1422** so the two never
collide. Stop any server you started before ending a turn — unless the turn ends on a choice
for the user: then leave `tauri dev` running with the options on it. A screenshot is never the
way a choice is offered.

## Rules

- **Work on a branch and open a pull request.** Never commit to `main`. Never push — the user
  pushes. `git status -sb` before committing: the user merges and pulls between turns, so the
  branch you were on may now be `main`. The `.githooks/pre-commit` hook refuses that commit
  when the clone has run `git config core.hooksPath .githooks`.
- **Commit messages are one lowercase subject line.** No body, no trailers.
- **Do not add a dependency without asking.** npm versions are exact; `Cargo.lock` holds Rust's.
- **Port before you build.** Most of the backend already exists, tested, in ggallery at
  `../ggallery`. It is read-only: never edit, install or run anything there. Look there first,
  then port critically — see `docs/DEVELOPMENT.md` "Porting from ggallery".
- **Nothing changes the machine.** No global installs, no system settings, no registry. A test
  that seems to need one is reaching too far — say so instead.
- **Verify before claiming.** Run the gates. For anything visual, look at a screenshot rather
  than asserting it works.
- **A change in behaviour lands with a test that fails without it.** A bug fix starts with the
  test that reproduces it. See `docs/DEVELOPMENT.md` "Tests".
- **Comments split three ways.** A constraint a future edit would break *silently* stays in the
  source, in three lines at most. Why the design is this shape goes in `docs/DECISIONS.md`, and the
  source names the section. Bug history and "it used to be X" go in neither; git has them.
- **Doc pointers are load-bearing.** Comments cite headings in the four docs by exact title, on
  one line. Rename a heading and fix its callers in the same commit. `check:docs` enforces this
  and the three-line limit.
- **Primitives own every visual decision; surfaces compose them.** Sizes, colours and durations
  come from the token layer in `src/styles/app.css`. A component may look however it looks, but
  it may not invent a number.

## Gotchas

- **The editor's Browser pane never draws.** No screenshots, no animation frames, and a CSS
  transition never advances there. Use the Playwright MCP, which drives a real window — see
  `docs/DEVELOPMENT.md` "Seeing the app".
- **Tests run in the installed Edge, never jsdom.** jsdom reports every element as zero-sized,
  which hides exactly the bugs worth catching.
- **`src/ipc/bindings/` is generated** by `cargo test`. Never edit it; rerun the tests and
  commit what changed.
- **Debug builds open a WebView2 debug port on 9322** so Playwright can attach to the real
  window. Release builds never do.

## Docs

- [docs/PRODUCT.md](docs/PRODUCT.md) — what the app does
- [docs/DECISIONS.md](docs/DECISIONS.md) — why it is built this way
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — how to work on it
- [docs/SCHEMA.md](docs/SCHEMA.md) — the tables and the rules the data keeps
