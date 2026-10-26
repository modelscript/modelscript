// SPDX-License-Identifier: AGPL-3.0-or-later

export interface PlacementOptions {
  className: string;
  classKind?: string;
  iconSvg?: string | undefined;
  isDrag?: boolean;
}

declare global {
  interface Window {
    __startPlacement?: (opts: PlacementOptions) => void;
    __movePlacementGhost?: (x: number, y: number) => void;
    __hidePlacementGhost?: () => void;
    __clearPlacement?: () => void;
    __handlePlacementClick?: (e: MouseEvent) => void;
    __handleDragEnd?: () => void;
  }
}

/**
 * Initiates component placement on the active diagram canvas.
 */
export function startPlacement(opts: PlacementOptions): void {
  if (typeof window !== "undefined" && typeof window.__startPlacement === "function") {
    window.__startPlacement(opts);
  }
}

/**
 * Updates placement ghost coordinates during drag-over.
 */
export function movePlacementGhost(x: number, y: number): void {
  if (typeof window !== "undefined" && typeof window.__movePlacementGhost === "function") {
    window.__movePlacementGhost(x, y);
  }
}

/**
 * Clears placement state and removes ghost indicators.
 */
export function clearPlacement(): void {
  if (typeof window !== "undefined") {
    window.__hidePlacementGhost?.();
    window.__clearPlacement?.();
  }
}
