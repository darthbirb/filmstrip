import { fileURLToPath, URL } from "node:url";

import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, normalizePath } from "vite";

const worktrees = normalizePath(fileURLToPath(new URL("./.claude/worktrees", import.meta.url)));

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
  },
});
