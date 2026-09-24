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
  parallelIndex?: number;
  parallelCount?: number;
  channelSpacing?: number;
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

interface GridNode {
  x: number;
  y: number;
  dir: "h" | "v" | "none";
  cost: number;
  bends: number;
  parent?: GridNode;
}

/**
 * Discovers and traverses internal corridor channels between obstacles using A* pathfinding.
 * Prefers minimal-bend highway corridors through inter-block gaps over outer bounding box detours.
 */
export function findInternalChannelRoute(
  source: PointLike,
  target: PointLike,
  obstacles: RectLike[],
  padding = 10,
  bendPenalty = 35,
): PointLike[] | null {
  if (obstacles.length === 0) return null;

  const xs = new Set<number>([source.x, target.x]);
  const ys = new Set<number>([source.y, target.y]);

  for (const obs of obstacles) {
    xs.add(obs.x - padding);
    xs.add(obs.x + obs.width + padding);
    ys.add(obs.y - padding);
    ys.add(obs.y + obs.height + padding);
  }

  // Add midpoints between obstacles if they form a corridor
  const sortedObsByX = [...obstacles].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sortedObsByX.length - 1; i++) {
    const o1 = sortedObsByX[i];
    const o2 = sortedObsByX[i + 1];
    const gap = o2.x - (o1.x + o1.width);
    if (gap > padding * 2) {
      xs.add(Math.round((o1.x + o1.width + o2.x) / 2));
    }
  }

  const sortedObsByY = [...obstacles].sort((a, b) => a.y - b.y);
  for (let i = 0; i < sortedObsByY.length - 1; i++) {
    const o1 = sortedObsByY[i];
    const o2 = sortedObsByY[i + 1];
    const gap = o2.y - (o1.y + o1.height);
    if (gap > padding * 2) {
      ys.add(Math.round((o1.y + o1.height + o2.y) / 2));
    }
  }

  const sortedX = Array.from(xs).sort((a, b) => a - b);
  const sortedY = Array.from(ys).sort((a, b) => a - b);

  const open: GridNode[] = [{ x: source.x, y: source.y, dir: "none", cost: 0, bends: 0 }];
  const closed = new Set<string>();

  const isSegmentValid = (p1: PointLike, p2: PointLike): boolean => {
    return !obstacles.some((r) => segmentIntersectsRect(p1, p2, r, padding - 2));
  };

  while (open.length > 0) {
    open.sort((a, b) => {
      const hA = Math.abs(target.x - a.x) + Math.abs(target.y - a.y) + a.bends * bendPenalty;
      const hB = Math.abs(target.x - b.x) + Math.abs(target.y - b.y) + b.bends * bendPenalty;
      return a.cost + hA - (b.cost + hB);
    });

    const curr = open.shift()!;
    if (curr.x === target.x && curr.y === target.y) {
      const path: PointLike[] = [];
      let c: GridNode | undefined = curr;
      while (c) {
        path.push({ x: c.x, y: c.y });
        c = c.parent;
      }
      path.reverse();

      // Simplify collinear points
      const simplified: PointLike[] = [path[0]];
      for (let i = 1; i < path.length - 1; i++) {
        const prev = simplified[simplified.length - 1];
        const next = path[i + 1];
        const p = path[i];
        const isCollinearH = Math.abs(prev.y - p.y) < 0.001 && Math.abs(p.y - next.y) < 0.001;
        const isCollinearV = Math.abs(prev.x - p.x) < 0.001 && Math.abs(p.x - next.x) < 0.001;
        if (!isCollinearH && !isCollinearV) {
          simplified.push(p);
        }
      }
      if (path.length > 1) {
        simplified.push(path[path.length - 1]);
      }
      return simplified;
    }

    const stateKey = `${curr.x},${curr.y},${curr.dir}`;
    if (closed.has(stateKey)) continue;
    closed.add(stateKey);

    // Expand horizontal moves
    for (const nx of sortedX) {
      if (nx === curr.x) continue;
      const nextP: PointLike = { x: nx, y: curr.y };
      if (!isSegmentValid(curr, nextP)) continue;
      const dist = Math.abs(nx - curr.x);
      const isBend = curr.dir === "v";
      open.push({
        x: nx,
        y: curr.y,
        dir: "h",
        cost: curr.cost + dist,
        bends: curr.bends + (isBend ? 1 : 0),
        parent: curr,
      });
    }

    // Expand vertical moves
    for (const ny of sortedY) {
      if (ny === curr.y) continue;
      const nextP: PointLike = { x: curr.x, y: ny };
      if (!isSegmentValid(curr, nextP)) continue;
      const dist = Math.abs(ny - curr.y);
      const isBend = curr.dir === "h";
      open.push({
        x: curr.x,
        y: ny,
        dir: "v",
        cost: curr.cost + dist,
        bends: curr.bends + (isBend ? 1 : 0),
        parent: curr,
      });
    }
  }

  return null;
}

