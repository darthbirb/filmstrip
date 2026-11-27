import {
  type FocusEvent,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ChipButton } from "./ChipButton";
import { Glyph } from "./Glyph";

type Props = {
  /** What the note says now; `null` for none. */
  note: string | null;
  /** What it is a note on, for its field's name. */
  of: string;
  /**
   * The text kept, or `null` once it is emptied; resolves to why it was not saved when it was
   * not, and the box comes back holding what was written.
   */
  onSave: (note: string | null) => Promise<string | null>;
};

/** What was written and not saved, and why. */
type Unsaved = { text: string; why: string };

// The note whose box closed with the focus in it, and the note it will read once saved: its
// control takes the focus again as a saved note remounts the row, until that note is drawn.
let handing: { of: string; note: string | null } | null = null;

/**
 * A note as prose where it stands, and the box it becomes. Enter is a new line; Ctrl+Enter, Save
 * or a click away keeps it, and Escape or Cancel leaves the note as it was. DESIGN.md "Components".
 */
export function NoteField({ note, of, onSave }: Props) {
  const [writing, setWriting] = useState(false);
  const [unsaved, setUnsaved] = useState<Unsaved | null>(null);
  const [focus, setFocus] = useState(true);
  const control = useRef<HTMLButtonElement>(null);
  const open = () => {
    handing = null;
    setWriting(true);
  };

  useLayoutEffect(() => {
    if (writing || handing?.of !== of) return;
    const now = document.activeElement;
    const lost = now === null || now === document.body || now === control.current;
    if (lost) control.current?.focus();
    if (!lost || handing.note === note) handing = null;
  }, [writing, note, of]);

  if (writing) {
    return (
      <Box
        note={unsaved ? unsaved.text : note}
        of={of}
        why={unsaved?.why ?? null}
        focus={focus}
        onDone={(kept, inside) => {
          handing = inside ? { of, note: kept === undefined ? note : kept } : null;
          setWriting(false);
          setUnsaved(null);
          setFocus(true);
          if (kept === undefined || (kept === note && !unsaved)) return;
          void onSave(kept).then((why) => {
            if (why === null) return;
            const active = document.activeElement;
            setFocus(active === null || active === document.body || active === control.current);
            setUnsaved({ text: kept ?? "", why });
            setWriting(true);
          });
        }}
      />
    );
  }
  if (note === null) {
    return (
      <span className="flex py-px">
        <ChipButton ref={control} look="outline" onClick={open}>
          Add Note…
        </ChipButton>
      </span>
    );
  }
  return (
    <button
      ref={control}
      type="button"
      aria-label={`Change Note on ${of}`}
      onClick={open}
      className="group focus-ring flex items-start gap-1.5 rounded-badge text-left"
    >
      <span className="whitespace-pre-line text-pretty">{note}</span>
      {/* The Name row's glyph: this text can be changed. */}
      <Glyph
        name="rename"
        className="mt-1.25 text-fg-dim text-glyph opacity-0 transition-opacity duration-(--motion-quick) group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
      />
    </button>
  );
}

type BoxProps = {
  note: string | null;
  of: string;
  /** Why what it holds was not saved, said in place of the keys. */
  why: string | null;
  /** Whether it takes the caret as it opens. */
  focus: boolean;
  /**
   * What to keep, or `undefined` to keep the note as it was; `inside` when the focus was in the
   * box as it closed.
   */
  onDone: (kept: string | null | undefined, inside: boolean) => void;
};

function Box({ note, of, why, focus, onDone }: BoxProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const settled = useRef(false);
  const unsavedId = useId();

  // A box opened in a band still arriving is hidden for its first frame, so the caret is asked
  // for again each frame until it lands, at the end of what is written.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element || !focus) return;
    let frame = 0;
    let asking = 0;
    const take = () => {
      element.focus();
      if (document.activeElement !== element && frame++ < 20) {
        asking = requestAnimationFrame(take);
        return;
      }
      element.setSelectionRange(element.value.length, element.value.length);
    };
    take();
    return () => cancelAnimationFrame(asking);
  }, [focus]);

  const finish = (keep: boolean, inside = true) => {
    if (settled.current) return;
    settled.current = true;
    const text = field.current?.value.trim() ?? "";
    onDone(keep ? text || null : undefined, inside);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish(true);
    }
  };
  // Leaving the box, not moving between its field and its buttons, keeps what was written.
  const onBlur = (event: FocusEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish(true, false);
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" onBlur={onBlur}>
      <textarea
        ref={field}
        aria-label={`Note on ${of}`}
        defaultValue={note ?? ""}
        placeholder="Write a note"
        onKeyDown={onKeyDown}
        aria-invalid={why !== null || undefined}
        aria-describedby={why !== null ? unsavedId : undefined}
        className={`focus-ring field-sizing-content min-h-[calc(3*var(--text-ui--line-height)+2*var(--pad))] w-full resize-none rounded-nested bg-ground px-2 py-(--pad) text-fg-hi [--pad:--spacing(1)] text-ui inset-ring placeholder:text-fg-dim ${why !== null ? "inset-ring-line-danger" : "inset-ring-line-control"}`}
      />
      <span className="flex items-center gap-1.5">
        {why !== null ? (
          <span id={unsavedId} role="alert" className="flex-1 text-danger text-key">
            {why}
          </span>
        ) : (
          <span className="flex-1 text-fg-dim text-key">Ctrl+Enter saves · Escape abandons</span>
        )}
        <ChipButton look="secondary" onClick={() => finish(false)}>
          Cancel
        </ChipButton>
        <ChipButton look="primary" onClick={() => finish(true)}>
          Save
        </ChipButton>
      </span>
    </fieldset>
  );
}
