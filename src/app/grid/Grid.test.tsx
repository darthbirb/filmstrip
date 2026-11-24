import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { withoutGlyphs } from "../../dev/words";
import type { ItemRow } from "../../ipc/bindings/ItemRow";
import type { Progress } from "../../ipc/bindings/Progress";
import { libraryChanged } from "../library";
import { getFullScreen, setFullScreen } from "../pane/full-screen";
import { getPaneItem, showInPane } from "../pane/pane-store";
import { setPlace } from "../place";
import { updatePreferences } from "../preferences";
import { Grid } from "./Grid";
import { RELOAD_WINDOW_MS } from "./useGridItems";

const SHAPES = [
  [900, 600],
  [600, 900],
  [800, 800],
  [1400, 500],
];

function rows(count: number): ItemRow[] {
  return Array.from({ length: count }, (_, n) => {
    const [width, height] = SHAPES[n % SHAPES.length] as [number, number];
    return {
      id: n + 1,
      uuid: `item-${n}`,
      folderId: 1,
      diskName: `item-${n}.png`,
      ext: "png",
      kind: "image",
      sizeBytes: 1,
      mtime: 0,
      width,
      height,
      durationMs: null,
      favorite: false,
      thumb: null,
      scrub: null,
    };
  });
}

/** Serves `count` items for the folder, and records every command the grid sends. */
function serve(count: number) {
  const sent: string[] = [];
  mockIPC(
    (cmd) => {
      sent.push(cmd);
      return cmd === "folder_items" ? rows(count) : undefined;
    },
    { shouldMockEvents: true },
  );
  return sent;
}

async function renderGrid(mode: "justified" | "uniform") {
  await page.viewport(1000, 700);
  return render(
    <div style={{ width: 1000, height: 600 }}>
      <Grid mode={mode} />
    </div>,
  );
}

const tiles = () => [...document.querySelectorAll("figure")] as HTMLElement[];
const firstRow = () => {
  const top = tiles()[0]?.style.top;
  return tiles().filter((tile) => tile.style.top === top);
};

beforeEach(() => {
  setPlace({ kind: "folder", sourceId: 1, path: [{ id: 1, title: "Pictures" }] });
  showInPane(null);
  setFullScreen(false);
});

afterEach(() => {
  updatePreferences({ tile: undefined });
});

test("justified rows run edge to edge and keep each picture's shape", async () => {
  serve(40);
  await renderGrid("justified");
  await expect.poll(() => tiles().length).toBeGreaterThan(0);

  const row = firstRow();
  const last = row.at(-1) as HTMLElement;
  const right = Number.parseFloat(last.style.left) + Number.parseFloat(last.style.width);
  const scroller = document.querySelector("figure")?.closest(".overflow-auto") as HTMLElement;
  const gap = Number.parseFloat(row[0]?.style.left ?? "0");
  expect(right).toBeCloseTo(scroller.clientWidth - gap, 0);
  const [first] = row;
  expect(
    Number.parseFloat(first?.style.width ?? "0") / Number.parseFloat(first?.style.height ?? "1"),
  ).toBeCloseTo(1.5, 2);
});

test("uniform tiles are square, and a larger size fits fewer to a row", async () => {
  serve(40);
  await renderGrid("uniform");
  await expect.poll(() => tiles().length).toBeGreaterThan(0);
  const [tile] = tiles();
  expect(tile?.style.width).toBe(tile?.style.height);
  const perRow = firstRow().length;

  updatePreferences({ tile: 20 });
  await expect.poll(() => firstRow().length).toBeLessThan(perRow);
});

test("only the rows near the view are drawn, and scrolling draws the rest", async () => {
  serve(2000);
  await renderGrid("uniform");
  await expect.poll(() => tiles().length).toBeGreaterThan(0);
  expect(tiles().length).toBeLessThan(2000);

  const scroller = document.querySelector("figure")?.closest(".overflow-auto") as HTMLElement;
  scroller.scrollTop = scroller.scrollHeight;
  await expect.poll(() => tiles().some((tile) => tile.title === "item-1999.png")).toBe(true);
});

