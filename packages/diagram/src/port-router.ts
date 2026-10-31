// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Port-Aware Orthogonal Router with Obstacle Avoidance and Staggered Parallel Offsets.
 *
 * Academic Citations:
 * - Lee, C. Y. (1961). An algorithm for path connection and its applications.
 *   IRE Transactions on Electronic Computers, EC-10(3), 346-365.
 *   https://doi.org/10.1109/TEC.1961.5219222
 * - Hart, P. E., Nilsson, N. J., & Raphael, B. (1968). A formal basis for the heuristic
 *   determination of minimum cost paths. IEEE Transactions on Systems Science and Cybernetics,
 *   4(2), 100-107. https://doi.org/10.1109/TSSC.1968.300136
 * - Deutsch, D. N. (1976). A 'dogleg' channel router. In Proceedings of the 13th Design
 *   Automation Conference (DAC '76), 425-433. https://doi.org/10.1145/800263.810688
 *
 * ModelScript Architectural Rationale:
 * In ModelScript's polyglot diagram system, edges correspond to physical connections
 * (electrical wires, hydraulic lines, thermal contacts, mechanical joints). Wires must never
 * intersect component bounding boxes, and multi-variable connections between blocks must remain
 * visually distinguishable rather than collapsing into a single merged line. This router uses
 * orthogonal A* maze routing over obstacle bounding boxes with directional port stubs and dogleg
 * channel routing offsets.
 *
 * ModelScript Modifications:
 * - Computes port outward normal vectors to force edge stubs to exit perpendicular to component
 *   boundaries before seeking orthogonal path channels.
 * - Staggers parallel multi-edge connections using channel offsets (`parallelIndex`, `parallelCount`,
 *   `channelSpacing`), preventing visual occlusion in bus connections.
 * - Employs fast AABB segment intersection tests (`segmentIntersectsRect`) and bend-penalized A*
 *   heuristics to produce aesthetically clean paths with minimal corners.
 */

/** 2D Cartesian coordinate point in diagram space. */
export interface PointLike {
  /** Horizontal X coordinate. */
  x: number;
  /** Vertical Y coordinate. */
  y: number;
}

/** Axis-aligned rectangular bounding box in diagram space. */
export interface RectLike {
  /** Left-edge X coordinate. */
  x: number;
  /** Top-edge Y coordinate. */
  y: number;
  /** Rectangle width in diagram units. */
  width: number;
  /** Rectangle height in diagram units. */
  height: number;
}

/** Cardinal boundary face of a component node in X6 screen coordinates (+y down). */
export type PortSide = "top" | "bottom" | "left" | "right";

/** Outward unit normal vector for a component port in X6 screen coordinates (+y down). */
export interface PortNormal {
  /** Horizontal unit normal component (-1 left, 0 vertical, +1 right). */
  nx: -1 | 0 | 1;
  /** Vertical unit normal component (-1 top, 0 horizontal, +1 bottom). */
  ny: -1 | 0 | 1;
  /** Cardinal side corresponding to `(nx, ny)`. */
  side: PortSide;
}

/** Configuration options for the orthogonal A* port router. */
export interface RouterOptions {
  /** Minimum clearance padding around obstacle rectangles (default: `12`). */
  padding?: number | undefined;
  /** Grid step discretization size in diagram units (default: `10`). */
  step?: number | undefined;
  /** Maximum number of A* search iterations before falling back to an L-shaped route (default: `800`). */
  maxIterations?: number | undefined;
  /** Zero-based index of this edge within a parallel multi-edge bundle. */
  parallelIndex?: number | undefined;
  /** Total number of edges in the parallel multi-edge bundle. */
  parallelCount?: number | undefined;
  /** Perpendicular spacing between adjacent parallel channels in diagram units (default: `10`). */
  channelSpacing?: number | undefined;
  /** Outward cardinal side of the source port. */
  sourceSide?: PortSide | undefined;
  /** Outward cardinal side of the target port. */
  targetSide?: PortSide | undefined;
  /** Bounding box of the source component node (used to prevent self-impalement). */
  sourceBox?: RectLike | undefined;
  /** Bounding box of the target component node (used to prevent self-impalement). */
  targetBox?: RectLike | undefined;
  /** Minimum outward port lead-out stub length in diagram units (default: `10`). */
  stubLength?: number | undefined;
}

/**
 * Converts a cardinal `PortSide` into a `PortNormal` vector in X6 coordinates (`+y` down).
 */
export function sideToNormal(side: PortSide): PortNormal {
  switch (side) {
    case "top":
      return { nx: 0, ny: -1, side: "top" };
    case "bottom":
      return { nx: 0, ny: 1, side: "bottom" };
    case "left":
      return { nx: -1, ny: 0, side: "left" };
    case "right":
      return { nx: 1, ny: 0, side: "right" };
  }
}

export interface RouterPortConfig {
  args?: { x?: number | undefined; y?: number | undefined } | undefined;
  side?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface RouterNodeLike {
  id?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  getPosition?: (() => { x?: number | undefined; y?: number | undefined } | null | undefined) | undefined;
  getSize?: (() => { width?: number | undefined; height?: number | undefined } | null | undefined) | undefined;
  getBBox?: (() => Partial<RectLike> | null | undefined) | undefined;
  getAngle?: (() => number | undefined) | undefined;
  getPortProp?: ((portId: string, prop?: string) => RouterPortConfig | null | undefined) | undefined;
  getPort?: ((portId: string) => RouterPortConfig | null | undefined) | undefined;
}

export interface RouterEdgeLike {
  id?: string | undefined;
  source?: { cell?: string | undefined; port?: string | undefined } | undefined;
  target?: { cell?: string | undefined; port?: string | undefined } | undefined;
  getSourceCellId?: (() => string | undefined) | undefined;
  getTargetCellId?: (() => string | undefined) | undefined;
  getSourcePortId?: (() => string | undefined) | undefined;
  getTargetPortId?: (() => string | undefined) | undefined;
  getSourceCell?: (() => RouterNodeLike | null | undefined) | undefined;
  getTargetCell?: (() => RouterNodeLike | null | undefined) | undefined;
  getSourcePoint?: (() => PointLike | null | undefined) | undefined;
  getTargetPoint?: (() => PointLike | null | undefined) | undefined;
  getVertices?: (() => PointLike[] | null | undefined) | undefined;
  setVertices?: ((vertices: PointLike[], options?: { ignoreSnap?: boolean | undefined }) => void) | undefined;
}

export interface RouterGraphLike {
  getEdges?: (() => RouterEdgeLike[]) | undefined;
  getNodes?: (() => RouterNodeLike[]) | undefined;
  getCellById?: ((id?: string) => RouterNodeLike | null | undefined) | undefined;
  getConnectedEdges?: ((node: RouterNodeLike) => RouterEdgeLike[]) | undefined;
}

export interface RouterEdgeViewLike {
  sourcePoint?: PointLike | null | undefined;
  targetPoint?: PointLike | null | undefined;
  graph?: RouterGraphLike | null | undefined;
  cell?: RouterEdgeLike | null | undefined;
}

/**
 * Extracts the axis-aligned bounding box of an X6 node or node-like object, if available.
 */
export function getNodeBBox(node: RouterNodeLike | null | undefined): RectLike | null {
  if (!node) return null;
  if (typeof node.getPosition === "function" && typeof node.getSize === "function") {
    const pos = node.getPosition();
    const size = node.getSize();
    if (
      pos &&
      size &&
      typeof pos.x === "number" &&
      typeof pos.y === "number" &&
      typeof size.width === "number" &&
      typeof size.height === "number" &&
      size.width > 0 &&
      size.height > 0
    ) {
      return { x: pos.x, y: pos.y, width: size.width, height: size.height };
    }
  }
  if (typeof node.getBBox === "function") {
    const bbox = node.getBBox();
    if (
      bbox &&
      typeof bbox.x === "number" &&
      typeof bbox.y === "number" &&
      typeof bbox.width === "number" &&
      typeof bbox.height === "number" &&
      bbox.width > 0 &&
      bbox.height > 0
    ) {
      return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
    }
  }
  if (
    typeof node.x === "number" &&
    typeof node.y === "number" &&
    typeof node.width === "number" &&
    typeof node.height === "number" &&
    node.width > 0 &&
    node.height > 0
  ) {
    return { x: node.x, y: node.y, width: node.width, height: node.height };
  }
  return null;
}

/**
 * Resolves the world-space coordinates of a port on a node, accounting for node position and rotation.
 */
export function resolveNodePortWorldPoint(
  node: RouterNodeLike | null | undefined,
  portId?: string,
  fallbackPoint?: PointLike | null,
): PointLike | null {
  if (node && portId) {
    const bbox = getNodeBBox(node);
    const portProp = typeof node.getPortProp === "function" ? node.getPortProp(portId) : null;
    const portObj = !portProp && typeof node.getPort === "function" ? node.getPort(portId) : null;
    const args =
      portProp?.args ??
      portObj?.args ??
      (typeof node.getPortProp === "function" ? node.getPortProp(portId, "args") : null);
    if (bbox && args && typeof args.x === "number" && typeof args.y === "number") {
      const cx = bbox.width / 2;
      const cy = bbox.height / 2;
      const dx = args.x - cx;
      const dy = args.y - cy;
      const angleDeg = typeof node.getAngle === "function" ? node.getAngle() || 0 : node.angle || 0;
      const rad = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return {
        x: Math.round((bbox.x + cx + rx) * 100) / 100,
        y: Math.round((bbox.y + cy + ry) * 100) / 100,
      };
    }
  }
  return fallbackPoint ? { x: fallbackPoint.x, y: fallbackPoint.y } : null;
}

/**
 * Infers the cardinal outward normal of a port point relative to its parent node's bounding box.
 */
export function inferPortNormalFromBox(portPt: PointLike, box: RectLike): PortNormal {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const halfW = Math.max(1, box.width / 2);
  const halfH = Math.max(1, box.height / 2);
  const nx = (portPt.x - cx) / halfW;
  const ny = (portPt.y - cy) / halfH;
  if (Math.abs(nx) >= Math.abs(ny)) {
    return nx >= 0 ? sideToNormal("right") : sideToNormal("left");
  }
  return ny >= 0 ? sideToNormal("bottom") : sideToNormal("top");
}

/**
 * Computes the outward cardinal normal vector for a node's port, accounting for node rotation
 * and local port coordinates or world-space port position.
 */
export function getPortOutwardNormal(
  node: RouterNodeLike | null | undefined,
  portId?: string,
  portWorldPoint?: PointLike | null,
): PortNormal | null {
  if (!node) return null;
  const bbox = getNodeBBox(node);
  if (portId) {
    const portProp = typeof node.getPortProp === "function" ? node.getPortProp(portId) : null;
    const portObj = !portProp && typeof node.getPort === "function" ? node.getPort(portId) : null;
    const explicitSide = portProp?.side ?? portObj?.side;
    if (explicitSide === "top" || explicitSide === "bottom" || explicitSide === "left" || explicitSide === "right") {
      return sideToNormal(explicitSide);
    }
    const args =
      portProp?.args ??
      portObj?.args ??
      (typeof node.getPortProp === "function" ? node.getPortProp(portId, "args") : null);
    if (bbox && args && typeof args.x === "number" && typeof args.y === "number") {
      const halfW = Math.max(1, bbox.width / 2);
      const halfH = Math.max(1, bbox.height / 2);
      const localNx = (args.x - bbox.width / 2) / halfW;
      const localNy = (args.y - bbox.height / 2) / halfH;
      const angleDeg = typeof node.getAngle === "function" ? node.getAngle() || 0 : node.angle || 0;
      const rad = (angleDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = localNx * cos - localNy * sin;
      const ry = localNx * sin + localNy * cos;
      if (Math.abs(rx) >= Math.abs(ry)) {
        return rx >= 0 ? sideToNormal("right") : sideToNormal("left");
      }
      return ry >= 0 ? sideToNormal("bottom") : sideToNormal("top");
    }
  }
  if (bbox && portWorldPoint) {
    return inferPortNormalFromBox(portWorldPoint, bbox);
  }
  return null;
}

/**
 * Projects a port anchor outward along its cardinal normal by `stubLength`, ensuring the stub
 * clears the exterior face of `box` when provided.
 */
export function projectPortNormalStub(
  portWorldPoint: PointLike,
  normal: PortNormal,
  stubLength = 10,
  box?: RectLike | null,
): PointLike {
  if (normal.side === "right") {
    const base = box ? Math.max(portWorldPoint.x, box.x + box.width) : portWorldPoint.x;
    return { x: base + stubLength, y: portWorldPoint.y };
  }
  if (normal.side === "left") {
    const base = box ? Math.min(portWorldPoint.x, box.x) : portWorldPoint.x;
    return { x: base - stubLength, y: portWorldPoint.y };
  }
  if (normal.side === "bottom") {
    const base = box ? Math.max(portWorldPoint.y, box.y + box.height) : portWorldPoint.y;
    return { x: portWorldPoint.x, y: base + stubLength };
  }
  const base = box ? Math.min(portWorldPoint.y, box.y) : portWorldPoint.y;
  return { x: portWorldPoint.x, y: base - stubLength };
}

function shrinkRect(rect: RectLike, inset: number): RectLike {
  const ix = Math.min(inset, Math.max(0, rect.width / 2 - 0.5));
  const iy = Math.min(inset, Math.max(0, rect.height / 2 - 0.5));
  return {
    x: rect.x + ix,
    y: rect.y + iy,
    width: Math.max(1, rect.width - ix * 2),
    height: Math.max(1, rect.height - iy * 2),
  };
}

/**
 * Checks whether an edge polyline violates port outward normals, contains diagonal segments,
 * or impales its source/target component bounding boxes.
 */
function doesPolylineViolatePortOrBox(
  srcPt: PointLike,
  tgtPt: PointLike,
  vertices: PointLike[],
  srcNormal: PortNormal | null,
  tgtNormal: PortNormal | null,
  srcBox: RectLike | null,
  tgtBox: RectLike | null,
): boolean {
  const pts: PointLike[] = [srcPt, ...vertices, tgtPt];

  // 1. Check for diagonal segments or 180-degree reversals
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (Math.abs(a.x - b.x) > 1.5 && Math.abs(a.y - b.y) > 1.5) {
      return true;
    }
  }

  // 2. Check departure direction against srcNormal
  if (srcNormal) {
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i]!.x - srcPt.x;
      const dy = pts[i]!.y - srcPt.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) {
        const dot = dx * srcNormal.nx + dy * srcNormal.ny;
        const perp = srcNormal.nx !== 0 ? Math.abs(dy) : Math.abs(dx);
        if (dot <= 0 || perp > Math.abs(dot) + 0.5) {
          return true;
        }
        break;
      }
    }
  }

  // 3. Check arrival direction against tgtNormal (measured outward from tgtPt)
  if (tgtNormal) {
    for (let i = pts.length - 2; i >= 0; i--) {
      const dx = pts[i]!.x - tgtPt.x;
      const dy = pts[i]!.y - tgtPt.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) {
        const dot = dx * tgtNormal.nx + dy * tgtNormal.ny;
        const perp = tgtNormal.nx !== 0 ? Math.abs(dy) : Math.abs(dx);
        if (dot <= 0 || perp > Math.abs(dot) + 0.5) {
          return true;
        }
        break;
      }
    }
  }

  // 4. Check component body self-impalement
  const shrunkSrc = srcBox ? shrinkRect(srcBox, 2) : null;
  const shrunkTgt = tgtBox ? shrinkRect(tgtBox, 2) : null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 0.5) continue;
    if (shrunkSrc && segmentIntersectsRect(a, b, shrunkSrc, 0)) {
      return true;
    }
    if (shrunkTgt && segmentIntersectsRect(a, b, shrunkTgt, 0)) {
      return true;
    }
  }

  return false;
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
 * Simplifies collinear intermediate points along an orthogonal path within a specified tolerance,
 * and removes duplicate or zero-length segments.
 */
