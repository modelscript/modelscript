// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.
/* eslint-disable @typescript-eslint/no-extraneous-class */
import * as antvLayout from "@antv/layout";
import * as x6 from "@antv/x6";

/* eslint-disable @typescript-eslint/no-explicit-any */
const Graph: any = (x6 as any).Graph || class {};
const Cell: any = (x6 as any).Cell || class {};
const Selection: any = (x6 as any).Selection || class {};
const Transform: any = (x6 as any).Transform || class {};
const DagreLayout: any = (antvLayout as any).DagreLayout || class {};

type Graph = any;
type Cell = any;
type Node = any;
type Edge = any;
type Selection = any;
type Transform = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

import {
  dropComponentGhost,
  ensureDiagramStyles,
  isEphemeralDiagramNode,
  type DropPlaceholderOptions,
} from "./drop-placeholder.js";
import { defaultInteractiveStateManager, type InteractiveBinding, type InteractiveWriteAction } from "./interactive.js";
import {
  computeFilletedOrthogonalPath,
  computeJumpoverPath,
  computeOrthogonalRoute,
  computeSmoothBezierPath,
  getNodeBBox,
  getPortOutwardNormal,
  portOrthogonalRouter,
  regularizeOrthogonalPolyline,
  resolveNodePortWorldPoint,
  simplifyCollinearPoints,
  translateConnectedEdgeStubs,
  type RectLike,
} from "./port-router.js";
import { applySequenceLayout } from "./sequence-layout.js";
import { computeEdgeNetIds, computeSolderDots, solderDotToDiagramNode, type EdgePath } from "./solder-dots.js";
import * as Spinner from "./spinner.js";
import { applySwimlaneLayout } from "./swimlane-layout.js";
import { animateCells } from "./telemetry.js";
import { applyTsmOrthogonalLayout } from "./tsm-layout.js";
export {
  computeEdgeNetIds,
  dropComponentGhost,
  ensureDiagramStyles,
  isEphemeralDiagramNode,
  type DropPlaceholderOptions,
};

if (typeof Graph.registerRouter === "function") {
  try {
    Graph.registerRouter("port-orthogonal-astar", portOrthogonalRouter, true);
  } catch {
    // Already registered or duplicate in HMR
  }
}

if (typeof Graph.registerConnector === "function") {
  try {
    Graph.registerConnector(
      "jumpover",
      (sourcePoint: any, targetPoint: any, routePoints: any[] = [], args: any = {}) => {
        const points = [sourcePoint, ...routePoints, targetPoint];
        return computeJumpoverPath(points, [], { radius: args.radius ?? 5 });
      },
      true,
    );
  } catch {
    // Already registered or duplicate in HMR
  }
  try {
    Graph.registerConnector(
      "smooth",
      (sourcePoint: any, targetPoint: any, routePoints: any[] = []) => {
        const points = [sourcePoint, ...routePoints, targetPoint];
        return computeSmoothBezierPath(points);
      },
      true,
    );
  } catch {
    // Already registered or duplicate in HMR
  }
  try {
    Graph.registerConnector(
      "bezier",
      (sourcePoint: any, targetPoint: any, routePoints: any[] = []) => {
        const points = [sourcePoint, ...routePoints, targetPoint];
        return computeSmoothBezierPath(points);
      },
      true,
    );
  } catch {
    // Already registered or duplicate in HMR
  }
  try {
    Graph.registerConnector(
      "fillet",
      (sourcePoint: any, targetPoint: any, routePoints: any[] = [], args: any = {}) => {
        const points = [sourcePoint, ...routePoints, targetPoint];
        return computeFilletedOrthogonalPath(points, args.radius ?? 5);
      },
      true,
    );
  } catch {
    // Already registered or duplicate in HMR
  }
}

/** Configuration options and host callbacks for the AntV X6 diagram renderer. */
export interface DiagramRendererOptions {
  /** Target DOM container element in which to mount the AntV X6 graph canvas. */
  container: HTMLElement;
  /** Whether to render the diagram canvas and grid in dark mode. */
  isDark?: boolean | undefined;
  /** Whether edges can connect directly to node bodies in addition to port magnets. */
  allowNodeConnection?: boolean | undefined;
  /** Callback invoked when the user performs a diagram edit action (move, resize, connect, disconnect, etc.). */
  onAction?: ((action: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) => void) | undefined;
  /** Callback invoked when the selected component node changes (or `null` when deselected). */
  onSelect?: ((id: string | null) => void) | undefined;
  /** Callback invoked to display or update the component properties inspection panel. */
  onShowProperties?:
    | ((
        nodeId: string,
        cachedProps?: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any,
        isLoading?: boolean,
      ) => void)
    | undefined;
  /** Callback invoked when the user triggers an Undo keyboard shortcut (`Ctrl+Z` / `Cmd+Z`). */
  onUndo?: (() => void) | undefined;
  /** Callback invoked when the user triggers a Redo keyboard shortcut (`Ctrl+Y` / `Cmd+Shift+Z`). */
  onRedo?: (() => void) | undefined;
  /** Generic message callback for non-action messages (revealSource, navigateTo, etc.) */
  onMessage?: ((msg: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) => void) | undefined;
}

/** Active diagram renderer configuration options. */
let currentOptions: DiagramRendererOptions | null = null;

/**
 * Sets or updates the active configuration options and callbacks for the diagram renderer.
 */
export function setDiagramOptions(options: DiagramRendererOptions) {
  currentOptions = options;
}

/**
 * Dispatches a structural or spatial diagram edit action to the registered `onAction` callback.
 */
function enqueueDiagramAction(action: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) {
  if (currentOptions?.onAction) currentOptions.onAction(action);
}

/**
 * Forwards host-bound messages (`undo`, `redo`, `getProperties`, `revealSource`, `navigateTo`)
 * to the appropriate callback in `currentOptions`.
 */
function postMessageToHost(msg: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) {
  if (msg.type === "undo" && currentOptions?.onUndo) {
    currentOptions.onUndo();
    return;
  }
  if (msg.type === "redo" && currentOptions?.onRedo) {
    currentOptions.onRedo();
    return;
  }
  if (msg.type === "getProperties") {
    if (currentOptions?.onMessage) {
      currentOptions.onMessage(msg);
      return;
    }
    if (currentOptions?.onShowProperties) {
      currentOptions.onShowProperties(msg.componentName, undefined, true);
      return;
    }
  }
  // Forward all other messages (revealSource, navigateTo, changeDiagramType, etc.)
  if (currentOptions?.onMessage) currentOptions.onMessage(msg);
}

/** Singleton AntV X6 graph instance for the active diagram canvas. */
let graph: Graph | null = null;
/** ID of the currently selected component node, if any. */
let selectedNodeId: string | null = null;
/** True while renderDiagram is programmatically mutating the X6 graph. */
let isRenderingDiagram = false;

/** Cache for on-demand component properties (cleared on diagram re-render) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const propertyCache = new Map<string, any>();

export { translateConnectedEdgeStubs };

/**
 * Automatically re-routes an edge with clean, obstacle-avoiding Manhattan A* paths
 * that respect port outward normals and avoid component self-impalement.
 */
export function rerouteEdgeOrthogonal(edge: any, g: Graph): void {
  if (!edge || !edge.isEdge()) return;
  const source = edge.getSource() as any;
  const target = edge.getTarget() as any;
  const sourceCell = edge.getSourceCell?.() ?? (source?.cell ? g.getCellById?.(source.cell) : null);
  const targetCell = edge.getTargetCell?.() ?? (target?.cell ? g.getCellById?.(target.cell) : null);
  const sourcePoint = resolveNodePortWorldPoint(sourceCell, source?.port, edge.getSourcePoint());
  const targetPoint = resolveNodePortWorldPoint(targetCell, target?.port, edge.getTargetPoint());
  if (!sourcePoint || !targetPoint) return;

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

  const rawRoute = computeOrthogonalRoute(sourcePoint, targetPoint, obstacles, {
    sourceSide,
    targetSide,
    sourceBox,
    targetBox,
  });
  const intermediateVertices = simplifyCollinearPoints(rawRoute);
  edge.setVertices(intermediateVertices, { ignoreSnap: true });

  const points = [sourcePoint, ...intermediateVertices, targetPoint].map((p: any) => ({
    x: Math.round(p.x),
    y: Math.round(-p.y),
  }));

  const srcStr = source?.port ? `${source.cell}.${source.port}` : String(source?.cell ?? "");
  const tgtStr = target?.port ? `${target.cell}.${target.port}` : String(target?.cell ?? "");

  enqueueDiagramAction({
    type: "moveEdge",
    edges: [
      {
        source: srcStr,
        target: tgtStr,
        points,
      },
    ],
  });
}

/** Get connected edge metadata for a node (for move/resize updates) */
function getConnectedEdges(
  g: Graph,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
): { source: string; target: string; points: { x: number; y: number }[] }[] {
  return g.getConnectedEdges(node).map((edge: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source = edge.getSource() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = edge.getTarget() as any;
    const sourceCell = edge.getSourceCell?.() ?? (source?.cell ? g.getCellById?.(source.cell) : null);
    const targetCell = edge.getTargetCell?.() ?? (target?.cell ? g.getCellById?.(target.cell) : null);
    const explicitVertices = edge.getVertices() || [];
    const edgeView = typeof edge.findView === "function" ? edge.findView(g) : null;
    const routePoints = edgeView?.routePoints;
    const vertices =
      explicitVertices.length > 0
        ? explicitVertices
        : routePoints && routePoints.length > 0
          ? routePoints.map((p: any) => ({ x: p.x, y: p.y }))
          : [];
    const sourcePoint = resolveNodePortWorldPoint(sourceCell, source?.port, edge.getSourcePoint());
    const targetPoint = resolveNodePortWorldPoint(targetCell, target?.port, edge.getTargetPoint());
    const rawPts = [sourcePoint, ...vertices, targetPoint].filter(Boolean);
    const regularized = regularizeOrthogonalPolyline(rawPts, 2, 1.0);
    const points = regularized.map((p: any) => ({
      x: Math.round(p.x),
      y: Math.round(-p.y),
    }));
    const srcStr = source.port ? `${source.cell}.${source.port}` : String(source.cell ?? "");
    const tgtStr = target.port ? `${target.cell}.${target.port}` : String(target.cell ?? "");
    return {
      source: srcStr,
      target: tgtStr,
      points,
    };
  });
}

