import {
  type CSSProperties,
  Fragment,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Glyph } from "./Glyph";
import type { GlyphName } from "./glyphs";

export type MenuAction = {
  id: string;
  label: string;
  glyph?: GlyphName;
  /** The glyph drawn filled, for a row that undoes a state the item is in. */
  filled?: boolean;
  /** The one row that cannot be taken back, drawn apart in the danger hue. */
  tone?: "danger";
  onSelect: () => void;
};

/** Rows in groups. A rule stands between two groups only when both hold something. */
export type MenuGroups = readonly (readonly MenuAction[])[];

/** A menu that says what it is about above its rows, as a source's does. */
export type HeadedMenu = { heading?: string; groups: MenuGroups };

// The list's own shape, whichever way it was opened. DESIGN.md "Components".
export const SURFACE =
  "inset-auto m-0 w-menu flex-col gap-px rounded-control border-0 bg-panel p-1 text-fg shadow-overlay inset-ring inset-ring-line-control open:flex";

const ROW =
  "focus-ring-inset flex h-control w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-nested px-2 text-left text-ui";

const TONE = {
  quiet: "text-fg hover:bg-raised-hi",
  danger: "text-danger hover:bg-danger-tint",
};

/** The heading, the rows, their rules, and the arrows that move between them. */
function MenuList({
  menu,
  heading,
  groups,
  onChoose,
}: {
  menu: RefObject<HTMLDivElement | null>;
  heading?: string;
  groups: MenuGroups;
  onChoose: (action: MenuAction) => void;
}) {
  const filled = groups.filter((group) => group.length > 0);
  const rows = filled.map((group, index) => (
    <Fragment key={group[0]?.id}>
      {index > 0 && <hr className="mx-2 my-1 h-px shrink-0 border-0 bg-line" />}
      {group.map((action) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={() => onChoose(action)}
          onKeyDown={(event) => moveWithin(menu, event)}
          className={`${ROW} ${TONE[action.tone ?? "quiet"]}`}
        >
          {action.glyph && (
            <Glyph
              name={action.glyph}
              filled={action.filled}
              className={`text-glyph ${action.tone === "danger" ? "" : "text-fg-dim"}`}
            />
          )}
          <span className="min-w-0 truncate">{action.label}</span>
        </button>
      ))}
    </Fragment>
  ));
  return heading ? (
    <>
      <p className="m-0 flex h-chip shrink-0 items-center px-2 text-eyebrow text-fg-dim uppercase">
        {heading}
      </p>
      {rows}
    </>
  ) : (
    rows
  );
}

const rows = (menu: RefObject<HTMLDivElement | null>) => [
  ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
];

// Escape closes the menu and nothing else: full screen and a floating panel listen on the window.
function keepEscape(event: KeyboardEvent) {
  if (event.key === "Escape") event.stopPropagation();
}

function moveWithin(menu: RefObject<HTMLDivElement | null>, event: KeyboardEvent) {
  const list = rows(menu);
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
}

type Props = {
  /** What the trigger is called, and the menu's own name. */
  label: string;
  glyph: GlyphName;
  groups: MenuGroups;
  /** The trigger's edge the menu lines up with. */
  align?: "start" | "end";
};

/** A menu of actions, where a dropdown offers a choice: nothing here is selected. DESIGN.md "Components". */
export function Menu({ label, glyph, groups, align = "end" }: Props) {
  const id = useId();
  // The menu sits in the top layer, so nothing clips it; anchor positioning ties it to the button.
  const anchor = `--menu-${id.replace(/[^\w-]/g, "")}`;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const choose = (action: MenuAction) => {
    menu.current?.hidePopover();
    trigger.current?.focus();
    action.onSelect();
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
          if (event.newState === "open") rows(menu)[0]?.focus();
        }}
        onKeyDown={keepEscape}
        style={
          {
            positionAnchor: anchor,
            top: "anchor(bottom)",
            [align === "end" ? "right" : "left"]:
              align === "end" ? "anchor(right)" : "anchor(left)",
            positionTryFallbacks: "flip-block",
          } as CSSProperties
        }
        className={`mt-1 ${SURFACE}`}
      >
        <MenuList menu={menu} groups={groups} onChoose={choose} />
      </div>
    </>
  );
}

/** Where a right-click menu opens: at the pointer, or against the element the keyboard is on. */
export type MenuAnchor = { x: number; y: number } | { element: HTMLElement };

