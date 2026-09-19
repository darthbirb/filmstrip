import fillCss from "@phosphor-icons/web/fill/style.css?raw";
import regularCss from "@phosphor-icons/web/regular/style.css?raw";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Button } from "./Button";
import { Chip } from "./Chip";
import { Dropdown } from "./Dropdown";
import { Glyph } from "./Glyph";
import { GLYPHS } from "./glyphs";
import { THUMB_FRAME, ThumbFace } from "./Thumb";

/** The codepoint Phosphor's own stylesheet gives an icon in one family. */
function codeIn(css: string, family: string, icon: string) {
  const at = css.indexOf(`.${family}.ph-${icon}:before`);
  const match = at < 0 ? null : css.slice(at).match(/content:\s*"\\([0-9a-f]+)"/);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 16);
}

test("every glyph is the Phosphor icon it names, in both families", () => {
  for (const [name, { icon, code }] of Object.entries(GLYPHS)) {
    expect(codeIn(regularCss, "ph", icon), `${name} outlined`).toBe(code);
    expect(codeIn(fillCss, "ph-fill", icon), `${name} filled`).toBe(code);
  }
});

test("a glyph draws from a bundled face, one square across, even inside capitals", async () => {
  const folder = String.fromCodePoint(GLYPHS.folder.code);
  for (const face of ["Phosphor", "Phosphor-Fill"]) {
    const faces = await document.fonts.load(`18px "${face}"`, folder);
    expect(faces.length, face).toBeGreaterThan(0);
  }
  const screen = await render(
    <span className="text-eyebrow uppercase">
      <Glyph name="folder" filled className="text-icon" />
    </span>,
  );
  const glyph = screen.container.querySelector(".glyph") as HTMLElement;
  expect(getComputedStyle(glyph).fontFamily).toMatch(/^"?Phosphor-Fill/);
  const ink = document.createRange();
  ink.selectNodeContents(glyph);
  await expect.poll(() => ink.getBoundingClientRect().width).toBeCloseTo(18, 0);
});

test("a tile too narrow for the in-pane words keeps the mark alone", async () => {
  const screen = await render(
    <>
      <button type="button" className={THUMB_FRAME} style={{ width: 80, height: 120 }}>
        <ThumbFace current />
      </button>
      <button type="button" className={THUMB_FRAME} style={{ width: 240, height: 120 }}>
        <ThumbFace current />
      </button>
    </>,
  );
  const words = screen.getByText("In pane").elements();
  const shown = words.map((word) => getComputedStyle(word).display !== "none");
  expect(shown).toEqual([false, true]);
});

test("a label chip always shows its key, and a tag has none", async () => {
  const screen = await render(
    <>
      <Chip value="cairo" tagKey="location" />
      <Chip value="trips" inherited />
    </>,
  );
  await expect.element(screen.getByText("location", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("cairo", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("trips", { exact: true })).toBeVisible();
});

const LAYOUTS = [
  { value: "rows", label: "Rows" },
  { value: "squares", label: "Squares" },
] as const;

/** A dropdown that keeps what it is given, as its callers keep it in the preferences. */
function Choice({ onChange, align }: { onChange: (value: string) => void; align?: "end" }) {
  const [value, setValue] = useState<"rows" | "squares">("rows");
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 80 }}>
      <Dropdown
        label="Layout"
        options={LAYOUTS}
        value={value}
        align={align}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    </div>
  );
}

test("a dropdown names its choice, opens onto all of them, and reports the one picked", async () => {
  const chose = vi.fn();
  const screen = await render(<Choice onChange={chose} />);
  await screen.getByRole("button", { name: "Layout: Rows" }).click();
  const menu = screen.getByRole("listbox", { name: "Layout" });
  await expect.element(menu).toBeVisible();
  const opened = menu.element();
  await expect
    .element(menu.getByRole("option", { name: "Rows" }))
    .toHaveAttribute("aria-selected", "true");

  await menu.getByRole("option", { name: "Squares" }).click();
  expect(chose).toHaveBeenCalledWith("squares");
  await expect.poll(() => opened.matches(":popover-open")).toBe(false);
  await expect.element(screen.getByRole("button", { name: "Layout: Squares" })).toHaveFocus();
});

test("the keyboard opens a dropdown, moves through it, and Escape puts it away", async () => {
  const chose = vi.fn();
  const screen = await render(<Choice onChange={chose} />);
  const menu = screen.getByRole("listbox", { name: "Layout" });
  await userEvent.tab();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(menu.getByRole("option", { name: "Rows" })).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(chose).toHaveBeenCalledWith("squares");

  await userEvent.keyboard("{ArrowDown}");
  await expect.element(menu).toBeVisible();
  const opened = menu.element();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => opened.matches(":popover-open")).toBe(false);
  await expect.element(screen.getByRole("button", { name: "Layout: Squares" })).toHaveFocus();
});

test("an open menu sits just under its button, lined up with the edge it is given", async () => {
  const screen = await render(<Choice onChange={() => undefined} align="end" />);
  const button = screen.getByRole("button", { name: "Layout: Rows" });
  await button.click();
  const below = button.element().getBoundingClientRect();
  const menu = screen.getByRole("listbox", { name: "Layout" }).element().getBoundingClientRect();
  expect(menu.top).toBeGreaterThanOrEqual(below.bottom);
  expect(menu.top - below.bottom).toBeLessThan(8);
  expect(Math.abs(menu.right - below.right)).toBeLessThan(1);
  expect(menu.width).toBeGreaterThanOrEqual(below.width);
});

test("a button keeps its label on one line, however little room it is given", async () => {
  const screen = await render(
    <div style={{ width: "5rem" }}>
      <Button glyph="plus" onClick={() => {}}>
        Add a folder…
      </Button>
    </div>,
  );
  const button = screen.getByRole("button").element() as HTMLElement;
  const line = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) * 2;
  expect(button.getBoundingClientRect().height).toBeCloseTo(line, 0);
  // Narrower than the label, so what it cannot show it ends rather than wrapping.
  const label = button.querySelector(".truncate") as HTMLElement;
  expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
});
