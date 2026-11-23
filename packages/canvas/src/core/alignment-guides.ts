// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasTile, WorldBounds } from "../schema/canvas-document.js";

export interface AlignmentGuideLine {
  orientation: "vertical" | "horizontal";
  /** World X (if vertical) or World Y (if horizontal). */
  position: number;
  start: number;
  end: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: AlignmentGuideLine[];
}

/**
 * Computes Figma/Miro-style smart alignment snapping (left, center, right, top, middle, bottom)
 * between a dragged tile and neighboring tiles on the infinite canvas.
 */
export function computeSnapAndGuides(
  dragging: WorldBounds,
  otherTiles: readonly Pick<CanvasTile, "bounds">[],
  thresholdWorld = 10,
): SnapResult {
  let snappedX = dragging.x;
  let snappedY = dragging.y;
  let bestDx = thresholdWorld + 1;
  let bestDy = thresholdWorld + 1;
  let bestVGuide: AlignmentGuideLine | null = null;
  let bestHGuide: AlignmentGuideLine | null = null;

  const dragXs = [
    { val: dragging.x, offset: 0 },
    { val: dragging.x + dragging.width / 2, offset: dragging.width / 2 },
    { val: dragging.x + dragging.width, offset: dragging.width },
  ];
  const dragYs = [
    { val: dragging.y, offset: 0 },
    { val: dragging.y + dragging.height / 2, offset: dragging.height / 2 },
    { val: dragging.y + dragging.height, offset: dragging.height },
  ];

  for (const other of otherTiles) {
    const ob = other.bounds;
    const otherXs = [ob.x, ob.x + ob.width / 2, ob.x + ob.width];
    const otherYs = [ob.y, ob.y + ob.height / 2, ob.y + ob.height];

    for (const dxCand of dragXs) {
      for (const ox of otherXs) {
        const diff = Math.abs(dxCand.val - ox);
        if (diff <= thresholdWorld && diff < bestDx) {
          bestDx = diff;
          snappedX = ox - dxCand.offset;
          bestVGuide = {
            orientation: "vertical",
            position: ox,
            start: Math.min(dragging.y, ob.y) - 24,
            end: Math.max(dragging.y + dragging.height, ob.y + ob.height) + 24,
          };
        }
      }
    }

    for (const dyCand of dragYs) {
      for (const oy of otherYs) {
        const diff = Math.abs(dyCand.val - oy);
        if (diff <= thresholdWorld && diff < bestDy) {
          bestDy = diff;
          snappedY = oy - dyCand.offset;
          bestHGuide = {
            orientation: "horizontal",
            position: oy,
            start: Math.min(dragging.x, ob.x) - 24,
            end: Math.max(dragging.x + dragging.width, ob.x + ob.width) + 24,
          };
        }
      }
    }
  }

  const guides: AlignmentGuideLine[] = [];
  if (bestVGuide) guides.push(bestVGuide);
  if (bestHGuide) guides.push(bestHGuide);

  return { x: Math.round(snappedX), y: Math.round(snappedY), guides };
}
