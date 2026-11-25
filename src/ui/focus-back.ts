import { useCallback, useRef } from "react";

/**
 * The control a field stands in for, given the focus back once it is drawn again: `arm` as the
 * field closes with the focus in it, and `ref` on the control.
 */
export function useFocusBack() {
  const armed = useRef(false);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element || !armed.current) return;
    armed.current = false;
    element.focus();
  }, []);
  const arm = useCallback(() => {
    armed.current = true;
  }, []);
  return { ref, arm };
}
