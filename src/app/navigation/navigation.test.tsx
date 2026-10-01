import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { getPlace, setPlace } from "../place";
import { Breadcrumb } from "./Breadcrumb";
import { loadIndex, resetIndex } from "./index-store";
import { Navigation } from "./Navigation";
import { getRefused, setRefused } from "./refusal-store";

// Against the dev mock: Pictures holds People and Trips › Cairo; Incoming is a sorting source
// holding three items; Archive cannot be reached.
const titles = () => {
  const place = getPlace();
  return place?.kind === "folder" ? place.path.map((crumb) => crumb.title) : place?.kind;
};

beforeEach(async () => {
  resetIndex();
  setPlace(null);
  setRefused(null);
  await loadIndex();
});

test("shows the Sorting Box with its count, every library source, and the Trash", async () => {
  const screen = await render(<Navigation />);
  await expect.element(screen.getByRole("treeitem", { name: "Sorting Box 3 of 3" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Pictures 1 of 6" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Archive offline" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Trash 0 of 0" })).toBeVisible();
});

test("the app's own two places sit together at the top, above a rule, then the sources", async () => {
  const screen = await render(<Navigation />);
  const trash = screen.getByRole("treeitem", { name: "Trash 0 of 0" });
  await expect.element(trash).toBeVisible();
  const order = screen
    .getByRole("treeitem")
    .elements()
    .map((item) => item.querySelector(".truncate")?.textContent);
  expect(order).toEqual(["Sorting Box", "Trash", "Pictures", "Archive"]);

  const rule = trash.element().nextElementSibling as HTMLElement;
  expect(rule.getAttribute("role")).toBeNull();
  expect(rule.getBoundingClientRect().height).toBe(1);
  expect(rule.nextElementSibling?.getAttribute("role")).toBe("treeitem");
});

test("a source opens in place, and choosing a folder goes there", async () => {
  const screen = await render(<Navigation />);
  const row = (name: string) => screen.getByRole("treeitem", { name });
  await expect
    .poll(() => row("Pictures 1 of 6").element().getAttribute("aria-expanded"))
    .toBe("false");

  await row("Pictures 1 of 6").click();
  await userEvent.keyboard("{ArrowRight}");
  await row("Trips 2 of 5").click();
  expect(titles()).toEqual(["Pictures", "Trips"]);
  await userEvent.keyboard("{ArrowRight}");
  await row("Cairo 3 of 3").click();
  expect(titles()).toEqual(["Pictures", "Trips", "Cairo"]);
  await expect.element(row("Cairo 3 of 3")).toHaveAttribute("aria-selected", "true");

  await row("Sorting Box 3 of 3").click();
  expect(titles()).toBe("sorting");
});

test("every place ends in a count pill of two figures, and only an offline source has none", async () => {
  const screen = await render(<Navigation />);
  const row = (name: string) => screen.getByRole("treeitem", { name });
  const pill = (name: string) => row(name).element().querySelector(".rounded-badge");
  const shown = (name: string) => pill(name)?.querySelector("[aria-hidden]")?.textContent;
  await expect.element(row("Sorting Box 3 of 3")).toBeVisible();

  expect(shown("Sorting Box 3 of 3")).toBe("3/3");
  expect(pill("Sorting Box 3 of 3")?.getBoundingClientRect().height).toBe(20);
  expect(shown("Trash 0 of 0")).toBe("0/0");
  // An offline source keeps its word where the pill would be, and shows no count it cannot stand behind.
  expect(pill("Archive offline")).toBeNull();

  await row("Pictures 1 of 6").click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(row("Trips 2 of 5")).toBeVisible();
  expect(shown("People 0 of 0")).toBe("0/0");
});

test("a pill reads its own files, then everything at or below it, even where they agree", async () => {
  const screen = await render(<Navigation />);
  const row = (name: string) => screen.getByRole("treeitem", { name });
  const shown = (name: string) =>
    row(name).element().querySelector(".rounded-badge [aria-hidden]")?.textContent;
  await row("Pictures 1 of 6").click();
  await userEvent.keyboard("{ArrowRight}");
  await row("Trips 2 of 5").click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(row("Cairo 3 of 3")).toBeVisible();

  expect(shown("Pictures 1 of 6")).toBe("1/6");
  expect(shown("Cairo 3 of 3")).toBe("3/3");
  // Folded shut or opened, a row's pill is the folder's, not what the tree shows of it.
  await row("Trips 2 of 5").click();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(row("Cairo 3 of 3")).not.toBeInTheDocument();
  expect(shown("Trips 2 of 5")).toBe("2/5");
  expect(row("Cairo 3 of 3").elements()).toHaveLength(0);

  // The slash is the separator ink at rest, and the plate's on the row you stand in.
  const slash = (name: string) =>
    getComputedStyle(
      row(name).element().querySelector(".rounded-badge [aria-hidden] span") as Element,
    ).color;
  expect(slash("Pictures 1 of 6")).toBe("rgb(92, 90, 86)");
  expect(slash("Trips 2 of 5")).toBe("rgba(23, 24, 26, 0.4)");
});

test("the breadcrumb goes back up to any folder on the path", async () => {
  setPlace({
    kind: "folder",
    sourceId: 1,
    path: [
      { id: 1, title: "Pictures" },
      { id: 4, title: "Trips" },
      { id: 6, title: "Cairo" },
    ],
  });
  const screen = await render(<Breadcrumb />);
  await expect.element(screen.getByText("Cairo")).toHaveAttribute("aria-current", "location");

  await screen.getByRole("button", { name: "Pictures" }).click();
  expect(titles()).toEqual(["Pictures"]);
});

test("the Sorting Box keeps its own way in, reachable after the row it sits on", async () => {
  const screen = await render(<Navigation />);
  const row = screen.getByRole("treeitem", { name: "Sorting Box 3 of 3" });
  await expect.element(row).toBeVisible();

  // Drawn at rest, not on hover: it is the only way to nominate a sorting folder.
  const nominate = screen.getByRole("button", { name: "Add Sorting Source…" });
  await expect.element(nominate).toBeVisible();
  expect(row.element().contains(nominate.element())).toBe(true);

  // The row is one tab stop and its + is the next.
  (row.element() as HTMLElement).focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(nominate.element());
});

test("a refused folder says so and changes nothing, and a second refusal replaces the first", async () => {
  const screen = await render(<Navigation />);
  await expect.element(screen.getByRole("treeitem", { name: "Pictures 1 of 6" })).toBeVisible();

  setRefused({ why: "inside", clash: "Pictures", path: "C:UsersadaPicturesTrips" });
  expect(getRefused()?.why).toBe("inside");
  // The tree is exactly as it was: nothing added, and nothing selected on the person's behalf.
  expect(screen.getByRole("treeitem").elements().length).toBe(4);

  setRefused({ why: "appFolder", clash: null, path: "D:Filmstrip\thumbs" });
  expect(getRefused()?.why).toBe("appFolder");
});

// This one replaces the dev mock, so it stays last.
test("with no sources at all, the doorway stands where the tree will", async () => {
  mockIPC((command) => (command === "list_sources" ? [] : undefined), { shouldMockEvents: true });
  resetIndex();
  await loadIndex();
  const screen = await render(<Navigation />);

  await expect.element(screen.getByText("No Sources Yet")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /Add Source/ })).toBeVisible();
  // A glyph, the title and the button: no line explaining what adding does.
  expect(screen.container.querySelectorAll("p")).toHaveLength(1);
});
