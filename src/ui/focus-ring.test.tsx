import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Chip } from "./Chip";
import { LabelField, LabelValueField } from "./LabelField";
import { Segmented } from "./Segmented";

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const ringOf = (element: Element) => {
  const style = getComputedStyle(element);
  return { width: style.outlineWidth, offset: style.outlineOffset, style: style.outlineStyle };
};

const outside = () => ({
  width: token("--focus-width"),
  offset: token("--focus-gap"),
  style: "solid",
});

const none = () => undefined;

test("a split label chip draws the focus ring around the whole, at the focus width", async () => {
  const screen = await render(
    <Chip value="cairo" tagKey="location" onSearch={none} onRemove={none} onEdit={none} />,
  );
  await userEvent.tab();
  const chip = screen.container.querySelector("[data-chip]") as HTMLElement;
  expect(chip.contains(document.activeElement)).toBe(true);
  expect(ringOf(chip)).toEqual(outside());
});

test("a removable tag pill draws the focus ring at the focus width", async () => {
  const screen = await render(<Chip value="trips" onSearch={none} onRemove={none} />);
  await userEvent.tab();
  const chip = screen.container.querySelector("[data-chip]") as HTMLElement;
  expect(chip.contains(document.activeElement)).toBe(true);
  expect(ringOf(chip)).toEqual(outside());
});

test("Add Label's two halves draw one focus ring at the focus width", async () => {
  const screen = await render(
    <LabelField
      of="cairo"
      keyOffers={async () => []}
      valueOffers={async () => []}
      refuseKey={() => null}
      onAdd={async () => {}}
      onEcho={none}
    />,
  );
  await userEvent.tab();
  await userEvent.keyboard("{Enter}");
  const key = screen.getByRole("combobox", { name: "Key" });
  await expect.element(key).toHaveFocus();
  expect(ringOf(key.element().closest("fieldset") as HTMLElement)).toEqual(outside());
});

test("a label's value changed in place draws the focus ring at the focus width", async () => {
  const screen = await render(
    <LabelValueField tagKey="location" value="cairo" onCommit={none} onCancel={none} />,
  );
  const field = screen.getByRole("textbox", { name: "Value of location" });
  await expect.element(field).toHaveFocus();
  expect(ringOf(field.element().parentElement as HTMLElement)).toEqual(outside());
});

test("a segmented option draws the focus ring inside itself, at the focus width", async () => {
  const screen = await render(
    <Segmented
      label="Kind"
      options={[
        { value: "a", label: "Pictures" },
        { value: "b", label: "Videos" },
      ]}
      value="a"
      onChange={none}
      size="chip"
    />,
  );
  await userEvent.tab();
  const radio = screen.getByRole("radio", { name: "Pictures" });
  await expect.element(radio).toHaveFocus();
  const width = token("--focus-width");
  expect(ringOf(radio.element().closest("label") as HTMLElement)).toEqual({
    width,
    offset: `-${width}`,
    style: "solid",
  });
});
