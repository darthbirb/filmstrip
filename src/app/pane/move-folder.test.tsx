import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import type { AppError } from "../../ipc/commands";
import { updatePreferences } from "../preferences";
import { ReportBanner } from "../undo/ReportBanner";
import { showReport } from "../undo/report-store";
import { moveFolderTo } from "./move-picker";

const CAIRO = { id: 6, name: "Cairo" };
const INBOX = { id: 9, parentId: 1, sourceId: 1, title: "Inbox", itemCount: 0, allCount: 0 };
const FROM = { folderId: 4, path: ["Pictures", "Trips"] };

let refusal: AppError;

beforeEach(() => {
  showReport(null);
  updatePreferences({ recent: [] });
  mockIPC((cmd) => {
    if (cmd === "move_folder") return Promise.reject(refusal);
    return undefined;
  });
});

afterEach(() => showReport(null));

test("a folder the index no longer has is the move's banner, said in its own words", async () => {
  refusal = { kind: "refused", reason: { kind: "notIndexed" } };
  const screen = await render(<ReportBanner />);

  await moveFolderTo(CAIRO, INBOX, FROM);

  await expect.element(screen.getByText("Cairo could not go to Inbox")).toBeVisible();
  await expect.element(screen.getByText("No longer in the index")).toBeVisible();
});

test("a failure that is no refusal opens no banner", async () => {
  refusal = { kind: "db", reason: { kind: "busy" } };
  const screen = await render(<ReportBanner />);

  await moveFolderTo(CAIRO, INBOX, FROM);

  expect(screen.getByText(/could not go/).elements()).toHaveLength(0);
});