/**
 * Initializes (or reconfigures) the AntV X6 graph canvas, plugins, interaction handlers,
 * orthogonal edge routers, and keyboard shortcuts.
 */
export function initGraph(isDark: boolean): Graph | null {
  ensureDiagramStyles();
  let container = currentOptions?.container;
  if (!container && typeof document !== "undefined") {
    const el = document.getElementById("container");
    if (el) {
      container = el;
      if (!currentOptions) {
        currentOptions = { container: el, isDark };
      } else {
        currentOptions.container = el;
      }
    }
  }
  if (!container) {
    if (graph) return graph;
    return null;
  }
  const placeholder = document.getElementById("placeholder");
  if (placeholder) placeholder.style.display = "none";

  const bgColor = isDark ? "#1e1e1e" : "#ffffff";
  const gridColor = isDark ? "#2f2f2f" : "#ccc";

  if (graph) {
    if (graph.container === container) {
      graph.drawBackground({ color: bgColor });
      graph.drawGrid({
        type: "doubleMesh",
        args: [
          { color: "transparent", thickness: 0 },
          { color: gridColor, thickness: 1, factor: 10 },
        ],
      });
      return graph;
    } else {
      try {
        graph.dispose();
      } catch {
        // ignore dispose errors
      }
      graph = null;
    }
  }

  const containerW = container.clientWidth > 0 ? container.clientWidth : 800;
  const containerH = container.clientHeight > 0 ? container.clientHeight : 600;

  const g: Graph = new Graph({
    container,
    width: containerW,
    height: containerH,
    async: false,
    autoResize: true,
    background: { color: bgColor },
    grid: {
      size: 2,
      visible: true,
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    },
    panning: { enabled: true },
    mousewheel: { enabled: true, global: true, modifiers: "ctrl" },
    // We don't want runtime drag-to-reparent behavior.
    // Parent-child relationships are strictly defined by semantic children via addChild().
    embedding: { enabled: false },
    interacting: (cellView: any) => {
      if (isEphemeralDiagramNode(cellView.cell.id)) {
        return false;
      }
      return { nodeMovable: true, edgeMovable: true, edgeLabelMovable: true };
    },
    connecting: {
      snap: { radius: 25 },
      allowBlank: false,
      allowMulti: () => true,
      allowLoop: false,
      allowNode: currentOptions?.allowNodeConnection ?? true,
      allowEdge: true,
      allowPort: true,
      highlight: true,
      highlighting: {
        magnetAvailable: {
          name: "stroke",
          args: {
            attrs: {
              fill: "#fff",
              stroke: "#31d0c6",
              strokeWidth: 4,
            },
          },
        },
        magnetAdsorbed: {
          name: "stroke",
          args: {
            attrs: {
              fill: "#31d0c6",
              stroke: "#1890ff",
              strokeWidth: 6,
            },
          },
        },
      },
      validateMagnet: () => true,
      validateConnection: ({ sourceCell, targetCell }: any) => {
        if (sourceCell && isEphemeralDiagramNode(sourceCell.id)) return false;
        if (targetCell && isEphemeralDiagramNode(targetCell.id)) return false;
        return true;
      },
      validateEdge: () => true,
      createEdge: (): ReturnType<Graph["createEdge"]> => {
        return g.createEdge({
          zIndex: 1000,
          router: { name: "port-orthogonal-astar" },
          attrs: {
            line: {
              stroke: isDark ? "#569cd6" : "#005fb8",
              strokeWidth: 1.5,
              "vector-effect": "non-scaling-stroke",
              targetMarker: null,
              "pointer-events": "none",
            },
          },
        });
      },
    },
  });

  g.use(
    new Selection({
      enabled: true,
      showNodeSelectionBox: true,
      showEdgeSelectionBox: true,
      rubberband: true,
      multiple: true,
      modifiers: ["ctrl", "meta", "shift"],
      multipleSelectionModifiers: ["ctrl", "meta", "shift"],
      pointerEvents: "none",
      filter: (cell: Cell) => !isEphemeralDiagramNode(cell.id),
    }),
  );

  g.use(
    new Transform({
      resizing: { enabled: (node: Node) => !isEphemeralDiagramNode(node.id) },
      rotating: { enabled: (node: Node) => !isEphemeralDiagramNode(node.id) },
    }),
  );

  // ── Selection change events — add/remove edge tools ──
  g.on("selection:changed", ({ added, removed }: { added: Cell[]; removed: Cell[] }) => {
    added.forEach((cell: Cell) => {
      if (cell.isEdge()) {
        cell.removeTools();
        cell.addTools([
          {
            name: "vertices",
            args: {
              attrs: {
                fill: isDark ? "#888" : "#666",
                stroke: "transparent",
                strokeWidth: 6,
                r: 4,
              },
              snapRadius: 10,
              removeRedundancies: true,
              stopPropagation: false,
            },
          },
          {
            name: "segments",
            args: {
              attrs: {
                fill: isDark ? "#888" : "#666",
                stroke: "transparent",
                strokeWidth: 1,
                width: 10,
                height: 2,
                rx: 1,
                ry: 1,
                x: -5,
                y: -1,
              },
              snapRadius: 10,
              removeRedundancies: true,
              stopPropagation: false,
            },
          },
        ]);
      }
    });
    removed.forEach((cell: Cell) => {
      if (cell.isEdge()) {
        cell.removeTools();
      }
    });
  });

  // ── Viewport Level-of-Detail (LOD) ──
  g.on("scale", ({ sx }: { sx: number }) => {
    if (!container) return;
    if (sx < 0.25) {
      container.classList.add("x6-lod-minimal");
      container.classList.add("x6-lod-low");
    } else if (sx < 0.5) {
      container.classList.remove("x6-lod-minimal");
      container.classList.add("x6-lod-low");
    } else {
      container.classList.remove("x6-lod-minimal");
      container.classList.remove("x6-lod-low");
    }
  });

  // ── Placement Mode (Drag and Drop in VS Code) ──
  let placementData: { className: string; classKind: string; iconSvg?: string | undefined } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let placementGhost: any = null;

  const startPlacement = (data: { className: string; classKind: string; iconSvg?: string | undefined }) => {
    ensureDiagramStyles();
    placementData = data;
    const center = g.pageToLocal(window.innerWidth / 2, window.innerHeight / 2);
    const strokeColor = isDark ? "#cccccc" : "#333333";
    const fillColor = isDark ? "rgba(204, 204, 204, 0.15)" : "rgba(51, 51, 51, 0.08)";

    if (placementGhost) {
      placementGhost.remove();
      placementGhost = null;
    }

    if (data.iconSvg) {
      placementGhost = g.addNode({
        id: "placement-ghost",
        shape: "image",
        x: center.x - 20,
        y: center.y - 20,
        width: 40,
        height: 40,
        imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(data.iconSvg)}`,
        attrs: {
          image: {
            preserveAspectRatio: "xMidYMid meet",
            style: "pointer-events: none; opacity: 0.85;",
          },
        },
      });
    } else {
      placementGhost = g.addNode({
        id: "placement-ghost",
        shape: "rect",
        x: center.x - 20,
        y: center.y - 20,
        width: 40,
        height: 40,
        attrs: {
          body: {
            fill: fillColor,
            stroke: strokeColor,
            strokeDasharray: "4 2",
            strokeWidth: 2,
            rx: 6,
            ry: 6,
            opacity: 0.85,
            pointerEvents: "none",
          },
          text: {
            text: data.className.split(".").pop(),
            fill: strokeColor,
            pointerEvents: "none",
            fontSize: 10,
            fontWeight: "600",
          },
        },
      });
    }
  };

  const handlePointerMove = (x: number, y: number) => {
    if (placementGhost) {
      placementGhost.position(x - 20, y - 20);
    }
  };
  g.on("blank:pointermove", ({ x, y }: { x: number; y: number }) => handlePointerMove(x, y));
  g.on("cell:pointermove", ({ x, y }: { x: number; y: number }) => handlePointerMove(x, y));

  const handlePlacementClick = (x: number, y: number) => {
    if (placementData) {
      // Trigger the bounce animation placeholder while the action is processed
      dropComponentGhost(g, x, y, placementData.className, placementData.iconSvg, isDark);
      enqueueDiagramAction({ type: "addComponent", className: placementData.className, x, y });
      if (placementGhost) {
        placementGhost.remove();
        placementGhost = null;
      }
      placementData = null;
    }
  };
  g.on("blank:click", ({ x, y }: { x: number; y: number }) => handlePlacementClick(x, y));
  g.on("cell:click", ({ x, y }: { x: number; y: number }) => handlePlacementClick(x, y));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && placementData) {
      if (placementGhost) {
        placementGhost.remove();
        placementGhost = null;
      }
      placementData = null;
    }
  });

  // Expose for webview to invoke
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__startPlacement = startPlacement;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__movePlacementGhost = handlePointerMove;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__handlePlacementClick = handlePlacementClick;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__getPlacementData = () => placementData;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__rerouteEdgeOrthogonal = (edgeId: string) => {
    const edge = g.getCellById(edgeId);
    if (edge && edge.isEdge()) {
      rerouteEdgeOrthogonal(edge, g);
    }
  };

  // ── Diagram-to-code event handlers (matching morsel's diagram.tsx) ──

  // Node move: debounced
  const changedNodes = new Set<string>();
  let moveTimeout: ReturnType<typeof setTimeout> | null = null;
  let justResized = false;

  g.on("node:moved", ({ node }: { node: Node }) => {
    if (isRenderingDiagram) return;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = [];
      changedNodes.forEach((id) => {
        const n = g.getCellById(id);
        if (n && n.isNode()) {
          const p = n.getPosition();
          const s = n.getSize();
          const r = n.getAngle();
          const edges = getConnectedEdges(g, n);
          items.push({ name: n.id, x: p.x, y: p.y, width: s.width, height: s.height, rotation: r, edges });
        }
      });

      // Also collect positions for connected nodes that weren't moved,
      // so that missing Placement annotations can be added for them.
      const movedNames = new Set(changedNodes);
      const connectedNames = new Set<string>();
      for (const item of items) {
        if (item.edges) {
          for (const edge of item.edges) {
            const srcComp = edge.source.split(".")[0];
            const tgtComp = edge.target.split(".")[0];
            if (!movedNames.has(srcComp)) connectedNames.add(srcComp);
            if (!movedNames.has(tgtComp)) connectedNames.add(tgtComp);
          }
        }
      }
      connectedNames.forEach((id) => {
        const n = g.getCellById(id);
        if (n && n.isNode()) {
          const p = n.getPosition();
          const s = n.getSize();
          const r = n.getAngle();
          items.push({
            name: n.id,
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
            rotation: r,
            connectedOnly: true,
          });
        }
      });

      if (items.length > 0) {
        enqueueDiagramAction({ type: "move", items });
      }
      changedNodes.clear();
      moveTimeout = null;
    }, 5);
  });

  // Node rotated
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.on("node:rotated", ({ node }: any) => {
    if (isRenderingDiagram) return;
    if (isEphemeralDiagramNode(node.id)) return;
    const p = node.getPosition();
    const s = node.getSize();
    const r = node.getAngle();
    const edges = getConnectedEdges(g, node);
    enqueueDiagramAction({
      type: "move",
      items: [{ name: node.id, x: p.x, y: p.y, width: s.width, height: s.height, rotation: r, edges }],
    });
  });

  // We don't shrink/fit parents during drag to preserve Dagre layout spacings.

  // Node resized
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.on("node:resized", ({ node }: any) => {
    if (isRenderingDiagram) return;
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
    const edges = getConnectedEdges(g, node);
    enqueueDiagramAction({
      type: "resize",
      item: {
        name: node.id,
        x: p.x,
        y: p.y,
        width: s.width,
        height: s.height,
        rotation: r,
        edges,
      },
    });
  });

  // Cache prior endpoints on edge mousedown, selection, or hover
  const edgePriorEndpoints = new Map<string, { source: any; target: any }>();
  g.on("edge:mouseenter", ({ edge }: any) => {
    if (edge?.id) edgePriorEndpoints.set(edge.id, { source: edge.getSource(), target: edge.getTarget() });
  });
  g.on("edge:selected", ({ edge }: any) => {
    if (edge?.id) edgePriorEndpoints.set(edge.id, { source: edge.getSource(), target: edge.getTarget() });
  });

  // Edge connected (handles both new edge creation and terminal dragging reconnection)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  g.on("edge:connected", ({ isNew, edge }: any) => {
    if (isRenderingDiagram) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const source = edge.getSource() as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const target = edge.getTarget() as any;
    if (!source?.cell || !target?.cell) return;

    const sourceCell = g.getCellById(source.cell);
    const targetCell = g.getCellById(target.cell);

    // Resolve source identifier (port or tapped edge net)
    let srcStr = "";
    if (sourceCell?.isEdge()) {
      const edgeSrc = sourceCell.getSource() as any;
      const edgeTgt = sourceCell.getTarget() as any;
      srcStr = edgeSrc?.port
        ? `${edgeSrc.cell}.${edgeSrc.port}`
        : edgeTgt?.port
          ? `${edgeTgt.cell}.${edgeTgt.port}`
          : String(edgeSrc?.cell ?? "");
    } else if (source.port !== undefined) {
      srcStr = `${source.cell}.${source.port}`;
    } else {
      srcStr = String(source.cell);
    }

    // Resolve target identifier (port or tapped edge net)
    let tgtStr = "";
    if (targetCell?.isEdge()) {
      const edgeSrc = targetCell.getSource() as any;
      const edgeTgt = targetCell.getTarget() as any;
      tgtStr = edgeSrc?.port
        ? `${edgeSrc.cell}.${edgeSrc.port}`
        : edgeTgt?.port
          ? `${edgeTgt.cell}.${edgeTgt.port}`
          : String(edgeSrc?.cell ?? "");
    } else if (target.port !== undefined) {
      tgtStr = `${target.cell}.${target.port}`;
    } else {
      tgtStr = String(target.cell);
    }

    if (!srcStr || !tgtStr) return;

    const vertices = edge.getVertices() || [];
    const sourcePoint = edge.getSourcePoint();
    const targetPoint = edge.getTargetPoint();

    let intermediateVertices = vertices;
    if (vertices.length === 0 && sourcePoint && targetPoint) {
      const edgeView = g.findViewByCell(edge) as any;
      if (edgeView?.routePoints && edgeView.routePoints.length > 0) {
        intermediateVertices = edgeView.routePoints;
      } else {
        const obstacles: RectLike[] = [];
        for (const node of g.getNodes()) {
          if (node.id === source.cell || node.id === target.cell) continue;
          if (isEphemeralDiagramNode(node.id)) continue;
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
        intermediateVertices = computeOrthogonalRoute(sourcePoint, targetPoint, obstacles);
      }
    }

    const simplifiedVertices = simplifyCollinearPoints(intermediateVertices);
    const points = [sourcePoint, ...simplifiedVertices, targetPoint].map((p: { x: number; y: number }) => ({
      x: Math.round(p.x),
      y: Math.round(-p.y),
    }));

    if (isNew) {
      enqueueDiagramAction({
        type: "connect",
        source: srcStr,
        target: tgtStr,
        points,
      });
    } else {
      const prev = edgePriorEndpoints.get(edge.id);
      const oldSrcStr = prev?.source?.port
        ? `${prev.source.cell}.${prev.source.port}`
        : String(prev?.source?.cell ?? srcStr);
      const oldTgtStr = prev?.target?.port
        ? `${prev.target.cell}.${prev.target.port}`
        : String(prev?.target?.cell ?? tgtStr);

      enqueueDiagramAction({
        type: "reconnect",
        edgeId: edge.id,
        oldSource: oldSrcStr,
        oldTarget: oldTgtStr,
        newSource: srcStr,
        newTarget: tgtStr,
        oldSourcePort: prev?.source?.port,
        oldTargetPort: prev?.target?.port,
        newSourcePort: source.port,
        newTargetPort: target.port,
      });
    }
  });

  // Edge vertices changed: debounced with orthogonal regularization and collinear pruning
  let edgeUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  g.on("edge:change:vertices", ({ edge, options }: any) => {
    if (isRenderingDiagram || options?.ignoreSnap) return;

    const vertices = edge.getVertices() || [];
    const sourcePoint = edge.getSourcePoint();
    const targetPoint = edge.getTargetPoint();
    if (vertices.length > 0 && sourcePoint && targetPoint) {
      const fullPolyline = [sourcePoint, ...vertices, targetPoint];
      const regularized = regularizeOrthogonalPolyline(fullPolyline, 6, 1.5);
      const newVertices = regularized.slice(1, -1);

      const changed =
        newVertices.length !== vertices.length ||
        newVertices.some(
          (nv: any, idx: number) => Math.abs(nv.x - vertices[idx].x) > 0.5 || Math.abs(nv.y - vertices[idx].y) > 0.5,
        );

      if (changed) {
        edge.setVertices(newVertices, { ignoreSnap: true });
      }
    }

    if (edgeUpdateTimeout) clearTimeout(edgeUpdateTimeout);
    edgeUpdateTimeout = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const source = edge.getSource() as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const target = edge.getTarget() as any;
      const wireId = edge.getData()?.wireId;
      if ((source?.cell && target?.cell) || wireId) {
        const curVertices = edge.getVertices() || [];
        const srcPt = edge.getSourcePoint();
        const tgtPt = edge.getTargetPoint();
        const points = [srcPt, ...curVertices, tgtPt].map((p: any) => ({
          x: Math.round(p.x),
          y: Math.round(-p.y),
        }));
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
        enqueueDiagramAction({
          type: "moveEdge",
          edges: [
            {
              source: srcStr,
              target: tgtStr,
              points,
            },
          ],
        });
      }
      edgeUpdateTimeout = null;
    }, 500);
  });

  let isSnappingPortAlignment = false;
  let isAltPressed = false;

  const clearAlignmentGuides = () => {
    const gx = g.getCellById?.("__alignment_guide_x__");
    if (gx) g.removeCell?.(gx);
    const gy = g.getCellById?.("__alignment_guide_y__");
    if (gy) g.removeCell?.(gy);
  };

  const renderAlignmentGuide = (
    id: "__alignment_guide_x__" | "__alignment_guide_y__",
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) => {
    const existing = g.getCellById?.(id);
    if (existing) g.removeCell?.(existing);
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const w = Math.max(1, Math.abs(x2 - x1));
    const h = Math.max(1, Math.abs(y2 - y1));
    g.addNode?.({
      id,
      shape: "rect",
      x: minX,
      y: minY,
      width: w,
      height: h,
      zIndex: 999,
      attrs: {
        body: {
          fill: "none",
          stroke: "#00b4d8",
          strokeWidth: 1,
          strokeDasharray: "3 3",
          pointerEvents: "none",
        },
      },
    });
  };

  // Synchronize topological solder dots across graph lifecycle and interactive edits
  g.on("node:change:position", ({ cell, current, previous }: any) => {
    if (!isRenderingDiagram && !isSnappingPortAlignment && cell && cell.isNode() && current && previous) {
      if (!isEphemeralDiagramNode(cell.id)) {
        let snapDx = 0;
        let snapDy = 0;
        let guideX: { x: number; y1: number; y2: number } | null = null;
        let guideY: { y: number; x1: number; x2: number } | null = null;
        const snapThreshold = 4;

        const connected = g.getConnectedEdges?.(cell) || [];
        for (const edge of connected) {
          const src = edge.getSource?.() as any;
          const tgt = edge.getTarget?.() as any;
          const isSrc = src?.cell === cell.id;
          const myPortId = isSrc ? src?.port : tgt?.port;
          const peerCellId = isSrc ? tgt?.cell : src?.cell;
          const peerPortId = isSrc ? tgt?.port : src?.port;
          const peerNode = peerCellId ? g.getCellById?.(peerCellId) : null;
          if (!myPortId || !peerNode || !peerPortId) continue;

          const myPt = resolveNodePortWorldPoint(cell, myPortId);
          const peerPt = resolveNodePortWorldPoint(peerNode, peerPortId);
          if (!myPt || !peerPt) continue;

          const diffX = peerPt.x - myPt.x;
          if (Math.abs(diffX) <= snapThreshold && (guideX === null || Math.abs(diffX) < Math.abs(snapDx))) {
            snapDx = diffX;
            guideX = { x: peerPt.x, y1: myPt.y, y2: peerPt.y };
          }
          const diffY = peerPt.y - myPt.y;
          if (Math.abs(diffY) <= snapThreshold && (guideY === null || Math.abs(diffY) < Math.abs(snapDy))) {
            snapDy = diffY;
            guideY = { y: peerPt.y, x1: myPt.x, x2: peerPt.x };
          }
        }

        if (Math.abs(snapDx) > 0.01 || Math.abs(snapDy) > 0.01) {
          isSnappingPortAlignment = true;
          cell.setPosition?.(current.x + snapDx, current.y + snapDy);
          isSnappingPortAlignment = false;
        }

        if (guideX) {
          renderAlignmentGuide("__alignment_guide_x__", guideX.x, guideX.y1, guideX.x, guideX.y2);
        } else {
          const gx = g.getCellById?.("__alignment_guide_x__");
          if (gx) g.removeCell?.(gx);
        }
        if (guideY) {
          renderAlignmentGuide("__alignment_guide_y__", guideY.x1, guideY.y, guideY.x2, guideY.y);
        } else {
          const gy = g.getCellById?.("__alignment_guide_y__");
          if (gy) g.removeCell?.(gy);
        }

        const effectiveDx = current.x + snapDx - previous.x;
        const effectiveDy = current.y + snapDy - previous.y;
        translateConnectedEdgeStubs(g, cell, effectiveDx, effectiveDy, { forceReroute: isAltPressed });
      }
    }
    scheduleUpdateSolderDots(g);
  });
  g.on("node:moved", () => {
    clearAlignmentGuides();
    scheduleUpdateSolderDots(g);
  });
  g.on("node:mouseup", () => clearAlignmentGuides());
  g.on("node:resized", () => scheduleUpdateSolderDots(g));
  g.on("edge:change:vertices", () => scheduleUpdateSolderDots(g));
  g.on("edge:change:source", () => scheduleUpdateSolderDots(g));
  g.on("edge:change:target", () => scheduleUpdateSolderDots(g));
  g.on("edge:connected", () => scheduleUpdateSolderDots(g));
  g.on("edge:added", () => scheduleUpdateSolderDots(g));
  g.on("edge:removed", () => scheduleUpdateSolderDots(g));
  g.on("render:done", () => scheduleUpdateSolderDots(g));

  // Quick re-route orthogonal on edge double-click or context menu
  g.on("edge:dblclick", ({ edge }: { edge: any }) => {
    if (edge && edge.isEdge()) {
      rerouteEdgeOrthogonal(edge, g);
    }
  });

  g.on("edge:contextmenu", ({ edge, e }: { edge: any; e: MouseEvent }) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (edge && edge.isEdge()) {
      rerouteEdgeOrthogonal(edge, g);
    }
  });

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Alt" || e.altKey) isAltPressed = true;
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Alt" || !e.altKey) isAltPressed = false;
    });
  }

  // Delete key: delete selected edges/components
  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      // Do not trigger deletion if the user is typing in an input or textarea
      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") {
        return;
      }

      const cells = g.getSelectedCells();
      if (cells.length === 0) return;

      // Separate edges and nodes
      const edgesToDelete: { source: string; target: string }[] = [];
      const componentNames: string[] = [];

      cells.forEach((cell: Cell) => {
        if (cell.isEdge()) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const source = cell.getSource() as any;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const target = cell.getTarget() as any;
          const wireId = cell.getData()?.wireId;
          if (source?.cell && source?.port && target?.cell && target?.port) {
            edgesToDelete.push({
              source: `${source.cell}.${source.port}`,
              target: `${target.cell}.${target.port}`,
            });
          } else if (wireId || cell.id) {
            const idStr = String(wireId || cell.id);
            edgesToDelete.push({
              source: idStr,
              target: idStr,
            });
          }
        } else if (cell.isNode() && !isEphemeralDiagramNode(cell.id)) {
          componentNames.push(cell.id);
        }
      });

      if (edgesToDelete.length > 0) {
        for (const edge of edgesToDelete) {
          enqueueDiagramAction({ type: "disconnect", ...edge });
        }
      }
      if (componentNames.length > 0) {
        enqueueDiagramAction({ type: "deleteComponents", names: componentNames });
      }
      g.removeCells(cells);
      scheduleUpdateSolderDots(g);
    } else {
      const nav = navigator as unknown as {
        platform?: string | undefined;
        userAgent?: string | undefined;
        userAgentData?: { platform?: string | undefined } | undefined;
      };
      const platform = (nav.platform || nav.userAgentData?.platform || nav.userAgent || "").toUpperCase();
      const isMac = platform.indexOf("MAC") >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        Spinner.show();
        if (e.shiftKey) {
          postMessageToHost({ type: "redo" });
        } else {
          postMessageToHost({ type: "undo" });
        }
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        Spinner.show();
        postMessageToHost({ type: "redo" });
      }
    }
  });

  g.on("node:mousedown", ({ node }: any) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const interactiveBindings: InteractiveBinding[] = node.getData()?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "momentary") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "mousedown");
          if (action) enqueueDiagramAction(action);
        }
      }
    }
  });

  g.on("node:mouseup", ({ node }: any) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const interactiveBindings: InteractiveBinding[] = node.getData()?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "momentary") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "mouseup");
          if (action) enqueueDiagramAction(action);
        }
      }
    }
  });

  g.on("node:click", ({ node }: any) => {
    if (!graph) return;
    if (isEphemeralDiagramNode(node.id)) {
      selectedNodeId = null;
      if (currentOptions?.onSelect) currentOptions.onSelect(null);
      return;
    }
    selectedNodeId = node.id;
    const data = node.getData();

    // Process interactive bindings on click (toggle, numeric, selector, faceplate)
    const interactiveBindings: InteractiveBinding[] = data?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "toggle" || binding.action === "faceplate") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "click");
          if (action) enqueueDiagramAction(action);
        } else if (binding.action === "numeric" || binding.action === "slider") {
          if (typeof window !== "undefined" && typeof (window as any).prompt === "function") {
            const current = defaultInteractiveStateManager.getValue(node.id, binding.variableName, binding.min ?? 0);
            const unitLabel = binding.unit ? ` [${binding.unit}]` : "";
            const rangeLabel =
              binding.min !== undefined && binding.max !== undefined ? ` (${binding.min} - ${binding.max})` : "";
            const input = (window as any).prompt(
              `Set ${binding.label ?? binding.variableName}${unitLabel}${rangeLabel}:`,
              String(current),
            );
            if (input !== null) {
              const action = defaultInteractiveStateManager.handleInteraction(node, binding, "input", input);
              if (action) enqueueDiagramAction(action);
            }
          }
        }
      }
    }

    // Show properties panel immediately with lightweight data, then request full properties
    const cachedProps = propertyCache.get(node.id);
    if (cachedProps) {
      showProperties({ id: node.id, properties: cachedProps });
    } else {
      // Show panel with lightweight data (className, name, description) + loading indicator
      showProperties({ id: node.id, properties: data?.properties, isLoading: true });
      // Request full properties from host on-demand
      postMessageToHost({ type: "getProperties", componentName: node.id });
    }

    // Reveal the source location of the clicked element in the text editor
    const props = data?.properties;
    if (props?.sourceRange) {
      postMessageToHost({
        type: "revealSource",
        startOffset: props.sourceRange.startOffset,
        endOffset: props.sourceRange.endOffset,
      });
    }

    // Smoothly pan to center the node horizontally in the visible portion
    const bbox = node.getBBox();
    const scale = g.scale().sx;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    // Panel width is roughly 300px, so we offset by 300
    const paddingRight = 300;
    const containerRect = g.container.getBoundingClientRect();
    const visibleWidth = containerRect.width - paddingRight;

    // Calculate target translation
    const targetTx = visibleWidth / 2 - cx * scale;
    const targetTy = containerRect.height / 2 - cy * scale;

    const { tx: ctx, ty: cty } = g.translate();
    const duration = 250;
    const startTime = performance.now();

    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      g.translate(ctx + (targetTx - ctx) * ease, cty + (targetTy - cty) * ease);
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    requestAnimationFrame(animate);
  });

  // ── Double-click navigation: drill into child diagram views ──
  // E.g., double-click a StateDefinition in BDD → open StateMachine view for it.
  g.on("node:dblclick", ({ node }: { node: Node }) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const data = node.getData();
    const props = data?.properties;
    if (!props?.ruleName) return;

    // Determine which diagram type to navigate to based on the element's type
    const navigationMap: Record<string, string> = {
      PartDefinition: "IBD",
      PartUsage: "IBD",
      StateDefinition: "StateMachine",
      StateUsage: "StateMachine",
      ActionDefinition: "Activity",
      ActionUsage: "Activity",
      UseCaseDefinition: "UseCase",
      UseCaseUsage: "UseCase",
      RequirementDefinition: "Requirement",
      RequirementUsage: "Requirement",
      ConstraintDefinition: "Parametric",
      ConstraintUsage: "Parametric",
      Package: "Package",
    };

    const targetDiagramType = navigationMap[props.ruleName];
    if (targetDiagramType) {
      postMessageToHost({
        type: "navigateTo",
        className: props.description, // the element name
        diagramType: targetDiagramType,
      });
    }
  });

  g.on("blank:click", () => {
    selectedNodeId = null;
    if (currentOptions?.onSelect) currentOptions.onSelect(null);
  });

  // Placement logic removed from core renderer

  graph = g;
  return g;
}

/**
 * Renders (or incrementally diffs and updates) a polyglot diagram model onto the AntV X6 graph canvas,
 * executing hierarchical Dagre/sequence/swimlane/TSM layouts and updating topological solder dots.
 */
export function renderDiagram(data: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any, isDark: boolean) {
  const g = initGraph(isDark);
  if (!g) return;

  isRenderingDiagram = true;
  try {
    renderDiagramInternal(g, data, isDark);
  } finally {
    isRenderingDiagram = false;
  }
}

function renderDiagramInternal(
  g: Graph,
  data: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any,
  isDark: boolean,
) {
  // Clean up any remaining drop placeholder or placement ghost when real diagram data arrives
  const placeholder = g.getCellById("__drop_placeholder__");
  if (placeholder) g.removeCell(placeholder);
  const ghost = g.getCellById("placement-ghost");
  if (ghost) g.removeCell(ghost);

  // Build nodes from diagram data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges: any[] = [];

  for (const node of data.nodes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodeData: any = {
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      angle: node.angle,
      zIndex: node.zIndex,
      opacity: node.opacity,
      markup: node.markup,
      ports: node.ports,
      data: {
        properties: node.properties,
        animations: node.animations,
        interactive: node.interactive,
        ...(node.data || {}),
      },
      autoLayout: node.autoLayout,
    };
    // Forward polyglot X6 attrs and shape (selector-based rendering)
    if (node.attrs) nodeData.attrs = node.attrs;
    if (node.shape) nodeData.shape = node.shape;
    if (node.parent) nodeData.parent = node.parent;
    nodes.push(nodeData);
  }

  for (const edge of data.edges) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edgeData: any = {
      id: edge.id,
      shape: edge.shape ?? "edge",
      zIndex: edge.zIndex,
      source: edge.source,
      target: edge.target,
      vertices: edge.vertices,
      connector: edge.connector,
      router: edge.router ?? { name: "normal" },
    };
    // Polyglot edges pass attrs as a full selector-keyed object;
    // Modelica edges have attrs.line specifically
    if (edge.attrs?.line) {
      edgeData.attrs = { "z-index": "-10", line: edge.attrs.line };
    } else if (edge.attrs) {
      edgeData.attrs = edge.attrs;
    }
    // Forward labels (polyglot edge stereotypes like «connect», «satisfy»)
    if (edge.labels) edgeData.labels = edge.labels;
    if (edge.data) edgeData.data = edge.data;
    edges.push(edgeData);
  }

  // Add diagram background if present
  if (data.coordinateSystem) {
    const cs = data.coordinateSystem;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children: any[] = [
      {
        tagName: "rect",
        attrs: {
          style:
            "fill: transparent; stroke: #999; stroke-width: 1px; vector-effect: non-scaling-stroke; pointer-events: none;",
          width: cs.width,
          height: cs.height,
        },
      },
    ];
    if (data.diagramBackground) {
      children.push(data.diagramBackground);
    }
    nodes.push({
      id: "__diagram_background__",
      x: cs.x,
      y: cs.y,
      width: cs.width,
      height: cs.height,
      zIndex: -1,
      markup: {
        tagName: "svg",
        children,
        attrs: {
          preserveAspectRatio: "none",
          width: cs.width,
          height: cs.height,
          pointerEvents: "none",
          style: "overflow: visible; pointer-events: none;",
        },
      },
    });
  }

  // Add axes node
  if (data.coordinateSystem) {
    nodes.push({
      id: "__diagram_axes__",
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      zIndex: -2,
      markup: {
        tagName: "g",
        attrs: {
          pointerEvents: "none",
          style: "pointer-events: none;",
        },
        children: [
          {
            tagName: "line",
            attrs: {
              x1: "-100000",
              y1: "0",
              x2: "100000",
              y2: "0",
              stroke: "#999",
              "stroke-width": "1",
              "vector-effect": "non-scaling-stroke",
              "pointer-events": "none",
            },
          },
          {
            tagName: "line",
            attrs: {
              x1: "0",
              y1: "-100000",
              x2: "0",
              y2: "100000",
              stroke: "#999",
              "stroke-width": "1",
              "vector-effect": "non-scaling-stroke",
              "pointer-events": "none",
            },
          },
        ],
      },
    });
  }

  const cs = data.coordinateSystem;

  // ── Sequence Diagram: use custom layout instead of Dagre ──
  if (data.diagramType === "Sequence") {
    applySequenceLayout(nodes, edges, isDark);
  } else if ((data as any).partitions && (data as any).partitions.length > 0) {
    applySwimlaneLayout({ nodes, edges }, (data as any).partitions);
  } else if ((data as any).layout === "tsm-orthogonal" || (data as any).layout === "orthogonal") {
    applyTsmOrthogonalLayout({ nodes, edges });
  } else {
    // ── Layout Strategy ──
    // The layout runs in 3 phases:
    //   Phase 1: Sub-Dagre for each container to compute actual child bounding boxes
    //   Phase 2: Top-level Dagre with expanded container sizes
    //   Phase 3: Reposition children relative to final parent positions

    // Build parent → children map from the node data
    const parentChildMap = new Map<string, typeof nodes>();
    for (const node of nodes) {
      if (node.parent) {
        const list = parentChildMap.get(node.parent) ?? [];
        list.push(node);
        parentChildMap.set(node.parent, list);
      }
    }

    // ── Phase 1: Sub-Dagre layout for children inside each group container ──
    // This computes the bounding box for each container and expands the parent
    // node dimensions BEFORE the top-level layout runs.
    // We store relative offsets so we can reposition after Phase 2.
    const childRelativePositions = new Map<string, { dx: number; dy: number }>();

    for (const [parentId, childNodes] of parentChildMap) {
      const parentNode = nodes.find((n) => n.id === parentId);
      if (!parentNode) continue;

      // Dynamically compute padding to ensure children don't overlap with the parent's
      // header, tab, or compartments.
      const PAD = { top: 48, left: 24, right: 24, bottom: 24 };

      const childIds = new Set(childNodes.map((c) => c.id));

      const subDagre = new DagreLayout({
        type: "dagre",
        rankdir: "TB",
        align: "UL",
        ranksep: 40,
        nodesep: 40,
        begin: [0, 0],
        controlPoints: true,
      });

      const subEdges = edges
        .filter((e) => {
          const s = typeof e.source === "string" ? e.source : (e.source.cell as string);
          const t = typeof e.target === "string" ? e.target : (e.target.cell as string);
          return childIds.has(s) && childIds.has(t);
        })
        .map((e) => ({
          source: typeof e.source === "string" ? e.source : (e.source.cell as string),
          target: typeof e.target === "string" ? e.target : (e.target.cell as string),
        }));

      // Inject fake edges to wrap isolated nodes into 2 rows for a compact layout
      const connectedSub = new Set<string>();
      subEdges.forEach((e) => {
        connectedSub.add(e.source);
        connectedSub.add(e.target);
      });
      const isolatedSub = childNodes.filter((n) => !connectedSub.has(n.id)).map((n) => n.id);
      if (isolatedSub.length > 2) {
        const cols = Math.ceil(Math.sqrt(isolatedSub.length));
        for (let i = 0; i < isolatedSub.length - cols; i++) {
          subEdges.push({ source: isolatedSub[i], target: isolatedSub[i + cols] });
        }
      }

      const subModel = {
        nodes: childNodes.map((c) => ({
          id: c.id,
          width: c.width,
          height: c.height,
          size: [c.width || 220, c.height || 50],
        })),
        edges: subEdges,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subResult = subDagre.layout(subModel as any);

      let minX = Infinity;
      let minY = Infinity;
      const layoutCoords = new Map<string, { leftX: number; topY: number }>();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      subResult.nodes?.forEach((laid: any) => {
        const childNode = childNodes.find((c) => c.id === laid.id);
        if (childNode) {
          // Dagre returns coordinates of the center of the node. Convert to top-left for X6.
          const leftX = laid.x - childNode.width / 2;
          const topY = laid.y - childNode.height / 2;
          minX = Math.min(minX, leftX);
          minY = Math.min(minY, topY);
          layoutCoords.set(childNode.id, { leftX, topY });
        }
      });

      let maxRight = 0;
      let maxBottom = 0;

      for (const childNode of childNodes) {
        const coords = layoutCoords.get(childNode.id);
        if (coords) {
          // Normalize against minX/minY so children start exactly inside PAD, handling negative Dagre bounds
          const dx = PAD.left + (coords.leftX - minX);
          const dy = PAD.top + (coords.topY - minY);
          childRelativePositions.set(childNode.id, { dx, dy });
          maxRight = Math.max(maxRight, dx + childNode.width + PAD.right);
          maxBottom = Math.max(maxBottom, dy + childNode.height + PAD.bottom);
        }
      }

      // Expand parent to fit children, respecting any tab width
      const minParentWidth = (parentNode.attrs?.tab as any)?.width
        ? Math.round((parentNode.attrs.tab as any).width + 30)
        : 220;
      parentNode.width = Math.max(maxRight, minParentWidth);
      parentNode.height = Math.max(maxBottom, 80);
    }

    // ── Phase 2: Top-level Dagre layout with expanded container sizes ──
    const nodesToLayout: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodes.forEach((node: any) => {
      if (node.autoLayout && !node.parent) {
        nodesToLayout.push(node.id ?? "");
      }
    });

    if (nodesToLayout.length > 0) {
      const dagreLayout = new DagreLayout({
        type: "dagre",
        rankdir: "TB",
        align: "UL",
        ranksep: 60,
        nodesep: 60,
        begin: [20, 20],
        controlPoints: true,
      });

      const modelEdges = edges
        .filter((e) => {
          const s = typeof e.source === "string" ? e.source : (e.source.cell as string);
          const t = typeof e.target === "string" ? e.target : (e.target.cell as string);
          return nodesToLayout.includes(s) && nodesToLayout.includes(t);
        })
        .map((e) => ({
          source: typeof e.source === "string" ? e.source : (e.source.cell as string),
          target: typeof e.target === "string" ? e.target : (e.target.cell as string),
        }));

      // Inject fake edges to wrap isolated top-level packages into 2 rows
      const connectedTop = new Set<string>();
      modelEdges.forEach((e) => {
        connectedTop.add(e.source);
        connectedTop.add(e.target);
      });
      const isolatedTop = nodes
        .filter((n) => nodesToLayout.includes(n.id ?? ""))
        .filter((n) => !connectedTop.has(n.id ?? ""))
        .map((n) => n.id ?? "");
      if (isolatedTop.length > 2) {
        const cols = Math.ceil(Math.sqrt(isolatedTop.length));
        for (let i = 0; i < isolatedTop.length - cols; i++) {
          modelEdges.push({ source: isolatedTop[i], target: isolatedTop[i + cols] });
        }
      }

      const model = {
        nodes: nodes
          .filter((n) => nodesToLayout.includes(n.id ?? ""))
          .map((n) => ({
            ...n,
            size: [n.width || 220, n.height || 100],
          })),
        edges: modelEdges,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newModel = dagreLayout.layout(model as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newModel.nodes?.forEach((n: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node = nodes.find((no: any) => no.id === n.id);
        if (node) {
          node.x = n.x - (node.width ?? 0) / 2;
          node.y = n.y - (node.height ?? 0) / 2;
        }
      });
    }

    // ── Phase 3: Reposition children relative to final parent positions ──
    for (const [parentId, childNodes] of parentChildMap) {
      const parentNode = nodes.find((n) => n.id === parentId);
      if (!parentNode) continue;

      for (const child of childNodes) {
        const rel = childRelativePositions.get(child.id);
        if (rel) {
          child.x = parentNode.x + rel.dx;
          child.y = parentNode.y + rel.dy;
        }
      }
    }
  } // end of non-Sequence layout else-block

  // X6's fromJSON has a bug where it only partially wires up parent/child
  // relationships when fed raw JSON (it sets the parent pointer on the child,
  // but fails to populate the children array on the parent).
  // This breaks dragging and embedding completely.

  // 1. Stash the relationships and clean the JSON
  const relations = new Map<string, string>(); // child id -> parent id
  for (const n of nodes) {
    if (n.parent) {
      relations.set(n.id, n.parent);
      delete n.parent;
    }
    if (n.children) {
      delete n.children;
    }
  }

  // ── Diff-based incremental update ──
  // If the graph already has cells and the topology hasn't changed (same set of
  // node/edge IDs), update positions and properties in-place instead of
  // destroying the entire DOM via fromJSON. This avoids visible flicker and
  // is ~5-10x faster for spatial-only edits (move, resize, annotation changes).
  const existingCells = g.getCells();
  const isFirstRender = existingCells.length === 0;

  if (!isFirstRender) {
    const existingNodeIds = new Set<string>();
    const existingEdgeIds = new Set<string>();
    for (const cell of existingCells) {
      if (isEphemeralDiagramNode(cell.id)) continue;
      if (cell.isNode()) existingNodeIds.add(cell.id);
      else if (cell.isEdge()) existingEdgeIds.add(cell.id);
    }

    const newNodeIds = new Set(
      nodes.filter((n: { id: string }) => !isEphemeralDiagramNode(n.id)).map((n: { id: string }) => n.id),
    );
    const newEdgeIds = new Set(
      edges.filter((e: { id: string }) => !isEphemeralDiagramNode(e.id)).map((e: { id: string }) => e.id),
    );

    // Check if topology changed (different node/edge sets)
    const topologyChanged =
      existingNodeIds.size !== newNodeIds.size ||
      existingEdgeIds.size !== newEdgeIds.size ||
      [...existingNodeIds].some((id) => !newNodeIds.has(id)) ||
      [...newNodeIds].some((id) => !existingNodeIds.has(id)) ||
      [...existingEdgeIds].some((id) => !newEdgeIds.has(id));

    if (!topologyChanged) {
      // ── Fast path: incremental update ──
      g.batchUpdate("diagram-diff", () => {
        for (const nodeData of nodes) {
          const cell = g.getCellById(nodeData.id);
          if (!cell || !cell.isNode()) continue;

          // Update position if changed
          const pos = cell.getPosition();
          if (Math.abs(pos.x - nodeData.x) > 0.5 || Math.abs(pos.y - nodeData.y) > 0.5) {
            cell.setPosition(nodeData.x, nodeData.y, { silent: false });
          }

          // Update size if changed
          const size = cell.getSize();
          if (Math.abs(size.width - nodeData.width) > 0.5 || Math.abs(size.height - nodeData.height) > 0.5) {
            cell.setSize(nodeData.width, nodeData.height);
          }

          // Update angle if changed
          const angle = cell.getAngle();
          if (Math.abs(angle - (nodeData.angle ?? 0)) > 0.5) {
            cell.rotate(nodeData.angle ?? 0, { absolute: true });
          }

          // Update data (properties)
          if (nodeData.data) {
            cell.setData(nodeData.data, { overwrite: true });
          }

          // Update markup and attrs (e.g. parameter ratings, breaker open/closed color, labels)
          if (nodeData.markup) {
            cell.setMarkup(nodeData.markup);
          }
          if (nodeData.attrs) {
            cell.setAttrs(nodeData.attrs);
          }
        }

        // Update edge vertices, endpoints, attrs, and data
        for (const edgeData of edges) {
          const cell = g.getCellById(edgeData.id);
          if (!cell || !cell.isEdge()) continue;

          if (edgeData.vertices) {
            const curVerts = cell.getVertices() || [];
            const vertsChanged =
              curVerts.length !== edgeData.vertices.length ||
              curVerts.some(
                (v: any, idx: number) =>
                  Math.abs(v.x - edgeData.vertices[idx].x) > 0.5 || Math.abs(v.y - edgeData.vertices[idx].y) > 0.5,
              );
            if (vertsChanged) {
              cell.setVertices(edgeData.vertices, { ignoreSnap: true });
            }
          }
          if (edgeData.source && typeof edgeData.source === "object") {
            const curSrc = cell.getSource() as any;
            if (curSrc?.cell !== (edgeData.source as any).cell || curSrc?.port !== (edgeData.source as any).port) {
              cell.setSource(edgeData.source as any);
            }
          }
          if (edgeData.target && typeof edgeData.target === "object") {
            const curTgt = cell.getTarget() as any;
            if (curTgt?.cell !== (edgeData.target as any).cell || curTgt?.port !== (edgeData.target as any).port) {
              cell.setTarget(edgeData.target as any);
            }
          }
          if (edgeData.attrs) {
            cell.setAttrs(edgeData.attrs);
          }
          if (edgeData.data) {
            cell.setData(edgeData.data, { overwrite: true });
          }
        }
      });

      const prevCachedProps = selectedNodeId ? propertyCache.get(selectedNodeId) : undefined;
      // Clear property cache on re-render (model state may have changed)
      propertyCache.clear();

      // Restore property panel for previously selected node after re-render
      if (selectedNodeId && !isEphemeralDiagramNode(selectedNodeId)) {
        const restoredNode = g.getCellById(selectedNodeId);
        if (restoredNode && restoredNode.isNode()) {
          if (prevCachedProps) {
            propertyCache.set(selectedNodeId, prevCachedProps);
            showProperties({ id: restoredNode.id, properties: prevCachedProps, isLoading: false });
          } else {
            const data = restoredNode.getData();
            showProperties({ id: restoredNode.id, properties: data?.properties, isLoading: true });
          }
          postMessageToHost({ type: "getProperties", componentName: restoredNode.id });
        }
      }

      updateSolderDots(g);
      scheduleUpdateSolderDots(g);
      return;
    }
  }

  // ── Full render path (first render or topology changed) ──
  const prevZoom = isFirstRender || typeof g.zoom !== "function" ? null : g.zoom();
  const prevTrans = isFirstRender || typeof g.translate !== "function" ? null : g.translate();

  // 2. Load the flat graph
  g.fromJSON({ nodes, edges });

  // 3. Programmatically establish all embedding relationships via standard API
  for (const [childId, parentId] of relations) {
    const parentCell = g.getCellById(parentId);
    const childCell = g.getCellById(childId);
    if (parentCell && childCell && parentCell.isNode() && childCell.isNode()) {
      parentCell.addChild(childCell);
    }
  }

  // Only fit view on first render — preserve zoom/pan on subsequent updates
  if (isFirstRender) {
    const containerW = g.container.clientWidth > 0 ? g.container.clientWidth : 800;
    const containerH = g.container.clientHeight > 0 ? g.container.clientHeight : 600;
    g.resize(containerW, containerH);
    const viewportArea = { x: 0, y: 0, width: containerW, height: containerH };

    if (cs) {
      const expandedRect = {
        x: cs.x - cs.width * 0.125,
        y: cs.y - cs.height * 0.125,
        width: cs.width * 1.25,
        height: cs.height * 1.25,
      };
      g.zoomToRect(expandedRect, { viewportArea });
      g.centerContent();
    } else {
      try {
        g.zoomToFit({ padding: 40, maxScale: 1.0, minScale: 0.2, viewportArea });
        g.centerContent();
      } catch {
        // ignore
      }
    }

    // In webviews, container dimensions can be 0 or small during initial mount.
    // Ensure the diagram is properly sized and centered once the layout completes.
    setTimeout(() => {
      try {
        if (g && (typeof (g as any).isDisposed === "function" ? !(g as any).isDisposed() : true)) {
          const cw = g.container?.clientWidth ?? 0;
          const ch = g.container?.clientHeight ?? 0;
          if (cw > 0 && ch > 0) {
            g.resize(cw, ch);
          }
          if (!cs) {
            g.zoomToFit({ padding: 40, maxScale: 1.0, minScale: 0.2 });
            g.centerContent();
          }
        }
      } catch {
        // ignore
      }
    }, 60);
  } else if (prevZoom !== null && prevTrans !== null) {
    try {
      g.zoom(prevZoom, { absolute: true });
      g.translate(prevTrans.tx, prevTrans.ty);
    } catch {
      // ignore
    }
  }

  const prevCachedProps = selectedNodeId ? propertyCache.get(selectedNodeId) : undefined;
  // Clear property cache on re-render (model state may have changed)
  propertyCache.clear();

  // Restore property panel for previously selected node after re-render
  if (selectedNodeId && !isEphemeralDiagramNode(selectedNodeId)) {
    const restoredNode = g.getCellById(selectedNodeId);
    if (restoredNode && restoredNode.isNode()) {
      if (prevCachedProps) {
        propertyCache.set(selectedNodeId, prevCachedProps);
        showProperties({ id: restoredNode.id, properties: prevCachedProps, isLoading: false });
      } else {
        const data = restoredNode.getData();
        // Show panel with lightweight data and re-request full properties
        showProperties({ id: restoredNode.id, properties: data?.properties, isLoading: true });
      }
      postMessageToHost({ type: "getProperties", componentName: restoredNode.id });
    }
  }

  updateSolderDots(g);
  scheduleUpdateSolderDots(g);
  setTimeout(() => {
    if (graph === g && !(g as any).disposed) {
      updateSolderDots(g);
    }
  }, 50);
}

// Handle deferred diagram updates to avoid interrupting active interactions
let isMouseDown = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pendingDiagramData: any = null;

if (typeof document !== "undefined") {
  document.addEventListener(
    "mousedown",
    () => {
      isMouseDown = true;
    },
    true,
  );

  document.addEventListener(
    "mouseup",
    () => {
      isMouseDown = false;
      setTimeout(() => {
        if (!isMouseDown && pendingDiagramData) {
          const pd = pendingDiagramData;
          pendingDiagramData = null;
          if (pd.data?.isLoading) {
            Spinner.show();
          }
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              renderDiagram(pd.data, pd.isDark);
              if (!pd.data?.isLoading) {
                Spinner.hide();
              }
            });
          });
        }
      }, 0);
    },
    true,
  );

  // Initialize Diagram Type Select
  const diagramSelect = document.getElementById("diagramTypeSelect") as HTMLSelectElement;
  if (diagramSelect) {
    diagramSelect.addEventListener("change", (e) => {
      Spinner.show();
      postMessageToHost({ type: "changeDiagramType", diagramType: (e.target as HTMLSelectElement).value });
    });
  }
}

// Listen for messages from the extension host
if (typeof window !== "undefined") {
  window.addEventListener("message", (event: MessageEvent) => {
    const message = event.data;
    switch (message.type) {
      case "loading": {
        Spinner.show();
        break;
      }
      case "stopLoading": {
        Spinner.hide();
        break;
      }
      case "diagramData": {
        if (isMouseDown) {
          pendingDiagramData = { data: message.data, isDark: message.isDark ?? true };
        } else {
          if (message.data?.isLoading) {
            Spinner.show();
          }
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              renderDiagram(message.data, message.isDark ?? true);
              if (!message.data?.isLoading) {
                Spinner.hide();
              }
            });
          });
        }
        break;
      }
      case "startPlacement": {
        if (!graph) return;
        const { className, classKind, iconSvg } = message;
        if (!className) break;
        // Calls the startPlacement function defined inside initGraph
        // which creates the ghost cursor and enters placement mode
        (
          window as {
            __startPlacement?:
              | ((d: { className: string; classKind: string; iconSvg?: string | undefined }) => void)
              | undefined;
          }
        ).__startPlacement?.({ className, classKind, iconSvg });
        break;
      }
      case "empty": {
        Spinner.hide();
        const placeholder = document.getElementById("placeholder");
        if (placeholder) {
          placeholder.style.display = "flex";
          placeholder.innerHTML = `
          <div style="text-align: center; max-width: 400px; padding: 20px;">
            <div style="font-size: 32px; margin-bottom: 12px; opacity: 0.4;">📐</div>
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">No diagram data available</div>
            <div style="font-size: 12px; opacity: 0.7; line-height: 1.5;">
              This model may not have graphical annotations, or the class could not be resolved.
              Try adding <code style="background: rgba(128,128,128,0.2); padding: 2px 4px; border-radius: 2px;">annotation(Diagram(...))</code> to your model.
            </div>
          </div>`;
        }
        if (graph) {
          graph.clearCells();
        }
        break;
      }

      case "autoLayout": {
        if (!graph) return;
        const nodes = graph.getNodes();
        const edges = graph.getEdges();

        const dagreLayout = new DagreLayout({
          type: "dagre",
          rankdir: "LR",
          align: "UL",
          ranksep: 100,
          nodesep: 100,
          begin: [-10, -10],
          controlPoints: true,
        });

        const model = {
          nodes: nodes.map((n: Node) => ({
            id: n.id,
            width: n.getSize().width,
            height: n.getSize().height,
          })),
          edges: edges.map((e: Edge) => ({
            source: e.getSourceCellId(),
            target: e.getTargetCellId(),
          })),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const newModel = dagreLayout.layout(model as any);
        const g = graph;

        g.batchUpdate("layout", () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          newModel.nodes?.forEach((n: any) => {
            const node = g.getCellById(n.id);
            if (node && node.isNode()) {
              node.setPosition(n.x, n.y);
            }
          });
        });

        // Let X6 handle bounds rescaling securely over position callbacks
        setTimeout(() => {
          if (graph) {
            const containerW =
              graph.container.clientWidth > 0 ? graph.container.clientWidth : (graph as any).options?.width || 800;
            const containerH =
              graph.container.clientHeight > 0 ? graph.container.clientHeight : (graph as any).options?.height || 600;
            graph.zoomToFit({ padding: 20, viewportArea: { x: 0, y: 0, width: containerW, height: containerH } });
            graph.centerContent();
          }
        }, 100);
        break;
      }

      case "error": {
        Spinner.hide();
        const placeholder2 = document.getElementById("placeholder");
        if (placeholder2) {
          placeholder2.style.display = "flex";
          const errorMsg = String(message.message || "Unknown error")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          placeholder2.innerHTML = `
          <div style="text-align: center; max-width: 500px; padding: 20px;">
            <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
            <div style="font-size: 14px; font-weight: 600; margin-bottom: 8px; color: var(--vscode-errorForeground, #f48771);">Diagram Error</div>
            <div style="font-size: 12px; opacity: 0.8; line-height: 1.5; text-align: left; background: rgba(128,128,128,0.1); padding: 12px; border-radius: 4px; max-height: 200px; overflow-y: auto; font-family: var(--vscode-editor-font-family, monospace); white-space: pre-wrap; word-break: break-word;">${errorMsg}</div>
          </div>`;
        }
        break;
      }

      case "componentProperties": {
        // On-demand property response: update the properties panel with full data
        const { componentName, properties: fullProps } = message;
        if (fullProps) {
          propertyCache.set(componentName, fullProps);
          // Only update if this component is still selected
          if (selectedNodeId === componentName) {
            showProperties({ id: componentName, properties: fullProps });
          }
        }
        break;
      }

      case "setLanguage": {
        // Show the diagram type selector only for SysML2 files
        const toolbar = document.getElementById("toolbar");
        if (toolbar) {
          toolbar.style.display = message.language === "sysml" ? "flex" : "none";
        }
        break;
      }

      case "setDiagramType": {
        // Update the diagram type dropdown to match the host's navigation
        const diagramTypeSelect = document.getElementById("diagramTypeSelect") as HTMLSelectElement | null;
        if (diagramTypeSelect && message.diagramType) {
          diagramTypeSelect.value = message.diagramType;
        }
        break;
      }
    }
  });
}

// ── Property Panel Rendering ──

/**
 * Invokes the registered `onShowProperties` callback to display or update the component inspector.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function showProperties(nodeData: any) {
  if (currentOptions?.onShowProperties) {
    currentOptions.onShowProperties(nodeData.id, nodeData.properties, nodeData.isLoading);
  }
}

/** Pending `requestAnimationFrame` handle for coalescing solder-dot updates. */
let solderDotsRaf: number | null = null;

/**
 * Schedules a coalesced `requestAnimationFrame` update of topological junction solder dots on the graph.
 */
export function scheduleUpdateSolderDots(g: Graph) {
  if (!g || (g as any).disposed) return;
  if (solderDotsRaf !== null) return;
  solderDotsRaf = requestAnimationFrame(() => {
    solderDotsRaf = null;
    if (g && !(g as any).disposed) {
      updateSolderDots(g);
    }
  });
}

/**
 * Recomputes and synchronizes electrical/topological T-junction solder dot nodes across all edges
 * in the graph, excluding component port pin locations.
 */
export function updateSolderDots(g: Graph) {
  if (!g || (g as any).disposed) return;

  const edges = g.getEdges();
  const existingDots = g.getNodes().filter((n: any) => n.id.startsWith("solder_dot_"));

  if (!edges || edges.length === 0) {
    if (existingDots.length > 0) {
      g.batchUpdate("solder-dots", () => {
        for (const dot of existingDots) g.removeCell(dot);
      });
    }
    return;
  }

  const allPaths: EdgePath[] = [];
  const portPoints: { x: number; y: number }[] = [];

  for (const edge of edges) {
    const source = edge.getSourcePoint();
    const target = edge.getTargetPoint();
    if (!source || !target) continue;

    // Collect port positions so solder dots are never placed on component pins
    const src = edge.getSource() as any;
    if (src?.port) {
      portPoints.push(source);
    }
    const tgt = edge.getTarget() as any;
    if (tgt?.port) {
      portPoints.push(target);
    }

    const edgeView = (edge as any).findView ? (edge as any).findView(g) : null;
    const routePoints = edgeView?.routePoints;
    const vertices =
      routePoints && routePoints.length > 0
        ? routePoints.map((p: any) => ({ x: p.x, y: p.y }))
        : edge.getVertices() || [];
    const points = [source, ...vertices, target];

    const stroke = edge.attr("line/stroke") as string | undefined;
    const color = stroke && stroke !== "none" ? stroke : "#1890ff";
    const sourceKey = src?.cell && src?.port ? `${src.cell}.${src.port}` : src?.cell ? String(src.cell) : undefined;
    const targetKey = tgt?.cell && tgt?.port ? `${tgt.cell}.${tgt.port}` : tgt?.cell ? String(tgt.cell) : undefined;
    allPaths.push({ id: edge.id, points, color, sourceKey, targetKey });
  }

  // Also collect port coordinates from all component nodes in graph
  for (const node of g.getNodes()) {
    if (isEphemeralDiagramNode(node.id)) continue;
    const ports = (node as any).getPorts?.() || [];
    const nodePos = node.getPosition();
    const nodeSize = node.getSize();
    const angleDeg = (node as any).getAngle?.() ?? 0;
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = (nodeSize?.width ?? 0) / 2;
    const cy = (nodeSize?.height ?? 0) / 2;
    for (const p of ports) {
      const pos = (node as any).getPortProp?.(p.id, "args");
      if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
        if (!angleDeg) {
          portPoints.push({ x: nodePos.x + pos.x, y: nodePos.y + pos.y });
        } else {
          const dx = pos.x - cx;
          const dy = pos.y - cy;
          portPoints.push({
            x: nodePos.x + cx + dx * cos - dy * sin,
            y: nodePos.y + cy + dx * sin + dy * cos,
          });
        }
      }
    }
  }

  const dots = computeSolderDots(allPaths, { cellSize: 40, tolerance: 3.0, portPoints });
  const existingIds = new Set<string>(existingDots.map((n: any) => n.id));
  const newIds = new Set<string>();

  const dotSize = 3;
  const radius = dotSize / 2;

  g.batchUpdate("solder-dots", () => {
    for (const dot of dots) {
      newIds.add(dot.id);
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
        g.addNode(solderDotToDiagramNode(dot, dotSize));
      }
    }

    for (const oldId of existingIds) {
      if (!newIds.has(oldId)) {
        const cell = g.getCellById(oldId);
        if (cell) g.removeCell(cell);
      }
    }
  });

  if (typeof window !== "undefined") {
    (window as any).debugSolderDotsInfo = `Edges: ${edges.length}, Paths: ${allPaths.length}, Dots: ${dots.length}`;
  }
}

/**
 * Disposes the active AntV X6 graph instance and resets renderer options.
 */
export function disposeDiagram() {
  if (graph) {
    graph.dispose();
    graph = null;
  }
  currentOptions = null;
}

/**
 * Optimistically patch the SVG text label of a component in the diagram
 * when a parameter value changes. This avoids a full diagram re-render and
 * gives the user instant visual feedback as they type.
 *
 * The function walks all `<text>` elements inside the node's SVG and replaces
 * text content that matches the old parameter value pattern with the new one.
 */
export function updateParameterText(nodeId: string, paramName: string, oldValue: string, newValue: string): void {
  if (!graph) return;
  const cell = graph.getCellById(nodeId);
  if (!cell || !cell.isNode()) return;

  const view = graph.findViewByCell(cell);
  if (!view) return;

  const svgEl = view.container;
  if (!svgEl) return;

  const texts = svgEl.querySelectorAll("text");
  for (const textEl of texts) {
    const content = textEl.textContent ?? "";
    if (!content) continue;

    // Match patterns like "L=1" or "R=100" by parameter name prefix first
    if (paramName && content.startsWith(`${paramName}=`)) {
      textEl.textContent = `${paramName}=${newValue}`;
      continue;
    }

    // Match patterns like "R=100", "100 Ω", or just "100"
    // Be specific: only replace if the text contains the exact old value
    if (oldValue && content.includes(oldValue)) {
      textEl.textContent = content.replace(oldValue, newValue);
    }
  }
}

/**
 * Returns the active AntV X6 graph instance, or `null` if none is initialized.
 */
export function getGraph(): Graph | null {
  return graph;
}

/**
 * Applies a live simulation telemetry state frame to animate diagram nodes and edges.
 */
export function applySimulationFrame(
  stateVector: Record<string, number> | Float64Array,
  varIndexMap?: Map<string, number> | Record<string, number>,
): void {
  if (!graph) return;
  animateCells({ nodes: graph.getNodes(), edges: graph.getEdges() }, stateVector, varIndexMap);
}

/**
 * Toggles the collapsed/expanded visual state of a composite group container node,
 * hiding or restoring its embedded child nodes and resizing the container header.
 */
export function toggleGroupNodeCollapse(node: any): void {
  if (!node) return;
  const data = node.getData?.() || {};
  const isCollapsed = Boolean(data.collapsed);
  const children = node.getChildren?.() || [];

  if (!isCollapsed) {
    const currentSize = typeof node.size === "function" ? node.size() : { width: 240, height: 180 };
    node.setData?.({ ...data, collapsed: true, origWidth: currentSize.width, origHeight: currentSize.height });
    children.forEach((c: any) => c.setVisible?.(false));
    node.resize?.(Math.max(180, currentSize.width), 40);
  } else {
    node.setData?.({ ...data, collapsed: false });
    node.resize?.(data.origWidth || 240, data.origHeight || 180);
    children.forEach((c: any) => c.setVisible?.(true));
  }
}

/**
 * Serializes the active diagram's SVG DOM element into a standalone XML string.
 */
export function exportDiagramSvg(): string {
  if (!graph) return "";
  const svgElem = graph.container?.querySelector("svg");
  return svgElem ? new XMLSerializer().serializeToString(svgElem) : "";
}

/**
 * Renders the active diagram SVG onto an offscreen HTML5 canvas and exports a PNG data URL.
 */
export async function exportDiagramPng(scale = 2): Promise<string> {
  const svgString = exportDiagramSvg();
  if (!svgString || typeof document === "undefined") return "";
  return new Promise((resolve) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = (img.width || 800) * scale;
      canvas.height = (img.height || 600) * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
      }
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("");
    };
    img.src = url;
  });
}

/**
 * Programmatically triggers an interactive widget binding (toggle, momentary button, slider, numeric input)
 * on a diagram component node and dispatches the resulting parameter write action.
 */
export function triggerInteractiveInput(
  nodeId: string,
  variableName: string,
  eventType: "click" | "mousedown" | "mouseup" | "input",
  inputValue?: unknown,
): InteractiveWriteAction | null {
  if (!graph) return null;
  const node = graph.getCellById(nodeId);
  if (!node || !node.isNode()) return null;
  const interactiveBindings: InteractiveBinding[] = node.getData()?.interactive;
  if (!Array.isArray(interactiveBindings)) return null;
  const binding = interactiveBindings.find((b) => b.variableName === variableName);
  if (!binding) return null;
  const action = defaultInteractiveStateManager.handleInteraction(node, binding, eventType, inputValue);
  if (action) {
    enqueueDiagramAction(action);
  }
  return action;
}

export * from "./affine-matrix.js";
export * from "./collab-manager.js";
export * from "./collab-overlay.js";
export * from "./color-inversion.js";
export * from "./fault-tree.js";
export * from "./glyphs.js";
export * from "./html-diff-bundle.js";
export * from "./incremental-layout.js";
export * from "./interactive.js";
export * from "./layout-storage.js";
export * from "./polyglot-diagram-builder.js";
export * from "./port-ilp-solver.js";
export * from "./port-router.js";
export * from "./property-evaluator.js";
export * from "./property-sheet-controller.js";
export * from "./property-validator.js";
export * from "./protocol.js";
export type { ReactiveAnimationBinding, X6Markup } from "./protocol.js";
export * from "./pscad-diagram-builder.js";
export * from "./svg-renderer.js";
export * from "./swimlane-layout.js";
export * from "./telemetry.js";
export type { TopologyEdge, TopologyGraph, TopologyNode } from "./topology.js";
export * from "./tsm-layout.js";
export * from "./visual-diff-graph.js";
export * from "./visual-diff-renderer.js";
