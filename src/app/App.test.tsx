import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { App } from "./App";
import { CANDIDATE_KEY } from "./candidates";

const KEY = `${CANDIDATE_KEY}window-bar`;

beforeEach(() => {
  localStorage.removeItem(KEY);
});

test("Close asks Tauri to close the window", async () => {
  localStorage.setItem(KEY, "strip");
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
  });

  const screen = await render(<App />);
  await screen.getByRole("button", { name: "Close" }).click();

  expect(commands).toContain("plugin:window|close");
});

test("the dev readout compares every candidate, then switches between them live", async () => {
  const screen = await render(<App />);
  expect(screen.getByRole("button", { name: "Close" }).elements()).toHaveLength(3);

  await screen.getByRole("button", { name: "2 tall" }).click();
  const [tall] = screen.getByRole("banner").elements();
  expect(screen.getByRole("banner").elements()).toHaveLength(1);
  expect(tall?.getBoundingClientRect().height).toBe(48);

  await userEvent.keyboard("3");
  await expect
    .element(screen.getByRole("button", { name: "3 receding" }))
    .toHaveAttribute("aria-pressed", "true");
  expect(localStorage.getItem(KEY)).toBe("receding");
});
