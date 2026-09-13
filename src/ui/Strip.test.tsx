import { useState } from "react";
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Strip, type StripFrame } from "./Strip";

const FRAMES: StripFrame[] = [
  { id: 1, label: "felucca.mp4", aspect: 16 / 9 },
  { id: 2, label: "pyramid.jpg", aspect: 3 / 4 },
  { id: 3, label: "sphinx.jpg", aspect: 1 },
];

function Harness() {
  const [current, setCurrent] = useState<number | null>(2);
  return <Strip label="Filmstrip" frames={FRAMES} current={current} onChoose={setCurrent} />;
}

test("the filmstrip marks the current frame, and the arrows step along it", async () => {
  const screen = await render(<Harness />);
  const frame = (name: string) => screen.getByRole("option", { name });
  await expect.element(frame("pyramid.jpg")).toHaveAttribute("aria-selected", "true");

  await frame("pyramid.jpg").click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(frame("sphinx.jpg")).toHaveAttribute("aria-selected", "true");
  await expect.element(frame("sphinx.jpg")).toHaveFocus();

  await userEvent.keyboard("{Home}");
  await expect.element(frame("felucca.mp4")).toHaveAttribute("aria-selected", "true");
  await expect.element(frame("pyramid.jpg")).toHaveAttribute("aria-selected", "false");
});

test("a frame keeps its picture's shape, within reason", async () => {
  const screen = await render(
    <Strip
      label="Filmstrip"
      frames={[{ id: 9, label: "panorama.jpg", aspect: 6 }]}
      current={null}
      onChoose={() => undefined}
    />,
  );
  const frame = screen.getByRole("option", { name: "panorama.jpg" }).element();
  const box = frame.getBoundingClientRect();
  expect(box.width / box.height).toBeCloseTo(2, 1);
});
