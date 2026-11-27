// SPDX-License-Identifier: AGPL-3.0-or-later

export interface CadSafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ComputeCadSafeInsetsInput {
  isFloatingLayout: boolean;
  containerWidth: number;
  containerHeight: number;
  treeVisible: boolean;
  treeWidth: number;
  isFullScreenSplitCanvas: boolean;
  splitDirection: "columns" | "rows" | "none";
  splitRatio: number;
  diagnosticsBottomOffset: number;
}

/**
 * Computes unobstructed viewport safe-zone insets (px) for the 3D CAD canvas
 * and all HUD overlays so nothing ever clips under the floating topbar, left
 * sidebar, floating split Code Editor, or bottom Diagnostics drawer.
 */
export function computeCadSafeInsets(input: ComputeCadSafeInsetsInput): CadSafeInsets | undefined {
  if (!input.isFloatingLayout) {
    return undefined;
  }

  const safeW = Number.isFinite(input.containerWidth) && input.containerWidth > 0 ? input.containerWidth : 1200;
  const safeH = Number.isFinite(input.containerHeight) && input.containerHeight > 0 ? input.containerHeight : 800;
  const clampedRatio = Math.min(0.85, Math.max(0.15, Number.isFinite(input.splitRatio) ? input.splitRatio : 0.6));

  // Floating navbar sits at top: 12px, height: 48px → 60px + 12px breathing room
  const top = 72;

  // Left sidebar sits at left: 12px, width: treeWidth → treeWidth + 24px margin
  const left = (input.treeVisible ? Math.max(0, Math.round(input.treeWidth)) + 24 : 12) + 8;

  // Floating Code Editor in SPLIT_COLUMNS occupies `left: calc(splitRatio * 100% + 6px)` to `right: 12px`.
  // Its unobstructed right boundary for the 3D viewport is `(1 - splitRatio) * containerWidth + 12`.
  const splitRightOcclusion =
    input.isFullScreenSplitCanvas && input.splitDirection === "columns"
      ? Math.round((1 - clampedRatio) * safeW) + 12
      : 0;
  const right = 12 + splitRightOcclusion;

  // Bottom Diagnostics drawer dynamically reports its height + gap via diagnosticsBottomOffset.
  // In SPLIT_ROWS, the floating Code Editor occupies the bottom `(1 - splitRatio) * containerHeight`.
  const baseBottom = Math.max(12, Math.round(input.diagnosticsBottomOffset || 12));
  const splitBottomOcclusion =
    input.isFullScreenSplitCanvas && input.splitDirection === "rows" ? Math.round((1 - clampedRatio) * safeH) + 12 : 0;
  const bottom = Math.max(baseBottom, splitBottomOcclusion) + 8;

  return {
    top,
    right: Math.min(right, Math.max(16, safeW - left - 180)),
    bottom: Math.min(bottom, Math.max(16, safeH - top - 160)),
    left,
  };
}
