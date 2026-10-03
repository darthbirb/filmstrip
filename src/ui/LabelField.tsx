import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { formatCount } from "../lib/format";
import { ChipButton } from "./ChipButton";
import { anchorOf, OfferList, type OfferRow, useOffers } from "./OfferList";
import { fold, type Refusal } from "./TagField";

export type LabelOffer = { text: string; folders: number };

type Props = {
  /** What it labels, for its fields' names. */
  of: string;
  keyOffers: (typed: string) => Promise<LabelOffer[]>;
  valueOffers: (key: string, typed: string) => Promise<LabelOffer[]>;
  /** Why a folded key cannot be given here, or `null` when it can. */
  refuseKey: (key: string) => Refusal | null;
  onAdd: (key: string, value: string) => Promise<void>;
  /** The label a refused key repeats, or `null`, for the row to outline it. */
  onEcho: (tagId: number | null) => void;
};

// The two halves a label is drawn in, as fields: the key sunk, the value on the ground.
const HALVES =
  "m-0 inline-flex h-chip max-w-full overflow-hidden rounded-nested border-0 p-0 text-small inset-ring inset-ring-line-control has-focus-visible:outline has-focus-visible:outline-focus has-focus-visible:outline-offset-(--focus-gap)";
const HALF =
  "field-sizing-content h-full px-2 outline-none placeholder:text-fg-faint selection:bg-plate selection:text-on-plate";

const folders = (count: number) => `on ${formatCount(count)} ${count === 1 ? "folder" : "folders"}`;

/**
 * Add Label…, and the label it becomes: the key first, then its value, each with what the library
 * already has offered under it. Enter adds the label and closes. DESIGN.md "Components".
 */
export function LabelField(props: Props) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <ChipButton look="outline" onClick={() => setOpen(true)}>
        Add Label…
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

