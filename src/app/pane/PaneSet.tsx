import { convertFileSrc } from "@tauri-apps/api/core";
import {
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ItemDetail } from "../../ipc/bindings/ItemDetail";
import { BadgeButton } from "../../ui/BadgeButton";
import { useContextMenu } from "../../ui/Menu";
import { dragging } from "../grid/drag";
import { getSelection } from "../grid/selection";
import { itemMenu } from "../menus/item-menu";
import { getFullScreen } from "./full-screen";
import { focusNextPicture } from "./Media";
import { leavePane, paneFileOrigin, paneSetPlaying, showInPane } from "./pane-store";
import { arrange, type Least, layOutSet, type Placed } from "./set-layout";
import type { Size } from "./zoom";

const NONE: Size = { width: 0, height: 0 };

type Room = { area: Size; gap: number; least: Least };

/**
 * Several files at one scale, in the rows that draw them largest, each with its × and a video's
 * mute. One tab stop: the arrows move between them, Enter shows one alone.
 * DECISIONS.md "Several files in the pane".
 */
export function PaneSet({ items }: { items: readonly ItemDetail[] }) {
  const area = useRef<HTMLDivElement>(null);
  const probes = {
    gap: useRef<HTMLSpanElement>(null),
    short: useRef<HTMLSpanElement>(null),
    long: useRef<HTMLSpanElement>(null),
  };
  const room = useRoom(area, probes.gap, probes.short, probes.long);
  // A file's own pixels once it is drawn, for one the index does not know the shape of.
  const [own, setOwn] = useState<ReadonlyMap<number, Size>>(new Map());
  // The one clip playing aloud; every other is muted.
  const [voiced, setVoiced] = useState<number | null>(null);
  const [ringed, setRinged] = useState<number | null>(null);
  const focusing = useRef<number | null>(null);
  const context = useContextMenu();

  const sizes = items.map((item) => own.get(item.id) ?? known(item) ?? NONE);
  const shapes = sizes.map((size) => `${size.width}x${size.height}`).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the shapes string stands for the sizes it is made from
  const layout = useMemo(() => layOutSet(sizes, room.area, room.gap, room.least), [shapes, room]);
  const ring = items.some((item) => item.id === ringed) ? ringed : (items[0]?.id ?? null);
  const playing = playingClips(items, voiced);

  useLayoutEffect(() => {
    const id = focusing.current;
    if (id === null) return;
    focusing.current = null;
    area.current?.querySelector<HTMLElement>(`[data-file="${id}"]`)?.focus();
  });

  useEscapeShowsFirst(items[0]?.id ?? null);

  const show = (item: ItemDetail) => {
    focusNextPicture();
    showInPane(item.id, paneFileOrigin(item.id));
  };
  const move = (to: number) => {
    const next = items[Math.min(Math.max(to, 0), items.length - 1)];
    if (!next) return;
    setRinged(next.id);
    focusing.current = next.id;
  };
  const remove = (item: ItemDetail) => {
    const at = items.findIndex((one) => one.id === item.id);
    const next = items[at + 1] ?? items[at - 1];
    if (items.length <= 2) focusNextPicture();
    else if (next) {
      setRinged(next.id);
      focusing.current = next.id;
    }
    if (voiced === item.id) setVoiced(null);
    leavePane([item.id]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, at: number) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const moves: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowDown: at + 1,
      ArrowLeft: at - 1,
      ArrowUp: at - 1,
      Home: 0,
      End: items.length - 1,
    };
    const to = moves[event.key];
    if (to === undefined) return;
    event.preventDefault();
    move(to);
  };

  const placing = arrange(layout, room.area, room.gap);

  return (
    // biome-ignore lint/a11y/useSemanticElements: files laid out together are a group, not a form's fieldset
    <div
      ref={area}
      role="group"
      aria-label={`${items.length} Files`}
      className="relative min-h-0 min-w-0 flex-1 overflow-auto"
    >
      <span aria-hidden="true" className="invisible absolute top-0 left-0 h-0">
        <span ref={probes.gap} className="absolute w-tile-gap" />
        <span ref={probes.short} className="absolute w-pane-set-least" />
        <span ref={probes.long} className="absolute w-pane-set-least-long" />
      </span>
      {context.menu}
      <div className="relative" style={{ height: placing.height }}>
        {items.map((item, at) => {
          const placed = layout.files[at];
          const spot = placing.at[at];
          if (!placed || !spot) return null;
          return (
            <SetFile
              key={item.id}
              item={item}
              placed={placed}
              left={spot.left}
              top={spot.top}
              stop={item.id === ring}
              voiced={voiced === item.id}
              playing={playing.has(item.id)}
              onShow={() => show(item)}
              onRemove={() => remove(item)}
              onVoice={() => setVoiced(voiced === item.id ? null : item.id)}
              onFocus={() => setRinged(item.id)}
              onKeyDown={(event) => onKeyDown(event, at)}
              onContextMenu={(event) =>
                context.open(event, item.diskName, [
                  [
                    {
                      id: "remove-from-pane",
                      label: "Remove from Pane",
                      glyph: "close",
                      onSelect: () => remove(item),
                    },
                  ],
                  ...itemMenu(item, () => show(item)),
                ])
              }
              onOwn={(size) =>
                setOwn((held) =>
                  sameSize(held.get(item.id), size) ? held : new Map([...held, [item.id, size]]),
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}

type FileProps = {
  item: ItemDetail;
  placed: Placed;
  left: number;
  top: number;
  /** The set's one tab stop. */
  stop: boolean;
  /** This clip has the sound. */
  voiced: boolean;
  /** This clip is one of those that play; the rest hold still. */
  playing: boolean;
  onShow: () => void;
  onRemove: () => void;
  onVoice: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onOwn: (size: Size) => void;
};

/** One file of the set: its original at the set's scale, centred in its band, and what sits on it. */
function SetFile(props: FileProps) {
  const { item, placed, left, top, stop, voiced, playing, onShow, onRemove, onVoice, onFocus } =
    props;
  const { onKeyDown, onContextMenu, onOwn } = props;
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const video = useRef<HTMLVideoElement>(null);
  const thumb = item.thumb ? convertFileSrc(item.thumb) : undefined;
  const tab = stop ? 0 : -1;

  useEffect(() => {
    if (video.current) video.current.muted = !voiced;
  }, [voiced]);

  useEffect(() => {
    const clip = video.current;
    if (!clip) return;
    if (playing) void clip.play().catch(() => undefined);
    else clip.pause();
  }, [playing]);

  return (
    <div
      className="group/file absolute flex items-center justify-center"
      style={{ left, top, width: placed.box.width, height: placed.box.height }}
    >
      <button
        type="button"
        aria-label={item.diskName}
        title={item.diskName}
        data-file={item.id}
        tabIndex={tab}
        onClick={onShow}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        className="focus-ring relative block shrink-0 rounded-control"
        style={{ width: placed.drawn.width, height: placed.drawn.height }}
      >
        {state === "failed" && !thumb ? (
          <StandIn ext={item.ext} />
        ) : item.kind === "video" ? (
          <video
            ref={video}
            className="block size-full rounded-control object-cover"
            src={convertFileSrc(item.path)}
            poster={thumb}
            preload="auto"
            loop
            muted
            playsInline
            onLoadedMetadata={(event) => {
              const { videoWidth: width, videoHeight: height } = event.currentTarget;
              if (width && height) onOwn({ width, height });
              setState("shown");
            }}
            onError={() => setState("failed")}
          />
        ) : item.kind === "image" ? (
          <>
            {thumb && state === "failed" && (
              <img
                className="absolute inset-0 size-full rounded-control object-contain"
                src={thumb}
                alt=""
                draggable={false}
              />
            )}
            <img
              className={`block size-full rounded-control ${state === "shown" ? "" : "opacity-0"}`}
              src={convertFileSrc(item.path)}
              alt={item.diskName}
              decoding="async"
              draggable={false}
              onLoad={(event) => {
                const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
                if (width && height) onOwn({ width, height });
                setState("shown");
              }}
              onError={() => setState("failed")}
            />
          </>
        ) : (
          <StandIn ext={item.ext} />
        )}
      </button>
      <BadgeButton
        glyph="close"
        label="Remove from Pane"
        tabIndex={tab}
        onClick={onRemove}
        className="absolute top-tile-inset right-tile-inset opacity-0 focus-visible:opacity-100 group-hover/file:opacity-100 group-has-focus-visible/file:opacity-100"
      />
      {item.kind === "video" && state !== "failed" && (
        <BadgeButton
          glyph={voiced ? "sound" : "muted"}
          label={voiced ? "Mute" : "Unmute"}
          pressed={!voiced}
          tabIndex={tab}
          onClick={onVoice}
          className="absolute bottom-tile-inset left-tile-inset"
        />
      )}
    </div>
  );
}

/** What is drawn for a file with nothing to draw: its extension on the hatch. */
export function StandIn({ ext }: { ext: string }) {
  return (
    <span className="hatch grid size-full place-items-center rounded-control text-fg-dim text-small">
      {ext.toUpperCase() || "File"}
    </span>
  );
}

/** The area's size and the tokens the layout turns on, in pixels, followed through every resize. */
function useRoom(
  area: RefObject<HTMLElement | null>,
  gap: RefObject<HTMLElement | null>,
  short: RefObject<HTMLElement | null>,
  long: RefObject<HTMLElement | null>,
): Room {
  const [room, setRoom] = useState<Room>({ area: NONE, gap: 0, least: { short: 0, long: 0 } });

  useLayoutEffect(() => {
    const box = area.current;
    if (!box) return;
    const width = (probe: RefObject<HTMLElement | null>) =>
      probe.current?.getBoundingClientRect().width ?? 0;
    const measure = () => {
      const next = {
        area: { width: box.clientWidth, height: box.clientHeight },
        gap: width(gap),
        least: { short: width(short), long: width(long) },
      };
      setRoom((held) => (JSON.stringify(held) === JSON.stringify(next) ? held : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    for (const probe of [gap, short, long]) if (probe.current) observer.observe(probe.current);
    return () => observer.disconnect();
  }, [area, gap, short, long]);

  return room;
}

/**
 * Escape with the focus in the pane shows the first file alone, once nothing else is left to
 * close: a menu, a drag, full screen, the pane open over the grid and a checked set all take it
 * first, whichever order their listeners were added in.
 */
function useEscapeShowsFirst(first: number | null) {
  useEffect(() => {
    if (first === null) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const pane = document.activeElement?.closest<HTMLElement>('[aria-label="Pane"]');
      if (!pane || pane.dataset.overGrid !== undefined) return;
      if (getFullScreen() || dragging() || getSelection().ids.length > 0) return;
      event.preventDefault();
      focusNextPicture();
      showInPane(first, paneFileOrigin(first));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [first]);
}

/**
 * The clips that play: the one with the sound, then the rest in the order added, up to
 * `pane-set-playing`. DECISIONS.md "Several files in the pane".
 */
function playingClips(items: readonly ItemDetail[], voiced: number | null) {
  const clips = items.filter((item) => item.kind === "video").map((item) => item.id);
  const first = voiced !== null && clips.includes(voiced) ? [voiced] : [];
  const rest = clips.filter((id) => id !== voiced);
  return new Set([...first, ...rest].slice(0, paneSetPlaying()));
}

function known(item: ItemDetail): Size | null {
  return item.width && item.height ? { width: item.width, height: item.height } : null;
}

function sameSize(a: Size | undefined, b: Size) {
  return a?.width === b.width && a.height === b.height;
}
