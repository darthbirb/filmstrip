// Stand-ins for what later slices put in the frame, so a layout can be judged against something. Dev only.
export function SearchStandIn() {
  return (
    <span className="flex h-full min-w-0 flex-1 items-center justify-center border border-line border-dashed px-2 text-caption text-fg-muted">
      search
    </span>
  );
}
