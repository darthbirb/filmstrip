import { type KeyboardEvent, useEffect, useRef } from "react";

import { THUMB_FRAME, ThumbFace } from "./Thumb";

export type StripFrame = { id: number; label: string; src?: string; aspect: number };

type Props = {
  label: string;
  frames: readonly StripFrame[];
  current: number | null;
  onChoose: (id: number) => void;
};

/** A frame keeps a shape between these, so a panorama or a sliver still reads as a picture. */
const NARROWEST = 0.5;
const WIDEST = 2;

/** A filmstrip: one row of thumbnails, one of them current, arrows to step along it. */
export function Strip({ label, frames, current, onChoose }: Props) {
  const elements = useRef(new Map<number, HTMLElement>());
  const tabStop = frames.some((frame) => frame.id === current) ? current : frames[0]?.id;

  useEffect(() => {
    if (current !== null)
      elements.current.get(current)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);

  const step = (event: KeyboardEvent, index: number) => {
    const to =
      event.key === "ArrowRight"
        ? index + 1
        : event.key === "ArrowLeft"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? frames.length - 1
              : undefined;
    const frame = to === undefined ? undefined : frames[to];
    if (!frame) return;
    event.preventDefault();
    onChoose(frame.id);
    elements.current.get(frame.id)?.focus();
  };

  return (
    <div
      role="listbox"
      aria-label={label}
      aria-orientation="horizontal"
      className="flex h-strip shrink-0 gap-tile-gap overflow-x-auto p-tile-gap"
    >
      {frames.map((frame, index) => (
        <div
          key={frame.id}
          ref={(element) => {
            if (element) elements.current.set(frame.id, element);
            else elements.current.delete(frame.id);
          }}
          role="option"
          aria-selected={frame.id === current}
          aria-label={frame.label}
          title={frame.label}
          tabIndex={frame.id === tabStop ? 0 : -1}
          onClick={() => onChoose(frame.id)}
          onKeyDown={(event) => step(event, index)}
          className={`focus-ring h-full shrink-0 cursor-default ${THUMB_FRAME}`}
          style={{ aspectRatio: Math.min(WIDEST, Math.max(NARROWEST, frame.aspect)) }}
        >
          <ThumbFace src={frame.src} current={frame.id === current} />
        </div>
      ))}
    </div>
  );
}
