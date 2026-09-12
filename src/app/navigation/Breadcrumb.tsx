import { GLYPHS } from "../../ui/glyphs";
import { setPlace, usePlace } from "../place";

const TITLES = { sorting: "Sorting Box", trash: "Trash" } as const;

/** Where the user is. Every step above the last goes back to that folder. */
export function Breadcrumb() {
  const place = usePlace();
  if (!place) return null;

  const steps =
    place.kind === "folder"
      ? place.path.map((crumb) => ({ key: `folder-${crumb.id}`, title: crumb.title }))
      : [{ key: place.kind, title: TITLES[place.kind] }];

  return (
    <nav aria-label="Location" className="flex min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-1 text-ui">
        {steps.map((step, index) => (
          <li key={step.key} className="flex min-w-0 items-center gap-1">
            {index > 0 && (
              <span aria-hidden="true" className="font-glyph text-fg-muted text-glyph">
                {GLYPHS.chevronRight}
              </span>
            )}
            {index === steps.length - 1 ? (
              <span aria-current="location" className="truncate px-1">
                {step.title}
              </span>
            ) : (
              <button
                type="button"
                className="focus-ring flex h-row min-w-0 items-center px-1 text-fg-muted transition-colors duration-(--motion-quick) hover:bg-hover hover:text-fg motion-reduce:transition-none"
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
