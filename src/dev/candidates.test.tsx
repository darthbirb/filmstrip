import { beforeEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { CANDIDATE_KEY, COMPARE, useCandidate } from "../app/candidates";
import { CandidatePicker } from "./CandidatePicker";
import { CompareCandidates } from "./CompareCandidates";

// The mechanism every slice compares its candidates with, exercised on a stand-in slice.
const KEY = `${CANDIDATE_KEY}test-slice`;
const NAMES = ["plain", "bold"] as const;
const CANDIDATES = {
  plain: () => <p>plain candidate</p>,
  bold: () => <p>bold candidate</p>,
};

function Slice() {
  const [choice, choose] = useCandidate("test-slice", NAMES);
  return (
    <>
      {choice === COMPARE ? <CompareCandidates candidates={CANDIDATES} /> : <p>showing {choice}</p>}
      <CandidatePicker
        slice="test-slice"
        names={[...NAMES, COMPARE]}
        current={choice}
        onChoose={choose}
      />
    </>
  );
}

beforeEach(() => {
  localStorage.removeItem(KEY);
});

test("a slice opens on the comparison, then switches live by click or by digit", async () => {
  const screen = await render(<Slice />);
  await expect.element(screen.getByText("plain candidate")).toBeInTheDocument();
  await expect.element(screen.getByText("bold candidate")).toBeInTheDocument();

  await screen.getByRole("button", { name: "1 plain" }).click();
  await expect.element(screen.getByText("showing plain")).toBeInTheDocument();

  await userEvent.keyboard("2");
  await expect.element(screen.getByText("showing bold")).toBeInTheDocument();
  expect(localStorage.getItem(KEY)).toBe("bold");
});
