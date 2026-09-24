import { useId, useLayoutEffect, useRef } from "react";

type Props = {
  label: string;
  /** The name as it is: the field starts with its stem selected and its extension outside. */
  name: string;
  /** Why the name typed cannot be used, said under the field, which keeps it until it changes. */
  taken: string | null;
  onEdit: () => void;
  onCommit: (name: string) => void;
  onCancel: () => void;
};

/**
 * A file's name as a field where it stands. Enter renames, Escape keeps the name, and leaving
 * the field keeps what was typed unless it is taken. DESIGN.md "Components".
 */
export function NameField({ label, name, taken, onEdit, onCommit, onCancel }: Props) {
  const field = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  const said = useId();

  // A field opened in a box still arriving is hidden for its first frame, and a hidden field
  // cannot take the focus, so it asks again each frame until the box has shown it.
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
      const dot = name.lastIndexOf(".");
      element.setSelectionRange(0, dot > 0 ? dot : name.length);
    };
    take();
    return () => cancelAnimationFrame(asking);
  }, [name]);

  // Once committed, the field waits for the answer; a taken name holds Enter until it is edited.
  const commit = () => {
    if (settled.current || taken) return;
    settled.current = true;
    const typed = field.current?.value.trim() ?? "";
    if (typed && typed !== name) onCommit(typed);
    else onCancel();
  };
  const cancel = () => {
    settled.current = true;
    onCancel();
  };

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <input
        ref={field}
        aria-label={label}
        aria-invalid={taken !== null}
        aria-describedby={taken ? said : undefined}
        defaultValue={name}
        onChange={() => {
          settled.current = false;
          onEdit();
        }}
        onBlur={() => (taken ? cancel() : commit())}
        onKeyDown={(event) => {
          // Its keys are the field's: Escape here is not full screen's, nor Ctrl+Z the journal's.
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        className="focus-ring h-bar-field w-full min-w-0 rounded-nested bg-ground px-2 text-fg-hi text-ui tabular-nums inset-ring inset-ring-line-control selection:bg-plate selection:text-on-plate aria-invalid:inset-ring-line-danger"
      />
      {taken && (
        <span id={said} className="text-danger text-small">
          {taken}
        </span>
      )}
    </span>
  );
}
