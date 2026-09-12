// The grid's two layouts, as pure functions that share one result shape, so the grid's windowing
// never needs to know which is running. Rows are what the windowing reads, in either layout.

export type LayoutMode = "justified" | "uniform";

export type LayoutRequest = {
  id: number;
  mode: LayoutMode;
  /** Width over height for each item, in display order. */
  aspects: Float32Array;
  width: number;
  /** A justified row's height before it is fitted; a uniform cell's side. */
  target: number;
  gap: number;
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
};

/** A row may grow to fill the width, but not past this multiple of the target height. */
const MAX_ROW_SCALE = 2.4;
/** A sliver of an image still gets a tile wide enough to see. */
const MIN_ASPECT = 0.08;

export function layout(request: LayoutRequest): LayoutResult {
  return request.mode === "uniform" ? uniform(request) : justified(request);
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
