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
| `cargo check --manifest-path src-tauri/Cargo.toml` | the Rust gate |

## Ports

**1420 belongs to `tauri dev`** and is pinned with `strictPort` in `vite.config.ts`, because
Tauri expects a fixed port. **Claude's own dev server runs on 1422**, pinned in
`.claude/launch.json`, so the two never collide. Stop a server you started before ending a
turn.

## Seeing the app

Three ways, cheapest first.

1. **A browser, against mocks.** `dev` serves the app, and `src/dev/mock.ts` installs Tauri's
   own `mockIPC` and `mockWindows` when `__TAURI_INTERNALS__` is absent and the build is a dev
   build. Good enough for layout, states and copy. It is dev-only, and the production bundle
   is checked to contain none of it.
2. **The Playwright MCP.** It drives a headed browser, so time actually passes there and its
   screenshots come back as images that can be looked at. **The editor's Browser pane cannot
   do this**: it never draws, so it takes no screenshots, fires no animation frames, and a CSS
   transition never advances in it. Use the pane only to start a server.
3. **The real window.** `tauri dev`, then attach Playwright over the Chrome DevTools Protocol
   at `http://127.0.0.1:9322`. `src-tauri/src/lib.rs` opens that port in **debug builds only**.
   Verified on 12 September 2026: the page reported real Tauri, `dpr 1.5`, viewport 1280×820.

## Tests

- **Component tests** run in Vitest's browser mode on Edge (`channel: "msedge"`), over
  `src/**/*.test.tsx`. **Never jsdom** — see DECISIONS.md "Testing in a real browser, never
  jsdom".
- **End-to-end tests** run in Playwright over `tests/e2e`, against the dev server on 1422.
  Screenshots land in `test-results/`, which is git-ignored.
- **A check proves something at more than one size.** Sweep widths, and fail on any console
  error. One size proves one size.

## Layout

```
src/app/       composition — the shell and its surfaces
src/ui/        primitives; they own every visual decision (created with the first one)
src/lib/       framework-free logic
src/styles/    app.css — the token layer
src/dev/       mocks, dev builds only
src-tauri/     the Rust side
tests/e2e/     Playwright
```

## Slices

The interface is built one slice at a time: **window bar → the frame (navigation, grid, pane)
→ navigation → grid and tiles → the pane → selection and moving → search → menus and dialogs
→ settings and the tags screen → empty states and guidance.**

Each slice builds two to four candidates that differ in **structure**, not colour. Claude
checks them in a real browser first; the user then picks one in the real window, the rest are
deleted, and what won is written into DECISIONS.md.

The bar in `src/app/App.tsx` is scaffolding, not a candidate — with native decorations off,
something has to move and close the window. The window-bar slice deletes it.

## Keeping the docs true

Comments in the source cite headings in this file and in DECISIONS.md **by exact title**.
Renaming a heading orphans every one of them and nothing fails, so rename and fix the callers
in the same commit. **Keep each pointer on one line** — a title wrapped across a line break
is invisible to this search. To find them:

```bash
grep -rn 'DECISIONS.md "\|DEVELOPMENT.md "' src src-tauri
```

## Gotchas

- **pnpm's package store is at `D:\.pnpm-store`**, its normal location when the project is on
  a different drive from the home folder. A cache, not configuration.
- **Windows' text-size setting scales all WebView2 content**, the way zoom does. So layouts
  answer to the width they are given, never to a device.
- **CI compiles Rust from scratch**; there is no build cache yet, which is most of its runtime.
