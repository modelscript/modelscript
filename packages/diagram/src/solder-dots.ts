// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Topological Solder Dot Junction Engine for Schematics & Polyglot Diagrams.
// Detects connection convergence points where multiple lines share an anchor or intersection.

export interface SolderDot {
  id: string;
  x: number;
  y: number;
  color: string;
  edgeIds: [string, string];
}

export interface EdgePath {
  id: string;
  points: { x: number; y: number }[];
  color?: string;
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
 * Computes solder junction dots for an array of edge paths using an O(V) spatial hash grid.
 */
export function computeSolderDots(edges: EdgePath[], cellSize = 40): SolderDot[] {
  const allPaths: { id: string; points: { x: number; y: number }[]; color: string }[] = [];
  const candidateVertices = new Map<string, { x: number; y: number; pathId: string; color: string }>();

  for (const edge of edges) {
    if (!edge.points || edge.points.length < 2) continue;
    const color = edge.color && edge.color !== "none" ? edge.color : "#333333";
    allPaths.push({ id: edge.id, points: edge.points, color });

    for (const v of edge.points) {
      const key = `${v.x.toFixed(1)},${v.y.toFixed(1)}`;
      candidateVertices.set(key, { x: v.x, y: v.y, pathId: edge.id, color });
    }
  }

  // Spatial hash index for path segments to achieve O(V) junction queries
  const grid = new Map<string, { pathId: string; p1: { x: number; y: number }; p2: { x: number; y: number } }[]>();

  for (const path of allPaths) {
    for (let k = 0; k < path.points.length - 1; k++) {
      const p1 = path.points[k];
      const p2 = path.points[k + 1];
      const minX = Math.floor(Math.min(p1.x, p2.x) / cellSize);
      const maxX = Math.floor(Math.max(p1.x, p2.x) / cellSize);
      const minY = Math.floor(Math.min(p1.y, p2.y) / cellSize);
      const maxY = Math.floor(Math.max(p1.y, p2.y) / cellSize);

      const segment = { pathId: path.id, p1, p2 };
      for (let gx = minX; gx <= maxX; gx++) {
        for (let gy = minY; gy <= maxY; gy++) {
          const key = `${gx}:${gy}`;
          let bucket = grid.get(key);
          if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
          }
          bucket.push(segment);
        }
      }
    }
  }

  const dots: SolderDot[] = [];
  const seenIds = new Set<string>();

  for (const candidate of candidateVertices.values()) {
    let isJunction = false;
    let intersectingPathId = "";

    const gx = Math.floor(candidate.x / cellSize);
    const gy = Math.floor(candidate.y / cellSize);

    outer: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = grid.get(`${gx + dx}:${gy + dy}`);
        if (!bucket) continue;
        for (const seg of bucket) {
          if (seg.pathId === candidate.pathId) continue;
          if (distToSegmentSquared(candidate.x, candidate.y, seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y) < 1.0) {
            isJunction = true;
            intersectingPathId = seg.pathId;
            break outer;
          }
        }
      }
    }

    if (isJunction) {
      const ids = [candidate.pathId, intersectingPathId].sort();
      const id = `solder_dot_${ids[0]}_${ids[1]}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        dots.push({
          id,
          x: candidate.x,
          y: candidate.y,
          color: candidate.color,
          edgeIds: [ids[0], ids[1]],
        });
      }
    }
  }

  return dots;
}

/**
 * Converts a SolderDot into an AntV X6 node suitable for serialization.
 */
export function solderDotToDiagramNode(dot: SolderDot): any {
  return {
    id: dot.id,
    shape: "circle",
    x: dot.x - 1.5,
    y: dot.y - 1.5,
    width: 3,
    height: 3,
    angle: 0,
    opacity: 1,
    zIndex: 20,
    autoLayout: false,
    markup: [
      {
        tagName: "circle",
        selector: "body",
        attrs: {
          cx: 1.5,
          cy: 1.5,
          r: 1.5,
          fill: dot.color,
          stroke: "none",
        },
      },
    ],
    attrs: {
      body: {
        fill: dot.color,
        stroke: "none",
      },
    },
    ports: { items: [], groups: {} },
  };
}
