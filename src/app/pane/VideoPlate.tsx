import {
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { formatDuration, formatElapsed } from "../../lib/format";
import { Dropdown } from "../../ui/Dropdown";
import { Glyph } from "../../ui/Glyph";
import type { GlyphName } from "../../ui/glyphs";
import { getPreferences, updatePreferences, usePreferences } from "../preferences";
import { SPEEDS, type Speed, setSpeed, speedLabel, stepSpeed, useSpeed } from "./speed";

const EVENTS = [
  "play",
  "pause",
  "ended",
  "timeupdate",
  "seeked",
  "durationchange",
  "loadedmetadata",
  "emptied",
];

/** How far the arrows move the track, in seconds. */
const STEP = 5;

/** How far a key or a notch of the wheel moves the volume. */
const NOTCH = 0.1;

const SPEED_OPTIONS = SPEEDS.map((value) => ({ value: String(value), label: speedLabel(value) }));

type Playback = { paused: boolean; time: number; length: number };

function read(video: HTMLVideoElement, known: number): Playback {
  const length = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : known;
  return { paused: video.paused, time: video.currentTime, length };
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

/** Which frame a moment falls in, a hair forgiving of a moment a float puts just before its own. */
function frameAt(seconds: number, frame: number) {
  return Math.floor(seconds / frame + 1e-3);
}

type VideoProps = {
  src: string;
  poster: string | undefined;
  durationMs: number | null;
  /** One frame, in microseconds, from the probe; without it there are no frame steps. */
  frameUs: number | null;
  className: string;
  style: CSSProperties;
  /** The window could not play it: the poster stays, and there is nothing to control. */
  failed: boolean;
  onError: () => void;
};

/** A video in the pane, its plate over its own foot, as wide as the picture rather than the pane. */
export function Video({
  src,
  poster,
  durationMs,
  frameUs,
  className,
  style,
  failed,
  onError,
}: VideoProps) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const box = useBox(video);
  const near = useNear();
  const controlled = video && box && !failed;

  return (
    <>
      {/* biome-ignore lint/a11y/useMediaCaption: the user's own recordings come with no captions to offer */}
      <video
        ref={setVideo}
        className={`${className} focus-ring`}
        style={style}
        src={src}
        poster={poster}
        preload="metadata"
        tabIndex={failed ? undefined : 0}
        onError={onError}
      />
      {controlled && (
        // biome-ignore lint/a11y/noStaticElementInteractions: a press on the picture hands the focus to the video beneath, itself a tab stop
        <div
          className="absolute flex flex-col justify-end p-tile-gap"
          style={box}
          onPointerEnter={near.enter}
          onPointerMove={near.enter}
          onPointerLeave={near.leave}
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            video.focus();
          }}
        >
          <VideoPlate video={video} durationMs={durationMs} frameUs={frameUs} near={near.near} />
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
  /** One frame, in microseconds, from the probe; without it there are no frame steps. */
  frameUs?: number | null;
  /** The pointer is on the picture; while it plays, the plate is up only then, or with the focus in it. */
  near?: boolean;
};

/**
 * A video's controls, on the one dark glass: play, the frame steps, the track, the time, the mute
 * and the speed. As it narrows the speed goes first, then both steps, the total and the mute; play,
 * the track and the elapsed never leave. Measured, never a width written down. DECISIONS.md "The pane".
 */
export function VideoPlate({ video, durationMs, frameUs = null, near = true }: Props) {
  const playback = usePlayback(video, durationMs);
  const speed = useSpeed();
  const { volume = 1, muted = false } = usePreferences();
  const plate = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState<number | null>(null);
  const lengthMs = playback.length * 1000;
  const total = formatDuration(lengthMs);
  const frame = frameUs !== null && frameUs > 0 ? frameUs / 1_000_000 : null;
  const shed = useShed(plate, copy, frame !== null);
  const elapsed = formatElapsed((held ?? playback.time) * 1000, lengthMs);

  useEffect(() => {
    // A new source puts the rate back to the default one, so both hold the speed.
    video.defaultPlaybackRate = speed;
    video.playbackRate = speed;
  }, [video, speed]);
  useEffect(() => {
    video.volume = volume;
    video.muted = muted;
  }, [video, volume, muted]);

  const toggle = () => {
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
    playback.refresh();
  };
  const mute = () => updatePreferences({ muted: !getPreferences().muted });

  const lastFrame = frame ? Math.max(Math.ceil(playback.length / frame - 1e-3) - 1, 0) : 0;
  const atFrame = frame ? frameAt(playback.time, frame) : 0;
  const step = (by: number) => {
    if (!frame) return;
    video.pause();
    const now = frameAt(video.currentTime, frame);
    if (by < 0 ? now <= 0 : now >= lastFrame) playback.refresh();
    else playback.seek((Math.min(Math.max(now + by, 0), lastFrame) + 0.5) * frame);
  };

  const onKeys = (event: KeyboardEvent | globalThis.KeyboardEvent) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const presses: Record<string, () => void> = {
      ",": () => step(-1),
      ".": () => step(1),
      "<": () => stepSpeed(-1),
      ">": () => stepSpeed(1),
      m: mute,
    };
    const press = presses[key];
    if (press) press();
    else if (key === " " && !(event.target as Element).closest("button")) toggle();
    else return;
    event.preventDefault();
  };
  const keys = useRef(onKeys);
  keys.current = onKeys;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => keys.current(event);
    video.addEventListener("keydown", onKey);
    return () => video.removeEventListener("keydown", onKey);
  }, [video]);

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
  const seekKeys: Record<string, () => number> = {
    ArrowLeft: () => playback.time - STEP,
    ArrowDown: () => playback.time - STEP,
    ArrowRight: () => playback.time + STEP,
    ArrowUp: () => playback.time + STEP,
    Home: () => 0,
    End: () => playback.length,
  };
  const onSeekKeyDown = (event: KeyboardEvent) => {
    const to = seekKeys[event.key];
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
      onKeyDown={onKeys}
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
          {frame !== null && (
            <>
              <span data-piece="back" className="text-glyph">
                <Glyph name="frameBack" />
              </span>
              <span data-piece="forward" className="text-glyph">
                <Glyph name="frameForward" />
              </span>
            </>
          )}
          <span data-piece="track" className="w-6" />
          <span className="whitespace-nowrap">
            <span data-piece="elapsed">{total}</span>
            <span data-piece="total"> / {total}</span>
          </span>
          <span data-piece="mute" className="text-glyph">
            <Glyph name="sound" />
          </span>
          <span data-piece="speed">{speedLabel(1.5)}</span>
        </div>
      </div>
      <PlateGlyph
        glyph={playback.paused ? "play" : "pause"}
        label={playback.paused ? "Play" : "Pause"}
        filled
        onClick={toggle}
      />
      {frame !== null && shed < 2 && (
        <>
          <PlateGlyph
            glyph="frameBack"
            label="Previous Frame"
            keys=","
            disabled={atFrame <= 0}
            onClick={() => step(-1)}
          />
          <PlateGlyph
            glyph="frameForward"
            label="Next Frame"
            keys="."
            disabled={atFrame >= lastFrame}
            onClick={() => step(1)}
          />
        </>
      )}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(playback.length)}
        aria-valuenow={Math.round(held ?? playback.time)}
        aria-valuetext={`${elapsed} of ${total}`}
        data-seeking={seeking || undefined}
        onKeyDown={onSeekKeyDown}
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
        {shed < 3 && <span data-time="total"> / {total}</span>}
      </span>
      {shed < 4 && <Volume volume={volume} muted={muted} onMute={mute} />}
      {shed < 1 && (
        <Dropdown
          label="Speed"
          options={SPEED_OPTIONS}
          value={String(speed)}
          onChange={(value) => setSpeed(Number(value) as Speed)}
          plate={{ active: speed !== 1 }}
        />
      )}
    </div>
  );
}

