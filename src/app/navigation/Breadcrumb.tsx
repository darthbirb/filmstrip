import { formatBytes, formatCount } from "../../lib/format";
import { Glyph } from "../../ui/Glyph";
import { setPlace, usePlace } from "../place";
import { useIndex } from "./index-store";

const TITLES = { sorting: "Sorting Box", trash: "Trash" } as const;

/** Where the user is: every folder above as a quiet step back, the place itself as the grid's title. */
export function Breadcrumb() {
  const place = usePlace();
  const { trash } = useIndex();
  if (!place) return null;

  const steps =
    place.kind === "folder"
      ? place.path.map((crumb) => ({ key: `folder-${crumb.id}`, title: crumb.title }))
      : [{ key: place.kind, title: TITLES[place.kind] }];

  return (
    <nav aria-label="Location" className="flex min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1">
        {steps.map((step, index) => (
          <li key={step.key} className="flex min-w-0 items-center gap-1">
            {index > 0 && <Glyph name="chevronRight" className="text-fg-faint text-glyph" />}
            {index === steps.length - 1 ? (
              <span className="flex min-w-0 items-center gap-1.5">
                <span aria-current="location" className="truncate px-1 text-fg-hi text-title">
                  {step.title}
                </span>
                {/* What the Trash holds, and its size: the one place whose header counts itself. */}
                {place.kind === "trash" && trash && trash.count > 0 && (
                  <span className="shrink-0 whitespace-nowrap text-fg-dim text-small tabular-nums">
                    {formatCount(trash.count)} · {formatBytes(trash.bytes)}
                  </span>
                )}
              </span>
            ) : (
              <button
                type="button"
                className="focus-ring flex h-control min-w-0 items-center rounded-nested px-1.5 text-fg-mid text-row transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg motion-reduce:transition-none"
                onClick={() => {
                  if (place.kind === "folder")
                    setPlace({ ...place, path: place.path.slice(0, index + 1) });
                }}
              >
                <span className="truncate">{step.title}</span>
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
