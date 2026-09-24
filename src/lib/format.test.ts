import { expect, test } from "vitest";

import {
  formatBytes,
  formatDate,
  formatDay,
  formatDimensions,
  formatDuration,
  formatWhen,
} from "./format";

test("sizes step by 1024, as Windows counts them", () => {
  expect(formatBytes(512)).toBe("512 bytes");
  expect(formatBytes(1024)).toBe("1 KB");
  expect(formatBytes(2_400_000)).toMatch(/^2[.,]3 MB$/);
  expect(formatBytes(50 * 1024 ** 3)).toBe("50 GB");
});

test("lengths read as a clock does", () => {
  expect(formatDuration(12_000)).toBe("0:12");
  expect(formatDuration(245_000)).toBe("4:05");
  expect(formatDuration(3_723_000)).toBe("1:02:03");
});

test("a shape is its width by its height", () => {
  expect(formatDimensions(4000, 3000)).toBe("4000 × 3000");
});

test("a camera's clock is shown as it was written, wherever the viewer is", () => {
  const taken = formatDate(1_718_188_401, true);
  expect(taken).toContain("2024");
  expect(taken).toMatch(/10[:.]33/);
});

test("a day reads as Today, Yesterday, then its date, with a year only when it is not this one", () => {
  const now = new Date(2026, 8, 24, 9, 30);
  const at = (date: Date) => date.getTime() / 1000;
  expect(formatDay(at(new Date(2026, 8, 24, 0, 5)), now)).toBe("Today");
  expect(formatDay(at(new Date(2026, 8, 23, 23, 50)), now)).toBe("Yesterday");
  const earlier = new Date(2026, 8, 12, 12);
  const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });
  expect(formatDay(at(earlier), now)).toBe(date.format(earlier));
  expect(formatDay(at(new Date(2025, 8, 12, 12)), now)).toMatch(/2025/);
  expect(formatWhen(at(new Date(2026, 8, 24, 14, 2)), now)).toMatch(/^Today, \S/);
});
