/**
 * The browser every test drives. On Windows it is the installed Edge, the same engine as the
 * app's WebView2; elsewhere Playwright's Chromium, or the build CHROMIUM_PATH names.
 * DEVELOPMENT.md "Tests".
 */
export const launchOptions =
  process.platform === "win32"
    ? { channel: "msedge" }
    : process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {};

/** Dates and numbers follow the browser's locale; one fixed locale reads the same everywhere. */
export const locale = "en-GB";
