import { convertFileSrc } from "@tauri-apps/api/core";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { FolderDetail } from "../../ipc/bindings/FolderDetail";
import type { SourceSummary } from "../../ipc/bindings/SourceSummary";
import { Button } from "../../ui/Button";
import { CountPill } from "../../ui/Count";
import { EmptyState } from "../../ui/EmptyState";
import { Glyph } from "../../ui/Glyph";
import { GlyphButton } from "../../ui/GlyphButton";
import { Menu, type MenuGroups } from "../../ui/Menu";
import { Plate } from "../../ui/Plate";
import { PushDown } from "../../ui/PushDown";
import { CoverPicker } from "../grid/CoverPicker";
import { OfflinePlace } from "../grid/EmptyPlace";
import { FolderFacts } from "../grid/FolderBand";
import { fromFocus, placeMenu } from "../menus/ground";
import { useIndex } from "../navigation/index-store";
import { openFolders } from "../navigation/open-folders";
import { useClipboard } from "../paste/clipboard";
import { type Place, setPlace } from "../place";
import { updatePreferences, usePreferences } from "../preferences";
import type { FolderShown } from "./pane-detail";
import { FolderStrip } from "./Strip";
import { useItemDetail } from "./useItemDetail";
import { fitScale, type Size } from "./zoom";

type Ready = Extract<FolderShown, { status: "ready" }>;

const DETAILS_ID = "pane-details";

const placeOf = (detail: FolderDetail): Place & { kind: "folder" } => ({
  kind: "folder",
  sourceId: detail.sourceId,
  path: detail.path,
});

const titleOf = (detail: FolderDetail, source: SourceSummary) =>
  detail.path.at(-1)?.title ?? source.title;

/**
 * A folder's header row: the way into full screen, then its name and its count, opening onto its
 * band's rows. Gone, only the fold is left. Pane › folder.
 */
