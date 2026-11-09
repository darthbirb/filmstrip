import { defineConfig, devices } from "@playwright/test";

import { launchOptions, locale } from "./tests/browser.ts";

const origin = "http://127.0.0.1:1422";

// Runs against Claude's own port, at the one address Vite listens on. DEVELOPMENT.md "Tests".
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    ...devices["Desktop Edge"],
    launchOptions,
    locale,
    baseURL: origin,
    // DOM snapshots and the screencast slow every passing test by a fifth; without snapshots the
    // trace has no network log either. DEVELOPMENT.md "Tests".
    trace: { mode: "retain-on-failure", snapshots: false, screenshots: false },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 1422",
    url: origin,
    reuseExistingServer: true,
  },
});
