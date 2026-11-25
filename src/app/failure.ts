import { setNews } from "./navigation/foot-slot";
import { whyFailed } from "./undo/lines";

/** Says at the foot what could not be done, then why: never the error's own text. */
export function sayFailed(what: string, error: unknown) {
  setNews({ kind: "failed", line: `${what} ${whyFailed(error)}` });
}

/** An act's catch, which says what could not be done: `.catch(failed("Could not copy x."))`. */
export const failed = (what: string) => (error: unknown) => sayFailed(what, error);

/**
 * The catch for work nobody asked for, a read again, a listener, a clip's play, whose failure has
 * no one to tell. Never an act's: `failed` says those.
 */
export const unasked = (): null => null;
