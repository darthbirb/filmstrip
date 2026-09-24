import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { folderItems, itemDetail, renameItem, undoLast } from "../../ipc/commands";
import { Foot } from "../navigation/Foot";
import { setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { updatePreferences } from "../preferences";
import { ReportBanner } from "../undo/ReportBanner";
import { showReport } from "../undo/report-store";
import { Actions } from "./Actions";
import { MovePickerHost, openMovePicker } from "./move-picker";

// Against the dev mock: Pictures (1) holds cover.jpg, People (5) and Trips (4) › Cairo (6),
// and Cairo holds felucca.mp4, pyramid.jpg and sphinx.jpg.

beforeEach(async () => {
  while (await undoLast()) {}
  openMovePicker(null);
  setNews(null);
  showReport(null);
  updatePreferences({ recent: [] });
  resetIndex();
  await loadIndex();
});

async function inCairo(name: string) {
  const row = (await folderItems(6)).find((item) => item.diskName === name);
  if (!row) throw new Error(`the mock has no ${name} in Cairo`);
  return (await itemDetail(row.id)) as ItemDetail;
}

/** Each option as its name, and the words at its end after a dot. */
function rows(within: Element) {
  return [...within.querySelectorAll('[role="option"]')].map((row) => {
    const name = row.querySelector(".truncate")?.textContent ?? "";
    const detail = row.querySelector(".whitespace-nowrap")?.textContent;
    return detail ? `${name} · ${detail}` : name;
  });
}

function Harness({ item }: { item: ItemDetail }) {
  return (
    <div className="w-dialog">
      <ReportBanner />
      <Actions item={item} />
      <MovePickerHost />
      <Foot />
    </div>
  );
}

test("Move to… opens the tree down to the file's folder, which cannot be picked", async () => {
  const screen = await render(<Harness item={await inCairo("pyramid.jpg")} />);
  await screen.getByRole("button", { name: "Move to…" }).click();
  const picker = screen.getByRole("dialog", { name: "Move to" });
  await expect.element(picker.getByRole("combobox")).toHaveFocus();

  await expect.element(picker.getByRole("option", { name: /People/ })).toBeVisible();
  expect(rows(picker.element())).toEqual([
    "Pictures",
    "People",
    "Trips",
    "Cairo · current",
    "Incoming",
  ]);
  const cairo = picker.getByRole("option", { name: /Cairo/ });
  await expect.element(cairo).toHaveAttribute("aria-disabled", "true");
});

test("picking a folder moves the file there and says so at the foot, and it joins Recent", async () => {
  const item = await inCairo("pyramid.jpg");
  const screen = await render(<Harness item={item} />);
  await screen.getByRole("button", { name: "Move to…" }).click();
  await screen.getByRole("option", { name: /People/ }).click();

  await expect.element(screen.getByText("Moved pyramid.jpg to People.")).toBeVisible();
  expect((await folderItems(5)).map((row) => row.diskName)).toEqual(["pyramid.jpg"]);

  await screen.getByRole("button", { name: "Move to…" }).click();
  await expect.element(screen.getByText("Recent")).toBeVisible();
});

test("typing filters the tree to the folders it names, and Enter picks the first", async () => {
  const screen = await render(<Harness item={await inCairo("sphinx.jpg")} />);
  await screen.getByRole("button", { name: "Move to…" }).click();
  await userEvent.keyboard("peo");
  await expect.poll(() => rows(document.body)).toEqual(["People · Pictures"]);

  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByText("Moved sphinx.jpg to People.")).toBeVisible();
});

test("a name already taken where it is going stays, and the banner says why", async () => {
  const felucca = await inCairo("felucca.mp4");
  await renameItem(felucca.id, "cover.jpg");
  const item = (await itemDetail(felucca.id)) as ItemDetail;
  const screen = await render(<Harness item={item} />);
  await screen.getByRole("button", { name: "Move to…" }).click();
  await screen.getByRole("option", { name: /^Pictures/ }).click();

  await expect.element(screen.getByText("cover.jpg could not go to Pictures")).toBeVisible();
  await expect.element(screen.getByText("Not Moved")).toBeVisible();
  await expect.element(screen.getByText("Name taken in Pictures")).toBeVisible();
});
