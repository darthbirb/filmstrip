import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import { listSources } from "../../ipc/commands";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { getPreferences, updatePreferences } from "../preferences";
import { Settings } from "./Settings";

// Against the dev mock, whose one sorting source is Incoming.

const opened = () => render(<Settings open onClose={() => undefined} section="sources" />);

beforeEach(async () => {
  updatePreferences({ deleteInto: undefined });
  resetIndex();
  await loadIndex();
});

test("Sources holds where a deleted folder's files go: asking, or a sorting source", async () => {
  const screen = await opened();
  await expect.element(screen.getByRole("heading", { name: "Deleting a Folder" })).toBeVisible();
  await screen.getByRole("button", { name: "Move Its Files To: Ask Each Time" }).click();
  await screen.getByRole("option", { name: "Incoming" }).click();
  expect(getPreferences().deleteInto).toBe(2);

  await screen.getByRole("button", { name: "Move Its Files To: Incoming" }).click();
  await screen.getByRole("option", { name: "Ask Each Time" }).click();
  expect(getPreferences().deleteInto).toBeUndefined();
  await expect
    .element(screen.getByRole("button", { name: "Move Its Files To: Ask Each Time" }))
    .toBeVisible();
});

test("a default whose sorting source has gone reads as asking", async () => {
  updatePreferences({ deleteInto: 99 });
  const screen = await opened();
  await expect
    .element(screen.getByRole("button", { name: "Move Its Files To: Ask Each Time" }))
    .toBeVisible();
});

test("with no sorting source there is nothing to name, so the row is not there", async () => {
  const libraries = (await listSources()).filter((source) => source.kind === "library");
  await recording(
    async () => {
      resetIndex();
      await loadIndex();
      const screen = await opened();
      await expect.element(screen.getByRole("button", { name: "Add Source…" })).toBeVisible();
      expect(screen.getByRole("heading", { name: "Deleting a Folder" }).elements()).toHaveLength(0);
    },
    (cmd) => (cmd === "list_sources" ? libraries : undefined),
  );
});
