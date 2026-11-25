import { focusPicture } from "./picture-focus";

// Only a focus that fell to the page is taken back; any focus that moves on purpose drops the request.
// A frame given the focus is held until the focus moves on, since the strip may still drop it.
let wanted: { name: string } | { frame: HTMLElement | null } | null = null;

const STRIP = '[role="listbox"][aria-label="Filmstrip"]';

const onFocusIn = (event: FocusEvent) => {
  if (wanted && "frame" in wanted && event.target === wanted.frame) return;
  drop();
};

function drop() {
  wanted = null;
  document.removeEventListener("focusin", onFocusIn);
}

/** No focus is asked of the next bar. */
export function forgetActFocus() {
  drop();
}

function lost() {
  const now = document.activeElement;
  return now === null || now === document.body;
}

/**
 * The act takes its file's bar with it, so the same button on the next bar takes the focus, or
 * failing that the strip's frame or the picture. DECISIONS.md "The pane".
 */
export function keepFocusThrough(name: string, act: Promise<unknown>) {
  const from = document.activeElement;
  drop();
  wanted = { name };
  document.addEventListener("focusin", onFocusIn);
  void act.finally(() => {
    if (wanted && "name" in wanted && document.activeElement !== from && !lost()) drop();
  });
}

/** A bar just drawn for this file answers a request: its button of that name, else the strip. */
export function answerOnBar(bar: HTMLElement, shown: number) {
  if (wanted === null || !("name" in wanted)) return;
  if (!lost()) return drop();
  const { name } = wanted;
  const button = [...bar.querySelectorAll("button")].find((one) => nameOf(one) === name);
  if (button) {
    drop();
    button.focus();
    return;
  }
  wanted = { frame: null };
  if (!bar.parentElement?.querySelector(STRIP)) answerOnStrip(null, shown);
}

/**
 * The strip answers what its bar could not: the frame shown takes the focus once drawn, or the
 * picture when the strip runs through a place the file has left, or goes. A frame that took it and
 * then left with the file hands it on the same way.
 */
export function answerOnStrip(frame: HTMLElement | null, outside: number | null) {
  if (wanted === null || !("frame" in wanted)) return;
  if (wanted.frame?.isConnected) return;
  if (!lost()) return drop();
  if (frame) {
    wanted = { frame };
    frame.focus({ preventScroll: true });
  } else if (outside !== null) {
    drop();
    focusPicture(outside);
  }
}

function nameOf(button: HTMLButtonElement) {
  const label = button.getAttribute("aria-label");
  if (label !== null) return label;
  return [...button.childNodes]
    .filter((node) => !(node instanceof Element && node.getAttribute("aria-hidden") === "true"))
    .map((node) => node.textContent)
    .join("")
    .trim();
}
