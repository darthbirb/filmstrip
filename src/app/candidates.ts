import { useState } from "react";

// A slice's candidates are switched live from the dev readout; a production build always takes
// the first. DEVELOPMENT.md "Slices".
export const CANDIDATE_KEY = "filmstrip:candidate:";
export const COMPARE = "compare";

type Choice<T extends string> = T | typeof COMPARE;

export function useCandidate<T extends string>(slice: string, names: readonly T[]) {
  const [choice, setChoice] = useState<Choice<T>>(() => stored(slice, names));
  const choose = (next: Choice<T>) => {
    try {
      localStorage.setItem(CANDIDATE_KEY + slice, next);
    } catch {
      // The choice holds until the next reload.
    }
    setChoice(next);
  };
  return [import.meta.env.DEV ? choice : (names[0] as T), choose] as const;
}

function stored<T extends string>(slice: string, names: readonly T[]): Choice<T> {
  if (!import.meta.env.DEV) return names[0] as T;
  try {
    const value = localStorage.getItem(CANDIDATE_KEY + slice);
    return names.find((name) => name === value) ?? COMPARE;
  } catch {
    return COMPARE;
  }
}
