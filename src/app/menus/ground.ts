import type { HeadedMenu, MenuAnchor } from "../../ui/Menu";
import type { Place } from "../place";

/** A point in the window, where the ground's menu opened and what its verbs open against. */
export type Point = { x: number; y: number };

/** What a place menu's follow-ups open against: a menu, a picker, and the export sheet hung under it. */
export type Against = { anchor: () => MenuAnchor; sheet: () => HTMLElement | null };

/**
 * Navigation's menu for a place, the one its row has, opened somewhere other than its row: the
 * grid's ground, a search's folder card, the pane's ⋯. DECISIONS.md "Right-click menus".
 */
export type PlaceMenu = (place: Place, against: Against) => HeadedMenu;

/** A menu has handed the focus back to what opened it by the time a verb runs. */
export const fromFocus: Against = {
  anchor: () => {
    const element = document.activeElement;
    return element instanceof HTMLElement ? { element } : { x: 0, y: 0 };
  },
  sheet: () => {
    const element = document.activeElement;
    return element instanceof HTMLElement ? element : null;
  },
};

let menu: PlaceMenu = () => ({ groups: [] });

/** Navigation says what each place's menu holds; the newest answer stands. */
export function setPlaceMenu(next: PlaceMenu) {
  menu = next;
}

/** A place's menu under its name, its verbs opening `against` where it was asked from. */
export function placeMenu(place: Place, against: Against) {
  return menu(place, against);
}

/** The menu a right-click on the grid's ground opens: the place's own, under its name. */
export function groundMenu(place: Place, at: Point) {
  return menu(place, { anchor: () => at, sheet: placeHeader });
}

/** The header naming the place, which a sheet asked for from the ground hangs under. */
export function placeHeader() {
  return document.querySelector<HTMLElement>('button[aria-label="Details"]');
}
