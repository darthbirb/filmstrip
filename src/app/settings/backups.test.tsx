import { emit } from "@tauri-apps/api/event";
import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { forgetOnRestore, resetBackups } from "../../dev/mock";
import type { Progress } from "../../ipc/bindings/Progress";
import { listBackups } from "../../ipc/commands";
import { getNews, setNews } from "../navigation/foot-slot";
import { watchWork } from "../navigation/work-store";
import { useLaunchBackup } from "./backup-words";
import { Settings } from "./Settings";
import { settingsHeld } from "./settings-store";

// Against the dev mock: seven backups, a week of them, newest first; the fifth, from six days ago,
// cannot be read.

beforeEach(async () => {
  await page.viewport(1280, 820);
  resetBackups();
});

const opened = () => render(<Settings open onClose={() => undefined} section="backups" />);
const list = () => document.querySelector("section[aria-label='Backups of the index']");
const rows = () => [
  ...(list()?.querySelectorAll(":scope > div:last-child > div:not(.push-down)") ?? []),
];
// biome-ignore lint/performance/useDomNodeTextContent: the tests read a row as drawn, its cells split by line and space, which textContent runs together.
const rowText = (at: number) => (rows()[at] as HTMLElement | undefined)?.innerText ?? "";
const restoreOn = (at: number) =>
  rows()[at]?.querySelector<HTMLButtonElement>("button") ?? undefined;
const foot = () => document.querySelector("dialog section[aria-label='Backups']");

test("the backups are listed newest first, with how each was taken and what they weigh", async () => {
  await opened();
  await expect.element(page.getByText("7 backups · 327 MB")).toBeVisible();
  await expect.poll(() => rows().length).toBe(7);
  expect(rowText(0)).toMatch(/^Today, 09:14\s+by hand\s+48 MB\s+Restore…$/);
  expect(rowText(1)).toMatch(/^Yesterday, 09:41\s+at launch/);
  await expect.element(page.getByRole("button", { name: "Backups to Keep: 7" })).toBeVisible();
});

test("Size stands over its figures while the list scrolls", async () => {
  await page.viewport(1280, 500);
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  const head = list()?.firstElementChild as HTMLElement;
  const scroller = list()?.lastElementChild as HTMLElement;
  expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  // Headless Edge draws no scrollbar, so the gutter both keep is what holds them together.
  expect(getComputedStyle(head).scrollbarGutter).toBe("stable");
  expect(getComputedStyle(scroller).scrollbarGutter).toBe("stable");
  const right = (element: Element | null | undefined) =>
    element?.getBoundingClientRect().right ?? Number.NaN;
  const heading = [...head.children].find((cell) => cell.textContent === "Size");
  for (const row of rows()) {
    expect(right(row.querySelector(".text-right"))).toBeCloseTo(right(heading), 0);
  }
});

test("Restore… asks on its row, and Escape puts the row back with the focus on its Restore…", async () => {
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  await userEvent.click(restoreOn(2) as HTMLElement);
  await expect.element(page.getByRole("button", { name: "Restore Index" })).toBeVisible();
  expect(rowText(2)).toContain("The index as it is now is kept as a backup first.");
  expect(document.activeElement?.textContent).toBe("Cancel");

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.querySelector("dialog[open]")).not.toBeNull();
  await expect.element(page.getByRole("button", { name: "Restore Index" })).not.toBeInTheDocument();
  expect(document.activeElement).toBe(restoreOn(2));
});

const IDLE: Progress = {
  phase: "idle",
  pending: 0,
  running: 0,
  failed: 0,
  completed: 0,
  copies: [],
  exports: [],
  moves: [],
  deletes: [],
  walks: 0,
  walkedSource: null,
  thumbed: [],
};

test("Restore… names each copy, move and export it stops first", async () => {
  await watchWork();
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  const line = { folderId: 5, to: "People", done: 1, whole: 4 };
  const export_ = { jobId: 3, zip: "Trips.zip", path: "D:ExportsTrips.zip", done: 0, whole: 2 };
  await emit("job-progress", {
    ...IDLE,
    copies: [{ jobId: 1, ...line }],
    moves: [{ jobId: 2, ...line }],
    exports: [export_],
  });
  await userEvent.click(restoreOn(2) as HTMLElement);
  await expect
    .poll(() => rowText(2))
    .toContain(
      "The copy, the move and the export running now are stopped first, as Cancel would stop them.",
    );
  await userEvent.keyboard("{Escape}");
  await emit("job-progress", IDLE);
});

