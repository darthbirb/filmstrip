import { expect, test } from "vitest";

import fixture from "../../tests/fixtures/query-terms.json?raw";
import { bareTerm, labelTerm, pathTerm, quoteWord } from "./queryTerm";

type Case = { fn: string; args: unknown[]; expected: string };
const cases = JSON.parse(fixture) as Case[];

const writers: Record<string, (args: unknown[]) => string> = {
  quoteWord: ([value]) => quoteWord(value as string),
  pathTerm: ([titles, exact]) => pathTerm(titles as string[], exact as boolean),
  bareTerm: ([value]) => bareTerm(value as string),
  labelTerm: ([key, value]) => labelTerm(key as string, value as string),
};

test("each writer writes what the Rust writer does, case for case", () => {
  expect(cases.length).toBeGreaterThan(0);
  for (const { fn, args, expected } of cases) {
    const write = writers[fn];
    expect(write, fn).toBeDefined();
    expect(write?.(args), `${fn}(${JSON.stringify(args)})`).toBe(expected);
  }
});
