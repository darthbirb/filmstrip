import type { QueryTerm } from "../../ipc/bindings/QueryTerm";
import { formatCount } from "../../lib/format";
import { Button } from "../../ui/Button";
import { GlyphButton } from "../../ui/GlyphButton";
import { TermChip } from "../../ui/TermChip";
import { type Place, setPlace } from "../place";
import { useSearchOutcome } from "./results";
import { goBack, placeName, withoutScope } from "./search";

/**
 * The results' header: the way back, the query that made them in the field's shapes, read-only,
 * how much it found, and Search Everywhere while the query holds a scope. Artboards › A search is a place.
 */
export function SearchHeader({ place }: { place: Place & { kind: "search" } }) {
  const outcome = useSearchOutcome(place.query);
  const found = outcome?.kind === "found" ? outcome : undefined;
  const wider = found && withoutScope(found.terms);
  const back = place.back ? `Back to ${placeName(place.back)}` : "Back";
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 pl-3">
      <GlyphButton glyph="back" label={`${back} · Escape`} onClick={goBack} />
      {/* The place's name, as a folder's title is the grid's. */}
      <h2 className="m-0 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden font-normal">
        {found ? <Terms terms={found.terms} /> : <span className="truncate">{place.query}</span>}
        {found && (
          <span className="ml-1 shrink-0 whitespace-nowrap text-fg-dim text-small tabular-nums">
            {counted(found.folders.length, found.items.length)}
          </span>
        )}
      </h2>
      {wider !== undefined && (
        <Button
          onClick={() =>
            setPlace(wider ? { kind: "search", query: wider, back: place.back } : place.back)
          }
        >
          Search Everywhere
        </Button>
      )}
    </div>
  );
}

/** Words as the words typed, every other term as its chip. */
export function Terms({ terms }: { terms: readonly QueryTerm[] }) {
  return terms.map(({ text, shape, start }) =>
    shape.kind === "text" ? (
      <span key={start} className="shrink-0 whitespace-nowrap text-fg text-ui">
        {text}
      </span>
    ) : (
      <TermChip key={start} shape={shape} text={text} />
    ),
  );
}

/** "2 folders · 38 files", and "no files" in words, so the line keeps its shape. */
export function counted(folders: number, files: number) {
  const noun = (n: number, one: string) => `${formatCount(n)} ${one}${n === 1 ? "" : "s"}`;
  const filesPart = files === 0 && folders > 0 ? "no files" : noun(files, "file");
  return folders > 0 ? `${noun(folders, "folder")} · ${filesPart}` : filesPart;
}
