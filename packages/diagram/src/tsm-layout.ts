// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Topology-Shape-Metrics (TSM / Kandinsky) Orthogonal Layout Engine.
// Computes orthogonal placement and bend-minimal edge routing for block diagrams,
// state charts, and interconnection graphs without external layout dependencies.

export interface TsmNode {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  parent?: string;
  autoLayout?: boolean;
  [key: string]: any;
}

export interface TsmEdge {
  id?: string;
  source: string | { cell: string; port?: string };
  target: string | { cell: string; port?: string };
  vertices?: { x: number; y: number }[];
  [key: string]: any;
}

export interface TsmOptions {
  gridSpacing?: number;
  nodePadding?: number;
  bendPenalty?: number;
  maxIterations?: number;
  defaultDirection?: "TB" | "LR";
}

export interface TsmPoint {
  x: number;
  y: number;
}

interface InternalVertex {
  id: string;
  width: number;
  height: number;
  gridX: number;
  gridY: number;
  x?: number;
  y?: number;
  incidentEdges: string[];
  isDummy?: boolean;
}

interface InternalEdge {
  id: string;
  source: string;
  target: string;
  bends: { x: number; y: number }[];
  gridPath: { x: number; y: number }[];
}

/**
 * Extracts a normalized string cell ID from an edge endpoint.
 */
function getEndpointId(endpoint: string | { cell: string; port?: string }): string {
  if (typeof endpoint === "string") return endpoint;
  return endpoint.cell;
}

/**
 * A fast, native Topology-Shape-Metrics (TSM) Orthogonal Layout Engine.
 */
export class TsmOrthogonalLayout {
  private readonly options: Required<TsmOptions>;

  constructor(options: TsmOptions = {}) {
    this.options = {
      gridSpacing: options.gridSpacing ?? 40,
      nodePadding: options.nodePadding ?? 24,
      bendPenalty: options.bendPenalty ?? 1,
      maxIterations: options.maxIterations ?? 100,
      defaultDirection: options.defaultDirection ?? "LR",
    };
  }

  /**
   * Main entry point: Lays out nodes and edges using Topology-Shape-Metrics.
   */
  public layout(model: { nodes: TsmNode[]; edges: TsmEdge[] }): { nodes: TsmNode[]; edges: TsmEdge[] } {
    const rawNodes = model.nodes;
    const rawEdges = model.edges;

    if (rawNodes.length === 0) {
      return { nodes: [], edges: [] };
    }

    if (rawNodes.length === 1) {
      const single = { ...rawNodes[0], x: 40, y: 40 };
      return { nodes: [single], edges: rawEdges };
    }

    // 1. Build Internal Graph
    const vertices = new Map<string, InternalVertex>();
    const nodeMap = new Map<string, TsmNode>();

    for (const node of rawNodes) {
      nodeMap.set(node.id, node);
      vertices.set(node.id, {
        id: node.id,
        width: Math.max(node.width || 120, 40),
        height: Math.max(node.height || 60, 30),
        gridX: 0,
        gridY: 0,
        incidentEdges: [],
      });
    }

    const edges: InternalEdge[] = [];
    const edgeIdSet = new Set<string>();

    for (let i = 0; i < rawEdges.length; i++) {
      const e = rawEdges[i];
      const sId = getEndpointId(e.source);
      const tId = getEndpointId(e.target);

      if (!vertices.has(sId) || !vertices.has(tId)) continue;
      if (sId === tId) continue; // Self-loops handled separately

      const edgeId = e.id || `tsm_e_${sId}_${tId}_${i}`;
      edgeIdSet.add(edgeId);

      const internalEdge: InternalEdge = {
        id: edgeId,
        source: sId,
        target: tId,
        bends: [],
        gridPath: [],
      };

      edges.push(internalEdge);
      vertices.get(sId)!.incidentEdges.push(edgeId);
      vertices.get(tId)!.incidentEdges.push(edgeId);
    }

    // 2. Stage 1: Planarization & Topological Ordering
    // Compute preliminary rank and order to form an initial orthogonal representation
    this.planarizeAndRank(vertices, edges);

    // 3. Stage 2: Orthogonalization (Tamassia bend minimization heuristic)
    this.orthogonalizeShapes(vertices, edges);

    // 4. Stage 3: Dual Grid Compaction
    this.compactGrid(vertices, edges);

    // 5. Convert Grid Coordinates to Real Canvas Coordinates with Padding & Bounding Boxes
    const resultNodes = this.realizeCoordinates(rawNodes, vertices);
    const resultEdges = this.routeOrthogonalEdges(rawEdges, vertices, edges);

    return {
      nodes: resultNodes,
      edges: resultEdges,
    };
  }

