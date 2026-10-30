import { type CSSProperties, type KeyboardEvent, useId, useRef, useState } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Option<T extends string> = { value: T; label: string; glyph?: GlyphName };

/** The one act among the choices, after a rule at the menu's foot, as Clear Cover follows pictures. */
type Act = { label: string; hint: string; glyph: GlyphName; onSelect: () => void };

// Below each width the header can give, the button keeps its glyph and drops its word.
const WORDS = {
  roomy: "@max-header-roomy:sr-only",
  narrow: "@max-header-narrow:sr-only",
} as const;

type Props<T extends string> = {
  /** What is being chosen; the button reads as this and then the choice made. */
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** A glyph before the choice, naming what it sets. */
  glyph?: GlyphName;
  /** The trigger's edge the menu lines up with. */
  align?: "start" | "end";
  /** The tooltip, where the label alone does not say it. */
  title?: string;
  act?: Act;
  /** In the grid's header, which of its widths the word gives way at. */
  words?: keyof typeof WORDS;
  /**
   * On a video's plate: the choice alone as a figure, `in-pane` while `active`, with the menu
   * opening upward, its right edge on the plate's.
   */
  plate?: { active: boolean };
};

const TRIGGER = {
  control:
    "focus-ring flex h-control min-w-0 shrink-0 items-center gap-2 whitespace-nowrap rounded-control bg-raised pr-1.5 pl-2.5 text-fg text-ui inset-ring inset-ring-line-control transition-colors duration-(--motion-quick) hover:bg-raised-hi hover:inset-ring-line-control-hi active:bg-inset aria-expanded:bg-raised-hi aria-expanded:inset-ring-line-control-hi motion-reduce:transition-none",
  plate:
    "focus-ring flex h-full shrink-0 items-center whitespace-nowrap rounded-badge tabular-nums transition-colors duration-(--motion-quick) motion-reduce:transition-none",
};

/** One named choice among a few: a button showing it, opening a menu of all of them. DESIGN.md "Components". */
export function Dropdown<T extends string>({
  label,
  options,
  value,
  onChange,
  glyph,
  align = "start",
  title,
  act,
  words,
  plate,
}: Props<T>) {
  const id = useId();
  const listId = `${id}-list`;
  // The menu sits in the top layer, so nothing clips it; anchor positioning ties it to the button.
  const anchor = `--dropdown-${id.replace(/[^\w-]/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value) ?? options[0];

  const targets = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role="option"], [data-act]') ?? []),
  ];

  const close = () => {
    menu.current?.hidePopover();
    trigger.current?.focus();
  };

  const choose = (next: T) => {
    close();
    if (next !== value) onChange(next);
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const list = targets();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: list.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    list[Math.min(Math.max(target, 0), list.length - 1)]?.focus();
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        title={title ?? label}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!menu.current?.matches(":popover-open")) menu.current?.showPopover();
        }}
        style={{ anchorName: anchor } as CSSProperties}
        className={
          plate
            ? `${TRIGGER.plate} ${plate.active ? "text-in-pane" : "text-fg-mid hover:text-fg"}`
            : TRIGGER.control
        }
      >
        <span className="sr-only">{label}: </span>
        {glyph && <Glyph name={glyph} className="text-glyph" />}
        <span className={`truncate ${words ? WORDS[words] : ""}`}>{chosen?.label}</span>
        {!plate && <Glyph name="chevronDown" className="text-fg-dim text-glyph-small" />}
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        onToggle={(event) => {
          const opened = event.newState === "open";
          setOpen(opened);
          if (opened) menu.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
        }}
        style={
          (plate
            ? {
                positionAnchor: anchor,
                bottom: "anchor(top)",
                right: "anchor(right)",
                positionTryFallbacks: "flip-block",
              }
            : {
                positionAnchor: anchor,
                top: "anchor(bottom)",
                [align === "end" ? "right" : "left"]:
                  align === "end" ? "anchor(right)" : "anchor(left)",
                minWidth: "anchor-size(width)",
                positionTryFallbacks: "flip-block",
              }) as CSSProperties
        }
        className={`inset-auto m-0 flex-col rounded-control border-0 bg-raised p-1 text-fg shadow-overlay inset-ring inset-ring-line-control-hi open:flex ${plate ? "-mr-tile-gap mb-1" : "mt-1"}`}
      >
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="flex flex-col gap-0.5"
        >
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onClick={() => choose(option.value)}
                className={`focus-ring-inset flex h-control w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-nested px-2 text-left text-ui ${selected ? "hover-wash bg-plate text-on-plate" : "text-fg-mid hover:bg-wash hover:text-fg"}`}
              >
                {option.glyph && (
                  <Glyph
                    name={option.glyph}
                    className={`text-glyph ${selected ? "" : "text-fg-dim"}`}
                  />
                )}
                {option.label}
              </button>
            );
          })}
        </div>
        {act && (
          <>
            <span className="mx-2 my-1 h-px shrink-0 bg-line" />
            <button
              type="button"
              data-act
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
              onClick={() => {
                close();
                act.onSelect();
              }}
              className="focus-ring-inset flex h-control w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-nested px-2 text-left text-fg text-ui hover:bg-raised-hi"
            >
              <Glyph name={act.glyph} className="text-fg-dim text-glyph" />
              <span className="flex-1">{act.label}</span>
              <span className="text-fg-dim text-key">{act.hint}</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}
