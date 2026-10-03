import { convertFileSrc } from "@tauri-apps/api/core";
import { type CSSProperties, type KeyboardEvent, useId, useRef, useState } from "react";

import type { CoverChoice } from "../../ipc/bindings/CoverChoice";
import { folderCoverChoices, setFolderCover } from "../../ipc/commands";
import { Glyph } from "../../ui/Glyph";
import { SURFACE } from "../../ui/Menu";
import { detailChanged } from "./folder-detail";

type Props = {
  folderId: number;
  title: string;
  /** The picture chosen, or `null` while the first stands in. */
  chosen: number | null;
  /** The anchor name the cover carries, which the picker opens beside. */
  anchor: string;
};

const COLUMNS = 3;

/**
 * The pencil on a folder's cover, and the picker it opens beside it: every picture in the branch,
 * the first marked as the one standing in, the chosen one as the cover. DESIGN.md "Components".
 */
export function CoverPicker({ folderId, title, chosen, anchor }: Props) {
  const id = useId();
  const pencil = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<CoverChoice[]>([]);

  const targets = () => [
    ...(panel.current?.querySelectorAll<HTMLElement>("[data-choice], [data-clear]") ?? []),
  ];

  const pick = (itemId: number | null) => {
    panel.current?.hidePopover();
    pencil.current?.focus();
    if (itemId !== chosen) {
      void setFolderCover(folderId, itemId)
        .then(detailChanged)
        .catch(() => undefined);
    }
  };

  // The pictures move in rows of three; down from the last row reaches Clear Cover.
  const onKeyDown = (event: KeyboardEvent) => {
    const list = targets();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
    if (step === undefined || at < 0) return;
    event.preventDefault();
    const pictures = choices.length;
    let next = at + step;
    if (at < pictures && next >= pictures) next = event.key === "ArrowDown" ? pictures : at;
    if (at === pictures) next = event.key === "ArrowUp" ? pictures - 1 : at;
    list[Math.min(Math.max(next, 0), list.length - 1)]?.focus();
  };

  return (
    <>
      <button
        ref={pencil}
        type="button"
        popoverTarget={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={chosen === null ? "Choose Cover · now the first picture" : "Change Cover"}
        title={chosen === null ? "Choose Cover · now the first picture" : "Change Cover"}
        className={`focus-ring hover-wash absolute top-1.5 right-1.5 grid size-badge place-items-center rounded-badge bg-veil text-fg text-glyph-small ${open ? "shadow-[inset_0_0_0_100vmax_var(--color-wash)] outline-2 outline-in-pane outline-offset-1" : ""}`}
      >
        <Glyph name="pencil" />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={`Choose Cover for ${title}`}
        onToggle={(event) => {
          const opened = event.newState === "open";
          setOpen(opened);
          if (!opened) return;
          void folderCoverChoices(folderId).then((found) => {
            setChoices(found);
            // The picture it is now takes the keyboard, once the list has drawn.
            requestAnimationFrame(() => {
              const now = chosen ?? found[0]?.itemId;
              panel.current?.querySelector<HTMLElement>(`[data-choice="${now}"]`)?.focus();
            });
          });
        }}
        onKeyDown={onKeyDown}
        style={
          {
            positionAnchor: anchor,
            top: "anchor(top)",
            left: "anchor(right)",
            positionTryFallbacks: "flip-inline",
          } as CSSProperties
        }
        className={`${SURFACE} ml-2`}
      >
        <span className="px-2 pt-0.75 pb-1.25 text-eyebrow text-fg-dim uppercase">
          Cover for {title}
        </span>
        <div
          role="listbox"
          aria-label={`Cover for ${title}`}
          className="grid max-h-[calc(3*var(--spacing-cover-choice)+5*var(--spacing))] grid-cols-3 gap-1.5 overflow-y-auto px-1.5 pt-0.5 pb-1.5"
        >
          {choices.map((choice, index) => {
            const mark = choice.itemId === chosen ? "Cover" : index === 0 ? "First" : null;
            return (
              <button
                key={choice.itemId}
                type="button"
                role="option"
                aria-selected={choice.itemId === chosen}
                aria-label={mark ? `Picture ${index + 1} · ${mark}` : `Picture ${index + 1}`}
                data-choice={choice.itemId}
                tabIndex={-1}
                onClick={() => pick(choice.itemId)}
                className="focus-ring relative h-cover-choice overflow-hidden rounded-badge bg-inset hover:inset-ring hover:inset-ring-in-pane"
              >
                {choice.thumb && (
                  <img
                    src={convertFileSrc(choice.thumb)}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="absolute inset-0 size-full object-cover"
                  />
                )}
                {mark && (
                  <span className="absolute bottom-1 left-1 flex h-4 items-center rounded-badge bg-veil px-1.5 text-fg text-micro uppercase tracking-(--text-eyebrow--letter-spacing)">
                    {mark}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {chosen !== null && (
          <>
            <span className="mx-2 my-1 h-px shrink-0 bg-line" />
            <button
              type="button"
              data-clear
              tabIndex={-1}
              onClick={() => pick(null)}
              className="focus-ring-inset flex h-control w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-nested px-2 text-left text-fg text-ui hover:bg-raised-hi"
            >
              <span className="flex-1 truncate">Clear Cover</span>
              <span className="text-fg-dim text-key">back to the first</span>
            </button>
          </>
        )}
      </div>
    </>
  );
}
