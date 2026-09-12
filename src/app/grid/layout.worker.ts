import { type LayoutRequest, layout } from "./layout";

// Lays the grid out off the main thread, so a relayout never competes with scrolling or decoding.
const worker = self as unknown as Worker;

worker.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const result = layout(event.data);
  worker.postMessage(result, [
    result.rowTops.buffer,
    result.rowHeights.buffer,
    result.rowStart.buffer,
    result.rowLength.buffer,
    result.itemLeft.buffer,
    result.itemWidth.buffer,
  ]);
};
