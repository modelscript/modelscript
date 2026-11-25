// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeSmartAlignmentGuides,
  renderSmartGuidesSvgMarkup,
  type AlignableNode,
  type SmartGuideLine,
} from "./alignment.js";
import {
  computeParallelEdgeIndices,
  getConnectedEdges,
  rerouteEdgeOrthogonal,
  resolveNearestNodePortId,
  scheduleUpdateSolderDots,
} from "./canvas-edge-routing.js";
import { enqueueDiagramAction, getIsRenderingDiagram, getReadOnlyForGraph, toSchemaY } from "./canvas-state.js";
import type { CanvasInteractionFlags, Cell, Edge, EdgeTerminal, Graph, Node } from "./canvas-types.js";
import { isEphemeralDiagramNode } from "./drop-placeholder.js";
import {
  collectCommittedExistingWires,
  computeOrthogonalRoute,
  extractEdgePruneOptions,
  getNodeBBox,
  getPortOutwardNormal,
  healOrthogonalVertices,
  isContainerDiagramNode,
  pruneIntermediateVertices,
  regularizeOrthogonalPolyline,
  resolveNodePortWorldPoint,
  sideToNormal,
  simplifyCollinearPoints,
  translateConnectedEdgeStubs,
  type PointLike,
  type RectLike,
} from "./port-router.js";
import { updateNodeVisualOnResize } from "./selection-handles.js";

/**
 * Attaches diagram-to-code event listeners (node move/rotate/resize, edge connect/reconnect,
 * vertex editing, smart alignment guides overlay, and solder-dot lifecycle hooks).
 * Returns a cleanup callback invoked on diagram disposal.
 */
