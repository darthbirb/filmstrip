import { type FocusEvent, type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";

import { ChipButton } from "./ChipButton";
import { Glyph } from "./Glyph";

type Props = {
  /** What the note says now; `null` for none. */
  note: string | null;
  /** What it is a note on, for its field's name. */
  of: string;
  /** The text kept, or `null` once it is emptied. */
  onSave: (note: string | null) => void;
};

/**
 * A note as prose where it stands, and the box it becomes. Enter is a new line; Ctrl+Enter, Save
 * or a click away keeps it, and Escape or Cancel leaves the note as it was. DESIGN.md "Components".
 */
export function NoteField({ note, of, onSave }: Props) {
  const [writing, setWriting] = useState(false);
  if (writing) {
    return (
      <Box
        note={note}
        of={of}
        onDone={(kept) => {
          setWriting(false);
          if (kept !== undefined && kept !== note) onSave(kept);
        }}
      />
    );
  }
  if (note === null) {
    return (
      <span className="flex py-px">
        <ChipButton look="outline" onClick={() => setWriting(true)}>
          Add Note…
        </ChipButton>
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`Change Note on ${of}`}
      onClick={() => setWriting(true)}
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
  /** What to keep, or `undefined` to keep the note as it was. */
  onDone: (kept: string | null | undefined) => void;
};

function Box({ note, of, onDone }: BoxProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const settled = useRef(false);

  // A box opened in a band still arriving is hidden for its first frame, so the caret is asked
  // for again each frame until it lands, at the end of what is written.
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
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
  }, []);

  const finish = (keep: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const text = field.current?.value.trim() ?? "";
    onDone(keep ? text || null : undefined);
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
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) finish(true);
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" onBlur={onBlur}>
      <textarea
        ref={field}
        aria-label={`Note on ${of}`}
        defaultValue={note ?? ""}
        placeholder="Write a note"
        onKeyDown={onKeyDown}
        className="focus-ring field-sizing-content min-h-19.5 w-full resize-none rounded-nested bg-ground px-2 py-1 text-fg-hi text-ui leading-5.5 inset-ring inset-ring-line-control placeholder:text-fg-faint"
      />
      <span className="flex items-center gap-1.5">
        <span className="flex-1 text-fg-faint text-key">Ctrl+Enter saves · Escape abandons</span>
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
