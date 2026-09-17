/**
 * Whether an element can actually be seen, counting the fade a folded panel or a closed push-down
 * rests at. `toBeVisible` ignores opacity, and both of those surfaces stay in the tree.
 */
export function inSight(target: Element | null | { elements: () => Element[] }) {
  const element = target instanceof Element ? target : target?.elements()[0];
  return element?.checkVisibility({ opacityProperty: true }) === true;
}
