// SPDX-License-Identifier: AGPL-3.0-or-later

import { isEphemeralDiagramNode } from "./drop-placeholder.js";

export interface ViewportCullingGraphNode {
  id: string;
  getPosition?: (() => { x: number; y: number } | undefined) | undefined;
  getSize?: (() => { width: number; height: number } | undefined) | undefined;
}

export interface ViewportCullingGraphEdge {
  id: string;
  getSourcePoint?: (() => { x: number; y: number } | null | undefined) | undefined;
  getTargetPoint?: (() => { x: number; y: number } | null | undefined) | undefined;
  getVertices?: (() => { x: number; y: number }[] | null | undefined) | undefined;
}

export interface ViewportCullingGraph<
  TNode extends ViewportCullingGraphNode = ViewportCullingGraphNode,
  TEdge extends ViewportCullingGraphEdge = ViewportCullingGraphEdge,
> {
  disposed?: boolean | undefined;
  container?: HTMLElement | { clientWidth?: number; clientHeight?: number } | null | undefined;
  getWidth?: (() => number) | undefined;
  getHeight?: (() => number) | undefined;
  getNodes: () => TNode[];
  getEdges?: (() => TEdge[]) | undefined;
  scale?: (() => { sx: number; sy: number }) | undefined;
  translate?: (() => { tx: number; ty: number }) | undefined;
  findViewByCell?:
    | ((
        cell: TNode | TEdge,
      ) => { container?: unknown; routePoints?: { x: number; y: number }[] | undefined } | null | undefined)
    | undefined;
}

export type DiagramLodTier = "full" | "medium" | "low";

/**
 * Resolves the Level-of-Detail (LOD) rendering tier from the current zoom scale.
 * - `full` (>= 0.65): all labels, ports, compartments, and shadows visible
 * - `medium` (0.2 - 0.65): strip expensive SVG filter shadows
 * - `low` (< 0.2): strip shadows and hide micro-labels/port badges for smooth macro panning
 */
export function resolveDiagramLodTier(scale: number): DiagramLodTier {
  if (!Number.isFinite(scale) || scale >= 0.65) return "full";
  if (scale >= 0.2) return "medium";
  return "low";
}

export interface SpatialBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Lightweight uniform-grid spatial index for O(K_visible) viewport frustum queries
 * on large diagrams (>250 nodes/edges).
 */
export class SpatialGridIndex<T> {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, T[]>();
  private readonly oversized: { item: T; bounds: SpatialBounds }[] = [];
  private static readonly MAX_SPAN = 64;

  constructor(cellSize = 256) {
    this.cellSize = Math.max(32, cellSize);
  }

  public clear(): void {
    this.buckets.clear();
    this.oversized.length = 0;
  }

  public insert(item: T, bounds: SpatialBounds): void {
    const x0 = Math.floor(bounds.minX / this.cellSize);
    const y0 = Math.floor(bounds.minY / this.cellSize);
    const x1 = Math.floor(bounds.maxX / this.cellSize);
    const y1 = Math.floor(bounds.maxY / this.cellSize);
    if (x1 - x0 > SpatialGridIndex.MAX_SPAN || y1 - y0 > SpatialGridIndex.MAX_SPAN) {
      this.oversized.push({ item, bounds });
      return;
    }
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const key = `${gx},${gy}`;
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = [];
          this.buckets.set(key, bucket);
        }
        bucket.push(item);
      }
    }
  }

  public query(bounds: SpatialBounds): Set<T> {
    const out = new Set<T>();
    const x0 = Math.floor(bounds.minX / this.cellSize);
    const y0 = Math.floor(bounds.minY / this.cellSize);
    const x1 = Math.floor(bounds.maxX / this.cellSize);
    const y1 = Math.floor(bounds.maxY / this.cellSize);
    if (x1 - x0 > SpatialGridIndex.MAX_SPAN || y1 - y0 > SpatialGridIndex.MAX_SPAN) {
      // Very zoomed out: return all items
      for (const bucket of this.buckets.values()) {
        for (const item of bucket) out.add(item);
      }
      for (const entry of this.oversized) out.add(entry.item);
      return out;
    }
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const bucket = this.buckets.get(`${gx},${gy}`);
        if (!bucket) continue;
        for (const item of bucket) {
          out.add(item);
        }
      }
    }
    for (const entry of this.oversized) {
      if (
        entry.bounds.minX <= bounds.maxX &&
        entry.bounds.maxX >= bounds.minX &&
        entry.bounds.minY <= bounds.maxY &&
        entry.bounds.maxY >= bounds.minY
      ) {
        out.add(entry.item);
      }
    }
    return out;
  }
}

/** Per-graph pending RAF handles so multiple mounted diagrams never drop each other's culling passes. */
const viewportCullRafs = new WeakMap<object, number>();
const culledGraphs = new WeakSet<object>();

function escapeAttrValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function findCellElement<TNode extends ViewportCullingGraphNode, TEdge extends ViewportCullingGraphEdge>(
  g: ViewportCullingGraph<TNode, TEdge>,
  cell: TNode | TEdge,
): HTMLElement | null {
  const view = g.findViewByCell?.(cell);
  if (view?.container) {
    return view.container as HTMLElement;
  }
  if (!g.container || typeof (g.container as HTMLElement).querySelector !== "function") {
    return null;
  }
  try {
    return (g.container as HTMLElement).querySelector(
      `[data-cell-id="${escapeAttrValue(cell.id)}"]`,
    ) as HTMLElement | null;
  } catch {
    return null;
  }
}

