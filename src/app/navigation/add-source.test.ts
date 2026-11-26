import { expect, test } from "vitest";

import { refusalSentence } from "./add-source";

test("each refusal is one sentence, its apostrophe typographic", () => {
  expect(refusalSentence("same", "Pictures")).toBe("Pictures already reads that folder.");
  expect(refusalSentence("appFolder", null)).toBe("That folder holds Filmstrip’s own files.");
});