/**
 * Computes an obstacle-free orthogonal route between source and target points,
 * supporting 4-way obstacle detours and parallel bus connection staggering.
 */
export function computeOrthogonalRoute(
  source: PointLike,
  target: PointLike,
  obstacles: RectLike[] = [],
  options: RouterOptions = {},
): PointLike[] {
  const padding = options.padding ?? 12;
  const step = options.step ?? 10;
  const parallelOffset = (options.parallelIndex ?? 0) * (options.channelSpacing ?? 8);

  // If direct horizontal or vertical line with no obstacle collision and no parallel offset
  const isDirectH = Math.abs(source.y - target.y) < 1;
  const isDirectV = Math.abs(source.x - target.x) < 1;

  if (parallelOffset === 0) {
    if (isDirectH && !obstacles.some((r) => segmentIntersectsRect(source, target, r, padding))) {
      return [];
    }
    if (isDirectV && !obstacles.some((r) => segmentIntersectsRect(source, target, r, padding))) {
      return [];
    }
  }

  // Determine standard lead-out directions
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  // Try standard 2-bend orthogonal routing (Z-step or S-step) with parallel staggering
  const midX = Math.round((source.x + dx / 2 + parallelOffset) / step) * step;
  const midY = Math.round((source.y + dy / 2 + parallelOffset) / step) * step;

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

  // Option 2.5: Internal Channel Corridor Routing via A*
  // Attempt to find a path weaving through inter-block corridors before outer perimeter detours
  const internalRoute = findInternalChannelRoute(source, target, obstacles, padding, 35);
  if (internalRoute && internalRoute.length >= 2) {
    return internalRoute.slice(1, -1);
  }

  // Option 3: 4-Way Detour evaluation around colliding obstacles
  // Test top, bottom, left, and right channels to select the shortest collision-free path
  const intersectingObstacles = obstacles.filter(
    (obs) =>
      segmentIntersectsRect(source, p1A, obs, padding) ||
      segmentIntersectsRect(p1A, p2A, obs, padding) ||
      segmentIntersectsRect(p2A, target, obs, padding) ||
      segmentIntersectsRect(source, p1B, obs, padding) ||
      segmentIntersectsRect(p1B, p2B, obs, padding) ||
      segmentIntersectsRect(p2B, target, obs, padding),
  );

  const activeObstacles = intersectingObstacles.length > 0 ? intersectingObstacles : obstacles;

  let minObsY = Infinity;
  let maxObsY = -Infinity;
  let minObsX = Infinity;
  let maxObsX = -Infinity;

  for (const obs of activeObstacles) {
    minObsY = Math.min(minObsY, obs.y);
    maxObsY = Math.max(maxObsY, obs.y + obs.height);
    minObsX = Math.min(minObsX, obs.x);
    maxObsX = Math.max(maxObsX, obs.x + obs.width);
  }

  const candidateRoutes: { route: PointLike[]; length: number }[] = [];

  // Candidate Top: detour above obstacles
  const detourTopY = minObsY - padding - 10 - parallelOffset;
  const routeTop: PointLike[] = [
    { x: source.x, y: detourTopY },
    { x: target.x, y: detourTopY },
  ];
  const collidesTop =
    obstacles.some((r) => segmentIntersectsRect(source, routeTop[0], r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeTop[0], routeTop[1], r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeTop[1], target, r, padding));
  if (!collidesTop) {
    const len = Math.abs(source.y - detourTopY) + Math.abs(target.x - source.x) + Math.abs(target.y - detourTopY);
    candidateRoutes.push({ route: routeTop, length: len });
  }

  // Candidate Bottom: detour below obstacles
  const detourBottomY = maxObsY + padding + 10 + parallelOffset;
  const routeBottom: PointLike[] = [
    { x: source.x, y: detourBottomY },
    { x: target.x, y: detourBottomY },
  ];
  const collidesBottom =
    obstacles.some((r) => segmentIntersectsRect(source, routeBottom[0], r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeBottom[0], routeBottom[1], r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeBottom[1], target, r, padding));
  if (!collidesBottom) {
    const len = Math.abs(source.y - detourBottomY) + Math.abs(target.x - source.x) + Math.abs(target.y - detourBottomY);
    candidateRoutes.push({ route: routeBottom, length: len });
  }

  // Candidate Left: detour left of obstacles
  const detourLeftX = minObsX - padding - 10 - parallelOffset;
  const routeLeft: PointLike[] = [
    { x: detourLeftX, y: source.y },
    { x: detourLeftX, y: target.y },
  ];
  const collidesLeft =
    obstacles.some((r) => segmentIntersectsRect(source, routeLeft[0], r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeLeft[0], routeLeft[1], r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeLeft[1], target, r, padding));
  if (!collidesLeft) {
    const len = Math.abs(source.x - detourLeftX) + Math.abs(target.y - source.y) + Math.abs(target.x - detourLeftX);
    candidateRoutes.push({ route: routeLeft, length: len });
  }

  // Candidate Right: detour right of obstacles
  const detourRightX = maxObsX + padding + 10 + parallelOffset;
  const routeRight: PointLike[] = [
    { x: detourRightX, y: source.y },
    { x: detourRightX, y: target.y },
  ];
  const collidesRight =
    obstacles.some((r) => segmentIntersectsRect(source, routeRight[0], r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeRight[0], routeRight[1], r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeRight[1], target, r, padding));
  if (!collidesRight) {
    const len = Math.abs(source.x - detourRightX) + Math.abs(target.y - source.y) + Math.abs(target.x - detourRightX);
    candidateRoutes.push({ route: routeRight, length: len });
  }

  if (candidateRoutes.length > 0) {
    candidateRoutes.sort((a, b) => a.length - b.length);
    return candidateRoutes[0].route;
  }

  // Fallback: default top channel
  return [
    { x: source.x, y: detourTopY },
    { x: target.x, y: detourTopY },
  ];
}

