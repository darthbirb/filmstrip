import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { formatDuration, formatElapsed } from "../../lib/format";
import { Glyph } from "../../ui/Glyph";
import type { GlyphName } from "../../ui/glyphs";

const EVENTS = [
  "play",
  "pause",
  "ended",
  "timeupdate",
  "seeked",
  "durationchange",
  "loadedmetadata",
  "volumechange",
  "emptied",
];

/** How far the arrows move the track, in seconds. */
const STEP = 5;

type Playback = { paused: boolean; muted: boolean; time: number; length: number };

function read(video: HTMLVideoElement, known: number): Playback {
  const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : known;
  return { paused: video.paused, muted: video.muted, time: video.currentTime, length };
}

/** What the element is doing, read back from its own events; its length is the index's until it knows. */
function usePlayback(video: HTMLVideoElement, knownMs: number | null) {
  const known = (knownMs ?? 0) / 1000;
  const [state, setState] = useState(() => read(video, known));

  useEffect(() => {
    const update = () => setState(read(video, known));
    for (const name of EVENTS) video.addEventListener(name, update);
    update();
    return () => {
      for (const name of EVENTS) video.removeEventListener(name, update);
    };
  }, [video, known]);

  const refresh = () => setState(read(video, known));
  const seek = (seconds: number) => {
    video.currentTime = Math.min(Math.max(seconds, 0), state.length);
    refresh();
  };
  return { ...state, seek, refresh };
}

type StageProps = {
  src: string;
  poster: string | undefined;
  durationMs: number | null;
  className: string;
  style: CSSProperties;
  /** The window could not play it: the poster stays, and there is nothing to control. */
  failed: boolean;
  onError: () => void;
};

/** A video in the pane, its plate over its own foot, as wide as the picture rather than the pane. */
export function Video({ src, poster, durationMs, className, style, failed, onError }: StageProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const box = useBox(video);
  const near = useNear();

  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: the user's own recordings come with no captions to offer */}
      <video
        ref={setVideo}
        className={className}
        style={style}
        src={src}
        poster={poster}
        preload="metadata"
        onError={onError}
      />
      {video && box && !failed && (
        <div
          className="absolute flex flex-col justify-end p-tile-gap"
          style={box}
          onPointerEnter={near.enter}
          onPointerMove={near.enter}
          onPointerLeave={near.leave}
        >
          <VideoPlate video={video} durationMs={durationMs} near={near.near} />
        </div>
      )}
    </>
  );
}

/** Where the element is drawn inside what holds it, so what sits on the picture sits on it alone. */
function useBox(video: HTMLVideoElement | null) {
  const [box, setBox] = useState<CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!video) return;
    const measure = () =>
      setBox({
        left: video.offsetLeft,
        top: video.offsetTop,
        width: video.offsetWidth,
        height: video.offsetHeight,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(video);
    if (video.parentElement) observer.observe(video.parentElement);
    return () => observer.disconnect();
  }, [video]);

  return box;
}

/** Whether the pointer is on the picture, or left it less than `--linger` ago. */
function useNear() {
  const [near, setNear] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    near,
    enter: () => {
      clearTimeout(timer.current);
      setNear(true);
    },
    leave: () => {
      clearTimeout(timer.current);
      const linger = getComputedStyle(document.documentElement).getPropertyValue("--linger");
      timer.current = setTimeout(() => setNear(false), Number.parseFloat(linger) || 0);
    },
  };
}

type Props = {
  video: HTMLVideoElement;
  /** The length the index read from the file, for before the element has read its own. */
  durationMs: number | null;
  /** The pointer is on the picture; while it plays, the plate is up only then, or with the focus in it. */
  near?: boolean;
};

/**
 * A video's controls, on the one dark glass: play, the track, the time and the mute. As it narrows
 * the total goes first and the mute after it; play, the track and the elapsed never leave. Measured,
 * never a width written down. DECISIONS.md "The pane".
 */
