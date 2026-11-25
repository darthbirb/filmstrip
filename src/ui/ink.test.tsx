import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { contrast, type Rgb } from "../lib/contrast";
import { CountPill } from "./Count";
import { NoteField } from "./NoteField";
import { Picker } from "./Picker";

// Text that tells you something is held to 4.5:1 where it is drawn. DESIGN.md "Colors".

/** A colour as the browser paints it, read back from one canvas pixel. */
function painted(colour: string): Rgb {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("no 2d canvas");
  context.fillStyle = colour;
  context.fillRect(0, 0, 1, 1);
  const [red = 0, green = 0, blue = 0] = context.getImageData(0, 0, 1, 1).data;
  return [red, green, blue];
}

const surface = (role: string) =>
  painted(getComputedStyle(document.documentElement).getPropertyValue(`--color-${role}`).trim());

function readable(element: Element, on: string, pseudo?: string) {
  const ink = painted(getComputedStyle(element, pseudo).color);
  return contrast(ink, surface(on));
}

test("Move to…'s current folder says its name and 'current' in ink that can be read", async () => {
  await render(
    <Picker
      label="Move to"
      placeholder="Find a folder"
      anchor={{ x: 10, y: 10 }}
      sections={[
        {
          rows: [
            { id: 1, label: "Cairo", glyph: "folder", depth: 0, detail: "current", disabled: true },
            { id: 2, label: "Luxor", glyph: "folder", depth: 0 },
          ],
        },
      ]}
      filter=""
      onFilter={() => undefined}
      onPick={() => undefined}
      onToggle={() => undefined}
      onClose={() => undefined}
    />,
  );
  const cairo = page.getByText("Cairo");
  await expect.element(cairo).toBeVisible();
  expect(readable(cairo.element(), "panel")).toBeGreaterThanOrEqual(4.5);
  expect(readable(page.getByText("current").element(), "panel")).toBeGreaterThanOrEqual(4.5);
});

test("a count's slash is read with its figures, at rest and on a row that cannot be picked", async () => {
  const screen = await render(
    <>
      <CountPill own={3} all={9} />
      <CountPill own={4} all={8} tone="barred" />
    </>,
  );
  const slashes = [...screen.container.querySelectorAll("[aria-hidden=true] > span")];
  expect(slashes.map((slash) => slash.textContent)).toEqual(["/", "/"]);
  for (const slash of slashes) {
    expect(readable(slash, "raised")).toBeGreaterThanOrEqual(4.5);
    expect(readable(slash.parentElement as Element, "raised")).toBeGreaterThanOrEqual(4.5);
  }
});

test("a note's box says its keys and its placeholder in ink that can be read", async () => {
  const screen = await render(
    <NoteField note={null} of="cover.jpg" onSave={() => Promise.resolve(null)} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add Note…" }));
  const box = screen.getByRole("textbox", { name: "Note on cover.jpg" });
  await expect.element(box).toBeVisible();
  const keys = screen.getByText("Ctrl+Enter saves · Escape abandons");
  expect(readable(keys.element(), "panel")).toBeGreaterThanOrEqual(4.5);
  expect(readable(box.element(), "ground", "::placeholder")).toBeGreaterThanOrEqual(4.5);
});
