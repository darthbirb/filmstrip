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
import { ChipButton } from "./ChipButton";
import { SURFACE } from "./Menu";

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

const fold = (text: string) => text.trim().toLowerCase();

/**
 * Add Tag…, and the chip-shaped field it becomes, with the library's tags offered under it. It
 * stays open for the next tag until Escape, a click away, or Enter on nothing. DESIGN.md "Components".
 */
export function TagField({ of, offers, refuse, onAdd, onEcho, onBackOut }: Props) {
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
      of={of}
      offers={offers}
      refuse={refuse}
      onAdd={onAdd}
      onEcho={onEcho}
      onBackOut={onBackOut}
      onClose={() => {
        onEcho(null);
        setOpen(false);
      }}
    />
  );
}

type Row = { value: string; files: number | null };

function Field({
  of,
  offers,
  refuse,
  onAdd,
  onEcho,
  onBackOut,
  onClose,
}: Props & { onClose: () => void }) {
  const id = useId();
  const anchor = `--tag-field-${id.replace(/[^\w-]/g, "")}`;
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<Offer[]>([]);
  const [lit, setLit] = useState(0);

  const value = fold(typed);
  const refused = value ? refuse(value) : null;
  // What the library has, less what this one already carries, then exactly what was typed.
  const rows: Row[] = refused
    ? []
    : [
        ...found.filter((offer) => !refuse(offer.value)),
        ...(value && !found.some((offer) => offer.value === value) ? [{ value, files: null }] : []),
      ];

  useLayoutEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    onEcho(refused?.tagId ?? null);
  }, [refused?.tagId, onEcho]);

  useEffect(() => {
    if (!value) {
      setFound([]);
      return;
    }
    let live = true;
    offers(value)
      .then((next) => live && setFound(next))
      .catch(() => live && setFound([]));
    return () => {
      live = false;
    };
  }, [value, offers]);

  // The list sits in the top layer, so the band's own scrolling never cuts it off.
  const showing = rows.length > 0;
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    if (showing && !element.matches(":popover-open")) element.showPopover();
    if (!showing && element.matches(":popover-open")) element.hidePopover();
  }, [showing]);

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
      else if (!refused) {
        const row = rows[Math.min(lit, rows.length - 1)];
        if (row) add(row.value);
      }
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setLit((at) => (at + step + rows.length) % rows.length);
    } else if (event.key === "Backspace" && typed === "") {
      event.preventDefault();
      onClose();
      onBackOut();
    }
  };

  return (
    <>
      <input
        ref={field}
        role="combobox"
        aria-label={`Add Tag to ${of}`}
        aria-expanded={showing}
        aria-controls={`${id}-offers`}
        aria-activedescendant={showing ? `${id}-${Math.min(lit, rows.length - 1)}` : undefined}
        aria-invalid={refused !== null}
        value={typed}
        placeholder="tag"
        onChange={(event) => {
          setTyped(event.target.value);
          setLit(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={onClose}
        style={{ anchorName: anchor } as CSSProperties}
        className={`focus-ring field-sizing-content h-chip min-w-24 max-w-full rounded-full bg-ground px-2.5 text-fg-hi text-small inset-ring placeholder:text-fg-faint ${refused ? "inset-ring-line-danger" : "inset-ring-line-control"}`}
      />
      {refused && (
        <span className="w-full text-danger text-key leading-normal">{refused.line}</span>
      )}
      <div
        ref={list}
        id={`${id}-offers`}
        popover="manual"
        role="listbox"
        aria-label={`Tags to add to ${of}`}
        style={
          {
            positionAnchor: anchor,
            top: "anchor(bottom)",
            left: "anchor(left)",
            positionTryFallbacks: "flip-block",
          } as CSSProperties
        }
        className={`${SURFACE} mt-1.5 w-52`}
      >
        {rows.map((row, at) => (
          <div
            key={row.value}
            id={`${id}-${at}`}
            role="option"
            aria-selected={at === Math.min(lit, rows.length - 1)}
            tabIndex={-1}
            // The field keeps the keyboard while a row is picked with the pointer.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => add(row.value)}
            onKeyDown={() => undefined}
            className="flex h-control shrink-0 items-center gap-2 rounded-nested px-2 text-fg text-ui hover:bg-raised-hi aria-selected:bg-raised-hi"
          >
            <span className="flex-1 truncate">
              {row.files === null ? `New tag “${row.value}”` : row.value}
            </span>
            {row.files !== null && (
              <span className="whitespace-nowrap text-fg-dim text-key">
                on {formatCount(row.files)} {row.files === 1 ? "file" : "files"}
              </span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
