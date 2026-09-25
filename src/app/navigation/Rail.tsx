import { RailButton } from "../../ui/RailButton";
import { type Place, setPlace, usePlace } from "../place";
import { useIndex } from "./index-store";
import { selectedRowId, sortingRow, trashRow } from "./shared";

/** Folded, navigation keeps the app's own two places. Folders do not come: a slice of a tree is a worse tree. */
export function Rail() {
  const { sources, trash } = useIndex();
  const place = usePlace();
  const at = selectedRowId(place);
  const places: [ReturnType<typeof trashRow>, Place][] = [
    [sortingRow(sources ?? []), { kind: "sorting" }],
    [trashRow(trash), { kind: "trash" }],
  ];

  return (
    <>
      {places.map(([row, target]) => (
        <RailButton
          key={row.id}
          glyph={row.glyph ?? "folder"}
          label={row.label}
          count={row.count}
          filled
          selected={row.id === at}
          onClick={() => setPlace(target)}
        />
      ))}
    </>
  );
}
