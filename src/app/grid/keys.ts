import { type LayoutResult, rowAt } from "./layout";

type Rows = Pick<
  LayoutResult,
  "rows" | "rowTops" | "rowStart" | "rowLength" | "itemLeft" | "itemWidth"
>;

/** The row a tile is in. */
export function rowOf(rows: Rows, index: number): number {
  let low = 0;
  let high = rows.rows - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((rows.rowStart[middle] ?? 0) <= index) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** The tile in a row whose middle is nearest `x`, so up and down keep the column. */
function nearest(rows: Rows, row: number, x: number): number {
  const start = rows.rowStart[row] ?? 0;
  const end = start + (rows.rowLength[row] ?? 1);
  let best = start;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = start; index < end; index += 1) {
    const middle = (rows.itemLeft[index] ?? 0) + (rows.itemWidth[index] ?? 0) / 2;
    if (Math.abs(middle - x) < distance) {
      distance = Math.abs(middle - x);
      best = index;
    }
  }
  return best;
}

/**
 * Where a key moves the ring from `index` among `count` tiles, `page` pixels to a screen; null for
 * a key that does not move it. Reading order across rows. Artboards › Selecting.
 */
export function step(
  rows: Rows,
  count: number,
  index: number,
  key: string,
  page: number,
): number | null {
  if (count === 0 || rows.rows === 0) return null;
  const row = rowOf(rows, index);
  const x = (rows.itemLeft[index] ?? 0) + (rows.itemWidth[index] ?? 0) / 2;
  const top = rows.rowTops[row] ?? 0;
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowRight":
      return Math.min(count - 1, index + 1);
    case "ArrowUp":
      return row === 0 ? index : nearest(rows, row - 1, x);
    case "ArrowDown":
      return row >= rows.rows - 1 ? index : nearest(rows, row + 1, x);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "PageUp":
      return nearest(rows, rowAt(rows.rowTops, rows.rows, Math.max(0, top - page)), x);
    case "PageDown":
      return nearest(rows, rowAt(rows.rowTops, rows.rows, top + page), x);
    default:
      return null;
  }
}
