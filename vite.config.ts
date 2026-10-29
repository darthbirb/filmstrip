import { dirname } from "node:path";
import { fileURLToPath, URL } from "node:url";

import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, normalizePath, searchForWorkspaceRoot } from "vite";

const here = normalizePath(dirname(fileURLToPath(import.meta.url)));
const worktrees = `${here}/.claude/worktrees`;
// A review worktree finds its packages in the checkout it sits in. DEVELOPMENT.md "Review".
const checkout = /^(.+)\/\.claude\/worktrees\/[^/]+$/.exec(here)?.[1];

// Tauri expects 1420; Claude's own server runs with --port 1422. DEVELOPMENT.md "Ports".
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", `${worktrees}/**`] },
    fs: {
      allow: [searchForWorkspaceRoot(here), ...(checkout ? [`${checkout}/node_modules`] : [])],
    },
  },
});