export function FolderPaneHeader({ shown, into }: { shown: FolderShown; into: ReactNode }) {
  const open = usePreferences().details ?? false;
  if (shown.status !== "ready") return null;
  const { detail, source } = shown;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {into}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={DETAILS_ID}
        onClick={() => updatePreferences({ details: !open })}
        className="focus-ring flex h-control w-full min-w-0 items-center gap-2 rounded-control px-2 text-left text-fg-mid text-ui tabular-nums transition-colors duration-(--motion-quick) hover:bg-wash hover:text-fg aria-expanded:bg-raised aria-expanded:text-fg motion-reduce:transition-none"
      >
        <Glyph
          name="chevronRight"
          className={`text-fg-dim text-icon transition-transform duration-(--motion-quick) ease-out motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 truncate text-fg">{titleOf(detail, source)}</span>
        {source.reachable ? (
          <CountPill own={detail.ownCount} all={detail.allCount} />
        ) : (
          <span className="shrink-0 text-fg-dim text-small">offline</span>
        )}
      </button>
    </div>
  );
}

/**
 * A folder where a file would stand: its band's rows behind the disclosure, its cover in the
 * picture's place, what can be done to it, and a strip of its own files.
 * DECISIONS.md "A folder in the pane".
 */
export function FolderPane({ shown }: { shown: FolderShown }) {
  const open = usePreferences().details ?? false;
  if (shown.status === "gone") {
    return (
      <EmptyState
        glyph="folderDashed"
        title="This Folder Has Gone"
        path={shown.path ?? undefined}
      />
    );
  }
  if (shown.status !== "ready") return null;
  const { detail, source } = shown;
  const place = placeOf(detail);
  const title = titleOf(detail, source);
  let picture: ReactNode;
  if (!source.reachable) {
    picture = (
      <OfflinePlace
        source={source}
        held={{ count: detail.allCount, in: detail.path.length > 1 ? title : undefined }}
      />
    );
  } else if (detail.allCount === 0) {
    picture = <EmptyState glyph="folderDashed" title="This Folder Is Empty" />;
  } else {
    picture = <FolderCover key={detail.coverFileId} detail={detail} title={title} />;
  }
  return (
    <div className="flex h-full flex-col">
      <h2 className="sr-only">{title}</h2>
      <PushDown open={open} className="max-h-1/2 shrink-0">
        <section
          id={DETAILS_ID}
          aria-label="Details"
          className="relative h-full overflow-auto border-line border-b px-3 pt-1.5 pb-3"
        >
          <FolderFacts detail={detail} source={source} />
        </section>
      </PushDown>
      <div className="grid min-h-0 flex-1 p-2">{picture}</div>
      <FolderBar shown={shown} place={place} title={title} />
      {source.reachable && <FolderStrip place={place} />}
    </div>
  );
}

/** The cover at its own shape, as any picture stands, with the band's pencil; it does not zoom. */
function FolderCover({ detail, title }: { detail: FolderDetail; title: string }) {
  const area = useRef<HTMLDivElement>(null);
  const room = useSize(area);
  const cover = useItemDetail(detail.coverFileId);
  const item = cover.status === "ready" ? cover.item : null;
  const [own, setOwn] = useState<Size | null>(null);
  const [drawn, setDrawn] = useState(false);
  let src: string | undefined;
  if (item?.kind === "image") src = convertFileSrc(item.path);
  else if (item?.thumb) src = convertFileSrc(item.thumb);
  const known = item?.width && item.height ? { width: item.width, height: item.height } : null;
  const size = known ?? own;
  const scale = size && room ? fitScale(room, size) : null;
  // The picker opens beside the picture, which names itself for it to anchor to.
  const anchor = `--pane-cover-${detail.id}`;
  const style =
    size && scale !== null
      ? { anchorName: anchor, width: size.width * scale, height: size.height * scale }
      : { anchorName: anchor, position: "absolute", opacity: 0 };
  return (
    <div ref={area} className="relative grid min-h-0 min-w-0 place-items-center">
      {(src || size) && (
        <span
          style={style as CSSProperties}
          className="relative overflow-hidden rounded-control bg-inset"
        >
          {src && (
            <img
              src={src}
              alt={`Cover of ${title}`}
              draggable={false}
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                setOwn({ width, height });
                setDrawn(true);
              }}
              className={`size-full object-cover ${drawn ? "" : "opacity-0"}`}
            />
          )}
          {detail.coverItemId !== null && (
            <Plate look="mark" className="absolute bottom-1.5 left-1.5">
              Cover
            </Plate>
          )}
          <CoverPicker
            folderId={detail.id}
            title={title}
            chosen={detail.coverItemId}
            anchor={anchor}
          />
        </span>
      )}
    </div>
  );
}

/**
 * The folder's menu laid out as a bar, as a file's bar is its tile's: Open, the one worded button,
 * never leaves; Show in Explorer folds into the ⋯ when it does not fit; the ⋯ holds the rest.
 */
function FolderBar({ shown, place, title }: { shown: Ready; place: Place; title: string }) {
  // The menu reads the clipboard and the index each time it is drawn, so the bar follows both.
  useClipboard();
  useIndex();
  const bar = useRef<HTMLDivElement>(null);
  const into = useRef<HTMLButtonElement>(null);
  const { groups } = placeMenu(place, fromFocus);
  const reveal = groups.flat().find((row) => row.id === "reveal");
  const rest = groups.map((group) =>
    group.filter((row) => row.id !== "show-in-pane" && row.id !== "reveal"),
  );
  const roomy = useRoomFor(bar, into, title);
  const more: MenuGroups =
    reveal && !roomy ? [[reveal, ...(rest[0] ?? [])], ...rest.slice(1)] : rest;
  const path = shown.detail.path;

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Actions"
      className="flex h-toolbar shrink-0 items-center gap-1.5 border-line border-t px-1.5"
    >
      <div className="min-w-0">
        <Button
          ref={into}
          glyph="goInto"
          title={`Open ${title}`}
          onClick={() => {
            openFolders(path.slice(0, -1).map((crumb) => crumb.id));
            setPlace(place);
          }}
        >
          Open {title}
        </Button>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {reveal && roomy && (
          <GlyphButton glyph="folderOpen" label={reveal.label} onClick={reveal.onSelect} />
        )}
        {more.some((group) => group.length > 0) && <Menu label="More" glyph="more" groups={more} />}
      </div>
    </div>
  );
}

/**
 * Whether Open's whole label fits beside two glyph squares, Show in Explorer's and the ⋯'s.
 * Measured against the real width, never a width written down.
 */
function useRoomFor(
  bar: RefObject<HTMLElement | null>,
  into: RefObject<HTMLElement | null>,
  label: string,
) {
  const [roomy, setRoomy] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new label is a new width to measure.
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const measure = () => {
      const button = into.current;
      const words = button?.querySelector<HTMLElement>(".truncate");
      const square = element.querySelector('[aria-label="More"]')?.getBoundingClientRect().width;
      if (!button || !words || !square) return;
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const whole = button.offsetWidth + words.scrollWidth - words.clientWidth;
      setRoomy(whole + 2 * (gap + square) <= element.clientWidth - padding);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bar, into, label]);

  return roomy;
}

/** An element's content box, followed through every resize. */
function useSize(element: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const target = element.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [element]);
  return size;
}
