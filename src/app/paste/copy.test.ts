import { expect, test } from "vitest";

import { recording } from "../../dev/recording";
import type { Stayed } from "../../ipc/bindings/Stayed";
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
