import type { SortKey } from "../../ipc/bindings/SortKey";
import { Dropdown } from "../../ui/Dropdown";
import { GlyphButton } from "../../ui/GlyphButton";
import { usePlace } from "../place";
import { chooseKey, reverse, shuffle, sortPlace, useSort } from "./sort";

// The five keys and what each reads at first and reversed. DECISIONS.md "Sorting a place".
const KEYS: readonly { value: SortKey; label: string; first?: string; reversed?: string }[] = [
  { value: "taken", label: "Date Taken", first: "Newest First", reversed: "Oldest First" },
  { value: "added", label: "Date Added", first: "Newest First", reversed: "Oldest First" },
  { value: "size", label: "Size", first: "Largest First", reversed: "Smallest First" },
  { value: "length", label: "Length", first: "Longest First", reversed: "Shortest First" },
  { value: "random", label: "Random" },
];

/** The order a place's grid runs in, and the button that turns it over, in the grid's header. */
export function SortOrder() {
  const place = usePlace();
  const kind = sortPlace(place);
  const sort = useSort(place);
  if (!kind) return null;
  const key = KEYS.find((candidate) => candidate.value === sort.key) ?? KEYS[0];
  const random = sort.key === "random";
  const desc = sort.dir === "desc";
  const now = desc ? key?.first : key?.reversed;
  const next = desc ? key?.reversed : key?.first;
  return (
    <>
      <Dropdown
        label="Sort"
        title={random ? "Sort · Random" : `Sort · ${key?.label}, ${now}`}
        glyph={random ? "shuffle" : desc ? "sortDescending" : "sortAscending"}
        options={KEYS}
        value={sort.key}
        onChange={(chosen) => chooseKey(kind, chosen)}
        act={
          random
            ? {
                label: "Shuffle",
                hint: "a new order",
                glyph: "reshuffle",
                onSelect: () => shuffle(kind),
              }
            : undefined
        }
        words="narrow"
      />
      <GlyphButton
        glyph="reverse"
        label={random ? "Reverse · a random order has no direction" : `Reverse · ${next}`}
        disabled={random}
        onClick={() => reverse(kind)}
      />
    </>
  );
}
