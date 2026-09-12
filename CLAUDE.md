@AGENTS.md

## Claude Code

- **Two skills are vendored in `.claude/skills/`.** `web-design-guidelines` audits a surface
  against a pinned local copy of the rules. `design-taste` supplies motion and interaction
  craft — read its PROJECT SCOPE block first; it proposes options, and the user chooses.
- **MCP servers are pinned in `.mcp.json`** and approved on first use. Playwright drives a
  real browser; shadcn reads component registries without writing files. Never run
  `npx shadcn add` — read the item and write the file yourself.
- **Plan first for anything in `src-tauri/`.** The Rust side moves the user's own files.
- **The shell keeps its working directory between calls**, so one `cd` leaks into every command
  after it. Use absolute paths. A command that strayed into ggallery once let pnpm rewrite its
  `node_modules`.
