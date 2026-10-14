import { expect, test } from "vitest";

import { recording } from "../../dev/recording";
import type { Stayed } from "../../ipc/bindings/Stayed";
import { getNews, setNews } from "../navigation/foot-slot";
import { getReport, showReport } from "../undo/report-store";
import { afterCopied } from "./copy";

const DAY_1 = "C:\\Users\\Ana\\Downloads\\Alexandria\\Day 1";

const left = (name: string, dir: string, into: number): Stayed => ({
  kind: "file",
  id: 0,
  name,
  at: { kind: "outside", dir, into },
  reason: { kind: "inUse" },
});

test("Retry carries each file left out back into the folder it was going into", async () => {
  showReport(null);
  await afterCopied({
    jobId: 9,
    folderId: 4,
    to: "Trips",
    batch: null,
    whole: 4,
    refused: [
      left("a.jpg", DAY_1, 6),
      left("loose.jpg", "C:\\Users\\Ana\\Downloads\\", 4),
      left("b.jpg", DAY_1, 6),
      {
        ...left("tram.jpg", "D:\\Pictures\\Trips", 4),
        reason: { kind: "alreadyIn", place: "Trips" },
      },
    ],
    cancelled: false,
    stopped: null,
  });

  await recording(
    async (calls) => {
      getReport()?.retry?.();
      await expect
        .poll(() => calls.filter(([cmd]) => cmd === "drop_files"))
        .toEqual([
          ["drop_files", { folderId: 6, paths: [`${DAY_1}\\a.jpg`, `${DAY_1}\\b.jpg`] }],
          ["drop_files", { folderId: 4, paths: ["C:\\Users\\Ana\\Downloads\\loose.jpg"] }],
        ]);
    },
    (cmd) => (cmd === "drop_files" ? { kind: "empty" } : undefined),
  );
  showReport(null);
});

test("a copy that stopped on its own says why, with what came in and its Undo", async () => {
  setNews(null);
  const copy = { jobId: 9, folderId: 4, to: "Trips", whole: 3, refused: [], cancelled: false };
  const stopped = { kind: "other", message: "that folder is no longer in the index" } as const;
  await afterCopied({ ...copy, batch: null, stopped });
  expect(getNews()).toEqual({
    kind: "keyRefused",
    line: "The 3 files could not come into Trips.",
    detail: "That folder is no longer in the index.",
  });

  const batch = {
    batchId: "b1",
    act: { kind: "copy", to: "Trips", one: null, folder: null, folders: 0 },
    files: 2,
    folders: 0,
  } as const;
  await afterCopied({ ...copy, batch, stopped });
  expect(getNews()).toEqual({
    kind: "done",
    line: "Copied 2 of 3 files to Trips. That folder is no longer in the index.",
    batchId: "b1",
  });
  setNews(null);
});