export function simplifyCollinearPoints(points: PointLike[], tolerance = 1.5): PointLike[] {
  if (points.length <= 2) return points;

  // Deduplicate nearly identical adjacent points while preserving the exact terminal endpoint
  const dedupThreshold = Math.min(0.05, tolerance);
  const deduped: PointLike[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = deduped[deduped.length - 1]!;
    const curr = points[i]!;
    if (Math.abs(curr.x - prev.x) > dedupThreshold || Math.abs(curr.y - prev.y) > dedupThreshold) {
      deduped.push(curr);
    } else if (i === points.length - 1) {
      deduped[deduped.length - 1] = curr;
    }
  }

  if (deduped.length <= 2) return deduped;

  const simplified: PointLike[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = simplified[simplified.length - 1]!;
    const curr = deduped[i]!;
    const next = deduped[i + 1]!;

    const dx1 = Math.abs(curr.x - prev.x);
    const dy1 = Math.abs(curr.y - prev.y);
    const dx2 = Math.abs(next.x - curr.x);
    const dy2 = Math.abs(next.y - curr.y);

    // Only treat as horizontally collinear if both segments move predominantly horizontally
    // (never delete a 90-degree corner transitioning onto a short vertical jog <= tolerance).
    const isCollinearH =
      dx1 >= dy1 && dx2 >= dy2 && dy1 <= tolerance && dy2 <= tolerance && Math.abs(prev.y - next.y) <= tolerance;

    // Symmetrically, only treat as vertically collinear if both segments move predominantly vertically.
    const isCollinearV =
      dy1 >= dx1 && dy2 >= dx2 && dx1 <= tolerance && dx2 <= tolerance && Math.abs(prev.x - next.x) <= tolerance;

    if (!isCollinearH && !isCollinearV) {
      simplified.push(curr);
    }
  }
  simplified.push(deduped[deduped.length - 1]!);
  return simplified;
}

/**
 * Snaps a polyline to strict orthogonal (Manhattan) steps where segments are nearly axis-aligned,
 * preserving pinned start and end points (`points[0]` and `points[points.length - 1]`) and simplifying
 * collinear vertices.
 */
