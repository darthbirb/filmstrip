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
  await expect.element(screen.getByRole("treeitem", { name: "Sorting Box 3" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Pictures" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Archive offline" })).toBeVisible();
  await expect.element(screen.getByRole("treeitem", { name: "Trash" })).toBeVisible();
});

test("the app's own two places sit together at the top, above a rule, then the sources", async () => {
  const screen = await render(<Navigation />);
  const trash = screen.getByRole("treeitem", { name: "Trash" });
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
  await expect.poll(() => row("Pictures").element().getAttribute("aria-expanded")).toBe("false");

  await row("Pictures").click();
  await userEvent.keyboard("{ArrowRight}");
  await row("Trips 2").click();
  expect(titles()).toEqual(["Pictures", "Trips"]);
  await userEvent.keyboard("{ArrowRight}");
  await row("Cairo 3").click();
  expect(titles()).toEqual(["Pictures", "Trips", "Cairo"]);
  await expect.element(row("Cairo 3")).toHaveAttribute("aria-selected", "true");

  await row("Sorting Box 3").click();
  expect(titles()).toBe("sorting");
});

test("a place with items ends in a count pill, and one without carries none", async () => {
  const screen = await render(<Navigation />);
  const row = (name: string) => screen.getByRole("treeitem", { name });
  const pill = (name: string) => row(name).element().querySelector(".rounded-badge");
  await expect.element(row("Sorting Box 3")).toBeVisible();

  const sorting = pill("Sorting Box 3") as HTMLElement;
  expect(sorting.textContent).toBe("3");
  expect(sorting.getBoundingClientRect().height).toBe(20);
  // An offline source keeps its word where the pill would be, and shows no count it cannot stand behind.
  expect(pill("Archive offline")).toBeNull();
  expect(pill("Trash")).toBeNull();

  await row("Pictures").click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(row("Trips 2")).toBeVisible();
  expect(pill("People")).toBeNull();
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
  const row = screen.getByRole("treeitem", { name: "Sorting Box 3" });
  await expect.element(row).toBeVisible();

  // Drawn at rest, not on hover: it is the only way to nominate a sorting folder.
  const nominate = screen.getByRole("button", { name: "Nominate a folder" });
  await expect.element(nominate).toBeVisible();
  expect(row.element().contains(nominate.element())).toBe(true);

  // The row is one tab stop and its + is the next.
  (row.element() as HTMLElement).focus();
  await userEvent.tab();
  expect(document.activeElement).toBe(nominate.element());
});

test("a refused folder says so and changes nothing, and a second refusal replaces the first", async () => {
  const screen = await render(<Navigation />);
  await expect.element(screen.getByRole("treeitem", { name: "Pictures" })).toBeVisible();

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
  await expect
    .element(screen.getByText("Add a folder and Filmstrip will read it where it stands."))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: /Add a folder/ })).toBeVisible();
});
