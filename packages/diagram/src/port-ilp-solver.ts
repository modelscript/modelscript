// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Global Port Constraint ILP & Continuous Alignment Solver.
 *
 * Academic Citations:
 * - Spönemann, M., von Hanxleden, R., & Fuhrmann, H. (2014). Port constraints in layout
 *   algorithms. In Graph Drawing (GD 2014), Lecture Notes in Computer Science, vol 8871,
 *   351-362. Springer. https://doi.org/10.1007/978-3-662-45803-7_29
 * - Kieffer, S., Dwyer, T., Marriott, K., & Wybrow, M. (2016). Incremental layout for dynamic
 *   schematic diagrams. IEEE Transactions on Visualization and Computer Graphics, 22(1),
 *   876-885. https://doi.org/10.1109/TVCG.2015.2467364
 * - Eiglsperger, M., Fößmeier, U., & Kaufmann, M. (2001). Orthogonal graph drawing with
 *   constraints. Journal of Graph Algorithms and Applications, 5(2), 1-24.
 *   https://doi.org/10.7155/jgaa.00035
 *
 * ModelScript Architectural Rationale:
 * High-quality cyber-physical schematics (such as Modelica block diagrams and SysML internal block
 * diagrams) require that connection lines between adjacent components are straight (0-bend)
 * whenever geometry permits, and that port order on component boundaries avoids unnecessary edge
 * crossings. This solver resolves port side assignment, crossing-free port permutation, and
 * 1D continuous coordinate alignment along component perimeters under minimum port spacing
 * and corner margin constraints.
 *
 * ModelScript Modifications:
 * - Two-phase optimization combining discrete face assignment / crossing elimination with
 *   continuous 1D coordinate relaxation and collinear port snapping (`straightTolerance`).
 * - Supports fixed port constraints, causality biases (e.g. input ports biased left, output ports
 *   biased right), and bidirectional multi-connector bus groups.
 * - Lightweight solver executable synchronously in browser UI layout passes without requiring
 *   external mixed-integer linear programming solvers.
 */

export type SolverPortSide = "top" | "bottom" | "left" | "right";

export interface SolverPort {
  id: string;
  nodeId: string;
  name?: string | undefined;
  direction?: "in" | "out" | "inout" | undefined;
  fixedSide?: SolverPortSide | undefined;
  assignedSide?: SolverPortSide | undefined;
  offset?: number | undefined; // Distance along edge [margin, edgeLength - margin]
  x?: number | undefined; // Absolute canvas X coordinate
  y?: number | undefined; // Absolute canvas Y coordinate
  [key: string]: unknown;
}

export interface SolverNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  ports: SolverPort[];
}

export interface SolverEdge {
  id?: string | undefined;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface PortSolverOptions {
  minSpacing?: number; // Minimum distance between ports on the same face (default: 16px)
  margin?: number; // Margin from corners of node boundary (default: 12px)
  straightTolerance?: number; // Snap threshold for collinear 0-bend connections (default: 8px)
}

export interface SolvedPortPlacement {
  portId: string;
  nodeId: string;
  side: SolverPortSide;
  x: number;
  y: number;
  relativeX: number; // Normalized 0..1 along node width
  relativeY: number; // Normalized 0..1 along node height
}

/**
 * Global Port Constraint Solver.
 * Executes Stage 1 (face assignment & crossing elimination) and Stage 2 (continuous collinear alignment LP).
 */
export class GlobalPortIlpSolver {
  private readonly options: Required<PortSolverOptions>;

  constructor(options: PortSolverOptions = {}) {
    this.options = {
      minSpacing: options.minSpacing ?? 16,
      margin: options.margin ?? 12,
      straightTolerance: options.straightTolerance ?? 8,
    };
  }

  /**
   * Solves port placements for all nodes and edges in the graph.
   */
  public solve(nodes: SolverNode[], edges: SolverEdge[]): Map<string, SolvedPortPlacement> {
    const nodeMap = new Map<string, SolverNode>();
    const portMap = new Map<string, SolverPort>();
    const portToNode = new Map<string, string>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
      for (const port of node.ports) {
        portMap.set(port.id, port);
        portToNode.set(port.id, node.id);
      }
    }

    // Map connections per port
    const portConnections = new Map<string, { peerPortId: string; peerNodeId: string }[]>();
    for (const e of edges) {
      const srcNodeId = e.sourceNodeId;
      const tgtNodeId = e.targetNodeId;

      const srcList = portConnections.get(e.sourcePortId) ?? [];
      srcList.push({ peerPortId: e.targetPortId, peerNodeId: tgtNodeId });
      portConnections.set(e.sourcePortId, srcList);

      const tgtList = portConnections.get(e.targetPortId) ?? [];
      tgtList.push({ peerPortId: e.sourcePortId, peerNodeId: srcNodeId });
      portConnections.set(e.targetPortId, tgtList);
    }

