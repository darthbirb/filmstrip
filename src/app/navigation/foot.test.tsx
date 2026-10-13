import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { inSight } from "../../dev/in-sight";
import type { LibraryTotals } from "../../ipc/bindings/LibraryTotals";
import type { Progress } from "../../ipc/bindings/Progress";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { getPlace, setPlace } from "../place";
import { Breadcrumb } from "./Breadcrumb";
import { Foot } from "./Foot";
import { loadIndex, resetIndex, startIndex } from "./index-store";
import { Rail } from "./Rail";
import { setRefused } from "./refusal-store";
import { sortingRow } from "./shared";
import { resetWork, watchWork } from "./work-store";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const SOURCES: SourceSummary[] = [
  {
    id: 1,
    root: "D:\\Pictures",
    title: "Pictures",
    kind: "library",
    addedAt: 0,
    indexedAt: null,
    rootFolderId: 1,
    reachable: true,
    itemCount: 41_236,
    rootCount: 0,
    totalBytes: 0,
    favorite: false,
  },
  {
    id: 2,
    root: "D:\\Incoming",
    title: "Incoming",
    kind: "sorting",
    addedAt: 0,
    indexedAt: null,
    rootFolderId: 2,
    reachable: true,
    itemCount: 3,
    rootCount: 3,
    totalBytes: 0,
    favorite: false,
  },
];

const TOTALS: LibraryTotals = {
  pictures: { count: 38_902, bytes: 268 * GB },
  videos: { count: 2_334, bytes: 44 * GB },
  other: { count: 0, bytes: 0 },
  all: { count: 41_236, bytes: 312 * GB },
  sorting: { count: 3, bytes: 18 * MB },
  trash: { count: 12, bytes: 48 * MB },
};

const NOTHING: LibraryTotals = {
  pictures: { count: 0, bytes: 0 },
  videos: { count: 0, bytes: 0 },
  other: { count: 0, bytes: 0 },
  all: { count: 0, bytes: 0 },
  sorting: { count: 0, bytes: 0 },
  trash: { count: 0, bytes: 0 },
};

const IDLE: Progress = { phase: "idle", pending: 0, running: 0, failed: 0, completed: 0 };

/** Answers as the app would, over these sources and totals. */
async function holding(sources: SourceSummary[], totals: LibraryTotals) {
  mockIPC(
    (cmd) => {
      if (cmd === "list_sources") return sources;
      if (cmd === "library_totals") return totals;
      if (cmd === "index_progress") return IDLE;
      if (cmd === "index_failures") return [];
      return undefined;
    },
    { shouldMockEvents: true },
  );
  resetIndex();
  await loadIndex();
}

beforeEach(async () => {
  resetWork();
  setRefused(null);
  setPlace(null);
  await holding(SOURCES, TOTALS);
  await watchWork();
});

const LINE = "41,236 items · 312 GB";

/** The line the foot shows, without its glyph. */
const wordsOf = (foot: { element: () => Element }) => foot.element().lastElementChild?.textContent;

/** The token's own length in pixels, so the code, the test and the doc move together. */
const tileGap = () => {
  const root = getComputedStyle(document.documentElement);
  return (
    Number.parseFloat(root.getPropertyValue("--spacing-tile-gap")) *
    Number.parseFloat(root.fontSize)
  );
};

/** Each row of the totals: its name, its count, and what follows the count. */
const rowsOf = (dialog: Element) =>
  [...dialog.querySelectorAll("dt")].map((term) => [
    term.textContent,
    term.nextElementSibling?.textContent,
    term.nextElementSibling?.nextElementSibling?.textContent,
  ]);

test("the panel's baseline says what the library holds and weighs, grouped as Windows groups it", async () => {
  const screen = await render(<Foot />);
  const foot = screen.getByRole("button", { name: LINE });
  await expect.element(foot).toBeVisible();
  expect(wordsOf(foot)).toBe(LINE);
  await expect.element(foot).toHaveAttribute("title", "Library · what it holds");
});

