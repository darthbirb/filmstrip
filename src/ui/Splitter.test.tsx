import { useState } from "react";
import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Splitter } from "./Splitter";

function Harness() {
  const [width, setWidth] = useState(15);
  return (
    <div className="relative flex h-40">
      <div style={{ width: `${width}rem` }} />
      <Splitter
        label="Resize"
        value={width}
        min={10}
        max={24}
        initial={15}
        panel="before"
        onChange={setWidth}
      />
      <div
        data-testid="four-rem-on"
        className="absolute top-0 h-40 w-splitter"
        style={{ left: "19rem" }}
      />
    </div>
  );
}

test("arrow keys, Home and End move a splitter within its limits, and double-click resets it", async () => {
  const screen = await render(<Harness />);
  const splitter = screen.getByRole("separator", { name: "Resize" });
  (splitter.element() as HTMLElement).focus();

  await userEvent.keyboard("{ArrowRight}");
  await expect.element(splitter).toHaveAttribute("aria-valuenow", "16");
  await userEvent.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  await expect.element(splitter).toHaveAttribute("aria-valuenow", "12");
  await userEvent.keyboard("{Home}");
  await expect.element(splitter).toHaveAttribute("aria-valuenow", "10");
  await userEvent.keyboard("{End}");
  await expect.element(splitter).toHaveAttribute("aria-valuenow", "24");

  await splitter.dblClick();
  await expect.element(splitter).toHaveAttribute("aria-valuenow", "15");
});

test("dragging moves the edge with the pointer, measured in rem", async () => {
  const screen = await render(<Harness />);
  const splitter = screen.getByRole("separator", { name: "Resize" });

  await userEvent.dragAndDrop(splitter, screen.getByTestId("four-rem-on"));
  await expect.element(splitter).toHaveAttribute("aria-valuenow", "19");
});
