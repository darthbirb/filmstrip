import type { Forgets } from "../../ipc/bindings/Forgets";
import { formatCount } from "../../lib/format";

// How files leaving the Trash for the Recycle Bin are worded, as a source is removed or a restore
// forgets one. Artboards › Sources; Artboards › Backing up the index.

const files = (n: number) => `${formatCount(n)} ${n === 1 ? "file" : "files"}`;
const whose = (name: string) => (name.endsWith("s") ? `${name}’` : `${name}’s`);
const stay = (n: number) => (n === 1 ? "it stays" : "they stay");

/** "2 files in the Trash" and its verb, for a question to name; nothing with none. */
export function trashGoes(count: number) {
  if (count <= 0) return null;
  return { files: `${files(count)} in the Trash`, verb: count === 1 ? "goes" : "go" };
}

/** The band of a remove the Recycle Bin refused part of. */
export function notRemoved(title: string, refused: number) {
  return `${title} was not removed. The Recycle Bin could not take ${formatCount(refused)} of its files, so ${stay(refused)} in the Trash.`;
}

/** Names in a list: "Archive", "Archive and Phone", "Archive, Phone and Scans". */
export function listed(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The files a restore forgets, as its bands name them: "Archive’s 3 files in the Trash". */
const forgotten = ({ sources, files: count }: Forgets) =>
  `${whose(listed(sources))} ${files(count)} in the Trash`;

/** The band of a restore the Recycle Bin refused part of. */
export function notRestored(forgets: Forgets, refused: number) {
  const some = refused < forgets.files ? `${formatCount(refused)} of ` : "";
  return `The index was not restored. The Recycle Bin could not take ${some}${forgotten(forgets)}, so ${stay(refused)} there.`;
}

/** What had gone when a restore failed after sending the files it forgets. */
export function wentBefore(forgets: Forgets) {
  return `${forgotten(forgets)} went to the Recycle Bin; the index is otherwise as it was.`;
}
