import { DrillNav } from "./DrillNav";
import { PlacesNav } from "./PlacesNav";
import { TreeNav } from "./TreeNav";

// The navigation slice's candidates, until the user picks one. DEVELOPMENT.md "Slices".
export const NAVIGATIONS = {
  tree: TreeNav,
  places: PlacesNav,
  drill: DrillNav,
};

export type NavigationName = keyof typeof NAVIGATIONS;
