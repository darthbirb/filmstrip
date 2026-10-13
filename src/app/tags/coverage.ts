import type { Coverage } from "../../ipc/bindings/Coverage";
import type { Covered } from "../../ipc/bindings/Covered";
import { formatCount } from "../../lib/format";
import type { Refusal } from "../../ui/TagField";

// How the set's Tag… sheet groups what a set carries, and what its field refuses.
// Artboards › Tagging a set.

/** A chip in the sheet: the tag, how many carry it, and the folders it comes from, if any. */
export type SetTag = Covered & { from: string[] };

export type Section = {
  heading: string;
  tags: SetTag[];
  /** The set's own, which can be added to the rest and taken off. */
  own: boolean;
  /** Several folders' gathered under one heading, so each chip says whose it is itself. */
  gathered: boolean;
};

/** Past this many folders, those not above every checked file gather under one heading. */
const HEADED = 4;

/** Their own first, then each folder's in path order, gathering the folders past four. */
export function sections(coverage: Coverage): Section[] {
  const out: Section[] = [];
  if (coverage.own.length > 0) {
    out.push({
      heading: coverage.files === 1 ? "Its Own" : "Their Own",
      tags: coverage.own.map((tag) => ({ ...tag, from: [] })),
      own: true,
      gathered: false,
    });
  }
  const headed = (folder: Coverage["folders"][number]): Section => ({
    heading: `From ${folder.folder.title}`,
    tags: folder.tags.map((tag) => ({ ...tag, from: [folder.folder.title] })),
    own: false,
    gathered: false,
  });
  const { folders } = coverage;
  const rest = folders.filter((folder) => folder.under < coverage.files);
  if (folders.length <= HEADED || rest.length < 2) {
    out.push(...folders.map(headed));
    return out;
  }
  out.push(...folders.filter((folder) => folder.under >= coverage.files).map(headed));
  const merged = new Map<number, SetTag>();
  for (const folder of rest) {
    for (const tag of folder.tags) {
      const held = merged.get(tag.tagId);
      if (held) {
        held.files += tag.files;
        held.from.push(folder.folder.title);
      } else merged.set(tag.tagId, { ...tag, from: [folder.folder.title] });
    }
  }
  out.push({
    heading: `From ${formatCount(rest.length)} Folders`,
    tags: [...merged.values()],
    own: false,
    gathered: true,
  });
  return out;
}

/** "3 of 5" for a tag only some of the set carry; nothing for one they all do. */
export function countOf(files: number, of: number) {
  return files < of ? `${formatCount(files)} of ${formatCount(of)}` : undefined;
}

/** "Cairo", "Cairo and Luxor", "Cairo, Lisbon and Luxor". */
export function listed(names: readonly string[]) {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** Whose a chip is, for its tooltip. */
export function whoseTag(tag: SetTag) {
  return tag.name ? `The name of ${listed(tag.from)}` : `From ${listed(tag.from)}`;
}

/** A tag every checked file already carries, its own or from above; one only some do is added to the rest. */
export function refusal(coverage: Coverage, value: string): Refusal | null {
  const own = coverage.own.filter((tag) => tag.key === null && tag.value === value);
  const given = coverage.folders.flatMap((folder) =>
    folder.tags
      .filter((tag) => tag.key === null && tag.value === value)
      .map((tag) => ({ tag, folder: folder.folder.title })),
  );
  const carrying = [...own, ...given.map((one) => one.tag)].reduce(
    (sum, tag) => sum + tag.files,
    0,
  );
  const [first] = [...own, ...given.map((one) => one.tag)];
  if (!first || coverage.files === 0 || carrying < coverage.files) return null;
  const all =
    coverage.files === 1
      ? `It already has ${value}`
      : `All ${formatCount(coverage.files)} already have ${value}`;
  const [only] = given;
  const whose =
    own.length === 0 && given.length === 1 && only
      ? `, ${only.tag.name ? "the name of" : "from"} ${only.folder}`
      : "";
  return { line: `${all}${whose}.`, tagId: first.tagId };
}
