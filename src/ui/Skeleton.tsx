/** A stand-in for a tile still being read: the trough colour at the tile's corner, never a spinner. */
export function SkeletonTile({ grow }: { grow: number }) {
  return (
    <span className="block min-w-0 basis-0 rounded-control bg-inset" style={{ flexGrow: grow }} />
  );
}
