import { mockIPC } from "@tauri-apps/api/mocks";
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { App } from "./App";

test("Close asks Tauri to close the window", async () => {
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
  });

  const screen = await render(<App />);
  await screen.getByRole("button", { name: "Close" }).click();

  expect(commands).toContain("plugin:window|close");
});

test("the gear opens Settings over the window, and Escape puts it away", async () => {
  mockIPC(() => undefined);
  const screen = await render(<App />);
  await screen.getByRole("button", { name: "Settings" }).click();
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  await expect.element(dialog).toBeVisible();
  const element = dialog.element() as HTMLDialogElement;

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => element.open).toBe(false);
  const gear = screen.getByRole("button", { name: "Settings" });
  await expect.element(gear).toHaveAttribute("aria-expanded", "false");
  await expect.element(gear).toHaveFocus();
});
