import { formatCount } from "../lib/format";

type Figures = {
  /** Files directly in the place. */
  own: number;
  /** Files at or below it; the same as `own` for a place with nothing under it. */
  all?: number;
};

/** A count as text, always both figures: "3/9", "3/3", "0/0". DECISIONS.md "Navigation". */
export function countText({ own, all = own }: Figures) {
  return `${formatCount(own)}/${formatCount(all)}`;
}

/** A count as a screen reader says it: "3 of 9". */
export function countLabel({ own, all = own }: Figures) {
  return `${formatCount(own)} of ${formatCount(all)}`;
}

type Props = Figures & {
  /** On a selected row's plate, or on a row that cannot be picked. */
  tone?: "rest" | "plated" | "barred";
};

const TONES = {
  rest: {
    pill: "bg-raised text-fg-mid inset-ring inset-ring-line-control",
    slash: "text-fg-faint",
  },
  plated: { pill: "bg-on-plate-wash text-on-plate-dim", slash: "text-on-plate-faint" },
  barred: { pill: "bg-raised text-fg-faint inset-ring inset-ring-line-control", slash: "" },
};

/**
 * A place's own files, then everything at or below it, the slash in separator ink so the pair
 * reads as one count. DESIGN.md "Components".
 */
export function CountPill({ own, all = own, tone = "rest" }: Props) {
  const { pill, slash } = TONES[tone];
  return (
    <span
      className={`flex h-badge shrink-0 items-center rounded-badge px-1.5 text-small tabular-nums ${pill}`}
    >
      {/* Read as "3 of 9": a slash between figures is not a word. */}
      <span aria-hidden="true">
        {formatCount(own)}
        <span className={slash}>/</span>
        {formatCount(all)}
      </span>
      <span className="sr-only">{countLabel({ own, all })}</span>
    </span>
  );
}
