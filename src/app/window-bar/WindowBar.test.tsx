import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { WINDOW_BARS } from ".";

const BARS = Object.entries(WINDOW_BARS);

function recordIPC({ maximized = false } = {}) {
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
    return cmd === "plugin:window|is_maximized" ? maximized : undefined;
  });
  return commands;
}

afterEach(() => {
  document.documentElement.style.fontSize = "";
});

test.each(BARS)("%s: each caption button asks Tauri for its action", async (_, Bar) => {
  const commands = recordIPC();
  const screen = await render(<Bar />);
  for (const name of ["Minimise", "Maximise", "Close"]) {
    await screen.getByRole("button", { name }).click();
  }
  expect(commands).toEqual(
    expect.arrayContaining([
      "plugin:window|minimize",
      "plugin:window|toggle_maximize",
      "plugin:window|close",
    ]),
  );
});

test.each(BARS)("%s: a maximised window offers Restore instead", async (_, Bar) => {
  recordIPC({ maximized: true });
  const screen = await render(<Bar />);
  await expect.element(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
});

test.each(BARS)("%s: the bar is sized in rem, so it follows the text size", async (_, Bar) => {
  recordIPC();
  const screen = await render(<Bar />);
  const bar = screen.getByRole("banner").element();
  const at16 = bar.getBoundingClientRect().height;
  document.documentElement.style.fontSize = "24px";
  expect(bar.getBoundingClientRect().height).toBeCloseTo(at16 * 1.5);
});

test.each(BARS)("%s: nothing is cut off in the narrowest window", async (_, Bar) => {
  recordIPC();
  await page.viewport(640, 480);
  const screen = await render(<Bar />);
  const bar = screen.getByRole("banner").element();
  expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  for (const button of screen.getByRole("button").elements()) {
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(640);
  }
});
