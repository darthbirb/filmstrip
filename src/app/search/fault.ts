import type { Fault } from "../../ipc/bindings/Fault";

/**
 * Why a query does not read, in one sentence naming the character. Nothing for an empty field,
 * which is not a fault anyone made. Components › "The field holds the query".
 */
export function faultSentence(why: Fault): string | null {
  switch (why.kind) {
    case "empty":
      return null;
    case "unclosedGroup":
      return why.after ? `The ( after ${why.after} is never closed.` : "The ( is never closed.";
    case "unclosedQuote":
      return why.before
        ? `The quote before ${why.before} is never closed.`
        : "The quote is never closed.";
    case "unopenedGroup":
      return "The ) closes nothing.";
    case "badValue":
      return badValue(why.key);
    case "missingTerm":
      return "Put a term after OR and after -.";
  }
}

/** The keys `query::parser::keyed` refuses a value for: every other key takes any value. */
type Faulting = "year" | "date" | "dur" | "size" | "w" | "h" | "is" | "status";

/** What a key takes, said with one that it would: never the value it could not read. */
const TAKES: Record<Faulting, string> = {
  year: "needs a number, like year:2024",
  date: "needs a date, like date:2024-06 or date:2024-06..2024-08",
  dur: "needs a length, like dur:>30s",
  size: "needs a size, like size:>2mb",
  w: "needs a number of pixels, like w:>1920",
  h: "needs a number of pixels, like h:>1080",
  is: "takes favorite, untagged, sorting or trashed",
  status: "takes wip, complete or none",
};

const faulting = (key: string): key is Faulting => Object.hasOwn(TAKES, key);

/** The fault's key crosses IPC as a string, so one the parser gains before this list is said plainly. */
function badValue(key: string) {
  const lower = key.toLowerCase();
  return faulting(lower) ? `${key} ${TAKES[lower]}.` : `${key} cannot take that value.`;
}

/** Whether the fault is one character the field can mark where it stands. */
export function marksCharacter(why: Fault) {
  return (
    why.kind === "unclosedGroup" || why.kind === "unclosedQuote" || why.kind === "unopenedGroup"
  );
}