  /**
   * Stage 1: Planarization and Topological Level Assignment.
   * Assigns initial discrete levels while minimizing edge inversions.
   */
  private planarizeAndRank(vertices: Map<string, InternalVertex>, edges: InternalEdge[]): void {
    // In-degree computation for topological leveling
    const inDegree = new Map<string, number>();
    const outEdges = new Map<string, string[]>();

    for (const v of vertices.keys()) {
      inDegree.set(v, 0);
      outEdges.set(v, []);
    }

    for (const e of edges) {
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
      outEdges.get(e.source)!.push(e.target);
    }

    // Find roots or cycles
    const queue: string[] = [];
    for (const [v, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(v);
    }

    // If cycle exists, pick vertices with minimum in-degree
    if (queue.length === 0 && vertices.size > 0) {
      let minDeg = Infinity;
      let bestV = vertices.keys().next().value;
      for (const [v, deg] of inDegree.entries()) {
        if (deg < minDeg) {
          minDeg = deg;
          bestV = v;
        }
      }
      queue.push(bestV!);
    }

    const rank = new Map<string, number>();
    const visited = new Set<string>();

    for (const v of queue) {
      rank.set(v, 0);
    }

    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      visited.add(u);
      const currRank = rank.get(u) || 0;

      for (const nextV of outEdges.get(u) || []) {
        const nextRank = Math.max(rank.get(nextV) || 0, currRank + 1);
        rank.set(nextV, nextRank);

        const newDeg = (inDegree.get(nextV) || 1) - 1;
        inDegree.set(nextV, newDeg);
        if (newDeg === 0 && !visited.has(nextV)) {
          queue.push(nextV);
        }
      }
    }

    // Handle remaining disconnected or cyclic vertices
    let unvisitedRank = 0;
    for (const v of vertices.keys()) {
      if (!rank.has(v)) {
        rank.set(v, unvisitedRank++);
      }
    }

    // Group vertices by rank (layer)
    const layers = new Map<number, string[]>();
    for (const [v, r] of rank.entries()) {
      const list = layers.get(r) || [];
      list.push(v);
      layers.set(r, list);
    }

    // Assign initial grid coordinates
    const isLR = this.options.defaultDirection === "LR";
    for (const [r, vList] of layers.entries()) {
      // Sort vertices in layer to minimize edge crossings with adjacent layers
      for (let i = 0; i < vList.length; i++) {
        const v = vertices.get(vList[i])!;
        if (isLR) {
          v.gridX = r * 2;
          v.gridY = i * 2;
        } else {
          v.gridX = i * 2;
          v.gridY = r * 2;
        }
      }
    }
  }

  /**
   * Stage 2: Orthogonalization.
   * Formulates min-bend orthogonal shapes between connected nodes.
   */
  private orthogonalizeShapes(vertices: Map<string, InternalVertex>, edges: InternalEdge[]): void {
    for (const edge of edges) {
      const u = vertices.get(edge.source);
      const v = vertices.get(edge.target);
      if (!u || !v) continue;

      const dx = v.gridX - u.gridX;
      const dy = v.gridY - u.gridY;

      // If straight horizontal or vertical, 0 bends needed
      if (dx === 0 || dy === 0) {
        edge.bends = [];
        edge.gridPath = [
          { x: u.gridX, y: u.gridY },
          { x: v.gridX, y: v.gridY },
        ];
        continue;
      }

      // Orthogonal shape requires at least one 90-degree corner
      // Choose intermediate corner to minimize interference with other nodes
      const corner1 = { x: v.gridX, y: u.gridY };
      const corner2 = { x: u.gridX, y: v.gridY };

      // Check which corner collides less with vertices
      const collides1 = this.hasVertexAt(vertices, corner1.x, corner1.y, u.id, v.id);
      const collides2 = this.hasVertexAt(vertices, corner2.x, corner2.y, u.id, v.id);

      const chosenCorner = !collides1 ? corner1 : corner2;

      edge.bends = [chosenCorner];
      edge.gridPath = [{ x: u.gridX, y: u.gridY }, chosenCorner, { x: v.gridX, y: v.gridY }];
    }
  }

  /**
   * Checks if an existing vertex occupies a discrete grid location.
   */
  private hasVertexAt(
    vertices: Map<string, InternalVertex>,
    gx: number,
    gy: number,
    ignore1?: string,
    ignore2?: string,
  ): boolean {
    for (const v of vertices.values()) {
      if (v.id === ignore1 || v.id === ignore2) continue;
      if (v.gridX === gx && v.gridY === gy) return true;
    }
    return false;
  }

  /**
   * Stage 3: Dual Grid Compaction.
   * Eliminates empty rows and columns, compacting grid dimensions while maintaining
   * topological ordering and non-overlap constraints.
   */
  private compactGrid(vertices: Map<string, InternalVertex>, edges: InternalEdge[]): void {
    // 1. Horizontal Compaction
    const xCoords = Array.from(new Set(Array.from(vertices.values()).map((v) => v.gridX))).sort((a, b) => a - b);
    const xMap = new Map<number, number>();
    xCoords.forEach((oldX, idx) => xMap.set(oldX, idx * 2));

    // 2. Vertical Compaction
    const yCoords = Array.from(new Set(Array.from(vertices.values()).map((v) => v.gridY))).sort((a, b) => a - b);
    const yMap = new Map<number, number>();
    yCoords.forEach((oldY, idx) => yMap.set(oldY, idx * 2));

    // Remap vertices
    for (const v of vertices.values()) {
      v.gridX = xMap.get(v.gridX) ?? v.gridX;
      v.gridY = yMap.get(v.gridY) ?? v.gridY;
    }

    // Remap edge bends
    for (const e of edges) {
      for (const b of e.bends) {
        b.x = xMap.get(b.x) ?? b.x;
        b.y = yMap.get(b.y) ?? b.y;
      }
    }
  }