type ContextProps = {
  label: string;
  heading?: string;
  groups: MenuGroups;
  anchor: MenuAnchor;
  onClose: () => void;
};

/**
 * The same list opened by a right-click. Against an element it hangs one tile-gap off the focus
 * ring, flips above when there is no room below, and slides along the window's edge rather than
 * shrinking. DECISIONS.md "Right-click menus".
 */
export function ContextMenu({ label, heading, groups, anchor, onClose }: ContextProps) {
  const menu = useRef<HTMLDivElement>(null);
  // Where the focus goes back to: the element the keyboard opened it on, or wherever it was.
  const back = useRef<HTMLElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    back.current =
      "element" in anchor ? anchor.element : (document.activeElement as HTMLElement | null);
    if (!element.matches(":popover-open")) element.showPopover();
    setAt(placement(anchor, element.getBoundingClientRect()));
  }, [anchor]);

  // Hidden until it is placed, and a hidden row cannot take the focus.
  useLayoutEffect(() => {
    if (at) rows(menu)[0]?.focus({ preventScroll: true });
  }, [at]);

  // Escape or a click away: the focus goes back only if the menu still held it.
  const close = () => {
    const inside = menu.current?.contains(document.activeElement);
    if (inside || document.activeElement === document.body)
      back.current?.focus({ preventScroll: true });
    onClose();
  };

  // Back first, so a verb that takes the focus somewhere of its own, as Rename does, keeps it.
  const choose = (action: MenuAction) => {
    back.current?.focus({ preventScroll: true });
    menu.current?.hidePopover();
    action.onSelect();
  };

  return (
    <div
      ref={menu}
      popover="auto"
      role="menu"
      aria-label={label}
      onToggle={(event) => {
        if (event.newState === "closed") close();
      }}
      onKeyDown={keepEscape}
      style={at ? { position: "fixed", ...at } : { position: "fixed", visibility: "hidden" }}
      className={SURFACE}
    >
      <MenuList menu={menu} heading={heading} groups={groups} onChoose={choose} />
    </div>
  );
}

/** Where a menu of this size goes against its anchor, kept inside the window. */
export function placement(anchor: MenuAnchor, size: DOMRect) {
  const view = { width: window.innerWidth, height: window.innerHeight };
  let left: number;
  let top: number;
  if ("element" in anchor) {
    const box = anchor.element.getBoundingClientRect();
    // Measured from where the ring ends, not the element: its width, its gap, then a tile-gap.
    const root = getComputedStyle(document.documentElement);
    const clear =
      Number.parseFloat(root.getPropertyValue("--focus-width")) +
      Number.parseFloat(root.getPropertyValue("--focus-gap")) +
      Number.parseFloat(root.getPropertyValue("--spacing-tile-gap")) *
        Number.parseFloat(root.fontSize);
    left = box.left;
    top = box.bottom + clear;
    if (top + size.height > view.height) top = box.top - clear - size.height;
  } else {
    left = anchor.x;
    top = anchor.y;
    if (top + size.height > view.height) top = anchor.y - size.height;
  }
  return {
    left: Math.max(0, Math.min(left, view.width - size.width)),
    top: Math.max(0, Math.min(top, view.height - size.height)),
  };
}

type Opened = { label: string; anchor: MenuAnchor; heading?: string; groups: MenuGroups };

/**
 * Right-click menus for a surface: `open` from its context menu event, with the menu for whatever
 * was clicked. The menu key and Shift+F10 arrive with no button (-1), placed at the element's
 * centre, so the element is the anchor rather than that point.
 */
export function useContextMenu() {
  const [open, setOpen] = useState<Opened | null>(null);

  const show = (
    event: MouseEvent<HTMLElement>,
    label: string,
    groups: MenuGroups,
    heading?: string,
  ) => {
    const filled = groups.filter((group) => group.length > 0);
    // An empty menu opens nothing at all; the browser's own stays suppressed.
    if (filled.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor =
      event.button === -1
        ? { element: event.currentTarget }
        : { x: event.clientX, y: event.clientY };
    setOpen({ label, anchor, heading, groups: filled });
  };

  const menu: ReactNode = open && (
    <ContextMenu
      label={open.label}
      heading={open.heading}
      groups={open.groups}
      anchor={open.anchor}
      // A second right-click may already have opened it again before the first one's close lands.
      onClose={() => setOpen((now) => (now === open ? null : now))}
    />
  );
  return { open: show, menu };
}
