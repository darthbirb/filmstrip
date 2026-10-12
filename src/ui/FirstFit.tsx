import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  /** Each wording shorter than the one before; the first that fits whole is shown. */
  texts: readonly string[];
  /** Which one was shown, each time that changes. */
  onFit?: (index: number) => void;
  /** Its room comes from the caller, as `flex-1`, never from what it holds. */
  className?: string;
};

/**
 * The first of several wordings that fits its room, measured against the real width: a line
 * gives up whole parts and is never cut part-way. DESIGN.md "Components".
 */
export function FirstFit({ texts, onFit, className = "" }: Props) {
  const room = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState(0);
  const latest = useRef({ texts, onFit });
  latest.current = { texts, onFit };
  const key = texts.join("\n");

  useLayoutEffect(() => {
    const box = room.current;
    if (!box || key === "") return;
    let live = true;
    const measure = () => {
      if (!live) return;
      const width = box.getBoundingClientRect().width;
      // Measured in the room's own face and figures, then gone again before anything paints.
      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;visibility:hidden;white-space:nowrap;width:max-content";
      box.append(probe);
      const widths = latest.current.texts.map((text) => {
        probe.textContent = text;
        return probe.getBoundingClientRect().width;
      });
      probe.remove();
      const found = widths.findIndex((needed) => needed <= width);
      setAt(found === -1 ? widths.length - 1 : found);
    };
    measure();
    void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [key]);

  const shown = Math.min(at, texts.length - 1);
  useLayoutEffect(() => {
    latest.current.onFit?.(shown);
  }, [shown]);

  return (
    <span ref={room} className={`relative min-w-0 overflow-hidden whitespace-nowrap ${className}`}>
      {texts[shown]}
    </span>
  );
}
