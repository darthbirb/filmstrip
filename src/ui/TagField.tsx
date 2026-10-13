import {
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { formatCount } from "../lib/format";
import { fold } from "../lib/queryTerm";
import { ChipButton } from "./ChipButton";
import { anchorOf, OfferList, type OfferRow, useOffers } from "./OfferList";
import { RefusalLine } from "./RefusalLine";

export type Offer = { value: string; files: number };

/** Why a value cannot be added, and the tag it repeats. */
export type Refusal = { line: string; tagId: number | null };

type Props = {
  /** What it adds a tag to, for its field's name. */
  of: string;
  /** The tags the library has that begin with what is typed. */
  offers: (typed: string) => Promise<Offer[]>;
  /** Why a folded value cannot be added here, or `null` when it can. */
  refuse: (value: string) => Refusal | null;
  onAdd: (value: string) => Promise<void>;
  /** The tag a refused value repeats, or `null`, for the row to outline it. */
  onEcho: (tagId: number | null) => void;
  /** Backspace in an empty field: the keyboard goes to the last tag that can be removed. */
  onBackOut: () => void;
};

/**
 * Add Tag…, and the chip-shaped field it becomes, with the library's tags offered under it. It
 * stays open for the next tag until Escape, a click away, or Enter on nothing. DESIGN.md "Components".
 */
export function TagField(props: Props) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <ChipButton look="outline" round onClick={() => setOpen(true)}>
        Add Tag…
      </ChipButton>
    );
  }
  return (
    <Field
      {...props}
      onClose={() => {
        props.onEcho(null);
        setOpen(false);
      }}
    />
  );
}

/**
 * The field alone, open from the start and the width of what holds it, for a surface that is
 * about tagging: leaving the field leaves it open, and only Escape or Enter on nothing closes.
 */
export function StandingTagField(props: Props & { onClose: () => void }) {
  return <Field {...props} standing />;
}

function Field({
  of,
  offers,
  refuse,
  onAdd,
  onEcho,
  onBackOut,
  onClose,
  standing = false,
}: Props & { onClose: () => void; standing?: boolean }) {
  const id = useId();
  const anchor = anchorOf(id, "tag-field");
  const field = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState("");
  const [lit, setLit] = useState(0);
  const value = fold(typed);
  const found = useOffers(value, offers);
  const refused = value ? refuse(value) : null;
  // What the library has, less what this one already carries, then exactly what was typed.
  const rows: OfferRow[] = refused
    ? []
    : [
        ...found
          .filter((offer) => !refuse(offer.value))
          .map((offer) => ({
            value: offer.value,
            said: offer.value,
            count: `on ${formatCount(offer.files)} ${offer.files === 1 ? "file" : "files"}`,
          })),
        ...(value && !found.some((offer) => offer.value === value)
          ? [{ value, said: `New tag “${value}”` }]
          : []),
      ];
  const at = Math.min(lit, rows.length - 1);

  useLayoutEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    onEcho(refused?.tagId ?? null);
  }, [refused?.tagId, onEcho]);

  const add = (next: string) => {
    setTyped("");
    setLit(0);
    void onAdd(next).finally(() => field.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!value) onClose();
      else if (!refused && rows[at]) add(rows[at].value);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setLit((was) => (Math.min(was, rows.length - 1) + step + rows.length) % rows.length);
    } else if (event.key === "Backspace" && typed === "") {
      event.preventDefault();
      if (!standing) onClose();
      onBackOut();
    }
  };

  return (
    <>
      <input
        ref={field}
        role="combobox"
        aria-label={`Add Tag to ${of}`}
        aria-expanded={rows.length > 0}
        aria-controls={`${id}-offers`}
        aria-activedescendant={rows.length > 0 ? `${id}-${at}` : undefined}
        aria-invalid={refused !== null}
        value={typed}
        placeholder="tag"
        onChange={(event) => {
          setTyped(event.target.value);
          setLit(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={standing ? undefined : onClose}
        style={{ anchorName: anchor } as CSSProperties}
        className={`h-chip max-w-full rounded-full bg-ground px-2.5 text-fg-hi text-small inset-ring placeholder:text-fg-faint ${standing ? "w-full outline-none" : "focus-ring field-sizing-content min-w-24"} ${refused ? "inset-ring-line-danger" : "inset-ring-line-control"}`}
      />
      {refused && <RefusalLine>{refused.line}</RefusalLine>}
      <OfferList
        id={id}
        anchor={anchor}
        label={`Tags to add to ${of}`}
        rows={rows}
        lit={at}
        onPick={add}
      />
    </>
  );
}
