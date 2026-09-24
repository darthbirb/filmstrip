import { expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { type Answer, Question } from "./Question";

const answers = (names: string[], chosen: string[] = []): Answer[] =>
  names.map((name) => ({
    id: name,
    label: `Move Files to ${name}`,
    short: name,
    onChoose: () => chosen.push(name),
  }));

function Asked({ width, names, chosen }: { width: string; names: string[]; chosen?: string[] }) {
  return (
    <div style={{ width }}>
      <Question
        sentence="Lisbon holds 214 files"
        choices={answers(names, chosen)}
        choiceGlyph="sortingBox"
        fold="Move Files to…"
        last={{ label: "Delete Files Too", onChoose: () => undefined }}
        box={{ label: "Always Move to the One I Choose", checked: false, onChange: () => {} }}
        onDismiss={() => undefined}
      />
    </div>
  );
}

const shown = (screen: Awaited<ReturnType<typeof render>>) =>
  screen
    .getByRole("button")
    .elements()
    .filter((button) => !button.closest("[inert]"))
    .map(
      (button) =>
        button.getAttribute("aria-label") ?? button.querySelector(".truncate")?.textContent,
    );

test("while every answer fits beside the trash, each is its own button", async () => {
  const screen = await render(<Asked width="40rem" names={["Inbox", "Cards"]} />);
  await expect.element(screen.getByText("Lisbon holds 214 files")).toBeVisible();
  expect(shown(screen)).toEqual([
    "Cancel",
    "Move Files to Inbox",
    "Move Files to Cards",
    "Delete Files Too",
  ]);
  await expect.element(screen.getByRole("checkbox")).not.toBeChecked();
});

test("the moment they do not, all of them fold into one, whose menu names each", async () => {
  const chosen: string[] = [];
  const names = ["Inbox", "Cards", "Phone", "Camera", "Studio", "Desktop"];
  const screen = await render(<Asked width="26rem" names={names} chosen={chosen} />);
  await expect.poll(() => shown(screen)).toEqual(["Cancel", "Move Files to…", "Delete Files Too"]);

  await screen.getByRole("button", { name: "Move Files to…" }).click();
  const menu = screen.getByRole("menu", { name: "Move Files to…" });
  await expect.element(menu).toBeVisible();
  const rows = menu.getByRole("menuitem").elements();
  expect(rows.map((row) => row.querySelector(".truncate")?.textContent)).toEqual(names);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(chosen).toEqual(["Cards"]);
});

test("a fold that still does not fit side by side takes a line for each answer", async () => {
  const screen = await render(<Asked width="14rem" names={["Inbox", "Cards", "Phone"]} />);
  await expect.poll(() => shown(screen)).toEqual(["Cancel", "Move Files to…", "Delete Files Too"]);
  const [fold, trash] = ["Move Files to…", "Delete Files Too"].map((name) =>
    screen.getByRole("button", { name }).element().getBoundingClientRect(),
  );
  expect(trash?.top).toBeGreaterThan(fold?.bottom ?? 0);
  expect(trash?.left).toBe(fold?.left);
});
