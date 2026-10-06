import { useLayoutEffect, useState, type RefObject } from "react";

const MARGIN = 8;

export interface Placement {
  left: number;
  top: number;
  maxHeight: number;
}

/**
 * Place a popup of `size` at `anchor` inside `viewport`: flip to the left / up
 * of the anchor when it would overflow, keep `margin` px from every edge, and
 * cap the height to the viewport (the popup scrolls past it).
 */
export function placePopup(
  anchor: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = MARGIN,
): Placement {
  const maxHeight = Math.max(0, viewport.height - 2 * margin);
  const height = Math.min(size.height, maxHeight);
  const fit = (pos: number, extent: number, limit: number) => {
    const placed = pos + extent > limit - margin ? pos - extent : pos;
    return Math.max(margin, Math.min(placed, limit - margin - extent));
  };
  return {
    left: fit(anchor.x, size.width, viewport.width),
    top: fit(anchor.y, height, viewport.height),
    maxHeight,
  };
}

/** Measure the popup behind `ref` after render and keep it inside the window. */
export function usePopupPlacement(
  ref: RefObject<HTMLElement | null>,
  anchor: { x: number; y: number } | null,
): Placement | null {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const ax = anchor?.x;
  const ay = anchor?.y;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || ax === undefined || ay === undefined) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    el.style.maxHeight = `${Math.max(0, viewport.height - 2 * MARGIN)}px`;
    const r = el.getBoundingClientRect();
    setPlacement(placePopup({ x: ax, y: ay }, r, viewport));
  }, [ref, ax, ay]);
  return placement;
}
