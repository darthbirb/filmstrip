import type { SourceSummary } from "../ipc/bindings/SourceSummary";

/** What every sorting source is called where the person meets it: they are one place. */
export const SORTING_BOX = "Sorting Box";

/** The quiet words after the Sorting Box's name: which of its sources, when it has several. */
export function sortingDetail(
  source: Pick<SourceSummary, "title">,
  sources: readonly Pick<SourceSummary, "kind">[],
) {
  return sources.filter((one) => one.kind === "sorting").length > 1 ? source.title : undefined;
}

/** The folders above a place, as a file's place is said: a sorting source's own folder is the Sorting Box. */
export function saidAbove(
  path: readonly { title: string }[],
  sourceId: number,
  sources: readonly Pick<SourceSummary, "id" | "kind">[],
) {
  const sorting = sources.some((one) => one.id === sourceId && one.kind === "sorting");
  return path.slice(0, -1).map((crumb, at) => (at === 0 && sorting ? SORTING_BOX : crumb.title));
}
