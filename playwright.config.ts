import { defineConfig, devices } from "@playwright/test";

import { launchOptions, locale } from "./tests/browser.ts";

// Runs against Claude's own port. DEVELOPMENT.md "Seeing the app".
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    ...devices["Desktop Edge"],
    launchOptions,
    locale,
    baseURL: "http://localhost:1422",
    // A trace's DOM snapshots and screencast slow every passing test by a fifth. DEVELOPMENT.md "Tests".
    trace: { mode: "retain-on-failure", snapshots: false, screenshots: false },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 1422",
    url: "http://localhost:1422",
    reuseExistingServer: true,
  },
});
