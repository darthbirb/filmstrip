import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { loadPreferences } from "./app/preferences";
import "./styles/app.css";

// Outside Tauri, the app renders against Tauri's own mocks. DEVELOPMENT.md "Seeing the app".
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  await import("./dev/mock");
}
await loadPreferences();

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
