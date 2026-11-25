import type { ItemRow } from "../../ipc/bindings/ItemRow";
import { placeItems } from "../grid/place-items";
import type { Place } from "../place";
import { getPaneItem, getPaneOrigin, paneMovesOn, showInPane } from "./pane-store";

/** Where the pane goes if these files take its file out of its place. */
export type MoveOn = { shown: number | null; origin: Place | null; next: number | null };

/**
 * The file that takes the pane's place once these go, worked out before the list changes, from
 * the order the grid shows it in. DECISIONS.md "The pane".
 */
export async function moveOnFrom(going: number[]): Promise<MoveOn> {
  const shown = getPaneItem();
  const origin = getPaneOrigin();
  const next = paneMovesOn(going) ? await neighbour(origin, going) : shown;
  return { shown, origin, next };
}

/** The pane moves on, unless its file is among those that stayed. */
export function moveOn({ shown, origin, next }: MoveOn, stayed: readonly { id: number }[]) {
  if (shown === null || next === shown || stayed.some((one) => one.id === shown)) return;
  showInPane(next, origin);
}

/**
 * The file after the last of these in their place, or the nearest before it when none follows, or
 * none. For one file, the one after it or before it. Artboards › Selecting.
 */
export async function neighbour(place: Place | null, going: number[]) {
  const rows: ItemRow[] = await placeItems(place).catch(() => []);
  const last = rows.findLastIndex((row) => going.includes(row.id));
  if (last < 0) return null;
  const stays = (row: ItemRow) => !going.includes(row.id);
  return rows.slice(last + 1).find(stays)?.id ?? rows.slice(0, last).findLast(stays)?.id ?? null;
}
