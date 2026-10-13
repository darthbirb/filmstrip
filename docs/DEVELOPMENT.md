# Development

## What you need

Node 24 (see `.nvmrc`), Rust stable (1.90 or newer, which Tauri 2.12 needs), and Microsoft Edge —
the tests drive the Edge you already have rather than downloading a browser. WebView2 ships
with Windows 11. For the queue, the Claude desktop app and the GitHub CLI (`gh`), signed in.

## Commands

`pnpm` is not on `PATH`. Corepack cannot launch pnpm 12: it looks for `bin/pnpm.cjs`, and
pnpm 12 ships a native binary behind a launcher instead. So every command runs the pinned
version through `npx`:

| | |
| --- | --- |
| `npx --yes pnpm@12.4.1 install` | install, from the lockfile |
| `npx --yes pnpm@12.4.1 dev --port 1422 --strictPort` | dev server for checking the UI |
| `npx --yes pnpm@12.4.1 tauri dev` | the real app, in its own window |
| `npx --yes pnpm@12.4.1 lint` | Biome, format and lint |
| `npx --yes pnpm@12.4.1 check` | TypeScript |
| `npx --yes pnpm@12.4.1 test` | component tests |
| `npx --yes pnpm@12.4.1 test:e2e` | end-to-end tests |
| `npx --yes pnpm@12.4.1 check:docs` | doc pointers resolve, comments stay short |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | Rust format |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Rust lint |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust tests; also writes `src/ipc/bindings` |
| `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --test-threads=1 ::timing::` | Rust timing tests, one at a time |

### Where pnpm cannot run

Every script is in `package.json`, and the tools they call are in `node_modules/.bin`, so where
`npx --yes pnpm@12.4.1` cannot run, npm runs the same scripts from what is already installed:
`npm run lint`, `check`, `check:docs`, `test`, `test:e2e`, `dev` and `tauri`. Flags for the
script go after `--`: `npm run dev -- --port 1422 --strictPort`, `npm run tauri -- dev`.

Only `install` needs pnpm, and only when `pnpm-lock.yaml` has changed; never install with npm,
which ignores the lockfile. CI installs fresh from the lockfile on every pull request, so a
change that needs a new install is still checked there.

## Ports

**1420 belongs to `tauri dev`** and is pinned with `strictPort` in `vite.config.ts`, because
Tauri expects a fixed port. **Claude's own dev server runs on 1422**, pinned in
`.claude/launch.json`, so the two never collide. Stop a server you started before ending a
turn.

## Seeing the app

Three ways, cheapest first.

1. **A browser, against mocks.** `dev` serves the app, and `src/dev/mock.ts` installs Tauri's
   own `mockIPC` and `mockWindows` when `__TAURI_INTERNALS__` is absent and the build is a dev
   build. It answers every command from a small library typed by the Rust bindings — good
   enough for layout, states and copy. It is dev-only, and the production bundle
   is checked to contain none of it.
2. **The Playwright MCP.** It drives a headed browser, so time actually passes there and its
   screenshots come back as images that can be looked at. **The editor's Browser pane cannot
   do this**: it never draws, so it takes no screenshots, fires no animation frames, and a CSS
   transition never advances in it. Use the pane only to start a server.
3. **The real window.** `tauri dev`, then attach Playwright over the Chrome DevTools Protocol
   at `http://127.0.0.1:9322`. `src-tauri/src/lib.rs` opens that port in **debug builds only**.
   Verified on 12 September 2026: the page reported real Tauri, `dpr 1.5`, viewport 1280×820.
   With it running, `node scripts/dev-library.mjs` builds a small library under
   `src-tauri/target/dev-library` and registers it, one unplugged source included, so the real
   app has folders to show.

## Tests

- **A change in behaviour lands with a test that fails without it**, and a bug fix starts with
  the test that reproduces it. CI runs every suite below on each pull request.
- **Rust** is tested beside the code, in `#[cfg(test)]` modules. A test that needs real files
  writes them under `src-tauri/target/`, never outside the repository.
- **A test that bounds how long the code takes runs alone.** Beside the rest of the suite it
  times the machine, not the code, so it sits in a `timing` module inside its file's tests and
  is `#[ignore]`d. After the plain run,
  `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --test-threads=1 ::timing::`
  runs them one at a time; CI does both on every pull request, and fails if that selects
  nothing. Its bound is never loosened to make it pass.
- **A test that needs ffmpeg is `#[ignore]`d**, so a plain `cargo test` needs nothing
  downloaded. `pwsh scripts/fetch-ffmpeg.ps1` puts the build the release carries in
  `src-tauri/target/tools`, where those tests look before PATH, and
  `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --skip ::timing::` runs them;
  CI does both on every pull request. Run them after touching video. For video in `tauri dev`,
  fetch it beside the debug build:
  `pwsh scripts/fetch-ffmpeg.ps1 -Into src-tauri/target/debug/tools`.
