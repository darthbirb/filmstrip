async function record(ms: number, delay: number, firstBeat: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d canvas");
  const stream = canvas.captureStream(0);
  const [track] = stream.getVideoTracks() as CanvasCaptureMediaStreamTrack[];
  if (!track) throw new Error("no track");
  const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  const pushed: number[] = [];
  const ticks: number[] = [];
  let ticking = true;
  const tick = (now: number) => {
    ticks.push(now);
    if (ticking) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const written = () => chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  recorder.start(100);
  const start = performance.now();
  for (let now = start; now - start < ms || written() < 1000; now = performance.now()) {
    context.fillStyle = `hsl(${((now - start) / 4) % 360} 50% 45%)`;
    context.fillRect(0, 0, 320, 180);
    track.requestFrame();
    pushed.push(performance.now());
    const beat = firstBeat && pushed.length === 1 ? 2 * delay : delay;
    await new Promise((resolve) => setTimeout(resolve, beat));
  }
  ticking = false;
  recorder.stop();
  await stopped;
  return { blob: new Blob(chunks, { type: "video/webm" }), pushed, ticks };
}

function blocks(bytes: Uint8Array) {
  const times: number[] = [];
  const vint = (at: number, keep: boolean) => {
    const first = bytes[at] ?? 0;
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    let value = keep ? first : first & (0xff >> length);
    let unknown = (first & (0xff >> length)) === 0xff >> length;
    for (let i = 1; i < length; i++) {
      value = value * 256 + (bytes[at + i] ?? 0);
      if (bytes[at + i] !== 0xff) unknown = false;
    }
    return { value, length, unknown };
  };
  const walk = (from: number, to: number, cluster: number) => {
    let at = from;
    let base = cluster;
    while (at < to) {
      const id = vint(at, true);
      const size = vint(at + id.length, false);
      const body = at + id.length + size.length;
      const end = size.unknown ? to : body + size.value;
      if (id.value === 0x18538067 || id.value === 0x1f43b675 || id.value === 0xa0) {
        walk(body, end, base);
      } else if (id.value === 0xe7) {
        base = 0;
        for (let i = body; i < end; i++) base = base * 256 + (bytes[i] ?? 0);
        walk(end, to, base);
        return;
      } else if (id.value === 0xa3 || id.value === 0xa1) {
        const track = vint(body, false);
        const high = bytes[body + track.length] ?? 0;
        const low = bytes[body + track.length + 1] ?? 0;
        const relative = ((high << 8) | low) << 16 >> 16;
        times.push(base + relative);
      }
      at = end;
    }
  };
  walk(0, bytes.length, 0);
  return times;
}

const gapsOf = (at: number[]) => at.slice(1).map((one, index) => one - (at[index] ?? one));
const round = (at: number[]) => at.map((one) => Math.round(one * 10) / 10);

async function played(url: string) {
  const video = document.createElement("video");
  video.muted = true;
  video.src = url;
  document.body.append(video);
  video.playbackRate = 0.25;
  const shown: number[] = [];
  await new Promise<void>((resolve, reject) => {
    const step = (_now: number, frame: VideoFrameCallbackMetadata) => {
      shown.push(frame.mediaTime);
      video.requestVideoFrameCallback(step);
    };
    video.requestVideoFrameCallback(step);
    video.onended = () => resolve();
    video.play().catch(reject);
  });
  video.remove();
  return shown;
}

export async function probe(delay: number, rounds = 4) {
  for (let round_ = 0; round_ < rounds; round_++) {
    const { blob, pushed, ticks } = await record(1500, delay, delay !== 33);
    const url = URL.createObjectURL(blob);
    const shown = round_ === 0 ? await played(url) : [];
    URL.revokeObjectURL(url);
    const file = blocks(new Uint8Array(await blob.arrayBuffer()));
    console.log(
      `PROBE ${JSON.stringify({
        variant: String(delay),
        round: round_,
        delay,
        pushed: round(gapsOf(pushed)),
        ticks: ticks.length,
        file: gapsOf(file),
        shown: gapsOf(shown).map((gap) => Math.round(gap * 1000)),
        drift: file.map((at, index) =>
          Math.round(at - (file[0] ?? 0) - ((pushed[index] ?? 0) - (pushed[0] ?? 0))),
        ),
      })}`,
    );
  }
}
