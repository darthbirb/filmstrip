import { defineConfig, devices } from "@playwright/test";

// Runs against Claude's own port and the installed Edge. DEVELOPMENT.md "Seeing the app".
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    ...devices["Desktop Edge"],
    channel: "msedge",
    baseURL: "http://localhost:1422",
  },
  webServer: {
    command: "npm run dev -- --port 1422",
    url: "http://localhost:1422",
    reuseExistingServer: true,
  },
});
