// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  enqueueDiagramAction,
  getMetadataForGraph,
  getOptionsForGraph,
  solderDotsRafByGraph,
  toSchemaY,
} from "./canvas-state.js";
import type { Cell, DiagramWindow, Edge, Graph, Node } from "./canvas-types.js";
import { isEphemeralDiagramNode } from "./drop-placeholder.js";
import {
  collectCommittedExistingWires,
  computeOrthogonalRoute,
  extractEdgePruneOptions,
  getNodeBBox,
  getPortOutwardNormal,
  healOrthogonalVertices,
  pruneOrthogonalLoops,
  regularizeOrthogonalPolyline,
  resolveNodePortWorldPoint,
  simplifyCollinearPoints,
  type PointLike,
  type RectLike,
} from "./port-router.js";
import {
  computeSolderDots,
  computeWireCrossings,
  resolveWireCrossingStyle,
  solderDotToDiagramNode,
  wireCrossingToDiagramNode,
  type EdgePath,
  type WireCrossingStyle,
} from "./solder-dots.js";

export function computeParallelEdgeIndices(
  graph: Graph,
  currentEdge: Edge,
  sourceCellId: string,
  targetCellId: string,
): { parallelIndex: number; parallelCount: number } {
  if (typeof graph.getEdges !== "function") return { parallelIndex: 0, parallelCount: 1 };
  const allEdges = graph.getEdges();
  const curRawSrc = currentEdge.getSource?.() as { cell?: string; port?: string } | undefined;
  const curRawTgt = currentEdge.getTarget?.() as { cell?: string; port?: string } | undefined;
  const curSrcPort = currentEdge.getSourcePortId?.() ?? curRawSrc?.port;
  const curTgtPort = currentEdge.getTargetPortId?.() ?? curRawTgt?.port;
  const curSrcKey = curSrcPort ? `${sourceCellId}.${curSrcPort}` : sourceCellId;
  const curTgtKey = curTgtPort ? `${targetCellId}.${curTgtPort}` : targetCellId;

  const parallelEdges = allEdges.filter((e) => {
    if (!e || e.id === "__wire_tool_preview__") return false;
    const rawSrc = e.getSource?.() as { cell?: string; port?: string } | undefined;
    const rawTgt = e.getTarget?.() as { cell?: string; port?: string } | undefined;
    const s = e.getSourceCell?.()?.id ?? rawSrc?.cell;
    const t = e.getTargetCell?.()?.id ?? rawTgt?.cell;
    if (!s || !t) return false;
    const sPort = e.getSourcePortId?.() ?? rawSrc?.port;
    const tPort = e.getTargetPortId?.() ?? rawTgt?.port;
    const eSrcKey = sPort ? `${s}.${sPort}` : s;
    const eTgtKey = tPort ? `${t}.${tPort}` : t;
    return (eSrcKey === curSrcKey && eTgtKey === curTgtKey) || (eSrcKey === curTgtKey && eTgtKey === curSrcKey);
  });
  if (parallelEdges.length > 1) {
    const idx = parallelEdges.findIndex((e) => e.id === currentEdge.id);
    return {
      parallelCount: parallelEdges.length,
      parallelIndex: idx !== -1 ? idx : 0,
    };
  }
  return { parallelIndex: 0, parallelCount: 1 };
}

/**
 * Resolves the ID of the port on `node` nearest to `referencePt` in world coordinates.
 */
export function resolveNearestNodePortId(
  node: Cell | null | undefined,
  referencePt: PointLike | null | undefined,
): string | undefined {
  if (!node || !node.isNode()) return undefined;
  const ports = typeof node.getPorts === "function" ? node.getPorts() : [];
  if (!ports || ports.length === 0) return undefined;
  if (!referencePt) return ports[0]?.id;
  let bestPortId: string | undefined;
  let bestDist = Infinity;
  for (const p of ports) {
    if (!p.id) continue;
    const wp = resolveNodePortWorldPoint(node, p.id);
    if (!wp) continue;
    const dist = Math.hypot(wp.x - referencePt.x, wp.y - referencePt.y);
    if (dist < bestDist) {
      bestDist = dist;
      bestPortId = p.id;
    }
  }
  return bestPortId ?? ports[0]?.id;
}

/**
 * Automatically re-routes an edge with clean, obstacle-avoiding Manhattan A* paths
 * that respect port outward normals and avoid component self-impalement.
 */