/**
 * AntV X6 custom router adapter with obstacle avoidance and parallel edge staggering.
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

  // Extract obstacle rectangles and parallel edges from graph cells
  const graph = edgeView.graph;
  const obstacles: RectLike[] = [];
  let parallelIndex = 0;
  let parallelCount = 1;

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

    if (sourceCell && targetCell && typeof graph.getEdges === "function") {
      const allEdges = graph.getEdges();
      const parallelEdges = allEdges.filter((e: any) => {
        const s = e.getSourceCell()?.id;
        const t = e.getTargetCell()?.id;
        return (s === sourceCell.id && t === targetCell.id) || (s === targetCell.id && t === sourceCell.id);
      });
      if (parallelEdges.length > 1) {
        parallelCount = parallelEdges.length;
        const idx = parallelEdges.findIndex((e: any) => e.id === edgeView.cell?.id);
        if (idx !== -1) {
          parallelIndex = idx;
        }
      }
    }
  }

  const routerArgs: RouterOptions = {
    ...args,
    parallelIndex,
    parallelCount,
  };

  return computeOrthogonalRoute(source, target, obstacles, routerArgs);
}

/** Stem line representation connecting an internal port pad to the node boundary */
export interface BoundaryStemLine {
  id: string;
  nodeId: string;
  portId: string;
  start: PointLike;
  end: PointLike;
  side: "top" | "bottom" | "left" | "right";
}

/**
 * Computes boundary stem lines for internal ports within a node.
 * If a port is located strictly inside the node body, an orthogonal stem segment
 * is emitted to project the connection anchor cleanly to the exterior perimeter.
 */
