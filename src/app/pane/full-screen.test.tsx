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

test("an open auto popover closes at Escape first, with the focus outside it; a manual one never holds full screen", async () => {
  const screen = await render(
    <>
      <Watcher />
      <div data-testid="auto" popover="auto">
        A list
      </div>
      <div data-testid="manual" popover="manual">
        Offers
      </div>
    </>,
  );
  const auto = screen.getByTestId("auto").element() as HTMLElement;
  const manual = screen.getByTestId("manual").element() as HTMLElement;
  setFullScreen(true);
  await expect.element(screen.getByText("full")).toBeVisible();

  auto.showPopover();
  expect(auto.contains(document.activeElement)).toBe(false);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => auto.matches(":popover-open")).toBe(false);
  expect(getFullScreen()).toBe(true);

  manual.showPopover();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByText("docked")).toBeVisible();
  expect(manual.matches(":popover-open")).toBe(true);
  manual.hidePopover();
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
