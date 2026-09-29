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
      return `${why.key}: cannot take ${why.value}.`;
    case "missingTerm":
      return "OR and a leading - each need a term.";
  }
}

/** Whether the fault is one character the field can mark where it stands. */
export function marksCharacter(why: Fault) {
  return (
    why.kind === "unclosedGroup" || why.kind === "unclosedQuote" || why.kind === "unopenedGroup"
  );
}
