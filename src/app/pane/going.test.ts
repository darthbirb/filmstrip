import { emit } from "@tauri-apps/api/event";
import { expect, test } from "vitest";

import { recording } from "../../dev/recording";
import type { Deleting } from "../../ipc/bindings/Deleting";
import type { Progress } from "../../ipc/bindings/Progress";
import { indexProgress } from "../../ipc/commands";
import { watchWork } from "../navigation/work-store";
import { goingUntilEnd, jobEnded, jobsListed, once } from "./going";

// Each test holds files of its own, so a hold one leaves cannot reach another.

const free = async (id: number) => (await once([id], async () => "sent")) === "sent";

const deleting = (jobId: number): Deleting => ({
  jobId,
  kind: "files",
  name: "",
  done: 0,
  whole: 30,
});

/** The queue as `index_progress` answers it, listing these deletes. */
async function listing(...jobIds: number[]) {
  const now: Progress = await indexProgress();
  return { ...now, moves: [], deletes: jobIds.map(deleting) };
}

test("a job that leaves the queue with no end heard lets its files go", async () => {
  const listed = await listing(5);
  await recording(
    async () => {
      await goingUntilEnd(5, [101]);
      expect(await free(101)).toBe(false);
      jobsListed({ moves: [], deletes: [deleting(5)] });
      expect(await free(101)).toBe(false);
      jobsListed({ moves: [], deletes: [] });
      expect(await free(101)).toBe(true);
    },
    (cmd) => (cmd === "index_progress" ? listed : undefined),
  );
});

test("a report sent before the job was listed keeps its files going", async () => {
  const listed = await listing(6);
  let answer = () => {};
  const held = new Promise<void>((resolve) => {
    answer = resolve;
  });
  await recording(
    async () => {
      const starting = goingUntilEnd(6, [102]);
      jobsListed({ moves: [], deletes: [] });
      expect(await free(102)).toBe(false);
      answer();
      await starting;
      expect(await free(102)).toBe(false);
      jobEnded(6);
      expect(await free(102)).toBe(true);
    },
    (cmd) => (cmd === "index_progress" ? held.then(() => listed) : undefined),
  );
});

test("a job whose end is heard before its start is answered lets its files go", async () => {
  const empty = await listing();
  jobEnded(7);
  await recording(
    async () => {
      await goingUntilEnd(7, [103]);
      expect(await free(103)).toBe(true);
    },
    (cmd) => (cmd === "index_progress" ? empty : undefined),
  );
});

test("a job given the id of one that ended earlier holds its files until its own end", async () => {
  const listed = await listing(8);
  await recording(
    async () => {
      jobEnded(8);
      await goingUntilEnd(8, [104]);
      expect(await free(104)).toBe(false);
      jobEnded(8);
      await goingUntilEnd(8, [105]);
      expect([await free(104), await free(105)]).toEqual([true, false]);
      jobEnded(8);
      expect(await free(105)).toBe(true);
    },
    (cmd) => (cmd === "index_progress" ? listed : undefined),
  );
});

test("a job given the id of one whose end went unheard frees what that one held", async () => {
  const listed = await listing(9);
  await recording(
    async () => {
      await goingUntilEnd(9, [106]);
      await goingUntilEnd(9, [107]);
      expect([await free(106), await free(107)]).toEqual([true, false]);
      jobEnded(9);
      expect(await free(107)).toBe(true);
    },
    (cmd) => (cmd === "index_progress" ? listed : undefined),
  );
});

test("the queue's own reports let a job's files go once it has left", async () => {
  const listed = await listing(11);
  await recording(
    async () => {
      await watchWork();
      await goingUntilEnd(11, [108]);
      await emit("job-progress", listed);
      expect(await free(108)).toBe(false);
      await emit("job-progress", { ...listed, deletes: [] });
      await expect.poll(() => free(108)).toBe(true);
    },
    (cmd) => (cmd === "index_progress" ? listed : undefined),
  );
});

test("what waits on a job runs once it has left, and once only", async () => {
  const listed = await listing(12);
  let ran = 0;
  await recording(
    async () => {
      await goingUntilEnd(12, [109], () => ran++);
      expect(ran).toBe(0);
      jobsListed({ moves: [], deletes: [] });
      expect(ran).toBe(1);
      jobEnded(12);
      expect(ran).toBe(1);
    },
    (cmd) => (cmd === "index_progress" ? listed : undefined),
  );
});

test("what waits on a job runs once its end is heard, and not again as the queue drops it", async () => {
  const listed = await listing(14);
  let ran = 0;
  await recording(
    async () => {
      await goingUntilEnd(14, [111], () => ran++);
      expect(ran).toBe(0);
      jobEnded(14);
      expect(ran).toBe(1);
      jobsListed({ moves: [], deletes: [] });
      expect(ran).toBe(1);
    },
    (cmd) => (cmd === "index_progress" ? listed : undefined),
  );
});

test("what waits on a job already gone when its start is answered runs then", async () => {
  const empty = await listing();
  let ran = 0;
  jobEnded(13);
  await recording(
    async () => {
      await goingUntilEnd(13, [110], () => ran++);
      expect(ran).toBe(1);
    },
    (cmd) => (cmd === "index_progress" ? empty : undefined),
  );
});
