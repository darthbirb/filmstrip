import { useState } from "react";
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Tree, type TreeRow } from "./Tree";

/** Pictures › Trips › Cairo, Pictures › People, and Trash, opened as the tree asks. */
function Harness() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const open = (id: string) => expanded.has(id);

  const rows: TreeRow[] = [
    { id: "pictures", label: "Pictures", level: 1, expandable: true, expanded: open("pictures") },
  ];
  if (open("pictures")) {
    rows.push({ id: "trips", label: "Trips", level: 2, expandable: true, expanded: open("trips") });
    if (open("trips")) rows.push({ id: "cairo", label: "Cairo", level: 3, expandable: false });
    rows.push({ id: "people", label: "People", level: 2, expandable: false });
  }
  rows.push({ id: "trash", label: "Trash", level: 1, expandable: false });

  return (
    <Tree
      label="Places"
      rows={rows}
      selectedId={selected}
      onSelect={setSelected}
      onExpand={(id) => setExpanded(new Set(expanded).add(id))}
      onCollapse={(id) => {
        const next = new Set(expanded);
        next.delete(id);
        setExpanded(next);
      }}
    />
  );
}

test("the tree is one tab stop, and the arrow keys move through it", async () => {
  const screen = await render(<Harness />);
  const row = (name: string) => screen.getByRole("treeitem", { name });

  await userEvent.tab();
  await expect.element(row("Pictures")).toHaveFocus();
  expect(
    screen
      .getByRole("treeitem")
      .elements()
      .filter((el) => el.getAttribute("tabindex") === "0"),
  ).toHaveLength(1);

  await userEvent.keyboard("{ArrowDown}");
  await expect.element(row("Trash")).toHaveFocus();
  await userEvent.keyboard("{Home}");
  await expect.element(row("Pictures")).toHaveFocus();
  await userEvent.keyboard("{End}");
  await expect.element(row("Trash")).toHaveFocus();
});

test("Right opens a row, then steps into it; Left steps out, then closes it", async () => {
  const screen = await render(<Harness />);
  const row = (name: string) => screen.getByRole("treeitem", { name });

  await userEvent.tab();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(row("Pictures")).toHaveAttribute("aria-expanded", "true");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(row("Trips")).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}{ArrowRight}");
  await expect.element(row("Cairo")).toHaveFocus();
  await expect.element(row("Cairo")).toHaveAttribute("aria-level", "3");

  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(row("Trips")).toHaveFocus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(row("Trips")).toHaveAttribute("aria-expanded", "false");
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(row("Pictures")).toHaveFocus();
});

test("Enter and a click select a row, and the chevron opens one without selecting it", async () => {
  const screen = await render(<Harness />);
  const row = (name: string) => screen.getByRole("treeitem", { name });

  await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  await expect.element(row("Pictures")).toHaveAttribute("aria-selected", "true");

  await row("Trash").click();
  await expect.element(row("Trash")).toHaveAttribute("aria-selected", "true");

  const chevron = row("Pictures").element().querySelector("[data-chevron]") as HTMLElement;
  await userEvent.click(chevron);
  await expect.element(row("Pictures")).toHaveAttribute("aria-expanded", "true");
  await expect.element(row("Trash")).toHaveAttribute("aria-selected", "true");
});
