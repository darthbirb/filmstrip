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
