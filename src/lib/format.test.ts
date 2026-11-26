import { expect, test } from "vitest";

import {
  files,
  formatBytes,
  formatCounted,
  formatDate,
  formatDimensions,
  formatDuration,
  formatElapsed,
  formatWhen,
  midSentence,
} from "./format";

test("sizes step by 1024, as Windows counts them", () => {
  expect(formatBytes(512)).toBe("512 bytes");
  expect(formatBytes(1)).toBe("1 byte");
  expect(formatBytes(0)).toBe("0 bytes");
  expect(formatBytes(1024)).toBe("1 KB");
  expect(formatBytes(2_400_000)).toMatch(/^2[.,]3 MB$/);
  expect(formatBytes(50 * 1024 ** 3)).toBe("50 GB");
});

test("a count takes its noun's singular for one alone, and groups its figures", () => {
  expect(files(1)).toBe("1 file");
  expect(files(0)).toBe("0 files");
  expect(files(41_236)).toBe(`${(41_236).toLocaleString()} files`);
  expect(formatCounted(1, "folder")).toBe("1 folder");
  expect(formatCounted(2, "File")).toBe("2 Files");
});

test("lengths read as a clock does", () => {
  expect(formatDuration(12_000)).toBe("0:12");
  expect(formatDuration(245_000)).toBe("4:05");
  expect(formatDuration(3_723_000)).toBe("1:02:03");
});

test("how far into a clip is written in the places its length takes", () => {
  expect(formatElapsed(31_000, 72_000)).toBe("0:31");
  expect(formatElapsed(31_000, 3_723_000)).toBe("0:00:31");
  expect(formatElapsed(754_000, 3_723_000)).toBe("0:12:34");
  expect(formatElapsed(3_661_000, 3_723_000)).toBe("1:01:01");
  expect(formatElapsed(11_600, 12_000)).toBe("0:11");
  expect(formatElapsed(72_500, 72_600)).toBe("1:12");
  expect(formatElapsed(72_600, 72_600)).toBe(formatDuration(72_600));
  expect(formatElapsed(72_600, 72_600)).toBe("1:13");
  expect(formatElapsed(3_599_600, 3_599_600)).toBe("1:00:00");
  expect(formatElapsed(3_000_000, 3_599_600)).toBe("0:50:00");
});

test("a shape is its width by its height", () => {
  expect(formatDimensions(4000, 3000)).toBe("4000 × 3000");
});

const at = (date: Date) => date.getTime() / 1000;

test("a date is Today, Yesterday, or its day and short month, its year only outside this one", () => {
  const now = new Date(2026, 9, 13, 9, 30);
  expect(formatDate(at(new Date(2026, 9, 13, 0, 5)), { now })).toBe("Today");
  expect(formatDate(at(new Date(2026, 9, 12, 23, 50)), { now })).toBe("Yesterday");
  expect(formatDate(at(new Date(2026, 9, 3, 12)), { now })).toBe("3 Oct");
  expect(formatDate(at(new Date(2026, 0, 1, 0, 0)), { now })).toBe("1 Jan");
  expect(formatDate(at(new Date(2025, 9, 3, 12)), { now })).toBe("3 Oct 2025");
  expect(formatDate(at(new Date(2025, 11, 31, 23, 59)), { now })).toBe("31 Dec 2025");
});

test("the year turns with the calendar: Yesterday across New Year, then the year written", () => {
  const now = new Date(2027, 0, 1, 8);
  expect(formatDate(at(new Date(2026, 11, 31, 22)), { now })).toBe("Yesterday");
  expect(formatDate(at(new Date(2026, 11, 30, 22)), { now })).toBe("30 Dec 2026");
});

test("a day the clocks change in is still one day", () => {
  const now = new Date(2026, 2, 30, 12);
  expect(formatDate(at(new Date(2026, 2, 29, 0, 30)), { now })).toBe("Yesterday");
  expect(formatDate(at(new Date(2026, 2, 28, 23, 30)), { now })).toBe("28 Mar");
});

test("a date and time is the date, then the time on the clock", () => {
  const now = new Date(2026, 9, 13, 9, 30);
  expect(formatWhen(at(new Date(2026, 9, 13, 14, 2)), { now })).toBe("Today, 14:02");
  expect(formatWhen(at(new Date(2026, 9, 12, 9, 41)), { now })).toBe("Yesterday, 09:41");
  expect(formatWhen(at(new Date(2026, 9, 3, 7, 5)), { now })).toBe("3 Oct, 07:05");
  expect(formatWhen(at(new Date(2024, 5, 12, 22, 25)), { now })).toBe("12 Jun 2024, 22:25");
});

test("both follow the system's locale, in its order and on its clock", () => {
  const now = new Date(2026, 9, 13, 9, 30);
  const moment = new Date(2025, 9, 3, 14, 2);
  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
  expect(formatDate(at(moment), { now })).toBe(date.format(moment));
  expect(formatWhen(at(moment), { now })).toBe(`${date.format(moment)}, ${time.format(moment)}`);
});

test("a camera's clock is shown as it was written, wherever the viewer is", () => {
  const now = new Date(2026, 9, 13, 9, 30);
  expect(formatWhen(1_718_188_401, { now, floating: true })).toBe("12 Jun 2024, 10:33");
  const sameDay = new Date(2024, 5, 12, 23, 59);
  expect(formatWhen(1_718_188_401, { now: sameDay, floating: true })).toBe("Today, 10:33");
});

test("inside a sentence, today and yesterday are not capitalised", () => {
  expect(midSentence("Today, 14:02")).toBe("today, 14:02");
  expect(midSentence("Yesterday")).toBe("yesterday");
  expect(midSentence("3 Oct 2025, 14:02")).toBe("3 Oct 2025, 14:02");
});
