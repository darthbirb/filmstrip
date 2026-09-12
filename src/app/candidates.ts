// A slice's candidates are switched from the dev readout; a production build always takes the
// first. DEVELOPMENT.md "Slices".
export const CANDIDATE_KEY = "filmstrip:candidate:";

export function chosenCandidate<T extends string>(slice: string, names: readonly T[]): T {
  const first = names[0] as T;
  if (!import.meta.env.DEV) return first;
  try {
    const stored = localStorage.getItem(CANDIDATE_KEY + slice);
    return names.find((name) => name === stored) ?? first;
  } catch {
    return first;
  }
}

export function chooseCandidate(slice: string, name: string) {
  localStorage.setItem(CANDIDATE_KEY + slice, name);
  location.reload();
}