- **Component tests** run in Vitest's browser mode over `src/**/*.test.tsx`, on Edge under
  Windows and Chromium elsewhere, in the `en-GB` locale (`tests/browser.ts`). **Never jsdom** —
  see DECISIONS.md "Testing in a real browser, never jsdom".
- **End-to-end tests** run in Playwright over `tests/e2e`, against the dev server on 1422.
  Screenshots land in `test-results/`, which is git-ignored.
- **A check proves something at more than one size.** Sweep widths, and fail on any console
  error. One size proves one size.

## The command boundary

The frontend reaches Rust only through the commands in `src-tauri/src/commands.rs`. Each one
opens its own connection on a blocking thread, calls a plain function, and returns — so the
logic is tested without Tauri.

- **Types cross by generation.** A Rust type with `#[ts(export)]` is written to
  `src/ipc/bindings/` whenever `cargo test` runs. Never edit those files; commit them. CI fails
  when they differ from what the Rust side generates.
- **Wrappers are written by hand** in `src/ipc/commands.ts`, one per command, each typed
  `invoke` on one line. Tauri takes arguments in camelCase and hands them to Rust in snake_case.
- **A Rust test reads the commands, their registration in `lib.rs`, and the wrappers**, and fails
  when a command is missing from either or an argument name disagrees.
- **The dev mock answers the same commands**, and a component test fails when a wrapper sends
  one it does not know.

## Layout

```
src/app/       composition — the shell and its surfaces
src/ui/        primitives; they own every visual decision (created with the first one)
src/lib/       framework-free logic
src/ipc/       command wrappers, and bindings generated from Rust
src/styles/    app.css — the token layer
src/dev/       mocks, dev builds only
src-tauri/     the Rust side
tests/e2e/     Playwright
```

## Slices

The interface was built one slice at a time — window bar, frame, navigation, grid, the visual
direction, pane, selection, search, menus, settings — each from two to four candidates the owner
picked between in the real window. What won is written into DECISIONS.md.

**Now each capability is an issue**, built from its drawing by the `deliver` skill. Candidates
come back only when a pull request is labelled `needs-human` for a direction the sheets do not
settle: the dev readout at the foot of a debug window switches between them, by click or by the
digit beside each, and its last entry shows every candidate at once. A production build always
takes the first. When the owner picks, the others and their picker entry are deleted.

## Designs

The sheets in `docs/design/` are what the interface is built from; its README lists them. The
`design-pass` skill draws `docs/design/BACKLOG.md` in them directly (DECISIONS.md "The look").
**A feature that adds a shape adds it to `docs/DESIGN.md`**, and its states are checked on the
real surface.

## Running the queue

Ask a Code-tab session in the desktop app to run the queue; the `queue` skill takes it from
there until nothing is `ready` or waiting on `design`. That session only orchestrates: each
issue is built by a fresh `general-purpose` subagent running `deliver`, and reviewed by a fresh
`reviewer` subagent, so neither inherits the other's context and the session stays small across
many issues. Failed reviews go back to a builder for at most three rounds before `needs-human`.
Nothing runs outside the app: no CLI, no API key, no Claude secret on GitHub. Start the session
in Auto mode, from the Code tab's mode picker, so nothing waits on a prompt; the deny rules in
`.claude/settings.json` still hold.

GitHub holds the state, so a run stopped by a usage limit or a closed app resumes when asked to
continue. Each issue adds a line to `.queue/log.md`, git-ignored: what merged, what waits on the
owner, and what the next run should know. The repository's `.npmrc` pins npm and pnpm to the
public registry, whatever the machine's own npm configuration says.

