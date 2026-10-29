import { useState } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { getPreferences, updatePreferences } from "../preferences";
import { getSpeed, setSpeed } from "./speed";
import { Video, VideoPlate } from "./VideoPlate";

const LENGTH = 72_000;
/** One frame at 25 a second. */
const FRAME = 40_000;

let clips: string[] = [];
beforeEach(() => {
  updatePreferences({ volume: 1, muted: false });
  setSpeed(1);
});
afterEach(() => {
  for (const clip of clips) URL.revokeObjectURL(clip);
  clips = [];
});

/** The plate alone at a width, over an element with nothing loaded. */
function Bare({ width, frameUs = null }: { width: number; frameUs?: number | null }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  return (
    <div style={{ width }}>
      {/* biome-ignore lint/a11y/useMediaCaption: a test's element, never shown */}
      <video ref={setVideo} />
      {video && <VideoPlate video={video} durationMs={LENGTH} frameUs={frameUs} />}
    </div>
  );
}

async function renderPlate(width: number, frameUs: number | null = null) {
  await page.viewport(1000, 700);
  const screen = await render(<Bare width={width} frameUs={frameUs} />);
  const plate = screen.getByRole("toolbar", { name: "Playback" });
  await expect.element(plate).toBeVisible();
  // Every width below is the faces' own, not a fallback's.
  await document.fonts.load('12px "IBM Plex Sans"', "0:00 / 1:12 1.5×");
  await document.fonts.ready;
  return { screen, plate: plate.element() as HTMLElement };
}

/** What the plate shows, ignoring the copy it measures with, which holds no control. */
function showing(plate: HTMLElement) {
  const shown = (selector: string) => plate.querySelector(selector) !== null;
  return {
    play: shown("button[aria-label='Play']"),
    back: shown("button[aria-label='Previous Frame']"),
    forward: shown("button[aria-label='Next Frame']"),
    track: shown("[role='slider'][aria-label='Seek']"),
    elapsed: shown("[data-time='elapsed']"),
    total: shown("[data-time='total']"),
    mute: shown("button[aria-label='Mute']"),
    speed: shown("button[aria-haspopup='listbox']"),
  };
}

const box = (element: Element | null) => element?.getBoundingClientRect().width ?? 0;

test("every glyph on the plate is drawn at the scale's one glyph size", async () => {
  const { plate } = await renderPlate(480, FRAME);
  const root = getComputedStyle(document.documentElement);
  const glyph = Number.parseFloat(root.getPropertyValue("--text-glyph")) * 16;

  const glyphs = [...plate.querySelectorAll("button .glyph")];
  expect(glyphs).toHaveLength(4);
  for (const element of glyphs) {
    expect(getComputedStyle(element).fontSize).toBe(`${glyph}px`);
  }
  const [play, back, forward, mute] = glyphs as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
  // Play is told apart by being the one filled and in white, not by a size of its own.
  expect(play.classList.contains("glyph-fill")).toBe(true);
  expect(getComputedStyle(play).color).toBe("rgb(242, 242, 242)");
  expect(back.dataset.icon).toBe("caret-line-left");
  expect(forward.dataset.icon).toBe("caret-line-right");
  // At the first frame there is nowhere back to go, so that step is faint.
  expect(getComputedStyle(back).color).toBe("rgb(92, 90, 86)");
  expect(getComputedStyle(forward).color).toBe("rgb(168, 165, 160)");
  expect(mute.classList.contains("glyph-fill")).toBe(false);
  expect(getComputedStyle(mute).color).toBe("rgb(168, 165, 160)");
});

