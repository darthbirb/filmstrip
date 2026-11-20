import { formatCount } from "../../lib/format";

// How a source's files left in the Recycle Bin are worded, as it is removed or a restore forgets
// it. Artboards › Sources; Artboards › Backups.

const files = (n: number) => `${formatCount(n)} ${n === 1 ? "file" : "files"}`;

/** "2 files in the Recycle Bin" and its verb, for a question to name; nothing with none. */
export function binStays(count: number) {
  if (count <= 0) return null;
  return { files: `${files(count)} in the Recycle Bin`, verb: count === 1 ? "stays" : "stay" };
}

/** Names in a list: "Archive", "Archive and Phone", "Archive, Phone and Scans". */
export function listed(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
