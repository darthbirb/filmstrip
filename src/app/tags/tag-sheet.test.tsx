import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import { folderItems, undoLast } from "../../ipc/commands";
import { Grid } from "../grid/Grid";
import { SelectionBar } from "../grid/SelectionBar";
import { checkAll, clearChecked } from "../grid/selection";
import { getNews, setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { type Place, setPlace } from "../place";
import { undo } from "../undo/undo";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg, none tagged of
// their own. Pictures gives its name, Trips its name, travel and trip:egypt 2024, and Cairo its
// name, egypt and location:cairo.

const CAIRO: Place = {
  kind: "folder",
  sourceId: 1,
  path: [
    { id: 1, title: "Pictures" },
    { id: 4, title: "Trips" },
    { id: 6, title: "Cairo" },
  ],
};

beforeEach(async () => {
  while (await undoLast()) {}
  setNews(null);
  resetIndex();
  await loadIndex();
  setPlace(CAIRO);
  clearChecked();
});

async function renderGrid(width = 900) {
  await page.viewport(1200, 800);
  render(
    <div
      data-testid="frame"
      style={{ display: "flex", flexDirection: "column", width, height: 700 }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <Grid mode="uniform" />
      </div>
      <SelectionBar />
    </div>,
  );
  await expect.element(page.getByRole("button", { name: "sphinx.jpg" })).toBeVisible();
}

const box = (name: string) => page.getByRole("checkbox", { name: `Check ${name}` });
const bar = () => page.getByRole("toolbar", { name: "Selection" });
const tagButton = () => bar().getByRole("button", { name: "Tag…" }).last();
const sheet = (count: number) => page.getByRole("dialog", { name: `Tag ${count} Files` });
const field = (count: number) => page.getByRole("combobox", { name: `Add Tag to ${count} Files` });
const headings = () =>
  [...document.querySelectorAll("[role=dialog] section")].map((one) =>
    one.getAttribute("aria-label"),
  );
const own = () =>
  [...document.querySelectorAll("[role=dialog] section[data-own] [data-stop]")].map((chip) =>
    chip.getAttribute("aria-label"),
  );
const line = () => {
  const news = getNews();
  return news?.kind === "done" || news?.kind === "undone" ? news.line : null;
};
const cairo = async () => (await folderItems(6)).map((row) => row.id);

async function openOnAll() {
  await renderGrid();
  await userEvent.click(box("felucca.mp4"));
  checkAll();
  await expect.element(bar().getByText("3 Files", { exact: true }).last()).toBeVisible();
  await userEvent.click(tagButton());
  await expect.element(sheet(3)).toBeVisible();
}

test("Tag… opens over the grid with the field focused, and what the set inherits under each folder", async () => {
  await openOnAll();

  await expect.element(field(3)).toHaveFocus();
  await expect.element(tagButton()).toHaveAttribute("aria-expanded", "true");
  await expect.poll(headings).toEqual(["From Pictures", "From Trips", "From Cairo"]);
  // What a folder gives comes off at the folder, so it has neither + nor ×.
  expect(sheet(3).getByRole("button").elements()).toEqual([]);
  const drawn = sheet(3).element().getBoundingClientRect();
  const button = tagButton().element().getBoundingClientRect();
  expect(drawn.bottom).toBeLessThan(button.top);
  expect(drawn.left).toBeCloseTo(button.left, 0);

  await userEvent.click(tagButton());
  await expect.element(sheet(3)).not.toBeInTheDocument();
  await expect.element(tagButton()).toHaveAttribute("aria-expanded", "false");
});

test("Enter adds the tag to every file as one batch, with the Line, and Undo takes it off again", async () => {
  await openOnAll();
  await recording(async (calls) => {
    await userEvent.type(field(3), "Golden  Hour{Enter}");
    await expect
      .poll(() => calls.find(([cmd]) => cmd === "add_items_tag")?.[1])
      .toEqual({ itemIds: await cairo(), value: "golden hour" });
  });

  await expect.poll(own).toEqual(["golden hour"]);
  expect(headings()[0]).toBe("Their Own");
  await expect.poll(line).toBe("Added golden hour to 3 files.");
  await expect.element(field(3)).toHaveFocus();
  await expect.element(field(3)).toHaveValue("");

  await undo();
  await expect.poll(own).toEqual([]);
  expect(line()).toBe("golden hour is off 3 files again.");
});

test("a chip on some of the set adds to the rest, and × takes it off every file that has it", async () => {
  await renderGrid();
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(tagButton());
  await userEvent.type(page.getByRole("combobox", { name: "Add Tag to 1 File" }), "dawn{Enter}");
  await expect.poll(own).toEqual(["dawn"]);
  await userEvent.keyboard("{Escape}");
  checkAll();
  await expect.element(bar().getByText("3 Files", { exact: true }).last()).toBeVisible();
  await userEvent.click(tagButton());

  const chip = sheet(3).getByRole("button", { name: "dawn, 1 of 3" });
  await expect.element(chip).toBeVisible();
  expect(chip.element().tagName).toBe("BUTTON");
  expect(chip.element().querySelector("button, [role=button]")).toBeNull();
  await userEvent.hover(chip);
  await userEvent.click(sheet(3).getByRole("button", { name: "Add to the Other 2" }));
  await expect.poll(own).toEqual(["dawn"]);
  await expect.poll(line).toBe("Added dawn to 2 files.");

  const all = sheet(3).getByRole("button", { name: "dawn", exact: true });
  await userEvent.hover(all);
  await recording(async (calls) => {
    await userEvent.click(sheet(3).getByRole("button", { name: "Remove from 3 Files" }));
    await expect
      .poll(() => calls.find(([cmd]) => cmd === "remove_items_tag")?.[1])
      .toMatchObject({ itemIds: await cairo() });
  });
  await expect.poll(own).toEqual([]);
  expect(headings()[0]).toBe("From Pictures");
  await expect.poll(line).toBe("Took dawn off 3 files.");

  await undo();
  await expect.poll(own).toEqual(["dawn"]);
});

test("a tag every checked file carries is refused where it is typed, and says whose it is", async () => {
  await openOnAll();
  await recording(async (calls) => {
    await userEvent.type(field(3), "egypt{Enter}");
    await expect.element(sheet(3).getByText("All 3 already have egypt, from Cairo.")).toBeVisible();
    await expect.element(field(3)).toHaveAttribute("aria-invalid", "true");
    expect(calls.some(([cmd]) => cmd === "add_items_tag")).toBe(false);
  });
});

test("from the keyboard Tab reaches the set's own, Delete takes one off, and Escape goes back to Tag…", async () => {
  await openOnAll();
  await userEvent.type(field(3), "dawn{Enter}");
  await expect.poll(own).toEqual(["dawn"]);

  await userEvent.keyboard("{Tab}");
  await expect.element(sheet(3).getByRole("button", { name: "dawn", exact: true })).toHaveFocus();
  await userEvent.keyboard("{Delete}");
  await expect.poll(own).toEqual([]);
  await expect.poll(line).toBe("Took dawn off 3 files.");

  await userEvent.keyboard("{Escape}");
  await expect.element(sheet(3)).not.toBeInTheDocument();
  await expect.element(tagButton()).toHaveFocus();
});

test("Tag… on the set's right-click menu opens the same sheet against the bar", async () => {
  await renderGrid();
  await userEvent.click(box("pyramid.jpg"));
  await userEvent.click(box("sphinx.jpg"));
  await userEvent.click(page.getByRole("button", { name: "sphinx.jpg", exact: true }), {
    button: "right",
  });
  await userEvent.click(page.getByRole("menuitem", { name: "Tag…" }));
  await expect.element(sheet(2)).toBeVisible();
  await expect.element(field(2)).toHaveFocus();
});

const more = () => bar().getByRole("button", { name: "More" }).last();
const outline = (count: number) => getComputedStyle(field(count).element()).outlineStyle;
const metAbove = (count: number, button: Element) => {
  const drawn = sheet(count).element().getBoundingClientRect();
  const at = button.getBoundingClientRect();
  expect(drawn.bottom).toBeLessThan(at.top);
  expect(drawn.left).toBeCloseTo(at.left, 0);
};

test("at the grid's narrowest Tag… on More opens the sheet against More, and Escape goes back to it", async () => {
  await renderGrid(320);
  await userEvent.click(box("felucca.mp4"));
  checkAll();
  await userEvent.click(more());
  await userEvent.click(page.getByRole("menuitem", { name: "Tag…" }));

  await expect.element(sheet(3)).toBeVisible();
  await expect.element(field(3)).toHaveFocus();
  metAbove(3, more().element());
  await userEvent.keyboard("{Escape}");
  await expect.element(sheet(3)).not.toBeInTheDocument();
  await expect.element(more()).toHaveFocus();
});

test("while it is open the sheet follows Tag… into More, and stays half the grid's height", async () => {
  await openOnAll();
  const frame = page.getByTestId("frame").element() as HTMLElement;

  frame.style.width = "320px";
  await expect.element(more()).toBeVisible();
  await expect.element(tagButton()).not.toBeInTheDocument();
  await expect
    .poll(() => sheet(3).element().getBoundingClientRect().left)
    .toBeCloseTo(more().element().getBoundingClientRect().left, 0);
  metAbove(3, more().element());

  frame.style.height = "400px";
  const grid = () => frame.firstElementChild?.clientHeight ?? 0;
  await expect
    .poll(() => Number.parseFloat(getComputedStyle(sheet(3).element()).maxHeight))
    .toBeCloseTo(grid() / 2, 0);
  expect(grid()).toBeLessThan(400);

  frame.style.width = "900px";
  await expect.element(tagButton()).toBeVisible();
  await expect
    .poll(() => sheet(3).element().getBoundingClientRect().left)
    .toBeCloseTo(tagButton().element().getBoundingClientRect().left, 0);
  await userEvent.keyboard("{Escape}");
  await expect.element(tagButton()).toHaveFocus();
});

test("a click opens the field with no ring, and the keyboard's arrival draws it", async () => {
  await openOnAll();
  await expect.element(field(3)).toHaveFocus();
  expect(outline(3)).toBe("none");

  await userEvent.type(field(3), "dawn{Enter}");
  await expect.poll(own).toEqual(["dawn"]);
  expect(outline(3)).toBe("none");
  await userEvent.keyboard("{Tab}");
  await expect.element(sheet(3).getByRole("button", { name: "dawn", exact: true })).toHaveFocus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(field(3)).toHaveFocus();
  expect(outline(3)).toBe("solid");

  await userEvent.click(field(3));
  expect(outline(3)).toBe("none");
});

test("Tag… opened with Enter opens the field ringed", async () => {
  await renderGrid();
  await userEvent.click(box("felucca.mp4"));
  checkAll();
  await expect.element(bar().getByText("3 Files", { exact: true }).last()).toBeVisible();
  tagButton().element().focus();
  await userEvent.keyboard("{Enter}");

  await expect.element(field(3)).toHaveFocus();
  expect(outline(3)).toBe("solid");
});

test("while what the set carries is read, stand-ins hold Their Own and the source's own folder", async () => {
  await renderGrid();
  await userEvent.click(box("felucca.mp4"));
  checkAll();
  await expect.element(bar().getByText("3 Files", { exact: true }).last()).toBeVisible();
  await recording(
    async () => {
      await userEvent.click(tagButton());
      await expect.element(sheet(3)).toBeVisible();
      const words = [...sheet(3).element().querySelectorAll("p")].map((one) => one.textContent);
      expect(words).toEqual(["3 Files", "Their Own", "From Pictures"]);
      const held = sheet(3).element().querySelectorAll("[aria-hidden] > span");
      expect(held.length).toBe(4);
    },
    (cmd) => (cmd === "selection_tag_coverage" ? new Promise(() => {}) : undefined),
  );
});