export function regularizeOrthogonalPolyline(
  points: PointLike[],
  axisTolerance = 6,
  collinearTolerance = 1.5,
): PointLike[] {
  if (points.length <= 2) return points;

  const result: PointLike[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1]!;
    const curr = { ...points[i]! };

    // Check if segment is nearly horizontal or vertical
    if (Math.abs(curr.y - prev.y) <= axisTolerance) {
      curr.y = prev.y;
    } else if (Math.abs(curr.x - prev.x) <= axisTolerance) {
      curr.x = prev.x;
    }
    result.push(curr);
  }

  // Keep the terminal endpoint pinned at its exact coordinates and snap the last intermediate vertex
  // (`result[result.length - 1]`) so the final segment into `target` is also orthogonal.
  const target = { ...points[points.length - 1]! };
  const lastBend = result[result.length - 1]!;
  const prevBeforeLast = result.length >= 2 ? result[result.length - 2]! : null;
  if (Math.abs(target.y - lastBend.y) <= axisTolerance && Math.abs(target.y - lastBend.y) > 0) {
    if (!prevBeforeLast || Math.abs(lastBend.x - prevBeforeLast.x) <= 0.05) {
      lastBend.y = target.y;
    }
  } else if (Math.abs(target.x - lastBend.x) <= axisTolerance && Math.abs(target.x - lastBend.x) > 0) {
    if (!prevBeforeLast || Math.abs(lastBend.y - prevBeforeLast.y) <= 0.05) {
      lastBend.x = target.x;
    }
  }
  result.push(target);

  return simplifyCollinearPoints(result, collinearTolerance);
}

/**
 * Guarantees that the intermediate `vertices` between `source` and `target` form a 100% orthogonal
 * (0° / 90° Manhattan) polyline `[source, ...healedVertices, target]`.
 *
 * Heals terminal stub micro-slants caused by integer rounding in saved annotations vs. floating-point
 * port coordinates, snaps near-axis interior segments, and inserts orthogonal 90° corners for any
 * remaining diagonal segments.
 */
export function healOrthogonalVertices(
  source: PointLike,
  target: PointLike,
  vertices: PointLike[],
  options: { snapTolerance?: number } = {},
): PointLike[] {
  const snapTolerance = options.snapTolerance ?? 8;

  if (!vertices || vertices.length === 0) {
    if (Math.abs(source.x - target.x) <= 0.05 || Math.abs(source.y - target.y) <= 0.05) {
      return [];
    }
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    if (Math.abs(source.x - target.x) >= Math.abs(source.y - target.y)) {
      return [
        { x: midX, y: source.y },
        { x: midX, y: target.y },
      ];
    }
    return [
      { x: source.x, y: midY },
      { x: target.x, y: midY },
    ];
  }

  if (vertices.length === 1) {
    const v = { x: vertices[0]!.x, y: vertices[0]!.y };
    const errHV = Math.abs(v.x - target.x) + Math.abs(v.y - source.y);
    const errVH = Math.abs(v.x - source.x) + Math.abs(v.y - target.y);
    if (errHV <= errVH && Math.abs(v.x - target.x) <= snapTolerance && Math.abs(v.y - source.y) <= snapTolerance) {
      return [{ x: target.x, y: source.y }];
    }
    if (errVH < errHV && Math.abs(v.x - source.x) <= snapTolerance && Math.abs(v.y - target.y) <= snapTolerance) {
      return [{ x: source.x, y: target.y }];
    }
    if (Math.abs(v.y - source.y) <= snapTolerance) {
      return simplifyCollinearPoints([source, { x: v.x, y: source.y }, { x: v.x, y: target.y }, target], 0.05).slice(
        1,
        -1,
      );
    }
    if (Math.abs(v.x - source.x) <= snapTolerance) {
      return simplifyCollinearPoints([source, { x: source.x, y: v.y }, { x: target.x, y: v.y }, target], 0.05).slice(
        1,
        -1,
      );
    }
    if (Math.abs(v.y - target.y) <= snapTolerance) {
      return simplifyCollinearPoints([source, { x: v.x, y: source.y }, { x: v.x, y: target.y }, target], 0.05).slice(
        1,
        -1,
      );
    }
    if (Math.abs(v.x - target.x) <= snapTolerance) {
      return simplifyCollinearPoints([source, { x: source.x, y: v.y }, { x: target.x, y: v.y }, target], 0.05).slice(
        1,
        -1,
      );
    }
  }

  const pts: PointLike[] = vertices.map((p) => ({ x: p.x, y: p.y }));

  if (pts.length >= 2) {
    // 1. Align first bend `pts[0]` with `source` along the departure stub axis
    const dx01 = Math.abs(pts[1]!.x - pts[0]!.x);
    const dy01 = Math.abs(pts[1]!.y - pts[0]!.y);
    if (dy01 >= dx01) {
      // pts[0] -> pts[1] is vertical, so source -> pts[0] is horizontal
      if (Math.abs(pts[0]!.y - source.y) <= snapTolerance) {
        pts[0]!.y = source.y;
      } else if (Math.abs(pts[0]!.x - source.x) <= snapTolerance) {
        pts[0]!.x = source.x;
      }
    } else {
      // pts[0] -> pts[1] is horizontal, so source -> pts[0] is vertical
      if (Math.abs(pts[0]!.x - source.x) <= snapTolerance) {
        pts[0]!.x = source.x;
      } else if (Math.abs(pts[0]!.y - source.y) <= snapTolerance) {
        pts[0]!.y = source.y;
      }
    }

    // 2. Align last bend `pts[last]` with `target` along the arrival stub axis
    const last = pts.length - 1;
    const prev = pts[last - 1]!;
    const dxLast = Math.abs(pts[last]!.x - prev.x);
    const dyLast = Math.abs(pts[last]!.y - prev.y);
    if (dyLast >= dxLast) {
      // prev -> pts[last] is vertical, so pts[last] -> target is horizontal
      if (Math.abs(pts[last]!.y - target.y) <= snapTolerance) {
        pts[last]!.y = target.y;
      } else if (Math.abs(pts[last]!.x - target.x) <= snapTolerance) {
        pts[last]!.x = target.x;
      }
    } else {
      // prev -> pts[last] is horizontal, so pts[last] -> target is vertical
      if (Math.abs(pts[last]!.x - target.x) <= snapTolerance) {
        pts[last]!.x = target.x;
      } else if (Math.abs(pts[last]!.y - target.y) <= snapTolerance) {
        pts[last]!.y = target.y;
      }
    }

    // 3. Snap near-orthogonal interior segments
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx > 0.01 && dy > 0.01) {
        if (dy <= snapTolerance && dy < dx) {
          if (i < pts.length - 1 || Math.abs(target.x - b.x) <= 0.05) {
            b.y = a.y;
          } else if (Math.abs(b.y - target.y) <= 0.05) {
            a.y = b.y;
          }
        } else if (dx <= snapTolerance && dx < dy) {
          if (i < pts.length - 1 || Math.abs(target.y - b.y) <= 0.05) {
            b.x = a.x;
          } else if (Math.abs(b.x - target.x) <= 0.05) {
            a.x = b.x;
          }
        }
      }
    }
  }

  // 4. Guarantee every consecutive segment in `[source, ...pts, target]` is strictly 0° or 90°
  const full: PointLike[] = [{ x: source.x, y: source.y }];
  const allTargets = [...pts, { x: target.x, y: target.y }];
  for (const nextPt of allTargets) {
    const currPt = full[full.length - 1] ?? source;
    if (Math.abs(nextPt.x - currPt.x) > 0.05 && Math.abs(nextPt.y - currPt.y) > 0.05) {
      const prevPt = full.length >= 2 ? full[full.length - 2] : undefined;
      const prevWasH = prevPt
        ? Math.abs(currPt.x - prevPt.x) >= Math.abs(currPt.y - prevPt.y)
        : Math.abs(nextPt.x - currPt.x) >= Math.abs(nextPt.y - currPt.y);
      const corner = prevWasH ? { x: currPt.x, y: nextPt.y } : { x: nextPt.x, y: currPt.y };
      full.push(corner);
    }
    full.push({ x: nextPt.x, y: nextPt.y });
  }

  return simplifyCollinearPoints(full, 0.05).slice(1, -1);
}

/**
 * Pushes coincident trunk segments on peer edges sharing the same electrical net so shared
 * schematic buses (such as ground rails) slide together as a unified corridor.
 */
