import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ageTrashed, expireNow, resetTrashLimits } from "../../dev/mock";
import { folderItems, trashItems, trashLimits, undoLast } from "../../ipc/commands";
import { formatTime } from "../../lib/format";
import { afterExpired } from "../navigation/expiry";
import { Foot } from "../navigation/Foot";
import { getNews, setNews } from "../navigation/foot-slot";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { restoreFiles } from "../pane/restore";
import { getPlace, setPlace } from "../place";
import { ReportBanner } from "../undo/ReportBanner";
import { showReport } from "../undo/report-store";
import { undo } from "../undo/undo";
import { Settings } from "./Settings";

// Against the dev mock, whose files are each 2,400,000 bytes; Cairo (6) holds a few.

beforeEach(async () => {
  await page.viewport(1280, 820);
  while (await undoLast()) {}
  resetTrashLimits();
  setNews(null);
  showReport(null);
  setPlace({ kind: "sorting" });
  resetIndex();
  await loadIndex();
});

const opened = () => render(<Settings open onClose={() => undefined} section="trash" />);
const note = () => document.querySelector("dialog p > span.text-pretty")?.textContent ?? "";

async function trashTwo() {
  const ids = (await folderItems(6)).map((row) => row.id).slice(0, 2);
  await trashItems(ids);
  return ids as [number, number];
}

test("Trash holds its three limits, what it holds against its total, and where a file goes past them", async () => {
  const screen = await opened();
  await expect.element(screen.getByRole("heading", { name: "Trash" })).toBeVisible();
  await expect.element(screen.getByText("Nothing in it")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Keep For: 30 Days" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Total Size: 25 GB" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Size per File: 5 GB" })).toBeVisible();
  expect(note()).toBe(
    "Past a limit, the oldest go to the Windows Recycle Bin. Checked at launch and every hour.",
  );
});

test("the line under the limits says what the next run sends, and follows a lowered limit", async () => {
  const [old] = await trashTwo();
  ageTrashed(old, 40);
  const { at } = await trashLimits();
  const screen = await opened();
  await expect.element(screen.getByText("2 files · 4.6 MB of 25 GB")).toBeVisible();
  await expect
    .poll(note)
    .toBe(
      `1 file, 2.3 MB, deleted over 30 days ago, goes to the Recycle Bin at ${formatTime(at)}.`,
    );

  await screen.getByRole("button", { name: "Keep For: 30 Days" }).click();
  await screen.getByRole("option", { name: "90 Days" }).click();
  await expect.poll(note).toMatch(/^Past a limit/);
  expect((await trashLimits()).limits.keepDays).toBe(90);
});

test("with neither limit that sends files on, the line says nothing leaves the Trash", async () => {
  const screen = await opened();
  await screen.getByRole("button", { name: "Keep For: 30 Days" }).click();
  await screen.getByRole("option", { name: "No Limit" }).click();
  await expect.poll(note).toMatch(/^Past a limit/);
  await screen.getByRole("button", { name: "Total Size: 25 GB" }).click();
  await screen.getByRole("option", { name: "No Limit" }).click();
  await expect
    .poll(note)
    .toBe("With no limits, nothing leaves the Trash until it is restored or emptied.");
  await expect.element(screen.getByRole("button", { name: "Keep For: No Limit" })).toBeVisible();
  expect((await trashLimits()).limits).toEqual({ keepDays: null, totalGb: null, fileGb: 5 });
});

test("a run says at the foot what went, with no Undo, and the Settings line moves on", async () => {
  const [old] = await trashTwo();
  ageTrashed(old, 31);
  const screen = await render(<Foot />);
  const said = expireNow();
  await afterExpired(said);
  await expect
    .element(screen.getByText("1 file went to the Recycle Bin, 30 days after it was deleted."))
    .toBeVisible();
  expect(screen.getByRole("button", { name: "Undo" }).query()).toBeNull();
  expect((await trashLimits()).held.count).toBe(1);
});

test("files the Recycle Bin refuses stay in the Trash, said once with the way to the first", async () => {
  const [old, other] = await trashTwo();
  ageTrashed(old, 31);
  ageTrashed(other, 32);
  const screen = await render(<Foot />);
  await afterExpired(expireNow([old, other]));
  await expect
    .element(
      screen.getByText(
        "The Recycle Bin could not take 2 files that expired, so they stay in the Trash.",
      ),
    )
    .toBeVisible();
  await screen.getByRole("button", { name: "Show in Trash" }).click();
  expect(getPlace()).toEqual({ kind: "trash" });

  setNews(null);
  const again = expireNow([old, other]);
  expect(again.refusedGrew).toBe(false);
  await afterExpired(again);
  expect(getNews()).toBeNull();
  expect((await trashLimits()).due.byAge.count).toBe(0);
});

test("a file that expired before it could be restored is in the Recycle Bin, and only the rest is retried", async () => {
  const [old] = await trashTwo();
  ageTrashed(old, 31);
  expireNow();
  const screen = await render(<ReportBanner />);
  await restoreFiles([old]);
  await expect.element(screen.getByText("In the Recycle Bin")).toBeVisible();
  await expect.element(screen.getByText("Expired after 30 days")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" }).query()).toBeNull();
  expect(screen.getByRole("button", { name: /in Explorer|in Trash|to…/ }).query()).toBeNull();
  expect((await trashLimits()).held.count).toBe(1);
});

test("Ctrl+Z on a delete whose file expired brings back the rest, and says where that one went", async () => {
  const [old] = await trashTwo();
  ageTrashed(old, 31);
  expireNow();
  const screen = await render(<ReportBanner />);
  await undo();
  await expect.element(screen.getByText("In the Recycle Bin")).toBeVisible();
  await expect.element(screen.getByText("Expired after 30 days")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" }).query()).toBeNull();
  expect(screen.getByRole("button", { name: /in Explorer|in Trash|to…/ }).query()).toBeNull();
  expect((await trashLimits()).held.count).toBe(0);
});
