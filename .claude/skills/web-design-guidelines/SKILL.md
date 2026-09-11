---
name: web-design-guidelines
description: Review UI code against the Web Interface Guidelines. Use when asked to review the UI, check accessibility, audit a surface, or check a screen before calling it done.
---

# Web Interface Guidelines

The rules are in `guidelines.md` beside this file — Vercel's Web Interface Guidelines,
vendored from `vercel-labs/web-interface-guidelines` at commit `e3d624b` (18 August 2026,
MIT, see `LICENSE`).

**Read the local file. Do not fetch anything.** The upstream copy lives on a moving branch,
so a fetch makes each review run against rules nobody reviewed.

## How to use it

1. Read `guidelines.md`.
2. Read the files under review.
3. Report findings as `file:line`, terse, grouped by file, no preamble.

This skill audits. It does not restyle, and it does not decide what a surface should look
like.

## What does not apply here

Filmstrip is a local desktop app in a WebView, so several rules are about a problem it does
not have: URL and deep-link state, hydration, safe-area insets, CDN preconnect, mobile zoom
and touch gestures. Skip them unless the surface genuinely has that concern, and say when you
have.

Where a guideline and `docs/DECISIONS.md` disagree, the decision wins and the disagreement is
worth reporting.