function pushCoincidentNetTrunks(
  g: RouterGraphLike | null | undefined,
  primaryEdge: RouterEdgeLike,
  axis: "x" | "y",
  oldCoord: number,
  newCoord: number,
): void {
  if (typeof g?.getEdges !== "function") return;
  const allEdges: RouterEdgeLike[] = g.getEdges() || [];
  if (allEdges.length <= 1) return;

  const getPortKey = (e: RouterEdgeLike, end: "source" | "target"): string | undefined => {
    const cellId =
      end === "source"
        ? typeof e.getSourceCellId === "function"
          ? e.getSourceCellId()
          : e.source?.cell
        : typeof e.getTargetCellId === "function"
          ? e.getTargetCellId()
          : e.target?.cell;
    const portId =
      end === "source"
        ? typeof e.getSourcePortId === "function"
          ? e.getSourcePortId()
          : e.source?.port
        : typeof e.getTargetPortId === "function"
          ? e.getTargetPortId()
          : e.target?.port;
    return cellId && portId ? `${cellId}.${portId}` : undefined;
  };

  // Union-Find over port keys to identify edges in the same electrical net
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let root = k;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
    let curr = k;
    while (curr !== root) {
      const nxt = parent.get(curr)!;
      parent.set(curr, root);
      curr = nxt;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  for (const e of allEdges) {
    const sk = getPortKey(e, "source");
    const tk = getPortKey(e, "target");
    if (sk && !parent.has(sk)) parent.set(sk, sk);
    if (tk && !parent.has(tk)) parent.set(tk, tk);
    if (sk && tk) union(sk, tk);
  }

  const primaryKey = getPortKey(primaryEdge, "source") ?? getPortKey(primaryEdge, "target");
  if (!primaryKey) return;
  const netRoot = find(primaryKey);

  for (const otherEdge of allEdges) {
    if (otherEdge === primaryEdge || otherEdge.id === primaryEdge.id) continue;
    const ok = getPortKey(otherEdge, "source") ?? getPortKey(otherEdge, "target");
    if (!ok || find(ok) !== netRoot) continue;

    const verts: PointLike[] = typeof otherEdge.getVertices === "function" ? otherEdge.getVertices() || [] : [];
    if (verts.length < 2) continue;

    const updated = verts.map((v: PointLike) => ({ ...v }));
    let changed = false;
    for (let i = 0; i < updated.length - 1; i++) {
      const a = updated[i]!;
      const b = updated[i + 1]!;
      if (axis === "y" && Math.abs(a.y - b.y) <= 1.5 && Math.abs(a.y - oldCoord) <= 1.5) {
        a.y = newCoord;
        b.y = newCoord;
        changed = true;
      } else if (axis === "x" && Math.abs(a.x - b.x) <= 1.5 && Math.abs(a.x - oldCoord) <= 1.5) {
        a.x = newCoord;
        b.x = newCoord;
        changed = true;
      }
    }

    if (changed && typeof otherEdge.setVertices === "function") {
      const sId =
        typeof otherEdge.getSourceCellId === "function" ? otherEdge.getSourceCellId() : otherEdge.source?.cell;
      const tId =
        typeof otherEdge.getTargetCellId === "function" ? otherEdge.getTargetCellId() : otherEdge.target?.cell;
      const sPort =
        typeof otherEdge.getSourcePortId === "function" ? otherEdge.getSourcePortId() : otherEdge.source?.port;
      const tPort =
        typeof otherEdge.getTargetPortId === "function" ? otherEdge.getTargetPortId() : otherEdge.target?.port;
      const sNode = typeof g?.getCellById === "function" ? g.getCellById(sId) : null;
      const tNode = typeof g?.getCellById === "function" ? g.getCellById(tId) : null;
      const sPt = resolveNodePortWorldPoint(
        sNode,
        sPort,
        typeof otherEdge.getSourcePoint === "function" ? otherEdge.getSourcePoint() : null,
      );
      const tPt = resolveNodePortWorldPoint(
        tNode,
        tPort,
        typeof otherEdge.getTargetPoint === "function" ? otherEdge.getTargetPoint() : null,
      );
      const sNorm = getPortOutwardNormal(sNode, sPort, sPt);
      const tNorm = getPortOutwardNormal(tNode, tPort, tPt);
      const sBox = getNodeBBox(sNode);
      const tBox = getNodeBBox(tNode);
      if (!sPt || !tPt || !doesPolylineViolatePortOrBox(sPt, tPt, updated, sNorm, tNorm, sBox, tBox)) {
        otherEdge.setVertices(updated, { ignoreSnap: true });
      }
    }
  }
}

/**
 * Translates terminal departure/entry stubs on connected edges when a node is moved,
 * preserving orthogonal highway corridors, pushing trunks ahead of outward port normals,
 * injecting doglegs for 0/1-vertex collinear wires, and re-routing when self-impalement occurs.
 */
export function translateConnectedEdgeStubs(
  g: RouterGraphLike | null | undefined,
  node: RouterNodeLike,
  dx: number,
  dy: number,
  options?: { forceReroute?: boolean; minStub?: number },
): void {
  if (dx === 0 && dy === 0 && !options?.forceReroute) return;
  const connectedEdges = typeof g?.getConnectedEdges === "function" ? g.getConnectedEdges(node) : [];
  if (!connectedEdges || connectedEdges.length === 0) return;

  const minStub = options?.minStub ?? 10;

  for (const edge of connectedEdges) {
    const vertices: PointLike[] = typeof edge.getVertices === "function" ? edge.getVertices() || [] : [];

    const sourceId = typeof edge.getSourceCellId === "function" ? edge.getSourceCellId() : edge.source?.cell;
    const targetId = typeof edge.getTargetCellId === "function" ? edge.getTargetCellId() : edge.target?.cell;
    const sourcePortId = typeof edge.getSourcePortId === "function" ? edge.getSourcePortId() : edge.source?.port;
    const targetPortId = typeof edge.getTargetPortId === "function" ? edge.getTargetPortId() : edge.target?.port;

    const isSource = sourceId === node.id;
    const isTarget = targetId === node.id;

    if (isSource && isTarget) {
      // Self-loop: translate all vertices
      const newVertices = vertices.map((v: PointLike) => ({ x: v.x + dx, y: v.y + dy }));
      if (typeof edge.setVertices === "function") edge.setVertices(newVertices, { ignoreSnap: true });
      continue;
    }

    const srcNode = isSource
      ? node
      : typeof g?.getCellById === "function"
        ? g.getCellById(sourceId)
        : typeof edge.getSourceCell === "function"
          ? edge.getSourceCell()
          : null;
    const tgtNode = isTarget
      ? node
      : typeof g?.getCellById === "function"
        ? g.getCellById(targetId)
        : typeof edge.getTargetCell === "function"
          ? edge.getTargetCell()
          : null;

    const rawSrcPt = typeof edge.getSourcePoint === "function" ? edge.getSourcePoint() : null;
    const rawTgtPt = typeof edge.getTargetPoint === "function" ? edge.getTargetPoint() : null;
    const srcPt = resolveNodePortWorldPoint(srcNode, sourcePortId, rawSrcPt);
    const tgtPt = resolveNodePortWorldPoint(tgtNode, targetPortId, rawTgtPt);

    const srcNormal = getPortOutwardNormal(srcNode, sourcePortId, srcPt);
    const tgtNormal = getPortOutwardNormal(tgtNode, targetPortId, tgtPt);
    const srcBox = getNodeBBox(srcNode);
    const tgtBox = getNodeBBox(tgtNode);

    const getOtherObstacles = (): RectLike[] => {
      const obs: RectLike[] = [];
      if (typeof g?.getNodes === "function") {
        for (const n of g.getNodes()) {
          if (!n || n.id === sourceId || n.id === targetId) continue;
          if (
            typeof n.id === "string" &&
            (n.id.startsWith("solder_dot_") ||
              n.id.startsWith("__seq_stem_") ||
              n.id.startsWith("__alignment_guide_") ||
              n.id === "__diagram_background__" ||
              n.id === "__diagram_axes__")
          ) {
            continue;
          }
          const b = getNodeBBox(n);
          if (b) obs.push(b);
        }
      }
      return obs;
    };

    if (options?.forceReroute && srcPt && tgtPt && typeof edge.setVertices === "function") {
      const rerouted = computeOrthogonalRoute(srcPt, tgtPt, getOtherObstacles(), {
        sourceSide: srcNormal?.side,
        targetSide: tgtNormal?.side,
        sourceBox: srcBox ?? undefined,
        targetBox: tgtBox ?? undefined,
        stubLength: minStub,
      });
      edge.setVertices(rerouted, { ignoreSnap: true });
      continue;
    }

    // Case 0: 0-vertex straight edge pulled off-axis
    if (vertices.length === 0) {
      if (!srcPt || !tgtPt) continue;
      const offAxis = Math.abs(srcPt.x - tgtPt.x) > 0.5 && Math.abs(srcPt.y - tgtPt.y) > 0.5;
      const violatesPortOrBox =
        (srcNormal || tgtNormal || srcBox || tgtBox) &&
        doesPolylineViolatePortOrBox(srcPt, tgtPt, [], srcNormal, tgtNormal, srcBox, tgtBox);
      if (offAxis || violatesPortOrBox) {
        let injected: PointLike[];
        if (srcNormal || tgtNormal || srcBox || tgtBox) {
          injected = computeOrthogonalRoute(srcPt, tgtPt, getOtherObstacles(), {
            sourceSide: srcNormal?.side,
            targetSide: tgtNormal?.side,
            sourceBox: srcBox ?? undefined,
            targetBox: tgtBox ?? undefined,
            stubLength: minStub,
          });
        } else {
          const prevSrcX = isSource ? srcPt.x - dx : srcPt.x;
          const prevSrcY = isSource ? srcPt.y - dy : srcPt.y;
          const prevTgtX = isTarget ? tgtPt.x - dx : tgtPt.x;
          const prevTgtY = isTarget ? tgtPt.y - dy : tgtPt.y;
          const wasVertical = Math.abs(prevSrcX - prevTgtX) <= Math.abs(prevSrcY - prevTgtY);
          if (wasVertical) {
            const midY = Math.round((srcPt.y + tgtPt.y) / 2);
            injected = [
              { x: srcPt.x, y: midY },
              { x: tgtPt.x, y: midY },
            ];
          } else {
            const midX = Math.round((srcPt.x + tgtPt.x) / 2);
            injected = [
              { x: midX, y: srcPt.y },
              { x: midX, y: tgtPt.y },
            ];
          }
        }
        if (typeof edge.setVertices === "function") {
          edge.setVertices(injected, { ignoreSnap: true });
        }
      }
      continue;
    }

    let modified = false;
    let newVertices: PointLike[] = vertices.map((v: PointLike) => ({ ...v }));

    // Case 1: 1-vertex edge (either collinear 3-point wire or 90-degree L-bend)
    if (newVertices.length === 1) {
      const v0 = newVertices[0]!;
      const prevSrcX = (srcPt?.x ?? v0.x) - (isSource ? dx : 0);
      const prevSrcY = (srcPt?.y ?? v0.y) - (isSource ? dy : 0);
      const prevTgtX = (tgtPt?.x ?? v0.x) - (isTarget ? dx : 0);
      const prevTgtY = (tgtPt?.y ?? v0.y) - (isTarget ? dy : 0);

      const wasCollinearV =
        Boolean(srcPt && tgtPt) &&
        Math.abs(prevSrcX - v0.x) <= 1.5 &&
        Math.abs(prevTgtX - v0.x) <= 1.5 &&
        Math.abs(prevSrcY - v0.y) > 1.5 &&
        Math.abs(prevTgtY - v0.y) > 1.5;
      const wasCollinearH =
        Boolean(srcPt && tgtPt) &&
        Math.abs(prevSrcY - v0.y) <= 1.5 &&
        Math.abs(prevTgtY - v0.y) <= 1.5 &&
        Math.abs(prevSrcX - v0.x) > 1.5 &&
        Math.abs(prevTgtX - v0.x) > 1.5;

      if (wasCollinearV && srcPt && tgtPt && Math.abs(srcPt.x - tgtPt.x) > 0.5) {
        const midY = Math.round((srcPt.y + tgtPt.y) / 2);
        newVertices = [
          { x: srcPt.x, y: midY },
          { x: tgtPt.x, y: midY },
        ];
        modified = true;
      } else if (wasCollinearH && srcPt && tgtPt && Math.abs(srcPt.y - tgtPt.y) > 0.5) {
        const midX = Math.round((srcPt.x + tgtPt.x) / 2);
        newVertices = [
          { x: midX, y: srcPt.y },
          { x: midX, y: tgtPt.y },
        ];
        modified = true;
      } else {
        if (isSource) {
          let isHorizontal: boolean;
          if (tgtPt) {
            const tgtLegDx = Math.abs(tgtPt.x - v0.x);
            const tgtLegDy = Math.abs(tgtPt.y - v0.y);
            if (tgtLegDx <= 1.5 && tgtLegDy > 1.5) {
              isHorizontal = true;
            } else if (tgtLegDy <= 1.5 && tgtLegDx > 1.5) {
              isHorizontal = false;
            } else {
              const scoreHV = Math.abs(prevSrcX - v0.x) + Math.abs(tgtPt.y - v0.y);
              const scoreVH = Math.abs(prevSrcY - v0.y) + Math.abs(tgtPt.x - v0.x);
              isHorizontal = scoreHV >= scoreVH;
            }
          } else {
            isHorizontal = Math.abs(prevSrcX - v0.x) >= Math.abs(prevSrcY - v0.y);
          }
          if (isHorizontal) {
            v0.y += dy;
          } else {
            v0.x += dx;
          }
          modified = true;
        }
        if (isTarget) {
          let isHorizontal: boolean;
          if (srcPt) {
            const srcLegDx = Math.abs(srcPt.x - v0.x);
            const srcLegDy = Math.abs(srcPt.y - v0.y);
            if (srcLegDy <= 1.5 && srcLegDx > 1.5) {
              isHorizontal = false; // first leg is horizontal -> target leg is vertical
            } else if (srcLegDx <= 1.5 && srcLegDy > 1.5) {
              isHorizontal = true; // first leg is vertical -> target leg is horizontal
            } else {
              const scoreHV = Math.abs(srcPt.x - v0.x) + Math.abs(prevTgtY - v0.y);
              const scoreVH = Math.abs(srcPt.y - v0.y) + Math.abs(prevTgtX - v0.x);
              isHorizontal = scoreVH > scoreHV;
            }
          } else {
            isHorizontal = Math.abs(prevTgtX - v0.x) >= Math.abs(prevTgtY - v0.y);
          }
          if (isHorizontal) {
            v0.y += dy;
          } else {
            v0.x += dx;
          }
          modified = true;
        }
      }
    } else {
      // Case 2: 2+ vertices (stub + trunk + ...)
      if (isSource) {
        const v0 = newVertices[0]!;
        const v1 = newVertices[1]!;
        const prevSrcX = (srcPt?.x ?? v0.x) - dx;
        const prevSrcY = (srcPt?.y ?? v0.y) - dy;
        const nextDx = Math.abs(v1.x - v0.x);
        const nextDy = Math.abs(v1.y - v0.y);
        const isHorizontal =
          nextDx + nextDy > 0.5 ? nextDy > nextDx : Math.abs(prevSrcX - v0.x) >= Math.abs(prevSrcY - v0.y);
        if (isHorizontal) {
          v0.y += dy;
        } else {
          v0.x += dx;
        }
        modified = true;
      }

      if (isTarget) {
        const lastIdx = newVertices.length - 1;
        const vLast = newVertices[lastIdx]!;
        const vPrev = newVertices[lastIdx - 1]!;
        const prevTgtX = (tgtPt?.x ?? vLast.x) - dx;
        const prevTgtY = (tgtPt?.y ?? vLast.y) - dy;
        const prevDx = Math.abs(vLast.x - vPrev.x);
        const prevDy = Math.abs(vLast.y - vPrev.y);
        const isHorizontal =
          prevDx + prevDy > 0.5 ? prevDy > prevDx : Math.abs(prevTgtX - vLast.x) >= Math.abs(prevTgtY - vLast.y);
        if (isHorizontal) {
          vLast.y += dy;
        } else {
          vLast.x += dx;
        }
        modified = true;
      }

      // Trunk Pushing: when a port with a known outward normal moves past its perpendicular trunk,
      // push the trunk segment ahead of the port by `minStub` (and slide coincident net trunks).
      if (isSource && srcNormal && srcPt && newVertices.length >= 2) {
        const v0 = newVertices[0]!;
        const v1 = newVertices[1]!;
        if (srcNormal.ny !== 0 && Math.abs(v0.y - v1.y) <= 1.5) {
          const signedStub = (v0.y - srcPt.y) * srcNormal.ny;
          if (signedStub < minStub) {
            const oldTrunkY = v0.y;
            const newTrunkY = srcPt.y + srcNormal.ny * minStub;
            const tgtOk =
              newVertices.length > 2 ||
              !tgtNormal ||
              !tgtPt ||
              tgtNormal.ny === 0 ||
              (newTrunkY - tgtPt.y) * tgtNormal.ny >= minStub - 0.5;
            if (tgtOk) {
              v0.x = srcPt.x;
              v0.y = newTrunkY;
              v1.y = newTrunkY;
              pushCoincidentNetTrunks(g, edge, "y", oldTrunkY, newTrunkY);
            }
          }
        } else if (srcNormal.nx !== 0 && Math.abs(v0.x - v1.x) <= 1.5) {
          const signedStub = (v0.x - srcPt.x) * srcNormal.nx;
          if (signedStub < minStub) {
            const oldTrunkX = v0.x;
            const newTrunkX = srcPt.x + srcNormal.nx * minStub;
            const tgtOk =
              newVertices.length > 2 ||
              !tgtNormal ||
              !tgtPt ||
              tgtNormal.nx === 0 ||
              (newTrunkX - tgtPt.x) * tgtNormal.nx >= minStub - 0.5;
            if (tgtOk) {
              v0.y = srcPt.y;
              v0.x = newTrunkX;
              v1.x = newTrunkX;
              pushCoincidentNetTrunks(g, edge, "x", oldTrunkX, newTrunkX);
            }
          }
        }
      }

      if (isTarget && tgtNormal && tgtPt && newVertices.length >= 2) {
        const lastIdx = newVertices.length - 1;
        const vLast = newVertices[lastIdx]!;
        const vPrev = newVertices[lastIdx - 1]!;
        if (tgtNormal.ny !== 0 && Math.abs(vLast.y - vPrev.y) <= 1.5) {
          const signedStub = (vLast.y - tgtPt.y) * tgtNormal.ny;
          if (signedStub < minStub) {
            const oldTrunkY = vLast.y;
            const newTrunkY = tgtPt.y + tgtNormal.ny * minStub;
            const srcOk =
              newVertices.length > 2 ||
              !srcNormal ||
              !srcPt ||
              srcNormal.ny === 0 ||
              (newTrunkY - srcPt.y) * srcNormal.ny >= minStub - 0.5;
            if (srcOk) {
              vLast.x = tgtPt.x;
              vLast.y = newTrunkY;
              vPrev.y = newTrunkY;
              pushCoincidentNetTrunks(g, edge, "y", oldTrunkY, newTrunkY);
            }
          }
        } else if (tgtNormal.nx !== 0 && Math.abs(vLast.x - vPrev.x) <= 1.5) {
          const signedStub = (vLast.x - tgtPt.x) * tgtNormal.nx;
          if (signedStub < minStub) {
            const oldTrunkX = vLast.x;
            const newTrunkX = tgtPt.x + tgtNormal.nx * minStub;
            const srcOk =
              newVertices.length > 2 ||
              !srcNormal ||
              !srcPt ||
              srcNormal.nx === 0 ||
              (newTrunkX - srcPt.x) * srcNormal.nx >= minStub - 0.5;
            if (srcOk) {
              vLast.y = tgtPt.y;
              vLast.x = newTrunkX;
              vPrev.x = newTrunkX;
              pushCoincidentNetTrunks(g, edge, "x", oldTrunkX, newTrunkX);
            }
          }
        }
      }
    }

    // Self-Impalement & Port-Normal Violation Auto-Reroute:
    // When node/port geometry is available and the translated route still exits backward through a port
    // or crosses its own source/target component bounding box, compute a clean port-aware orthogonal route.
    if (
      srcPt &&
      tgtPt &&
      (srcNormal || tgtNormal || srcBox || tgtBox) &&
      doesPolylineViolatePortOrBox(srcPt, tgtPt, newVertices, srcNormal, tgtNormal, srcBox, tgtBox)
    ) {
      newVertices = computeOrthogonalRoute(srcPt, tgtPt, getOtherObstacles(), {
        sourceSide: srcNormal?.side,
        targetSide: tgtNormal?.side,
        sourceBox: srcBox ?? undefined,
        targetBox: tgtBox ?? undefined,
        stubLength: minStub,
      });
      modified = true;
    }

    if (modified && typeof edge.setVertices === "function") {
      edge.setVertices(newVertices, { ignoreSnap: true });
    }
  }
}

/** Search state node used by the Hanan grid A* router. */
interface GridNode {
  /** Grid X coordinate. */
  x: number;
  /** Grid Y coordinate. */
  y: number;
  /** Direction of arrival at this node (`"h"` horizontal, `"v"` vertical, or `"none"` at start). */
  dir: "h" | "v" | "none";
  /** Accumulated path cost (`g + h` plus bend penalties). */
  cost: number;
  /** Number of 90-degree bends accumulated along the path. */
  bends: number;
  /** Total estimated cost (g + h) used by priority queue. */
  f?: number | undefined;
  /** Predecessor node along the lowest-cost path. */
  parent?: GridNode | undefined;
}

/**
 * Zero-dependency min-binary heap priority queue for A* routing.
 * Replaces O(N log N) Array.prototype.sort and O(N) Array.prototype.shift thrashing in pathfinding loops.
 */
export class BinaryHeap<T> {
  private readonly data: T[] = [];

  constructor(private readonly scoreFn: (item: T) => number) {}

  get size(): number {
    return this.data.length;
  }

  push(item: T): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0]!;
    const bottom = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = bottom;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): T | undefined {
    return this.data[0];
  }

  clear(): void {
    this.data.length = 0;
  }

  private bubbleUp(n: number): void {
    const item = this.data[n]!;
    const score = this.scoreFn(item);
    while (n > 0) {
      const parentN = (n - 1) >> 1;
      const parent = this.data[parentN]!;
      if (score >= this.scoreFn(parent)) break;
      this.data[n] = parent;
      n = parentN;
    }
    this.data[n] = item;
  }

  private sinkDown(n: number): void {
    const length = this.data.length;
    const item = this.data[n]!;
    const elemScore = this.scoreFn(item);

    while (true) {
      const child2N = (n + 1) << 1;
      const child1N = child2N - 1;
      let swap: number | null = null;
      let swapScore = elemScore;

      if (child1N < length) {
        const child1 = this.data[child1N]!;
        const child1Score = this.scoreFn(child1);
        if (child1Score < elemScore) {
          swap = child1N;
          swapScore = child1Score;
        }
      }

      if (child2N < length) {
        const child2 = this.data[child2N]!;
        const child2Score = this.scoreFn(child2);
        if (child2Score < swapScore) {
          swap = child2N;
        }
      }

      if (swap === null) break;
      this.data[n] = this.data[swap]!;
      this.data[swap] = item;
      n = swap;
    }
  }
}

