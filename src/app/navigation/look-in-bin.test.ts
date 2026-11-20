import { afterEach, beforeEach, expect, test } from "vitest";

import { emptyOutside, resetBin } from "../../dev/mock";
import { folderItems, trashItems, trashListing, undoLast } from "../../ipc/commands";
import { setPlace } from "../place";
import { watchTrashOpening } from "./look-in-bin";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg.

let stop: () => void = () => undefined;

beforeEach(async () => {
  resetBin();
  while (await undoLast()) {}
  setPlace({ kind: "sorting" });
});

afterEach(() => stop());

const inTrash = async () => (await trashListing()).map((one) => one.diskName);

test("opening the Trash retires what was emptied from the Recycle Bin outside the app", async () => {
  const [felucca, pyramid] = (await folderItems(6)).map((row) => row.id);
  await trashItems([felucca as number, pyramid as number]);
  emptyOutside([pyramid as number]);
  stop = watchTrashOpening();
  expect(await inTrash()).toEqual(expect.arrayContaining(["felucca.mp4", "pyramid.jpg"]));

  setPlace({ kind: "trash" });
  await expect.poll(inTrash).toEqual(["felucca.mp4"]);
});

test("only opening the Trash looks, not each change of place inside it or elsewhere", async () => {
  const [felucca] = (await folderItems(6)).map((row) => row.id);
  await trashItems([felucca as number]);
  stop = watchTrashOpening();
  setPlace({ kind: "trash" });
  emptyOutside([felucca as number]);
  setPlace({ kind: "trash" });
  setPlace({ kind: "sorting" });
  await new Promise((settled) => setTimeout(settled, 50));
  expect(await inTrash()).toEqual(["felucca.mp4"]);
});
