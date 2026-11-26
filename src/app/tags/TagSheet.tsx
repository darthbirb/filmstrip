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
import { Files, files, formatCount } from "../../lib/format";
import { keepEscape, SURFACE } from "../../ui/Menu";
import { SetChip } from "../../ui/SetChip";
import { StandingTagField } from "../../ui/TagField";
import { sayFailed } from "../failure";
import { libraryChanged, whenLibraryChanges } from "../library";
import { getPlace } from "../place";
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
const RULE = "mx-2 my-1 h-px shrink-0 border-0 bg-line";

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
  const [ringed] = useState(() => document.activeElement?.matches(":focus-visible") ?? false);
  const [root] = useState(() => {
    const place = getPlace();
    return place?.kind === "folder" ? (place.path[0]?.title ?? null) : null;
  });
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
    if (!element.matches(":popover-open")) element.showPopover();
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

  const act = async (
    work: () => Promise<Parameters<typeof afterAct>[0] | null>,
    what: string,
  ): Promise<boolean> => {
    let batch: Parameters<typeof afterAct>[0] | null;
    try {
      batch = await work();
    } catch (error) {
      sayFailed(what, error);
      await load();
      return false;
    }
    if (batch) {
      afterAct(batch);
      await libraryChanged();
    }
    await load();
    return true;
  };
  const wanted = () => itemIds.slice();
  const them = () => files(itemIds.length);
  const added = (value: string) =>
    act(() => addItemsTag(wanted(), value), `Could not add ${value} to ${them()}.`);
  const add = async (value: string) => {
    if (!(await added(value))) throw new Error(`${value} was not added`);
  };
  const remove = (tag: SetTag) =>
    act(
      () => removeItemsTag(wanted(), tag.tagId),
      `Could not take ${tag.key ? `${tag.key}: ${tag.value}` : tag.value} off ${them()}.`,
    );

  // A chip taken off with the keyboard hands its stop to the one after it.
  const stops = () => [...(sheet.current?.querySelectorAll<HTMLElement>("[data-stop]") ?? [])];
  const takeOff = (tag: SetTag) => {
    const at = stops().indexOf(document.activeElement as HTMLElement);
    void remove(tag).then((done) => {
      if (!done || at < 0) return;
      requestAnimationFrame(() => (stops()[at] ?? sheet.current?.querySelector("input"))?.focus());
    });
  };
  const backOut = () => {
    const own = sheet.current?.querySelectorAll<HTMLElement>("[data-own] [data-stop]");
    own?.[own.length - 1]?.focus();
  };

  const count = coverage?.files ?? itemIds.length;
  const groups = coverage ? sections(coverage) : null;

  return (
    <div
      ref={sheet}
      popover="auto"
      role="dialog"
      aria-label={`Tag ${Files(itemIds.length)}`}
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
      <p className={`${HEADING} truncate`}>{Files(itemIds.length)}</p>
      <div className="flex flex-wrap gap-1 px-2 pt-0.5 pb-2">
        {shown && (
          <StandingTagField
            of={Files(itemIds.length)}
            offers={tagOffers}
            refuse={(value) => (coverage ? refusal(coverage, value) : null)}
            onAdd={add}
            onEcho={setEcho}
            onBackOut={backOut}
            onClose={close}
            ringed={ringed}
          />
        )}
      </div>
      {groups === null ? (
        <>
          <p className={HEADING}>{count === 1 ? "Its Own" : "Their Own"}</p>
          <StandIns widths={["w-18", "w-26", "w-14"]} />
          {root !== null && (
            <>
              <hr className={RULE} />
              <p className={`${HEADING} truncate`}>From {root}</p>
              <StandIns widths={["w-20"]} />
            </>
          )}
        </>
      ) : (
        groups.map((section, at) => (
          <section
            key={section.heading}
            aria-label={section.heading}
            data-own={section.own || undefined}
            className="flex flex-col"
          >
            {at === 1 && groups[0]?.own && <hr className={RULE} />}
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
                  onAdd={() => void added(tag.value)}
                  onRemove={() => takeOff(tag)}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/** Chip-shaped places held while what the set carries is read. */
function StandIns({ widths }: { widths: string[] }) {
  return (
    <div aria-hidden className="flex flex-wrap gap-1.5 px-2 pb-1.5">
      {widths.map((width) => (
        <span
          key={width}
          className={`h-chip ${width} rounded-full bg-inset inset-ring inset-ring-line`}
        />
      ))}
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
  const holding = Files(tag.files);
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
