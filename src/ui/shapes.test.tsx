import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Button } from "./Button";
import { Chip } from "./Chip";
import { Disclosure } from "./Disclosure";
import { Segmented } from "./Segmented";
import { Slider } from "./Slider";

test("a button acts on a click, says when it is pressed, and does nothing while unavailable", async () => {
  const acted = vi.fn();
  const screen = await render(
    <>
      <Button onClick={acted}>Retry</Button>
      <Button pressed>Pinned</Button>
      <Button disabled onClick={acted}>
        Unavailable
      </Button>
    </>,
  );
  await screen.getByRole("button", { name: "Retry" }).click();
  expect(acted).toHaveBeenCalledTimes(1);
  await expect
    .element(screen.getByRole("button", { name: "Pinned" }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.element(screen.getByRole("button", { name: "Unavailable" })).toBeDisabled();
});

test("a segmented control raises the choice made and reports the next one", async () => {
  const chose = vi.fn();
  const options = [
    { value: "rows", label: "Rows" },
    { value: "squares", label: "Squares" },
  ] as const;
  const screen = await render(
    <Segmented label="Layout" options={options} value="rows" onChange={chose} />,
  );
  await expect
    .element(screen.getByRole("button", { name: "Rows" }))
    .toHaveAttribute("aria-pressed", "true");
  await screen.getByRole("button", { name: "Squares" }).click();
  expect(chose).toHaveBeenCalledWith("squares");
});

test("a slider steps with the arrow keys and fills its track to its value", async () => {
  const moved = vi.fn();
  const screen = await render(<Slider label="Size" min={6} max={20} value={13} onChange={moved} />);
  const slider = screen.getByRole("slider", { name: "Size" });
  expect(slider.element().style.getPropertyValue("--fill")).toBe("50%");
  await slider.click();
  await userEvent.keyboard("{ArrowRight}");
  expect(moved).toHaveBeenLastCalledWith(14);
});

test("a disclosure keeps its detail hidden until opened, and says so", async () => {
  const toggled = vi.fn();
  const screen = await render(
    <Disclosure label="Details" summary="4000 × 3000" onToggle={toggled}>
      <p>Taken on a Tuesday</p>
    </Disclosure>,
  );
  const row = screen.getByRole("button", { name: /Details/ });
  await expect.element(row).toHaveAttribute("aria-expanded", "false");
  await expect.element(screen.getByText("4000 × 3000")).toBeVisible();
  await expect.element(screen.getByText("Taken on a Tuesday")).not.toBeVisible();

  await row.click();
  await expect.element(row).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("Taken on a Tuesday")).toBeVisible();
  expect(toggled).toHaveBeenLastCalledWith(true);
});

test("a label chip always shows its key, and a tag has none", async () => {
  const screen = await render(
    <>
      <Chip value="cairo" tagKey="location" />
      <Chip value="trips" inherited />
    </>,
  );
  await expect.element(screen.getByText("location:")).toBeVisible();
  await expect.element(screen.getByText("trips")).toBeVisible();
});
