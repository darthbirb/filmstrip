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
    <div className="flex flex-col gap-3 p-2 text-caption">
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

export function ToolbarStandIn() {
  return (
    <>
      <Slot label="location" grow />
      <Slot label="search" />
    </>
  );
}

function Slot({ label, grow = false }: { label: string; grow?: boolean }) {
  return (
    <span
      className={`flex h-7 items-center border border-line border-dashed px-2 text-caption text-fg-muted ${grow ? "min-w-0 flex-1" : "w-48 min-w-0 shrink"}`}
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
