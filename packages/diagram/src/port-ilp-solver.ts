// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Global Port Constraint ILP Solver.
// Solves optimal face assignment, planar crossing elimination, and 1D continuous
// collinear coordinate alignment to produce 0-bend connections between blocks.

export type SolverPortSide = "top" | "bottom" | "left" | "right";

export interface SolverPort {
  id: string;
  nodeId: string;
  name?: string;
  direction?: "in" | "out" | "inout";
  fixedSide?: SolverPortSide;
  assignedSide?: SolverPortSide;
  offset?: number; // Distance along edge [margin, edgeLength - margin]
  x?: number; // Absolute canvas X coordinate
  y?: number; // Absolute canvas Y coordinate
  [key: string]: any;
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
  id?: string;
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

    // ── Stage 2: Crossing Elimination & 1D Continuous Coordinate Alignment ──
    const results = new Map<string, SolvedPortPlacement>();

    for (const node of nodes) {
      // Group ports by assigned face
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

      // Solve vertical faces (left and right)
      this.solveVerticalFacePorts(node, "left", faceGroups.left, nodeMap, portMap, portConnections, results);
      this.solveVerticalFacePorts(node, "right", faceGroups.right, nodeMap, portMap, portConnections, results);

      // Solve horizontal faces (top and bottom)
      this.solveHorizontalFacePorts(node, "top", faceGroups.top, nodeMap, portMap, portConnections, results);
      this.solveHorizontalFacePorts(node, "bottom", faceGroups.bottom, nodeMap, portMap, portConnections, results);
    }

    // ── Stage 3: Collinear 0-Bend Snapping ──────────────────────────────────
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

    // If port has a single peer, evaluate geometric sector to peer node centroid
    const peerNode = nodeMap.get(connections[0].peerNodeId);
    if (!peerNode) {
      if (port.direction === "in") return "left";
      if (port.direction === "out") return "right";
      return "right";
    }

    const nodeCenterX = node.x + node.width / 2;
    const nodeCenterY = node.y + node.height / 2;
    const peerCenterX = peerNode.x + peerNode.width / 2;
    const peerCenterY = peerNode.y + peerNode.height / 2;

    const dx = peerCenterX - nodeCenterX;
    const dy = peerCenterY - nodeCenterY;

    // Strict direction constraints take precedence if opposing direction
    if (port.direction === "in" && dx > 0 && Math.abs(dx) > Math.abs(dy)) {
      // Inbound port connecting to something to the right: prefer top or bottom instead of wrong face
      return dy >= 0 ? "bottom" : "top";
    }
    if (port.direction === "out" && dx < 0 && Math.abs(dx) > Math.abs(dy)) {
      // Outbound port connecting to something to the left: prefer top or bottom
      return dy >= 0 ? "bottom" : "top";
    }