/**
 * Schedules a debounced viewport culling pass for large diagrams (>250 nodes).
 * Temporarily hides SVG nodes and edges completely outside the container viewport to ensure 60fps
 * panning and zooming in massive models.
 */
export function scheduleViewportCulling<
  TNode extends ViewportCullingGraphNode,
  TEdge extends ViewportCullingGraphEdge = ViewportCullingGraphEdge,
>(g: ViewportCullingGraph<TNode, TEdge>) {
  if (!g || g.disposed) return;
  if (typeof document === "undefined") return;
  if (viewportCullRafs.has(g)) return;

  const rafId = requestAnimationFrame(() => {
    viewportCullRafs.delete(g);
    if (!g || g.disposed) return;
    performViewportCulling(g);
  });
  viewportCullRafs.set(g, rafId);
}

/**
 * Evaluates node and edge bounding boxes against the current visible viewport rectangle in graph coordinates
 * and sets visibility: hidden on elements outside the viewport buffer for large diagrams (>250 nodes).
 */
export function performViewportCulling<
  TNode extends ViewportCullingGraphNode,
  TEdge extends ViewportCullingGraphEdge = ViewportCullingGraphEdge,
>(g: ViewportCullingGraph<TNode, TEdge>) {
  if (!g || g.disposed || typeof document === "undefined") return;
  const container = g.container;
  if (!container) return;

  const { sx, sy } = typeof g.scale === "function" ? g.scale() : { sx: 1, sy: 1 };
  const lodTier = resolveDiagramLodTier(Math.min(sx, sy));
  if (typeof (container as HTMLElement).setAttribute === "function") {
    if ((container as HTMLElement).getAttribute("data-diagram-lod") !== lodTier) {
      (container as HTMLElement).setAttribute("data-diagram-lod", lodTier);
    }
  }

  const nodes = g.getNodes();
  const edges = typeof g.getEdges === "function" ? g.getEdges() : [];
  if (nodes.length <= 250) {
    if (culledGraphs.has(g)) {
      culledGraphs.delete(g);
      for (const node of nodes) {
        if (isEphemeralDiagramNode(node.id)) continue;
        const el = findCellElement(g, node);
        if (el && el.style.visibility === "hidden") {
          el.style.visibility = "";
        }
      }
      for (const edge of edges) {
        const el = findCellElement(g, edge);
        if (el && el.style.visibility === "hidden") {
          el.style.visibility = "";
        }
      }
    }
    return;
  }
  culledGraphs.add(g);

  const width = (typeof g.getWidth === "function" ? g.getWidth() : 0) || (container as HTMLElement).clientWidth || 800;
  const height =
    (typeof g.getHeight === "function" ? g.getHeight() : 0) || (container as HTMLElement).clientHeight || 600;
  const { tx, ty } = typeof g.translate === "function" ? g.translate() : { tx: 0, ty: 0 };

  const buffer = 150;
  const visibleBounds: SpatialBounds = {
    minX: -tx / sx - buffer,
    minY: -ty / sy - buffer,
    maxX: (-tx + width) / sx + buffer,
    maxY: (-ty + height) / sy + buffer,
  };

  const spatialIndex = new SpatialGridIndex<TNode | TEdge>(256);
  const trackedNodes: TNode[] = [];
  for (const node of nodes) {
    if (isEphemeralDiagramNode(node.id)) continue;
    const pos = node.getPosition?.();
    const size = node.getSize?.();
    if (!pos || !size) continue;
    trackedNodes.push(node);
    spatialIndex.insert(node, {
      minX: pos.x,
      minY: pos.y,
      maxX: pos.x + (size.width || 0),
      maxY: pos.y + (size.height || 0),
    });
  }

  const trackedEdges: TEdge[] = [];
  for (const edge of edges) {
    const src = edge.getSourcePoint?.();
    const tgt = edge.getTargetPoint?.();
    const verts = edge.getVertices?.() ?? [];
    const routePts = g.findViewByCell?.(edge)?.routePoints ?? [];
    if (!src && !tgt && verts.length === 0 && routePts.length === 0) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const includePoint = (pt: { x: number; y: number } | null | undefined) => {
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    };
    includePoint(src);
    includePoint(tgt);
    for (const v of verts) includePoint(v);
    for (const rp of routePts) includePoint(rp);
    if (!Number.isFinite(minX)) continue;
    trackedEdges.push(edge);
    spatialIndex.insert(edge, { minX, minY, maxX, maxY });
  }

  const visibleCells = spatialIndex.query(visibleBounds);

  const applyVisibility = (cell: TNode | TEdge) => {
    const isVisible = visibleCells.has(cell);
    const el = findCellElement(g, cell);
    if (!el) return;
    const currentlyHidden = el.style.visibility === "hidden";
    if (isVisible && currentlyHidden) {
      el.style.visibility = "";
    } else if (!isVisible && !currentlyHidden) {
      el.style.visibility = "hidden";
    }
  };

  for (const node of trackedNodes) applyVisibility(node);
  for (const edge of trackedEdges) applyVisibility(edge);
}
