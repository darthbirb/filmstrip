import type { Sort } from "./bindings/Sort";
import type { SortKey } from "./bindings/SortKey";

/** The order every place starts in, newest taken first, as `Sort::default` is. */
export const FIRST_SORT: Sort = { key: "taken", dir: "desc", seed: 0 };

const EVERY_SORT_KEY: Record<SortKey, null> = {
  taken: null,
  added: null,
  size: null,
  length: null,
  random: null,
};

/** Every key a place can be sorted by, in the order the menu lists them. */
export const SORT_KEYS = Object.keys(EVERY_SORT_KEY) as readonly SortKey[];

export const isSortKey = (value: unknown): value is SortKey =>
  typeof value === "string" && Object.hasOwn(EVERY_SORT_KEY, value);
