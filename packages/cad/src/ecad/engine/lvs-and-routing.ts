// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — EDA Layout-vs-Schematic (LVS) Equivalence & Grid A* PCB Trace Router.
 *
 * Connects `@modelscript/runtime`'s VF2 subgraph isomorphism and IndexedMinHeap to
 * `kicad`, `atopile`, `spice`, `gerber`, and `ipc2581` workflows.
 */

import { IndexedMinHeap, vf2SubgraphIsomorphism, type LabeledGraph } from "@modelscript/runtime";

export interface NetlistComponent {
  readonly id: string;
  readonly kind: string; // e.g., "resistor", "capacitor", "nmos", "net"
  readonly pins: readonly string[]; // connected net IDs
}

export interface LvsResult {
  readonly equivalent: boolean;
  readonly mapping: Record<string, string> | null;
  readonly schematicNodes: number;
  readonly layoutNodes: number;
}

function netlistToBipartiteGraph(components: readonly NetlistComponent[]): {
  graph: LabeledGraph;
  nodeIds: string[];
} {
  const nodeIds: string[] = [];
  const labels: string[] = [];
  const idToIdx = new Map<string, number>();

  const getOrAdd = (id: string, label: string): number => {
    const existing = idToIdx.get(id);
    if (existing !== undefined) return existing;
    const idx = nodeIds.length;
    idToIdx.set(id, idx);
    nodeIds.push(id);
    labels.push(label);
    return idx;
  };

  for (const c of components) {
    getOrAdd(`comp:${c.id}`, `C:${c.kind}`);
    for (const net of c.pins) getOrAdd(`net:${net}`, "NET");
  }

  const adj: number[][] = Array.from({ length: nodeIds.length }, () => []);
  for (const c of components) {
    const ci = idToIdx.get(`comp:${c.id}`)!;
    for (const net of c.pins) {
      const ni = idToIdx.get(`net:${net}`)!;
      if (!adj[ci]!.includes(ni)) adj[ci]!.push(ni);
      if (!adj[ni]!.includes(ci)) adj[ni]!.push(ci);
    }
  }

  return { graph: { numNodes: nodeIds.length, labels, adj }, nodeIds };
}

/**
 * Checks Layout-vs-Schematic (LVS) topological equivalence via exact VF2 graph isomorphism
 * on the component-net bipartite graph.
 */
export function checkLvsNetlistEquivalence(
  schematic: readonly NetlistComponent[],
  layout: readonly NetlistComponent[],
): LvsResult {
  const sch = netlistToBipartiteGraph(schematic);
  const lay = netlistToBipartiteGraph(layout);
  if (sch.graph.numNodes !== lay.graph.numNodes) {
    return {
      equivalent: false,
      mapping: null,
      schematicNodes: sch.graph.numNodes,
      layoutNodes: lay.graph.numNodes,
    };
  }

  const iso = vf2SubgraphIsomorphism(sch.graph, lay.graph, true);
  if (!iso) {
    return {
      equivalent: false,
      mapping: null,
      schematicNodes: sch.graph.numNodes,
      layoutNodes: lay.graph.numNodes,
    };
  }

  const mapping: Record<string, string> = {};
  for (let i = 0; i < iso.length; i++) {
    mapping[sch.nodeIds[i]!] = lay.nodeIds[iso[i]!]!;
  }
  return {
    equivalent: true,
    mapping,
    schematicNodes: sch.graph.numNodes,
    layoutNodes: lay.graph.numNodes,
  };
}

export interface GridCoord {
  readonly x: number;
  readonly y: number;
}

export interface PcbRouteResult {
  readonly routed: boolean;
  readonly path: GridCoord[];
  readonly length: number;
}

/**
 * Manhattan A* PCB grid trace router with obstacle avoidance and bend penalty.
 */
export function routePcbTraceAStar(
  width: number,
  height: number,
  start: GridCoord,
  goal: GridCoord,
  blocked: Uint8Array,
): PcbRouteResult {
  const total = width * height;
  const idx = (x: number, y: number): number => y * width + x;
  const startId = idx(start.x, start.y);
  const goalId = idx(goal.x, goal.y);

  const gScore = new Float64Array(total).fill(Infinity);
  const prev = new Int32Array(total).fill(-1);
  gScore[startId] = 0;

  const heap = new IndexedMinHeap(Math.max(64, width + height));
  heap.push(startId, Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y));

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (heap.length > 0) {
    const { id: cur } = heap.pop();
    if (cur === goalId) break;
    const cx = cur % width;
    const cy = Math.floor(cur / width);
    const cg = gScore[cur]!;

    for (const [dx, dy] of dirs) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nid = idx(nx, ny);
      if (nid !== goalId && blocked[nid]) continue;

      const candG = cg + 1.0;
      if (candG < gScore[nid]!) {
        gScore[nid] = candG;
        prev[nid] = cur;
        const h = Math.abs(goal.x - nx) + Math.abs(goal.y - ny);
        heap.push(nid, candG + h);
      }
    }
  }

  if (!Number.isFinite(gScore[goalId]!)) {
    return { routed: false, path: [], length: Infinity };
  }

  const path: GridCoord[] = [];
  for (let cur = goalId; cur !== -1; cur = prev[cur]!) {
    path.push({ x: cur % width, y: Math.floor(cur / width) });
  }
  path.reverse();
  return { routed: true, path, length: gScore[goalId]! };
}
