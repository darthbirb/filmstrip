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

async function renderGrid() {
  await page.viewport(1200, 800);
  render(
    <div style={{ display: "flex", flexDirection: "column", width: 900, height: 700 }}>
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
  [...document.querySelectorAll("[role=dialog] section[data-own] [role=button]")].map((chip) =>
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
