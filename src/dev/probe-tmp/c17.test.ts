import { test } from "vitest";
import { probe } from "./run";
test("cold", () => probe("plain"), 120_000);
