import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { getPreferences, loadPreferences, useScaleHotkeys } from "./preferences";

let saved: unknown[] = [];
let stored: unknown = null;

beforeEach(async () => {
  saved = [];
  stored = null;
  mockIPC((cmd, payload) => {
    if (cmd === "ui_preferences") return stored;
    if (cmd === "set_ui_preferences") saved.push((payload as { preferences: unknown }).preferences);
    return null;
  });
  await loadPreferences();
});

function Hotkeys() {
  useScaleHotkeys();
  return null;
}

test("Ctrl+= and Ctrl+- step the interface size, Ctrl+0 resets it, and the choice is saved", async () => {
  await render(<Hotkeys />);
  await userEvent.keyboard("{Control>}={/Control}");
  expect(document.documentElement.style.fontSize).toBe("110%");
  await userEvent.keyboard("{Control>}={/Control}");
  expect(getPreferences().scale).toBe(1.25);
  await userEvent.keyboard("{Control>}-{/Control}");
  expect(getPreferences().scale).toBe(1.1);
  await expect.poll(() => saved.at(-1)).toMatchObject({ scale: 1.1 });

  await userEvent.keyboard("{Control>}0{/Control}");
  expect(document.documentElement.style.fontSize).toBe("");
});

test("the size stops at its smallest and largest steps", async () => {
  await render(<Hotkeys />);
  for (let press = 0; press < 12; press++) await userEvent.keyboard("{Control>}={/Control}");
  expect(getPreferences().scale).toBe(2);
  for (let press = 0; press < 12; press++) await userEvent.keyboard("{Control>}-{/Control}");
  expect(getPreferences().scale).toBe(0.8);
});

test("saved preferences come back, and anything malformed falls back to the defaults", async () => {
  stored = {
    scale: 1.25,
    widths: { nav: 18, pane: 22 },
    hidden: { nav: false, pane: true },
    layout: "uniform",
  };
  await loadPreferences();
  expect(getPreferences()).toMatchObject({
    scale: 1.25,
    widths: { nav: 18, pane: 22 },
    layout: "uniform",
  });
  expect(document.documentElement.style.fontSize).toBe("125%");

  stored = { scale: 7, widths: { nav: "wide" }, hidden: "yes", layout: "masonry" };
  await loadPreferences();
  expect(getPreferences()).toEqual({ scale: 1 });
});