test("a restore holds Settings open, then keeps the way back on top with the focus on it", async () => {
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  const when = rowText(2).split("\n")[0];
  await userEvent.click(restoreOn(2) as HTMLElement);
  await userEvent.click(page.getByRole("button", { name: "Restore Index" }));
  await expect.poll(() => rowText(2)).toContain(`Restoring the index from ${when}…`);
  expect(settingsHeld()).toBe(true);

  await expect.element(page.getByText(`Restored the index from ${when}.`)).toBeVisible();
  expect(settingsHeld()).toBe(false);
  expect(rowText(0)).toMatch(/before restore/);
  await expect.poll(() => document.activeElement).toBe(restoreOn(0));
  expect(foot()?.textContent).not.toContain("Undo");
  expect((await listBackups()).backups).toHaveLength(7);
});

test("a backup from yesterday is named in lower case in the question, the progress and the end", async () => {
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  expect(rowText(1)).toMatch(/^Yesterday, 09:41\s/);
  await userEvent.click(restoreOn(1) as HTMLElement);
  await expect.poll(() => rowText(1)).toContain("Restore the index from yesterday, 09:41?");
  await userEvent.click(page.getByRole("button", { name: "Restore Index" }));
  await expect.poll(() => rowText(1)).toContain("Restoring the index from yesterday, 09:41…");
  await expect.element(page.getByText("Restored the index from yesterday, 09:41.")).toBeVisible();
});

test("leaving Backups mid-restore and coming back finds it running, and only then is the rail let go", async () => {
  const first = await opened();
  await expect.poll(() => rows().length).toBe(7);
  const when = rowText(2).split("\n")[0];
  await userEvent.click(restoreOn(2) as HTMLElement);
  await userEvent.click(page.getByRole("button", { name: "Restore Index" }));
  await expect.poll(() => rowText(2)).toContain(`Restoring the index from ${when}…`);
  const tags = page.getByRole("button", { name: "Tags", exact: true });
  const find = page.getByRole("searchbox", { name: "Find a setting" });
  await expect.element(tags).toBeDisabled();
  await expect.element(find).toBeDisabled();

  await first.unmount();
  await opened();
  await expect.poll(() => rowText(2)).toContain(`Restoring the index from ${when}…`);
  expect(rows()).toHaveLength(7);
  expect(list()?.textContent).not.toContain("Backing up…");
  await userEvent.click(restoreOn(0) as HTMLElement);
  expect(page.getByRole("button", { name: "Restore Index" }).query()).toBeNull();

  await expect.element(page.getByText(`Restored the index from ${when}.`)).toBeVisible();
  expect(settingsHeld()).toBe(false);
  await expect.poll(() => document.activeElement).toBe(restoreOn(0));
  await expect.element(tags).toBeEnabled();
  await expect.element(find).toBeEnabled();
});

test("a restore that ends while Backups is away is said when it is opened again", async () => {
  const first = await opened();
  await expect.poll(() => rows().length).toBe(7);
  const when = rowText(3).split("\n")[0];
  await userEvent.click(restoreOn(3) as HTMLElement);
  await userEvent.click(page.getByRole("button", { name: "Restore Index" }));
  await expect.poll(() => rowText(3)).toContain(`Restoring the index from ${when}…`);
  await first.unmount();
  await expect.poll(settingsHeld, { timeout: 5000 }).toBe(false);

  await opened();
  await expect.element(page.getByText(`Restored the index from ${when}.`)).toBeVisible();
  expect(rowText(0)).toMatch(/before restore/);
  await expect.poll(() => document.activeElement).toBe(restoreOn(0));
});

test("a backup that cannot be read is refused at the section's foot, and its row loses Restore…", async () => {
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  const when = rowText(4).split("\n")[0];
  await userEvent.click(restoreOn(4) as HTMLElement);
  await userEvent.click(page.getByRole("button", { name: "Restore Index" }));
  await expect
    .element(page.getByText(`The backup from ${when} could not be read. The index is as it was.`))
    .toBeVisible();
  await expect.poll(() => rowText(4)).toMatch(/unreadable/);
  expect(restoreOn(4)).toBeUndefined();
  expect(rows()).toHaveLength(7);
});

const ARCHIVE = { sources: ["Archive"], files: 3 };

test("a restore that forgets a source names it, and counts its files in the Recycle Bin", async () => {
  forgetOnRestore({ forgets: ARCHIVE });
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  await userEvent.click(restoreOn(2) as HTMLElement);
  await expect.element(page.getByRole("button", { name: "Restore Index" })).toBeVisible();
  expect(rowText(2)).toContain(
    "go back to then. Archive was added since, so it is forgotten; its 3 files in the Recycle Bin stay there, out of the app. The index as it is now is kept as a backup first.",
  );
  await userEvent.keyboard("{Escape}");

  forgetOnRestore({ forgets: { sources: ["Archive", "Phone"], files: 1 } });
  await userEvent.click(restoreOn(2) as HTMLElement);
  await expect.element(page.getByRole("button", { name: "Restore Index" })).toBeVisible();
  expect(rowText(2)).toContain(
    "Archive and Phone were added since, so they are forgotten; their 1 file in the Recycle Bin stays there, out of the app.",
  );
});

