import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { Coverage } from "../../ipc/bindings/Coverage";
import { addItemsTag, removeItemsTag, selectionTagCoverage, tagOffers } from "../../ipc/commands";
import { formatCount } from "../../lib/format";
import { keepEscape, SURFACE } from "../../ui/Menu";
import { SetChip } from "../../ui/SetChip";
import { StandingTagField } from "../../ui/TagField";
import { libraryChanged, whenLibraryChanges } from "../library";
import { afterAct } from "../undo/undo";
import { countOf, refusal, type SetTag, sections, whoseTag } from "./coverage";

const listeners = new Set<() => void>();

/** Asks the selection bar to open the sheet, as the set's right-click menu does. */
export function openTagSheet() {
  for (const listener of listeners) listener();
}

/** Calls back when something asks for the sheet. */
export function whenTagSheetAsked(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

type Props = {
  itemIds: readonly number[];
  /** The button it opens against, a tile-gap above it, left edges met. */
  anchor: HTMLElement;
  /** Its tallest, past which it scrolls: half the grid's height. */
  maxHeight?: number;
  onClose: () => void;
};

const HEADING = "m-0 flex h-chip shrink-0 items-center px-2 text-eyebrow text-fg-dim uppercase";
const files = (n: number) => `${formatCount(n)} ${n === 1 ? "File" : "Files"}`;

/**
 * Tag…: what a set of checked files carries and whose each tag is, with the shared tag field to
 * add one to all of them. Each add and remove is one batch, with the Line. Artboards › Tagging a set.
 */
export function TagSheet({ itemIds, anchor, maxHeight, onClose }: Props) {
  const id = useId();
  const name = `--tag-sheet-${id.replace(/[^\w-]/g, "")}`;
  const sheet = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [echo, setEcho] = useState<number | null>(null);
  const ids = itemIds.join(",");

  const load = useCallback(() => {
    const wanted = ids === "" ? [] : ids.split(",").map(Number);
    return selectionTagCoverage(wanted).then(setCoverage, () => undefined);
  }, [ids]);

  useEffect(() => {
    void load();
    return whenLibraryChanges(() => void load());
  }, [load]);

  useLayoutEffect(() => {
    const element = sheet.current;
    if (!element) return;
    anchor.style.setProperty("anchor-name", name);
    // Its own button closes it rather than light dismiss closing it and the click opening it again.
    // Tied after the click that opened it, whose activation would otherwise hide it at once.
    const invoker = anchor instanceof HTMLButtonElement && !anchor.popoverTargetElement;
    const tie = invoker
      ? setTimeout(() => {
          anchor.popoverTargetElement = element;
          anchor.popoverTargetAction = "hide";
        })
      : undefined;
    element.showPopover();
    setShown(true);
    return () => {
      clearTimeout(tie);
      anchor.style.removeProperty("anchor-name");
      if (invoker) anchor.popoverTargetElement = null;
    };
  }, [anchor, name]);

  const close = () => {
    if (sheet.current?.matches(":popover-open")) sheet.current.hidePopover();
  };

  const act = async (work: () => Promise<Parameters<typeof afterAct>[0] | null>) => {
    try {
      const batch = await work();
      if (batch) {
        afterAct(batch);
        await libraryChanged();
      }
    } catch {}
    await load();
  };
  const wanted = () => itemIds.slice();
  const add = (value: string) => act(() => addItemsTag(wanted(), value));
  const remove = (tagId: number) => act(() => removeItemsTag(wanted(), tagId));

  // A chip taken off with the keyboard hands its stop to the one after it.
  const stops = () => [
    ...(sheet.current?.querySelectorAll<HTMLElement>('[role="button"][tabindex="0"]') ?? []),
  ];
  const takeOff = (tagId: number) => {
    const at = stops().indexOf(document.activeElement as HTMLElement);
    void remove(tagId).then(() => {
      if (at < 0) return;
      requestAnimationFrame(() => (stops()[at] ?? sheet.current?.querySelector("input"))?.focus());
    });
  };
  const backOut = () => {
    const own = sheet.current?.querySelectorAll<HTMLElement>('[data-own] [role="button"]');
    own?.[own.length - 1]?.focus();
  };

  const count = coverage?.files ?? itemIds.length;
  const groups = coverage ? sections(coverage) : null;

  return (
    <div
      ref={sheet}
      popover="auto"
      role="dialog"
      aria-label={`Tag ${files(itemIds.length)}`}
      onToggle={(event) => {
        // The offers under the field are a popover too, and their toggle reaches this one.
        if (event.target !== event.currentTarget || event.newState !== "closed") return;
        if (
          sheet.current?.contains(document.activeElement) ||
          document.activeElement === document.body
        )
          anchor.focus({ preventScroll: true });
        onClose();
      }}
      onKeyDown={keepEscape}
      style={
        {
          positionAnchor: name,
          left: "anchor(left)",
          bottom: "anchor(top)",
          positionTryFallbacks: "flip-block",
          maxHeight,
        } as CSSProperties
      }
      className={`mb-tile-gap overflow-y-auto ${SURFACE}`}
    >
      <p className={`${HEADING} truncate`}>{files(itemIds.length)}</p>
      <div className="flex flex-wrap gap-1 px-2 pt-0.5 pb-2">
        {shown && (
          <StandingTagField
            of={files(itemIds.length)}
            offers={tagOffers}
            refuse={(value) => (coverage ? refusal(coverage, value) : null)}
            onAdd={add}
            onEcho={setEcho}
            onBackOut={backOut}
            onClose={close}
          />
        )}
      </div>
      {groups === null ? (
        <>
          <p className={HEADING}>{count === 1 ? "Its Own" : "Their Own"}</p>
          <div aria-hidden className="flex flex-wrap gap-1.5 px-2 pb-1.5">
            {["w-18", "w-26", "w-14"].map((width) => (
              <span
                key={width}
                className={`h-chip ${width} rounded-full bg-inset inset-ring inset-ring-line`}
              />
            ))}
          </div>
        </>
      ) : (
        groups.map((section, at) => (
          <section
            key={section.heading}
            aria-label={section.heading}
            data-own={section.own || undefined}
            className="flex flex-col"
          >
            {at === 1 && groups[0]?.own && (
              <hr className="mx-2 my-1 h-px shrink-0 border-0 bg-line" />
            )}
            <h3 className={`${HEADING} truncate`}>{section.heading}</h3>
            <div className="flex flex-wrap gap-1.5 px-2 pb-1.5">
              {section.tags.map((tag) => (
                <Chip
                  key={`${tag.tagId}-${tag.from.join("/")}`}
                  tag={tag}
                  of={count}
                  own={section.own}
                  gathered={section.gathered}
                  echoed={tag.tagId === echo}
                  onAdd={() => void add(tag.value)}
                  onRemove={() => takeOff(tag.tagId)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

type ChipProps = {
  tag: SetTag;
  of: number;
  own: boolean;
  gathered: boolean;
  echoed: boolean;
  onAdd: () => void;
  onRemove: () => void;
};

/** The set's own take + and ×; what a folder gives has neither, since it comes off at the folder. */
function Chip({ tag, of, own, gathered, echoed, onAdd, onRemove }: ChipProps) {
  const others = of - tag.files;
  const holding = files(tag.files);
  return (
    <SetChip
      value={tag.value}
      tagKey={tag.key}
      inherited={!own}
      name={tag.name}
      count={countOf(tag.files, of)}
      title={own ? undefined : whoseTag(tag)}
      stop={own || gathered}
      echoed={echoed}
      add={
        own && others > 0 ? { label: `Add to the Other ${formatCount(others)}`, onAdd } : undefined
      }
      remove={own ? { label: `Remove from ${holding}`, onRemove } : undefined}
    />
  );
}