`.claude/settings.json` turns off Claude Code's attribution, so commits and pull requests carry
none. `scripts/update-latest.ps1` fetches the Nightly into `latest\` to try by hand.

## Review

Every pull request is reviewed by the `reviewer` agent, which did not write it, to the bar in
`.claude/skills/review/SKILL.md`. Its review is posted on the pull request ending in
`<!-- review: pass -->` or `<!-- review: fail -->`. On a pass, and only then, the reviewer sets
the `Review` commit status on the commit it reviewed; `main`'s ruleset requires it beside Gates
and Title. A push makes a new head with no status, so every change after a review is reviewed
again. Labelling a pull request `needs-human` holds it: the Hold workflow marks its head
Review = failure, and only a fresh passing review after the label comes off replaces it. The
Dependabot workflow sets it for Dependabot's grouped patch and minor updates, which the gates
review. The ruleset takes Review from any source, so it is as trustworthy as the account and
workflows that can set it, as Gates is. The reviewer runs the branch in a worktree of its own,
never in the author's checkout.

## Porting from ggallery

ggallery, the private predecessor, sits beside this repository at `../ggallery` and holds a
tested implementation of most of what this app does. It is a reference only: nothing there is
edited, installed or run.

**Look there before building anything.** A feature is ported when its slice needs it, not ahead
of time, so each port is exercised as soon as it lands and stays small enough to review
properly. Interface logic that is not markup — the grid's layout maths, the query term helpers —
ports the same way; components and styles never do (DECISIONS.md "Built in slices, not ported").
Its interface is never read for the look, which comes from Claude Design (DECISIONS.md "The look").

**A port is a rewrite with the original open beside it**, never a copy:

- Read the whole module and its callers first. Note what it assumes that no longer holds here —
  one library root, paths stored per row, sweeps across every source — and what it got right
  that would be easy to lose.
- Fit it to this schema and to DECISIONS.md. Where they disagree this repository wins, and a
  disagreement worth keeping goes into DECISIONS.md.
- Carry its tests across and extend them; a port lands with tests like any other change.
- Write every comment fresh, in this repository's convention. None are copied.
- A dependency it used is a dependency to ask about, pinned to today's version.
- The commit or pull request says what was ported and what changed on the way.

| Feature | In ggallery | Brought in by |
| --- | --- | --- |
| Serving files to the window | `lib.rs`, the asset protocol's scope | grid and tiles |
| Thumbnails, and image dimensions | `media/thumbs.rs`, `media/mod.rs` | grid and tiles |
| Background jobs | `jobs/`, `db/jobs.rs`, `commands/jobs.rs` | grid and tiles |
| Content hashing | `media/hash.rs` | grid and tiles |
| Grid layout | `features/grid/useGridLayout.ts`, `layoutWorker.ts` | grid and tiles |
| Performance fixture | `bin/synth_library.rs` | grid and tiles |
| Probing video and capture dates | `media/probe.rs`, `sidecar/` | the pane |
| Scrub sprites | `media/sprites.rs`, `sidecar/ffmpeg.rs` `frames` | scrubbing a video's tile |
| Show in Explorer, Open with Default App | `commands/items.rs`, `tauri-plugin-opener` | the pane |
| Copying a file, or its path, to the clipboard | `fs/clipboard.rs`, `commands/items.rs` `copy_item_path` | the pane |
| Moving, renaming, undo | `fs/relocate.rs`, `fs/undo.rs`, `db/journal.rs`, `commands/triage.rs` | selection and moving |
| Trash | `fs/trash.rs` | selection and moving |
| The library's counts and totals | `commands/items.rs` `unsorted_count`, `trashed_count`, `library_totals`; `db/items.rs` `counts_by_kind` | the foot's totals |
| Destination hotkeys | `db/hotkeys.rs`, `state/hotkeys.ts` | selection and moving |
| Watching the disk | `fs/watch.rs` | selection and moving |
| Search and the query language | `query/`, `db/search.rs`, `commands/search.rs`, `lib/queryTerm.ts` | search |
| The tags screen | `commands/tags.rs` | settings and the tags screen |
| Import, paste, export | `fs/import.rs`, `fs/paste.rs`, `fs/clipboard.rs`, `fs/export.rs` | not yet scheduled |
| Backups | `db/backup.rs` | not yet scheduled |

## Keeping the docs true

Comments cite headings in PRODUCT.md, DECISIONS.md, DEVELOPMENT.md, SCHEMA.md and DESIGN.md
**by exact title**, each pointer on one line. Renaming a heading orphans its callers, so rename and fix
them in the same commit.

**A comment runs three lines at most.** What a future edit would break silently stays in the
source; the reasoning goes in DECISIONS.md, and the comment names the section.

`check:docs` enforces both, over the source and the prose docs, and CI runs it. It also holds
DESIGN.md's front matter to `src/styles/app.css`: every colour, radius, spacing and text token
of the base look, at the same value, and every component reference pointing at a real token.

## Gotchas

- **pnpm's package store is at `D:\.pnpm-store`**, its normal location when the project is on
  a different drive from the home folder. A cache, not configuration.
- **Windows' text-size setting scales all WebView2 content**, the way zoom does. So layouts
  answer to the width they are given, never to a device.
- **A migration runs with foreign keys off.** SQLite empties a table before dropping it, which
  fires `ON DELETE CASCADE` on everything referencing it. The pragma cannot change inside a
  transaction, so `db::migrate` switches it around them rather than in the SQL.
- **CI runs the component tests on a cold Vite cache.** A dependency Vite first meets mid-run is
  optimized then and reloads the page, killing whichever test was in flight, so every such
  dependency is named in `optimizeDeps.include` in `vitest.config.ts`. A warm local cache never
  shows it: check with `node_modules/.vite/vitest` moved aside, and read the log for "reloading".
- **CI caches Rust's build** per job and per `Cargo.lock`; a lockfile change compiles from
  scratch once.
