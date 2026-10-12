import type { ReactNode } from "react";
import { beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { LabelField, LabelValueField } from "./LabelField";
import { TagField } from "./TagField";

beforeEach(async () => {
  await page.viewport(800, 600);
});

/** A scroller only a few lines high, with the field on its last line. */
function Short({ children }: { children: ReactNode }) {
  return (
    <div data-testid="scroller" style={{ height: 96, width: 320, overflow: "auto" }}>
      <div style={{ height: 160 }} />
      <span className="flex flex-wrap items-center gap-1.5">{children}</span>
    </div>
  );
}

const none = async () => [];

async function expectInView(screen: Awaited<ReturnType<typeof render>>, line: string) {
  await expect.element(screen.getByText(line)).toBeVisible();
  const shown = screen.getByText(line).element().getBoundingClientRect();
  const port = screen.getByTestId("scroller").element().getBoundingClientRect();
  expect(shown.top).toBeGreaterThanOrEqual(port.top);
  expect(shown.bottom).toBeLessThanOrEqual(port.bottom);
}

test("a tag field at the foot of a short scroller brings its refusal into view", async () => {
  const line = "sphinx.jpg already has egypt, from Cairo.";
  const screen = await render(
    <Short>
      <TagField
        of="sphinx.jpg"
        offers={none}
        refuse={(value) => (value === "egypt" ? { line, tagId: 1 } : null)}
        onAdd={async () => undefined}
        onEcho={() => undefined}
        onBackOut={() => undefined}
      />
    </Short>,
  );
  await screen.getByRole("button", { name: "Add Tag…" }).click();
  await userEvent.keyboard("egypt");
  await expectInView(screen, line);
});

test("a label field at the foot of a short scroller brings its refused key into view", async () => {
  const line = "Cairo already has location.";
  const screen = await render(
    <Short>
      <LabelField
        of="Cairo"
        keyOffers={none}
        valueOffers={none}
        refuseKey={(key) => (key === "location" ? { line, tagId: 1 } : null)}
        onAdd={async () => undefined}
        onEcho={() => undefined}
      />
    </Short>,
  );
  await screen.getByRole("button", { name: "Add Label…" }).click();
  await userEvent.keyboard("location");
  await expectInView(screen, line);
});

test("a label's value emptied at the foot of a short scroller says why in view", async () => {
  const screen = await render(
    <Short>
      <LabelValueField
        tagKey="location"
        value="cairo"
        onCommit={() => undefined}
        onCancel={() => undefined}
      />
    </Short>,
  );
  await userEvent.keyboard("{Backspace}{Enter}");
  await expectInView(screen, "A label needs a value. Use × to remove it.");
});
