import { mockIPC } from "@tauri-apps/api/mocks";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { App } from "./App";

test("Close asks Tauri to close the window", async () => {
  const commands: string[] = [];
  mockIPC((cmd) => {
    commands.push(cmd);
  });

  const screen = await render(<App />);
  await screen.getByRole("button", { name: "Close" }).click();

  expect(commands).toContain("plugin:window|close");
});