test("clicking a picture puts it in the pane, and the grid marks which one it is", async () => {
  serve(6);
  const screen = await renderGrid("justified");
  const third = screen.getByRole("button", { name: "item-2.png" });
  await third.click();

  expect(getPaneItem()).toBe(3);
  await expect.element(third).toHaveAttribute("aria-current", "true");
  await screen.getByRole("button", { name: "item-4.png" }).click();
  await expect.element(third).not.toHaveAttribute("aria-current");
});

test("a double-clicked picture takes the window, where a single click only shows it", async () => {
  serve(6);
  const screen = await renderGrid("justified");
  const third = screen.getByRole("button", { name: "item-2.png" });
  await third.click();
  expect(getPaneItem()).toBe(3);
  expect(getFullScreen()).toBe(false);

  await third.dblClick();
  expect(getPaneItem()).toBe(3);
  expect(getFullScreen()).toBe(true);
});

test("Enter on the tile the keyboard is on shows it in the pane, and the window stays", async () => {
  serve(6);
  const screen = await renderGrid("justified");
  const third = screen.getByRole("button", { name: "item-2.png" });
  await expect.element(third).toBeVisible();
  (third.element() as HTMLElement).focus();

  await userEvent.keyboard("{Enter}");
  expect(getPaneItem()).toBe(3);
  expect(getFullScreen()).toBe(false);
});

test("an empty place says which kind of empty it is, in its own words", async () => {
  mockIPC((cmd) => (cmd === "folder_items" || cmd === "sorting_items" ? [] : undefined), {
    shouldMockEvents: true,
  });
  const screen = await renderGrid("justified");
  await expect.element(screen.getByText("This Folder Is Empty")).toBeVisible();

  setPlace({ kind: "sorting" });
  await expect.element(screen.getByText("Nothing to Sort")).toBeVisible();
});

test("while a place is read, stand-ins fill the rows, and its tiles replace them", async () => {
  let answer: (rows: ItemRow[]) => void = () => undefined;
  mockIPC(
    (cmd) =>
      cmd === "folder_items"
        ? new Promise<ItemRow[]>((resolve) => {
            answer = resolve;
          })
        : undefined,
    { shouldMockEvents: true },
  );
  const screen = await renderGrid("justified");
  const reading = screen.getByTestId("reading");
  await expect.poll(() => reading.elements().length).toBe(1);
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(tiles()).toHaveLength(0);
  // Each row of stand-ins runs edge to edge, as the rows that replace it will.
  const row = reading.element().firstElementChild as HTMLElement;
  const last = row.lastElementChild as HTMLElement;
  expect(row.children.length).toBeGreaterThan(1);
  expect(last.getBoundingClientRect().right).toBeCloseTo(row.getBoundingClientRect().right, 0);

  answer(rows(6));
  await expect.poll(() => tiles().length).toBe(6);
  expect(reading.elements()).toHaveLength(0);
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
});

test("a video's tile writes its length after a play glyph, and a picture's writes nothing", async () => {
  const [picture, other] = rows(2) as [ItemRow, ItemRow];
  const clip: ItemRow = { ...other, diskName: "clip.mp4", ext: "mp4", kind: "video" };
  mockIPC(
    (cmd) => (cmd === "folder_items" ? [picture, { ...clip, durationMs: 12_000 }] : undefined),
    { shouldMockEvents: true },
  );
  const screen = await renderGrid("justified");
  const clipTile = screen.getByRole("button", { name: "clip.mp4" });
  await expect.element(clipTile).toBeVisible();
  expect(withoutGlyphs(clipTile.element().textContent)).toBe("0:12");
  expect(clipTile.element().textContent).not.toBe("0:12");
  expect(screen.getByRole("button", { name: picture.diskName }).element().textContent).toBe("");
});

