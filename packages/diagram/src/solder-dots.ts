// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Topological Solder Dot Junction Engine for Schematics & Polyglot Diagrams.
// Detects connection convergence points where multiple lines share an anchor or intersection.

export interface SolderDot {
  id: string;
  x: number;
  y: number;
  color: string;
  edgeIds: [string, string] | string[];
}

export interface EdgePath {
  id: string;
  points: { x: number; y: number }[];
  color?: string;
}

export interface ComputeSolderDotsOptions {
  cellSize?: number;
  tolerance?: number;
  portPoints?: { x: number; y: number }[];
}

export function distToSegmentSquared(px: number, py: number, vx: number, vy: number, wx: number, wy: number): number {
  const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
  if (l2 === 0) return (px - vx) * (px - vx) + (py - vy) * (py - vy);
  const t = Math.max(0, Math.min(1, ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2));
  const dx = px - (vx + t * (wx - vx));
  const dy = py - (vy + t * (wy - vy));
  return dx * dx + dy * dy;
}

/**
 * Computes solder junction dots for an array of edge paths using an O(V) spatial hash grid,
 * topological branch degree counting, and subpixel coordinate clustering.
 */
export function computeSolderDots(
  edges: EdgePath[],
  optionsOrCellSize: number | ComputeSolderDotsOptions = 40,
): SolderDot[] {
  const opts: ComputeSolderDotsOptions =
    typeof optionsOrCellSize === "number" ? { cellSize: optionsOrCellSize } : optionsOrCellSize || {};
  const cellSize = opts.cellSize ?? 40;
  const tolerance = opts.tolerance ?? 2.5;
  const tolSq = tolerance * tolerance;
  const portPoints = opts.portPoints;

  const validEdges = edges.filter((e) => e.points && e.points.length >= 2);
  if (validEdges.length === 0) return [];

  // 1. Gather all candidate vertices from all valid edges
  interface RawCandidate {
    x: number;
    y: number;
    color: string;
  }
  const rawCandidates: RawCandidate[] = [];
  for (const edge of validEdges) {
    const color = edge.color && edge.color !== "none" ? edge.color : "#333333";
    for (const pt of edge.points) {
      rawCandidates.push({ x: pt.x, y: pt.y, color });
    }
  }

  // 2. Cluster candidate points within tolerance to eliminate subpixel jitter and duplicate junctions
  interface JunctionCluster {
    x: number;
    y: number;
    count: number;
    preferredColor?: string;
  }
  const clusters: JunctionCluster[] = [];
  const clusterGrid = new Map<string, JunctionCluster[]>();
  const clusterCellSize = Math.max(cellSize, 40);

  for (const rc of rawCandidates) {
    const gx = Math.floor(rc.x / clusterCellSize);
    const gy = Math.floor(rc.y / clusterCellSize);
    let matchedCluster: JunctionCluster | null = null;

    outerCluster: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = clusterGrid.get(`${gx + dx}:${gy + dy}`);
        if (!bucket) continue;
        for (const cl of bucket) {
          const d2 = (rc.x - cl.x) * (rc.x - cl.x) + (rc.y - cl.y) * (rc.y - cl.y);
          if (d2 <= tolSq) {
            matchedCluster = cl;
            break outerCluster;
          }
        }
      }
    }

    if (matchedCluster) {
      matchedCluster.x = (matchedCluster.x * matchedCluster.count + rc.x) / (matchedCluster.count + 1);
      matchedCluster.y = (matchedCluster.y * matchedCluster.count + rc.y) / (matchedCluster.count + 1);
      matchedCluster.count++;
      if (!matchedCluster.preferredColor && rc.color !== "#333333") {
        matchedCluster.preferredColor = rc.color;
      }
    } else {
      const newCluster: JunctionCluster = {
        x: rc.x,
        y: rc.y,
        count: 1,
        preferredColor: rc.color !== "#333333" ? rc.color : undefined,
      };
      clusters.push(newCluster);
      const key = `${gx}:${gy}`;
      let bucket = clusterGrid.get(key);
      if (!bucket) {
        bucket = [];
        clusterGrid.set(key, bucket);
      }
      bucket.push(newCluster);
    }
  }

  // 3. Spatial hash index for path segments
  interface IndexedSegment {
    edgeId: string;
    color: string;
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    isStartSegment: boolean;
    isEndSegment: boolean;
  }
  const segmentGrid = new Map<string, IndexedSegment[]>();

  for (const edge of validEdges) {
    const color = edge.color && edge.color !== "none" ? edge.color : "#333333";
    for (let k = 0; k < edge.points.length - 1; k++) {
      const p1 = edge.points[k];
      const p2 = edge.points[k + 1];
      const seg: IndexedSegment = {
        edgeId: edge.id,
        color,
        p1,
        p2,
        isStartSegment: k === 0,
        isEndSegment: k === edge.points.length - 2,
      };

      const minX = Math.floor(Math.min(p1.x, p2.x) / cellSize);
      const maxX = Math.floor(Math.max(p1.x, p2.x) / cellSize);
      const minY = Math.floor(Math.min(p1.y, p2.y) / cellSize);
      const maxY = Math.floor(Math.max(p1.y, p2.y) / cellSize);

      for (let gx = minX; gx <= maxX; gx++) {
        for (let gy = minY; gy <= maxY; gy++) {
          const key = `${gx}:${gy}`;
          let bucket = segmentGrid.get(key);
          if (!bucket) {
            bucket = [];
            segmentGrid.set(key, bucket);
          }
          bucket.push(seg);
        }
      }
    }
  }

  // 4. Test each cluster for topological junction criteria
  const dots: SolderDot[] = [];
  const seenIds = new Set<string>();

  for (const C of clusters) {
    // Exclude clusters located on component connection ports/pins
    if (portPoints && portPoints.length > 0) {
      let isAtPort = false;
      for (const pp of portPoints) {
        const d2 = (C.x - pp.x) * (C.x - pp.x) + (C.y - pp.y) * (C.y - pp.y);
        if (d2 <= tolSq * 1.5) {
          isAtPort = true;
          break;
        }
      }
      if (isAtPort) continue;
    }

    const cgx = Math.floor(C.x / cellSize);
    const cgy = Math.floor(C.y / cellSize);

    const edgeBranches = new Map<string, number>();
    const edgeColors = new Map<string, string>();
    const checkedSegments = new Set<IndexedSegment>();

    let snapX = C.x;
    let snapY = C.y;
    let hasThroughWire = false;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = segmentGrid.get(`${cgx + dx}:${cgy + dy}`);
        if (!bucket) continue;

        for (const seg of bucket) {
          if (checkedSegments.has(seg)) continue;
          checkedSegments.add(seg);

          const vx = seg.p1.x;
          const vy = seg.p1.y;
          const wx = seg.p2.x;
          const wy = seg.p2.y;
          const segDx = wx - vx;
          const segDy = wy - vy;
          const l2 = segDx * segDx + segDy * segDy;
          if (l2 === 0) continue;

          const tRaw = ((C.x - vx) * segDx + (C.y - vy) * segDy) / l2;
          const tClamped = Math.max(0, Math.min(1, tRaw));
          const projX = vx + tClamped * segDx;
          const projY = vy + tClamped * segDy;
          const d2 = (C.x - projX) * (C.x - projX) + (C.y - projY) * (C.y - projY);

          if (d2 <= tolSq) {
            const dP1 = Math.hypot(C.x - vx, C.y - vy);
            const dP2 = Math.hypot(C.x - wx, C.y - wy);

            let branches = 0;
            if (dP1 <= tolerance) {
              branches = seg.isStartSegment ? 1 : 2;
            } else if (dP2 <= tolerance) {
              branches = seg.isEndSegment ? 1 : 2;
            } else {
              // In interior of segment -> continuous line through cluster
              branches = 2;
              if (!hasThroughWire) {
                snapX = projX;
                snapY = projY;
                hasThroughWire = true;
              }
            }

            const current = edgeBranches.get(seg.edgeId) || 0;
            edgeBranches.set(seg.edgeId, Math.max(current, branches));
            if (!edgeColors.has(seg.edgeId)) {
              edgeColors.set(seg.edgeId, seg.color);
            }
          }
        }
      }
    }

    let totalBranches = 0;
    for (const b of edgeBranches.values()) {
      totalBranches += b;
    }

    // Must be a true junction: at least 3 branches meeting and at least 2 distinct edges
    if (totalBranches < 3) continue;
    if (edgeBranches.size < 2) continue;

    const incidentEdgeIds = Array.from(edgeBranches.keys()).sort();
    const id =
      incidentEdgeIds.length === 2
        ? `solder_dot_${incidentEdgeIds[0]}_${incidentEdgeIds[1]}`
        : `solder_dot_${incidentEdgeIds.join("_")}`;

    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const color = C.preferredColor || edgeColors.get(incidentEdgeIds[0]) || "#333333";

    dots.push({
      id,
      x: Math.round(snapX * 10) / 10,
      y: Math.round(snapY * 10) / 10,
      color,
      edgeIds: incidentEdgeIds as any,
    });
  }

  return dots;
}

/**
 * Converts a SolderDot into an AntV X6 node suitable for serialization.
 */
export function solderDotToDiagramNode(dot: SolderDot, size = 3): any {
  const r = size / 2;
  return {
    id: dot.id,
    shape: "circle",
    x: dot.x - r,
    y: dot.y - r,
    width: size,
    height: size,
    angle: 0,
    opacity: 1,
    zIndex: 20,
    autoLayout: false,
    markup: [
      {
        tagName: "circle",
        selector: "body",
        attrs: {
          cx: r,
          cy: r,
          r,
          fill: dot.color,
          stroke: "none",
          pointerEvents: "none",
          style: "pointer-events: none;",
        },
      },
    ],
    attrs: {
      body: {
        fill: dot.color,
        stroke: "none",
        pointerEvents: "none",
        style: { pointerEvents: "none" },
      },
    },
    ports: { items: [], groups: {} },
  };
}
