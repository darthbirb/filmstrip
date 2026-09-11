import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";

mockWindows("main");
mockIPC(() => undefined);