test("a restore whose files to forget cannot be counted still says they stay in the Recycle Bin", async () => {
  forgetOnRestore({ forgets: ARCHIVE, unknown: true });
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  await userEvent.click(restoreOn(2) as HTMLElement);
  await expect.element(page.getByRole("button", { name: "Restore Index" })).toBeVisible();
  expect(rowText(2)).toContain(
    "go back to then. Any source added since is forgotten; its files in the Recycle Bin stay there. The index as it is now is kept as a backup first.",
  );
});

test("a restore with nothing in the Trash to forget asks as ever", async () => {
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  await userEvent.click(restoreOn(2) as HTMLElement);
  await expect.element(page.getByRole("button", { name: "Restore Index" })).toBeVisible();
  expect(rowText(2)).not.toContain("Recycle Bin");
});

test("a restore that forgets files in the Recycle Bin sends none, and restores as ever", async () => {
  forgetOnRestore({ forgets: ARCHIVE });
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  const when = rowText(2).split("\n")[0];
  await userEvent.click(restoreOn(2) as HTMLElement);
  await userEvent.click(page.getByRole("button", { name: "Restore Index" }));
  await expect.element(page.getByText(`Restored the index from ${when}.`)).toBeVisible();
  expect(rowText(0)).toMatch(/before restore/);
  expect(page.getByText(/could not take/).query()).toBeNull();
});

test("lowering the number kept marks what will go at the next backup and removes nothing", async () => {
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  await userEvent.click(page.getByRole("button", { name: "Backups to Keep: 7" }));
  await userEvent.click(page.getByRole("option", { name: "3", exact: true }));
  await expect.poll(() => rowText(2)).toMatch(/removed at the next backup/);
  expect(rows().map((_, at) => /removed at the next backup/.test(rowText(at)))).toEqual([
    false,
    false,
    true,
    true,
    true,
    true,
    true,
  ]);
  expect((await listBackups()).backups).toHaveLength(7);
});

test("Back Up Now writes a new row at the top, and the oldest past the number leaves", async () => {
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  const oldest = rowText(6);
  await userEvent.click(page.getByRole("button", { name: "Back Up Now" }));
  await expect.element(page.getByText("Backing up…")).toBeVisible();
  await expect.element(page.getByText("Backing up…")).not.toBeInTheDocument();
  await expect.poll(() => rows().map((_, at) => rowText(at))).not.toContain(oldest);
  expect(rows()).toHaveLength(7);
  expect(rowText(0)).toMatch(/by hand\s+48 MB\s+Restore…$/);
  expect(rowText(1)).toMatch(/^Today, 09:14\s+by hand/);
});

test("at the window's least the time is never cut and how it was taken gives way first", async () => {
  await page.viewport(640, 480);
  await opened();
  await expect.poll(() => rows().length).toBe(7);
  await userEvent.click(page.getByRole("button", { name: "Backups to Keep: 7" }));
  await userEvent.click(page.getByRole("option", { name: "3", exact: true }));
  await expect.poll(() => rowText(4)).toMatch(/removed at the next backup/);
  const cells = (rows()[4]?.firstElementChild?.children ?? []) as HTMLCollectionOf<HTMLElement>;
  const [taken, size, action] = [...cells];
  const [time, how] = [...(taken?.children ?? [])] as HTMLElement[];
  expect(time?.scrollWidth).toBe(time?.clientWidth);
  expect(how?.scrollWidth).toBeGreaterThan(how?.clientWidth ?? 0);
  expect(how?.title).toBe("removed at the next backup");
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  expect(size?.getBoundingClientRect().width).toBeCloseTo(3.25 * rem, 0);
  expect(action?.getBoundingClientRect().width).toBeCloseTo(4.25 * rem, 0);
  const button = action?.querySelector(".truncate") as HTMLElement;
  expect(button.scrollWidth).toBe(button.clientWidth);
});

function Launch() {
  useLaunchBackup();
  return null;
}

test("the launch's backup refused says so at the foot of navigation, naming the folder", async () => {
  setNews(null);
  resetBackups({ kind: "diskFull" });
  await render(<Launch />);
  await expect.poll(getNews).toEqual({
    kind: "keyRefused",
    line: "The index could not be backed up. The disk is full.",
    path: "D:\\Filmstrip\\data\\backups",
  });
  setNews(null);
});
