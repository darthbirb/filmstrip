import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { fold } from "../lib/queryTerm";
import { anchorOf, OfferList, type OfferRow } from "./OfferList";
import { RefusalLine } from "./RefusalLine";

type Props = {
  label: string;
  /** What a rename starts from, selected; a merge starts empty. */
  value?: string;
  /** A tag is a pill; a label's key a nested chip; a value sits after its sunk key. */
  shape: "tag" | "key" | { key: string };
  /**
   * What the library has for what is typed, best first and the row's own left out; a merge picks
   * one. The field shows the first seven it does not refuse.
   */
  offers?: (typed: string) => OfferRow[];
  /** Why a folded value cannot be taken, said under the field, or `null` when it can. */
  refuse?: (value: string) => string | null;
  /** Whether `refuse` can answer yet; Enter or a pick before then waits for it. */
  ready?: boolean;
  /** What a merge field says for Enter on a word nothing it offers begins with. */
  nothing?: (value: string) => string;
  /** Each folded value as it is typed, for a refusal the caller has to ask about. */
  onType?: (value: string) => void;
  /** What the row says after the chip, kept on the field's line above a refusal. */
  trail?: ReactNode;
  /** The folded value, and the text as it was typed. */
  onCommit: (value: string, typed: string) => void;
  onCancel: () => void;
};

type Shape = Props["shape"];

const OFFERS = 7;

const TEXT =
  "field-sizing-content h-full min-w-24 max-w-full px-2.5 text-fg-hi outline-none selection:bg-plate selection:text-on-plate";

const corner = (shape: Shape) =>
  shape === "tag" ? "rounded-full" : shape === "key" ? "rounded-nested" : "";

/** The field's line in its shape: a value's field sits after its sunk key. */
function Shaped({ shape, children }: { shape: Shape; children: ReactNode }) {
  return typeof shape === "object" ? (
    <span className="inline-flex h-chip max-w-full overflow-hidden rounded-nested text-small">
      <span className="flex items-center bg-well px-2 text-fg-dim">{shape.key}</span>
      {children}
    </span>
  ) : (
    <span className="inline-flex h-chip max-w-full text-small">{children}</span>
  );
}

/** What was typed in a term field, held in the field's shape while its row asks about it. */
export function TypedTerm({ text, shape }: { text: string; shape: Shape }) {
  return (
    <Shaped shape={shape}>
      <span
        className={`flex h-full min-w-24 max-w-full items-center bg-ground px-2.5 text-fg-hi inset-ring inset-ring-line-control ${corner(shape)}`}
      >
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{text}</span>
      </span>
    </Shaped>
  );
}

/**
 * A term's chip as the field that renames it, or picks what it merges into: Enter takes what is
 * typed or the lit offer, Escape and a click away abandon it. DESIGN.md "Components".
 */
export function TermField({
  label,
  value = "",
  shape,
  offers,
  refuse,
  ready = true,
  nothing,
  onType,
  trail,
  onCommit,
  onCancel,
}: Props) {
  const id = useId();
  const anchor = anchorOf(id, "term-field");
  const field = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState(value);
  const [lit, setLit] = useState(0);
  const [missed, setMissed] = useState(false);
  const [waiting, setWaiting] = useState<string | null>(null);
  const settled = useRef(false);
  const folded = fold(typed);
  const refused = folded && refuse ? refuse(folded) : null;
  const all = offers && !refused ? offers(folded) : [];
  const rows = (refuse ? all.filter((row) => !refuse(row.value)) : all).slice(0, OFFERS);
  const at = Math.min(lit, rows.length - 1);
  const said = refused ?? (missed && folded && nothing ? nothing(folded) : null);

  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const settle = (then: () => void) => {
    if (settled.current) return;
    settled.current = true;
    then();
  };
  const cancel = () => settle(onCancel);
  const pick = (picked: string) => {
    if (!ready) setWaiting(picked);
    else if (refuse?.(picked)) {
      setTyped(picked);
      setLit(0);
      onType?.(picked);
    } else settle(() => onCommit(picked, typed));
  };
  const picked = useEffectEvent(pick);
  useEffect(() => {
    if (!ready || waiting === null) return;
    setWaiting(null);
    picked(waiting);
  }, [ready, waiting]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (refused) return;
      const chosen = offers ? (rows[at] ?? all[0])?.value : folded;
      if (chosen) pick(chosen);
      else if (!folded) cancel();
      else setMissed(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (rows.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setLit((was) => (Math.min(was, rows.length - 1) + step + rows.length) % rows.length);
    }
  };

  const ring = said ? "inset-ring-line-danger" : "inset-ring-line-control";
  const input = (
    <input
      ref={field}
      {...(offers && {
        role: "combobox",
        "aria-expanded": rows.length > 0,
        "aria-controls": `${id}-offers`,
        "aria-activedescendant": rows.length > 0 ? `${id}-${at}` : undefined,
      })}
      aria-label={label}
      aria-invalid={said !== null}
      value={typed}
      onChange={(event) => {
        setTyped(event.target.value);
        setLit(0);
        setMissed(false);
        setWaiting(null);
        onType?.(fold(event.target.value));
      }}
      onKeyDown={onKeyDown}
      onBlur={cancel}
      style={{ anchorName: anchor } as CSSProperties}
      className={`${TEXT} bg-ground inset-ring ${ring} ${corner(shape)}`}
    />
  );

  return (
    <>
      <Shaped shape={shape}>{input}</Shaped>
      {trail}
      {said && <RefusalLine>{said}</RefusalLine>}
      {offers && (
        <OfferList
          id={id}
          anchor={anchor}
          label={`${label}: what the library has`}
          rows={rows}
          lit={at}
          onPick={pick}
        />
      )}
    </>
  );
}
