import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

// Component tests run in the installed Edge, never jsdom. DEVELOPMENT.md "Tests".
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Found mid-run on a cold cache, it reloads the page and kills a test in flight.
    // DEVELOPMENT.md "Gotchas".
    optimizeDeps: { include: ["react-dom/client"] },
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["./src/dev/test-setup.ts"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ launchOptions: { channel: "msedge" } }),
        instances: [{ browser: "chromium" }],
      },
    },
  }),
);
