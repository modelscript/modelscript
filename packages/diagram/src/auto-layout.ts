// SPDX-License-Identifier: AGPL-3.0-or-later

import * as antvLayout from "@antv/layout";
import { isEphemeralDiagramNode } from "./drop-placeholder.js";
import {
  solvePortPlacements,
  type SolverEdge,
  type SolverNode,
  type SolverPort,
  type SolverPortSide,
} from "./port-ilp-solver.js";
import type { PlacementItem } from "./protocol.js";
import * as Spinner from "./spinner.js";

const antvLayoutModule = antvLayout as unknown as {
  DagreLayout?: new (options: Record<string, unknown>) => {
    layout: (model: {
      nodes: { id: string; width: number; height: number }[];
      edges: { source: string; target: string }[];
    }) => {
      nodes?: { id: string; x: number; y: number }[];
      edges?: unknown[];
    };
  };
};

const DagreLayout =
  antvLayoutModule.DagreLayout ||
  (class {
    layout(model: {
      nodes: { id: string; width: number; height: number }[];
      edges: { source: string; target: string }[];
    }) {
      return { nodes: model.nodes.map((n) => ({ id: n.id, x: 0, y: 0 })) };
    }
  } as unknown as NonNullable<typeof antvLayoutModule.DagreLayout>);

