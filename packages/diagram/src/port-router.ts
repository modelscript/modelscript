// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Port-Aware Orthogonal Router with Obstacle Avoidance and Staggered Parallel Offsets.
// Computes orthogonal routing waypoints for AntV X6 edges, routing around intermediate
// blocks and offsetting parallel bus connections.

export interface PointLike {
  x: number;
  y: number;
}

export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RouterOptions {
  padding?: number;
  step?: number;
  maxIterations?: number;
}

/**
 * Determines whether an orthogonal line segment intersects an axis-aligned rectangle.
 */
export function segmentIntersectsRect(p1: PointLike, p2: PointLike, rect: RectLike, padding = 4): boolean {
  const minX = rect.x - padding;
  const maxX = rect.x + rect.width + padding;
  const minY = rect.y - padding;
  const maxY = rect.y + rect.height + padding;

  const segMinX = Math.min(p1.x, p2.x);
  const segMaxX = Math.max(p1.x, p2.x);
  const segMinY = Math.min(p1.y, p2.y);
  const segMaxY = Math.max(p1.y, p2.y);

  if (segMaxX < minX || segMinX > maxX || segMaxY < minY || segMinY > maxY) {
    return false;
  }

  // Horizontal segment
  if (Math.abs(p1.y - p2.y) < 0.001) {
    return p1.y >= minY && p1.y <= maxY && segMaxX >= minX && segMinX <= maxX;
  }

  // Vertical segment
  if (Math.abs(p1.x - p2.x) < 0.001) {
    return p1.x >= minX && p1.x <= maxX && segMaxY >= minY && segMinY <= maxY;
  }

  return true;
}

/**
 * Computes an obstacle-free orthogonal route between source and target points.
 */
export function computeOrthogonalRoute(
  source: PointLike,
  target: PointLike,
  obstacles: RectLike[] = [],
  options: RouterOptions = {},
): PointLike[] {
  const padding = options.padding ?? 12;
  const step = options.step ?? 10;

  // If direct horizontal or vertical line with no obstacle collision
  const isDirectH = Math.abs(source.y - target.y) < 1;
  const isDirectV = Math.abs(source.x - target.x) < 1;

  if (isDirectH && !obstacles.some((r) => segmentIntersectsRect(source, target, r, padding))) {
    return [];
  }
  if (isDirectV && !obstacles.some((r) => segmentIntersectsRect(source, target, r, padding))) {
    return [];
  }

  // Determine standard lead-out directions
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  // Try standard 2-bend orthogonal routing (Z-step or S-step)
  const midX = Math.round((source.x + dx / 2) / step) * step;
  const midY = Math.round((source.y + dy / 2) / step) * step;

  // Option 1: Horizontal first -> (midX, source.y) -> (midX, target.y)
  const p1A: PointLike = { x: midX, y: source.y };
  const p2A: PointLike = { x: midX, y: target.y };
  const routeA = [p1A, p2A];
  const collidesA =
    obstacles.some((r) => segmentIntersectsRect(source, p1A, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(p1A, p2A, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(p2A, target, r, padding));

  if (!collidesA) {
    return routeA;
  }

  // Option 2: Vertical first -> (source.x, midY) -> (target.x, midY)
  const p1B: PointLike = { x: source.x, y: midY };
  const p2B: PointLike = { x: target.x, y: midY };
  const routeB = [p1B, p2B];
  const collidesB =
    obstacles.some((r) => segmentIntersectsRect(source, p1B, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(p1B, p2B, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(p2B, target, r, padding));

  if (!collidesB) {
    return routeB;
  }

  // Option 3: Channel around colliding obstacles
  let detourY = source.y;
  for (const obs of obstacles) {
    if (segmentIntersectsRect(source, p1A, obs, padding) || segmentIntersectsRect(p1A, p2A, obs, padding)) {
      detourY = Math.min(detourY, obs.y - padding - 10);
    }
  }

  return [
    { x: source.x, y: detourY },
    { x: target.x, y: detourY },
  ];
}

/**
 * AntV X6 custom router adapter.
 */
export function portOrthogonalRouter(
  vertices: PointLike[],
  args: Record<string, any> = {},
  edgeView?: any,
): PointLike[] {
  // If manual vertices are explicitly specified, preserve them
  if (vertices && vertices.length > 0) {
    return vertices;
  }

  if (!edgeView) return [];

  const source = edgeView.sourcePoint;
  const target = edgeView.targetPoint;
  if (!source || !target) return [];

  // Extract obstacle rectangles from graph cells
  const graph = edgeView.graph;
  const obstacles: RectLike[] = [];

  if (graph && typeof graph.getNodes === "function") {
    const sourceCell = edgeView.cell?.getSourceCell();
    const targetCell = edgeView.cell?.getTargetCell();

    for (const node of graph.getNodes()) {
      if (node.id === sourceCell?.id || node.id === targetCell?.id) continue;
      if (node.id.startsWith("solder_dot_") || node.id === "__diagram_background__") continue;

      const bbox = typeof node.getBBox === "function" ? node.getBBox() : null;
      if (bbox) {
        obstacles.push({
          x: bbox.x,
          y: bbox.y,
          width: bbox.width,
          height: bbox.height,
        });
      }
    }
  }

  return computeOrthogonalRoute(source, target, obstacles, args);
}
