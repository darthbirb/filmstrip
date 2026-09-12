import { useEffect, useMemo, useRef, useState } from "react";

import type { ItemRow } from "../../ipc/bindings/ItemRow";
import type { LayoutMode, LayoutRequest, LayoutResult } from "./layout";

/** An item not yet measured lays out square until its thumbnail says otherwise. */
const UNKNOWN_ASPECT = 1;

// One worker for the page's life: StrictMode mounts effects twice, and a worker per mount churns.
let shared: Worker | null = null;
function worker() {
  shared ??= new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" });
  return shared;
}

/** The latest layout for these items; one that arrives after a newer request is dropped. */
export function useLayout(
  items: ItemRow[],
  width: number,
  target: number,
  gap: number,
  mode: LayoutMode,
) {
  const latest = useRef(0);
  const [result, setResult] = useState<LayoutResult | null>(null);
  const aspects = useMemo(
    () =>
      Float32Array.from(items, (item) =>
        item.width && item.height ? item.width / item.height : UNKNOWN_ASPECT,
      ),
    [items],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<LayoutResult>) => {
      if (event.data.id === latest.current) setResult(event.data);
    };
    worker().addEventListener("message", onMessage);
    return () => worker().removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (width <= 0) return;
    latest.current += 1;
    const request: LayoutRequest = { id: latest.current, mode, aspects, width, target, gap };
    worker().postMessage(request);
  }, [aspects, width, target, gap, mode]);

  return result;
}
