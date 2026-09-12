// Neutral tiles where content will go, so a bar can be judged against something. Dev only.
const TILES = Array.from({ length: 96 }, (_, n) => ({
  id: `tile-${n}`,
  tone: `oklch(${0.28 + ((n * 37) % 19) / 100} 0 0)`,
}));

export function StandIn({ label }: { label?: string }) {
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1 p-1">
        {TILES.map((tile) => (
          <div key={tile.id} className="aspect-[4/3]" style={{ background: tile.tone }} />
        ))}
      </div>
      {label && (
        <span className="absolute bottom-2 left-2 bg-ground px-2 py-1 text-xs">{label}</span>
      )}
    </div>
  );
}
