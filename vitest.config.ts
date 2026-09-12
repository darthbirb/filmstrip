import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config.ts";

// Component tests run in the installed Edge, never jsdom. DEVELOPMENT.md "Tests".
export default mergeConfig(
  viteConfig,
  defineConfig({
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
