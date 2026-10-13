import { expect, test } from "vitest";

import type { Coverage } from "../../ipc/bindings/Coverage";
import type { Covered } from "../../ipc/bindings/Covered";
import { countOf, listed, refusal, sections, whoseTag } from "./coverage";

let next = 1;
const ids = new Map<string, number>();
const tag = (value: string, files: number, extra: Partial<Covered> = {}): Covered => {
  const key = `${extra.key ?? ""}:${value}`;
  if (!ids.has(key)) ids.set(key, next++);
  return { tagId: ids.get(key) ?? 0, key: null, value, name: false, files, ...extra };
};
const name = (value: string, files: number) => tag(value, files, { name: true });
const folder = (id: number, title: string, under: number, tags: Covered[]) => ({
  folder: { id, title },
  under,
  tags,
});

// Artboards › Tagging a set: four checked in a search, three from Cairo and one from Lisbon.
const SEARCH: Coverage = {
  files: 4,
  own: [tag("egypt", 1), tag("sphinx", 1)],
  folders: [
    folder(1, "Pictures", 4, [name("pictures", 4)]),
    folder(4, "Trips", 4, [
      name("trips", 4),
      tag("travel", 4),
      tag("egypt 2024", 4, { key: "trip" }),
    ]),
    folder(6, "Cairo", 3, [name("cairo", 3), tag("egypt", 3)]),
    folder(7, "Lisbon", 1, [name("lisbon", 1), tag("portugal", 1)]),
  ],
};

const headings = (coverage: Coverage) => sections(coverage).map((section) => section.heading);
const chips = (coverage: Coverage, heading: string) =>
  sections(coverage)
    .find((section) => section.heading === heading)
    ?.tags.map((one) => `${one.value} ${one.files}`);

test("the set's own come first, then each folder's under its own heading in path order", () => {
  expect(headings(SEARCH)).toEqual([
    "Their Own",
    "From Pictures",
    "From Trips",
    "From Cairo",
    "From Lisbon",
  ]);
  expect(chips(SEARCH, "From Cairo")).toEqual(["cairo 3", "egypt 3"]);
  expect(sections(SEARCH)[0]?.own).toBe(true);
  expect(sections(SEARCH).filter((section) => section.own)).toHaveLength(1);
});

test("one checked file's own read Its Own, and nothing of their own leaves no heading over nothing", () => {
  const one: Coverage = { files: 1, own: [tag("felucca", 1)], folders: SEARCH.folders.slice(0, 1) };
  expect(headings(one)).toEqual(["Its Own", "From Pictures"]);
  expect(headings({ ...SEARCH, own: [] })[0]).toBe("From Pictures");
});

test("past four folders, those above every file keep their heading and the rest gather, each chip once", () => {
  const wide: Coverage = {
    files: 5_000,
    own: [],
    folders: [
      folder(1, "Pictures", 5_000, [name("pictures", 5_000)]),
      folder(4, "Trips", 5_000, [name("trips", 5_000)]),
      folder(6, "Cairo", 214, [name("cairo", 214), tag("egypt", 214)]),
      folder(7, "Lisbon", 214, [name("lisbon", 214)]),
      folder(8, "Luxor", 716, [name("luxor", 716), tag("egypt", 716)]),
      folder(9, "Porto", 1_106, [name("porto", 1_106)]),
    ],
  };
  expect(headings(wide)).toEqual(["From Pictures", "From Trips", "From 4 Folders"]);
  const gathered = sections(wide).at(-1);
  expect(gathered?.gathered).toBe(true);
  expect(gathered?.tags.map((one) => `${one.value} ${one.files}`)).toEqual([
    "cairo 214",
    "egypt 930",
    "lisbon 214",
    "luxor 716",
    "porto 1106",
  ]);
  const egypt = gathered?.tags.find((one) => one.value === "egypt");
  expect(egypt && whoseTag(egypt)).toBe("From Cairo and Luxor");
  const luxor = gathered?.tags.find((one) => one.value === "luxor");
  expect(luxor && whoseTag(luxor)).toBe("The name of Luxor");
});

test("a count reads only when some of the set lack the tag", () => {
  expect(countOf(3_120, 5_000)).toBe("3,120 of 5,000");
  expect(countOf(5, 5)).toBeUndefined();
  expect(listed(["Cairo", "Lisbon", "Luxor"])).toBe("Cairo, Lisbon and Luxor");
});

test("a tag every file carries is refused and says whose it is; one only some carry never is", () => {
  expect(refusal(SEARCH, "egypt")).toEqual({
    line: "All 4 already have egypt.",
    tagId: ids.get(":egypt"),
  });
  expect(refusal(SEARCH, "travel")?.line).toBe("All 4 already have travel, from Trips.");
  expect(refusal(SEARCH, "trips")?.line).toBe("All 4 already have trips, the name of Trips.");
  expect(refusal(SEARCH, "sphinx")).toBeNull();
  expect(refusal(SEARCH, "portugal")).toBeNull();
  expect(refusal(SEARCH, "egypt 2024")).toBeNull();
  const one: Coverage = { files: 1, own: [tag("felucca", 1)], folders: [] };
  expect(refusal(one, "felucca")?.line).toBe("It already has felucca.");
});