export function rerouteEdgeOrthogonal(
  edge: Edge | null | undefined,
  g: Graph,
  options?: { skipEnqueue?: boolean },
): { source: string; target: string; points: { x: number; y: number }[] } | null {
  if (!edge || !edge.isEdge()) return null;
  const source = edge.getSource();
  const target = edge.getTarget();
  const sourceCell = edge.getSourceCell?.() ?? (source?.cell ? g.getCellById?.(source.cell) : null);
  const targetCell = edge.getTargetCell?.() ?? (target?.cell ? g.getCellById?.(target.cell) : null);
  const sourcePoint = resolveNodePortWorldPoint(sourceCell, source?.port, edge.getSourcePoint());
  const targetPoint = resolveNodePortWorldPoint(targetCell, target?.port, edge.getTargetPoint());
  if (!sourcePoint || !targetPoint) return null;

  const sourceSide = getPortOutwardNormal(sourceCell, source?.port, sourcePoint)?.side;
  const targetSide = getPortOutwardNormal(targetCell, target?.port, targetPoint)?.side;
  const sourceBox = getNodeBBox(sourceCell) ?? undefined;
  const targetBox = getNodeBBox(targetCell) ?? undefined;

  const obstacles: RectLike[] = [];
  for (const node of g.getNodes()) {
    if (node.id === source?.cell || node.id === target?.cell) continue;
    if (isEphemeralDiagramNode(node.id)) continue;
    const bbox = getNodeBBox(node);
    if (bbox) {
      obstacles.push(bbox);
    }
  }

  const { parallelIndex, parallelCount } = computeParallelEdgeIndices(
    g,
    edge,
    String(source?.cell ?? ""),
    String(target?.cell ?? ""),
  );

  const existingWires = collectCommittedExistingWires(g, edge.id);

  const rawRoute = computeOrthogonalRoute(sourcePoint, targetPoint, obstacles, {
    sourceSide,
    targetSide,
    sourceBox,
    targetBox,
    parallelIndex,
    parallelCount,
    existingWires,
  });
  const intermediateVertices = simplifyCollinearPoints(rawRoute);
  edge.setVertices(intermediateVertices, { ignoreSnap: true });

  const points = [sourcePoint, ...intermediateVertices, targetPoint].map((p: PointLike) => ({
    x: Math.round(p.x),
    y: toSchemaY(g, p.y),
  }));

  const srcStr = source?.port ? `${source.cell}.${source.port}` : String(source?.cell ?? "");
  const tgtStr = target?.port ? `${target.cell}.${target.port}` : String(target?.cell ?? "");

  const result = {
    source: srcStr,
    target: tgtStr,
    points,
  };

  if (!options?.skipEnqueue) {
    enqueueDiagramAction(
      {
        type: "moveEdge",
        edges: [result],
      },
      g,
    );
  }

  return result;
}

/** Get connected edge metadata for a node (for move/resize updates). */
export function getConnectedEdges(
  g: Graph,
  node: Node,
): { id?: string | undefined; source: string; target: string; points: { x: number; y: number }[] }[] {
  return g.getConnectedEdges(node).map((edge: Edge) => {
    const source = edge.getSource();
    const target = edge.getTarget();
    const sourceCell = edge.getSourceCell?.() ?? (source?.cell ? g.getCellById?.(source.cell) : null);
    const targetCell = edge.getTargetCell?.() ?? (target?.cell ? g.getCellById?.(target.cell) : null);
    const explicitVertices = edge.getVertices() || [];
    const edgeView = typeof edge.findView === "function" ? edge.findView(g) : null;
    const routePoints = edgeView?.routePoints;
    const vertices =
      explicitVertices.length > 0
        ? explicitVertices
        : routePoints && routePoints.length > 0
          ? routePoints.map((p: PointLike) => ({ x: p.x, y: p.y }))
          : [];
    const sourcePoint = resolveNodePortWorldPoint(sourceCell, source?.port, edge.getSourcePoint());
    const targetPoint = resolveNodePortWorldPoint(targetCell, target?.port, edge.getTargetPoint());
    const healed = sourcePoint && targetPoint ? healOrthogonalVertices(sourcePoint, targetPoint, vertices) : vertices;
    const pruneOpts =
      sourcePoint && targetPoint ? extractEdgePruneOptions(g as never, edge as never, sourcePoint, targetPoint) : {};
    const fullPoly =
      sourcePoint && targetPoint
        ? pruneOrthogonalLoops([sourcePoint, ...healed, targetPoint], pruneOpts)
        : [sourcePoint, ...vertices, targetPoint].filter((p): p is PointLike => Boolean(p));
    const regularized = regularizeOrthogonalPolyline(fullPoly, 2, 1.0);
    const points = regularized.map((p: PointLike) => ({
      x: Math.round(p.x),
      y: toSchemaY(g, p.y),
    }));
    const srcStr = source.port ? `${source.cell}.${source.port}` : String(source.cell ?? "");
    const tgtStr = target.port ? `${target.cell}.${target.port}` : String(target.cell ?? "");
    return {
      id: edge.id,
      source: srcStr,
      target: tgtStr,
      points,
    };
  });
}

