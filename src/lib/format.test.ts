import { expect, test } from "vitest";

import { formatBytes, formatDate, formatDimensions, formatDuration } from "./format";

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
