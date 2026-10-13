import { formatCount } from "../lib/format";
import { Glyph } from "./Glyph";

export type TallyRow = {
  label: string;
  count: number;
  /** Quiet words after the count: its size, or how many of them are away. */
  trail?: string;
  /** The figure the rest add up to, in brighter ink. */
  sum?: boolean;
};

export type TallyNote = { key: string | number; text: string };

type Props = {
  heading: string;
  /** Rows in groups, a rule between two groups. */
  groups: readonly (readonly TallyRow[])[];
  /** A line under the figures for each thing they cannot vouch for, as a source that is away. */
  notes?: readonly TallyNote[];
};

const CELL = "whitespace-nowrap leading-(--spacing-chip)";

/**
 * Figures under a heading in the menu's shape: each row a count then its trail, in tabular figures
 * and right-aligned so the columns line up and add up. DESIGN.md "Components".
 */
export function Tallies({ heading, groups, notes = [] }: Props) {
  return (
    <>
      <p className="m-0 flex h-chip shrink-0 items-center px-2 text-eyebrow text-fg-dim uppercase">
        {heading}
      </p>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_max-content_max-content] gap-x-3 px-2 pb-1 text-ui">
        {groups.flatMap((group, index) =>
          group.map((row, at) => (
            <div
              key={row.label}
              className={`col-span-full grid grid-cols-subgrid ${index > 0 && at === 0 ? "mt-1 border-line border-t pt-1" : ""}`}
            >
              <dt className={`${CELL} text-fg-dim`}>{row.label}</dt>
              <dd
                className={`${CELL} m-0 text-right tabular-nums ${row.sum ? "text-fg" : "text-fg-mid"}`}
              >
                {formatCount(row.count)}
              </dd>
              <dd className={`${CELL} m-0 text-right text-fg-dim text-small tabular-nums`}>
                {row.trail}
              </dd>
            </div>
          )),
        )}
      </dl>
      {notes.map((note) => (
        <p
          key={note.key}
          className="m-0 flex items-start gap-1.5 px-2 pt-0.5 pb-1.5 text-pretty text-fg-dim text-small"
        >
          <Glyph name="unplugged" className="mt-px shrink-0 text-fg-faint text-glyph-small" />
          <span>{note.text}</span>
        </p>
      ))}
    </>
  );
}
