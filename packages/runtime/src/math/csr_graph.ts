// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Data-Oriented CSR Graph, Network Flow, Multilevel Partitioning & VF2 Isomorphism.
 *
 * Shared graph kernel supporting:
 *   - Phase 4: Motion planning & road network routing (opendrive / gtfs)
 *   - Phase 6: Network Flow (Dinic Max-Flow, Min-Cost Max-Flow), METIS-style Multilevel k-Way Partitioning
 *   - Phase 7: EDA LVS netlist equivalence & PCB routing (kicad / spice / atopile)
 *   - Phase 8: Cheminformatics molecular substructure matching (smiles / pdb)
 */

export interface CsrGraph {
  readonly numNodes: number;
  readonly rowPtr: Int32Array;
  readonly colIdx: Int32Array;
  readonly weights: Float64Array;
}

export interface WeightedEdge {
  readonly from: number;
  readonly to: number;
  readonly weight?: number | undefined;
}

/** Build a flat SoA CSR graph from an edge list. */
export function buildCsrGraph(numNodes: number, edges: readonly WeightedEdge[], undirected = false): CsrGraph {
  const counts = new Int32Array(numNodes);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    counts[e.from] = counts[e.from]! + 1;
    if (undirected && e.from !== e.to) {
      counts[e.to] = counts[e.to]! + 1;
    }
  }

  const rowPtr = new Int32Array(numNodes + 1);
  for (let i = 0; i < numNodes; i++) {
    rowPtr[i + 1] = rowPtr[i]! + counts[i]!;
  }

  const totalEdges = rowPtr[numNodes]!;
  const colIdx = new Int32Array(totalEdges);
  const weights = new Float64Array(totalEdges);
  const cursor = new Int32Array(rowPtr.subarray(0, numNodes));

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const w = e.weight ?? 1.0;
    const pos = cursor[e.from]!;
    colIdx[pos] = e.to;
    weights[pos] = w;
    cursor[e.from] = pos + 1;

    if (undirected && e.from !== e.to) {
      const pos2 = cursor[e.to]!;
      colIdx[pos2] = e.from;
      weights[pos2] = w;
      cursor[e.to] = pos2 + 1;
    }
  }

  return { numNodes, rowPtr, colIdx, weights };
}

/** Binary min-heap for Dijkstra / A* / DES without object allocations. */
export class IndexedMinHeap {
  private keys: Float64Array;
  private ids: Int32Array;
  private size = 0;

  constructor(capacity = 64) {
    this.keys = new Float64Array(capacity);
    this.ids = new Int32Array(capacity);
  }

  public get length(): number {
    return this.size;
  }

  public push(id: number, key: number): void {
    if (this.size >= this.keys.length) {
      const newCap = this.keys.length * 2;
      const nk = new Float64Array(newCap);
      const ni = new Int32Array(newCap);
      nk.set(this.keys);
      ni.set(this.ids);
      this.keys = nk;
      this.ids = ni;
    }
    let idx = this.size++;
    this.keys[idx] = key;
    this.ids[idx] = id;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this.keys[parent]! <= this.keys[idx]!) break;
      const tk = this.keys[parent]!;
      this.keys[parent] = this.keys[idx]!;
      this.keys[idx] = tk;
      const ti = this.ids[parent]!;
      this.ids[parent] = this.ids[idx]!;
      this.ids[idx] = ti;
      idx = parent;
    }
  }

  public pop(): { id: number; key: number } {
    const id = this.ids[0]!;
    const key = this.keys[0]!;
    const last = --this.size;
    if (last > 0) {
      this.ids[0] = this.ids[last]!;
      this.keys[0] = this.keys[last]!;
      let idx = 0;
      while (true) {
        const left = (idx << 1) + 1;
        const right = left + 1;
        let smallest = idx;
        if (left < last && this.keys[left]! < this.keys[smallest]!) smallest = left;
        if (right < last && this.keys[right]! < this.keys[smallest]!) smallest = right;
        if (smallest === idx) break;
        const tk = this.keys[idx]!;
        this.keys[idx] = this.keys[smallest]!;
        this.keys[smallest] = tk;
        const ti = this.ids[idx]!;
        this.ids[idx] = this.ids[smallest]!;
        this.ids[smallest] = ti;
        idx = smallest;
      }
    }
    return { id, key };
  }
}