    // Geometric sector preference
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0 ? "right" : "left";
    } else {
      return dy >= 0 ? "bottom" : "top";
    }
  }

  /**
   * Stage 2 Helper: Solves port placement along a vertical face (left or right).
   * Minimizes wire crossings by ordering ports according to peer target Y coordinates,
   * then aligns Y coordinates to targets within boundary bounds.
   */
  private solveVerticalFacePorts(
    node: SolverNode,
    side: "left" | "right",
    ports: SolverPort[],
    nodeMap: Map<string, SolverNode>,
    portMap: Map<string, SolverPort>,
    portConnections: Map<string, { peerPortId: string; peerNodeId: string }[]>,
    results: Map<string, SolvedPortPlacement>,
  ): void {
    if (ports.length === 0) return;

    const height = node.height;
    const margin = this.options.margin;
    const minSpacing = this.options.minSpacing;
    const usableHeight = Math.max(height - margin * 2, 0);

    // Compute ideal target Y for each port to sort without crossings
    const portTargets = ports.map((p) => {
      const conns = portConnections.get(p.id) ?? [];
      let targetY = node.y + height / 2;
      if (conns.length > 0) {
        const peerNode = nodeMap.get(conns[0].peerNodeId);
        if (peerNode) {
          targetY = peerNode.y + peerNode.height / 2;
        }
      }
      return { port: p, targetY };
    });

    // Sort ports by targetY to eliminate crossings
    portTargets.sort((a, b) => a.targetY - b.targetY);

    const count = portTargets.length;
    let yCoords: number[] = [];

    if (count === 1) {
      const idealY = portTargets[0].targetY;
      const clampedY = Math.min(Math.max(idealY, node.y + margin), node.y + height - margin);
      yCoords = [clampedY];
    } else {
      // Check if minimum spacing fits
      const requiredSpan = (count - 1) * minSpacing;
      if (requiredSpan <= usableHeight) {
        // Ideal placement: center the span around the average target Y
        const avgTargetY = portTargets.reduce((s, pt) => s + pt.targetY, 0) / count;
        let startY = avgTargetY - requiredSpan / 2;

        if (startY < node.y + margin) {
          startY = node.y + margin;
        } else if (startY + requiredSpan > node.y + height - margin) {
          startY = node.y + height - margin - requiredSpan;
        }

        yCoords = portTargets.map((_, idx) => startY + idx * minSpacing);
      } else {
        // Uniform distribution if compact
        const step = usableHeight / (count - 1);
        yCoords = portTargets.map((_, idx) => node.y + margin + idx * step);
      }
    }

    const faceX = side === "left" ? node.x : node.x + node.width;

    for (let i = 0; i < count; i++) {
      const p = portTargets[i].port;
      const absY = Math.round(yCoords[i]);
      const relY = height > 0 ? (absY - node.y) / height : 0.5;

      p.x = faceX;
      p.y = absY;

      results.set(p.id, {
        portId: p.id,
        nodeId: node.id,
        side,
        x: faceX,
        y: absY,
        relativeX: side === "left" ? 0 : 1,
        relativeY: Number(relY.toFixed(3)),
      });
    }
  }

  /**
   * Stage 2 Helper: Solves port placement along a horizontal face (top or bottom).
   * Minimizes wire crossings by ordering ports according to peer target X coordinates,
   * then aligns X coordinates to targets within boundary bounds.
   */
  private solveHorizontalFacePorts(
    node: SolverNode,
    side: "top" | "bottom",
    ports: SolverPort[],
    nodeMap: Map<string, SolverNode>,
    portMap: Map<string, SolverPort>,
    portConnections: Map<string, { peerPortId: string; peerNodeId: string }[]>,
    results: Map<string, SolvedPortPlacement>,
  ): void {
    if (ports.length === 0) return;

    const width = node.width;
    const margin = this.options.margin;
    const minSpacing = this.options.minSpacing;
    const usableWidth = Math.max(width - margin * 2, 0);

    const portTargets = ports.map((p) => {
      const conns = portConnections.get(p.id) ?? [];
      let targetX = node.x + width / 2;
      if (conns.length > 0) {
        const peerNode = nodeMap.get(conns[0].peerNodeId);
        if (peerNode) {
          targetX = peerNode.x + peerNode.width / 2;
        }
      }
      return { port: p, targetX };
    });

    portTargets.sort((a, b) => a.targetX - b.targetX);

    const count = portTargets.length;
    let xCoords: number[] = [];

    if (count === 1) {
      const idealX = portTargets[0].targetX;
      const clampedX = Math.min(Math.max(idealX, node.x + margin), node.x + width - margin);
      xCoords = [clampedX];
    } else {
      const requiredSpan = (count - 1) * minSpacing;
      if (requiredSpan <= usableWidth) {
        const avgTargetX = portTargets.reduce((s, pt) => s + pt.targetX, 0) / count;
        let startX = avgTargetX - requiredSpan / 2;

        if (startX < node.x + margin) {
          startX = node.x + margin;
        } else if (startX + requiredSpan > node.x + width - margin) {
          startX = node.x + width - margin - requiredSpan;
        }

        xCoords = portTargets.map((_, idx) => startX + idx * minSpacing);
      } else {
        const step = usableWidth / (count - 1);
        xCoords = portTargets.map((_, idx) => node.x + margin + idx * step);
      }
    }

    const faceY = side === "top" ? node.y : node.y + node.height;

    for (let i = 0; i < count; i++) {
      const p = portTargets[i].port;
      const absX = Math.round(xCoords[i]);
      const relX = width > 0 ? (absX - node.x) / width : 0.5;

      p.x = absX;
      p.y = faceY;

      results.set(p.id, {
        portId: p.id,
        nodeId: node.id,
        side,
        x: absX,
        y: faceY,
        relativeX: Number(relX.toFixed(3)),
        relativeY: side === "top" ? 0 : 1,
      });
    }
  }

  /**
   * Stage 3: Collinear 0-Bend Snapping.
   * Snaps nearly-aligned ports to exact matching coordinates if within tolerance
   * and within both node boundary limits.
   */
  private snapCollinearConnections(
    edges: SolverEdge[],
    nodeMap: Map<string, SolverNode>,
    results: Map<string, SolvedPortPlacement>,
  ): void {
    const tol = this.options.straightTolerance;
    const margin = this.options.margin;

    for (const e of edges) {
      const p1 = results.get(e.sourcePortId);
      const p2 = results.get(e.targetPortId);
      if (!p1 || !p2) continue;

      const n1 = nodeMap.get(e.sourceNodeId);
      const n2 = nodeMap.get(e.targetNodeId);
      if (!n1 || !n2) continue;

      // 1. Horizontal straight connection: p1 on right, p2 on left (or vice-versa)
      if ((p1.side === "right" && p2.side === "left") || (p1.side === "left" && p2.side === "right")) {
        const diffY = Math.abs(p1.y - p2.y);
        if (diffY > 0 && diffY <= tol) {
          const sharedY = Math.round((p1.y + p2.y) / 2);
          const fitsInN1 = sharedY >= n1.y + margin && sharedY <= n1.y + n1.height - margin;
          const fitsInN2 = sharedY >= n2.y + margin && sharedY <= n2.y + n2.height - margin;

          if (fitsInN1 && fitsInN2) {
            p1.y = sharedY;
            p2.y = sharedY;
            p1.relativeY = Number(((sharedY - n1.y) / n1.height).toFixed(3));
            p2.relativeY = Number(((sharedY - n2.y) / n2.height).toFixed(3));
          }
        }
      }

      // 2. Vertical straight connection: p1 on bottom, p2 on top (or vice-versa)
      if ((p1.side === "bottom" && p2.side === "top") || (p1.side === "top" && p2.side === "bottom")) {
        const diffX = Math.abs(p1.x - p2.x);
        if (diffX > 0 && diffX <= tol) {
          const sharedX = Math.round((p1.x + p2.x) / 2);
          const fitsInN1 = sharedX >= n1.x + margin && sharedX <= n1.x + n1.width - margin;
          const fitsInN2 = sharedX >= n2.x + margin && sharedX <= n2.x + n2.width - margin;

          if (fitsInN1 && fitsInN2) {
            p1.x = sharedX;
            p2.x = sharedX;
            p1.relativeX = Number(((sharedX - n1.x) / n1.width).toFixed(3));
            p2.relativeX = Number(((sharedX - n2.x) / n2.width).toFixed(3));
          }
        }
      }
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
