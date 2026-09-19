import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { suppressBrowserMenu } from "./browser-menu";

let undo: (() => void) | undefined;
afterEach(() => undo?.());

/** Right-clicks an element as the browser would, and says whether its own menu was let through. */
function rightClick(element: Element) {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event.defaultPrevented ? "suppressed" : "platform";
}

test("the browser's menu is gone everywhere but in a field", async () => {
  undo = suppressBrowserMenu();
  const screen = await render(
    <div>
      <button type="button">a tile</button>
      <div role="treeitem" aria-selected="false" tabIndex={-1}>
        a row
      </div>
      <p>the grid's bare ground</p>
      <input aria-label="search" />
      <textarea aria-label="note" />
    </div>,
  );

  expect(rightClick(screen.getByRole("button", { name: "a tile" }).element())).toBe("suppressed");
  expect(rightClick(screen.getByRole("treeitem").element())).toBe("suppressed");
  expect(rightClick(screen.getByText("the grid's bare ground").element())).toBe("suppressed");
  // Cut, copy, paste and the spell-checker stay where there is text to act on.
  expect(rightClick(screen.getByRole("textbox", { name: "search" }).element())).toBe("platform");
  expect(rightClick(screen.getByRole("textbox", { name: "note" }).element())).toBe("platform");
});
