import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Menu, type MenuGroups, useContextMenu } from "./Menu";

const rem = () => Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** One element with a right-click menu, placed where the test says. */
function Surface({
  groups,
  at = { left: 40, top: 40 },
}: {
  groups: MenuGroups;
  at?: { left?: number; top?: number; right?: number; bottom?: number };
}) {
  const context = useContextMenu();
  return (
    <>
      <button
        type="button"
        style={{ position: "fixed", width: 120, height: 80, ...at }}
        onContextMenu={(event) => context.open(event, "Thing", groups)}
      >
        thing
      </button>
      {context.menu}
    </>
  );
}

const rows = (onSelect = () => {}): MenuGroups => [
  [{ id: "a", label: "Full Screen", glyph: "fullScreen", onSelect }],
  [],
  [
    { id: "b", label: "Copy", glyph: "copy", onSelect },
    { id: "c", label: "Delete", glyph: "trash", tone: "danger", onSelect },
  ],
];

async function openByKeyboard(screen: Awaited<ReturnType<typeof render>>) {
  const thing = screen.getByRole("button", { name: "thing" });
  (thing.element() as HTMLElement).focus();
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  const menu = screen.getByRole("menu", { name: "Thing" });
  await expect.element(menu).toBeVisible();
  return { thing: thing.element().getBoundingClientRect(), menu };
}

test("a menu is the drawn shape: 14rem wide, 2rem rows, one rule between groups that hold something", async () => {
  await page.viewport(1000, 700);
  const screen = await render(<Surface groups={rows()} />);
  const { menu } = await openByKeyboard(screen);
  const box = menu.element().getBoundingClientRect();
  expect(box.width).toBeCloseTo(14 * rem(), 0);
  const [first] = menu.getByRole("menuitem").elements();
  expect(first?.getBoundingClientRect().height).toBeCloseTo(2 * rem(), 0);
  // The empty group between the other two leaves no second rule behind.
  expect(menu.element().querySelectorAll("hr")).toHaveLength(1);
  expect(getComputedStyle(menu.element()).backgroundColor).toBe(hexToRgb(token("--color-panel")));
  const danger = menu.getByRole("menuitem", { name: "Delete" }).element();
  expect(getComputedStyle(danger).color).toBe(hexToRgb(token("--color-danger")));
});

test("the ⋯ menu wears the same shape", async () => {
  const screen = await render(<Menu label="More" glyph="more" groups={rows()} align="start" />);
  await screen.getByRole("button", { name: "More" }).click();
  const menu = screen.getByRole("menu", { name: "More" });
  await expect.element(menu).toBeVisible();
  expect(menu.element().getBoundingClientRect().width).toBeCloseTo(14 * rem(), 0);
  expect(getComputedStyle(menu.element()).backgroundColor).toBe(hexToRgb(token("--color-panel")));
});

test("a right-click opens the menu where the pointer is", async () => {
  await page.viewport(1000, 700);
  const screen = await render(<Surface groups={rows()} />);
  const thing = screen.getByRole("button", { name: "thing" });
  await thing.click({ button: "right" });
  const menu = screen.getByRole("menu", { name: "Thing" });
  await expect.element(menu).toBeVisible();
  const box = thing.element().getBoundingClientRect();
  const opened = menu.element().getBoundingClientRect();
  // Playwright clicks the middle of the element.
  expect(opened.left).toBeCloseTo(box.left + box.width / 2, 0);
  expect(opened.top).toBeCloseTo(box.top + box.height / 2, 0);
});

test("the keyboard's menu meets the element's left edge, one tile-gap clear of its ring", async () => {
  await page.viewport(1000, 700);
  const screen = await render(<Surface groups={rows()} />);
  const { thing, menu } = await openByKeyboard(screen);
  const opened = menu.element().getBoundingClientRect();
  const ring = Number.parseFloat(token("--focus-width")) + Number.parseFloat(token("--focus-gap"));
  expect(opened.left).toBeCloseTo(thing.left, 0);
  expect(opened.top - thing.bottom).toBeCloseTo(ring + 0.375 * rem(), 0);
});

test("with no room below it flips above the element, and at the window's edge slides along it", async () => {
  await page.viewport(1000, 700);
  const screen = await render(<Surface groups={rows()} at={{ right: 8, bottom: 8 }} />);
  const { thing, menu } = await openByKeyboard(screen);
  const opened = menu.element().getBoundingClientRect();
  const ring = Number.parseFloat(token("--focus-width")) + Number.parseFloat(token("--focus-gap"));
  expect(thing.bottom + ring + opened.height).toBeGreaterThan(window.innerHeight);
  expect(thing.top - opened.bottom).toBeCloseTo(ring + 0.375 * rem(), 0);
  expect(opened.right).toBeCloseTo(window.innerWidth, 0);
  expect(opened.width).toBeCloseTo(14 * rem(), 0);
});

test("Escape closes it and the focus goes back; a choice runs and the focus goes back too", async () => {
  const chosen = vi.fn();
  const screen = await render(<Surface groups={rows(chosen)} />);
  const thing = screen.getByRole("button", { name: "thing" });
  await openByKeyboard(screen);
  await expect.element(screen.getByRole("menuitem", { name: "Full Screen" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("menu", { name: "Thing" })).not.toBeInTheDocument();
  await expect.element(thing).toHaveFocus();

  await openByKeyboard(screen);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(chosen).toHaveBeenCalledOnce();
  await expect.element(thing).toHaveFocus();
});

test("a menu with nothing in it opens nothing", async () => {
  const screen = await render(<Surface groups={[[], []]} />);
  await screen.getByRole("button", { name: "thing" }).click({ button: "right" });
  await new Promise((settle) => setTimeout(settle, 100));
  expect(screen.getByRole("menu").elements()).toHaveLength(0);
});

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}
