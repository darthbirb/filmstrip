import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { LabelField } from "./LabelField";
import { TagField } from "./TagField";

const none = async () => [];
const nothing = () => {};

function Fields() {
  return (
    <div>
      <section aria-label="Tags">
        <TagField
          of="sphinx.jpg"
          offers={none}
          refuse={() => null}
          onAdd={async () => {}}
          onEcho={nothing}
          onBackOut={nothing}
        />
      </section>
      <section aria-label="Labels">
        <LabelField
          of="Cairo"
          keyOffers={none}
          valueOffers={none}
          refuseKey={() => null}
          onAdd={async () => {}}
          onEcho={nothing}
        />
      </section>
      <button type="button">Elsewhere</button>
    </div>
  );
}

afterEach(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

test("Escape out of Add Tag… gives the focus back to Add Tag…", async () => {
  const screen = await render(<Fields />);
  const tags = screen.getByRole("region", { name: "Tags" });
  await tags.getByRole("button", { name: "Add Tag…" }).click();
  await expect.element(tags.getByRole("combobox", { name: "Add Tag to sphinx.jpg" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(tags.getByRole("button", { name: "Add Tag…" })).toHaveFocus();
});

test("Enter on nothing closes Add Tag… onto its button too", async () => {
  const screen = await render(<Fields />);
  const tags = screen.getByRole("region", { name: "Tags" });
  await tags.getByRole("button", { name: "Add Tag…" }).click();
  await expect.element(tags.getByRole("combobox", { name: "Add Tag to sphinx.jpg" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(tags.getByRole("button", { name: "Add Tag…" })).toHaveFocus();
});

test("a click away closes Add Tag… and leaves the focus where the click put it", async () => {
  const screen = await render(<Fields />);
  const tags = screen.getByRole("region", { name: "Tags" });
  await tags.getByRole("button", { name: "Add Tag…" }).click();
  await expect.element(tags.getByRole("combobox", { name: "Add Tag to sphinx.jpg" })).toHaveFocus();
  await screen.getByRole("button", { name: "Elsewhere" }).click();
  await expect.element(tags.getByRole("button", { name: "Add Tag…" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
});

test("Escape out of Add Label… gives the focus back to Add Label…", async () => {
  const screen = await render(<Fields />);
  const labels = screen.getByRole("region", { name: "Labels" });
  await labels.getByRole("button", { name: "Add Label…" }).click();
  await expect.element(labels.getByRole("button", { name: "Add Label…" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(labels.getByRole("button", { name: "Add Label…" })).toHaveFocus();
});
