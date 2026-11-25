import { placeItems } from "../grid/place-items";
import { type Place, placeKey } from "../place";
import { getPaneItem, getPaneOrigin, paneMovesOn, showInPane } from "./pane-store";

/**
 * Where the pane goes if these files take its file out of its place, and the place's files in
 * their order before they went.
 */
export type MoveOn = {
  shown: number | null;
  origin: Place | null;
  next: number | null;
  going: readonly number[];
  order: readonly number[];
};

/**
 * The file that takes the pane's place once these go, worked out before the list changes, from
 * the order the grid shows it in. DECISIONS.md "The pane".
 */
export async function moveOnFrom(going: number[]): Promise<MoveOn> {
  const shown = getPaneItem();
  const origin = getPaneOrigin();
  if (!paneMovesOn(going)) return { shown, origin, next: shown, going, order: [] };
  const rows = await placeItems(origin).catch(() => []);
  const order = rows.map((row) => row.id);
  return { shown, origin, next: neighbour(order, going), going, order };
}

/** The pane moves on, unless its file is among those that stayed. */
export function moveOn({ shown, origin, next }: MoveOn, stayed: readonly { id: number }[]) {
  if (shown === null || next === shown || stayed.some((one) => one.id === shown)) return;
  showInPane(next, origin);
}

/** Whether the pane's place still lists its file, asked again. */
export async function stillListed({ shown, origin }: MoveOn) {
  const rows = await placeItems(origin).catch(() => null);
  return rows === null || rows.some((row) => row.id === shown);
}

/**
 * After files that went later than asked, as a move between drives does: the pane, still on its
 * file in its place, moves on once the place no longer lists it, to the file after them that it
 * still lists.
 */
export async function moveOnLanded(pane: MoveOn) {
  const { shown, origin, going, order } = pane;
  const same = () =>
    shown !== null &&
    getPaneItem() === shown &&
    paneMovesOn([shown]) &&
    placeKey(getPaneOrigin()) === placeKey(origin);
  if (!same()) return;
  const rows = await placeItems(origin).catch(() => null);
  if (!rows || rows.some((row) => row.id === shown) || !same()) return;
  const listed = new Set(rows.map((row) => row.id));
  showInPane(neighbour(order, going, listed), origin);
}

/**
 * The file after the last of these in their place, or the nearest before it when none follows, or
 * none; of those the place lists, when that is given. For one file, the one after it or before
 * it. Artboards › Selecting.
 */
function neighbour(order: readonly number[], going: readonly number[], listed?: Set<number>) {
  const last = order.findLastIndex((id) => going.includes(id));
  if (last < 0) return null;
  const stays = (id: number) => !going.includes(id) && (listed?.has(id) ?? true);
  return order.slice(last + 1).find(stays) ?? order.slice(0, last).findLast(stays) ?? null;
}