test("as the plate narrows the speed leaves first, then both steps, the total and the mute, and play, the track and the elapsed never do", async () => {
  const { screen, plate } = await renderPlate(560, FRAME);
  expect(showing(plate)).toEqual({
    play: true,
    back: true,
    forward: true,
    track: true,
    elapsed: true,
    total: true,
    mute: true,
    speed: true,
  });
  expect(plate.textContent).toContain("0:00 / 1:12");

  // What each piece takes, read from the plate while everything is on it.
  const style = getComputedStyle(plate);
  const gap = Number.parseFloat(style.columnGap);
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const slider = plate.querySelector("[aria-label='Seek']") as HTMLElement;
  const track = Number.parseFloat(getComputedStyle(slider).minWidth);
  expect(track).toBe(24);
  const play = box(plate.querySelector("button[aria-label='Play']"));
  const back = box(plate.querySelector("button[aria-label='Previous Frame']"));
  const forward = box(plate.querySelector("button[aria-label='Next Frame']"));
  const elapsed = box(plate.querySelector("[data-time='elapsed']"));
  const total = box(plate.querySelector("[data-time='total']"));
  const mute = box(plate.querySelector("button[aria-label='Mute']"));
  // The figure's room is its widest speed's, so choosing one never shuffles the plate.
  const speed = box(plate.querySelector("[data-piece='speed']"));
  const bare = padding + play + gap + track + gap + elapsed;
  const withMute = bare + gap + mute;
  const withTotal = withMute + total;
  const withSteps = withTotal + back + gap + forward + gap;
  const everything = withSteps + gap + speed;

  const container = plate.parentElement as HTMLElement;
  for (let width = 560; width >= 80; width -= 2) {
    container.style.width = `${width}px`;
    const expected = {
      width,
      speed: width >= everything,
      steps: width >= withSteps,
      total: width >= withTotal,
      mute: width >= withMute,
    };
    await expect
      .poll(() => {
        const now = showing(plate);
        return { width, speed: now.speed, steps: now.back, total: now.total, mute: now.mute };
      })
      .toEqual(expected);
    const now = showing(plate);
    expect(now.back, `both steps go together at ${width}px`).toBe(now.forward);
    expect(now.play && now.track && now.elapsed, `at ${width}px`).toBe(true);
    // Whatever is still on the plate fits it, the track at no less than its least.
    if (width >= bare) {
      expect(box(slider), `the track at ${width}px`).toBeGreaterThanOrEqual(track - 0.5);
      const right = Math.max(
        ...[...plate.children].map((child) => child.getBoundingClientRect().right),
      );
      const end = plate.getBoundingClientRect().right - Number.parseFloat(style.paddingRight);
      expect(right, `at ${width}px`).toBeLessThanOrEqual(end + 0.5);
    }
  }
  await screen.unmount();
});

test("a clip with no frame rate has no steps, and their keys do nothing", async () => {
  const { plate } = await renderPlate(560);
  const video = document.querySelector("video") as HTMLVideoElement;
  expect(showing(plate)).toMatchObject({ back: false, forward: false, speed: true });

  (plate.querySelector("[aria-label='Seek']") as HTMLElement).focus();
  await userEvent.keyboard(".");
  await userEvent.keyboard(",");
  expect(video.currentTime).toBe(0);
});

test("a step moves one frame of the probe's length, and at either end that step does nothing", async () => {
  const { screen } = await renderPlate(560, FRAME);
  const video = document.querySelector("video") as HTMLVideoElement;
  const back = screen.getByRole("button", { name: "Previous Frame" });
  const forward = screen.getByRole("button", { name: "Next Frame" });
  await expect.element(back).toHaveAttribute("aria-disabled", "true");
  await expect.element(back).toHaveAttribute("aria-keyshortcuts", ",");
  await expect.element(forward).toHaveAttribute("aria-keyshortcuts", ".");

  // Faint is still a control the pointer can press; the press does nothing.
  (back.element() as HTMLElement).click();
  expect(video.currentTime).toBe(0);
  await forward.click();
  // Into the middle of the next frame, so the picture shown is that frame and no other.
  expect(video.currentTime).toBeCloseTo(0.06, 6);
  await expect.element(back).not.toHaveAttribute("aria-disabled");

  await userEvent.keyboard("..");
  expect(video.currentTime).toBeCloseTo(0.14, 6);
  await userEvent.keyboard(",");
  expect(video.currentTime).toBeCloseTo(0.1, 6);

  video.currentTime = 72;
  (forward.element() as HTMLElement).click();
  await expect.element(forward).toHaveAttribute("aria-disabled", "true");
  expect(video.currentTime).toBe(72);
  await back.click();
  expect(video.currentTime).toBeCloseTo(71.98, 6);
});