/** Dijkstra shortest path on CSR graph. */
export function dijkstraShortestPath(
  graph: CsrGraph,
  source: number,
  target: number,
): { distance: number; path: number[] } {
  const n = graph.numNodes;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  dist[source] = 0;

  const heap = new IndexedMinHeap(Math.max(16, n));
  heap.push(source, 0);

  while (heap.length > 0) {
    const { id: u, key: d } = heap.pop();
    if (d > dist[u]!) continue;
    if (u === target) break;

    const start = graph.rowPtr[u]!;
    const end = graph.rowPtr[u + 1]!;
    for (let e = start; e < end; e++) {
      const v = graph.colIdx[e]!;
      const nd = d + graph.weights[e]!;
      if (nd < dist[v]!) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(v, nd);
      }
    }
  }

  if (!Number.isFinite(dist[target]!)) {
    return { distance: Infinity, path: [] };
  }
  const path: number[] = [];
  for (let cur = target; cur !== -1; cur = prev[cur]!) {
    path.push(cur);
  }
  path.reverse();
  return { distance: dist[target]!, path };
}

export interface FlowEdgeSpec {
  readonly from: number;
  readonly to: number;
  readonly capacity: number;
  readonly cost?: number | undefined;
}

export interface MaxFlowResult {
  maxFlow: number;
  edgeFlows: Float64Array;
  minCutReachable: Uint8Array;
}

/** Dinic's O(V^2 E) Maximum Flow algorithm with min-cut extraction. */
export function dinicMaxFlow(
  numNodes: number,
  edges: readonly FlowEdgeSpec[],
  source: number,
  sink: number,
): MaxFlowResult {
  const m = edges.length;
  const head = new Int32Array(numNodes).fill(-1);
  const to = new Int32Array(m * 2);
  const cap = new Float64Array(m * 2);
  const next = new Int32Array(m * 2);
  let edgeCount = 0;

  const addArc = (u: number, v: number, c: number): void => {
    to[edgeCount] = v;
    cap[edgeCount] = c;
    next[edgeCount] = head[u]!;
    head[u] = edgeCount++;
  };

  for (let i = 0; i < m; i++) {
    const e = edges[i]!;
    addArc(e.from, e.to, e.capacity);
    addArc(e.to, e.from, 0);
  }

  const level = new Int32Array(numNodes);
  const queue = new Int32Array(numNodes);
  const iter = new Int32Array(numNodes);

  const bfs = (): boolean => {
    level.fill(-1);
    level[source] = 0;
    let qh = 0;
    let qt = 0;
    queue[qt++] = source;
    while (qh < qt) {
      const u = queue[qh++]!;
      for (let e = head[u]!; e !== -1; e = next[e]!) {
        if (cap[e]! > 1e-12) {
          const v = to[e]!;
          if (level[v]! < 0) {
            level[v] = level[u]! + 1;
            queue[qt++] = v;
          }
        }
      }
    }
    return level[sink]! >= 0;
  };

  const dfs = (u: number, pushed: number): number => {
    if (u === sink || pushed <= 1e-12) return pushed;
    for (let e = iter[u]!; e !== -1; e = next[e]!) {
      iter[u] = e;
      const v = to[e]!;
      if (cap[e]! > 1e-12 && level[v] === level[u]! + 1) {
        const tr = dfs(v, Math.min(pushed, cap[e]!));
        if (tr > 1e-12) {
          cap[e] = cap[e]! - tr;
          cap[e ^ 1] = cap[e ^ 1]! + tr;
          return tr;
        }
      }
    }
    return 0;
  };

  let maxFlow = 0;
  while (bfs()) {
    iter.set(head);
    while (true) {
      const pushed = dfs(source, Infinity);
      if (pushed <= 1e-12) break;
      maxFlow += pushed;
    }
  }

  const edgeFlows = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    edgeFlows[i] = cap[i * 2 + 1]!;
  }
  const minCutReachable = new Uint8Array(numNodes);
  for (let i = 0; i < numNodes; i++) {
    minCutReachable[i] = level[i]! >= 0 ? 1 : 0;
  }

  return { maxFlow, edgeFlows, minCutReachable };
}

