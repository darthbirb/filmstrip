import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import { launchOptions, locale } from "./tests/browser.ts";
import viteConfig from "./vite.config.ts";

const TIMING = "src/**/*.timing.test.{ts,tsx}";

/**
 * Component tests run in a real browser, never jsdom; timing tests run apart, one file at a time.
 * DEVELOPMENT.md "Tests".
 */
export function suite(timing: boolean) {
  return mergeConfig(
    viteConfig,
    defineConfig({
      // Found mid-run on a cold cache, it reloads the page and kills a test in flight.
      // DEVELOPMENT.md "Gotchas".
      optimizeDeps: { include: ["react-dom/client", "@tauri-apps/api/webview"] },
      test: {
        include: timing ? [TIMING] : ["src/**/*.test.{ts,tsx}"],
        exclude: timing ? configDefaults.exclude : [...configDefaults.exclude, TIMING],
        fileParallelism: !timing,
        setupFiles: ["./src/dev/test-setup.ts"],
        browser: {
          enabled: true,
          headless: true,
          provider: playwright({ launchOptions, contextOptions: { locale } }),
          instances: [{ browser: "chromium" }],
        },
      },
    }),
  );
}

export default suite(false);