/**
 * Schedules a coalesced `requestAnimationFrame` update of topological junction solder dots on the graph.
 */
export function scheduleUpdateSolderDots(g: Graph): void {
  if (!g || g.disposed) return;
  if (solderDotsRafByGraph.has(g)) return;
  const rafId = requestAnimationFrame(() => {
    solderDotsRafByGraph.delete(g);
    if (g && !g.disposed) {
      updateSolderDots(g);
    }
  });
  solderDotsRafByGraph.set(g, rafId);
}

/**
 * Recomputes and synchronizes electrical/topological T-junction solder dot nodes across all edges
 * in the graph, excluding component port pin locations.
 */
export function updateSolderDots(g: Graph): void {
  if (!g || g.disposed) return;

  const edges = g.getEdges().filter((e: Edge) => e.id !== "__wire_tool_preview__");
  const existingDots = g.getNodes().filter((n: Node) => n.id.startsWith("solder_dot_"));
  const existingCrossings = g.getNodes().filter((n: Node) => n.id.startsWith("wire_crossing_"));

  if (!edges || edges.length === 0) {
    if (existingDots.length > 0 || existingCrossings.length > 0) {
      g.batchUpdate("solder-dots", () => {
        for (const dot of existingDots) g.removeCell(dot);
        for (const cross of existingCrossings) g.removeCell(cross);
      });
    }
    return;
  }

  const allPaths: EdgePath[] = [];
  const portPoints: { x: number; y: number }[] = [];

  for (const edge of edges) {
    const src = edge.getSource();
    const tgt = edge.getTarget();
    const sourceCell = edge.getSourceCell?.() ?? (src?.cell ? g.getCellById?.(src.cell) : null);
    const targetCell = edge.getTargetCell?.() ?? (tgt?.cell ? g.getCellById?.(tgt.cell) : null);
    const source = resolveNodePortWorldPoint(sourceCell, src?.port, edge.getSourcePoint());
    const target = resolveNodePortWorldPoint(targetCell, tgt?.port, edge.getTargetPoint());
    if (!source || !target) continue;

    // Collect port positions so solder dots are never placed on component pins
    if (src?.port) {
      portPoints.push(source);
    }
    if (tgt?.port) {
      portPoints.push(target);
    }

    const edgeView = edge.findView ? edge.findView(g) : null;
    const routePoints = edgeView?.routePoints;
    const vertices =
      routePoints && routePoints.length > 0
        ? routePoints.map((p: PointLike) => ({ x: p.x, y: p.y }))
        : edge.getVertices() || [];
    const points = [source, ...vertices, target];

    const stroke = edge.attr("line/stroke") as string | undefined;
    const color = stroke && stroke !== "none" ? stroke : "#1890ff";
    const sourceKey = src?.cell && src?.port ? `${src.cell}.${src.port}` : src?.cell ? String(src.cell) : undefined;
    const targetKey = tgt?.cell && tgt?.port ? `${tgt.cell}.${tgt.port}` : tgt?.cell ? String(tgt.cell) : undefined;
    allPaths.push({ id: edge.id, points, color, sourceKey, targetKey });
  }

  // Also collect port coordinates and bounding boxes from all component nodes in graph
  const componentBoxes: RectLike[] = [];
  for (const node of g.getNodes()) {
    if (isEphemeralDiagramNode(node.id)) continue;
    const bbox = getNodeBBox(node);
    if (bbox) {
      componentBoxes.push(bbox);
    }
    const ports = node.getPorts?.() || [];
    for (const p of ports) {
      const pt = resolveNodePortWorldPoint(node, p.id);
      if (pt) {
        portPoints.push(pt);
      }
    }
  }

  const opts = getOptionsForGraph(g);
  const isDark = opts?.isDark ?? true;
  const meta = getMetadataForGraph(g);
  const lang =
    (meta?.["language"] as string | undefined) ?? (opts as { language?: string } | null | undefined)?.language;
  const userCrossingPref = (meta?.["wireCrossingStyle"] as WireCrossingStyle | undefined) ?? opts?.wireCrossingStyle;
  const crossingStyle = resolveWireCrossingStyle(lang, userCrossingPref);

  const dots = computeSolderDots(allPaths, { cellSize: 40, tolerance: 3.0, portPoints, componentBoxes });
  const crossings =
    crossingStyle === "none" ? [] : computeWireCrossings(allPaths, dots, { portPoints, componentBoxes });
  const existingDotIds = new Set<string>(existingDots.map((n: Node) => n.id));
  const newDotIds = new Set<string>();
  const existingCrossingIds = new Set<string>(existingCrossings.map((n: Node) => n.id));
  const newCrossingIds = new Set<string>();

  const dotSize = 1.8;
  const radius = dotSize / 2;
  const crossingBg = isDark ? "#121214" : "#f8fafc";

  g.batchUpdate("solder-dots", () => {
    // Solder dots
    for (const dot of dots) {
      newDotIds.add(dot.id);
      const targetX = dot.x - radius;
      const targetY = dot.y - radius;

      const existing = g.getCellById(dot.id);
      if (existing && existing.isNode()) {
        const curPos = existing.getPosition();
        if (Math.abs(curPos.x - targetX) > 0.1 || Math.abs(curPos.y - targetY) > 0.1) {
          existing.setPosition(targetX, targetY);
        }
        if (existing.attr("body/fill") !== dot.color) {
          existing.attr("body/fill", dot.color);
        }
      } else {
        g.addNode(solderDotToDiagramNode(dot, dotSize) as unknown as Record<string, unknown>);
      }
    }

    for (const oldId of existingDotIds) {
      if (!newDotIds.has(oldId)) {
        const cell = g.getCellById(oldId);
        if (cell) g.removeCell(cell);
      }
    }

    // Wire crossing jumpovers / air-gaps
    const crossingSize = 6;
    const half = crossingSize / 2;
    for (const crossing of crossings) {
      newCrossingIds.add(crossing.id);
      const targetX = crossing.x - half;
      const targetY = crossing.y - half;

      const existing = g.getCellById(crossing.id);
      if (existing && existing.isNode()) {
        const curPos = existing.getPosition();
        if (Math.abs(curPos.x - targetX) > 0.1 || Math.abs(curPos.y - targetY) > 0.1) {
          existing.setPosition(targetX, targetY);
        }
        if (existing.attr("arc/stroke") !== crossing.color) {
          existing.attr("arc/stroke", crossing.color);
        }
        if (crossingStyle === "gap") {
          if (existing.attr("mask/fill") !== crossingBg) {
            existing.attr("mask/fill", crossingBg);
          }
        } else if (existing.attr("mask/stroke") !== crossingBg) {
          existing.attr("mask/stroke", crossingBg);
        }
        const curSize = existing.getSize();
        if (curSize.width !== crossingSize || curSize.height !== crossingSize) {
          existing.resize?.(crossingSize, crossingSize);
        }
      } else {
        g.addNode(
          wireCrossingToDiagramNode(crossing, isDark, {
            style: crossingStyle,
            size: crossingSize,
            strokeWidth: 1.0,
            bgColor: crossingBg,
          }) as unknown as Record<string, unknown>,
        );
      }
    }

    for (const oldId of existingCrossingIds) {
      if (!newCrossingIds.has(oldId)) {
        const cell = g.getCellById(oldId);
        if (cell) g.removeCell(cell);
      }
    }
  });

  if (typeof window !== "undefined") {
    (window as unknown as DiagramWindow).debugSolderDotsInfo =
      `Edges: ${edges.length}, Paths: ${allPaths.length}, Dots: ${dots.length}, Crossings: ${crossings.length}`;
  }
}