export function computeStemLines(
  node: { id: string; x: number; y: number; width: number; height: number },
  ports: { id: string; x: number; y: number; side?: "top" | "bottom" | "left" | "right" }[],
  margin = 2,
): BoundaryStemLine[] {
  const stems: BoundaryStemLine[] = [];
  const nodeLeft = node.x;
  const nodeRight = node.x + node.width;
  const nodeTop = node.y;
  const nodeBottom = node.y + node.height;

  for (const port of ports) {
    const px = port.x;
    const py = port.y;

    // Distances to 4 boundaries
    const distLeft = Math.abs(px - nodeLeft);
    const distRight = Math.abs(px - nodeRight);
    const distTop = Math.abs(py - nodeTop);
    const distBottom = Math.abs(py - nodeBottom);

    // If port is already on perimeter (within margin), no stem line needed
    if (distLeft <= margin || distRight <= margin || distTop <= margin || distBottom <= margin) {
      continue;
    }

    // Determine target side
    let side = port.side;
    if (!side) {
      const minDist = Math.min(distLeft, distRight, distTop, distBottom);
      if (minDist === distLeft) side = "left";
      else if (minDist === distRight) side = "right";
      else if (minDist === distTop) side = "top";
      else side = "bottom";
    }

    let endX = px;
    let endY = py;
    if (side === "left") endX = nodeLeft;
    else if (side === "right") endX = nodeRight;
    else if (side === "top") endY = nodeTop;
    else if (side === "bottom") endY = nodeBottom;

    stems.push({
      id: `stem_${node.id}_${port.id}`,
      nodeId: node.id,
      portId: port.id,
      start: { x: px, y: py },
      end: { x: endX, y: endY },
      side,
    });
  }

  return stems;
}

export interface JumpoverSegment {
  p1: PointLike;
  p2: PointLike;
}

/**
 * Computes an SVG path string for an orthogonal route with semicircular bridge jumpovers
 * at crossings with perpendicular obstacle segments.
 */
export function computeJumpoverPath(
  points: PointLike[],
  obstacles: JumpoverSegment[] = [],
  options: { radius?: number } = {},
): string {
  if (points.length < 2) {
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    return "";
  }

  const radius = options.radius ?? 5;
  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];

    const isHorizontal = Math.abs(p1.y - p2.y) < 0.001;
    const isVertical = Math.abs(p1.x - p2.x) < 0.001;

    if (isHorizontal && Math.abs(p1.x - p2.x) > radius * 2) {
      const y = p1.y;
      const minX = Math.min(p1.x, p2.x);
      const maxX = Math.max(p1.x, p2.x);
      const dir = p2.x > p1.x ? 1 : -1;

      // Find perpendicular (vertical) obstacles intersecting this horizontal segment
      const crossings: number[] = [];
      for (const obs of obstacles) {
        const obsIsVertical = Math.abs(obs.p1.x - obs.p2.x) < 0.001;
        if (!obsIsVertical) continue;
        const obsX = obs.p1.x;
        const obsMinY = Math.min(obs.p1.y, obs.p2.y);
        const obsMaxY = Math.max(obs.p1.y, obs.p2.y);

        if (obsX > minX + radius && obsX < maxX - radius && y >= obsMinY && y <= obsMaxY) {
          crossings.push(obsX);
        }
      }

      // Sort crossings along direction of travel
      crossings.sort((a, b) => (dir > 0 ? a - b : b - a));

      // Build path with jumpover arcs
      let curX = p1.x;
      for (const cx of crossings) {
        if (dir > 0) {
          const startArcX = cx - radius;
          const endArcX = cx + radius;
          if (startArcX > curX) {
            d += ` L ${startArcX} ${y}`;
          }
          // Clockwise arc hopping upward (negative Y in SVG)
          d += ` A ${radius} ${radius} 0 0 1 ${endArcX} ${y}`;
          curX = endArcX;
        } else {
          const startArcX = cx + radius;
          const endArcX = cx - radius;
          if (startArcX < curX) {
            d += ` L ${startArcX} ${y}`;
          }
          // Counter-clockwise arc hopping upward (negative Y in SVG)
          d += ` A ${radius} ${radius} 0 0 0 ${endArcX} ${y}`;
          curX = endArcX;
        }
      }
      d += ` L ${p2.x} ${p2.y}`;
    } else {
      // Normal segment without jumpover
      d += ` L ${p2.x} ${p2.y}`;
    }
  }

  return d;
}

