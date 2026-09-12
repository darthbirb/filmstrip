# Development

## What you need

Node 24 (see `.nvmrc`), Rust stable (1.85 or newer, for edition 2024), and Microsoft Edge —
the tests drive the Edge you already have rather than downloading a browser. WebView2 ships
with Windows 11.

## Commands

`pnpm` is not on `PATH`. Corepack cannot launch pnpm 12: it looks for `bin/pnpm.cjs`, and
pnpm 12 ships a native binary behind a launcher instead. So every command runs the pinned
version through `npx`:

| | |
| --- | --- |
| `npx --yes pnpm@12.4.1 install` | install, from the lockfile |
| `npx --yes pnpm@12.4.1 dev -- --port 1422` | dev server for checking the UI |
| `npx --yes pnpm@12.4.1 tauri dev` | the real app, in its own window |
| `npx --yes pnpm@12.4.1 lint` | Biome, format and lint |
| `npx --yes pnpm@12.4.1 check` | TypeScript |
| `npx --yes pnpm@12.4.1 test` | component tests |
| `npx --yes pnpm@12.4.1 test:e2e` | end-to-end tests |
| `npx --yes pnpm@12.4.1 check:docs` | doc pointers resolve, comments stay short |
| `cargo test --manifest-path src-tauri/Cargo.toml` | the Rust gate; also writes `src/ipc/bindings` |

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
- **A test that needs ffmpeg is `#[ignore]`d**, because CI has none. Where ffmpeg is on PATH,
  `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored` runs them; run it after touching
  video.
- **Component tests** run in Vitest's browser mode on Edge (`channel: "msedge"`), over
  `src/**/*.test.tsx`. **Never jsdom** — see
  DECISIONS.md "Testing in a real browser, never jsdom".
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

The interface is built one slice at a time: **window bar → the frame (navigation, grid, pane)
→ navigation → grid and tiles → the pane → the visual direction → selection and moving → search
→ menus and dialogs → settings and the tags screen → empty states and guidance.**

Each slice builds two to four candidates that differ in **structure**, not colour. Claude
checks them in a real browser first; the user then picks one in the real window, the rest are
deleted, and what won is written into DECISIONS.md.

**Until the visual direction, the look is deliberately plain** — Windows metrics and neutral
greys — so each structure is judged on its own. That slice runs once the grid and the pane
show real pictures: the design skills shape two or three directions on the token layer, the
user picks one live, and it restyles every surface built before it.

**Candidates are compared live in `tauri dev`, never by screenshot.** The dev readout at the
bottom of the window switches between them instantly, by click or by the digit beside each, and
its last entry, compare, shows every candidate at once, each over dev-only stand-ins and still
driving the real window: side by side, or stacked at full width when the slice is a layout. The choice survives a reload; a production build always takes
the first candidate. **A turn that ends on a choice leaves `tauri dev` running** with the
candidates on it. When the user picks, the others and their picker entry are deleted.

## Porting from ggallery

ggallery, the private predecessor, sits beside this repository at `../ggallery` and holds a
tested implementation of most of what this app does. It is a reference only: nothing there is
edited, installed or run.

**Look there before building anything.** A feature is ported when its slice needs it, not ahead
of time, so each port is exercised as soon as it lands and stays small enough to review
properly. Interface logic that is not markup — the grid's layout maths, the query term helpers —
ports the same way; components and styles never do (DECISIONS.md "Built in slices, not ported").

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
| Scrub sprites | `media/sprites.rs`, `sidecar/ffmpeg.rs` `frames` | not yet scheduled: nothing shows one yet |
| Moving, renaming, undo | `fs/relocate.rs`, `fs/undo.rs`, `db/journal.rs`, `commands/triage.rs` | selection and moving |
| Trash | `fs/trash.rs` | selection and moving |
| Destination hotkeys | `db/hotkeys.rs`, `state/hotkeys.ts` | selection and moving |
| Watching the disk | `fs/watch.rs` | selection and moving |
| Search and the query language | `query/`, `db/search.rs`, `commands/search.rs`, `lib/queryTerm.ts` | search |
| The tags screen | `commands/tags.rs` | settings and the tags screen |
| Import, paste, export | `fs/import.rs`, `fs/paste.rs`, `fs/clipboard.rs`, `fs/export.rs` | not yet scheduled |
| Backups | `db/backup.rs` | not yet scheduled |

## Keeping the docs true

Comments cite headings in PRODUCT.md, DECISIONS.md, DEVELOPMENT.md and SCHEMA.md **by exact
title**, each pointer on one line. Renaming a heading orphans its callers, so rename and fix
them in the same commit.

**A comment runs three lines at most.** What a future edit would break silently stays in the
source; the reasoning goes in DECISIONS.md, and the comment names the section.

`check:docs` enforces both, over the source and the prose docs, and CI runs it.

## Gotchas

- **pnpm's package store is at `D:\.pnpm-store`**, its normal location when the project is on
  a different drive from the home folder. A cache, not configuration.
- **Windows' text-size setting scales all WebView2 content**, the way zoom does. So layouts
  answer to the width they are given, never to a device.
- **A migration runs with foreign keys off.** SQLite empties a table before dropping it, which
  fires `ON DELETE CASCADE` on everything referencing it. The pragma cannot change inside a
  transaction, so `db::migrate` switches it around them rather than in the SQL.
- **CI compiles Rust from scratch**; there is no build cache yet, which is most of its runtime.