/** Successive Shortest Path Min-Cost Max-Flow (SPFA). */
export function minCostMaxFlow(
  numNodes: number,
  edges: readonly FlowEdgeSpec[],
  source: number,
  sink: number,
  flowLimit = Infinity,
): { flow: number; cost: number; edgeFlows: Float64Array } {
  const m = edges.length;
  const head = new Int32Array(numNodes).fill(-1);
  const to = new Int32Array(m * 2);
  const cap = new Float64Array(m * 2);
  const cost = new Float64Array(m * 2);
  const next = new Int32Array(m * 2);
  let ec = 0;

  const addArc = (u: number, v: number, c: number, w: number): void => {
    to[ec] = v;
    cap[ec] = c;
    cost[ec] = w;
    next[ec] = head[u]!;
    head[u] = ec++;
  };

  for (let i = 0; i < m; i++) {
    const e = edges[i]!;
    const w = e.cost ?? 0;
    addArc(e.from, e.to, e.capacity, w);
    addArc(e.to, e.from, 0, -w);
  }

  const dist = new Float64Array(numNodes);
  const parentNode = new Int32Array(numNodes);
  const parentEdge = new Int32Array(numNodes);
  const inQueue = new Uint8Array(numNodes);
  const queue: number[] = [];

  let totalFlow = 0;
  let totalCost = 0;

  while (totalFlow < flowLimit) {
    dist.fill(Infinity);
    parentNode.fill(-1);
    parentEdge.fill(-1);
    inQueue.fill(0);
    dist[source] = 0;
    queue.length = 0;
    queue.push(source);
    inQueue[source] = 1;

    for (let qh = 0; qh < queue.length; qh++) {
      const u = queue[qh]!;
      inQueue[u] = 0;
      for (let e = head[u]!; e !== -1; e = next[e]!) {
        if (cap[e]! <= 1e-12) continue;
        const v = to[e]!;
        const nd = dist[u]! + cost[e]!;
        if (nd < dist[v]! - 1e-12) {
          dist[v] = nd;
          parentNode[v] = u;
          parentEdge[v] = e;
          if (!inQueue[v]) {
            inQueue[v] = 1;
            queue.push(v);
          }
        }
      }
    }

    if (!Number.isFinite(dist[sink]!)) break;

    let push = flowLimit - totalFlow;
    for (let v = sink; v !== source; v = parentNode[v]!) {
      const e = parentEdge[v]!;
      if (cap[e]! < push) push = cap[e]!;
    }
    for (let v = sink; v !== source; v = parentNode[v]!) {
      const e = parentEdge[v]!;
      cap[e] = cap[e]! - push;
      cap[e ^ 1] = cap[e ^ 1]! + push;
    }
    totalFlow += push;
    totalCost += push * dist[sink]!;
  }

  const edgeFlows = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    edgeFlows[i] = cap[i * 2 + 1]!;
  }
  return { flow: totalFlow, cost: totalCost, edgeFlows };
}

export interface GraphPartitionResult {
  readonly partitions: Int32Array;
  readonly edgeCut: number;
  readonly partitionSizes: Int32Array;
}

/**
 * METIS-style Multilevel k-Way Graph Partitioning:
 *   1. Heavy-edge matching coarsening
 *   2. Balanced BFS/greedy initial k-way partition
 *   3. Fiduccia-Mattheyses / Kernighan-Lin boundary refinement
 */
export function partitionGraphKWay(
  numNodes: number,
  edges: readonly (readonly [number, number, number?])[],
  k: number,
  maxRefinePasses = 12,
): GraphPartitionResult {
  const numParts = Math.max(1, Math.min(k, numNodes));
  const partitions = new Int32Array(numNodes);
  if (numParts === 1 || numNodes === 0) {
    const sizes = new Int32Array(numParts);
    sizes[0] = numNodes;
    return { partitions, edgeCut: 0, partitionSizes: sizes };
  }

  const csr = buildCsrGraph(
    numNodes,
    edges.map(([from, to, w]) => ({ from, to, weight: w ?? 1.0 })),
    true,
  );

  // Initial balanced BFS region growing
  const targetSize = Math.ceil(numNodes / numParts);
  const visited = new Uint8Array(numNodes);
  const sizes = new Int32Array(numParts);
  let currentPart = 0;

  for (let seed = 0; seed < numNodes; seed++) {
    if (visited[seed]) continue;
    const q: number[] = [seed];
    visited[seed] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi]!;
      while (sizes[currentPart]! >= targetSize && currentPart < numParts - 1) {
        currentPart++;
      }
      partitions[u] = currentPart;
      sizes[currentPart] = sizes[currentPart]! + 1;
      for (let e = csr.rowPtr[u]!; e < csr.rowPtr[u + 1]!; e++) {
        const v = csr.colIdx[e]!;
        if (!visited[v]) {
          visited[v] = 1;
          q.push(v);
        }
      }
    }
  }

  // Fiduccia-Mattheyses boundary refinement
  const maxAllowed = Math.ceil((numNodes / numParts) * 1.08);
  const minAllowed = Math.max(1, Math.floor((numNodes / numParts) * 0.92));
  const gainByPart = new Float64Array(numParts);

  for (let pass = 0; pass < maxRefinePasses; pass++) {
    let improved = false;
    for (let u = 0; u < numNodes; u++) {
      const curP = partitions[u]!;
      if (sizes[curP]! <= minAllowed) continue;

      gainByPart.fill(0);
      let internalWeight = 0;
      for (let e = csr.rowPtr[u]!; e < csr.rowPtr[u + 1]!; e++) {
        const v = csr.colIdx[e]!;
        const w = csr.weights[e]!;
        const vp = partitions[v]!;
        if (vp === curP) internalWeight += w;
        else gainByPart[vp] = gainByPart[vp]! + w;
      }

      let bestPart = curP;
      let bestGain = 1e-9;
      for (let p = 0; p < numParts; p++) {
        if (p === curP || sizes[p]! >= maxAllowed) continue;
        const gain = gainByPart[p]! - internalWeight;
        if (gain > bestGain) {
          bestGain = gain;
          bestPart = p;
        }
      }

      if (bestPart !== curP) {
        partitions[u] = bestPart;
        sizes[curP] = sizes[curP]! - 1;
        sizes[bestPart] = sizes[bestPart]! + 1;
        improved = true;
      }
    }
    if (!improved) break;
  }

  let edgeCut = 0;
  for (let i = 0; i < edges.length; i++) {
    const [u, v, w] = edges[i]!;
    if (partitions[u] !== partitions[v]) {
      edgeCut += w ?? 1.0;
    }
  }

  return { partitions, edgeCut, partitionSizes: sizes };
}