test("the speed opens the four upward over the figure, and the choice holds from video to video", async () => {
  const { screen, plate } = await renderPlate(560, FRAME);
  const video = document.querySelector("video") as HTMLVideoElement;
  const figure = screen.getByRole("button", { name: "Speed: 1×" });
  await expect.element(figure).toHaveAttribute("title", "Speed");
  expect(getComputedStyle(figure.element()).color).toBe("rgb(168, 165, 160)");

  await figure.click();
  const list = screen.getByRole("listbox", { name: "Speed" });
  await expect.element(list).toBeVisible();
  expect(
    screen
      .getByRole("option")
      .elements()
      .map((option) => option.textContent),
  ).toEqual(["0.5×", "1×", "1.5×", "2×"]);
  await expect.element(screen.getByRole("option", { name: "1×" })).toHaveFocus();
  const menu = (list.element().parentElement as HTMLElement).getBoundingClientRect();
  const drawn = plate.getBoundingClientRect();
  expect(menu.bottom).toBeLessThanOrEqual(drawn.top);
  expect(menu.right).toBeCloseTo(drawn.right, 0);

  await userEvent.keyboard("{ArrowDown}{Enter}");
  const chosen = screen.getByRole("button", { name: "Speed: 1.5×" });
  await expect.element(chosen).toHaveFocus();
  expect(video.playbackRate).toBe(1.5);
  expect(video.defaultPlaybackRate).toBe(1.5);
  await expect.poll(() => getComputedStyle(chosen.element()).color).toBe("rgb(242, 242, 242)");
  await screen.unmount();

  const next = await renderPlate(560, FRAME);
  const another = document.querySelector("video") as HTMLVideoElement;
  await expect.element(next.screen.getByRole("button", { name: "Speed: 1.5×" })).toBeVisible();
  expect(another.playbackRate).toBe(1.5);
});

test("the speed keys go along the four and stop at either end", async () => {
  const { plate } = await renderPlate(560, FRAME);
  const video = document.querySelector("video") as HTMLVideoElement;
  (plate.querySelector("[aria-label='Seek']") as HTMLElement).focus();

  await userEvent.keyboard(">");
  expect(getSpeed()).toBe(1.5);
  await userEvent.keyboard(">>");
  expect(getSpeed()).toBe(2);
  await expect.poll(() => video.playbackRate).toBe(2);
  await userEvent.keyboard("<<<<<");
  expect(getSpeed()).toBe(0.5);
  await expect.poll(() => video.playbackRate).toBe(0.5);
});

test("the track seeks: a press goes where it lands, and the keys step and go to either end", async () => {
  const { screen } = await renderPlate(400);
  const video = document.querySelector("video") as HTMLVideoElement;
  const slider = screen.getByRole("slider", { name: "Seek" });
  const rule = (slider.element().firstElementChild as HTMLElement).getBoundingClientRect();
  const frame = slider.element().getBoundingClientRect();

  await userEvent.click(slider, {
    position: { x: rule.left - frame.left + rule.width / 4, y: frame.height / 2 },
  });
  await expect.poll(() => video.currentTime).toBeCloseTo(18, 0);
  await expect
    .element(slider)
    .toHaveAttribute("aria-valuetext", expect.stringMatching(/^0:1[78] of 1:12$/));

  await userEvent.keyboard("{End}");
  expect(video.currentTime).toBe(72);
  await expect.element(slider).toHaveAttribute("aria-valuenow", "72");
  await userEvent.keyboard("{ArrowLeft}");
  expect(video.currentTime).toBe(67);
  await userEvent.keyboard("{Home}");
  expect(video.currentTime).toBe(0);
  await expect.element(screen.getByText("0:00")).toBeVisible();
});

test("the mute silences the clip and comes to full ink while it does", async () => {
  const { screen } = await renderPlate(400);
  const video = document.querySelector("video") as HTMLVideoElement;
  await screen.getByRole("button", { name: "Mute" }).click();

  await expect.poll(() => video.muted).toBe(true);
  expect(getPreferences().muted).toBe(true);
  const unmute = screen.getByRole("button", { name: "Unmute" });
  await expect.element(unmute).toHaveAttribute("aria-pressed", "true");
  const glyph = unmute.element().querySelector(".glyph") as HTMLElement;
  expect(glyph.dataset.icon).toBe("speaker-slash");
  await expect.poll(() => getComputedStyle(glyph).color).toBe("rgb(242, 242, 242)");

  await userEvent.keyboard("m");
  await expect.element(screen.getByRole("button", { name: "Mute" })).toBeVisible();
  expect(video.muted).toBe(false);
});

