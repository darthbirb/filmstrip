import { createContext, type ReactNode, useContext } from "react";

import { usePaneItem } from "./pane-store";
import { type Shown, useItemDetail } from "./useItemDetail";

const PaneDetail = createContext<Shown>({ status: "empty" });

/** Reads the pane's item once for both halves of the pane: its header row and its body. */
export function PaneDetailProvider({ children }: { children: ReactNode }) {
  return <PaneDetail value={useItemDetail(usePaneItem())}>{children}</PaneDetail>;
}

export function usePaneDetail() {
  return useContext(PaneDetail);
}
