import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { refuseRecycling, resetTrashLimits, resizeItem } from "../../dev/mock";
import { folderChildren, folderItems, setTrashLimit, undoLast } from "../../ipc/commands";
import {
  DeleteQuestion,
  deleteFolderAsking,
  resetDeleteQuestion,
} from "../navigation/delete-folder";
import { Foot } from "../navigation/Foot";
import { getNews, setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { ReportBanner } from "../undo/ReportBanner";
import { showReport } from "../undo/report-store";
import { deleteFiles } from "./delete";
import { resetTooLarge, TooLargeQuestion } from "./too-large";

// Against the dev mock: Cairo (6) holds felucca.mp4, pyramid.jpg and sphinx.jpg, each 2,400,000
// bytes until grown here; the Trash takes files up to 5 GB and holds 25 GB.

const GB = 2 ** 30;

function Harness() {
  return (
    <div style={{ display: "flex", width: 1000, height: 600 }}>
      <nav style={{ display: "flex", flexDirection: "column", justifyContent: "end", width: 280 }}>
        <Foot />
      </nav>
      <main style={{ flex: 1 }}>
        <DeleteQuestion />
        <TooLargeQuestion />
        <ReportBanner />
      </main>
    </div>
  );
}

beforeEach(async () => {
  while (await undoLast()) {}
  resetTrashLimits();
  resetTooLarge();
  resetDeleteQuestion();
  setNews(null);
  showReport(null);
  updatePreferences({ deleteInto: undefined });
  setPlace({ kind: "sorting" });
  resetIndex();
  await loadIndex();
  await page.viewport(1100, 700);
});

const inCairo = async () => (await folderItems(6)).map((row) => row.diskName);

async function idOf(name: string) {
  const row = (await folderItems(6)).find((one) => one.diskName === name);
  if (!row) throw new Error(`Cairo has no ${name}`);
  return row.id;
}

const footLine = () => {
  const news = getNews();
  return news && "line" in news ? news.line : null;
};

test("one file over the size per file is refused before it moves, and × keeps it", async () => {
  const felucca = await idOf("felucca.mp4");
  resizeItem(felucca, 6.2 * GB);
  const screen = await render(<Harness />);

  await deleteFiles([felucca]);

  const question = screen.getByRole("region", { name: "felucca.mp4 is too large for the Trash" });
  await expect.element(question).toHaveFocus();
  await expect
    .element(
      question.getByText(
        "It is 6.2 GB, and the Trash takes files up to 5 GB. From the Recycle Bin, Undo cannot bring it back.",
      ),
    )
    .toBeVisible();
  expect(question.getByRole("button", { name: /Files/ }).elements()).toHaveLength(0);
  expect(getNews()).toBeNull();

  await question.getByRole("button", { name: "Keep It" }).click();
  await expect.element(question).not.toBeInTheDocument();
  expect(await inCairo()).toContain("felucca.mp4");
});

test("Send to Recycle Bin takes it from its folder, and the foot says so with no Undo", async () => {
  const felucca = await idOf("felucca.mp4");
  resizeItem(felucca, 6.2 * GB);
  const screen = await render(<Harness />);
  await deleteFiles([felucca]);

  await screen.getByRole("button", { name: "Send to Recycle Bin" }).click();

  await expect.element(screen.getByText("Sent felucca.mp4 to the Recycle Bin.")).toBeVisible();
  expect(getNews()?.kind).toBe("recycled");
  expect(screen.getByRole("button", { name: /Undo/ }).elements()).toHaveLength(0);
  expect(screen.getByRole("region").elements()).toHaveLength(0);
  expect(await inCairo()).toEqual(["pyramid.jpg", "sphinx.jpg"]);
});

test("in a set the rest go to the Trash with Undo and the refused are listed with their sizes", async () => {
  const [felucca, pyramid, sphinx] = await Promise.all(
    ["felucca.mp4", "pyramid.jpg", "sphinx.jpg"].map(idOf),
  );
  resizeItem(felucca as number, 6.2 * GB);
  resizeItem(pyramid as number, 11.8 * GB);
  const screen = await render(<Harness />);

  await deleteFiles([felucca, pyramid, sphinx] as number[]);

  await expect.poll(footLine).toBe("Deleted 1 of 3 files. The other 2 are in the banner.");
  const question = screen.getByRole("region", { name: "2 of 3 files are too large for the Trash" });
  await expect
    .element(
      question.getByText(
        "The Trash takes files up to 5 GB. From the Recycle Bin, Undo cannot bring them back.",
      ),
    )
    .toBeVisible();
  await expect.element(question.getByText("Still in Cairo")).toBeVisible();
  await expect.element(question.getByText("6.2 GB")).toBeVisible();
  await expect.element(question.getByText("12 GB")).toBeVisible();
  await expect
    .element(question.getByRole("button", { name: "Show felucca.mp4 in Explorer" }))
    .toBeVisible();
  expect(screen.getByText("went to the Trash", { exact: false }).elements()).toHaveLength(0);

  const list = question.getByText("Still in Cairo").element().parentElement?.parentElement;
  expect(list?.scrollHeight, "rows that fit leave the list no scrollbar").toBeLessThanOrEqual(
    list?.clientHeight ?? 0,
  );

  await question.getByRole("button", { name: "Hide Files" }).click();
  await expect.element(question.getByText("Still in Cairo")).not.toBeInTheDocument();

  await question.getByRole("button", { name: "Send to Recycle Bin" }).click();
  await expect.poll(footLine).toBe("Sent 2 files to the Recycle Bin.");
  expect(await inCairo()).toEqual([]);
});

test("with Size per File at No Limit a file larger than the total is refused, naming it", async () => {
  const felucca = await idOf("felucca.mp4");
  resizeItem(felucca, 30 * GB);
  await setTrashLimit("sizePerFile", null);
  const screen = await render(<Harness />);

  await deleteFiles([felucca]);

  await expect
    .element(
      screen.getByText(
        "It is 30 GB, and the Trash holds 25 GB in all. From the Recycle Bin, Undo cannot bring it back.",
      ),
    )
    .toBeVisible();
  resetTooLarge();

  await setTrashLimit("totalSize", null);
  await deleteFiles([felucca]);
  await expect.poll(footLine).toBe("Deleted felucca.mp4.");
  expect(screen.getByRole("region").elements()).toHaveLength(0);
});

test("a file the Recycle Bin refuses stays where it was, and the notice says why", async () => {
  const felucca = await idOf("felucca.mp4");
  resizeItem(felucca, 6.2 * GB);
  refuseRecycling([felucca]);
  const screen = await render(<Harness />);
  await deleteFiles([felucca]);

  await screen.getByRole("button", { name: "Send to Recycle Bin" }).click();

  const refused = screen.getByRole("region", {
    name: "The Recycle Bin could not take felucca.mp4, so it stays in Cairo",
  });
  await expect
    .element(
      refused.getByText(
        "Its drive may have no Recycle Bin, or it is off or too small. Nothing was deleted.",
      ),
    )
    .toBeVisible();
  expect(refused.getByRole("button", { name: "Send to Recycle Bin" }).elements()).toHaveLength(0);
  expect(getNews()).toBeNull();
  expect(await inCairo()).toContain("felucca.mp4");

  await refused.getByRole("button", { name: "Dismiss" }).click();
  await expect.element(refused).not.toBeInTheDocument();
});

test("a folder's Delete Files Too asks the same, and the folder goes once they have", async () => {
  resizeItem(await idOf("felucca.mp4"), 6.2 * GB);
  const screen = await render(<Harness />);

  await deleteFolderAsking({ id: 6, name: "Cairo" }, []);
  await screen.getByRole("button", { name: "Delete Files Too" }).click();

  const question = screen.getByRole("region", { name: "felucca.mp4 is too large for the Trash" });
  await expect.element(question).toBeVisible();
  await expect.poll(footLine).toBe("Deleted 2 of Cairo’s 3 files. Cairo is in the banner.");
  expect((await folderChildren(4)).map((folder) => folder.title)).toEqual(["Cairo"]);

  await question.getByRole("button", { name: "Send to Recycle Bin" }).click();

  await expect.poll(footLine).toBe("Sent felucca.mp4 to the Recycle Bin. Deleted Cairo.");
  expect(await folderChildren(4)).toEqual([]);
});