test("one item is a singular, and an empty library says nought without a size", async () => {
  await holding(SOURCES, { ...TOTALS, all: { count: 1, bytes: 4.2 * MB } });
  const one = await render(<Foot />);
  await expect.element(one.getByRole("button", { name: "1 item · 4.2 MB" })).toBeVisible();
  one.unmount();

  await holding([], NOTHING);
  const screen = await render(<Foot />);
  const foot = screen.getByRole("button", { name: "0 items" });
  await expect.element(foot).toBeVisible();
  expect(wordsOf(foot)).toBe("0 items");

  // Opened, every figure is nought, still in its column, with no size beside it.
  await foot.click();
  const totals = screen.getByRole("dialog", { name: "Library" });
  await expect.element(totals).toBeVisible();
  expect(rowsOf(totals.element())).toEqual([
    ["Pictures", "0", ""],
    ["Videos", "0", ""],
    ["In All", "0", ""],
    ["Sorting Box", "0", ""],
    ["Trash", "0", ""],
    ["Sources", "0", ""],
  ]);
});

test("a click opens the totals above the foot, by kind, then what waits and what is thrown away", async () => {
  const screen = await render(
    <div style={{ height: 600, display: "flex", flexDirection: "column", justifyContent: "end" }}>
      <Foot />
    </div>,
  );
  const foot = screen.getByRole("button", { name: LINE });
  await foot.click();
  const totals = screen.getByRole("dialog", { name: "Library" });
  await expect.element(totals).toBeVisible();
  await expect.element(foot).toHaveAttribute("aria-expanded", "true");
  expect(document.activeElement).toBe(totals.element());
  expect(rowsOf(totals.element())).toEqual([
    ["Pictures", "38,902", "268 GB"],
    ["Videos", "2,334", "44 GB"],
    ["In All", "41,236", "312 GB"],
    ["Sorting Box", "3", "18 MB"],
    ["Trash", "12", "48 MB"],
    ["Sources", "2", ""],
  ]);

  // A tile-gap above the foot, left edges met.
  const surface = totals.element().getBoundingClientRect();
  const baseline = foot.element().getBoundingClientRect();
  expect(surface.bottom).toBeCloseTo(baseline.top - tileGap(), 0);
  expect(surface.left).toBeCloseTo(baseline.left, 0);

  await userEvent.keyboard("{Escape}");
  await expect.poll(() => inSight(totals)).toBe(false);
  expect(document.activeElement).toBe(foot.element());
  await expect.element(foot).toHaveAttribute("aria-expanded", "false");
});

test("a source that is away is counted from the index, and the totals say which and since when", async () => {
  const archive: SourceSummary = {
    ...(SOURCES[0] as SourceSummary),
    id: 3,
    title: "Archive",
    root: "E:\\Archive",
    rootFolderId: 3,
    reachable: false,
    itemCount: 6_120,
    indexedAt: new Date(new Date().getFullYear(), 9, 3, 12).getTime() / 1000,
  };
  await holding([...SOURCES, archive], TOTALS);
  const screen = await render(<Foot />);
  // The baseline is still the library's.
  await screen.getByRole("button", { name: LINE }).click();
  const totals = screen.getByRole("dialog", { name: "Library" });
  expect(rowsOf(totals.element()).at(-1)).toEqual(["Sources", "3", "1 offline"]);
  await expect
    .element(
      totals.getByText("Archive is offline · its 6,120 are counted from the last walk, 3 Oct"),
    )
    .toBeVisible();
});

test("two sources away under one name each keep their own note", async () => {
  const drive = (id: number, root: string): SourceSummary => ({
    ...(SOURCES[0] as SourceSummary),
    id,
    title: "Photos",
    root,
    rootFolderId: id,
    reachable: false,
    itemCount: 0,
  });
  await holding([drive(5, "E:\\Photos"), drive(6, "F:\\Photos")], TOTALS);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const screen = await render(<Foot />);
    await screen.getByRole("button", { name: LINE }).click();
    const totals = screen.getByRole("dialog", { name: "Library" });
    await expect.element(totals).toBeVisible();
    expect(totals.getByText("Photos is offline").elements()).toHaveLength(2);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  } finally {
    errors.mockRestore();
  }
});