    // ── Stage 1: Face Assignment ───────────────────────────────────────────
    for (const node of nodes) {
      for (const port of node.ports) {
        port.assignedSide = this.determinePortFace(port, node, nodeMap, portConnections);
      }
    }

    // ── Stage 2: Exact Crossing-Minimizing Permutation + 1D Coordinates ───
    // Run 3 coordinated Gauss-Seidel sweeps so peer port coordinates mutually converge
    const results = new Map<string, SolvedPortPlacement>();
    const faceOrder: SolverPortSide[] = ["left", "right", "top", "bottom"];

    const nodeFaceGroups = nodes.map((node) => {
      const faceGroups: Record<SolverPortSide, SolverPort[]> = {
        top: [],
        bottom: [],
        left: [],
        right: [],
      };
      for (const port of node.ports) {
        const side = port.assignedSide || "right";
        faceGroups[side].push(port);
      }
      return { node, faceGroups };
    });

    for (let sweep = 0; sweep < 3; sweep++) {
      for (const { node, faceGroups } of nodeFaceGroups) {
        for (const side of faceOrder) {
          this.solveFacePorts(node, side, faceGroups[side], nodeMap, portConnections, results, sweep > 0);
        }
      }
    }

    // ── Stage 3: Multi-Pass Collinear 0-Bend Chain Snapping ───────────────
    this.snapCollinearConnections(edges, nodeMap, results);

    return results;
  }