/**
 * Computes a smooth cubic Bezier spline path passing through a sequence of waypoints
 * using Catmull-Rom tangent approximation (C1 continuity).
 */
export function computeSmoothBezierPath(points: PointLike[]): string {
  if (points.length < 2) {
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    return "";
  }

  if (points.length === 2) {
    const p0 = points[0];
    const p1 = points[1];
    const dx = p1.x - p0.x;
    const cp1x = Number((p0.x + dx / 2).toFixed(1));
    const cp1y = p0.y;
    const cp2x = Number((p0.x + dx / 2).toFixed(1));
    const cp2y = p1.y;
    return `M ${p0.x} ${p0.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i < points.length - 2 ? points[i + 2] : p2;

    const cp1x = Number((p1.x + (p2.x - p0.x) / 6).toFixed(1));
    const cp1y = Number((p1.y + (p2.y - p0.y) / 6).toFixed(1));
    const cp2x = Number((p2.x - (p3.x - p1.x) / 6).toFixed(1));
    const cp2y = Number((p2.y - (p3.y - p1.y) / 6).toFixed(1));

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}

export type PortSide = "top" | "bottom" | "left" | "right";

export interface PortStubInfo {
  stubPoint: PointLike;
  stubLine: [PointLike, PointLike];
  side: PortSide;
}

/**
 * Computes a mandatory perpendicular departure stub vector from a node face,
 * staggering stub lengths across coplanar ports to prevent immediate collinear wire overlap.
 */
export function computePortStub(
  portPoint: PointLike,
  side: PortSide = "right",
  portIndex = 0,
  baseLength = 14,
): PortStubInfo {
  const stagger = (portIndex % 3) * 6;
  const length = baseLength + stagger;

  let endX = portPoint.x;
  let endY = portPoint.y;

  switch (side) {
    case "left":
      endX = portPoint.x - length;
      break;
    case "right":
      endX = portPoint.x + length;
      break;
    case "top":
      endY = portPoint.y - length;
      break;
    case "bottom":
      endY = portPoint.y + length;
      break;
  }

  const stubPoint: PointLike = { x: endX, y: endY };
  return {
    stubPoint,
    stubLine: [portPoint, stubPoint],
    side,
  };
}

export interface ChannelTrackAssignment<T> {
  item: T;
  track: number;
  offset: number;
  totalTracks: number;
}

/**
 * Assigns non-overlapping parallel tracks using Left-Edge Channel Routing (track assignment).
 * Given a collection of segments along an axis with [start, end] intervals,
 * allocates tracks so concurrent segments don't overlap, centering tracks along the channel corridor.
 */
export function assignChannelTracks<T extends { start: number; end: number }>(
  intervals: T[],
  channelSpacing = 10,
  minGap = 4,
): ChannelTrackAssignment<T>[] {
  if (intervals.length === 0) return [];

  const normalized = intervals.map((it) => ({
    item: it,
    start: Math.min(it.start, it.end),
    end: Math.max(it.start, it.end),
  }));

  // Sort by start coordinate ascending
  normalized.sort((a, b) => a.start - b.start);

  const tracks: { end: number }[] = [];
  const assignments: { item: T; track: number }[] = [];

  for (const seg of normalized) {
    let placed = false;
    for (let t = 0; t < tracks.length; t++) {
      if (tracks[t].end + minGap <= seg.start) {
        tracks[t].end = seg.end;
        assignments.push({ item: seg.item, track: t });
        placed = true;
        break;
      }
    }
    if (!placed) {
      tracks.push({ end: seg.end });
      assignments.push({ item: seg.item, track: tracks.length - 1 });
    }
  }

  const totalTracks = Math.max(1, tracks.length);
  return assignments.map((a) => {
    const offset = (a.track - (totalTracks - 1) / 2) * channelSpacing;
    return {
      item: a.item,
      track: a.track,
      offset,
      totalTracks,
    };
  });
}

export interface BusBundle {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeIds: string[];
  trunk: [PointLike, PointLike];
  stems: { edgeId: string; sourceStem: [PointLike, PointLike]; targetStem: [PointLike, PointLike] }[];
}

/**
 * Aggregates multiple parallel connections between two nodes into a condensed bus trunk line
 * with breakout stems at source and target ports.
 */
export function computeBusBundle(
  sourceNodeId: string,
  targetNodeId: string,
  connections: { edgeId: string; source: PointLike; target: PointLike }[],
  options: { channelAxis?: "x" | "y"; trunkCoord?: number } = {},
): BusBundle {
  const edgeIds = connections.map((c) => c.edgeId);
  if (connections.length === 0) {
    return {
      id: `bus_${sourceNodeId}_${targetNodeId}`,
      sourceNodeId,
      targetNodeId,
      edgeIds: [],
      trunk: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ],
      stems: [],
    };
  }

  const avgSourceX = connections.reduce((s, c) => s + c.source.x, 0) / connections.length;
  const avgTargetX = connections.reduce((s, c) => s + c.target.x, 0) / connections.length;
  const avgSourceY = connections.reduce((s, c) => s + c.source.y, 0) / connections.length;
  const avgTargetY = connections.reduce((s, c) => s + c.target.y, 0) / connections.length;

  const dx = Math.abs(avgTargetX - avgSourceX);
  const dy = Math.abs(avgTargetY - avgSourceY);

  const axis = options.channelAxis ?? (dx >= dy ? "x" : "y");
  const stems: BusBundle["stems"] = [];

  if (axis === "x") {
    const trunkY = options.trunkCoord ?? Math.round((avgSourceY + avgTargetY) / 2);
    const minX = Math.min(...connections.flatMap((c) => [c.source.x, c.target.x]));
    const maxX = Math.max(...connections.flatMap((c) => [c.source.x, c.target.x]));

    for (const c of connections) {
      stems.push({
        edgeId: c.edgeId,
        sourceStem: [c.source, { x: c.source.x, y: trunkY }],
        targetStem: [{ x: c.target.x, y: trunkY }, c.target],
      });
    }

    return {
      id: `bus_${sourceNodeId}_${targetNodeId}`,
      sourceNodeId,
      targetNodeId,
      edgeIds,
      trunk: [
        { x: minX, y: trunkY },
        { x: maxX, y: trunkY },
      ],
      stems,
    };
  } else {
    const trunkX = options.trunkCoord ?? Math.round((avgSourceX + avgTargetX) / 2);
    const minY = Math.min(...connections.flatMap((c) => [c.source.y, c.target.y]));
    const maxY = Math.max(...connections.flatMap((c) => [c.source.y, c.target.y]));

    for (const c of connections) {
      stems.push({
        edgeId: c.edgeId,
        sourceStem: [c.source, { x: trunkX, y: c.source.y }],
        targetStem: [{ x: trunkX, y: c.target.y }, c.target],
      });
    }

    return {
      id: `bus_${sourceNodeId}_${targetNodeId}`,
      sourceNodeId,
      targetNodeId,
      edgeIds,
      trunk: [
        { x: trunkX, y: minY },
        { x: trunkX, y: maxY },
      ],
      stems,
    };
  }
}

/**
 * Computes an SVG path string for an orthogonal route with rounded corners (filleted arcs)
 * replacing sharp 90-degree corners with smooth CAD bends.
 */
export function computeFilletedOrthogonalPath(points: PointLike[], radius = 5): string {
  if (points.length < 2) {
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    return "";
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const len1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const len2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, len1 / 2, len2 / 2);

    if (r <= 0.5) {
      d += ` L ${curr.x} ${curr.y}`;
      continue;
    }

    const dx1 = (curr.x - prev.x) / len1;
    const dy1 = (curr.y - prev.y) / len1;
    const dx2 = (next.x - curr.x) / len2;
    const dy2 = (next.y - curr.y) / len2;

    const startX = curr.x - dx1 * r;
    const startY = curr.y - dy1 * r;
    const endX = curr.x + dx2 * r;
    const endY = curr.y + dy2 * r;

    d += ` L ${Number(startX.toFixed(1))} ${Number(startY.toFixed(1))}`;
    d += ` Q ${Number(curr.x.toFixed(1))} ${Number(curr.y.toFixed(1))}, ${Number(endX.toFixed(1))} ${Number(endY.toFixed(1))}`;
  }

  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}
