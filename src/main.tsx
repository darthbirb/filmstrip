import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { suppressBrowserMenu } from "./app/browser-menu";
import { watchExports } from "./app/export/export";
import { startIndex } from "./app/navigation/index-store";
import { watchWork } from "./app/navigation/work-store";
import { watchClipboard } from "./app/paste/clipboard";
import { watchCopies } from "./app/paste/copy";
import { loadPreferences } from "./app/preferences";
import "./styles/app.css";

// Outside Tauri, the app renders against Tauri's own mocks. DEVELOPMENT.md "Seeing the app".
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  await import("./dev/mock");
}
suppressBrowserMenu();
await loadPreferences();
void startIndex();
void watchWork();
void watchCopies();
void watchExports();
watchClipboard();

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
