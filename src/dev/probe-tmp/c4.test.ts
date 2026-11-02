import { test } from "vitest";
import { probe } from "./run";
test("cold", () => probe(37), 120_000);
