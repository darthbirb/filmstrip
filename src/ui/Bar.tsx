/** How far along work is. Pewter, because progress states a fact rather than raising an alarm. */
export function Bar({ percent }: { percent: number }) {
  return (
    <span className="block h-progress overflow-hidden rounded-full bg-raised">
      <span
        className="block h-full bg-plate transition-[width] duration-(--motion-size) ease-out motion-reduce:transition-none"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}