type VolumeProps = { volume: number; muted: boolean; onMute: () => void };

/** The mute, with the level rising over it under the pointer or the focus; setting it unmutes. */
function Volume({ volume, muted, onMute }: VolumeProps) {
  const holder = useRef<HTMLSpanElement>(null);
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const [held, setHeld] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (pointer || focus || held) && !dismissed;

  useEffect(() => {
    const element = holder.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      nudge(event.deltaY < 0 ? 1 : -1);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const level = (event: PointerEvent<HTMLElement>) => {
    const rule = event.currentTarget.querySelector("[data-rule]")?.getBoundingClientRect();
    if (!rule || rule.height <= 0) return;
    setLevel(1 - (event.clientY - rule.top) / rule.height);
  };
  const close = () => {
    setPointer(false);
    setDismissed(false);
  };
  const percent = `${volume * 100}%`;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the mute inside is the control; this holds its level for the pointer and the wheel
    <span
      ref={holder}
      className="relative flex h-full shrink-0"
      onPointerEnter={() => setPointer(true)}
      onPointerLeave={close}
      onFocus={(event) => setFocus(event.target.matches(":focus-visible"))}
      onBlur={(event: FocusEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setFocus(false);
        setDismissed(false);
      }}
      onKeyDown={(event) => {
        const by = { ArrowUp: 1, ArrowDown: -1 }[event.key];
        if (by !== undefined) {
          event.preventDefault();
          nudge(by);
        } else if (event.key === "Escape" && open) {
          event.stopPropagation();
          setDismissed(true);
        }
      }}
    >
      <PlateGlyph
        glyph={muted ? "muted" : "sound"}
        label={muted ? "Unmute" : "Mute"}
        pressed={muted}
        keys="M"
        onClick={onMute}
      />
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 pb-1">
          <span
            role="slider"
            tabIndex={-1}
            aria-label="Volume"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(volume * 100)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              setHeld(true);
              level(event);
            }}
            onPointerMove={(event) => {
              if (held) level(event);
            }}
            onPointerUp={() => setHeld(false)}
            onPointerCancel={() => setHeld(false)}
            className="flex h-volume w-control justify-center rounded-control bg-raised p-1 shadow-overlay inset-ring inset-ring-line-control-hi"
          >
            <span className="flex justify-center py-1.25">
              <span data-rule className="relative h-full w-1.5 rounded-full bg-track">
                <span
                  className="absolute inset-x-0 bottom-0 rounded-full bg-in-pane"
                  style={{ height: percent }}
                />
                <span
                  className="absolute left-1/2 size-2.5 -translate-x-1/2 translate-y-1/2 rounded-thumb bg-in-pane"
                  style={{ bottom: percent }}
                />
              </span>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}

