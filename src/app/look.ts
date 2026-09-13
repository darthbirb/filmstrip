import { useEffect } from "react";

import { COMPARE, useCandidate } from "./candidates";

/** The looks compared live until one is chosen; a production build wears the first. DESIGN.md "Directions under consideration". */
export const LOOKS = ["layered", "darkroom", "greycard"] as const;
export type Look = (typeof LOOKS)[number];

/** The look in use, and a way to change it. The base look is the stylesheet with no attribute at all. */
export function useLook() {
  const [choice, choose] = useCandidate("look", LOOKS);
  const look: Look = choice === COMPARE ? LOOKS[0] : choice;

  useEffect(() => {
    const root = document.documentElement;
    if (look === LOOKS[0]) delete root.dataset.look;
    else root.dataset.look = look;
  }, [look]);

  return [look, choose] as const;
}
