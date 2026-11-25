// SPDX-License-Identifier: AGPL-3.0-or-later

import { rerouteEdgeOrthogonal, resolveNearestNodePortId } from "./canvas-edge-routing.js";
import { enqueueDiagramAction, getCurrentOptions, toSchemaY } from "./canvas-state.js";
import type { Cell, DiagramWindow, Edge, Graph, Node, PlacementData } from "./canvas-types.js";
import {
  clearActiveDropPlaceholder,
  dropComponentGhost,
  ensureDiagramStyles,
  getTypicalNodeSize,
  isEphemeralDiagramNode,
} from "./drop-placeholder.js";
import {
  collectCommittedExistingWires,
  computeOrthogonalRoute,
  getNodeBBox,
  getPortOutwardNormal,
  healOrthogonalVertices,
  isContainerDiagramNode,
  resolveNodePortWorldPoint,
  simplifyCollinearPoints,
  type PointLike,
  type RectLike,
} from "./port-router.js";

export interface PlacementAndWireController {
  isPlacementActive: () => boolean;
  isWireToolActive: () => boolean;
  cancelWireToolInProgress: () => void;
  setWireToolState: (active?: boolean) => boolean;
  clearPlacement: () => void;
  dispose: () => void;
}

/**
 * Attaches drag-and-drop component placement ghost handling, universal point-by-point
 * wire routing mode (`W` key), Escape cancellation, and the `window.__*` webview bridge.
 */
