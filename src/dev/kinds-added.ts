import { expect } from "vitest";

import { setRefused } from "../app/navigation/refusal-store";
import type { SourceKind } from "../ipc/bindings/SourceKind";
import { recording } from "./recording";

/**
 * For tests: the kind of source each `add_source` asks for while `press` runs. The picker answers
 * with a folder that is then refused, so the dev mock's library stays as it was.
 */
export async function kindsAdded(press: () => Promise<unknown>) {
  let asked: unknown[] = [];
  await recording(
    async (calls) => {
      await press();
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
  return asked.map((args) => (args as { kind: SourceKind }).kind);
}
