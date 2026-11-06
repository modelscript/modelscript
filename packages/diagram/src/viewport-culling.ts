// SPDX-License-Identifier: AGPL-3.0-or-later

import { isEphemeralDiagramNode } from "./drop-placeholder.js";

export interface ViewportCullingGraphNode {
  id: string;
  getPosition?: (() => { x: number; y: number } | undefined) | undefined;
  getSize?: (() => { width: number; height: number } | undefined) | undefined;
}

export interface ViewportCullingGraph<TNode extends ViewportCullingGraphNode = ViewportCullingGraphNode> {
  disposed?: boolean | undefined;
  container?: HTMLElement | { clientWidth?: number; clientHeight?: number } | null | undefined;
  getNodes: () => TNode[];
  scale?: (() => { sx: number; sy: number }) | undefined;
  translate?: (() => { tx: number; ty: number }) | undefined;
  findViewByCell?: ((cell: TNode) => { container?: unknown } | null | undefined) | undefined;
}

/** Pending RAF handle for coalescing viewport virtualization/culling passes. */
let viewportCullRaf: number | null = null;

/**
 * Schedules a debounced viewport culling pass for large diagrams (>250 nodes).
 * Temporarily hides SVG nodes completely outside the container viewport to ensure 60fps
 * panning and zooming in massive models.
 */
export function scheduleViewportCulling<TNode extends ViewportCullingGraphNode>(g: ViewportCullingGraph<TNode>) {
  if (!g || g.disposed) return;
  if (typeof document === "undefined") return;
  if (viewportCullRaf !== null) return;

  viewportCullRaf = requestAnimationFrame(() => {
    viewportCullRaf = null;
    if (!g || g.disposed) return;
    performViewportCulling(g);
  });
}

/**
 * Evaluates node bounding boxes against the current visible viewport rectangle in graph coordinates
 * and sets visibility: hidden on elements outside the viewport buffer for large diagrams (>250 nodes).
 */
export function performViewportCulling<TNode extends ViewportCullingGraphNode>(g: ViewportCullingGraph<TNode>) {
  if (!g || g.disposed || typeof document === "undefined") return;
  const container = g.container;
  if (!container) return;

  const nodes = g.getNodes();
  if (nodes.length <= 250) {
    return;
  }

  const width = (container as HTMLElement).clientWidth || 800;
  const height = (container as HTMLElement).clientHeight || 600;
  const { sx, sy } = typeof g.scale === "function" ? g.scale() : { sx: 1, sy: 1 };
  const { tx, ty } = typeof g.translate === "function" ? g.translate() : { tx: 0, ty: 0 };

  const buffer = 150;
  const visibleMinX = -tx / sx - buffer;
  const visibleMinY = -ty / sy - buffer;
  const visibleMaxX = (-tx + width) / sx + buffer;
  const visibleMaxY = (-ty + height) / sy + buffer;

  for (const node of nodes) {
    if (isEphemeralDiagramNode(node.id)) continue;
    const pos = node.getPosition?.();
    const size = node.getSize?.();
    if (!pos || !size) continue;

    const nodeMaxX = pos.x + (size.width || 0);
    const nodeMaxY = pos.y + (size.height || 0);

    const isVisible =
      nodeMaxX >= visibleMinX && pos.x <= visibleMaxX && nodeMaxY >= visibleMinY && pos.y <= visibleMaxY;

    const view = g.findViewByCell?.(node);
    const el =
      (view?.container as HTMLElement | undefined) ??
      (document.querySelector(`[data-cell-id="${node.id}"]`) as HTMLElement | null);
    if (el) {
      const targetVisibility = isVisible ? "" : "hidden";
      if (el.style.visibility !== targetVisibility) {
        el.style.visibility = targetVisibility;
      }
    }
  }
}