export function attachPlacementAndWireTools(params: {
  graph: Graph;
  isDark: boolean;
  startInlineNodeEdit: (node: Node) => void;
}): PlacementAndWireController {
  const { graph: g, isDark, startInlineNodeEdit } = params;

  // ── Placement Mode (Drag and Drop in VS Code) ──
  let placementData: PlacementData | null = null;
  let placementGhost: Node | null = null;
  let isPointerOverCanvas = false;
  let lastCanvasPos: { x: number; y: number } | null = null;

  const startPlacement = (data: PlacementData) => {
    ensureDiagramStyles();
    placementData = data;
    isPointerOverCanvas = false;
    lastCanvasPos = null;
    if (placementGhost) {
      placementGhost.remove();
      placementGhost = null;
    }
    // Note: Do NOT add a ghost at the center of the diagram.
    // The ghost will appear directly under the cursor when the pointer enters the canvas.
  };

  const createPlacementGhost = (x: number, y: number) => {
    if (!placementData) return;
    const strokeColor = isDark ? "#cccccc" : "#333333";
    const fillColor = isDark ? "rgba(204, 204, 204, 0.15)" : "rgba(51, 51, 51, 0.08)";
    const { width, height } = getTypicalNodeSize(g);

    if (placementData.iconSvg) {
      placementGhost = g.addNode({
        id: "placement-ghost",
        shape: "image",
        x: x - width / 2,
        y: y - height / 2,
        width,
        height,
        zIndex: 9999,
        imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(placementData.iconSvg)}`,
        attrs: {
          image: {
            preserveAspectRatio: "xMidYMid meet",
            style: "pointer-events: none; opacity: 0.88; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3));",
          },
        },
      });
    } else {
      placementGhost = g.addNode({
        id: "placement-ghost",
        shape: "rect",
        x: x - width / 2,
        y: y - height / 2,
        width,
        height,
        attrs: {
          body: {
            fill: fillColor,
            stroke: strokeColor,
            strokeDasharray: "4 2",
            strokeWidth: 2,
            rx: 6,
            ry: 6,
            opacity: 0.88,
            pointerEvents: "none",
          },
          text: {
            text: placementData.className.split(".").pop(),
            fill: strokeColor,
            pointerEvents: "none",
            fontSize: 10,
            fontWeight: "600",
          },
        },
      });
    }
  };

  const clearPlacement = () => {
    if (placementGhost) {
      placementGhost.remove();
      placementGhost = null;
    }
    placementData = null;
    isPointerOverCanvas = false;
    lastCanvasPos = null;
  };

  let lastPlacementTimestamp = 0;
  const handlePlacementClick = (x: number, y: number) => {
    const now = Date.now();
    if (now - lastPlacementTimestamp < 350) return;
    if (placementData) {
      lastPlacementTimestamp = now;
      const dataToPlace = placementData;
      clearPlacement();
      const snappedX = Math.round(x / 20) * 20;
      const snappedY = Math.round(y / 20) * 20;
      const { width, height } = getTypicalNodeSize(g);
      // Trigger the bounce animation placeholder while the action is processed
      dropComponentGhost(g, snappedX, snappedY, dataToPlace.className, dataToPlace.iconSvg, isDark, width, height);
      enqueueDiagramAction({ type: "addComponent", className: dataToPlace.className, x: snappedX, y: snappedY }, g);
    }
  };

  const win = typeof window !== "undefined" ? (window as unknown as DiagramWindow) : null;

  // ── Universal Point-by-Point Wire Tool (W key) ──
  let wireToolActive = false;
  let activeWireState: {
    sourceCell: Cell;
    sourcePortId?: string | undefined;
    sourcePoint: { x: number; y: number };
    waypoints: { x: number; y: number }[];
    previewEdge?: Edge | null;
  } | null = null;

  const cancelWireToolInProgress = () => {
    if (activeWireState?.previewEdge) {
      try {
        g.removeCell(activeWireState.previewEdge);
      } catch {
        // Ignored
      }
    }
    activeWireState = null;
  };

  const setWireToolState = (active?: boolean): boolean => {
    wireToolActive = active !== undefined ? active : !wireToolActive;
    if (!wireToolActive) {
      cancelWireToolInProgress();
      const container = g.container;
      if (container) container.style.cursor = "default";
    } else {
      const container = g.container;
      if (container) container.style.cursor = "crosshair";
    }
    return wireToolActive;
  };

  const handlePointerMove = (x: number, y: number, e?: { buttons?: number | undefined }) => {
    isPointerOverCanvas = true;
    lastCanvasPos = { x, y };
    if (win) win.__lastCanvasPos = { x, y };
    if (placementData) {
      // If the user was dragging from the library tree and released the mouse button,
      // subsequent pointer movement occurs with buttons === 0. Place immediately!
      const winEvent = win?.event as { buttons?: number | undefined } | undefined;
      const btns =
        e && typeof e.buttons === "number"
          ? e.buttons
          : winEvent && typeof winEvent.buttons === "number"
            ? winEvent.buttons
            : undefined;
      if (placementData.isDrag && btns === 0) {
        handlePlacementClick(x, y);
        return;
      }
      if (!placementGhost) {
        createPlacementGhost(x, y);
      } else {
        const size = placementGhost.getSize?.() || getTypicalNodeSize(g);
        placementGhost.position(x - size.width / 2, y - size.height / 2);
      }
    }
    if (wireToolActive && activeWireState?.previewEdge) {
      const raster = getCurrentOptions()?.snapGrid ?? 20;
      const snappedX = Math.round(x / raster) * raster;
      const snappedY = Math.round(y / raster) * raster;
      activeWireState.previewEdge.setTarget({ x: snappedX, y: snappedY });
    }
  };

  const handlePointerUpOrDrop = (x: number, y: number) => {
    if (placementData) {
      handlePlacementClick(x, y);
    }
  };

  const handleDragEnd = () => {
    if (placementData) {
      if (isPointerOverCanvas && lastCanvasPos) {
        handlePlacementClick(lastCanvasPos.x, lastCanvasPos.y);
      } else {
        clearPlacement();
      }
    }
  };

  g.on("blank:pointermove", ({ x, y, e }: { x: number; y: number; e?: { buttons?: number | undefined } | undefined }) =>
    handlePointerMove(x, y, e),
  );
  g.on("cell:pointermove", ({ x, y, e }: { x: number; y: number; e?: { buttons?: number | undefined } | undefined }) =>
    handlePointerMove(x, y, e),
  );
  g.on("blank:pointerup", ({ x, y }: { x: number; y: number }) => handlePointerUpOrDrop(x, y));
  g.on("cell:pointerup", ({ x, y }: { x: number; y: number }) => handlePointerUpOrDrop(x, y));
  g.on("blank:mouseleave", () => {
    isPointerOverCanvas = false;
  });

  g.on("blank:click", ({ x, y }: { x: number; y: number }) => {
    if (placementData) {
      handlePlacementClick(x, y);
      return;
    }
    if (wireToolActive && activeWireState) {
      const raster = getCurrentOptions()?.snapGrid ?? 20;
      const snappedX = Math.round(x / raster) * raster;
      const snappedY = Math.round(y / raster) * raster;
      activeWireState.waypoints.push({ x: snappedX, y: snappedY });
      if (activeWireState.previewEdge && typeof activeWireState.previewEdge.setVertices === "function") {
        activeWireState.previewEdge.setVertices([...activeWireState.waypoints]);
      }
    }
  });

  g.on("cell:click", ({ cell, x, y }: { cell: Cell; x: number; y: number }) => {
    if (placementData) {
      handlePlacementClick(x, y);
      return;
    }
    if (wireToolActive && cell.isNode()) {
      const portId = resolveNearestNodePortId(cell, { x, y });
      const portPoint = (portId !== undefined ? resolveNodePortWorldPoint(cell, portId) : null) ?? { x, y };

      if (!activeWireState) {
        // Start wire from this node/port
        const previewEdge = g.createEdge({
          id: "__wire_tool_preview__",
          zIndex: 10000,
          source: portId !== undefined ? { cell: cell.id, port: portId } : { cell: cell.id },
          target: { x: portPoint.x, y: portPoint.y },
          router: { name: "port-orthogonal-astar" },
          connector: { name: "rounded", args: { radius: 4 } },
          attrs: {
            line: {
              stroke: isDark ? "#569cd6" : "#005fb8",
              strokeDasharray: "4 2",
              strokeWidth: 2,
              targetMarker: null,
              "pointer-events": "none",
            },
          },
        });
        activeWireState = {
          sourceCell: cell,
          sourcePortId: portId,
          sourcePoint: portPoint,
          waypoints: [],
          previewEdge,
        };
        g.addEdge(previewEdge);
      } else {
        // Target node clicked: finish wire
        if (activeWireState.sourceCell.id === cell.id && activeWireState.sourcePortId === portId) {
          // Clicked start port; skip
          return;
        }
        const srcStr =
          activeWireState.sourcePortId !== undefined
            ? `${activeWireState.sourceCell.id}.${activeWireState.sourcePortId}`
            : activeWireState.sourceCell.id;
        const tgtStr = portId !== undefined ? `${cell.id}.${portId}` : cell.id;

        const wireSrcPt = activeWireState.sourcePoint;
        const wireTgtPt = portPoint;
        const wireSourceSide = getPortOutwardNormal(
          activeWireState.sourceCell,
          activeWireState.sourcePortId,
          wireSrcPt,
        )?.side;
        const wireTargetSide = getPortOutwardNormal(cell, portId, wireTgtPt)?.side;
        const wireSourceBox = getNodeBBox(activeWireState.sourceCell) ?? undefined;
        const wireTargetBox = getNodeBBox(cell) ?? undefined;

        let screenWaypoints: PointLike[] = [];
        if (activeWireState.waypoints.length === 0) {
          const obstacles: RectLike[] = [];
          for (const node of g.getNodes()) {
            if (node.id === activeWireState.sourceCell.id || node.id === cell.id) continue;
            if (
              isEphemeralDiagramNode(node.id) ||
              node.id.startsWith("comp_") ||
              node.id.startsWith("__diagram_group_") ||
              isContainerDiagramNode(node)
            ) {
              continue;
            }
            const bbox = getNodeBBox(node);
            if (bbox) obstacles.push(bbox);
          }
          const existingWires = collectCommittedExistingWires(g, null);
          screenWaypoints = computeOrthogonalRoute(wireSrcPt, wireTgtPt, obstacles, {
            sourceSide: wireSourceSide,
            targetSide: wireTargetSide,
            sourceBox: wireSourceBox,
            targetBox: wireTargetBox,
            existingWires,
          });
        } else {
          screenWaypoints = healOrthogonalVertices(wireSrcPt, wireTgtPt, activeWireState.waypoints);
        }

        const roundedSrc = {
          x: Math.round(wireSrcPt.x),
          y: toSchemaY(g, wireSrcPt.y),
        };
        const roundedTgt = {
          x: Math.round(wireTgtPt.x),
          y: toSchemaY(g, wireTgtPt.y),
        };
        const roundedHealed = healOrthogonalVertices(
          roundedSrc,
          roundedTgt,
          screenWaypoints.map((w) => ({
            x: Math.round(w.x),
            y: toSchemaY(g, w.y),
          })),
        );
        const points = simplifyCollinearPoints([roundedSrc, ...roundedHealed, roundedTgt], 0.05);

        cancelWireToolInProgress();

        enqueueDiagramAction(
          {
            type: "connect",
            source: srcStr,
            target: tgtStr,
            points,
          },
          g,
        );
      }
    }
  });

  const onWindowEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (activeWireState) {
        cancelWireToolInProgress();
        return;
      }
      if (wireToolActive) {
        setWireToolState(false);
        return;
      }
      clearPlacement();
      clearActiveDropPlaceholder();
      const existingPlaceholder = g.getCellById?.("__drop_placeholder__");
      if (existingPlaceholder) {
        g.removeCell?.(existingPlaceholder);
      }
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onWindowEscape);
  }

  // Expose for webview to invoke
  if (win) {
    win.__startPlacement = startPlacement;
    win.__movePlacementGhost = handlePointerMove;
    win.__hidePlacementGhost = () => {
      if (placementGhost) {
        placementGhost.remove();
        placementGhost = null;
      }
    };
    win.__clearPlacement = clearPlacement;
    win.__handlePlacementClick = handlePlacementClick;
    win.__handleDragEnd = handleDragEnd;
    win.__setPointerOverCanvas = (over: boolean, pos?: { x: number; y: number }) => {
      isPointerOverCanvas = over;
      if (pos) lastCanvasPos = pos;
    };
    win.__getPlacementData = () => placementData;
    win.__rerouteEdgeOrthogonal = (edgeId: string) => {
      const edge = g.getCellById(edgeId);
      if (edge && edge.isEdge()) {
        rerouteEdgeOrthogonal(edge, g);
      }
    };
    win.__toggleWireTool = setWireToolState;
    win.__isWireToolActive = () => wireToolActive;
    win.__cancelWireTool = cancelWireToolInProgress;
    win.__startInlineNodeEdit = (nodeId: string) => {
      const node = g.getCellById(nodeId);
      if (node && node.isNode()) {
        startInlineNodeEdit(node);
      }
    };
  }

  const dispose = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", onWindowEscape);
    }
  };

  return {
    isPlacementActive: () => Boolean(placementData),
    isWireToolActive: () => wireToolActive,
    cancelWireToolInProgress,
    setWireToolState,
    clearPlacement,
    dispose,
  };
}