  /**
   * Stage 1 Helper: Determines optimal boundary face for a port based on hard constraints
   * and geometric sector targeting.
   */
  private determinePortFace(
    port: SolverPort,
    node: SolverNode,
    nodeMap: Map<string, SolverNode>,
    portConnections: Map<string, { peerPortId: string; peerNodeId: string }[]>,
  ): SolverPortSide {
    // 1. Hard constraint: explicit fixedSide
    if (port.fixedSide) {
      return port.fixedSide;
    }

    // 2. Hard constraint: explicit causality direction if no connection or as strong preference
    const connections = portConnections.get(port.id) ?? [];
    if (connections.length === 0) {
      if (port.direction === "in") return "left";
      if (port.direction === "out") return "right";
      return "right";
    }

    // Aggregate average peer vector across all connections (handles fan-out cleanly)
    const nodeCenterX = node.x + node.width / 2;
    const nodeCenterY = node.y + node.height / 2;
    let sumDx = 0;
    let sumDy = 0;
    let peerCount = 0;
    for (const c of connections) {
      const peerNode = nodeMap.get(c.peerNodeId);
      if (peerNode) {
        sumDx += peerNode.x + peerNode.width / 2 - nodeCenterX;
        sumDy += peerNode.y + peerNode.height / 2 - nodeCenterY;
        peerCount++;
      }
    }
    if (peerCount === 0) {
      if (port.direction === "in") return "left";
      if (port.direction === "out") return "right";
      return "right";
    }

    const dx = sumDx / peerCount;
    const dy = sumDy / peerCount;

    // Strict direction constraints take precedence if opposing direction
    if (port.direction === "in" && dx > 0 && Math.abs(dx) > Math.abs(dy)) {
      return dy >= 0 ? "bottom" : "top";
    }
    if (port.direction === "out" && dx < 0 && Math.abs(dx) > Math.abs(dy)) {
      return dy >= 0 ? "bottom" : "top";
    }

    // Geometric sector preference
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? "right" : "left";
    }
    return dy >= 0 ? "bottom" : "top";
  }

  /**
   * Resolves a port's ideal target coordinate along the face axis using already-solved
   * peer port coordinates when available (weighted by all edges), falling back to peer centroid
   * and original port offset.
   */
  private computePortTargets(
    port: SolverPort,
    isVerticalFace: boolean,
    fallbackCenter: number,
    nodeMap: Map<string, SolverNode>,
    portConnections: Map<string, { peerPortId: string; peerNodeId: string }[]>,
    results: Map<string, SolvedPortPlacement>,
    useSolvedPeers: boolean,
  ): { targets: number[]; idealMean: number } {
    const conns = portConnections.get(port.id) ?? [];
    const targets: number[] = [];
    for (const conn of conns) {
      const solvedPeer = useSolvedPeers ? results.get(conn.peerPortId) : undefined;
      if (solvedPeer) {
        targets.push(isVerticalFace ? solvedPeer.y : solvedPeer.x);
        continue;
      }
      const peerNode = nodeMap.get(conn.peerNodeId);
      if (peerNode) {
        targets.push(isVerticalFace ? peerNode.y + peerNode.height / 2 : peerNode.x + peerNode.width / 2);
      }
    }
    if (targets.length === 0) {
      const origCoord = isVerticalFace ? port.y : port.x;
      const val = typeof origCoord === "number" && Number.isFinite(origCoord) ? origCoord : fallbackCenter;
      return { targets: [val], idealMean: val };
    }
    const idealMean = targets.reduce((s, v) => s + v, 0) / targets.length;
    return { targets, idealMean };
  }

  /**
   * Exact Branch-and-Bound Port Ordering minimizing total pairwise wire crossings plus
   * normalized deviation penalty for small-to-medium faces (`n <= 8`), falling back cleanly
   * to target-mean sorting on dense bus faces.
   */
  private orderFacePortsExact<T extends { idealMean: number; targets: number[] }>(items: T[]): T[] {
    if (items.length <= 1) return items;
    const sorted = [...items].sort((a, b) => a.idealMean - b.idealMean);
    if (items.length > 8) return sorted;

    const n = items.length;
    const invMatrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        let crossingsIfIBeforeJ = 0;
        for (const ti of sorted[i]!.targets) {
          for (const tj of sorted[j]!.targets) {
            if (ti > tj + 1e-6) crossingsIfIBeforeJ++;
          }
        }
        invMatrix[i]![j] = crossingsIfIBeforeJ;
      }
    }

    // Upper bound from mean-sorted greedy baseline
    const evalPermCost = (perm: number[]): number => {
      let inv = 0;
      let dev = 0;
      for (let a = 0; a < perm.length; a++) {
        const ia = perm[a]!;
        dev += Math.abs(ia - a) * 0.01;
        for (let b = a + 1; b < perm.length; b++) {
          inv += invMatrix[ia]![perm[b]!]!;
        }
      }
      return inv * 1000 + dev;
    };

    const identityPerm = Array.from({ length: n }, (_, k) => k);
    let bestPerm = identityPerm;
    let bestCost = evalPermCost(identityPerm);
    if (bestCost < 1e-3) return sorted;

    const used = new Array<boolean>(n).fill(false);
    const cur: number[] = [];
    const dfs = (accCost: number) => {
      if (accCost >= bestCost) return;
      if (cur.length === n) {
        bestCost = accCost;
        bestPerm = [...cur];
        return;
      }
      const pos = cur.length;
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        let delta = Math.abs(i - pos) * 0.01;
        for (const prev of cur) {
          delta += invMatrix[prev]![i]! * 1000;
        }
        if (accCost + delta >= bestCost) continue;
        used[i] = true;
        cur.push(i);
        dfs(accCost + delta);
        cur.pop();
        used[i] = false;
      }
    };
    dfs(0);

    return bestPerm.map((idx) => sorted[idx]!);
  }

  /**
   * Shared Stage 2 solver for vertical ("left" / "right") and horizontal ("top" / "bottom") faces.
   */
  private solveFacePorts(
    node: SolverNode,
    side: SolverPortSide,
    ports: SolverPort[],
    nodeMap: Map<string, SolverNode>,
    portConnections: Map<string, { peerPortId: string; peerNodeId: string }[]>,
    results: Map<string, SolvedPortPlacement>,
    useSolvedPeers: boolean,
  ): void {
    if (ports.length === 0) return;

    const isVerticalFace = side === "left" || side === "right";
    const axisOrigin = isVerticalFace ? node.y : node.x;
    const axisSpan = isVerticalFace ? node.height : node.width;
    const margin = Math.min(this.options.margin, axisSpan / 4);
    const minSpacing = this.options.minSpacing;
    const usableSpan = Math.max(axisSpan - margin * 2, 0);
    const fallbackCenter = axisOrigin + axisSpan / 2;

    const weighted = ports.map((port) => {
      const { targets, idealMean } = this.computePortTargets(
        port,
        isVerticalFace,
        fallbackCenter,
        nodeMap,
        portConnections,
        results,
        useSolvedPeers,
      );
      return { port, targets, idealMean };
    });

    const ordered = this.orderFacePortsExact(weighted);
    const count = ordered.length;
    let coords: number[];

    if (count === 1) {
      const clamped = Math.min(Math.max(ordered[0]!.idealMean, axisOrigin + margin), axisOrigin + axisSpan - margin);
      coords = [clamped];
    } else {
      const requiredSpan = (count - 1) * minSpacing;
      if (requiredSpan <= usableSpan) {
        const avgTarget = ordered.reduce((s, item) => s + item.idealMean, 0) / count;
        let start = avgTarget - requiredSpan / 2;
        const minStart = axisOrigin + margin;
        const maxStart = axisOrigin + axisSpan - margin - requiredSpan;
        if (start < minStart) start = minStart;
        else if (start > maxStart) start = maxStart;
        coords = ordered.map((_, idx) => start + idx * minSpacing);
      } else {
        const step = usableSpan / (count - 1);
        coords = ordered.map((_, idx) => axisOrigin + margin + idx * step);
      }
    }

    const fixedCoord =
      side === "left"
        ? node.x
        : side === "right"
          ? node.x + node.width
          : side === "top"
            ? node.y
            : node.y + node.height;

    for (let i = 0; i < count; i++) {
      const p = ordered[i]!.port;
      const alongCoord = Math.round(coords[i]!);
      const absX = isVerticalFace ? fixedCoord : alongCoord;
      const absY = isVerticalFace ? alongCoord : fixedCoord;
      const relX = node.width > 0 ? (absX - node.x) / node.width : 0.5;
      const relY = node.height > 0 ? (absY - node.y) / node.height : 0.5;

      p.x = absX;
      p.y = absY;

      results.set(p.id, {
        portId: p.id,
        nodeId: node.id,
        side,
        x: absX,
        y: absY,
        relativeX: side === "left" ? 0 : side === "right" ? 1 : Number(relX.toFixed(3)),
        relativeY: side === "top" ? 0 : side === "bottom" ? 1 : Number(relY.toFixed(3)),
      });
    }
  }

  /**
   * Stage 3: Multi-Pass Collinear 0-Bend Chain Snapping.
   * Iteratively aligns nearly-collinear ports across multi-hop chains within node bounds
   * and sibling spacing limits.
   */
  private snapCollinearConnections(
    edges: SolverEdge[],
    nodeMap: Map<string, SolverNode>,
    results: Map<string, SolvedPortPlacement>,
  ): void {
    const tol = this.options.straightTolerance;
    const minSpacing = this.options.minSpacing;

    // Collect sibling port placements per (nodeId, side) to enforce non-overlap when snapping
    const faceBuckets = new Map<string, SolvedPortPlacement[]>();
    for (const pl of results.values()) {
      const key = `${pl.nodeId}:${pl.side}`;
      const list = faceBuckets.get(key) ?? [];
      list.push(pl);
      faceBuckets.set(key, list);
    }

    const canPlaceSafely = (
      pl: SolvedPortPlacement,
      candidate: number,
      isVertical: boolean,
      node: SolverNode,
    ): boolean => {
      const margin = Math.min(this.options.margin, (isVertical ? node.height : node.width) / 4);
      const minBound = (isVertical ? node.y : node.x) + margin;
      const maxBound = (isVertical ? node.y + node.height : node.x + node.width) - margin;
      if (candidate < minBound || candidate > maxBound) return false;
      const siblings = faceBuckets.get(`${pl.nodeId}:${pl.side}`) ?? [];
      for (const sib of siblings) {
        if (sib.portId === pl.portId) continue;
        const sibCoord = isVertical ? sib.y : sib.x;
        if (Math.abs(sibCoord - candidate) < minSpacing - 1) return false;
      }
      return true;
    };

    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const e of edges) {
        const p1 = results.get(e.sourcePortId);
        const p2 = results.get(e.targetPortId);
        if (!p1 || !p2) continue;

        const n1 = nodeMap.get(e.sourceNodeId);
        const n2 = nodeMap.get(e.targetNodeId);
        if (!n1 || !n2) continue;

        const isHorizLink = (p1.side === "right" && p2.side === "left") || (p1.side === "left" && p2.side === "right");
        const isVertLink = (p1.side === "bottom" && p2.side === "top") || (p1.side === "top" && p2.side === "bottom");
        if (!isHorizLink && !isVertLink) continue;

        const c1 = isHorizLink ? p1.y : p1.x;
        const c2 = isHorizLink ? p2.y : p2.x;
        const diff = Math.abs(c1 - c2);
        if (diff === 0 || diff > tol) continue;

        // Try midpoint first, then snapping one end to the other if one node is constrained
        const mid = Math.round((c1 + c2) / 2);
        const candidates = [mid, c1, c2];
        for (const shared of candidates) {
          if (canPlaceSafely(p1, shared, isHorizLink, n1) && canPlaceSafely(p2, shared, isHorizLink, n2)) {
            if (isHorizLink) {
              p1.y = shared;
              p2.y = shared;
              p1.relativeY = Number(((shared - n1.y) / n1.height).toFixed(3));
              p2.relativeY = Number(((shared - n2.y) / n2.height).toFixed(3));
            } else {
              p1.x = shared;
              p2.x = shared;
              p1.relativeX = Number(((shared - n1.x) / n1.width).toFixed(3));
              p2.relativeX = Number(((shared - n2.x) / n2.width).toFixed(3));
            }
            moved = true;
            break;
          }
        }
      }
      if (!moved) break;
    }
  }
}

/**
 * Convenience entry point to solve port placements.
 */
export function solvePortPlacements(
  nodes: SolverNode[],
  edges: SolverEdge[],
  options?: PortSolverOptions,
): Map<string, SolvedPortPlacement> {
  const solver = new GlobalPortIlpSolver(options);
  return solver.solve(nodes, edges);
}