/** A level from 0 to 1, which also unmutes. */
function setLevel(value: number) {
  updatePreferences({ volume: Math.min(Math.max(value, 0), 1), muted: false });
}

/** The level a notch up or down, on the tenths. */
function nudge(by: number) {
  const now = getPreferences().volume ?? 1;
  setLevel(Math.round((now + by * NOTCH) * 10) / 10);
}

type GlyphProps = {
  glyph: GlyphName;
  label: string;
  onClick: () => void;
  filled?: boolean;
  pressed?: boolean;
  /** At the end of what it does: drawn faint, and a press does nothing. */
  disabled?: boolean;
  keys?: string;
};

/** A bare glyph on the plate, as tall as the plate; full ink when it is the one doing something. */
function PlateGlyph({
  glyph,
  label,
  onClick,
  filled = false,
  pressed,
  disabled,
  keys,
}: GlyphProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      aria-keyshortcuts={keys}
      title={label}
      onClick={disabled ? undefined : onClick}
      className={`focus-ring flex h-full shrink-0 items-center rounded-badge text-glyph transition-colors duration-(--motion-quick) motion-reduce:transition-none ${filled ? "text-in-pane" : disabled ? "text-fg-faint" : "text-fg-mid hover:text-fg aria-pressed:text-in-pane"}`}
    >
      <Glyph name={glyph} filled={filled} />
    </button>
  );
}

/**
 * How many of the speed, the steps, the total and the mute have no room, in that order, against the
 * plate's own width. The steps count only when the clip has them.
 */
function useShed(
  plate: RefObject<HTMLElement | null>,
  copy: RefObject<HTMLElement | null>,
  steps: boolean,
) {
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
      const [play, back, forward, track, elapsed, rest, mute, speed] = [
        "play",
        "back",
        "forward",
        "track",
        "elapsed",
        "total",
        "mute",
        "speed",
      ].map(width) as [number, number, number, number, number, number, number, number];
      const needs = (n: number) =>
        play +
        gap +
        (steps && n < 2 ? back + gap + forward + gap : 0) +
        track +
        gap +
        elapsed +
        (n < 3 ? rest : 0) +
        (n < 4 ? gap + mute : 0) +
        (n < 1 ? gap + speed : 0);
      let n = 0;
      while (n < 4 && needs(n) > room) n += 1;
      setShed(n);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(drawn);
    return () => observer.disconnect();
  }, [plate, copy, steps]);

  return shed;
}