test("the volume rises over the mute, and setting it unmutes; both hold from video to video", async () => {
  const { screen } = await renderPlate(560, FRAME);
  const video = document.querySelector("video") as HTMLVideoElement;
  const level = screen.getByRole("slider", { name: "Volume" });
  await expect.element(level).not.toBeInTheDocument();

  await screen.getByRole("button", { name: "Mute" }).click();
  await expect.element(level).toBeVisible();
  const mute = screen.getByRole("button", { name: "Unmute" }).element().getBoundingClientRect();
  const column = level.element().getBoundingClientRect();
  expect(column.bottom).toBeLessThanOrEqual(mute.top);
  expect((column.left + column.right) / 2).toBeCloseTo((mute.left + mute.right) / 2, 0);
  const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  expect(column.height).toBeCloseTo(8.875 * root, 0);

  // Muted, the column still reads the level an unmute returns to.
  await expect.element(level).toHaveAttribute("aria-valuenow", "100");
  const rule = level.element().querySelector("[data-rule]")?.getBoundingClientRect() as DOMRect;
  await userEvent.click(level, {
    position: { x: column.width / 2, y: rule.top - column.top + rule.height / 2 },
  });
  await expect.poll(() => video.volume).toBeCloseTo(0.5, 1);
  expect(video.muted).toBe(false);
  expect(getPreferences()).toMatchObject({ muted: false });

  updatePreferences({ volume: 0.5 });
  const glyph = screen.getByRole("button", { name: "Mute" });
  glyph.element().dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
  await expect.poll(() => video.volume).toBeCloseTo(0.6, 6);

  (glyph.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  await expect.poll(() => video.volume).toBeCloseTo(0.3, 6);
  await userEvent.keyboard("m");
  await expect.poll(() => video.muted).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.element(level).not.toBeInTheDocument();
  await screen.unmount();

  const next = await renderPlate(560, FRAME);
  const another = document.querySelector("video") as HTMLVideoElement;
  await expect.element(next.screen.getByRole("button", { name: "Unmute" })).toBeVisible();
  expect(another.muted).toBe(true);
  expect(another.volume).toBeCloseTo(0.3, 6);
});

test("the volume goes once the pointer leaves, though a click left the focus on the mute; the keyboard's focus raises it", async () => {
  const { screen, plate } = await renderPlate(560, FRAME);
  const level = screen.getByRole("slider", { name: "Volume" });
  const mute = screen.getByRole("button", { name: "Mute" });
  await mute.click();
  await screen.getByRole("button", { name: "Unmute" }).click();
  await expect.element(mute).toHaveFocus();
  await expect.element(level).toBeVisible();

  await userEvent.hover(screen.getByRole("button", { name: "Play" }));
  await expect.element(level).not.toBeInTheDocument();

  (plate.querySelector("[aria-label='Seek']") as HTMLElement).focus();
  await userEvent.keyboard("{Tab}");
  await expect.element(mute).toHaveFocus();
  await expect.element(level).toBeVisible();
  await expect.element(mute).toHaveAttribute("aria-keyshortcuts", "M");
});

/** A short clip the browser can play, drawn here rather than kept as a file. */
async function recordClip() {
  // Under load the recorder can stop before the encoder has written a frame, leaving a header alone.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const clip = URL.createObjectURL(await record());
    if (await opens(clip)) {
      clips.push(clip);
      return clip;
    }
    URL.revokeObjectURL(clip);
  }
  throw new Error("the browser recorded no clip it could open");
}

function opens(clip: string) {
  const probe = document.createElement("video");
  return new Promise<boolean>((resolve) => {
    probe.onloadeddata = () => resolve(true);
    probe.onerror = () => resolve(false);
    probe.preload = "auto";
    probe.src = clip;
  }).finally(() => {
    probe.removeAttribute("src");
    probe.load();
  });
}