function Field({
  of,
  keyOffers,
  valueOffers,
  refuseKey,
  onAdd,
  onEcho,
  onClose,
}: Props & { onClose: () => void }) {
  const id = useId();
  const anchor = anchorOf(id, "label-field");
  const keyField = useRef<HTMLInputElement>(null);
  const valueField = useRef<HTMLInputElement>(null);
  const [half, setHalf] = useState<"key" | "value">("key");
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [lit, setLit] = useState(0);

  const typedKey = fold(key);
  const typedValue = fold(value);
  const refused = typedKey ? refuseKey(typedKey) : null;
  // Held steady between renders, or the offers would be asked for again on every one.
  const loadValues = useCallback(
    (typed: string) => valueOffers(typedKey, typed),
    [valueOffers, typedKey],
  );
  const keysFound = useOffers(half === "key" ? typedKey : "", keyOffers);
  const valuesFound = useOffers(half === "value" ? typedValue : "", loadValues);

  const offered = (found: LabelOffer[], typed: string, kind: "key" | "value"): OfferRow[] => [
    ...found.map((one) => ({ value: one.text, said: one.text, count: folders(one.folders) })),
    ...(typed && !found.some((one) => one.text === typed)
      ? [{ value: typed, said: `New ${kind} “${typed}”` }]
      : []),
  ];
  const rows =
    half === "key"
      ? refused
        ? []
        : offered(keysFound, typedKey, "key")
      : offered(valuesFound, typedValue, "value");
  const at = Math.min(lit, rows.length - 1);

  useLayoutEffect(() => {
    keyField.current?.focus();
  }, []);

  useEffect(() => {
    onEcho(refused?.tagId ?? null);
  }, [refused?.tagId, onEcho]);

  const settleKey = (picked: string) => {
    setKey(picked);
    setLit(0);
    setHalf("value");
    valueField.current?.focus();
  };
  const add = (picked: string) => {
    onClose();
    void onAdd(typedKey, picked);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const move = (step: number) => {
      event.preventDefault();
      if (rows.length > 0) setLit((rows.length + at + step) % rows.length);
    };
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (
      half === "key" &&
      (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey))
    ) {
      // Nothing happens on an empty key or one the folder cannot be given.
      event.preventDefault();
      if (typedKey && !refused && rows[at]) settleKey(rows[at].value);
    } else if (half === "value" && event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      setHalf("key");
      setLit(0);
      keyField.current?.focus();
    } else if (half === "value" && event.key === "Enter") {
      event.preventDefault();
      if (typedValue && rows[at]) add(rows[at].value);
    }
  };
  // A click anywhere but the label abandons both halves.
  const onBlur = (event: FocusEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose();
  };

  return (
    <>
      <fieldset onBlur={onBlur} style={{ anchorName: anchor } as CSSProperties} className={HALVES}>
        <legend className="sr-only">Add Label to {of}</legend>
        <input
          ref={keyField}
          role="combobox"
          aria-label="Key"
          aria-expanded={half === "key" && rows.length > 0}
          aria-controls={`${id}-offers`}
          aria-activedescendant={half === "key" && rows.length > 0 ? `${id}-${at}` : undefined}
          aria-invalid={refused !== null}
          value={key}
          placeholder="key"
          onChange={(event) => {
            setKey(event.target.value);
            setLit(0);
          }}
          onFocus={() => setHalf("key")}
          onKeyDown={onKeyDown}
          className={`${HALF} min-w-14 bg-well text-fg-dim focus:text-fg-hi`}
        />
        <input
          ref={valueField}
          role="combobox"
          aria-label="Value"
          aria-expanded={half === "value" && rows.length > 0}
          aria-controls={`${id}-offers`}
          aria-activedescendant={half === "value" && rows.length > 0 ? `${id}-${at}` : undefined}
          value={value}
          placeholder="value"
          tabIndex={-1}
          onChange={(event) => {
            setValue(event.target.value);
            setLit(0);
          }}
          onFocus={() => {
            // The value waits on a settled key.
            if (!typedKey || refused) keyField.current?.focus();
          }}
          onKeyDown={onKeyDown}
          className={`${HALF} min-w-18 bg-ground text-fg-hi`}
        />
      </fieldset>
      {refused && (
        <span className="w-full text-danger text-key leading-normal">{refused.line}</span>
      )}
      <OfferList
        id={id}
        anchor={anchor}
        label={half === "key" ? `Keys for ${of}` : `Values for ${typedKey}`}
        rows={rows}
        lit={at}
        onPick={(picked) => (half === "key" ? settleKey(picked) : add(picked))}
      />
    </>
  );
}

type ValueProps = {
  tagKey: string;
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
};

/**
 * A label's value changed where it stands, as Rename changes a name: the half becomes a field with
 * its text selected. Enter keeps it, Escape puts it back; it cannot be emptied, only removed.
 */
export function LabelValueField({ tagKey, value, onCommit, onCancel }: ValueProps) {
  const field = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const [empty, setEmpty] = useState(false);

  useLayoutEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const commit = () => {
    if (settled.current) return;
    const typed = fold(field.current?.value ?? "");
    if (!typed) return setEmpty(true);
    settled.current = true;
    if (typed === value) onCancel();
    else onCommit(typed);
  };
  const cancel = () => {
    settled.current = true;
    onCancel();
  };

  return (
    <>
      <span className="m-0 inline-flex h-chip max-w-full overflow-hidden rounded-nested text-small has-focus-visible:outline has-focus-visible:outline-focus has-focus-visible:outline-offset-(--focus-gap)">
        <span className="flex items-center bg-well px-2 text-fg-dim">{tagKey}</span>
        <input
          ref={field}
          aria-label={`Value of ${tagKey}`}
          aria-invalid={empty}
          defaultValue={value}
          onChange={() => setEmpty(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancel();
            }
          }}
          // Leaving the field keeps what was typed, as a rename does, unless that is nothing.
          onBlur={() => (fold(field.current?.value ?? "") ? commit() : cancel())}
          className={`${HALF} min-w-18 bg-ground text-fg-hi inset-ring ${empty ? "inset-ring-line-danger" : "inset-ring-line-control"}`}
        />
      </span>
      {empty && (
        <span className="w-full text-danger text-key leading-normal">
          A label needs a value. Use × to remove it.
        </span>
      )}
    </>
  );
}
