// The grid's two layouts, as pure functions that share one result shape, so the grid's windowing
// never needs to know which is running. Rows are what the windowing reads, in either layout.

export type LayoutMode = "justified" | "uniform";

export const DEFAULT_LAYOUT: LayoutMode = "justified";

export type LayoutRequest = {
  id: number;
  mode: LayoutMode;
  /** Width over height for each item, in display order. */
  aspects: Float32Array;
  width: number;
  /** A justified row's height before it is fitted; a uniform cell's side. */
  target: number;
  gap: number;
  /** Where each run of tiles under its own heading begins, as indexes, ascending from 0. */
  groups?: Uint32Array;
  /** The room above each group, for its heading. */
  lead?: number;
  /** The room under each row, for the words under its tiles. */
  below?: number;
};

export type LayoutResult = {
  id: number;
  rows: number;
  totalHeight: number;
  /** Ascending, one longer than `rows`; the last entry is `totalHeight`. */
  rowTops: Float32Array;
  rowHeights: Float32Array;
  rowStart: Uint32Array;
  rowLength: Uint32Array;
  itemLeft: Float32Array;
  itemWidth: Float32Array;
  /** Where each group's heading stands; none when the request had no groups. */
  groupTops: Float32Array;
};

/** A row may grow to fill the width, but not past this multiple of the target height. */
const MAX_ROW_SCALE = 2.4;
/** A sliver of an image still gets a tile wide enough to see. */
const MIN_ASPECT = 0.08;

export function layout(request: LayoutRequest): LayoutResult {
  const one = request.mode === "uniform" ? uniform : justified;
  const { groups, lead = 0, below = 0 } = request;
  if (!groups?.length && lead === 0 && below === 0) return one(request);
  return stacked(request, one, groups?.length ? [...groups] : [0], lead, below);
}

/**
 * Each group laid out on its own, one under the next, a gap between them and the lead above each,
 * so a group always starts a row of its own; every row keeps `below` free under it.
 */
function stacked(
  request: LayoutRequest,
  one: (request: LayoutRequest) => LayoutResult,
  starts: number[],
  lead: number,
  below: number,
): LayoutResult {
  const count = request.aspects.length;
  const itemLeft = new Float32Array(count);
  const itemWidth = new Float32Array(count);
  const groupTops = new Float32Array(starts.length);
  const tops: number[] = [];
  const heights: number[] = [];
  const rowStarts: number[] = [];
  const lengths: number[] = [];
  let y = 0;
  starts.forEach((start, group) => {
    const end = starts[group + 1] ?? count;
    if (group > 0) y += request.gap;
    groupTops[group] = y;
    y += lead;
    const part = one({ ...request, aspects: request.aspects.subarray(start, end) });
    for (let row = 0; row < part.rows; row += 1) {
      tops.push(y + (part.rowTops[row] ?? 0) + row * below);
      heights.push(part.rowHeights[row] ?? 0);
      rowStarts.push(start + (part.rowStart[row] ?? 0));
      lengths.push(part.rowLength[row] ?? 0);
    }
    itemLeft.set(part.itemLeft, start);
    itemWidth.set(part.itemWidth, start);
    y += part.totalHeight + part.rows * below;
  });
  const rows = tops.length;
  const rowTops = new Float32Array(rows + 1);
  rowTops.set(tops);
  rowTops[rows] = y;
  return {
    id: request.id,
    rows,
    totalHeight: y,
    rowTops,
    rowHeights: Float32Array.from(heights),
    rowStart: Uint32Array.from(rowStarts),
    rowLength: Uint32Array.from(lengths),
    itemLeft,
    itemWidth,
    groupTops,
  };
}

/** Rows filled edge to edge, each picture at its own shape; the last row keeps the target height. */
export function justified({ id, aspects, width, target, gap }: LayoutRequest): LayoutResult {
  const count = aspects.length;
  const itemLeft = new Float32Array(count);
  const itemWidth = new Float32Array(count);
  const tops: number[] = [];
  const heights: number[] = [];
  const starts: number[] = [];
  const lengths: number[] = [];
  const aspect = (index: number) => Math.max(aspects[index] ?? 1, MIN_ASPECT);

  let y = 0;
  let index = 0;
  while (index < count && width > 0) {
    const start = index;
    let sum = 0;
    let rowWidth = 0;
    while (index < count) {
      sum += aspect(index);
      index += 1;
      rowWidth = sum * target + gap * (index - start - 1);
      if (rowWidth >= width) break;
    }

    const length = index - start;
    const unfilled = index >= count && rowWidth < width;
    const height = unfilled
      ? target
      : Math.min((width - gap * (length - 1)) / sum, target * MAX_ROW_SCALE);

    let x = 0;
    for (let at = start; at < index; at += 1) {
      itemLeft[at] = x;
      itemWidth[at] = aspect(at) * height;
      x += aspect(at) * height + gap;
    }
    tops.push(y);
    heights.push(height);
    starts.push(start);
    lengths.push(length);
    y += height + gap;
  }

  const rows = tops.length;
  const totalHeight = rows > 0 ? y - gap : 0;
  const rowTops = new Float32Array(rows + 1);
  rowTops.set(tops);
  rowTops[rows] = totalHeight;
  return {
    id,
    rows,
    totalHeight,
    rowTops,
    rowHeights: Float32Array.from(heights),
    rowStart: Uint32Array.from(starts),
    rowLength: Uint32Array.from(lengths),
    itemLeft,
    itemWidth,
    groupTops: new Float32Array(0),
  };
}

/** Square cells, as many columns as fit at the target size, stretched to fill the width exactly. */
export function uniform({ id, aspects, width, target, gap }: LayoutRequest): LayoutResult {
  const count = aspects.length;
  if (count === 0 || width <= 0) {
    return {
      id,
      rows: 0,
      totalHeight: 0,
      rowTops: new Float32Array([0]),
      rowHeights: new Float32Array(0),
      rowStart: new Uint32Array(0),
      rowLength: new Uint32Array(0),
      itemLeft: new Float32Array(0),
      itemWidth: new Float32Array(0),
      groupTops: new Float32Array(0),
    };
  }

  const columns = Math.max(1, Math.round(width / (target + gap)));
  const cell = (width - gap * (columns - 1)) / columns;
  const rows = Math.ceil(count / columns);
  const itemLeft = new Float32Array(count);
  const itemWidth = new Float32Array(count).fill(cell);
  const rowTops = new Float32Array(rows + 1);
  const rowStart = new Uint32Array(rows);
  const rowLength = new Uint32Array(rows);

  for (let row = 0; row < rows; row += 1) {
    const start = row * columns;
    rowStart[row] = start;
    rowLength[row] = Math.min(columns, count - start);
    rowTops[row] = row * (cell + gap);
    for (let column = 0; column < (rowLength[row] ?? 0); column += 1) {
      itemLeft[start + column] = column * (cell + gap);
    }
  }
  const totalHeight = rows * cell + (rows - 1) * gap;
  rowTops[rows] = totalHeight;
  return {
    id,
    rows,
    totalHeight,
    rowTops,
    rowHeights: new Float32Array(rows).fill(cell),
    rowStart,
    rowLength,
    itemLeft,
    itemWidth,
    groupTops: new Float32Array(0),
  };
}

/** The last row whose top is at or above `y`, by binary search. */
export function rowAt(rowTops: Float32Array, rows: number, y: number): number {
  let low = 0;
  let high = rows - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((rowTops[middle] ?? 0) <= y) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