/**
 * Routes an orthogonal path on a 2D occupancy grid (`cols x rows`) using the WebAssembly
 * binary-heap A* kernel (`diagram_route_orthogonal_astar`) when available.
 */
interface DiagramAStarWasmExports {
  __new: (size: number, id: number) => number;
  memory: { buffer: ArrayBufferLike };
  diagram_route_orthogonal_astar: (
    cols: number,
    rows: number,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    startDir: number,
    bendPenalty: number,
    crossingPenalty: number,
    gridPtr: number,
    gScorePtr: number,
    parentPtr: number,
    closedPtr: number,
    heapStatesPtr: number,
    heapPrioritiesPtr: number,
    outWaypointsPtr: number,
    maxWaypoints: number,
  ) => number;
}

interface DiagramAStarScratch {
  wasm: DiagramAStarWasmExports;
  maxCells: number;
  gridPtr: number;
  gScorePtr: number;
  parentPtr: number;
  closedPtr: number;
  heapStatesPtr: number;
  heapPrioritiesPtr: number;
  outWaypointsPtr: number;
}

let diagramAStarScratch: DiagramAStarScratch | null = null;

function ensureDiagramAStarScratch(wasm: DiagramAStarWasmExports, totalCells: number): DiagramAStarScratch {
  if (diagramAStarScratch && diagramAStarScratch.wasm === wasm && diagramAStarScratch.maxCells >= totalCells) {
    return diagramAStarScratch;
  }
  const maxCells = Math.max(totalCells, 16384);
  const totalStates = maxCells * 4;
  const maxWaypoints = Math.min(maxCells, 1024);
  const alloc = (bytes: number): number => wasm.__new(bytes, 0);

  diagramAStarScratch = {
    wasm,
    maxCells,
    gridPtr: alloc(maxCells),
    gScorePtr: alloc(totalStates * 8),
    parentPtr: alloc(totalStates * 4),
    closedPtr: alloc(totalStates),
    heapStatesPtr: alloc(totalStates * 4),
    heapPrioritiesPtr: alloc(totalStates * 8),
    outWaypointsPtr: alloc(maxWaypoints * 2 * 4),
  };
  return diagramAStarScratch;
}