test("other files have a row of their own, so the kinds still add up to In All", async () => {
  await holding(SOURCES, {
    ...TOTALS,
    other: { count: 4, bytes: 2 * MB },
    all: { count: 41_240, bytes: 312 * GB + 2 * MB },
  });
  const screen = await render(<Foot />);
  await screen.getByRole("button", { name: "41,240 items · 312 GB" }).click();
  const rows = rowsOf(screen.getByRole("dialog", { name: "Library" }).element());
  expect(rows.slice(0, 4).map(([label]) => label)).toEqual([
    "Pictures",
    "Videos",
    "Other",
    "In All",
  ]);
});

test("at the panel's least the line drops a word, then the size, and never cuts a figure", async () => {
  const at = async (all: LibraryTotals["all"]) => {
    await holding(SOURCES, { ...TOTALS, all });
    return render(
      <div style={{ width: "10rem" }}>
        <Foot />
      </div>,
    );
  };

  const first = await at({ count: 41_236, bytes: 312 * GB });
  const trimmed = first.getByRole("button", { name: LINE });
  await expect.poll(() => wordsOf(trimmed)).toBe("41,236 · 312 GB");
  await expect.element(trimmed).toHaveAttribute("title", LINE);
  first.unmount();

  const huge = "12,604,388 items · 1,186 TB";
  const second = await at({ count: 12_604_388, bytes: 1186 * 1024 * GB });
  const alone = second.getByRole("button", { name: huge });
  await expect.poll(() => wordsOf(alone)).toBe("12,604,388");
  await expect.element(alone).toHaveAttribute("title", huge);
  const words = alone.element().querySelector(".overflow-hidden") as HTMLElement;
  expect(words.scrollWidth).toBeLessThanOrEqual(words.clientWidth);
});

test("folded, the foot keeps its glyph with the line in its tooltip, and opens the totals beside the rail", async () => {
  // The rail's own column, which centres what it holds.
  const screen = await render(
    <div
      data-testid="rail"
      style={{
        width: "2.75rem",
        height: 600,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "end",
      }}
    >
      <Foot rail />
    </div>,
  );
  const foot = screen.getByRole("button", { name: LINE });
  await expect.element(foot).toHaveAttribute("title", LINE);
  expect(foot.element().textContent).not.toContain("41,236");
  const rail = screen.getByTestId("rail").element().getBoundingClientRect();
  const square = foot.element().getBoundingClientRect();
  expect(square.left).toBeCloseTo(rail.left, 0);
  expect(square.width).toBeCloseTo(rail.width, 0);

  await foot.click();
  const totals = screen.getByRole("dialog", { name: "Library" });
  await expect.element(totals).toBeVisible();
  const surface = totals.element().getBoundingClientRect();
  expect(surface.left).toBeCloseTo(rail.right + tileGap(), 0);
  expect(surface.bottom).toBeCloseTo(square.bottom, 0);
});

test("the Sorting Box's header names a sorting source that is away, and keeps its count", async () => {
  const camera: SourceSummary = {
    ...(SOURCES[1] as SourceSummary),
    id: 4,
    title: "Camera",
    root: "F:\\DCIM",
    rootFolderId: 4,
    reachable: false,
    itemCount: 2,
  };
  await holding([...SOURCES, camera], TOTALS);
  setPlace({ kind: "sorting" });
  const screen = await render(<Breadcrumb />);
  await expect.element(screen.getByText("5 waiting · Camera offline")).toBeVisible();
  await expect
    .element(screen.getByText("Camera offline", { exact: true }))
    .toHaveClass(/font-mono/);
  // Its row keeps both figures from the index: only one of its sources is away.
  expect(sortingRow([...SOURCES, camera])).toMatchObject({ count: 5, total: 5 });
});

