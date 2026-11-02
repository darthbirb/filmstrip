import { test } from "vitest";
import { probe } from "./run";
test("cold", () => probe(36), 120_000);
