// Real media for tests that need the window to decode and play something: the mock draws only SVG.

/** A JPEG of this size, as an object URL. */
export async function photograph(width: number, height: number, hue = 30) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas");
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${hue} 45% 55%)`);
  gradient.addColorStop(1, `hsl(${hue + 60} 45% 25%)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.9),
  );
  if (!blob) throw new Error("the canvas made no JPEG");
  return URL.createObjectURL(blob);
}

/** A WebM clip of this size and length, recorded from a canvas as it changes colour. */
export async function clip(width: number, height: number, ms: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas");
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  recorder.start();
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const draw = (now: number) => {
      context.fillStyle = `hsl(${((now - start) / 4) % 360} 50% 45%)`;
      context.fillRect(0, 0, width, height);
      if (now - start < ms) requestAnimationFrame(draw);
      else resolve();
    };
    requestAnimationFrame(draw);
  });
  recorder.stop();
  await stopped;
  return URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
}

type Internals = { __TAURI_INTERNALS__: { convertFileSrc: (path: string) => string } };

/**
 * Serves these files' paths, by the name they end in, from the URLs given, and every other path as
 * the mock does. Returns the way back.
 */
export function serveFiles(urls: Record<string, string>) {
  const internals = (window as unknown as Internals).__TAURI_INTERNALS__;
  const mock = internals.convertFileSrc;
  internals.convertFileSrc = (path: string) => {
    const name = Object.keys(urls).find((one) => path.endsWith(`\\${one}`));
    return name ? (urls[name] as string) : mock(path);
  };
  return () => {
    internals.convertFileSrc = mock;
  };
}
