@AGENTS.md

## Claude Code

- **Skills in `.claude/skills/`:** `queue` runs the issue queue to empty, `deliver` builds one
  issue to an open pull request, `design-pass` draws the design backlog, `review` is the bar,
  `steward` drives pull requests. `web-design-guidelines`
  and `design-taste` are vendored craft references; read `design-taste`'s PROJECT SCOPE first.
- **The `reviewer` agent** in `.claude/agents/` reviews a pull request it did not write, and is
  the only one that sets its Review status.
- **MCP servers are pinned in `.mcp.json`.** Playwright drives a real browser; shadcn reads
  component registries without writing files. Never run `npx shadcn add` — read the item and
  write the file yourself.
- **Use absolute paths.** The shell keeps its working directory between calls, so one `cd`
  leaks into every command after it.
