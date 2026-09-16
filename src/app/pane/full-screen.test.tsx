import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  getFullScreen,
  setFullScreen,
  useEscapeLeavesFullScreen,
  useFullScreen,
} from "./full-screen";

/** Stands for the app, which holds the state and listens for the key that leaves it. */
function Watcher() {
  const full = useFullScreen();
  useEscapeLeavesFullScreen();
  return <p>{full ? "full" : "docked"}</p>;
}

beforeEach(() => {
  setFullScreen(false);
});

test("Escape leaves full screen, and is not listened for the rest of the time", async () => {
  const screen = await render(<Watcher />);
  await expect.element(screen.getByText("docked")).toBeVisible();

  // Nothing is entered, so the key belongs to whatever else wants it.
  await userEvent.keyboard("{Escape}");
  expect(getFullScreen()).toBe(false);

  setFullScreen(true);
  await expect.element(screen.getByText("full")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByText("docked")).toBeVisible();
  expect(getFullScreen()).toBe(false);
});
