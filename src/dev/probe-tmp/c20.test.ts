import { test } from "vitest";
import { probe } from "./run";
test("cold", () => probe("beat"), 120_000);
