import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Chip } from "./Chip";
import { Glyph } from "./Glyph";
import { Segmented } from "./Segmented";
import { Slider } from "./Slider";
import { THUMB_FRAME, ThumbFace } from "./Thumb";

test("a segmented control raises the choice made and reports the next one", async () => {
  const chose = vi.fn();
  const options = [
    { value: "rows", label: "Rows" },
    { value: "squares", label: "Squares" },
  ] as const;
  const screen = await render(
    <Segmented label="Layout" options={options} value="rows" onChange={chose} />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Rows" }))
    .toHaveAttribute("aria-pressed", "true");
  await screen.getByRole("button", { name: "Squares" }).click();
  expect(chose).toHaveBeenCalledWith("squares");
});

test("a slider steps with the arrow keys and fills its track to its value", async () => {
  const moved = vi.fn();
  const screen = await render(<Slider label="Size" min={6} max={20} value={13} onChange={moved} />);
  const slider = screen.getByRole("slider", { name: "Size" });
  expect(slider.element().style.getPropertyValue("--fill")).toBe("50%");
  await slider.click();
  await userEvent.keyboard("{ArrowRight}");
  expect(moved).toHaveBeenLastCalledWith(14);
});

test("a glyph draws as one bundled icon a square across, even inside capitals", async () => {
  const faces = await document.fonts.load('18px "Material Symbols Rounded"', "folder");
  expect(faces.length).toBeGreaterThan(0);
  const screen = await render(
    <span className="text-eyebrow uppercase">
      <Glyph name="folder" className="text-icon" />
    </span>,
  );
  const glyph = screen.container.querySelector(".glyph") as HTMLElement;
  const ink = document.createRange();
  ink.selectNodeContents(glyph);
  // Spelt out as letters, the name would run several times wider than the icon.
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
