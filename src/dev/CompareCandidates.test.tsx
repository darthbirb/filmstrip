import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { CompareCandidates } from "./CompareCandidates";

const Tall = () => <div style={{ height: 2000 }} />;

test("stacked candidates share the height they are given, however tall their content", async () => {
  await page.viewport(800, 800);
  await render(
    <div style={{ height: 600, overflow: "auto" }}>
      <CompareCandidates candidates={{ one: Tall, two: Tall, three: Tall }} layout="rows" />
    </div>,
  );
  const heights = [...document.querySelectorAll("section")].map((section) =>
    Math.round(section.getBoundingClientRect().height),
  );
  expect(heights).toEqual([200, 200, 200]);
});
