// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Incremental Layout Engine with Bounding Anchor Stabilization & Mental Map Preservation.
// Minimizes visual disruption when adding/removing elements or expanding/collapsing
// nested containers in diagram views.

export interface NodePosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: string;
  isNew?: boolean;
}

export interface IncrementalOptions {
  anchorWeight?: number;
  repulsionWeight?: number;
  padding?: number;
  iterations?: number;
}

export interface ContainerExpansion {
  id: string;
  x: number;
  y: number;
  oldWidth: number;
  oldHeight: number;
  newWidth: number;
  newHeight: number;
}

export interface LayoutDelta {
  id: string;
  dx: number;
  dy: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

/**
 * Computes incremental position updates that preserve the user's mental map,
 * anchoring existing node positions and gently resolving overlaps.
 */
export function computeIncrementalStabilization(
  existingNodes: NodePosition[],
  incomingNodes: NodePosition[],
  edges: { source: string; target: string }[] = [],
  options: IncrementalOptions = {},
): NodePosition[] {
  const padding = options.padding ?? 24;
  const iterations = options.iterations ?? 20;

  const existingMap = new Map<string, NodePosition>();
  for (const n of existingNodes) {
    existingMap.set(n.id, n);
  }

  // Determine initial coordinates for incoming nodes
  const nodes: NodePosition[] = incomingNodes.map((n) => {
    const prev = existingMap.get(n.id);
    if (prev) {
      return {
        ...n,
        x: prev.x,
        y: prev.y,
        isNew: false,
      };
    }

    // New node: place near connected neighbors if possible
    const connectedNeighbors: NodePosition[] = [];
    for (const e of edges) {
      if (e.source === n.id && existingMap.has(e.target)) {
        connectedNeighbors.push(existingMap.get(e.target)!);
      } else if (e.target === n.id && existingMap.has(e.source)) {
        connectedNeighbors.push(existingMap.get(e.source)!);
      }
    }

    if (connectedNeighbors.length > 0) {
      const avgX = connectedNeighbors.reduce((s, c) => s + c.x, 0) / connectedNeighbors.length;
      const avgY = connectedNeighbors.reduce((s, c) => s + c.y, 0) / connectedNeighbors.length;
      return {
        ...n,
        x: avgX + (connectedNeighbors[0].width + padding),
        y: avgY,
        isNew: true,
      };
    }

    // Default placement if no neighbors
    return {
      ...n,
      x: n.x ?? 40,
      y: n.y ?? 40,
      isNew: true,
    };
  });

  // Relaxation loop: Spring forces with anchor stabilization
  for (let it = 0; it < iterations; it++) {
    // Check overlaps pairwise
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i];
        const n2 = nodes[j];

        // Skip parent-child containment overlaps
        if (n1.parent === n2.id || n2.parent === n1.id) continue;
        if (n1.parent && n2.parent && n1.parent !== n2.parent) continue;

        const minDistanceX = (n1.width + n2.width) / 2 + padding;
        const minDistanceY = (n1.height + n2.height) / 2 + padding;

        const c1x = n1.x + n1.width / 2;
        const c1y = n1.y + n1.height / 2;
        const c2x = n2.x + n2.width / 2;
        const c2y = n2.y + n2.height / 2;

        const dx = c2x - c1x;
        const dy = c2y - c1y;

        const overlapX = minDistanceX - Math.abs(dx);
        const overlapY = minDistanceY - Math.abs(dy);

        if (overlapX > 0 && overlapY > 0) {
          // Push apart along axis of least resistance
          if (overlapX < overlapY) {
            const push = (overlapX / 2) * (dx >= 0 ? 1 : -1);
            if (n1.isNew && !n2.isNew) {
              n1.x -= overlapX * (dx >= 0 ? 1 : -1);
            } else if (!n1.isNew && n2.isNew) {
              n2.x += overlapX * (dx >= 0 ? 1 : -1);
            } else {
              n1.x -= push;
              n2.x += push;
            }
          } else {
            const push = (overlapY / 2) * (dy >= 0 ? 1 : -1);
            if (n1.isNew && !n2.isNew) {
              n1.y -= overlapY * (dy >= 0 ? 1 : -1);
            } else if (!n1.isNew && n2.isNew) {
              n2.y += overlapY * (dy >= 0 ? 1 : -1);
            } else {
              n1.y -= push;
              n2.y += push;
            }
          }
        }
      }
    }
  }

  return nodes.map((n) => ({
    ...n,
    x: Math.round(n.x),
    y: Math.round(n.y),
  }));
}

/**
 * Shifts surrounding nodes when a container expands, pushing right-quadrant and bottom-quadrant
 * nodes without perturbing stationary peers in other quadrants.
 */
export function expandContainerQuadrant(
  nodes: NodePosition[],
  expansion: ContainerExpansion,
  margin = 16,
): NodePosition[] {
  const deltaW = Math.max(0, expansion.newWidth - expansion.oldWidth);
  const deltaH = Math.max(0, expansion.newHeight - expansion.oldHeight);

  if (deltaW === 0 && deltaH === 0) return nodes;

  const rightThreshold = expansion.x + expansion.oldWidth - margin;
  const bottomThreshold = expansion.y + expansion.oldHeight - margin;

  return nodes.map((node) => {
    // Skip the expanding container itself and its children
    if (node.id === expansion.id || node.parent === expansion.id) {
      return node;
    }

    let nextX = node.x;
    let nextY = node.y;

    // Shift nodes to the right of expanding container
    if (node.x >= rightThreshold && node.y + node.height > expansion.y && node.y < expansion.y + expansion.oldHeight) {
      nextX += deltaW;
    }

    // Shift nodes below the expanding container
    if (node.y >= bottomThreshold && node.x + node.width > expansion.x && node.x < expansion.x + expansion.oldWidth) {
      nextY += deltaH;
    }

    // Shift diagonally situated nodes (below and right)
    if (node.x >= rightThreshold && node.y >= bottomThreshold) {
      nextX += deltaW;
      nextY += deltaH;
    }

    return {
      ...node,
      x: nextX,
      y: nextY,
    };
  });
}

/**
 * Calculates vector displacement deltas between source and target positions
 * for animating smooth transitions in AntV X6.
 */
export function calculateLayoutDeltas(
  sourceNodes: { id: string; x: number; y: number }[],
  targetNodes: { id: string; x: number; y: number }[],
): LayoutDelta[] {
  const sourceMap = new Map<string, { x: number; y: number }>();
  for (const s of sourceNodes) {
    sourceMap.set(s.id, { x: s.x, y: s.y });
  }

  const deltas: LayoutDelta[] = [];
  for (const t of targetNodes) {
    const s = sourceMap.get(t.id) ?? { x: t.x, y: t.y };
    deltas.push({
      id: t.id,
      dx: t.x - s.x,
      dy: t.y - s.y,
      sourceX: s.x,
      sourceY: s.y,
      targetX: t.x,
      targetY: t.y,
    });
  }

  return deltas;
}