export function routeOrthogonalGridAStar(options: {
  cols: number;
  rows: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startDir?: number | undefined;
  bendPenalty?: number | undefined;
  crossingPenalty?: number | undefined;
  grid: Uint8Array;
}): [number, number][] {
  const { cols, rows, startX, startY, endX, endY, grid } = options;
  const wasm =
    typeof globalThis !== "undefined"
      ? (globalThis as { __modelscript_wasm_exports__?: Partial<DiagramAStarWasmExports> | undefined })
          .__modelscript_wasm_exports__
      : null;
  if (wasm && typeof wasm.diagram_route_orthogonal_astar === "function" && wasm.__new && wasm.memory) {
    const validWasm = wasm as DiagramAStarWasmExports;
    // Each grid cell has 4 directional states (N, E, S, W) to penalize 90-degree bends accurately
    const totalCells = cols * rows;
    const maxWaypoints = Math.min(totalCells, 1024);
    const sc = ensureDiagramAStarScratch(validWasm, totalCells);

    // Copy occupancy grid (0 = free, 1 = obstacle, 2 = existing wire) into WASM linear memory
    new Uint8Array(validWasm.memory.buffer, sc.gridPtr, totalCells).set(grid.subarray(0, totalCells));

    const count: number = validWasm.diagram_route_orthogonal_astar(
      cols,
      rows,
      startX,
      startY,
      endX,
      endY,
      options.startDir ?? -1,
      options.bendPenalty ?? 2.5,
      options.crossingPenalty ?? 4.0,
      sc.gridPtr,
      sc.gScorePtr,
      sc.parentPtr,
      sc.closedPtr,
      sc.heapStatesPtr,
      sc.heapPrioritiesPtr,
      sc.outWaypointsPtr,
      maxWaypoints,
    );

    // Unpack interleaved (x, y) int32 waypoint pairs returned by the WASM kernel
    const outView = new Int32Array(validWasm.memory.buffer, sc.outWaypointsPtr, count * 2);
    const waypoints: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      waypoints.push([outView[i * 2]!, outView[i * 2 + 1]!]);
    }
    return waypoints;
  }

  // Deterministic orthogonal Manhattan fallback when WASM router is not loaded or fails
  if (Math.abs(startX - endX) < 1e-3 || Math.abs(startY - endY) < 1e-3) {
    return [
      [startX, startY],
      [endX, endY],
    ];
  }

  const midX = Math.round(((startX + endX) / 2) * 10) / 10;
  return [
    [startX, startY],
    [midX, startY],
    [midX, endY],
    [endX, endY],
  ];
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
    const o1 = sortedObsByX[i]!;
    const o2 = sortedObsByX[i + 1]!;
    const gap = o2.x - (o1.x + o1.width);
    if (gap > padding * 2) {
      xs.add(Math.round((o1.x + o1.width + o2.x) / 2));
    }
  }

  const sortedObsByY = [...obstacles].sort((a, b) => a.y - b.y);
  for (let i = 0; i < sortedObsByY.length - 1; i++) {
    const o1 = sortedObsByY[i]!;
    const o2 = sortedObsByY[i + 1]!;
    const gap = o2.y - (o1.y + o1.height);
    if (gap > padding * 2) {
      ys.add(Math.round((o1.y + o1.height + o2.y) / 2));
    }
  }

  const sortedX = Array.from(xs).sort((a, b) => a - b);
  const sortedY = Array.from(ys).sort((a, b) => a - b);

  const startH = Math.abs(target.x - source.x) + Math.abs(target.y - source.y);
  const open = new BinaryHeap<GridNode>((n) => n.f ?? n.cost);
  open.push({
    x: source.x,
    y: source.y,
    dir: "none",
    cost: 0,
    bends: 0,
    f: startH,
  });
  const closed = new Set<string>();

  const isSegmentValid = (p1: PointLike, p2: PointLike): boolean => {
    return !obstacles.some((r) => segmentIntersectsRect(p1, p2, r, padding - 2));
  };

  while (open.size > 0) {
    const curr = open.pop()!;
    if (curr.x === target.x && curr.y === target.y) {
      const path: PointLike[] = [];
      let c: GridNode | undefined = curr;
      while (c) {
        path.push({ x: c.x, y: c.y });
        c = c.parent;
      }
      path.reverse();

      return simplifyCollinearPoints(path, 0.001);
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
      const nextCost = curr.cost + dist;
      const nextBends = curr.bends + (isBend ? 1 : 0);
      const h = Math.abs(target.x - nx) + Math.abs(target.y - curr.y) + nextBends * bendPenalty;
      open.push({
        x: nx,
        y: curr.y,
        dir: "h",
        cost: nextCost,
        bends: nextBends,
        f: nextCost + h,
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
      const nextCost = curr.cost + dist;
      const nextBends = curr.bends + (isBend ? 1 : 0);
      const h = Math.abs(target.x - curr.x) + Math.abs(target.y - ny) + nextBends * bendPenalty;
      open.push({
        x: curr.x,
        y: ny,
        dir: "v",
        cost: nextCost,
        bends: nextBends,
        f: nextCost + h,
        parent: curr,
      });
    }
  }

  return null;
}

function computeOrthogonalRouteCore(
  source: PointLike,
  target: PointLike,
  obstacles: RectLike[] = [],
  options: RouterOptions = {},
): PointLike[] {
  const padding = options.padding ?? 12;
  const step = options.step ?? 10;
  const parallelOffset = (options.parallelIndex ?? 0) * (options.channelSpacing ?? 8);

  // If direct horizontal or vertical line with no obstacle collision and no parallel offset
  const isDirectH = Math.abs(source.y - target.y) < 0.05;
  const isDirectV = Math.abs(source.x - target.x) < 0.05;

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
    obstacles.some((r) => segmentIntersectsRect(source, routeTop[0]!, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeTop[0]!, routeTop[1]!, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeTop[1]!, target, r, padding));
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
    obstacles.some((r) => segmentIntersectsRect(source, routeBottom[0]!, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeBottom[0]!, routeBottom[1]!, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeBottom[1]!, target, r, padding));
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
    obstacles.some((r) => segmentIntersectsRect(source, routeLeft[0]!, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeLeft[0]!, routeLeft[1]!, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeLeft[1]!, target, r, padding));
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
    obstacles.some((r) => segmentIntersectsRect(source, routeRight[0]!, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeRight[0]!, routeRight[1]!, r, padding)) ||
    obstacles.some((r) => segmentIntersectsRect(routeRight[1]!, target, r, padding));
  if (!collidesRight) {
    const len = Math.abs(source.x - detourRightX) + Math.abs(target.y - source.y) + Math.abs(target.x - detourRightX);
    candidateRoutes.push({ route: routeRight, length: len });
  }

  if (candidateRoutes.length > 0) {
    candidateRoutes.sort((a, b) => a.length - b.length);
    return candidateRoutes[0]!.route;
  }

  // Fallback: default top channel
  return [
    { x: source.x, y: detourTopY },
    { x: target.x, y: detourTopY },
  ];
}

/**
 * Computes an obstacle-free orthogonal route between source and target points,
 * supporting directional port outward normals, component self-impalement avoidance,
 * 4-way obstacle detours, and parallel bus connection staggering.
 */
export function computeOrthogonalRoute(
  source: PointLike,
  target: PointLike,
  obstacles: RectLike[] = [],
  options: RouterOptions = {},
): PointLike[] {
  const hasPortConstraints = Boolean(
    options.sourceSide || options.targetSide || options.sourceBox || options.targetBox,
  );
  if (!hasPortConstraints) {
    return healOrthogonalVertices(source, target, computeOrthogonalRouteCore(source, target, obstacles, options));
  }

  const padding = options.padding ?? 12;
  const parallelOffset = (options.parallelIndex ?? 0) * (options.channelSpacing ?? 8);
  const stubLength = options.stubLength ?? 10;

  const srcNormal = options.sourceSide
    ? sideToNormal(options.sourceSide)
    : options.sourceBox
      ? inferPortNormalFromBox(source, options.sourceBox)
      : null;
  const tgtNormal = options.targetSide
    ? sideToNormal(options.targetSide)
    : options.targetBox
      ? inferPortNormalFromBox(target, options.targetBox)
      : null;

  const isCandidateValid = (waypoints: PointLike[]): boolean => {
    if (
      doesPolylineViolatePortOrBox(
        source,
        target,
        waypoints,
        srcNormal,
        tgtNormal,
        options.sourceBox ?? null,
        options.targetBox ?? null,
      )
    ) {
      return false;
    }
    const pts = [source, ...waypoints, target];
    for (let i = 0; i < pts.length - 1; i++) {
      if (obstacles.some((r) => segmentIntersectsRect(pts[i]!, pts[i + 1]!, r, padding))) {
        return false;
      }
    }
    return true;
  };

  const pathLength = (waypoints: PointLike[]): number => {
    const pts = [source, ...waypoints, target];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      total += Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
    }
    return total;
  };

  if (parallelOffset === 0) {
    // 1. Direct straight line (0 bends)
    if ((Math.abs(source.x - target.x) < 0.05 || Math.abs(source.y - target.y) < 0.05) && isCandidateValid([])) {
      return [];
    }

    // 2. Single 90-degree L-bend (1 vertex) if compatible with both port normals
    const lCandidates: PointLike[][] = [];
    if (Math.abs(source.x - target.x) >= 0.05 && Math.abs(source.y - target.y) >= 0.05) {
      const hv: PointLike[] = [{ x: target.x, y: source.y }];
      const vh: PointLike[] = [{ x: source.x, y: target.y }];
      if (isCandidateValid(hv)) lCandidates.push(hv);
      if (isCandidateValid(vh)) lCandidates.push(vh);
      if (lCandidates.length > 0) {
        lCandidates.sort((a, b) => pathLength(a) - pathLength(b));
        return lCandidates[0]!;
      }
    }
  }

  // 3. Project outward port stubs and evaluate clean stub-to-stub orthogonal routes
  const sStub = srcNormal
    ? projectPortNormalStub(source, srcNormal, stubLength + parallelOffset, options.sourceBox)
    : source;
  const tStub = tgtNormal
    ? projectPortNormalStub(target, tgtNormal, stubLength + parallelOffset, options.targetBox)
    : target;

  const buildStubCandidate = (inner: PointLike[]): PointLike[] => {
    const full = simplifyCollinearPoints([source, sStub, ...inner, tStub, target], 0.05);
    return healOrthogonalVertices(source, target, full.slice(1, -1));
  };

  const stubCandidates: PointLike[][] = [];

  // 3a. Direct connection between sStub and tStub
  if (Math.abs(sStub.x - tStub.x) < 0.05 || Math.abs(sStub.y - tStub.y) < 0.05) {
    const directStub = buildStubCandidate([]);
    if (isCandidateValid(directStub)) stubCandidates.push(directStub);
  }

  // 3b. 1-bend between sStub and tStub
  const stubHV = buildStubCandidate([{ x: tStub.x, y: sStub.y }]);
  const stubVH = buildStubCandidate([{ x: sStub.x, y: tStub.y }]);
  if (isCandidateValid(stubHV)) stubCandidates.push(stubHV);
  if (isCandidateValid(stubVH)) stubCandidates.push(stubVH);

  // 3c. 2-bend Z-step between sStub and tStub (midpoint X or midpoint Y)
  const step = options.step ?? 10;
  const midX = Math.round(((sStub.x + tStub.x) / 2 + parallelOffset) / step) * step;
  const midY = Math.round(((sStub.y + tStub.y) / 2 + parallelOffset) / step) * step;
  const stubZ_H = buildStubCandidate([
    { x: midX, y: sStub.y },
    { x: midX, y: tStub.y },
  ]);
  const stubZ_V = buildStubCandidate([
    { x: sStub.x, y: midY },
    { x: tStub.x, y: midY },
  ]);
  if (isCandidateValid(stubZ_H)) stubCandidates.push(stubZ_H);
  if (isCandidateValid(stubZ_V)) stubCandidates.push(stubZ_V);

  if (stubCandidates.length > 0) {
    stubCandidates.sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      return pathLength(a) - pathLength(b);
    });
    return stubCandidates[0]!;
  }

  // 4. Full obstacle-avoiding route between sStub and tStub including sourceBox and targetBox
  const extendedObstacles: RectLike[] = [...obstacles];
  if (options.sourceBox) extendedObstacles.push(shrinkRect(options.sourceBox, 2));
  if (options.targetBox) extendedObstacles.push(shrinkRect(options.targetBox, 2));

  const innerWaypoints = computeOrthogonalRouteCore(sStub, tStub, extendedObstacles, {
    ...options,
    padding: Math.min(padding, Math.max(4, stubLength - 2)),
  });
  return buildStubCandidate(innerWaypoints);
}

