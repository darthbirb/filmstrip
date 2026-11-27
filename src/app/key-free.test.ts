import { afterEach, expect, test } from "vitest";

import { keyIsFree } from "./key-free";

const strays: Element[] = [];

afterEach(() => {
  for (const one of strays.splice(0)) one.remove();
});

/** What the helper says of a key pressed at `target`, judged as a window listener would. */
function judged(target: Element, init: KeyboardEventInit = {}, modifiers?: boolean) {
  let free: boolean | null = null;
  const listen = (event: KeyboardEvent) => {
    free = modifiers === undefined ? keyIsFree(event) : keyIsFree(event, { modifiers });
  };
  window.addEventListener("keydown", listen);
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true, ...init }));
  window.removeEventListener("keydown", listen);
  return free;
}

function placed<K extends keyof HTMLElementTagNameMap>(tag: K, within: Element = document.body) {
  const element = document.createElement(tag);
  within.append(element);
  strays.push(element);
  return element;
}

test("a key pressed on the page with nothing open is free", () => {
  expect(judged(placed("button"))).toBe(true);
  expect(judged(document.body)).toBe(true);
});

test("a field keeps its keys, and so does whatever sits inside one", () => {
  expect(judged(placed("input"))).toBe(false);
  expect(judged(placed("textarea"))).toBe(false);
  expect(judged(placed("select"))).toBe(false);
  const editable = placed("div");
  editable.contentEditable = "true";
  expect(judged(placed("span", editable))).toBe(false);
});

test("a menu, a popover and a question keep their keys", () => {
  const menu = placed("div");
  menu.setAttribute("role", "menu");
  expect(judged(placed("button", menu))).toBe(false);
  const manual = placed("div");
  manual.popover = "manual";
  expect(judged(placed("button", manual))).toBe(false);
  const question = placed("section");
  question.dataset.question = "";
  expect(judged(placed("button", question))).toBe(false);
});

test("an open auto popover keeps the keys with the focus outside it, and a closed one does not", () => {
  const outside = placed("button");
  const auto = placed("div");
  auto.popover = "auto";
  auto.showPopover();
  expect(judged(outside)).toBe(false);
  auto.hidePopover();
  expect(judged(outside)).toBe(true);
});

test("an open dialog keeps every key on the page, and a closed one none", () => {
  const outside = placed("button");
  const dialog = placed("dialog");
  dialog.show();
  expect(judged(outside)).toBe(false);
  dialog.close();
  expect(judged(outside)).toBe(true);
});

test("a held modifier takes the key, unless the caller judges modifiers itself", () => {
  const button = placed("button");
  for (const held of ["ctrlKey", "altKey", "shiftKey", "metaKey"] as const) {
    expect(judged(button, { [held]: true })).toBe(false);
    expect(judged(button, { [held]: true }, true)).toBe(true);
  }
  expect(judged(placed("input"), { ctrlKey: true }, true)).toBe(false);
});

test("a key something else already took is not free", () => {
  const button = placed("button");
  button.addEventListener("keydown", (event) => event.preventDefault());
  expect(judged(button, { cancelable: true })).toBe(false);
});
