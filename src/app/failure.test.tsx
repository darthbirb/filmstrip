import { beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { failCommand } from "../dev/mock";
import { itemMenu } from "./menus/item-menu";
import { Foot } from "./navigation/Foot";
import { getNews, setNews } from "./navigation/foot-slot";
import { openIndex, resetIndex } from "./navigation/index-store";
import { Navigation } from "./navigation/Navigation";
import { setPlace } from "./place";

beforeEach(() => {
  setNews(null);
  setPlace(null);
});

test("a first load that fails says why in navigation, and Retry opens the index", async () => {
  resetIndex();
  failCommand("list_sources", { kind: "busy" });
  try {
    const screen = await render(<Navigation />);
    await openIndex();
    await expect
      .element(
        screen.getByText(
          "Filmstrip could not open its index. The index is busy. Try again in a moment.",
        ),
      )
      .toBeVisible();
    await expect.element(screen.getByText("Could Not Open the Index")).toBeVisible();

    failCommand("list_sources", null);
    await screen.getByRole("button", { name: "Retry" }).click();
    await expect.element(screen.getByRole("tree", { name: "Places" })).toBeVisible();
    expect(screen.container.textContent).not.toContain("could not open its index");
  } finally {
    failCommand("list_sources", null);
  }
});

test("Show in Explorer that fails from a file's menu says so at the foot, naming the file", async () => {
  failCommand("reveal_item", { kind: "permissionDenied" });
  try {
    const screen = await render(<Foot />);
    const file = { id: 1, folderId: 1, diskName: "_DSC4411.ARW", favorite: false };
    const reveal = itemMenu(file, () => undefined)
      .flat()
      .find((action) => action.id === "reveal");
    reveal?.onSelect();
    const said = "Could not show _DSC4411.ARW in Explorer. Windows refused access.";
    await expect.element(screen.getByText(said)).toBeVisible();
    expect(getNews()).toEqual({ kind: "failed", line: said });
  } finally {
    failCommand("reveal_item", null);
  }
});
