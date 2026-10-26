// How the pane lays out several files at one scale, kept apart from the pane so it can be checked
// on its own. DECISIONS.md "Several files in the pane".

import type { Size } from "./zoom";

/** The least a file in the set is drawn: its shorter side, then its longer, in pixels. */
export type Least = { short: number; long: number };

/** One file as laid out: its band in the row, and the file drawn centred in it. */
export type Placed = { box: Size; drawn: Size };

export type SetLayout = {
  /** The set's scale, against each file's own pixels; a file the floor lifts is drawn above it. */
  scale: number;
  /** How many files each row holds, in the order they were added. */
  rows: number[];
  files: Placed[];
  /** Whether it fits the area; at the floor in too little room it runs past, wrapped as text is. */
  fits: boolean;
};

/** Scales this close to the largest count as equal, which absorbs rounding and nothing more. */
export const EQUAL = 1e-6;

/** Pixels a sum may run over the room, so a set that exactly fills it still fits. */
const SLACK = 1e-6;

/**
 * Where one file is drawn at the set's scale: lifted to the floor, never past the area, and in a
 * band the floor's size across it when the area cut it back from the floor. A file with no shape
 * has no pixels to scale, and stands in at the floor, landscape.
 */
export function place(file: Size, scale: number, area: Size, least: Least): Placed {
  const { width, height } = file;
  if (!(width > 0 && height > 0)) {
    const stand = {
      width: Math.min(area.width, least.long),
      height: Math.min(area.height, least.short),
    };
    return { box: stand, drawn: stand };
  }
  const lift = Math.max(
    least.short / Math.min(width, height),
    least.long / Math.max(width, height),
  );
  const cap = Math.min(area.width / width, area.height / height);
  const own = Math.min(Math.max(scale, lift), cap);
  const drawn = { width: width * own, height: height * own };
  const wide = width >= height;
  const band = {
    width: Math.min(area.width, Math.max(drawn.width, wide ? least.long : least.short)),
    height: Math.min(area.height, Math.max(drawn.height, wide ? least.short : least.long)),
  };
  return { box: band, drawn };
}

/** The largest the set's scale may be: 100%, and no file drawn past the area at it. */
export function scaleLimit(files: readonly Size[], area: Size) {
  let limit = 1;
  for (const file of files) {
    if (file.width > 0 && file.height > 0) {
      limit = Math.min(limit, area.width / file.width, area.height / file.height);
    }
  }
  return Math.max(0, limit);
}

/**
 * Every way of breaking the boxes, in order, into rows no wider than the area: for each start and
 * number of rows, the least height the rest can take, gaps between rows included.
 */
function leastHeights(boxes: readonly Size[], area: Size, gap: number) {
  const n = boxes.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(Infinity));
  (table[n] as number[])[0] = 0;
  for (let start = n - 1; start >= 0; start -= 1) {
    for (let rows = 1; rows <= n - start; rows += 1) {
      let width = -gap;
      let tall = 0;
      let best = Infinity;
      for (let end = start + 1; end <= n; end += 1) {
        const box = boxes[end - 1] as Size;
        width += box.width + gap;
        if (width > area.width + SLACK) break;
        tall = Math.max(tall, box.height);
        const rest = table[end]?.[rows - 1] ?? Infinity;
        if (rest === Infinity) continue;
        best = Math.min(best, tall + (rows > 1 ? gap : 0) + rest);
      }
      (table[start] as number[])[rows] = best;
    }
  }
  return table;
}

function boxesAt(files: readonly Size[], scale: number, area: Size, least: Least) {
  return files.map((file) => place(file, scale, area, least).box);
}

function anyFits(files: readonly Size[], scale: number, area: Size, gap: number, least: Least) {
  const table = leastHeights(boxesAt(files, scale, area, least), area, gap);
  return (table[0] ?? []).some((height) => height <= area.height + SLACK);
}

