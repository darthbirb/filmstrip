# Filmstrip

A gallery viewer and collection organiser for Windows, in that order — the main activity is
looking at things. It runs against folders on your own disk: no account, no network service.

Tauri 2 · Rust · React 19 · TypeScript · Vite · Tailwind v4 · Base UI · SQLite.

## How work flows

Work is built in a Claude Code session in the desktop app on the owner's Windows machine, from a
queue, with the owner stepping in only where a pull request asks. The `queue` skill runs it.

- **The queue is GitHub issues.** `docs/PRD.md` says what the app must do; each capability not
  yet built is an issue with acceptance criteria, labelled `design` until it is drawn and
  `ready` once it can be built. Progress lives in issues and pull requests, never only in a
  conversation.
- **One issue, one branch, one pull request.** The `queue` skill hands each issue to a fresh
  builder subagent running `deliver`, up to an open pull request; `design-pass` draws what is
  waiting on `design`; `review` is the bar both meet.
- **Every pull request is reviewed independently** by the `reviewer` subagent, which did not
  write it, sees only the change, and marks the commit it passed with the Review status;
  Dependabot's grouped patch and minor updates excepted, which the gates review. It merges by
  squash once Gates, Title and Review pass; `needs-human` holds it for the owner. See the
  `steward` skill.
- **`main` is always releasable.** A Nightly `Filmstrip.exe` is built from it each day it moves;
  `scripts/update-latest.ps1` puts it in `latest\`, where the owner tries the app.

## Commands

`pnpm` runs through `npx` at the pinned version:

- `npx --yes pnpm@12.4.1 install` — install
- `npx --yes pnpm@12.4.1 dev --port 1422 --strictPort` — dev server for checking the UI
- `npx --yes pnpm@12.4.1 tauri dev` — the real app in its own window
- `npx --yes pnpm@12.4.1 lint | check | check:docs | test | test:e2e` — the frontend gates
- `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test`, each with
  `--manifest-path src-tauri/Cargo.toml` — the Rust gates

CI runs the same gates on Windows. GitHub is reached with the `gh` CLI.

## Rules

- **Never push to `main`.** Branch from an up-to-date `origin/main`, never from unmerged work,
  and land through a pull request. No force-push to a branch someone else is working on.
- **Branches, commits and pull requests follow CONTRIBUTING.md.** No AI attribution anywhere:
  no co-author trailer, no generated-by line.
- **Port before you build.** Most of the backend already exists, tested, in ggallery at
  `../ggallery`. It is read-only: never edit, install or run anything there. Port critically —
  `docs/DEVELOPMENT.md` "Porting from ggallery".
- **A change in behaviour lands with a test that fails without it.** A bug fix starts with the
  test that reproduces it. Never skip, loosen or delete a test to get green.
- **Verify before claiming.** Run the gates. For anything visual, look at it in a real browser.
- **Plan first for anything in `src-tauri/` that moves the user's files**, and write the plan
  into the pull request.
- **A new dependency is named in the pull request with its reason.** Versions are exact; npm's in
  `package.json`, Rust's in `Cargo.lock`.
- **Nothing changes the machine** outside the project: no global installs, no system settings,
  no registry. A test that seems to need one is reaching too far — say so instead.
- **Primitives own every visual decision; surfaces compose them.** Sizes, colours and durations
  come from the token layer in `src/styles/app.css`. A component may not invent a number.
  `docs/DESIGN.md` describes the tokens and every shape; a feature that adds a shape adds it there.
- **Comments split three ways.** A constraint a future edit would break silently stays in the
  source, in three lines at most. Why the design is this shape goes in `docs/DECISIONS.md`, and
  the source names the section. History goes in neither; git has it.
- **Doc pointers are load-bearing.** Comments cite headings in the docs by exact title, on one
  line. Rename a heading and fix its callers in the same commit; `check:docs` enforces it.

## Gotchas

- **Tests run in the installed Edge, never jsdom.** jsdom reports every element as zero-sized,
  which hides exactly the bugs worth catching.
- **The editor's Browser pane never draws.** No screenshots, no animation frames, no transitions.
  Use the Playwright MCP — `docs/DEVELOPMENT.md` "Seeing the app".
- **`src/ipc/bindings/` is generated** by `cargo test`. Never edit it; rerun the tests and
  commit what changed.
- **Port 1420 belongs to `tauri dev`**; agents' dev servers use 1422. Stop a server you started.
- **Debug builds open a WebView2 debug port on 9322** so Playwright can attach to the real
  window. Release builds never do.

## Docs

- [docs/PRD.md](docs/PRD.md) — what the app must do, and in what order
- [docs/PRODUCT.md](docs/PRODUCT.md) — how it behaves
- [docs/FEATURES.md](docs/FEATURES.md) — every capability, and whether it is built yet
- [docs/DECISIONS.md](docs/DECISIONS.md) — why it is built this way
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — how to work on it
- [docs/SCHEMA.md](docs/SCHEMA.md) — the tables and the rules the data keeps
- [docs/DESIGN.md](docs/DESIGN.md) — how it looks: the tokens and the shapes
- [docs/design/](docs/design/README.md) — the drawn sheets it is built from
