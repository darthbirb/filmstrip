import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { TermField } from "./TermField";

beforeEach(async () => {
  await page.viewport(800, 600);
});

const line = "Trips has a trip, and Cairo, inside Trips, already has a location.";

function field(ready: boolean, refused: boolean, onCommit: (value: string) => void) {
  return (
    <TermField
      label="Rename trip"
      value="trip"
      shape="key"
      ready={ready}
      refuse={(value) => (ready && refused && value === "location" ? line : null)}
      onCommit={onCommit}
      onCancel={() => undefined}
    />
  );
}

test("Enter before the field can refuse waits, then refuses what it would have taken", async () => {
  const taken: string[] = [];
  const commit = (value: string) => taken.push(value);
  const screen = await render(field(false, true, commit));
  await userEvent.keyboard("location{Enter}");
  expect(taken).toEqual([]);
  await screen.rerender(field(true, true, commit));
  await expect.element(page.getByText(line)).toBeVisible();
  expect(taken).toEqual([]);
});

test("Enter before the field can refuse waits, then takes what nothing refuses", async () => {
  const taken: string[] = [];
  const commit = (value: string) => taken.push(value);
  const screen = await render(field(false, false, commit));
  await userEvent.keyboard("location{Enter}");
  expect(taken).toEqual([]);
  await screen.rerender(field(true, false, commit));
  await expect.poll(() => taken).toEqual(["location"]);
});
