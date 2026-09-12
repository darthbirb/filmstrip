// Stand-ins for what later slices put in the frame, so a layout can be judged against something. Dev only.
const LINES = ["85%", "60%", "70%", "40%"].map((width, n) => ({ id: `line-${n}`, width }));

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
