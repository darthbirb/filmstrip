import { type CSSProperties, type KeyboardEvent, useId, useRef } from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

export type MenuAction = { id: string; label: string; glyph?: GlyphName; onSelect: () => void };

type Props = {
  /** What the trigger is called, and the menu's own name. */
  label: string;
  glyph: GlyphName;
  actions: readonly MenuAction[];
  /** The trigger's edge the menu lines up with. */
  align?: "start" | "end";
};

/** A menu of actions, where a dropdown offers a choice: nothing here is selected. DESIGN.md "Components". */
export function Menu({ label, glyph, actions, align = "end" }: Props) {
  const id = useId();
  // The menu sits in the top layer, so nothing clips it; anchor positioning ties it to the button.
  const anchor = `--menu-${id.replace(/[^\w-]/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const choose = (action: MenuAction) => {
    menu.current?.hidePopover();
    trigger.current?.focus();
    action.onSelect();
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const list = items();
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
        aria-haspopup="menu"
        aria-controls={id}
        aria-label={label}
        title={label}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!menu.current?.matches(":popover-open")) menu.current?.showPopover();
        }}
        style={{ anchorName: anchor } as CSSProperties}
        className="focus-ring grid size-control shrink-0 place-items-center rounded-control bg-raised text-fg-mid text-icon inset-ring inset-ring-line-control transition-colors duration-(--motion-quick) hover:bg-raised-hi hover:text-fg hover:inset-ring-line-control-hi active:bg-inset motion-reduce:transition-none"
      >
        <Glyph name={glyph} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onToggle={(event) => {
          if (event.newState === "open") items()[0]?.focus();
        }}
        onKeyDown={onMenuKeyDown}
        style={
          {
            positionAnchor: anchor,
            top: "anchor(bottom)",
            [align === "end" ? "right" : "left"]:
              align === "end" ? "anchor(right)" : "anchor(left)",
            positionTryFallbacks: "flip-block",
          } as CSSProperties
        }
        className="inset-auto m-0 mt-1 flex-col gap-0.5 rounded-control border-0 bg-raised p-1 text-fg shadow-overlay inset-ring inset-ring-line-control-hi open:flex"
      >
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => choose(action)}
            className="focus-ring-inset flex h-control w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-nested px-2 text-left text-fg-mid text-ui hover:bg-wash hover:text-fg"
          >
            {action.glyph && <Glyph name={action.glyph} className="text-fg-dim text-glyph" />}
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}