export function VideoPlate({ video, durationMs, near = true }: Props) {
  const playback = usePlayback(video, durationMs);
  const plate = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<number | null>(null);
  const lengthMs = playback.length * 1000;
  const total = formatDuration(lengthMs);
  const shed = useShed(plate, copy);
  const elapsed = formatElapsed((held ?? playback.time) * 1000, lengthMs);

  const toggle = () => {
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
    playback.refresh();
  };
  const mute = () => {
    video.muted = !video.muted;
    playback.refresh();
  };

  const target = (event: PointerEvent<HTMLElement>) => {
    const rule = event.currentTarget.firstElementChild?.getBoundingClientRect();
    if (!rule || rule.width <= 0) return 0;
    const at = Math.min(Math.max((event.clientX - rule.left) / rule.width, 0), 1);
    return at * playback.length;
  };
  const drag = (event: PointerEvent<HTMLElement>) => {
    const seconds = target(event);
    setHeld(seconds);
    playback.seek(seconds);
  };
  const keys: Record<string, () => number> = {
    ArrowLeft: () => playback.time - STEP,
    ArrowDown: () => playback.time - STEP,
    ArrowRight: () => playback.time + STEP,
    ArrowUp: () => playback.time + STEP,
    Home: () => 0,
    End: () => playback.length,
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const to = keys[event.key];
    if (!to || event.ctrlKey || event.altKey || event.metaKey) return;
    event.preventDefault();
    playback.seek(to());
  };

  const position = playback.length > 0 ? ((held ?? playback.time) / playback.length) * 100 : 0;
  const seeking = held !== null;
  const up = playback.paused || near || seeking;

  return (
    <div
      ref={plate}
      role="toolbar"
      aria-label="Playback"
      className={`relative flex h-control items-center gap-tile-gap rounded-control bg-veil px-tile-gap text-in-pane text-small tabular-nums has-focus-visible:opacity-100 ${up ? "" : "opacity-0"}`}
    >
      {/* Each piece as it would be drawn, out of sight and clipped to nothing, so what leaves is measured. */}
      <div
        inert
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden"
      >
        <div ref={copy} className="flex w-max items-center">
          <span data-piece="play" className="text-glyph">
            <Glyph name="pause" />
          </span>
          <span data-piece="track" className="w-6" />
          <span className="whitespace-nowrap">
            <span data-piece="elapsed">{total}</span>
            <span data-piece="total"> / {total}</span>
          </span>
          <span data-piece="mute" className="text-glyph">
            <Glyph name="sound" />
          </span>
        </div>
      </div>
      <PlateGlyph
        glyph={playback.paused ? "play" : "pause"}
        label={playback.paused ? "Play" : "Pause"}
        filled
        onClick={toggle}
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(playback.length)}
        aria-valuenow={Math.round(held ?? playback.time)}
        aria-valuetext={`${elapsed} of ${total}`}
        data-seeking={seeking || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag(event);
        }}
        onPointerMove={(event) => {
          if (held !== null) drag(event);
        }}
        onPointerUp={() => setHeld(null)}
        onPointerCancel={() => setHeld(null)}
        className="group/track focus-ring flex h-full min-w-6 flex-1 items-center rounded-full"
      >
        <span className="relative h-progress w-full rounded-full bg-track group-hover/track:h-1.5 group-focus-visible/track:h-1.5 group-data-seeking/track:h-1.5">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-in-pane"
            style={{ width: `${position}%` }}
          />
          <span
            className="absolute top-1/2 hidden size-2.5 -translate-1/2 rounded-thumb bg-in-pane group-hover/track:block group-focus-visible/track:block group-data-seeking/track:block group-data-seeking/track:h-3.5 group-data-seeking/track:ring-3 group-data-seeking/track:ring-track-ring"
            style={{ left: `${position}%` }}
          />
        </span>
      </div>
      <span className="whitespace-nowrap">
        <span data-time="elapsed">{elapsed}</span>
        {shed < 1 && <span data-time="total"> / {total}</span>}
      </span>
      {shed < 2 && (
        <PlateGlyph
          glyph={playback.muted ? "muted" : "sound"}
          label={playback.muted ? "Unmute" : "Mute"}
          pressed={playback.muted}
          onClick={mute}
        />
      )}
    </div>
  );
}

type GlyphProps = {
  glyph: GlyphName;
  label: string;
  onClick: () => void;
  filled?: boolean;
  pressed?: boolean;
};

/** A bare glyph on the plate, as tall as the plate; full ink when it is the one doing something. */
function PlateGlyph({ glyph, label, onClick, filled = false, pressed }: GlyphProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className={`focus-ring flex h-full shrink-0 items-center rounded-badge text-glyph transition-colors duration-(--motion-quick) motion-reduce:transition-none ${filled ? "text-in-pane" : "text-fg-mid hover:text-fg aria-pressed:text-in-pane"}`}
    >
      <Glyph name={glyph} filled={filled} />
    </button>
  );
}

/** How many of the total and the mute have no room, in that order, against the plate's own width. */
function useShed(plate: RefObject<HTMLElement | null>, copy: RefObject<HTMLElement | null>) {
  const [shed, setShed] = useState(0);

  useLayoutEffect(() => {
    const element = plate.current;
    const drawn = copy.current;
    if (!element || !drawn) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const gap = Number.parseFloat(style.columnGap) || 0;
      const room =
        element.clientWidth -
        (Number.parseFloat(style.paddingLeft) || 0) -
        (Number.parseFloat(style.paddingRight) || 0);
      if (room <= 0) return;
      const width = (piece: string) =>
        drawn.querySelector(`[data-piece="${piece}"]`)?.getBoundingClientRect().width ?? 0;
      const [play, track, elapsed, rest, mute] = ["play", "track", "elapsed", "total", "mute"].map(
        width,
      ) as [number, number, number, number, number];
      const needs = (n: number) =>
        play + gap + track + gap + elapsed + (n < 1 ? rest : 0) + (n < 2 ? gap + mute : 0);
      let n = 0;
      while (n < 2 && needs(n) > room) n += 1;
      setShed(n);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(drawn);
    return () => observer.disconnect();
  }, [plate, copy]);

  return shed;
}