/** The largest scale at which `fits` holds, between none and `limit`; it holds at none. */
function largest(limit: number, fits: (scale: number) => boolean) {
  if (fits(limit)) return limit;
  let low = 0;
  let high = limit;
  for (let step = 0; step < 64; step += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * Of the splits that fit at this scale, the one with the fewest rows, then the earlier rows fuller,
 * as text wraps: at the first row where two differ, the one holding more files.
 */
function chooseRows(boxes: readonly Size[], area: Size, gap: number) {
  const n = boxes.length;
  const table = leastHeights(boxes, area, gap);
  const first = table[0] ?? [];
  let rows = 1;
  while (rows <= n && !((first[rows] ?? Infinity) <= area.height + SLACK)) rows += 1;
  if (rows > n) return null;
  const counts: number[] = [];
  let start = 0;
  let used = 0;
  for (let left = rows; left > 0; left -= 1) {
    let width = -gap;
    let tall = 0;
    let take = 0;
    for (let end = start + 1; end <= n; end += 1) {
      const box = boxes[end - 1] as Size;
      width += box.width + gap;
      if (width > area.width + SLACK) break;
      tall = Math.max(tall, box.height);
      const rest = table[end]?.[left - 1] ?? Infinity;
      const height = used + tall + (left > 1 ? gap : 0) + rest;
      if (height <= area.height + SLACK) take = end - start;
    }
    let tallest = 0;
    for (let at = start; at < start + take; at += 1) {
      tallest = Math.max(tallest, boxes[at]?.height ?? 0);
    }
    used += tallest + gap;
    counts.push(take);
    start += take;
  }
  return counts;
}

/** Rows as text wraps them, for a set that does not fit even at the floor. */
function wrap(boxes: readonly Size[], area: Size, gap: number) {
  const counts: number[] = [];
  let width = Infinity;
  for (const box of boxes) {
    if (width + gap + box.width > area.width + SLACK) {
      counts.push(1);
      width = box.width;
    } else {
      counts[counts.length - 1] = (counts.at(-1) ?? 0) + 1;
      width += gap + box.width;
    }
  }
  return counts;
}

function fitsRows(boxes: readonly Size[], rows: readonly number[], area: Size, gap: number) {
  let start = 0;
  let height = -gap;
  for (const count of rows) {
    let width = -gap;
    let tall = 0;
    for (let at = start; at < start + count; at += 1) {
      const box = boxes[at] as Size;
      width += box.width + gap;
      tall = Math.max(tall, box.height);
    }
    if (width > area.width + SLACK) return false;
    height += tall + gap;
    start += count;
  }
  return height <= area.height + SLACK;
}

/**
 * Where each file's band stands in the area: its rows centred and stacked a gap apart, the whole
 * centred in the area's height while it fits, each band on its row's middle line. `height` is all
 * of it, which is more than the area's only when the set runs past it.
 */
export function arrange(layout: SetLayout, area: Size, gap: number) {
  const at: { left: number; top: number }[] = [];
  const rows: { start: number; count: number; width: number; height: number }[] = [];
  let start = 0;
  for (const count of layout.rows) {
    const boxes = layout.files.slice(start, start + count).map((one) => one.box);
    const width = boxes.reduce((sum, box) => sum + box.width, gap * (count - 1));
    const height = Math.max(0, ...boxes.map((box) => box.height));
    rows.push({ start, count, width, height });
    start += count;
  }
  const height = rows.reduce((sum, row) => sum + row.height, gap * Math.max(0, rows.length - 1));
  let top = Math.max(0, (area.height - height) / 2);
  for (const row of rows) {
    let left = Math.max(0, (area.width - row.width) / 2);
    for (let index = row.start; index < row.start + row.count; index += 1) {
      const box = layout.files[index]?.box ?? { width: 0, height: 0 };
      at[index] = { left, top: top + (row.height - box.height) / 2 };
      left += box.width + gap;
    }
    top += row.height + gap;
  }
  return { at, height };
}

/**
 * The files, in the order added, at the one scale that draws them largest in the area, broken into
 * the rows that allow it. DECISIONS.md "Several files in the pane".
 */
export function layOutSet(
  files: readonly Size[],
  area: Size,
  gap: number,
  least: Least,
): SetLayout {
  const at = (scale: number) => files.map((file) => place(file, scale, area, least));
  if (files.length === 0 || !(area.width > 0 && area.height > 0)) {
    return { scale: 0, rows: [], files: at(0), fits: false };
  }
  if (!anyFits(files, 0, area, gap, least)) {
    const floor = at(0);
    return {
      scale: 0,
      rows: wrap(
        floor.map((one) => one.box),
        area,
        gap,
      ),
      files: floor,
      fits: false,
    };
  }
  const best = largest(scaleLimit(files, area), (scale) => anyFits(files, scale, area, gap, least));
  const tied = best * (1 - EQUAL);
  const rows = chooseRows(boxesAt(files, tied, area, least), area, gap) ?? [files.length];
  const scale = largest(best, (scale) =>
    fitsRows(boxesAt(files, scale, area, least), rows, area, gap),
  );
  return { scale, rows, files: at(scale), fits: true };
}
