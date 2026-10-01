import type { QueryTerm } from "../../ipc/bindings/QueryTerm";
import { readQuery } from "../../ipc/commands";
import { pathTerm } from "../../lib/queryTerm";
import { backFrom, getPlace, type Place, setPlace } from "../place";

/** What a place is called where a sentence names it. */
export function placeName(place: Place): string {
  switch (place.kind) {
    case "folder":
      return place.path.at(-1)?.title ?? "";
    case "sorting":
      return "Sorting Box";
    case "trash":
      return "Trash";
    case "search":
      return place.query;
  }
}

/** Where a search stands, written as the term that scopes it. DECISIONS.md "Search". */
export function scopeOf(place: Place | null): string | null {
  switch (place?.kind) {
    case "folder":
      return pathTerm(place.path.map((crumb) => crumb.title));
    case "sorting":
      return "is:sorting";
    case "trash":
      return "is:trashed";
    default:
      return null;
  }
}

const scoping = (term: QueryTerm) => term.shape.kind === "path" || term.shape.kind === "place";

/** The query without its scope, or nothing when it had none to remove. */
export function withoutScope(terms: readonly QueryTerm[]): string | undefined {
  if (!terms.some(scoping)) return undefined;
  return terms
    .filter((term) => !scoping(term))
    .map((term) => term.text)
    .join(" ");
}

/** Stands the window in a query's results, keeping the way back to where the search began. */
export function runQuery(query: string) {
  setPlace({ kind: "search", query, back: backFrom(getPlace()) });
}

/** A new search for one term: a new search starts everywhere, so nothing else is kept. */
export function searchFor(term: string) {
  runQuery(term);
}

/** Adds a term to the query standing in the results, scope and all, unless it holds it already. */
export async function addToSearch(term: string) {
  const place = getPlace();
  if (place?.kind !== "search") return runQuery(term);
  const { terms } = await readQuery(place.query);
  if (terms.some((held) => held.text === term)) return;
  runQuery(`${place.query} ${term}`);
}

/** Asks the standing query again inside one folder: it takes the scope's place, the rest stays. */
export async function scopeTo(titles: readonly string[]) {
  const place = getPlace();
  const { terms } = place?.kind === "search" ? await readQuery(place.query) : { terms: [] };
  runQuery(
    [pathTerm(titles), ...terms.filter((term) => !scoping(term)).map((t) => t.text)].join(" "),
  );
}

/** From results to where the search began. */
export function goBack() {
  const place = getPlace();
  if (place?.kind === "search") setPlace(place.back);
}