export interface AutoLayoutNodePort {
  id: string;
  group?: string | undefined;
  args?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

export interface AutoLayoutNodeLike {
  id: string;
  isNode?: () => boolean;
  getParent?: () => unknown;
  getParentId?: () => string | null | undefined;
  parent?: unknown;
  getPosition: () => { x: number; y: number };
  getSize: () => { width: number; height: number };
  getAngle?: () => number;
  setPosition: (x: number, y: number, options?: { silent?: boolean | undefined }) => void;
  getPorts?: () => AutoLayoutNodePort[];
  portProp?: (portId: string, path: string, val?: unknown) => unknown;
}

export interface AutoLayoutEdgeTerminal {
  cell?: string | undefined;
  port?: string | undefined;
  [key: string]: unknown;
}

export interface AutoLayoutEdgeLike {
  id?: string;
  getSource?: () => AutoLayoutEdgeTerminal | undefined;
  getTarget?: () => AutoLayoutEdgeTerminal | undefined;
  getSourceCellId: () => string | undefined;
  getTargetCellId: () => string | undefined;
  getSourcePortId?: () => string | undefined;
  getTargetPortId?: () => string | undefined;
  setVertices?: (vertices: { x: number; y: number }[]) => void;
}

export interface AutoLayoutGraphLike {
  disposed?: boolean;
  getNodes: () => AutoLayoutNodeLike[];
  getEdges: () => AutoLayoutEdgeLike[];
  getCellById: (id: string) => AutoLayoutNodeLike | null | undefined;
  batchUpdate: (name: string, fn: () => void) => void;
  container?: { clientWidth?: number; clientHeight?: number } | null;
  options?: { width?: number; height?: number; onAction?: (action: any) => void };
  zoomToFit?: (opts?: any) => void;
  zoomToRect?: (rect: any, opts?: any) => void;
  centerContent?: () => void;
  centerPoint?: (x: number, y: number) => void;
}

export interface AutoLayoutOptions {
  rankdir?: "LR" | "TB" | "RL" | "BT";
  align?: "UL" | "UR" | "DL" | "DR";
  ranksep?: number;
  nodesep?: number;
  optimizePorts?: boolean | undefined;
  showProgress?: boolean | undefined;
  onAction?: (action: { type: "move"; items: PlacementItem[] }) => void;
  updateSolderDots?: (graph: any) => void;
}

/**
 * Helper to safely extract the port ID from an edge terminal.
 */
function resolveEdgePortId(
  getter: (() => string | undefined) | undefined,
  terminalGetter: (() => AutoLayoutEdgeTerminal | undefined) | undefined,
): string | undefined {
  if (typeof getter === "function") {
    const val = getter();
    if (val) return val;
  }
  if (typeof terminalGetter === "function") {
    const term = terminalGetter();
    if (term?.port) return term.port;
  }
  return undefined;
}

/**
 * Optimizes port placement on nodes using the Global Port ILP Solver to ensure
 * straight (0-bend) connections between adjacent blocks and eliminate edge crossings.
 */
function applyPortOptimization(
  layoutableNodes: AutoLayoutNodeLike[],
  edges: AutoLayoutEdgeLike[],
  g: AutoLayoutGraphLike,
  nodePositions?: Map<string, { x: number; y: number }>,
): void {
  const solverNodes: SolverNode[] = [];
  const solverEdges: SolverEdge[] = [];

  for (const n of layoutableNodes) {
    const rawPorts = typeof n.getPorts === "function" ? n.getPorts() : undefined;
    if (Array.isArray(rawPorts) && rawPorts.length > 0) {
      const size = n.getSize();
      const pos = nodePositions?.get(n.id) ?? n.getPosition();
      const ports: SolverPort[] = rawPorts.map((p) => {
        const side =
          p.group === "left" || p.group === "right" || p.group === "top" || p.group === "bottom"
            ? (p.group as SolverPortSide)
            : undefined;
        return {
          id: p.id,
          nodeId: n.id,
          assignedSide: side,
        };
      });
      solverNodes.push({
        id: n.id,
        x: pos.x,
        y: pos.y,
        width: size.width || 80,
        height: size.height || 60,
        ports,
      });
    }
  }

  if (solverNodes.length === 0) return;

  for (const e of edges) {
    const sNode = e.getSourceCellId();
    const tNode = e.getTargetCellId();
    const sPort = resolveEdgePortId(e.getSourcePortId, e.getSource);
    const tPort = resolveEdgePortId(e.getTargetPortId, e.getTarget);
    if (sNode && tNode && sPort && tPort) {
      solverEdges.push({
        sourceNodeId: sNode,
        sourcePortId: sPort,
        targetNodeId: tNode,
        targetPortId: tPort,
      });
    }
  }

  if (solverEdges.length === 0) return;

  try {
    const solved = solvePortPlacements(solverNodes, solverEdges);
    for (const [portId, placement] of solved) {
      const node = g.getCellById(placement.nodeId);
      if (node && typeof node.portProp === "function") {
        node.portProp(portId, "args", {
          x: placement.relativeX,
          y: placement.relativeY,
        });
      }
    }
  } catch {
    // Non-critical: preserve original port coordinates if ILP solver encounters degenerate layout
  }
}

/**
 * Automatically calculates and applies an optimal spatial layout for diagram components.
 * Preserves the background coordinate system, axes, and non-component annotations.
 *
 * @param g Graph instance to layout.
 * @param options Optional layout configuration overrides.
 * @returns `true` if layout was applied; `false` if skipped (e.g. no layoutable nodes).
 */
export function autoLayoutDiagram(g?: AutoLayoutGraphLike | null, options?: AutoLayoutOptions): boolean {
  if (!g || g.disposed) return false;

  const allNodes = g.getNodes();
  // Filter out background, axes, solder dots, wire crossings, guides, ghosts, and child nodes
  const layoutableNodes = allNodes.filter(
    (n) => !isEphemeralDiagramNode(n.id) && !n.parent && !n.getParentId?.() && !n.getParent?.(),
  );

  // If there are no schematic components (e.g. equation-based model), do not perturb anything!
  if (layoutableNodes.length === 0) {
    return false;
  }

  const layoutableNodeIds = new Set(layoutableNodes.map((n) => n.id));
  const edges = g.getEdges();

  const modelEdges = edges
    .filter((e) => {
      const s = e.getSourceCellId();
      const t = e.getTargetCellId();
      return s && t && layoutableNodeIds.has(s) && layoutableNodeIds.has(t);
    })
    .map((e) => ({
      source: e.getSourceCellId()!,
      target: e.getTargetCellId()!,
    }));

  // Compact packing for isolated components (e.g. ground, isolated parameters)
  const connectedNodes = new Set<string>();
  modelEdges.forEach((e) => {
    connectedNodes.add(e.source);
    connectedNodes.add(e.target);
  });
  const isolatedNodes = layoutableNodes.filter((n) => !connectedNodes.has(n.id)).map((n) => n.id);
  if (isolatedNodes.length > 2) {
    const cols = Math.ceil(Math.sqrt(isolatedNodes.length));
    for (let i = 0; i < isolatedNodes.length - cols; i++) {
      modelEdges.push({ source: isolatedNodes[i]!, target: isolatedNodes[i + cols]! });
    }
  }

  const dagreLayout = new DagreLayout({
    type: "dagre",
    rankdir: options?.rankdir ?? "LR",
    align: options?.align ?? "UL",
    ranksep: options?.ranksep ?? 80,
    nodesep: options?.nodesep ?? 60,
    begin: [0, 0],
    controlPoints: true,
  });

  const model = {
    nodes: layoutableNodes.map((n) => {
      const size = n.getSize();
      const angle = Math.round(n.getAngle?.() ?? 0);
      const isRotated90or270 = Math.abs(angle % 180) === 90;
      const w = Math.max(isRotated90or270 ? size.height : size.width, 40);
      const h = Math.max(isRotated90or270 ? size.width : size.height, 40);
      return {
        id: n.id,
        width: w,
        height: h,
      };
    }),
    edges: modelEdges,
  };

  const newModel = dagreLayout.layout(model);
  if (!newModel?.nodes || newModel.nodes.length === 0) return false;

  // Determine target center point from coordinate system / background if present
  const bg = g.getCellById("__diagram_background__");
  let targetCenterX = 0;
  let targetCenterY = 0;
  if (bg && (!bg.isNode || bg.isNode())) {
    const bgPos = bg.getPosition();
    const bgSize = bg.getSize();
    targetCenterX = bgPos.x + bgSize.width / 2;
    targetCenterY = bgPos.y + bgSize.height / 2;
  }

  // Calculate Dagre bounding box (accounting for node centers)
  let minLeft = Infinity;
  let minTop = Infinity;
  let maxRight = -Infinity;
  let maxBottom = -Infinity;

  newModel.nodes.forEach((n) => {
    const node = g.getCellById(n.id);
    if (!node || (node.isNode && !node.isNode())) return;
    const size = node.getSize();
    const w = size.width || 80;
    const h = size.height || 60;
    const left = n.x - w / 2;
    const top = n.y - h / 2;
    minLeft = Math.min(minLeft, left);
    minTop = Math.min(minTop, top);
    maxRight = Math.max(maxRight, left + w);
    maxBottom = Math.max(maxBottom, top + h);
  });

  const layoutCenterX = (minLeft + maxRight) / 2;
  const layoutCenterY = (minTop + maxBottom) / 2;
  const shiftX = targetCenterX - layoutCenterX;
  const shiftY = targetCenterY - layoutCenterY;

  const moveItems: PlacementItem[] = [];

  g.batchUpdate("layout", () => {
    // 1. Atomic position updates: apply new coordinates inside batch
    const nodePositions = new Map<string, { x: number; y: number }>();
    newModel.nodes?.forEach((n) => {
      const node = g.getCellById(n.id);
      if (node && (!node.isNode || node.isNode()) && !isEphemeralDiagramNode(node.id)) {
        const size = node.getSize();
        const w = size.width || 80;
        const h = size.height || 60;
        const newX = Math.round(n.x - w / 2 + shiftX);
        const newY = Math.round(n.y - h / 2 + shiftY);
        node.setPosition(newX, newY);
        nodePositions.set(node.id, { x: newX, y: newY });
        moveItems.push({
          name: node.id,
          x: newX,
          y: newY,
          width: Math.round(w),
          height: Math.round(h),
          rotation: Math.round(node.getAngle?.() ?? 0),
        });
      }
    });

    // 2. Port constraint optimization: collinear alignments & crossing elimination
    if (options?.optimizePorts !== false) {
      applyPortOptimization(layoutableNodes, edges, g, nodePositions);
    }

    // 3. Sort edges by length so direct local links establish paths before long bus trunks
    const sortedEdges = [...edges].sort((e1, e2) => {
      const s1 = e1.getSourceCellId() ?? "";
      const t1 = e1.getTargetCellId() ?? "";
      const s2 = e2.getSourceCellId() ?? "";
      const t2 = e2.getTargetCellId() ?? "";
      const p1s = nodePositions.get(s1) ?? g.getCellById(s1)?.getPosition();
      const p1t = nodePositions.get(t1) ?? g.getCellById(t1)?.getPosition();
      const p2s = nodePositions.get(s2) ?? g.getCellById(s2)?.getPosition();
      const p2t = nodePositions.get(t2) ?? g.getCellById(t2)?.getPosition();
      if (!p1s || !p1t || !p2s || !p2t) return 0;
      const d1 = Math.hypot(p1s.x - p1t.x, p1s.y - p1t.y);
      const d2 = Math.hypot(p2s.x - p2t.x, p2s.y - p2t.y);
      return d1 - d2;
    });

    // Reset edge intermediate vertices so orthogonal routers recompute clean direct paths
    sortedEdges.forEach((e) => {
      if (typeof e.setVertices === "function") {
        e.setVertices([]);
      }
    });

    // 4. Refresh solder dots and wire crossings at the new edge positions in one atomic pass
    if (options?.updateSolderDots) {
      options.updateSolderDots(g);
    }
  });

  // Enqueue diagram action so positions persist to document source and allow Ctrl+Z undo
  if (moveItems.length > 0) {
    if (options?.onAction) {
      options.onAction({ type: "move", items: moveItems });
    } else if (g.options?.onAction) {
      g.options.onAction({ type: "move", items: moveItems });
    }
  }

  // Rescale viewport smoothly respecting coordinate system or content bounds
  if (bg && (!bg.isNode || bg.isNode())) {
    const bgPos = bg.getPosition();
    const bgSize = bg.getSize();
    const expandedRect = {
      x: bgPos.x - bgSize.width * 0.125,
      y: bgPos.y - bgSize.height * 0.125,
      width: bgSize.width * 1.25,
      height: bgSize.height * 1.25,
    };
    if (typeof g.zoomToRect === "function" && g.container) {
      const cw = g.container.clientWidth || 800;
      const ch = g.container.clientHeight || 600;
      g.zoomToRect(expandedRect, { viewportArea: { x: 0, y: 0, width: cw, height: ch } });
    }
    if (typeof g.centerPoint === "function") {
      g.centerPoint(targetCenterX, targetCenterY);
    }
  } else {
    const containerW =
      g.container?.clientWidth && g.container.clientWidth > 0 ? g.container.clientWidth : g.options?.width || 800;
    const containerH =
      g.container?.clientHeight && g.container.clientHeight > 0 ? g.container.clientHeight : g.options?.height || 600;
    if (typeof g.zoomToFit === "function") {
      g.zoomToFit({ padding: 20, viewportArea: { x: 0, y: 0, width: containerW, height: containerH } });
    }
    if (typeof g.centerContent === "function") {
      g.centerContent();
    }
  }

  return true;
}

/**
 * Asynchronously calculates and applies an optimal spatial layout for diagram components.
 * For large models, yields to the browser event loop and displays a progress spinner to
 * prevent UI stutter.
 */
export async function autoLayoutDiagramAsync(
  g?: AutoLayoutGraphLike | null,
  options?: AutoLayoutOptions,
): Promise<boolean> {
  if (!g || g.disposed) return false;

  const allNodes = g.getNodes();
  const layoutableNodes = allNodes.filter(
    (n) => !isEphemeralDiagramNode(n.id) && !n.parent && !n.getParentId?.() && !n.getParent?.(),
  );

  if (layoutableNodes.length === 0) return false;

  const isLargeGraph = layoutableNodes.length >= 30;
  const showProgress = options?.showProgress !== false && isLargeGraph;

  if (showProgress) {
    Spinner.show();
    // Yield to let the browser paint the spinner before running Dagre
    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  try {
    return autoLayoutDiagram(g, options);
  } finally {
    if (showProgress) {
      Spinner.hide();
    }
  }
}