export function attachDiagramMutationHandlers(params: {
  graph: Graph;
  container: HTMLElement;
  flags: CanvasInteractionFlags;
  syncAlignmentToolbar: () => void;
}): () => void {
  const { graph: g, container, flags, syncAlignmentToolbar } = params;

  // Node move: debounced
  const changedNodes = new Set<string>();
  let moveTimeout: ReturnType<typeof setTimeout> | null = null;
  let justResized = false;

  g.on("node:moved", ({ node }: { node: Node }) => {
    if (getIsRenderingDiagram()) return;
    if (isEphemeralDiagramNode(node.id)) return;

    // Deselect edges when moving a node to avoid stale rubberbands
    const selected = g.getSelectedCells();
    if (selected) {
      selected.forEach((cell: Cell) => {
        if (cell.isEdge()) g.unselect(cell);
      });
    }

    changedNodes.add(node.id);

    if (moveTimeout) clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      if (justResized) {
        justResized = false;
        moveTimeout = null;
        changedNodes.clear();
        return;
      }

      const items: {
        id?: string | undefined;
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
        flipX?: boolean | undefined;
        flipY?: boolean | undefined;
        edges?: { source: string; target: string; points: { x: number; y: number }[] }[] | undefined;
        connectedOnly?: boolean | undefined;
      }[] = [];
      changedNodes.forEach((id) => {
        const n = g.getCellById(id);
        if (n && n.isNode()) {
          const p = n.getPosition();
          const s = n.getSize();
          const r = n.getAngle();
          const edges = getConnectedEdges(g, n);
          const curData = n.getData?.() || {};
          const name = (curData["name"] as string) || n.id;
          items.push({
            id: n.id,
            name,
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
            rotation: r,
            ...(typeof curData["flipX"] === "boolean" ? { flipX: curData["flipX"] } : {}),
            ...(typeof curData["flipY"] === "boolean" ? { flipY: curData["flipY"] } : {}),
            edges,
          });
        }
      });

      // Also collect positions for connected nodes that weren't moved,
      // so that missing Placement annotations can be added for them.
      const movedNames = new Set(changedNodes);
      const connectedNames = new Set<string>();
      for (const item of items) {
        if (item.edges) {
          for (const edge of item.edges) {
            const srcComp = edge.source.split(".")[0] ?? "";
            const tgtComp = edge.target.split(".")[0] ?? "";
            if (srcComp && !movedNames.has(srcComp)) connectedNames.add(srcComp);
            if (tgtComp && !movedNames.has(tgtComp)) connectedNames.add(tgtComp);
          }
        }
      }
      connectedNames.forEach((id) => {
        const n = g.getCellById(id);
        if (n && n.isNode()) {
          const p = n.getPosition();
          const s = n.getSize();
          const r = n.getAngle();
          const curData = n.getData?.() || {};
          const name = (curData["name"] as string) || n.id;
          items.push({
            name,
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
            rotation: r,
            ...(typeof curData["flipX"] === "boolean" ? { flipX: curData["flipX"] } : {}),
            ...(typeof curData["flipY"] === "boolean" ? { flipY: curData["flipY"] } : {}),
            connectedOnly: true,
          });
        }
      });

      if (items.length > 0) {
        enqueueDiagramAction({ type: "move", items }, g);
      }
      changedNodes.clear();
      moveTimeout = null;
    }, 5);
  });

  // Node rotated
  g.on("node:rotated", ({ node }: { node: Node }) => {
    if (getIsRenderingDiagram()) return;
    if (isEphemeralDiagramNode(node.id)) return;
    const p = node.getPosition();
    const s = node.getSize();
    const r = node.getAngle();
    syncAlignmentToolbar();

    const connectedEdges = g.getConnectedEdges(node);
    for (const edge of connectedEdges) {
      rerouteEdgeOrthogonal(edge, g, { skipEnqueue: true });
    }

    const edges = getConnectedEdges(g, node);
    const curData = node.getData?.() || {};
    const name = (curData["name"] as string) || node.id;
    enqueueDiagramAction(
      {
        type: "move",
        items: [
          {
            name,
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
            rotation: r,
            ...(typeof curData["flipX"] === "boolean" ? { flipX: curData["flipX"] } : {}),
            ...(typeof curData["flipY"] === "boolean" ? { flipY: curData["flipY"] } : {}),
            edges,
          },
        ],
      },
      g,
    );
    scheduleUpdateSolderDots(g);
  });

  // Node resized (we don't shrink/fit parents during drag to preserve Dagre layout spacings)
  g.on("node:resized", ({ node }: { node: Node }) => {
    if (getIsRenderingDiagram()) return;
    if (isEphemeralDiagramNode(node.id)) return;
    if (moveTimeout) {
      clearTimeout(moveTimeout);
      moveTimeout = null;
    }
    justResized = true;
    setTimeout(() => {
      justResized = false;
    }, 200);

    const p = node.getPosition();
    const s = node.getSize();
    const r = node.getAngle();
    updateNodeVisualOnResize(node, g, s.width, s.height);
    scheduleUpdateSolderDots(g);
    const edges = getConnectedEdges(g, node);
    const nodeName = (node.getData?.()?.["name"] as string) || node.id;
    enqueueDiagramAction(
      {
        type: "resize",
        item: {
          name: nodeName,
          x: p.x,
          y: p.y,
          width: s.width,
          height: s.height,
          rotation: r,
          edges,
        },
      },
      g,
    );
  });

  // Cache prior endpoints on edge mousedown, selection, or hover
  const edgePriorEndpoints = new Map<string, { source: EdgeTerminal; target: EdgeTerminal }>();
  g.on("edge:mouseenter", ({ edge }: { edge: Edge }) => {
    if (edge?.id) edgePriorEndpoints.set(edge.id, { source: edge.getSource(), target: edge.getTarget() });
  });
  g.on("edge:selected", ({ edge }: { edge: Edge }) => {
    if (edge?.id) edgePriorEndpoints.set(edge.id, { source: edge.getSource(), target: edge.getTarget() });
  });

  // Edge connected (handles both new edge creation and terminal dragging reconnection)
  g.on("edge:connected", ({ isNew, edge }: { isNew?: boolean | undefined; edge: Edge }) => {
    if (getIsRenderingDiagram()) return;

    const source = edge.getSource();
    const target = edge.getTarget();
    if (!source?.cell || !target?.cell) {
      if (isNew) g.removeCell(edge);
      return;
    }

    const sourceCell = g.getCellById(source.cell);
    const targetCell = g.getCellById(target.cell);

    let sourcePortId = source.port;
    let targetPortId = target.port;

    // If a connection landed on a port-bearing node without a port ID, snap to its nearest port
    if (sourcePortId === undefined && sourceCell?.isNode()) {
      const snappedSrcPort = resolveNearestNodePortId(sourceCell, edge.getSourcePoint());
      if (snappedSrcPort !== undefined) {
        sourcePortId = snappedSrcPort;
        edge.setSource({ cell: source.cell, port: sourcePortId });
      }
    }
    if (targetPortId === undefined && targetCell?.isNode()) {
      const snappedTgtPort = resolveNearestNodePortId(targetCell, edge.getTargetPoint());
      if (snappedTgtPort !== undefined) {
        targetPortId = snappedTgtPort;
        edge.setTarget({ cell: target.cell, port: targetPortId });
      }
    }

    // Resolve source identifier (port or tapped edge net)
    let srcStr = "";
    if (sourceCell?.isEdge()) {
      const edgeSrc = sourceCell.getSource();
      const edgeTgt = sourceCell.getTarget();
      srcStr = edgeSrc?.port
        ? `${edgeSrc.cell}.${edgeSrc.port}`
        : edgeTgt?.port
          ? `${edgeTgt.cell}.${edgeTgt.port}`
          : String(edgeSrc?.cell ?? "");
    } else if (sourcePortId !== undefined) {
      srcStr = `${source.cell}.${sourcePortId}`;
    } else {
      srcStr = String(source.cell);
    }

    // Resolve target identifier (port or tapped edge net)
    let tgtStr = "";
    if (targetCell?.isEdge()) {
      const edgeSrc = targetCell.getSource();
      const edgeTgt = targetCell.getTarget();
      tgtStr = edgeSrc?.port
        ? `${edgeSrc.cell}.${edgeSrc.port}`
        : edgeTgt?.port
          ? `${edgeTgt.cell}.${edgeTgt.port}`
          : String(edgeSrc?.cell ?? "");
    } else if (targetPortId !== undefined) {
      tgtStr = `${target.cell}.${targetPortId}`;
    } else {
      tgtStr = String(target.cell);
    }

    if (!srcStr || !tgtStr || srcStr === tgtStr) {
      if (isNew) g.removeCell(edge);
      return;
    }

    const vertices = edge.getVertices() || [];
    const sourcePoint =
      (sourceCell?.isNode() ? resolveNodePortWorldPoint(sourceCell, sourcePortId) : null) ?? edge.getSourcePoint();
    const targetPoint =
      (targetCell?.isNode() ? resolveNodePortWorldPoint(targetCell, targetPortId) : null) ?? edge.getTargetPoint();

    const sourceSide = sourceCell?.isNode()
      ? getPortOutwardNormal(sourceCell, sourcePortId, sourcePoint)?.side
      : undefined;
    const targetSide = targetCell?.isNode()
      ? getPortOutwardNormal(targetCell, targetPortId, targetPoint)?.side
      : undefined;
    const sourceBox = sourceCell?.isNode() ? (getNodeBBox(sourceCell) ?? undefined) : undefined;
    const targetBox = targetCell?.isNode() ? (getNodeBBox(targetCell) ?? undefined) : undefined;

    let intermediateVertices = vertices;
    if (vertices.length === 0 && sourcePoint && targetPoint) {
      const obstacles: RectLike[] = [];
      for (const node of g.getNodes()) {
        if (node.id === source.cell || node.id === target.cell) continue;
        if (
          isEphemeralDiagramNode(node.id) ||
          node.id.startsWith("comp_") ||
          node.id.startsWith("__diagram_group_") ||
          isContainerDiagramNode(node)
        ) {
          continue;
        }
        const bbox = typeof node.getBBox === "function" ? node.getBBox() : null;
        if (bbox) {
          obstacles.push({
            x: bbox.x,
            y: bbox.y,
            width: bbox.width,
            height: bbox.height,
          });
        }
      }
      const { parallelIndex, parallelCount } = computeParallelEdgeIndices(
        g,
        edge,
        String(source.cell),
        String(target.cell),
      );

      const existingWires = collectCommittedExistingWires(g, edge.id);

      const directRoute = computeOrthogonalRoute(sourcePoint, targetPoint, obstacles, {
        sourceSide,
        targetSide,
        sourceBox,
        targetBox,
        parallelIndex,
        parallelCount,
        existingWires,
      });

      const edgeView = g.findViewByCell(edge);
      const viewRoute =
        edgeView?.routePoints && edgeView.routePoints.length > 0
          ? pruneIntermediateVertices(
              sourcePoint,
              targetPoint,
              healOrthogonalVertices(sourcePoint, targetPoint, edgeView.routePoints),
              {
                obstacles,
                sourceNormal: sourceSide ? sideToNormal(sourceSide) : null,
                targetNormal: targetSide ? sideToNormal(targetSide) : null,
                sourceBox: sourceBox ?? null,
                targetBox: targetBox ?? null,
              },
            )
          : [];

      // If viewRoute has strictly fewer bends than directRoute, use viewRoute; otherwise use directRoute
      if (viewRoute.length > 0 && viewRoute.length < directRoute.length) {
        intermediateVertices = viewRoute;
      } else {
        intermediateVertices = directRoute;
      }
    } else if (vertices.length > 0 && sourcePoint && targetPoint) {
      const pruneOpts = extractEdgePruneOptions(g as never, edge as never, sourcePoint, targetPoint);
      intermediateVertices = pruneIntermediateVertices(
        sourcePoint,
        targetPoint,
        healOrthogonalVertices(sourcePoint, targetPoint, vertices),
        pruneOpts,
      );
    }

    const edgePruneOpts =
      sourcePoint && targetPoint ? extractEdgePruneOptions(g as never, edge as never, sourcePoint, targetPoint) : {};
    const simplifiedVertices =
      sourcePoint && targetPoint
        ? pruneIntermediateVertices(
            sourcePoint,
            targetPoint,
            healOrthogonalVertices(sourcePoint, targetPoint, simplifyCollinearPoints(intermediateVertices, 0.05)),
            edgePruneOpts,
          )
        : simplifyCollinearPoints(intermediateVertices, 0.05);

    if (typeof edge.setVertices === "function") {
      edge.setVertices(simplifiedVertices, { ignoreSnap: true });
    }
    // Commit this edge's geometry so subsequent connections on other ports never dynamically reroute it
    edge.removeRouter?.();

    const roundedSrc = { x: Math.round(sourcePoint.x), y: toSchemaY(g, sourcePoint.y) };
    const roundedTgt = { x: Math.round(targetPoint.x), y: toSchemaY(g, targetPoint.y) };
    const roundedHealed = healOrthogonalVertices(
      roundedSrc,
      roundedTgt,
      simplifiedVertices.map((p: { x: number; y: number }) => ({
        x: Math.round(p.x),
        y: toSchemaY(g, p.y),
      })),
    );
    const points = simplifyCollinearPoints([roundedSrc, ...roundedHealed, roundedTgt], 0.05);

    if (isNew) {
      enqueueDiagramAction(
        {
          type: "connect",
          source: srcStr,
          target: tgtStr,
          points,
        },
        g,
      );
    } else {
      const prev = edgePriorEndpoints.get(edge.id);
      const oldSrcStr = prev?.source?.port
        ? `${prev.source.cell}.${prev.source.port}`
        : String(prev?.source?.cell ?? srcStr);
      const oldTgtStr = prev?.target?.port
        ? `${prev.target.cell}.${prev.target.port}`
        : String(prev?.target?.cell ?? tgtStr);

      enqueueDiagramAction(
        {
          type: "reconnect",
          edgeId: edge.id,
          oldSource: oldSrcStr,
          oldTarget: oldTgtStr,
          newSource: srcStr,
          newTarget: tgtStr,
          oldSourcePort: prev?.source?.port,
          oldTargetPort: prev?.target?.port,
          newSourcePort: sourcePortId,
          newTargetPort: targetPortId,
          points,
        },
        g,
      );
    }
  });

  // Edge vertices changed: per-edge debounced with orthogonal regularization and collinear pruning
  const edgeUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();
  g.on(
    "edge:change:vertices",
    ({
      edge,
      options,
    }: {
      edge: Edge;
      options?: { ignoreSnap?: boolean | undefined; ui?: boolean | undefined; toolId?: string | undefined } | undefined;
    }) => {
      if (getIsRenderingDiagram() || options?.ignoreSnap || g.disposed) return;

      const isUserInteracting = Boolean(options?.ui || options?.toolId);

      // Do NOT mutate vertices synchronously while the user is actively interacting with the vertex tool.
      if (!isUserInteracting) {
        const vertices = edge.getVertices() || [];
        const sourcePoint = edge.getSourcePoint();
        const targetPoint = edge.getTargetPoint();
        if (vertices.length > 0 && sourcePoint && targetPoint) {
          const fullPolyline = [sourcePoint, ...vertices, targetPoint];
          const regularized = regularizeOrthogonalPolyline(fullPolyline, 6, 1.5);
          const newVertices = healOrthogonalVertices(sourcePoint, targetPoint, regularized.slice(1, -1));

          const changed =
            newVertices.length !== vertices.length ||
            newVertices.some(
              (nv: PointLike, idx: number) =>
                Math.abs(nv.x - (vertices[idx]?.x ?? 0)) > 0.5 || Math.abs(nv.y - (vertices[idx]?.y ?? 0)) > 0.5,
            );

          if (changed) {
            edge.setVertices(newVertices, { ignoreSnap: true });
          }
        }
      }

      const prevTimer = edgeUpdateTimers.get(edge.id);
      if (prevTimer) clearTimeout(prevTimer);
      const timer = setTimeout(() => {
        edgeUpdateTimers.delete(edge.id);
        if (g.disposed || !g.getCellById(edge.id)) return;
        const source = edge.getSource();
        const target = edge.getTarget();
        const wireId = edge.getData()?.wireId;
        if ((source?.cell && target?.cell) || wireId) {
          const curVertices = edge.getVertices() || [];
          const srcPt = edge.getSourcePoint();
          const tgtPt = edge.getTargetPoint();

          if (curVertices.length > 0 && srcPt && tgtPt) {
            const fullPolyline = [srcPt, ...curVertices, tgtPt];
            const regularized = regularizeOrthogonalPolyline(fullPolyline, 6, 1.5);
            const healed = healOrthogonalVertices(srcPt, tgtPt, regularized.slice(1, -1));
            const pruneOpts = extractEdgePruneOptions(g as never, edge as never, srcPt, tgtPt);
            const pruned = pruneIntermediateVertices(srcPt, tgtPt, healed, pruneOpts);
            const changed =
              pruned.length !== curVertices.length ||
              pruned.some(
                (nv: PointLike, idx: number) =>
                  Math.abs(nv.x - (curVertices[idx]?.x ?? 0)) > 0.5 ||
                  Math.abs(nv.y - (curVertices[idx]?.y ?? 0)) > 0.5,
              );
            if (changed) {
              edge.setVertices(pruned, { ignoreSnap: true });
            }
          }

          const finalVertices = edge.getVertices() || [];
          const finalSrcPt = edge.getSourcePoint();
          const finalTgtPt = edge.getTargetPoint();
          const roundedSrc = { x: Math.round(finalSrcPt.x), y: toSchemaY(g, finalSrcPt.y) };
          const roundedTgt = { x: Math.round(finalTgtPt.x), y: toSchemaY(g, finalTgtPt.y) };
          const roundedHealed = healOrthogonalVertices(
            roundedSrc,
            roundedTgt,
            finalVertices.map((p: PointLike) => ({
              x: Math.round(p.x),
              y: toSchemaY(g, p.y),
            })),
          );
          const points = simplifyCollinearPoints([roundedSrc, ...roundedHealed, roundedTgt], 0.05);
          const srcStr = source?.cell
            ? source.port
              ? `${source.cell}.${source.port}`
              : String(source.cell)
            : String(wireId || edge.id);
          const tgtStr = target?.cell
            ? target.port
              ? `${target.cell}.${target.port}`
              : String(target.cell)
            : String(wireId || edge.id);
          enqueueDiagramAction(
            {
              type: "moveEdge",
              edges: [
                {
                  id: edge.id,
                  source: srcStr,
                  target: tgtStr,
                  points,
                },
              ],
            },
            g,
          );
        }
      }, 500);
      edgeUpdateTimers.set(edge.id, timer);
    },
  );

  // ── Smart Alignment Guides & Port-Aligned Drag Session ──
  let smartGuidesOverlayEl: SVGSVGElement | null = null;
  let activeDragSession: {
    nodeId: string;
    startX: number;
    startY: number;
    edgeVertices: Map<string, PointLike[]>;
  } | null = null;

  const ensureSmartGuidesOverlay = (): SVGSVGElement | null => {
    if (typeof document === "undefined" || !container) return null;
    if (smartGuidesOverlayEl && container.contains(smartGuidesOverlayEl)) {
      return smartGuidesOverlayEl;
    }
    const existing = container.querySelector("#modelscript-smart-guides-overlay") as SVGSVGElement | null;
    if (existing) {
      smartGuidesOverlayEl = existing;
      return existing;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "modelscript-smart-guides-overlay";
    svg.setAttribute("class", "modelscript-smart-guides-overlay");
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = "none";
    svg.style.zIndex = "950";
    svg.style.overflow = "visible";
    container.appendChild(svg);
    smartGuidesOverlayEl = svg;
    return svg;
  };

  const clearAlignmentGuides = () => {
    if (smartGuidesOverlayEl) {
      smartGuidesOverlayEl.innerHTML = "";
    }
    const gx = g.getCellById?.("__alignment_guide_x__");
    if (gx) g.removeCell?.(gx);
    const gy = g.getCellById?.("__alignment_guide_y__");
    if (gy) g.removeCell?.(gy);
  };

  const renderSmartAlignmentGuidesOverlay = (guideX: SmartGuideLine | null, guideY: SmartGuideLine | null) => {
    if (!guideX && !guideY) {
      clearAlignmentGuides();
      return;
    }
    const svg = ensureSmartGuidesOverlay();
    if (!svg) return;
    const sc = typeof g.scale === "function" ? g.scale() : { sx: 1, sy: 1 };
    const tr = typeof g.translate === "function" ? g.translate() : { tx: 0, ty: 0 };
    svg.innerHTML = renderSmartGuidesSvgMarkup(guideX, guideY, sc, tr);
  };

  g.on("node:mousedown", ({ node }: { node?: Node | null | undefined }) => {
    if (!node || !node.isNode() || isEphemeralDiagramNode(node.id)) return;
    const pos = node.getPosition();
    const edgeVertices = new Map<string, PointLike[]>();
    const connected = g.getConnectedEdges?.(node) || [];
    for (const edge of connected) {
      const verts = edge.getVertices?.() || [];
      edgeVertices.set(
        edge.id,
        verts.map((v: PointLike) => ({ x: v.x, y: v.y })),
      );
    }
    activeDragSession = {
      nodeId: node.id,
      startX: pos.x,
      startY: pos.y,
      edgeVertices,
    };
  });

  // Synchronize topological solder dots across graph lifecycle and interactive edits
  g.on(
    "node:change:position",
    ({
      cell,
      current,
      previous,
    }: {
      cell?: Cell | null | undefined;
      current?: PointLike | null | undefined;
      previous?: PointLike | null | undefined;
    }) => {
      if (!getIsRenderingDiagram() && !flags.isSnappingPortAlignment && cell && cell.isNode() && current && previous) {
        if (!isEphemeralDiagramNode(cell.id)) {
          let snapDx = 0;
          let snapDy = 0;
          let guideX: SmartGuideLine | null = null;
          let guideY: SmartGuideLine | null = null;
          const snapThreshold = 4;

          if (!flags.isAltPressed) {
            const connectedPorts: { myPt: { x: number; y: number }; peerPt: { x: number; y: number } }[] = [];
            const connected = g.getConnectedEdges?.(cell) || [];
            for (const edge of connected) {
              const src = edge.getSource?.();
              const tgt = edge.getTarget?.();
              const isSrc = src?.cell === cell.id;
              const myPortId = isSrc ? src?.port : tgt?.port;
              const peerCellId = isSrc ? tgt?.cell : src?.cell;
              const peerPortId = isSrc ? tgt?.port : src?.port;
              const peerNode = peerCellId ? g.getCellById?.(peerCellId) : null;
              if (!myPortId || !peerNode || !peerPortId) continue;

              const myPt = resolveNodePortWorldPoint(cell, myPortId);
              const peerPt = resolveNodePortWorldPoint(peerNode, peerPortId);
              if (!myPt || !peerPt) continue;
              connectedPorts.push({ myPt, peerPt });
            }

            const mySize = cell.getSize?.() || { width: 20, height: 20 };
            const draggedAlignable: AlignableNode = {
              id: cell.id,
              x: current.x,
              y: current.y,
              width: mySize.width,
              height: mySize.height,
            };

            const peerNodes: AlignableNode[] = [];
            for (const n of g.getNodes?.() || []) {
              if (!n || n.id === cell.id || isEphemeralDiagramNode(n.id)) continue;
              const p = n.getPosition?.();
              const s = n.getSize?.();
              if (p && s && s.width > 0 && s.height > 0) {
                peerNodes.push({ id: n.id, x: p.x, y: p.y, width: s.width, height: s.height });
              }
            }

            const alignRes = computeSmartAlignmentGuides(draggedAlignable, connectedPorts, peerNodes, snapThreshold);
            snapDx = alignRes.snapDx;
            snapDy = alignRes.snapDy;
            guideX = alignRes.guideX;
            guideY = alignRes.guideY;
          }

          if (Math.abs(snapDx) > 0.01 || Math.abs(snapDy) > 0.01) {
            flags.isSnappingPortAlignment = true;
            cell.setPosition?.(current.x + snapDx, current.y + snapDy);
            flags.isSnappingPortAlignment = false;
          }

          renderSmartAlignmentGuidesOverlay(guideX, guideY);

          if (activeDragSession && activeDragSession.nodeId === cell.id) {
            const connected = g.getConnectedEdges?.(cell) || [];
            for (const edge of connected) {
              const initVerts = activeDragSession.edgeVertices.get(edge.id);
              if (initVerts) {
                edge.setVertices?.(
                  initVerts.map((v: PointLike) => ({ x: v.x, y: v.y })),
                  { ignoreSnap: true },
                );
              }
            }
            const totalDx = current.x + snapDx - activeDragSession.startX;
            const totalDy = current.y + snapDy - activeDragSession.startY;
            translateConnectedEdgeStubs(g, cell, totalDx, totalDy, { forceReroute: flags.isAltPressed });
          } else {
            const effectiveDx = current.x + snapDx - previous.x;
            const effectiveDy = current.y + snapDy - previous.y;
            translateConnectedEdgeStubs(g, cell, effectiveDx, effectiveDy, { forceReroute: flags.isAltPressed });
          }
        }
      }
      scheduleUpdateSolderDots(g);
    },
  );
  g.on("node:moved", () => {
    activeDragSession = null;
    clearAlignmentGuides();
    scheduleUpdateSolderDots(g);
  });
  g.on("node:mouseup", () => {
    activeDragSession = null;
    clearAlignmentGuides();
  });
  g.on("blank:mouseup", () => {
    activeDragSession = null;
    clearAlignmentGuides();
  });
  g.on("node:resized", () => scheduleUpdateSolderDots(g));
  g.on("edge:change:vertices", () => scheduleUpdateSolderDots(g));
  g.on("edge:change:source", () => scheduleUpdateSolderDots(g));
  g.on("edge:change:target", () => scheduleUpdateSolderDots(g));
  g.on("edge:connected", () => scheduleUpdateSolderDots(g));
  g.on("edge:added", () => scheduleUpdateSolderDots(g));
  g.on("edge:remove-requested", ({ edge }: { edge?: Edge | null | undefined }) => {
    if (getIsRenderingDiagram() || getReadOnlyForGraph(g) || !edge || !edge.isEdge()) return;
    const src = edge.getSource() as { cell?: string; port?: string } | undefined;
    const tgt = edge.getTarget() as { cell?: string; port?: string } | undefined;
    if (src?.cell && tgt?.cell) {
      const source = src.port ? `${src.cell}.${src.port}` : src.cell;
      const target = tgt.port ? `${tgt.cell}.${tgt.port}` : tgt.cell;
      enqueueDiagramAction({ type: "disconnect", source, target }, g);
    }
    scheduleUpdateSolderDots(g);
  });
  g.on("edge:removed", () => scheduleUpdateSolderDots(g));

  // Quick re-route orthogonal on edge double-click
  g.on("edge:dblclick", ({ edge }: { edge: Edge }) => {
    if (edge && edge.isEdge()) {
      rerouteEdgeOrthogonal(edge, g);
    }
  });

  return () => {
    for (const t of edgeUpdateTimers.values()) clearTimeout(t);
    edgeUpdateTimers.clear();
    if (moveTimeout) {
      clearTimeout(moveTimeout);
      moveTimeout = null;
    }
    if (smartGuidesOverlayEl?.parentNode) {
      smartGuidesOverlayEl.parentNode.removeChild(smartGuidesOverlayEl);
    }
  };
}
