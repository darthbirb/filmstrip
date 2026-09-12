import { useEffect, useState } from "react";

import { Tree, type TreeRow } from "../../ui/Tree";
import { type Place, setPlace, usePlace } from "../place";
import { ensureChildren, useIndex } from "./index-store";
import {
  folderRowId,
  libraries,
  NoSources,
  SORTING_ID,
  selectedRowId,
  sortingRow,
  sourcePlace,
  sourceRow,
  TRASH_ID,
  trashRow,
} from "./shared";

const BACK_ID = "back";

/** One level at a time: the places, or the folders inside one folder with a row back up. */
export function DrillNav() {
  const { sources, children } = useIndex();
  const place = usePlace();
  // Showing the places above a chosen folder lasts only as long as that choice.
  const [placesAbove, setPlacesAbove] = useState<Place | null>(null);
  const listing = place?.kind === "folder" && placesAbove !== place ? place.path : null;
  const listed = listing?.at(-1)?.id;

  useEffect(() => {
    if (listed !== undefined) ensureChildren([listed]);
  }, [listed]);

  if (!sources) return null;
  if (sources.length === 0) return <NoSources />;

  const places = new Map<string, Place>([
    [SORTING_ID, { kind: "sorting" }],
    [TRASH_ID, { kind: "trash" }],
  ]);
  const rows: TreeRow[] = [];
  let heading: string | undefined;
  let selectedId: string | null = null;

  if (listing && place?.kind === "folder") {
    heading = listing.at(-1)?.title;
    rows.push({
      id: BACK_ID,
      label: listing.length > 1 ? (listing.at(-2)?.title ?? "") : "All places",
      level: 1,
      expandable: false,
      glyph: "back",
    });
    for (const node of children.get(listing.at(-1)?.id ?? -1) ?? []) {
      const id = folderRowId(node.id);
      rows.push({
        id,
        label: node.title,
        level: 1,
        expandable: node.childCount > 0,
        glyph: "folder",
      });
      places.set(id, { ...place, path: [...listing, { id: node.id, title: node.title }] });
    }
  } else {
    rows.push(sortingRow(sources));
    libraries(sources).forEach((source, index) => {
      const row = sourceRow(source, {
        expandable: (children.get(source.rootFolderId)?.length ?? 0) > 0,
        separated: index === 0,
      });
      rows.push(row);
      places.set(row.id, sourcePlace(source));
    });
    rows.push(trashRow(true));
    selectedId =
      place?.kind === "folder" ? folderRowId(place.path[0]?.id ?? -1) : selectedRowId(place);
  }

  const goUp = () => {
    if (place?.kind !== "folder" || !listing) return;
    if (listing.length > 1) setPlace({ ...place, path: listing.slice(0, -1) });
    else setPlacesAbove(place);
  };
  const go = (id: string) => {
    if (id === BACK_ID) return goUp();
    const target = places.get(id);
    if (!target) return;
    setPlace(target);
  };

  return (
    <div className="flex flex-col">
      {heading && <h2 className="truncate px-3 pt-3 pb-1 text-caption text-fg-muted">{heading}</h2>}
      <Tree
        label={heading ? `Folders in ${heading}` : "Places"}
        rows={rows}
        selectedId={selectedId}
        onSelect={go}
        onExpand={go}
        onCollapse={() => undefined}
        onLeave={goUp}
      />
      {listing && rows.length === 1 && (
        <p className="px-3 py-1 text-fg-muted text-ui">No folders inside.</p>
      )}
    </div>
  );
}
