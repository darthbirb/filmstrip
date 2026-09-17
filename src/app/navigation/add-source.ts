import type { Refusal } from "../../ipc/bindings/Refusal";
import type { SourceKind } from "../../ipc/bindings/SourceKind";
import { addSource, pickFolder } from "../../ipc/commands";
import { loadIndex } from "./index-store";
import { setRefused } from "./refusal-store";

/** One sentence per refusal. Three name the source in the way, because that is what decides what to do next. */
export function refusalSentence(why: Refusal, clash: string | null) {
  switch (why) {
    case "same":
      return `${clash} already reads that folder.`;
    case "inside":
      return `That folder is already inside ${clash}.`;
    case "contains":
      return `That folder contains ${clash}, which Filmstrip already reads.`;
    case "appFolder":
      return "That folder belongs to Filmstrip itself.";
  }
}

/**
 * The picker, then the folder. Which doorway was pressed is the kind, so nothing is
 * asked afterwards. DECISIONS.md "Places, not queries".
 */
export async function addFolder(kind: SourceKind) {
  const root = await pickFolder().catch(() => null);
  // A cancelled picker is not an error and is not reported: they know they cancelled.
  if (root === null) return;
  const outcome = await addSource(root, kind);
  if (outcome.kind === "refused") {
    setRefused({ why: outcome.why, clash: outcome.clash, path: root });
    return;
  }
  setRefused(null);
  await loadIndex().catch(() => undefined);
}