/**
 * AntV X6 custom router adapter with obstacle avoidance, port outward normals, and parallel edge staggering.
 */
export function portOrthogonalRouter(
  vertices: PointLike[],
  args: RouterOptions & Record<string, unknown> = {},
  edgeView?: RouterEdgeViewLike,
): PointLike[] {
  // If manual vertices are explicitly specified, preserve them while healing any terminal/interior orthogonality drift
  if (vertices && vertices.length > 0) {
    if (edgeView?.sourcePoint && edgeView?.targetPoint) {
      return healOrthogonalVertices(edgeView.sourcePoint, edgeView.targetPoint, vertices);
    }
    return vertices;
  }

  if (!edgeView) return [];

  const source = edgeView.sourcePoint;
  const target = edgeView.targetPoint;
  if (!source || !target) return [];

  // Extract obstacle rectangles, port normals, and parallel edges from graph cells
  const graph = edgeView.graph;
  const obstacles: RectLike[] = [];
  let parallelIndex = 0;
  let parallelCount = 1;
  let sourceSide: PortSide | undefined;
  let targetSide: PortSide | undefined;
  let sourceBox: RectLike | undefined;
  let targetBox: RectLike | undefined;

  if (graph && typeof graph.getNodes === "function") {
    const sourceCell = edgeView.cell?.getSourceCell?.();
    const targetCell = edgeView.cell?.getTargetCell?.();
    const sourcePortId = edgeView.cell?.getSourcePortId?.() ?? edgeView.cell?.source?.port;
    const targetPortId = edgeView.cell?.getTargetPortId?.() ?? edgeView.cell?.target?.port;

    if (sourceCell) {
      sourceSide = getPortOutwardNormal(sourceCell, sourcePortId, source)?.side;
      sourceBox = getNodeBBox(sourceCell) ?? undefined;
    }
    if (targetCell) {
      targetSide = getPortOutwardNormal(targetCell, targetPortId, target)?.side;
      targetBox = getNodeBBox(targetCell) ?? undefined;
    }

    for (const node of graph.getNodes()) {
      if (node.id === sourceCell?.id || node.id === targetCell?.id) continue;
      if (
        !node.id ||
        node.id.startsWith("solder_dot_") ||
        node.id.startsWith("__seq_stem_") ||
        node.id.startsWith("__alignment_guide_") ||
        node.id === "__diagram_background__" ||
        node.id === "__diagram_axes__"
      ) {
        continue;
      }

      const bbox = getNodeBBox(node);
      if (bbox) {
        obstacles.push(bbox);
      }
    }

    if (sourceCell && targetCell && typeof graph.getEdges === "function") {
      const allEdges = graph.getEdges();
      const parallelEdges = allEdges.filter((e: RouterEdgeLike) => {
        const s = e.getSourceCell?.()?.id;
        const t = e.getTargetCell?.()?.id;
        return (s === sourceCell.id && t === targetCell.id) || (s === targetCell.id && t === sourceCell.id);
      });
      if (parallelEdges.length > 1) {
        parallelCount = parallelEdges.length;
        const idx = parallelEdges.findIndex((e: RouterEdgeLike) => e.id === edgeView.cell?.id);
        if (idx !== -1) {
          parallelIndex = idx;
        }
      }
    }
  }

  const routerArgs: RouterOptions = {
    sourceSide,
    targetSide,
    sourceBox,
    targetBox,
    ...args,
    parallelIndex,
    parallelCount,
  };

  return computeOrthogonalRoute(source, target, obstacles, routerArgs);
}

