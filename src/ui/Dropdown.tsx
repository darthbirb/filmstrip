import { type CSSProperties, type KeyboardEvent, useId, useRef, useState } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

type Option<T extends string> = { value: T; label: string; glyph?: GlyphName };

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
};

/** One named choice among a few: a button showing it, opening a menu of all of them. DESIGN.md "Components". */
export function Dropdown<T extends string>({
  label,
  options,
  value,
  onChange,
  glyph,
  align = "start",
}: Props<T>) {
  const id = useId();
  // The menu sits in the top layer, so nothing clips it; anchor positioning ties it to the button.
  const anchor = `--dropdown-${id.replace(/[^\w-]/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value) ?? options[0];

  const optionElements = () => [
    ...(menu.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
  ];

  const choose = (next: T) => {
    menu.current?.hidePopover();
    trigger.current?.focus();
    if (next !== value) onChange(next);
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const list = optionElements();
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
        aria-controls={id}
        title={label}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!menu.current?.matches(":popover-open")) menu.current?.showPopover();
        }}
        style={{ anchorName: anchor } as CSSProperties}
        className="focus-ring flex h-control min-w-0 shrink-0 items-center gap-2 whitespace-nowrap rounded-control bg-raised pr-1.5 pl-2.5 text-fg text-ui inset-ring inset-ring-line-control transition-colors duration-(--motion-quick) hover:bg-raised-hi hover:inset-ring-line-control-hi active:bg-inset aria-expanded:bg-raised-hi aria-expanded:inset-ring-line-control-hi motion-reduce:transition-none"
      >
        <span className="sr-only">{label}: </span>
        {glyph && <Glyph name={glyph} className="text-glyph" />}
        <span className="truncate">{chosen?.label}</span>
        <Glyph name="chevronDown" className="text-fg-dim text-glyph-small" />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="listbox"
        aria-label={label}
        onToggle={(event) => {
          const opened = event.newState === "open";
          setOpen(opened);
          if (opened) menu.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
        }}
        onKeyDown={onMenuKeyDown}
        style={
          {
            positionAnchor: anchor,
            top: "anchor(bottom)",
            [align === "end" ? "right" : "left"]:
              align === "end" ? "anchor(right)" : "anchor(left)",
            minWidth: "anchor-size(width)",
            positionTryFallbacks: "flip-block",
          } as CSSProperties
        }
        className="inset-auto m-0 mt-1 flex-col gap-0.5 rounded-control border-0 bg-raised p-1 text-fg shadow-overlay inset-ring inset-ring-line-control-hi open:flex"
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
    </>
  );
}
