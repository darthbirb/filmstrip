import type { Shape } from "../../ipc/bindings/Shape";
import type { Suggestion } from "../../ipc/bindings/Suggestion";

/** A term the field shows as a chip: anything the query read that is not plain words. */
export type Chip = { text: string; shape: Exclude<Shape, { kind: "text" }> };

/** What the field holds: its chips, then the words in its input. */
export type Held = { chips: readonly Chip[]; text: string };

export const scoping = (chip: Chip) => chip.shape.kind === "path" || chip.shape.kind === "place";

/** The query the field's chips and words make, as one text. */
export const queryOf = ({ chips, text }: Held) =>
  [...chips.map((chip) => chip.text), text.trim()].filter((part) => part !== "").join(" ");

/**
 * Where ↓ or ↑ takes the plate: from no row to the first or the last, and off either end back to
 * no row, so Enter can still run the words as typed.
 */
export function movePlate(at: number | null, by: 1 | -1, count: number): number | null {
  if (count === 0) return null;
  if (at === null) return by === 1 ? 0 : count - 1;
  const next = at + by;
  return next < 0 || next >= count ? null : next;
}

/**
 * The field once a row is picked. The row's term replaces the word being typed, from `from` on; a
 * folder instead becomes the scope, since a query holds one place. DECISIONS.md "Search".
 */
export function picked(held: Held, from: number, row: Suggestion): Held {
  const kept = held.text.slice(0, from);
  if (row.kind === "folder" && row.shape.kind === "path" && !row.text.startsWith("-")) {
    const scope: Chip = { text: row.text, shape: row.shape };
    return {
      chips: [scope, ...held.chips.filter((chip) => !scoping(chip))],
      text: kept.trimEnd(),
    };
  }
  return { chips: held.chips, text: `${kept}${row.text}` };
}