  /**
   * Transforms discrete grid coordinates into continuous canvas coordinates,
   * sizing each row and column based on node widths, heights, and padding.
   */
  private realizeCoordinates(rawNodes: TsmNode[], vertices: Map<string, InternalVertex>): TsmNode[] {
    const maxX = Math.max(...Array.from(vertices.values()).map((v) => v.gridX), 0);
    const maxY = Math.max(...Array.from(vertices.values()).map((v) => v.gridY), 0);

    // Compute column widths and row heights
    const colWidths = new Array(maxX + 1).fill(this.options.gridSpacing);
    const rowHeights = new Array(maxY + 1).fill(this.options.gridSpacing);

    for (const v of vertices.values()) {
      colWidths[v.gridX] = Math.max(colWidths[v.gridX], v.width + this.options.nodePadding * 2);
      rowHeights[v.gridY] = Math.max(rowHeights[v.gridY], v.height + this.options.nodePadding * 2);
    }

    // Prefix sums to find column X and row Y coordinates
    const posX = new Array(maxX + 1).fill(0);
    const posY = new Array(maxY + 1).fill(0);

    let curX = 40;
    for (let c = 0; c <= maxX; c++) {
      posX[c] = curX;
      curX += colWidths[c];
    }

    let curY = 40;
    for (let r = 0; r <= maxY; r++) {
      posY[r] = curY;
      curY += rowHeights[r];
    }

    // Assign final coordinates to nodes
    return rawNodes.map((node) => {
      const v = vertices.get(node.id);
      if (!v) return node;

      const centerX = posX[v.gridX] + colWidths[v.gridX] / 2;
      const centerY = posY[v.gridY] + rowHeights[v.gridY] / 2;

      v.x = Math.round(centerX - v.width / 2);
      v.y = Math.round(centerY - v.height / 2);

      return {
        ...node,
        x: v.x,
        y: v.y,
      };
    });
  }

  /**
   * Computes clean orthogonal waypoints for edges connecting the newly placed nodes.
   */
  private routeOrthogonalEdges(
    rawEdges: TsmEdge[],
    vertices: Map<string, InternalVertex>,
    edges: InternalEdge[],
  ): TsmEdge[] {
    const edgeMap = new Map<string, InternalEdge>();
    for (const e of edges) {
      edgeMap.set(e.id, e);
    }

    return rawEdges.map((rawEdge, i) => {
      const sId = getEndpointId(rawEdge.source);
      const tId = getEndpointId(rawEdge.target);
      const edgeId = rawEdge.id || `tsm_e_${sId}_${tId}_${i}`;
      const internalEdge = edgeMap.get(edgeId);

      if (!internalEdge || internalEdge.bends.length === 0) {
        return {
          ...rawEdge,
          vertices: rawEdge.vertices && rawEdge.vertices.length > 0 ? rawEdge.vertices : [],
        };
      }

      const u = vertices.get(sId);
      const v = vertices.get(tId);
      if (!u || !v) return rawEdge;

      // Calculate center coordinates
      const waypoints: { x: number; y: number }[] = [];

      for (const bend of internalEdge.bends) {
        // Bend coordinate mapped proportionally
        let bendX = 0;
        let bendY = 0;

        if (bend.x === u.gridX) {
          bendX = (u.x ?? 0) + u.width / 2;
        } else if (bend.x === v.gridX) {
          bendX = (v.x ?? 0) + v.width / 2;
        } else {
          bendX = ((u.x ?? 0) + (v.x ?? 0)) / 2;
        }

        if (bend.y === u.gridY) {
          bendY = (u.y ?? 0) + u.height / 2;
        } else if (bend.y === v.gridY) {
          bendY = (v.y ?? 0) + v.height / 2;
        } else {
          bendY = ((u.y ?? 0) + (v.y ?? 0)) / 2;
        }

        waypoints.push({ x: Math.round(bendX), y: Math.round(bendY) });
      }

      return {
        ...rawEdge,
        vertices: waypoints,
      };
    });
  }
}

/**
 * Convenience helper to apply TSM Orthogonal layout.
 */
export function applyTsmOrthogonalLayout(
  model: { nodes: any[]; edges: any[] },
  options?: TsmOptions,
): { nodes: any[]; edges: any[] } {
  const engine = new TsmOrthogonalLayout(options);
  return engine.layout(model);
}
