import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { recording } from "../../dev/recording";
import { loadIndex, resetIndex } from "../navigation/index-store";
import { setRefused } from "../navigation/refusal-store";
import { Settings } from "./Settings";

beforeEach(async () => {
  setRefused(null);
  resetIndex();
  await loadIndex();
});

test("Sources has both doorways side by side, and each adds the kind it names", async () => {
  const screen = await render(<Settings open onClose={() => undefined} section="sources" />);
  const library = screen.getByRole("button", { name: "Add Source…" });
  const sorting = screen.getByRole("button", { name: "Add Sorting Source…" });
  await expect.element(sorting).toBeVisible();
  expect(sorting.element().parentElement).toBe(library.element().parentElement);

  // The folder picked is refused, so the dev mock's library stays as it was.
  const kinds = async (button: typeof library) => {
    let asked: unknown[] = [];
    await recording(
      async (calls) => {
        await button.click();
        await expect.poll(() => calls.some(([command]) => command === "add_source")).toBe(true);
        asked = calls.filter(([command]) => command === "add_source").map(([, args]) => args);
      },
      (cmd) => {
        if (cmd === "pick_folder") return "E:\\Camera";
        if (cmd === "add_source") return { kind: "refused", why: "same", clash: "Pictures" };
        return undefined;
      },
    );
    setRefused(null);
    return asked.map((args) => (args as { kind: string }).kind);
  };
  expect(await kinds(sorting)).toEqual(["sorting"]);
  expect(await kinds(library)).toEqual(["library"]);
});