/** Orthogonal boundary stem line projecting an internal port pad to its closest exterior node face. */
export interface BoundaryStemLine {
  /** Unique identifier of the stem line (`stem_<nodeId>_<portId>`). */
  id: string;
  /** ID of the parent component node. */
  nodeId: string;
  /** ID of the internal port. */
  portId: string;
  /** Internal port anchor point. */
  start: PointLike;
  /** Projected point on the exterior boundary of the node. */
  end: PointLike;
  /** Target boundary face of the node. */
  side: "top" | "bottom" | "left" | "right";
}

/**
 * Computes boundary stem lines for internal ports within a node.
 * If a port is located strictly inside the node body, an orthogonal stem segment
 * is emitted to project the connection anchor cleanly to the exterior perimeter.
 */
export function computeStemLines(
  node: { id: string; x: number; y: number; width: number; height: number },
  ports: { id: string; x: number; y: number; side?: "top" | "bottom" | "left" | "right" | undefined }[],
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

/** Orthogonal line segment used to detect wire crossings for semicircular bridge jumpovers. */
export interface JumpoverSegment {
  /** First endpoint of the obstacle segment. */
  p1: PointLike;
  /** Second endpoint of the obstacle segment. */
  p2: PointLike;
}

/**
 * Computes an SVG path string for an orthogonal route with semicircular bridge jumpovers
 * at crossings with perpendicular obstacle segments.
 */
export function computeJumpoverPath(
  points: PointLike[],
  obstacles: JumpoverSegment[] = [],
  options: { radius?: number | undefined } = {},
): string {
  if (points.length < 2) {
    if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
    return "";
  }

  const radius = options.radius ?? 5;
  let d = `M ${points[0]!.x} ${points[0]!.y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;

    const isHorizontal = Math.abs(p1.y - p2.y) < 0.001;

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
    if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
    return "";
  }

  if (points.length === 2) {
    const p0 = points[0]!;
    const p1 = points[1]!;
    const dx = p1.x - p0.x;
    const cp1x = Number((p0.x + dx / 2).toFixed(1));
    const cp1y = p0.y;
    const cp2x = Number((p0.x + dx / 2).toFixed(1));
    const cp2y = p1.y;
    return `M ${p0.x} ${p0.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1]! : points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = i < points.length - 2 ? points[i + 2]! : p2;

    const cp1x = Number((p1.x + (p2.x - p0.x) / 6).toFixed(1));
    const cp1y = Number((p1.y + (p2.y - p0.y) / 6).toFixed(1));
    const cp2x = Number((p2.x - (p3.x - p1.x) / 6).toFixed(1));
    const cp2y = Number((p2.y - (p3.y - p1.y) / 6).toFixed(1));

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}

/** Perpendicular departure stub segment exiting from a component port. */
export interface PortStubInfo {
  /** Exterior endpoint of the perpendicular departure stub. */
  stubPoint: PointLike;
  /** Two-point segment `[portPoint, stubPoint]`. */
  stubLine: [PointLike, PointLike];
  /** Cardinal boundary side from which the stub exits. */
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

/** Result of assigning a routing interval to a non-overlapping parallel channel track. */
export interface ChannelTrackAssignment<T> {
  /** Original interval item. */
  item: T;
  /** Zero-based track index allocated by the Left-Edge algorithm. */
  track: number;
  /** Signed perpendicular offset from the channel centerline in diagram units. */
  offset: number;
  /** Total number of parallel tracks required in the channel. */
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
      if (tracks[t]!.end + minGap <= seg.start) {
        tracks[t]!.end = seg.end;
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

/** Condensed multi-wire bus trunk with individual source and target breakout stems. */
export interface BusBundle {
  /** Unique identifier of the bus bundle (`bus_<sourceNodeId>_<targetNodeId>`). */
  id: string;
  /** Source component node ID. */
  sourceNodeId: string;
  /** Target component node ID. */
  targetNodeId: string;
  /** IDs of all edges aggregated into this bus bundle. */
  edgeIds: string[];
  /** Shared trunk segment `[startPoint, endPoint]`. */
  trunk: [PointLike, PointLike];
  /** Individual orthogonal breakout stems connecting each edge's ports to the shared trunk. */
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
  options: { channelAxis?: "x" | "y" | undefined; trunkCoord?: number | undefined } = {},
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

  // 1. Compute centroid of source and target ports to determine dominant inter-block displacement
  const avgSourceX = connections.reduce((s, c) => s + c.source.x, 0) / connections.length;
  const avgTargetX = connections.reduce((s, c) => s + c.target.x, 0) / connections.length;
  const avgSourceY = connections.reduce((s, c) => s + c.source.y, 0) / connections.length;
  const avgTargetY = connections.reduce((s, c) => s + c.target.y, 0) / connections.length;

  const dx = Math.abs(avgTargetX - avgSourceX);
  const dy = Math.abs(avgTargetY - avgSourceY);

  // Select horizontal ("x") or vertical ("y") shared trunk orientation
  const axis = options.channelAxis ?? (dx >= dy ? "x" : "y");
  const stems: BusBundle["stems"] = [];

  if (axis === "x") {
    // 2a. Horizontal bus trunk at y = trunkY with vertical orthogonal breakout stems
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
    // 2b. Vertical bus trunk at x = trunkX with horizontal orthogonal breakout stems
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
    if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
    return "";
  }
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }

  let d = `M ${points[0]!.x} ${points[0]!.y}`;

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    const next = points[i + 1]!;

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

  const last = points[points.length - 1]!;
  d += ` L ${last.x} ${last.y}`;
  return d;
}
