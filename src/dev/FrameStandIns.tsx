// Stand-ins for what later slices put in the frame, so a layout can be judged against something. Dev only.
const PLACES = [
  { name: "Library", rows: ["70%", "55%", "80%", "45%", "65%", "50%", "75%", "60%"] },
  { name: "Sorting Box", rows: ["60%", "40%"] },
  { name: "Trash", rows: [] },
].map((place) => ({
  ...place,
  rows: place.rows.map((width, n) => ({ id: `${place.name}-${n}`, width })),
}));

const LINES = ["85%", "60%", "70%", "40%"].map((width, n) => ({ id: `line-${n}`, width }));

export function NavStandIn() {
  return (
    <div className="flex flex-col gap-3 p-2 text-ui">
      {PLACES.map((place) => (
        <section key={place.name} className="flex flex-col gap-2">
          <span className="px-2 text-fg-muted">{place.name}</span>
          {place.rows.map((row) => (
            <div key={row.id} className="mx-2 h-2 bg-hover" style={{ width: row.width }} />
          ))}
        </section>
      ))}
    </div>
  );
}

export function LocationStandIn() {
  return <Slot label="location" className="h-7 flex-1 text-ui" />;
}

export function SearchStandIn() {
  return <Slot label="search" className="h-full flex-1 justify-center text-caption" />;
}

function Slot({ label, className }: { label: string; className: string }) {
  return (
    <span
      className={`flex min-w-0 items-center border border-line border-dashed px-2 text-fg-muted ${className}`}
    >
      {label}
    </span>
  );
}

export function PaneStandIn() {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="aspect-[4/3] w-full bg-hover" />
      {LINES.map((line) => (
        <div key={line.id} className="h-2 bg-hover" style={{ width: line.width }} />
      ))}
    </div>
  );
}