const QUIET: Progress = {
  phase: "working",
  pending: 40,
  running: 2,
  failed: 0,
  completed: 0,
  copies: [],
  exports: [],
  moves: [],
  walks: 1,
  thumbed: [],
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a walk under way reads the place again at most once a window, however often it reports", async () => {
  const listed: number[] = [];
  mockIPC(
    (cmd) => {
      if (cmd !== "folder_items") return undefined;
      listed.push(performance.now());
      return rows(4);
    },
    { shouldMockEvents: true },
  );
  await renderGrid("justified");
  await expect.poll(() => listed.length).toBe(1);

  for (let tick = 0; tick < 20; tick++) {
    await emit("job-progress", { ...QUIET, phase: "walking", completed: tick });
    await pause(RELOAD_WINDOW_MS / 10);
  }
  await expect.poll(() => listed.length, { timeout: RELOAD_WINDOW_MS * 2 }).toBeGreaterThan(1);
  await pause(RELOAD_WINDOW_MS * 1.5);
  const reads = listed.slice(1);
  expect(reads.length).toBeLessThan(5);
  for (const [n, at] of reads.entries())
    if (n > 0) expect(at - (reads[n - 1] ?? 0)).toBeGreaterThanOrEqual(RELOAD_WINDOW_MS - 20);
});

test("thumbnails made patch their tiles, and nothing else is read again", async () => {
  const sent: string[] = [];
  const asked: unknown[] = [];
  mockIPC(
    (cmd, payload) => {
      sent.push(cmd);
      if (cmd === "folder_items") return rows(4);
      if (cmd === "items_detail") {
        asked.push(payload);
        return [{ ...rows(4)[1], thumb: "C:/thumbs/item-1.webp" }, null];
      }
      return undefined;
    },
    { shouldMockEvents: true },
  );
  await renderGrid("justified");
  await expect.poll(() => tiles().length).toBe(4);
  const picture = () => document.querySelector('[title="item-1.png"] img');
  expect(picture()).toBeNull();

  for (let tick = 1; tick <= 5; tick++)
    await emit("job-progress", { ...QUIET, completed: tick, thumbed: tick === 1 ? [2, 9] : [] });
  await expect.poll(picture).not.toBeNull();
  expect(document.querySelectorAll("figure img")).toHaveLength(1);
  expect(asked).toEqual([{ itemIds: [2, 9] }]);
  await pause(RELOAD_WINDOW_MS * 1.5);
  expect(sent.filter((cmd) => cmd === "folder_items")).toHaveLength(1);
});

test("a listing that answers after a newer one is dropped", async () => {
  const answers: ((rows: ItemRow[]) => void)[] = [];
  mockIPC(
    (cmd) => {
      if (cmd !== "folder_items") return undefined;
      if (answers.length === 0) {
        answers.push(() => undefined);
        return rows(4);
      }
      return new Promise<ItemRow[]>((resolve) => answers.push(resolve));
    },
    { shouldMockEvents: true },
  );
  await renderGrid("justified");
  await expect.poll(() => tiles().length).toBe(4);

  await libraryChanged();
  await libraryChanged();
  await expect.poll(() => answers.length).toBe(3);
  answers[2]?.(rows(2));
  await expect.poll(() => tiles().length).toBe(2);
  answers[1]?.(rows(6));
  for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
  expect(tiles()).toHaveLength(2);
});

test("two grids on one page each keep their own layout", async () => {
  serve(12);
  await page.viewport(1000, 700);
  await render(
    <div style={{ display: "flex", width: 1000, height: 600 }}>
      <section aria-label="justified" style={{ width: 500 }}>
        <Grid mode="justified" />
      </section>
      <section aria-label="uniform" style={{ width: 500 }}>
        <Grid mode="uniform" />
      </section>
    </div>,
  );
  const widths = (name: string) =>
    [...document.querySelectorAll(`section[aria-label="${name}"] figure`)].map(
      (tile) => (tile as HTMLElement).style.width,
    );
  await expect.poll(() => widths("justified").length).toBe(12);
  await expect.poll(() => widths("uniform").length).toBe(12);

  expect(new Set(widths("uniform")).size).toBe(1);
  expect(new Set(widths("justified")).size).toBeGreaterThan(1);
});
