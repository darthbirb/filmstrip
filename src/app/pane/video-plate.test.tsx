import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Video, VideoPlate } from "./VideoPlate";

const LENGTH = 72_000;

let clips: string[] = [];
afterEach(() => {
  for (const clip of clips) URL.revokeObjectURL(clip);
  clips = [];
});

/** The plate alone at a width, over an element with nothing loaded. */
function Bare({ width }: { width: number }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  return (
    <div style={{ width }}>
      {/* biome-ignore lint/a11y/useMediaCaption: a test's element, never shown */}
      <video ref={setVideo} />
      {video && <VideoPlate video={video} durationMs={LENGTH} />}
    </div>
  );
}

async function renderPlate(width: number) {
  await page.viewport(1000, 700);
  const screen = await render(<Bare width={width} />);
  const plate = screen.getByRole("toolbar", { name: "Playback" });
  await expect.element(plate).toBeVisible();
  // Every width below is the faces' own, not a fallback's.
  await document.fonts.load('12px "IBM Plex Sans"', "0:00 / 1:12");
  await document.fonts.ready;
  return { screen, plate: plate.element() as HTMLElement };
}

/** What the plate shows, ignoring the copy it measures with. */
function showing(plate: HTMLElement) {
  const shown = (selector: string) => plate.querySelector(`:scope > ${selector}`) !== null;
  return {
    play: shown("button[aria-label='Play']"),
    track: shown("[role='slider']"),
    elapsed: plate.querySelector("[data-time='elapsed']") !== null,
    total: plate.querySelector("[data-time='total']") !== null,
    mute: shown("button[aria-label='Mute']"),
  };
}

const box = (element: Element | null) => element?.getBoundingClientRect().width ?? 0;

test("every glyph on the plate is drawn at the scale's one glyph size", async () => {
  const { plate } = await renderPlate(400);
  const root = getComputedStyle(document.documentElement);
  const glyph = Number.parseFloat(root.getPropertyValue("--text-glyph")) * 16;

  const glyphs = [...plate.querySelectorAll(":scope > button .glyph")];
  expect(glyphs).toHaveLength(2);
  for (const element of glyphs) {
    expect(getComputedStyle(element).fontSize).toBe(`${glyph}px`);
  }
  const [play, mute] = glyphs as [HTMLElement, HTMLElement];
  // Play is told apart by being the one filled and in white, not by a size of its own.
  expect(play.classList.contains("glyph-fill")).toBe(true);
  expect(getComputedStyle(play).color).toBe("rgb(242, 242, 242)");
  expect(mute.classList.contains("glyph-fill")).toBe(false);
  expect(getComputedStyle(mute).color).toBe("rgb(168, 165, 160)");
});

test("as the plate narrows the total leaves first, then the mute, and play, the track and the elapsed never do", async () => {
  const { screen, plate } = await renderPlate(400);
  const wide = showing(plate);
  expect(wide).toEqual({ play: true, track: true, elapsed: true, total: true, mute: true });
  expect(plate.textContent).toContain("0:00 / 1:12");

  // What each piece takes, read from the plate while everything is on it.
  const style = getComputedStyle(plate);
  const gap = Number.parseFloat(style.columnGap);
  const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const slider = plate.querySelector("[role='slider']") as HTMLElement;
  const track = Number.parseFloat(getComputedStyle(slider).minWidth);
  expect(track).toBe(24);
  const play = box(plate.querySelector(":scope > button"));
  const elapsed = box(plate.querySelector("[data-time='elapsed']"));
  const total = box(plate.querySelector("[data-time='total']"));
  const mute = box(plate.querySelector(":scope > button[aria-label='Mute']"));
  const bare = padding + play + gap + track + gap + elapsed;
  const withMute = bare + gap + mute;
  const everything = withMute + total;

  const container = plate.parentElement as HTMLElement;
  for (let width = 400; width >= 80; width -= 2) {
    container.style.width = `${width}px`;
    const expected = { width, total: width >= everything, mute: width >= withMute };
    await expect
      .poll(() => {
        const now = showing(plate);
        return { width, total: now.total, mute: now.mute };
      })
      .toEqual(expected);
    const now = showing(plate);
    expect(now.play && now.track && now.elapsed, `at ${width}px`).toBe(true);
    // Whatever is still on the plate fits it, the track at no less than its least.
    if (width >= bare) {
      expect(box(slider), `the track at ${width}px`).toBeGreaterThanOrEqual(track - 0.5);
      const last = plate.querySelector(":scope > :last-child")?.getBoundingClientRect();
      const end = plate.getBoundingClientRect().right - Number.parseFloat(style.paddingRight);
      expect(last?.right ?? 0, `at ${width}px`).toBeLessThanOrEqual(end + 0.5);
    }
  }
  await screen.unmount();
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

  expect(video.muted).toBe(true);
  const unmute = screen.getByRole("button", { name: "Unmute" });
  await expect.element(unmute).toHaveAttribute("aria-pressed", "true");
  const glyph = unmute.element().querySelector(".glyph") as HTMLElement;
  expect(glyph.dataset.icon).toBe("speaker-slash");
  await expect.poll(() => getComputedStyle(glyph).color).toBe("rgb(242, 242, 242)");
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
          className="max-h-full max-w-full"
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

  await userEvent.tab();
  await expect.element(screen.getByRole("slider", { name: "Seek" })).toHaveFocus();
  await expect.poll(() => opacity()).toBe("1");
  (document.activeElement as HTMLElement).blur();
  await expect.poll(() => opacity()).toBe("0");

  await userEvent.hover(plate);
  await expect.poll(() => opacity()).toBe("1");
  video.pause();
});