async function record() {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas");
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  let frame = 0;
  const draw = setInterval(() => {
    frame += 1;
    context.fillStyle = `hsl(${(frame * 24) % 360} 50% 50%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, 33);
  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, 800));
  recorder.stop();
  await stopped;
  clearInterval(draw);
  return new Blob(chunks, { type: "video/webm" });
}

function Stage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <div
        style={{ width: 480, height: 400 }}
        className="relative flex items-center justify-center"
      >
        <Video
          src={src}
          poster={undefined}
          durationMs={1_000}
          frameUs={33_333}
          className="max-h-full w-full max-w-full"
          style={{ aspectRatio: 16 / 9 }}
          failed={failed}
          onError={() => setFailed(true)}
        />
      </div>
      <p>Elsewhere</p>
    </>
  );
}

test("on the picture, the plate sits across its foot, and while it plays it goes when the pointer does", async () => {
  await page.viewport(1000, 700);
  const clip = await recordClip();
  const screen = await render(<Stage src={clip} />);
  const video = document.querySelector("video") as HTMLVideoElement;
  expect(video.controls).toBe(false);
  const plate = screen.getByRole("toolbar", { name: "Playback" });
  await expect.element(plate).toBeVisible();

  const picture = video.getBoundingClientRect();
  const drawn = plate.element().getBoundingClientRect();
  const inset = 6;
  expect(drawn.left - picture.left).toBeCloseTo(inset, 0);
  expect(picture.right - drawn.right).toBeCloseTo(inset, 0);
  expect(picture.bottom - drawn.bottom).toBeCloseTo(inset, 0);

  // Paused, it stays up with the pointer anywhere.
  const opacity = () => getComputedStyle(plate.element()).opacity;
  expect(opacity()).toBe("1");

  video.loop = true;
  await screen.getByRole("button", { name: "Play" }).click();
  await expect.element(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(video.paused).toBe(false);

  await userEvent.hover(screen.getByText("Elsewhere"));
  // It lingers before it goes.
  expect(opacity()).toBe("1");
  await expect.poll(() => opacity(), { timeout: 3000 }).toBe("0");

  // The video is the tab stop before the plate's controls.
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(video);
  await userEvent.tab();
  await userEvent.tab();
  await userEvent.tab();
  await userEvent.tab();
  await expect.element(screen.getByRole("slider", { name: "Seek" })).toHaveFocus();
  await expect.poll(() => opacity()).toBe("1");
  (document.activeElement as HTMLElement).blur();
  await expect.poll(() => opacity()).toBe("0");

  await userEvent.hover(plate);
  await expect.poll(() => opacity()).toBe("1");
  video.pause();
});

test("the video takes the focus from a press on the picture, and its keys answer there", async () => {
  await page.viewport(1000, 700);
  const clip = await recordClip();
  const screen = await render(<Stage src={clip} />);
  const video = document.querySelector("video") as HTMLVideoElement;
  await expect.element(screen.getByRole("toolbar", { name: "Playback" })).toBeVisible();
  video.loop = true;

  const picture = video.getBoundingClientRect();
  await userEvent.click(document.body, {
    position: { x: picture.left + picture.width / 2, y: picture.top + picture.height / 3 },
  });
  expect(document.activeElement).toBe(video);

  await userEvent.keyboard(" ");
  await expect.poll(() => video.paused).toBe(false);
  // A step pauses first, so it always lands on a frame and leaves the clip still.
  await userEvent.keyboard(".");
  expect(video.paused).toBe(true);
  await userEvent.keyboard(" ");
  await expect.poll(() => video.paused).toBe(false);
  await userEvent.keyboard(" ");
  await expect.poll(() => video.paused).toBe(true);

  await userEvent.keyboard("m");
  await expect.poll(() => video.muted).toBe(true);
  await userEvent.keyboard(">");
  await expect.poll(() => video.playbackRate).toBe(1.5);

  // Off the video and out of its plate, the letters are not the video's.
  await userEvent.click(screen.getByText("Elsewhere"));
  await userEvent.keyboard("m");
  expect(video.muted).toBe(true);
});
