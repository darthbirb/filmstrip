import { Button } from "../../ui/Button";
import { EmptyState } from "../../ui/EmptyState";
import { type Place, setPlace } from "../place";
import { useSearchOutcome } from "./results";
import { withoutScope } from "./search";

/**
 * A search that found nothing says where it looked and for what, and offers the wider search
 * while it was scoped. Components › "Each empty place says what it is".
 */
export function NothingMatched({ place }: { place: Place & { kind: "search" } }) {
  const outcome = useSearchOutcome(place.query);
  if (outcome?.kind !== "found") return null;
  const scope = outcome.terms.find(
    (term) => term.shape.kind === "path" || term.shape.kind === "place",
  )?.shape;
  const where =
    scope?.kind === "path"
      ? scope.titles.at(-1)
      : scope?.kind === "place"
        ? scope.place === "trash"
          ? "the Trash"
          : "the Sorting Box"
        : undefined;
  const asked = withoutScope(outcome.terms) ?? place.query;
  const note = asked ? (
    <>
      No file {where ? `in ${where}` : "anywhere"} matches <span className="text-fg">{asked}</span>.
    </>
  ) : undefined;
  return (
    <EmptyState glyph="search" title="Nothing Matched" note={note}>
      {scope && (
        <Button
          onClick={() =>
            setPlace(asked ? { kind: "search", query: asked, back: place.back } : place.back)
          }
        >
          Search Everywhere
        </Button>
      )}
    </EmptyState>
  );
}
