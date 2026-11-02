import { test } from "vitest";
import { probe } from "./run";
test("cold", () => probe(33), 120_000);