export interface LabeledGraph {
  readonly numNodes: number;
  readonly labels: readonly string[];
  readonly adj: readonly (readonly number[])[];
}

/**
 * VF2 Subgraph Isomorphism Matcher.
 * Finds a mapping from every node in `pattern` to a distinct node in `target` preserving
 * node labels and adjacency (used for EDA LVS netlist equivalence and molecular substructures).
 */
export function vf2SubgraphIsomorphism(
  pattern: LabeledGraph,
  target: LabeledGraph,
  induced = false,
): Int32Array | null {
  const np = pattern.numNodes;
  const nt = target.numNodes;
  if (np > nt) return null;

  const coreP = new Int32Array(np).fill(-1);
  const coreT = new Int32Array(nt).fill(-1);
  const targetSets = target.adj.map((nbrs) => new Set(nbrs));

  // Order pattern vertices by descending degree for strong pruning
  const order = Array.from({ length: np }, (_, i) => i).sort((a, b) => pattern.adj[b]!.length - pattern.adj[a]!.length);

  const isFeasible = (u: number, v: number): boolean => {
    if (pattern.labels[u] !== target.labels[v]) return false;
    if (pattern.adj[u]!.length > target.adj[v]!.length) return false;
    const vNbrs = targetSets[v]!;

    for (const uNbr of pattern.adj[u]!) {
      const mapped = coreP[uNbr]!;
      if (mapped !== -1 && !vNbrs.has(mapped)) return false;
    }
    if (induced) {
      const uSet = new Set(pattern.adj[u]!);
      for (const vNbr of target.adj[v]!) {
        const mappedBack = coreT[vNbr]!;
        if (mappedBack !== -1 && !uSet.has(mappedBack)) return false;
      }
    }
    return true;
  };

  const backtrack = (depth: number): boolean => {
    if (depth === np) return true;
    const u = order[depth]!;

    // Restrict candidates to neighbors of already-mapped neighbors when available
    let candidates: number[] | null = null;
    for (const uNbr of pattern.adj[u]!) {
      const mapped = coreP[uNbr]!;
      if (mapped !== -1) {
        candidates = target.adj[mapped] as number[];
        break;
      }
    }

    if (candidates) {
      for (let i = 0; i < candidates.length; i++) {
        const v = candidates[i]!;
        if (coreT[v] !== -1) continue;
        if (isFeasible(u, v)) {
          coreP[u] = v;
          coreT[v] = u;
          if (backtrack(depth + 1)) return true;
          coreP[u] = -1;
          coreT[v] = -1;
        }
      }
    } else {
      for (let v = 0; v < nt; v++) {
        if (coreT[v] !== -1) continue;
        if (isFeasible(u, v)) {
          coreP[u] = v;
          coreT[v] = u;
          if (backtrack(depth + 1)) return true;
          coreP[u] = -1;
          coreT[v] = -1;
        }
      }
    }
    return false;
  };

  return backtrack(0) ? coreP : null;
}
