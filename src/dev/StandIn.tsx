// Neutral tiles where content will go, so a layout can be judged against something. Dev only.
const TILES = Array.from({ length: 96 }, (_, n) => ({
  id: `tile-${n}`,
  tone: `oklch(${0.28 + ((n * 37) % 19) / 100} 0 0)`,
}));

export function StandIn() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-1 p-1">
      {TILES.map((tile) => (
        <div key={tile.id} className="aspect-[4/3]" style={{ background: tile.tone }} />
      ))}
    </div>
  );
}
