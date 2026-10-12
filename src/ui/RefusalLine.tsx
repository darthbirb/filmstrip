import { useLayoutEffect, useRef } from "react";

/**
 * Why a field turns down what was typed, on a line of its own under it, brought into view as it
 * appears, so a field at the foot of a short scroller does not hide it. DESIGN.md "Components".
 */
export function RefusalLine({ children }: { children: string }) {
  const line = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    line.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, []);

  return (
    <span ref={line} className="w-full text-danger text-key leading-normal">
      {children}
    </span>
  );
}