test("a walk shows above the baseline while it runs, and leaves when it ends", async () => {
  const screen = await render(<Foot />);
  const line = () => screen.getByText(/^Indexing/);
  expect(inSight(line())).toBe(false);

  await emit("job-progress", {
    phase: "working",
    pending: 4120,
    running: 0,
    failed: 0,
    completed: 6880,
  });
  await expect.element(line()).toBeVisible();
  await expect.element(screen.getByText("Indexing 4,120…")).toBeVisible();
  await expect.element(screen.getByText("63%")).toBeVisible();
  // The baseline never moves out from under it.
  await expect.element(screen.getByRole("button", { name: LINE })).toBeVisible();

  await emit("job-progress", IDLE);
  await expect.poll(() => inSight(line())).toBe(false);
});

/** A button's own text is its glyph, so a count is read off its badge rather than the square. */
const badgeOf = (button: { element: () => Element }) =>
  button.element().querySelector(".rounded-mark-badge");

test("the folded rail keeps the app's own places, each carrying its count", async () => {
  const screen = await render(<Rail />);
  const sorting = screen.getByRole("button", { name: "Sorting Box" });
  await expect.element(sorting).toBeVisible();
  expect(badgeOf(sorting)?.textContent).toBe("3");
  expect(badgeOf(screen.getByRole("button", { name: "Trash" }))?.textContent).toBe("12");

  await sorting.click();
  expect(getPlace()?.kind).toBe("sorting");
  await expect.element(sorting).toHaveAttribute("aria-current", "true");
});

test("with nothing thrown away, the Trash wears no badge", async () => {
  await holding(SOURCES, { ...TOTALS, trash: { count: 0, bytes: 0 } });
  const screen = await render(<Rail />);
  await expect.element(screen.getByRole("button", { name: "Trash" })).toBeVisible();
  expect(badgeOf(screen.getByRole("button", { name: "Sorting Box" }))?.textContent).toBe("3");
  expect(badgeOf(screen.getByRole("button", { name: "Trash" }))).toBeNull();
});

test("a refusal stacks above the walk, and dismissing it leaves the walk alone", async () => {
  const screen = await render(<Foot />);
  await emit("job-progress", {
    phase: "working",
    pending: 4120,
    running: 0,
    failed: 0,
    completed: 6880,
  });
  await expect.element(screen.getByText("Indexing 4,120…")).toBeVisible();

  setRefused({ why: "inside", clash: "Pictures", path: "C:UsersadaPicturesTrips" });
  const band = screen.getByText("That folder is already inside Pictures.");
  await expect.element(band).toBeVisible();
  await expect.element(screen.getByText("C:UsersadaPicturesTrips")).toBeVisible();

  // Ordered by permanence from the bottom: the count, the walk, then the band above it.
  const line = screen.getByText("Indexing 4,120…").element().getBoundingClientRect();
  const total = screen.getByRole("button", { name: LINE }).element().getBoundingClientRect();
  expect(band.element().getBoundingClientRect().top).toBeLessThan(line.top);
  expect(line.top).toBeLessThan(total.top);

  await screen.getByRole("button", { name: "Dismiss" }).click();
  await expect.poll(() => inSight(band)).toBe(false);
  // The walk carries on underneath it.
  await expect.element(screen.getByText("Indexing 4,120…")).toBeVisible();
});

test("the baseline is read again when a walk goes quiet", async () => {
  let now = TOTALS;
  mockIPC(
    (cmd) => {
      if (cmd === "list_sources") return SOURCES;
      if (cmd === "library_totals") return now;
      if (cmd === "index_progress") return IDLE;
      if (cmd === "index_failures") return [];
      return undefined;
    },
    { shouldMockEvents: true },
  );
  await startIndex();
  const screen = await render(<Foot />);
  await expect.element(screen.getByRole("button", { name: LINE })).toBeVisible();

  now = { ...TOTALS, all: { count: 41_300, bytes: 313 * GB } };
  await emit("job-progress", IDLE);
  await expect.element(screen.getByRole("button", { name: "41,300 items · 313 GB" })).toBeVisible();
});
