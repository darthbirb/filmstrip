import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import {
  deleteFolder,
  destinationKeys,
  removeDestinationKey,
  setDestinationKey,
  undoLast,
} from "../../ipc/commands";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { Settings } from "./Settings";

// Against the dev mock: Pictures holds People (5, empty) and Trips (4), and Trips holds Cairo (6),
// which holds three files.

beforeEach(async () => {
  while (await undoLast()) {}
  for (const one of await destinationKeys()) await removeDestinationKey(one.key);
  await setDestinationKey("1", 6);
  await setDestinationKey("4", 5);
  await deleteFolder(5, null);
  resetIndex();
  await loadIndex();
});

const opened = () => render(<Settings open onClose={() => undefined} section="keys" />);
const keyRows = () =>
  [...document.querySelectorAll("section [title^='Destination Key']")].map(
    (chip) => chip.parentElement as HTMLElement,
  );
const words = (row: HTMLElement | undefined) => withoutGlyphs(row?.textContent);

test("Destination Keys lists all ten, bound or free, and a gone one in the red with where it was", async () => {
  await opened();
  await expect.element(page.getByRole("button", { name: /^Cairo/ })).toBeVisible();
  const rows = keyRows();
  expect(rows.map((row) => row.querySelector("[title^='Destination Key']")?.textContent)).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "0",
  ]);
  expect(words(rows[0])).toBe("1CairoTrips3");
  expect(words(rows[1])).toBe("2Choose Folder…");
  expect(words(rows[3])).toBe("4Peoplegone from Pictures");
  expect(rows[3]?.querySelector("button")?.className).toContain("text-danger");
});

test("× frees a key, and its row is free again", async () => {
  await opened();
  await userEvent.click(page.getByRole("button", { name: "Remove Key 1" }));
  await expect.poll(async () => (await destinationKeys()).map((one) => one.key)).toEqual(["4"]);
  await expect.poll(() => words(keyRows()[0])).toBe("1Choose Folder…");
});

test("a free key's Choose Folder… opens the picker inside Settings, and a pick binds it", async () => {
  await opened();
  await userEvent.click(page.getByRole("button", { name: "Choose Folder…" }).first());
  const picker = page.getByRole("dialog", { name: "Folder for Key 2" });
  await expect.element(picker).toBeVisible();
  await userEvent.keyboard("tri");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(async () => (await destinationKeys()).map((one) => [one.key, one.folderId]))
    .toEqual([
      ["1", 6],
      ["2", 4],
      ["4", 5],
    ]);
  await expect.poll(() => words(keyRows()[1])).toBe("2TripsPictures2");
});
