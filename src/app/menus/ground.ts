import type { HeadedMenu } from "../../ui/Menu";
import type { Place } from "../place";

/** A point in the window, where the ground's menu opened and what its verbs open against. */
export type Point = { x: number; y: number };

/**
 * Navigation's menu for a place, the one its row has, opened from the grid's ground instead.
 * DECISIONS.md "Right-click menus".
 */
export type GroundMenu = (place: Place, at: Point) => HeadedMenu;

let menu: GroundMenu = () => ({ groups: [] });

/** Navigation says what each place's ground holds; the newest answer stands. */
export function setGroundMenu(next: GroundMenu) {
  menu = next;
}

/** The menu a right-click on the grid's ground opens: the place's own, under its name. */
export function groundMenu(place: Place, at: Point) {
  return menu(place, at);
}

/** The header naming the place, which a sheet asked for from the ground hangs under. */
export function placeHeader() {
  return document.querySelector<HTMLElement>('button[aria-label="Details"]');
}
