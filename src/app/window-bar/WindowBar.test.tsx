import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { WindowBar } from "./WindowBar";

function recordIPC({ maximized = false } = {}) {
  const commands: string[] = [];
  mockIPC(
    (cmd) => {
      commands.push(cmd);
      return cmd === "plugin:window|is_maximized" ? maximized : undefined;
    },
    { shouldMockEvents: true },
  );
  return commands;
}

afterEach(() => {
  document.documentElement.style.fontSize = "";
});

test("each caption button asks Tauri for its action", async () => {
  const commands = recordIPC();
  const screen = await render(<WindowBar />);
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

test("a maximised window offers Restore instead", async () => {
  recordIPC({ maximized: true });
  const screen = await render(<WindowBar />);
  await expect.element(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
});

test("the bar dims while another window has focus", async () => {
  recordIPC();
  const screen = await render(<WindowBar />);
  const close = screen.getByRole("button", { name: "Close" }).element();
  const colour = () => getComputedStyle(close).color;
  // A token as the browser paints it, so its spelling in the stylesheet does not matter.
  const token = (name: string) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const painted = getComputedStyle(probe).color;
    probe.remove();
    return painted;
  };
  // Rest the pointer on the bar itself, so no button is hovered.
  await userEvent.hover(screen.getByRole("banner"));

  await expect.poll(colour).toBe(token("--color-fg-mid"));
  await emit("tauri://blur");
  await expect.poll(colour).toBe(token("--color-fg-faint"));
  await emit("tauri://focus");
  await expect.poll(colour).toBe(token("--color-fg-mid"));
});

test("the bar is sized in rem, so it follows the text size", async () => {
  recordIPC();
  const screen = await render(<WindowBar />);
  const bar = screen.getByRole("banner").element();
  expect(bar.getBoundingClientRect().height).toBe(36);
  document.documentElement.style.fontSize = "24px";
  expect(bar.getBoundingClientRect().height).toBe(54);
});

test("nothing is cut off in the narrowest window", async () => {
  recordIPC();
  await page.viewport(640, 480);
  const screen = await render(<WindowBar />);
  const bar = screen.getByRole("banner").element();
  expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  for (const button of screen.getByRole("button").elements()) {
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(640);
  }
});

test("search sits centred on the window, and narrows before anything is cut off", async () => {
  recordIPC();
  await page.viewport(1600, 400);
  const screen = await render(
    <WindowBar search={<div data-testid="search" className="h-full w-full" />} />,
  );
  const search = screen.getByTestId("search").element();
  const wide = search.getBoundingClientRect();
  expect(Math.abs(wide.left + wide.width / 2 - 800)).toBeLessThan(1);

  await page.viewport(640, 400);
  await expect.poll(() => search.getBoundingClientRect().width).toBeLessThan(wide.width);
  const bar = screen.getByRole("banner").element();
  expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
  for (const button of screen.getByRole("button").elements()) {
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(640);
  }
});
