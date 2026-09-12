import type { ReactNode } from "react";

import { Columns } from "./Columns";
import { Floating } from "./Floating";
import { Toolbar } from "./Toolbar";

/** What fills the frame. Each region belongs to a later slice. */
export type Regions = {
  nav?: ReactNode;
  toolbar?: ReactNode;
  grid?: ReactNode;
  pane?: ReactNode;
};

// The frame slice's candidates, until the user picks one. DEVELOPMENT.md "Slices".
export const FRAMES = {
  columns: Columns,
  toolbar: Toolbar,
  floating: Floating,
};

export type FrameName = keyof typeof FRAMES;
