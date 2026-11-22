// SPDX-License-Identifier: AGPL-3.0-or-later

import * as antvLayout from "@antv/layout";
import { isEphemeralDiagramNode } from "./drop-placeholder.js";
import { runLayeredLayoutInWorker } from "./layout-worker.js";
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
  getData?: () => Record<string, unknown> | undefined;
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
  options?: { width?: number; height?: number; onAction?: (action: { type: string; items: PlacementItem[] }) => void };
  zoomToFit?: (opts?: Record<string, unknown>) => void;
  zoomToRect?: (rect: { x: number; y: number; width: number; height: number }, opts?: Record<string, unknown>) => void;
  centerContent?: () => void;
  centerPoint?: (x: number, y: number) => void;
}

export interface AutoLayoutOptions {
  algorithm?: "dagre" | "layered" | "elk";
  rankdir?: "LR" | "TB" | "RL" | "BT";
  align?: "UL" | "UR" | "DL" | "DR";
  ranksep?: number;
  nodesep?: number;
  optimizePorts?: boolean | undefined;
  showProgress?: boolean | undefined;
  onAction?: (action: { type: "move"; items: PlacementItem[] }) => void;
  updateSolderDots?: (graph: AutoLayoutGraphLike) => void;
}

function isNodePinned(node: AutoLayoutNodeLike): boolean {
  const data = typeof node.getData === "function" ? node.getData() : undefined;
  return Boolean(data?.["pinned"] || data?.["locked"]);
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

function computeLayeredLayout(
  model: {
    nodes: { id: string; width: number; height: number }[];
    edges: { source: string; target: string; sourcePortFrac?: number; targetPortFrac?: number }[];
  },
  options?: AutoLayoutOptions,
): { nodes: { id: string; x: number; y: number }[] } {
  const rankdir = options?.rankdir ?? "LR";
  const ranksep = Math.max(20, options?.ranksep ?? 80);
  const nodesep = Math.max(16, options?.nodesep ?? 60);
  const horizontal = rankdir === "LR" || rankdir === "RL";
  const reversed = rankdir === "RL" || rankdir === "BT";

  const nodeMap = new Map<string, { id: string; width: number; height: number }>();
  for (const n of model.nodes) nodeMap.set(n.id, n);

  const outAdj = new Map<string, { to: string; srcFrac: number; tgtFrac: number }[]>();
  const inAdj = new Map<string, { from: string; srcFrac: number; tgtFrac: number }[]>();
  for (const n of model.nodes) {
    outAdj.set(n.id, []);
    inAdj.set(n.id, []);
  }
  for (const e of model.edges) {
    if (e.source === e.target || !nodeMap.has(e.source) || !nodeMap.has(e.target)) continue;
    outAdj.get(e.source)!.push({
      to: e.target,
      srcFrac: e.sourcePortFrac ?? 0.5,
      tgtFrac: e.targetPortFrac ?? 0.5,
    });
    inAdj.get(e.target)!.push({
      from: e.source,
      srcFrac: e.sourcePortFrac ?? 0.5,
      tgtFrac: e.targetPortFrac ?? 0.5,
    });
  }

  // 1. Cycle-breaking DFS + Longest-path topological layer assignment
  const visitState = new Map<string, 0 | 1 | 2>();
  const acyclicOut = new Map<string, string[]>();
  for (const n of model.nodes) {
    visitState.set(n.id, 0);
    acyclicOut.set(n.id, []);
  }
  const dfsBreakCycles = (u: string) => {
    visitState.set(u, 1);
    for (const edge of outAdj.get(u) ?? []) {
      const state = visitState.get(edge.to) ?? 0;
      if (state === 0) {
        acyclicOut.get(u)!.push(edge.to);
        dfsBreakCycles(edge.to);
      } else if (state === 2) {
        acyclicOut.get(u)!.push(edge.to);
      }
    }
    visitState.set(u, 2);
  };
  for (const n of model.nodes) {
    if (visitState.get(n.id) === 0) dfsBreakCycles(n.id);
  }

  const rank = new Map<string, number>();
  for (const n of model.nodes) rank.set(n.id, 0);
  for (let pass = 0; pass < model.nodes.length; pass++) {
    let changed = false;
    for (const u of model.nodes) {
      const rU = rank.get(u.id)!;
      for (const v of acyclicOut.get(u.id) ?? []) {
        if ((rank.get(v) ?? 0) < rU + 1) {
          rank.set(v, rU + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const maxRank = Math.max(0, ...Array.from(rank.values()));
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const n of model.nodes) {
    layers[rank.get(n.id)!]!.push(n.id);
  }

  // 2. Multi-pass Sugiyama barycenter crossing-minimization (forward + backward sweeps)
  const indexInLayer = () => {
    const idx = new Map<string, number>();
    for (const layer of layers) {
      layer.forEach((id, pos) => idx.set(id, pos));
    }
    return idx;
  };

  for (let sweep = 0; sweep < 8; sweep++) {
    // Forward sweep: order layer r by upstream barycenter
    let posMap = indexInLayer();
    for (let r = 1; r < layers.length; r++) {
      const layer = layers[r]!;
      const scores = new Map<string, number>();
      layer.forEach((id, origIdx) => {
        const preds = inAdj.get(id) ?? [];
        if (preds.length === 0) {
          scores.set(id, origIdx);
          return;
        }
        let sum = 0;
        for (const p of preds) {
          sum += (posMap.get(p.from) ?? origIdx) + (p.srcFrac - 0.5) * 0.4 - (p.tgtFrac - 0.5) * 0.15;
        }
        scores.set(id, sum / preds.length);
      });
      layer.sort((a, b) => scores.get(a)! - scores.get(b)!);
    }

    // Backward sweep: order layer r by downstream barycenter
    posMap = indexInLayer();
    for (let r = layers.length - 2; r >= 0; r--) {
      const layer = layers[r]!;
      const scores = new Map<string, number>();
      layer.forEach((id, origIdx) => {
        const succs = outAdj.get(id) ?? [];
        if (succs.length === 0) {
          scores.set(id, origIdx);
          return;
        }
        let sum = 0;
        for (const s of succs) {
          sum += (posMap.get(s.to) ?? origIdx) + (s.tgtFrac - 0.5) * 0.4 - (s.srcFrac - 0.5) * 0.15;
        }
        scores.set(id, sum / succs.length);
      });
      layer.sort((a, b) => scores.get(a)! - scores.get(b)!);
    }
  }

  // 3. Coordinate assignment respecting node sizes, ranksep, and nodesep
  const primaryPos = new Map<number, number>();
  let curPrimary = 0;
  for (let rIdx = 0; rIdx < layers.length; rIdx++) {
    const r = reversed ? layers.length - 1 - rIdx : rIdx;
    const layer = layers[r]!;
    let layerThickness = 0;
    for (const id of layer) {
      const n = nodeMap.get(id)!;
      layerThickness = Math.max(layerThickness, horizontal ? n.width : n.height);
    }
    primaryPos.set(r, curPrimary + layerThickness / 2);
    curPrimary += layerThickness + ranksep;
  }

  const outNodes: { id: string; x: number; y: number }[] = [];
  let maxSpan = 0;
  const layerSpans = layers.map((layer) => {
    let total = 0;
    layer.forEach((id, i) => {
      const n = nodeMap.get(id)!;
      total += (horizontal ? n.height : n.width) + (i > 0 ? nodesep : 0);
    });
    if (total > maxSpan) maxSpan = total;
    return total;
  });

  layers.forEach((layer, r) => {
    const pCenter = primaryPos.get(r)!;
    const span = layerSpans[r]!;
    let cursor = -span / 2;
    for (const id of layer) {
      const n = nodeMap.get(id)!;
      const minorSize = horizontal ? n.height : n.width;
      const sCenter = cursor + minorSize / 2;
      cursor += minorSize + nodesep;
      outNodes.push(horizontal ? { id, x: pCenter, y: sCenter } : { id, x: sCenter, y: pCenter });
    }
  });

  return { nodes: outNodes };
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

  const portOrderFraction = (node: AutoLayoutNodeLike, portId?: string): number => {
    if (!portId) return 0.5;
    const ports = typeof node.getPorts === "function" ? node.getPorts() : undefined;
    if (!ports || ports.length <= 1) return 0.5;
    const idx = ports.findIndex((p) => p.id === portId);
    return idx >= 0 ? idx / (ports.length - 1) : 0.5;
  };

  const nodeById = new Map(layoutableNodes.map((n) => [n.id, n]));
  const modelEdges = edges
    .filter((e) => {
      const s = e.getSourceCellId();
      const t = e.getTargetCellId();
      return s && t && layoutableNodeIds.has(s) && layoutableNodeIds.has(t);
    })
    .map((e) => {
      const sId = e.getSourceCellId()!;
      const tId = e.getTargetCellId()!;
      const sPort = resolveEdgePortId(e.getSourcePortId?.bind(e), e.getSource?.bind(e));
      const tPort = resolveEdgePortId(e.getTargetPortId?.bind(e), e.getTarget?.bind(e));
      return {
        source: sId,
        target: tId,
        sourcePortFrac: portOrderFraction(nodeById.get(sId)!, sPort),
        targetPortFrac: portOrderFraction(nodeById.get(tId)!, tPort),
      };
    });

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
      modelEdges.push({
        source: isolatedNodes[i]!,
        target: isolatedNodes[i + cols]!,
        sourcePortFrac: 0.5,
        targetPortFrac: 0.5,
      });
    }
  }

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

  const useLayered = options?.algorithm === "layered" || options?.algorithm === "elk";
  const newModel = useLayered
    ? computeLayeredLayout(model, options)
    : new DagreLayout({
        type: "dagre",
        rankdir: options?.rankdir ?? "LR",
        align: options?.align ?? "UL",
        ranksep: options?.ranksep ?? 80,
        nodesep: options?.nodesep ?? 60,
        begin: [0, 0],
        controlPoints: true,
      }).layout(model);
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
        if (isNodePinned(node)) {
          const cur = node.getPosition();
          nodePositions.set(node.id, { x: cur.x, y: cur.y });
          return;
        }
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
      g.zoomToFit({ padding: 20, maxScale: 1, viewportArea: { x: 0, y: 0, width: containerW, height: containerH } });
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
    // Offload large layered/ELK layouts (>= 60 nodes) to a background Web Worker when available
    const useLayered = options?.algorithm === "layered" || options?.algorithm === "elk";
    if (useLayered && layoutableNodes.length >= 60) {
      const edges = g.getEdges();
      const layoutableIdSet = new Set(layoutableNodes.map((n) => n.id));
      const workerModel = {
        nodes: layoutableNodes.map((n) => {
          const size = n.getSize();
          return { id: n.id, width: size.width || 80, height: size.height || 60 };
        }),
        edges: edges
          .map((e) => ({ source: e.getSourceCellId() ?? "", target: e.getTargetCellId() ?? "" }))
          .filter((e) => e.source && e.target && layoutableIdSet.has(e.source) && layoutableIdSet.has(e.target)),
      };
      const workerRes = await runLayeredLayoutInWorker(
        workerModel,
        { rankdir: options?.rankdir, ranksep: options?.ranksep, nodesep: options?.nodesep },
        () => computeLayeredLayout(workerModel, options),
      );
      if (workerRes.nodes.length > 0 && !g.disposed) {
        const moveItems: PlacementItem[] = [];
        const nodePositions = new Map<string, { x: number; y: number }>();
        g.batchUpdate("autoLayoutWorker", () => {
          for (const placed of workerRes.nodes) {
            const node = g.getCellById(placed.id);
            if (!node) continue;
            if (isNodePinned(node)) {
              const cur = node.getPosition();
              nodePositions.set(node.id, { x: cur.x, y: cur.y });
              continue;
            }
            const size = node.getSize();
            const w = size.width || 80;
            const h = size.height || 60;
            const newX = Math.round(placed.x - w / 2);
            const newY = Math.round(placed.y - h / 2);
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
          if (options?.optimizePorts !== false) {
            applyPortOptimization(layoutableNodes, edges, g, nodePositions);
          }
          edges.forEach((e) => e.setVertices?.([]));
          options?.updateSolderDots?.(g);
        });
        if (moveItems.length > 0) {
          (options?.onAction ?? g.options?.onAction)?.({ type: "move", items: moveItems });
        }
        g.zoomToFit?.({ padding: 20, maxScale: 1 });
        g.centerContent?.();
        return true;
      }
    }
    return autoLayoutDiagram(g, options);
  } finally {
    if (showProgress) {
      Spinner.hide();
    }
  }
}

/**
 * Multi-pass Sugiyama layered layout with barycenter port crossing minimization
 * and Global Port ILP collinear alignment.
 */
export function layoutWithElk(g?: AutoLayoutGraphLike | null, options?: AutoLayoutOptions): boolean {
  return autoLayoutDiagram(g, {
    ...options,
    algorithm: "elk",
    optimizePorts: options?.optimizePorts ?? true,
  });
}
