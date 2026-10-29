// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import * as antvLayout from "@antv/layout";
import * as x6 from "@antv/x6";

import {
  clearActiveDropPlaceholder,
  dropComponentGhost,
  ensureDiagramStyles,
  getActiveDropPlaceholder,
  getTypicalNodeSize,
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
  type PointLike,
  type RectLike,
  type RouterNodeLike,
  type RouterPortConfig,
} from "./port-router.js";
import type { ReactiveAnimationBinding } from "./protocol.js";
import { applySequenceLayout } from "./sequence-layout.js";
import { computeEdgeNetIds, computeSolderDots, solderDotToDiagramNode, type EdgePath } from "./solder-dots.js";
import * as Spinner from "./spinner.js";
import { applySwimlaneLayout, type SwimlanePartition } from "./swimlane-layout.js";
import { animateCells } from "./telemetry.js";
import { applyTsmOrthogonalLayout } from "./tsm-layout.js";

export interface EdgeTerminal {
  cell?: string | undefined;
  port?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
}

export interface CellData {
  properties?:
    | {
        className?: string | undefined;
        name?: string | undefined;
        description?: string | undefined;
        ruleName?: string | undefined;
        sourceRange?: { startOffset: number; endOffset: number } | undefined;
        [key: string]: unknown;
      }
    | undefined;
  animations?: ReactiveAnimationBinding[] | undefined;
  interactive?: InteractiveBinding[] | undefined;
  kind?: string | undefined;
  targetModule?: string | undefined;
  wireId?: string | undefined;
  collapsed?: boolean | undefined;
  origWidth?: number | undefined;
  origHeight?: number | undefined;
  [key: string]: unknown;
}

export interface CellView {
  cell: Cell;
  container?: Element | null | undefined;
  routePoints?: PointLike[] | undefined;
}

export interface Cell {
  id: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  source?: EdgeTerminal | undefined;
  target?: EdgeTerminal | undefined;
  isNode(): boolean;
  isEdge(): boolean;
  remove(): void;
  removeTools(): void;
  addTools(tools: unknown[]): void;
  getPosition(): { x: number; y: number };
  setPosition(x: number, y: number, options?: { silent?: boolean | undefined }): void;
  position(x: number, y: number): void;
  getSize(): { width: number; height: number };
  setSize(width: number, height: number): void;
  size?: (() => { width: number; height: number }) | undefined;
  resize?: ((width: number, height: number) => void) | undefined;
  getAngle(): number;
  rotate(angle: number, options?: { absolute?: boolean | undefined }): void;
  translate?: ((dx: number, dy: number) => void) | undefined;
  getBBox(): RectLike;
  getData(): CellData | undefined;
  setData(data: Record<string, unknown>, options?: { overwrite?: boolean | undefined; [key: string]: unknown }): void;
  setMarkup(markup: unknown): void;
  setAttrs(attrs: Record<string, unknown>): void;
  attr(path: string, val?: unknown): unknown;
  setVisible?: ((visible: boolean) => void) | undefined;
  addChild(child: Cell): void;
  getChildren?: (() => Cell[] | null | undefined) | undefined;
  getPorts?: (() => { id: string; [key: string]: unknown }[]) | undefined;
  getPortProp?: ((portId: string, prop?: string) => RouterPortConfig | null | undefined) | undefined;
  getPort?: ((portId: string) => RouterPortConfig | null | undefined) | undefined;
  getSource(): EdgeTerminal;
  setSource(source: EdgeTerminal): void;
  getTarget(): EdgeTerminal;
  setTarget(target: EdgeTerminal): void;
  getSourceCellId(): string;
  getTargetCellId(): string;
  getSourcePortId?: (() => string | undefined) | undefined;
  getTargetPortId?: (() => string | undefined) | undefined;
  getSourceCell?: (() => Cell | null | undefined) | undefined;
  getTargetCell?: (() => Cell | null | undefined) | undefined;
  getSourcePoint(): PointLike;
  getTargetPoint(): PointLike;
  getVertices(): PointLike[];
  setVertices(vertices: PointLike[], options?: { ignoreSnap?: boolean | undefined }): void;
  setRouter?: ((router: unknown) => void) | undefined;
  setConnector?: ((connector: unknown) => void) | undefined;
  setLabels?: ((labels: unknown[]) => void) | undefined;
  findView?: ((graph: Graph) => CellView | null | undefined) | undefined;
}

export type Node = Cell;
export type Edge = Cell;

export interface Graph {
  container: HTMLElement;
  disposed?: boolean | undefined;
  options?: { width?: number | undefined; height?: number | undefined; [key: string]: unknown } | undefined;
  isDisposed?: (() => boolean) | undefined;
  drawBackground(options: { color: string }): void;
  drawGrid(options: Record<string, unknown>): void;
  dispose(): void;
  createEdge(metadata: Record<string, unknown>): Edge;
  use(plugin: unknown): void;
  on<T = Record<string, unknown>>(event: string, handler: (args: T) => void): void;
  addNode(metadata: Record<string, unknown>): Node;
  getCellById(id?: string): Cell | null;
  removeCell(cell: unknown): Cell | null;
  removeCells(cells: Cell[]): Cell[];
  getCells(): Cell[];
  getNodes(): Node[];
  getEdges(): Edge[];
  getConnectedEdges(node: RouterNodeLike): Edge[];
  getSelectedCells(): Cell[];
  unselect(cell: Cell): void;
  findViewByCell(cell: Cell): CellView | null;
  scale(): { sx: number; sy: number };
  translate(tx?: number, ty?: number): { tx: number; ty: number };
  zoom(factor?: number, options?: { absolute?: boolean | undefined }): number;
  resize(width: number, height: number): void;
  zoomToRect(rect: RectLike, options?: Record<string, unknown>): void;
  zoomToFit(options?: Record<string, unknown>): void;
  centerContent(): void;
  batchUpdate(name: string, execute: () => void): void;
  fromJSON(data: { nodes: unknown[]; edges: unknown[] }): void;
  clearCells(): void;
  clientToLocal(x: number, y: number): PointLike;
}

interface GraphConstructor {
  new (options: Record<string, unknown>): Graph;
  registerRouter?: ((name: string, router: unknown, force?: boolean) => void) | undefined;
  registerConnector?:
    | ((
        name: string,
        connector: (
          sourcePoint: PointLike,
          targetPoint: PointLike,
          routePoints?: PointLike[],
          args?: { radius?: number | undefined; [key: string]: unknown },
        ) => string,
        force?: boolean,
      ) => void)
    | undefined;
}

type PluginConstructor = new (options: Record<string, unknown>) => unknown;

interface DagreLayoutResultNode {
  id: string;
  x: number;
  y: number;
}

interface DagreLayoutInstance {
  layout(model: {
    nodes: {
      id?: string | undefined;
      width?: number | undefined;
      height?: number | undefined;
      size?: number[] | undefined;
      [key: string]: unknown;
    }[];
    edges: { source: string; target: string }[];
  }): { nodes?: DagreLayoutResultNode[] | undefined };
}

type DagreLayoutConstructor = new (options: Record<string, unknown>) => DagreLayoutInstance;

const x6Module = x6 as unknown as {
  Graph?: GraphConstructor | undefined;
  Selection?: PluginConstructor | undefined;
  Transform?: PluginConstructor | undefined;
};
const antvLayoutModule = antvLayout as unknown as {
  DagreLayout?: DagreLayoutConstructor | undefined;
};

const Graph: GraphConstructor = x6Module.Graph || (class {} as unknown as GraphConstructor);
const Selection: PluginConstructor = x6Module.Selection || (class {} as unknown as PluginConstructor);
const Transform: PluginConstructor = x6Module.Transform || (class {} as unknown as PluginConstructor);
const DagreLayout: DagreLayoutConstructor =
  antvLayoutModule.DagreLayout || (class {} as unknown as DagreLayoutConstructor);

export {
  clearActiveDropPlaceholder,
  computeEdgeNetIds,
  dropComponentGhost,
  ensureDiagramStyles,
  getActiveDropPlaceholder,
  getTypicalNodeSize,
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
      (
        sourcePoint: PointLike,
        targetPoint: PointLike,
        routePoints: PointLike[] = [],
        args: { radius?: number | undefined } = {},
      ) => {
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
      (sourcePoint: PointLike, targetPoint: PointLike, routePoints: PointLike[] = []) => {
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
      (sourcePoint: PointLike, targetPoint: PointLike, routePoints: PointLike[] = []) => {
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
      (
        sourcePoint: PointLike,
        targetPoint: PointLike,
        routePoints: PointLike[] = [],
        args: { radius?: number | undefined } = {},
      ) => {
        const points = [sourcePoint, ...routePoints, targetPoint];
        return computeFilletedOrthogonalPath(points, args.radius ?? 5);
      },
      true,
    );
  } catch {
    // Already registered or duplicate in HMR
  }
}

export interface DiagramHostMessage {
  type: string;
  componentName?: string | undefined;
  className?: string | undefined;
  diagramType?: string | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  [key: string]: unknown;
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
  onAction?: ((action: Record<string, unknown> | InteractiveWriteAction) => void) | undefined;
  /** Callback invoked when the selected component node changes (or `null` when deselected). */
  onSelect?: ((id: string | null) => void) | undefined;
  /** Callback invoked to display or update the component properties inspection panel. */
  onShowProperties?: ((nodeId: string, cachedProps?: unknown, isLoading?: boolean) => void) | undefined;
  /** Callback invoked when the user triggers an Undo keyboard shortcut (`Ctrl+Z` / `Cmd+Z`). */
  onUndo?: (() => void) | undefined;
  /** Callback invoked when the user triggers a Redo keyboard shortcut (`Ctrl+Y` / `Cmd+Shift+Z`). */
  onRedo?: (() => void) | undefined;
  /** Generic message callback for non-action messages (revealSource, navigateTo, etc.) */
  onMessage?: ((msg: DiagramHostMessage) => void) | undefined;
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
function enqueueDiagramAction(action: Record<string, unknown> | InteractiveWriteAction) {
  if (currentOptions?.onAction) currentOptions.onAction(action);
}

/**
 * Forwards host-bound messages (`undo`, `redo`, `getProperties`, `revealSource`, `navigateTo`)
 * to the appropriate callback in `currentOptions`.
 */
function postMessageToHost(msg: DiagramHostMessage) {
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
    if (currentOptions?.onShowProperties && msg.componentName) {
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
/** Tracks currently rendered sub-module / class name to detect transitions. */
let lastRenderedModule: string | null = null;

/** Cache for on-demand component properties (cleared on diagram re-render) */

const propertyCache = new Map<string, unknown>();

export { translateConnectedEdgeStubs };

/**
 * Automatically re-routes an edge with clean, obstacle-avoiding Manhattan A* paths
 * that respect port outward normals and avoid component self-impalement.
 */
export function rerouteEdgeOrthogonal(edge: Edge | null | undefined, g: Graph): void {
  if (!edge || !edge.isEdge()) return;
  const source = edge.getSource();
  const target = edge.getTarget();
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

  const points = [sourcePoint, ...intermediateVertices, targetPoint].map((p: PointLike) => ({
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

  node: Node,
): { source: string; target: string; points: { x: number; y: number }[] }[] {
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
    const rawPts = [sourcePoint, ...vertices, targetPoint].filter((p): p is PointLike => Boolean(p));
    const regularized = regularizeOrthogonalPolyline(rawPts, 2, 1.0);
    const points = regularized.map((p: PointLike) => ({
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
    interacting: (cellView: { cell: { id: string } }) => {
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
      validateConnection: ({
        sourceCell,
        targetCell,
      }: {
        sourceCell?: { id: string } | null | undefined;
        targetCell?: { id: string } | null | undefined;
      }) => {
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
      enqueueDiagramAction({ type: "addComponent", className: dataToPlace.className, x: snappedX, y: snappedY });
    }
  };

  const win = typeof window !== "undefined" ? (window as unknown as DiagramWindow) : null;

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

  g.on("blank:click", ({ x, y }: { x: number; y: number }) => handlePlacementClick(x, y));
  g.on("cell:click", ({ x, y }: { x: number; y: number }) => handlePlacementClick(x, y));

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearPlacement();
      clearActiveDropPlaceholder();
      const existingPlaceholder = g.getCellById?.("__drop_placeholder__");
      if (existingPlaceholder) {
        g.removeCell?.(existingPlaceholder);
      }
    }
  });

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
  }

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

      const items: {
        name: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
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

  g.on("node:rotated", ({ node }: { node: Node }) => {
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

  g.on("node:resized", ({ node }: { node: Node }) => {
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
  const edgePriorEndpoints = new Map<string, { source: EdgeTerminal; target: EdgeTerminal }>();
  g.on("edge:mouseenter", ({ edge }: { edge: Edge }) => {
    if (edge?.id) edgePriorEndpoints.set(edge.id, { source: edge.getSource(), target: edge.getTarget() });
  });
  g.on("edge:selected", ({ edge }: { edge: Edge }) => {
    if (edge?.id) edgePriorEndpoints.set(edge.id, { source: edge.getSource(), target: edge.getTarget() });
  });

  // Edge connected (handles both new edge creation and terminal dragging reconnection)

  g.on("edge:connected", ({ isNew, edge }: { isNew?: boolean | undefined; edge: Edge }) => {
    if (isRenderingDiagram) return;

    const source = edge.getSource();

    const target = edge.getTarget();
    if (!source?.cell || !target?.cell) return;

    const sourceCell = g.getCellById(source.cell);
    const targetCell = g.getCellById(target.cell);

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
    } else if (source.port !== undefined) {
      srcStr = `${source.cell}.${source.port}`;
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
      const edgeView = g.findViewByCell(edge);
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
  g.on(
    "edge:change:vertices",
    ({ edge, options }: { edge: Edge; options?: { ignoreSnap?: boolean | undefined } | undefined }) => {
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
            (nv: PointLike, idx: number) =>
              Math.abs(nv.x - (vertices[idx]?.x ?? 0)) > 0.5 || Math.abs(nv.y - (vertices[idx]?.y ?? 0)) > 0.5,
          );

        if (changed) {
          edge.setVertices(newVertices, { ignoreSnap: true });
        }
      }

      if (edgeUpdateTimeout) clearTimeout(edgeUpdateTimeout);
      edgeUpdateTimeout = setTimeout(() => {
        const source = edge.getSource();

        const target = edge.getTarget();
        const wireId = edge.getData()?.wireId;
        if ((source?.cell && target?.cell) || wireId) {
          const curVertices = edge.getVertices() || [];
          const srcPt = edge.getSourcePoint();
          const tgtPt = edge.getTargetPoint();
          const points = [srcPt, ...curVertices, tgtPt].map((p: PointLike) => ({
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
    },
  );

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
      if (!isRenderingDiagram && !isSnappingPortAlignment && cell && cell.isNode() && current && previous) {
        if (!isEphemeralDiagramNode(cell.id)) {
          let snapDx = 0;
          let snapDy = 0;
          let guideX: { x: number; y1: number; y2: number } | null = null;
          let guideY: { y: number; x1: number; x2: number } | null = null;
          const snapThreshold = 4;

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
    },
  );
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

  // Quick re-route orthogonal on edge double-click or context menu
  g.on("edge:dblclick", ({ edge }: { edge: Edge }) => {
    if (edge && edge.isEdge()) {
      rerouteEdgeOrthogonal(edge, g);
    }
  });

  g.on("edge:contextmenu", ({ edge, e }: { edge: Edge; e: MouseEvent }) => {
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
          const source = cell.getSource();

          const target = cell.getTarget();
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

  g.on("node:mousedown", ({ node }: { node: Node }) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const interactiveBindings = node.getData()?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "momentary") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "mousedown");
          if (action) enqueueDiagramAction(action);
        }
      }
    }
  });

  g.on("node:mouseup", ({ node }: { node: Node }) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const interactiveBindings = node.getData()?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "momentary") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "mouseup");
          if (action) enqueueDiagramAction(action);
        }
      }
    }
  });

  g.on("node:click", ({ node }: { node: Node }) => {
    if (!graph) return;
    if (isEphemeralDiagramNode(node.id)) {
      selectedNodeId = null;
      if (currentOptions?.onSelect) currentOptions.onSelect(null);
      return;
    }
    selectedNodeId = node.id;
    const data = node.getData();

    // Module link button single-click navigation (e.g. 'More on Passive Elements' in PSCAD library)
    if (data?.kind === "module-link" && data.targetModule) {
      postMessageToHost({
        type: "navigateTo",
        className: data.targetModule,
        diagramType: "All",
      });
      return;
    }

    // Process interactive bindings on click (toggle, numeric, selector, faceplate)
    const interactiveBindings = data?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "toggle" || binding.action === "faceplate") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "click");
          if (action) enqueueDiagramAction(action);
        } else if (binding.action === "numeric" || binding.action === "slider") {
          if (win && typeof win.prompt === "function") {
            const current = defaultInteractiveStateManager.getValue(node.id, binding.variableName, binding.min ?? 0);
            const unitLabel = binding.unit ? ` [${binding.unit}]` : "";
            const rangeLabel =
              binding.min !== undefined && binding.max !== undefined ? ` (${binding.min} - ${binding.max})` : "";
            const input = win.prompt(
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
    if (data?.kind === "module-link" && data.targetModule) {
      postMessageToHost({
        type: "navigateTo",
        className: data.targetModule,
        diagramType: "All",
      });
      return;
    }
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

interface PlacementData {
  className: string;
  classKind: string;
  iconSvg?: string | undefined;
  isDrag?: boolean | undefined;
}

interface DiagramWindow {
  __lastCanvasPos?: PointLike | undefined;
  __startPlacement?: ((data: PlacementData) => void) | undefined;
  __movePlacementGhost?: ((x: number, y: number, e?: { buttons?: number | undefined }) => void) | undefined;
  __hidePlacementGhost?: (() => void) | undefined;
  __clearPlacement?: (() => void) | undefined;
  __handlePlacementClick?: ((x: number, y: number) => void) | undefined;
  __handleDragEnd?: (() => void) | undefined;
  __setPointerOverCanvas?: ((over: boolean, pos?: PointLike) => void) | undefined;
  __getPlacementData?: (() => PlacementData | null) | undefined;
  __rerouteEdgeOrthogonal?: ((edgeId: string) => void) | undefined;
  debugSolderDotsInfo?: string | undefined;
  prompt?: ((message?: string, _default?: string) => string | null) | undefined;
  event?: { buttons?: number | undefined } | Event | undefined;
}

export interface RenderDiagramNodeInput {
  id: string;
  x?: number | undefined;
  y?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  angle?: number | undefined;
  zIndex?: number | undefined;
  opacity?: number | undefined;
  markup?: unknown;
  ports?: unknown;
  properties?:
    | {
        className?: string | undefined;
        name?: string | undefined;
        description?: string | undefined;
        ruleName?: string | undefined;
        sourceRange?: { startOffset: number; endOffset: number } | undefined;
      }
    | undefined;
  animations?:
    | {
        componentName?: string | undefined;
        cellId?: string | undefined;
        property: string;
        variableName: string;
        transform?: string | undefined;
      }[]
    | undefined;
  interactive?: InteractiveBinding[] | undefined;
  data?:
    | {
        properties?:
          | {
              className?: string | undefined;
              name?: string | undefined;
              description?: string | undefined;
              ruleName?: string | undefined;
              sourceRange?: { startOffset: number; endOffset: number } | undefined;
            }
          | undefined;
        kind?: string | undefined;
        targetModule?: string | undefined;
      }
    | Record<string, unknown>
    | undefined;
  autoLayout?: boolean | undefined;
  attrs?: Record<string, Record<string, unknown> | undefined> | undefined;
  shape?: string | undefined;
  parent?: string | undefined;
}

export interface RenderDiagramEdgeInput {
  id: string;
  shape?: string | undefined;
  zIndex?: number | undefined;
  source: string | { cell: string; port?: string | undefined; x?: number | undefined; y?: number | undefined };
  target: string | { cell: string; port?: string | undefined; x?: number | undefined; y?: number | undefined };
  vertices?: { x: number; y: number }[] | undefined;
  connector?: unknown;
  router?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
  attrs?:
    | {
        line?: Record<string, unknown> | undefined;
      }
    | Record<string, Record<string, unknown> | undefined>
    | undefined;
  labels?:
    | {
        attrs?:
          | {
              text?:
                | {
                    text?: string | undefined;
                    fill?: string | undefined;
                    fontSize?: number | undefined;
                    fontFamily?: string | undefined;
                    fontStyle?: string | undefined;
                  }
                | undefined;
              rect?:
                | {
                    fill?: string | undefined;
                    stroke?: string | undefined;
                    rx?: number | undefined;
                    ry?: number | undefined;
                  }
                | undefined;
            }
          | undefined;
        position?:
          | number
          | { distance?: number | undefined; offset?: number | undefined }
          | Record<string, unknown>
          | undefined;
      }[]
    | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface RenderDiagramInput {
  nodes: RenderDiagramNodeInput[];
  edges: RenderDiagramEdgeInput[];
  diagramType?: string | undefined;
  partitions?: SwimlanePartition[] | undefined;
  layout?: string | undefined;
  coordinateSystem?:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
      }
    | null
    | undefined;
  diagramBackground?: unknown;
  breadcrumbs?: { id: string; label: string }[] | undefined;
  metadata?:
    | {
        breadcrumbs?: { id: string; label: string }[] | undefined;
        currentModule?: string | undefined;
      }
    | undefined;
  className?: string | undefined;
  isLoading?: boolean | undefined;
}

interface RenderNodeData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number | undefined;
  zIndex?: number | undefined;
  opacity?: number | undefined;
  markup?: unknown;
  ports?: unknown;
  data?: CellData | undefined;
  autoLayout?: boolean | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  shape?: string | undefined;
  parent?: string | undefined;
  children?: unknown;
  [key: string]: unknown;
}

interface RenderEdgeData {
  id: string;
  shape?: string | undefined;
  zIndex?: number | undefined;
  source: string | { cell: string; port?: string | undefined; x?: number | undefined; y?: number | undefined };
  target: string | { cell: string; port?: string | undefined; x?: number | undefined; y?: number | undefined };
  vertices?: { x: number; y: number }[] | undefined;
  connector?: unknown;
  router?: string | { name: string; args?: Record<string, unknown> | undefined } | undefined;
  attrs?:
    | {
        "z-index"?: string | undefined;
        line?:
          | {
              stroke?: string | undefined;
              strokeWidth?: number | undefined;
              strokeDasharray?: string | undefined;
              targetMarker?: unknown;
              [key: string]: unknown;
            }
          | undefined;
        [key: string]: Record<string, unknown> | string | undefined;
      }
    | undefined;
  labels?:
    | {
        attrs?:
          | {
              text?:
                | {
                    text?: string | undefined;
                    fill?: string | undefined;
                    fontSize?: number | undefined;
                    fontFamily?: string | undefined;
                    fontStyle?: string | undefined;
                    [key: string]: unknown;
                  }
                | undefined;
              rect?:
                | {
                    fill?: string | undefined;
                    stroke?: string | undefined;
                    rx?: number | undefined;
                    ry?: number | undefined;
                    [key: string]: unknown;
                  }
                | undefined;
              [key: string]: unknown;
            }
          | undefined;
        position?:
          | number
          | { distance?: number | undefined; offset?: number | undefined; [key: string]: unknown }
          | undefined;
        [key: string]: unknown;
      }[]
    | undefined;
  data?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

/**
 * Renders (or incrementally diffs and updates) a polyglot diagram model onto the AntV X6 graph canvas,
 * executing hierarchical Dagre/sequence/swimlane/TSM layouts and updating topological solder dots.
 */
export function renderDiagram(data: RenderDiagramInput, isDark: boolean) {
  const g = initGraph(isDark);
  if (!g) return;

  isRenderingDiagram = true;
  try {
    renderDiagramInternal(g, data, isDark);
  } finally {
    isRenderingDiagram = false;
  }
}

function renderDiagramInternal(g: Graph, data: RenderDiagramInput, isDark: boolean) {
  // Clean up any remaining drop placeholder or placement ghost when real diagram data arrives.
  // Retain the drop placeholder if incoming data does not yet contain the newly dropped component
  // (e.g. while language server is still indexing), preventing any visual gap where the component disappears.
  const existingPlaceholder = g.getCellById("__drop_placeholder__");
  const activeDrop = getActiveDropPlaceholder();

  const currentCells = g.getCells();
  const existingNonEphemeralNodeIds = new Set<string>();
  for (const c of currentCells) {
    if (c.isNode() && !isEphemeralDiagramNode(c.id)) {
      existingNonEphemeralNodeIds.add(c.id);
    }
  }

  // A drop is considered present in the new data if:
  // 1. data.nodes contains a non-ephemeral node that did not exist in existing cells, OR
  // 2. data.nodes contains a node close to activeDrop.x, activeDrop.y, OR
  // 3. more than 5 seconds have passed (safety timeout)
  const isSafetyTimeout = activeDrop ? Date.now() - activeDrop.timestamp > 3000 : false;
  const isComponentPresentInData =
    !activeDrop ||
    isSafetyTimeout ||
    data?.nodes?.some((n: RenderDiagramNodeInput) => {
      if (isEphemeralDiagramNode(n.id)) return false;
      if (!existingNonEphemeralNodeIds.has(n.id)) return true;
      const nDataProps = (n.data as { properties?: { className?: string | undefined } | undefined } | undefined)
        ?.properties;
      const typeMatch =
        (nDataProps?.className && nDataProps.className === activeDrop.className) ||
        (n.properties?.className && n.properties.className === activeDrop.className);
      if (typeMatch) return true;
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      const dx = Math.abs(nx - activeDrop.x);
      const dy = Math.abs(ny - activeDrop.y);
      const dyInverted = Math.abs(-ny - activeDrop.y);
      return dx < 40 && (dy < 40 || dyInverted < 40);
    });

  if (activeDrop && !isComponentPresentInData) {
    // Stale diagram data received (the new component is not yet in data.nodes).
    // DO NOT remove __drop_placeholder__! Keep it visible and pulsing so the component
    // does not disappear while the language server is indexing.
  } else {
    // The real component is present in data.nodes (or no active drop is pending).
    // Reveal the real component immediately without waiting for remaining bounce time!
    if (existingPlaceholder) {
      g.removeCell(existingPlaceholder);
    }
    clearActiveDropPlaceholder();
  }

  const ghost = g.getCellById("placement-ghost");
  if (ghost) g.removeCell(ghost);

  // Build nodes from diagram data

  const nodes: RenderNodeData[] = [];

  const edges: RenderEdgeData[] = [];

  for (const node of data.nodes) {
    let normalizedPorts = node.ports;
    if (Array.isArray(node.ports)) {
      const portStroke = isDark ? "#38bdf8" : "#0284c7";
      const portFill = isDark ? "#0f172a" : "#ffffff";
      normalizedPorts = {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: { r: 4, magnet: true, stroke: portStroke, fill: portFill, strokeWidth: 1.5 },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: { r: 4, magnet: true, stroke: portStroke, fill: portFill, strokeWidth: 1.5 },
            },
          },
        },
        items: (node.ports as { id?: string; name?: string; direction?: string }[]).map((p, idx) => ({
          id: p.id || p.name || `port_${idx}`,
          group: p.direction === "in" || p.id === "in" ? "in" : "out",
        })),
      };
    }

    const nodeData: RenderNodeData = {
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? 180,
      height: node.height ?? 70,
      angle: node.angle,
      zIndex: node.zIndex,
      opacity: node.opacity,
      markup: node.markup,
      ports: normalizedPorts,
      data: {
        properties: node.properties,
        animations: node.animations as ReactiveAnimationBinding[] | undefined,
        interactive: node.interactive,
        ...(node.data || {}),
      },
      autoLayout: node.autoLayout,
    };
    // Forward polyglot X6 attrs and shape (selector-based rendering)
    if (node.attrs) {
      const attrsCopy = { ...(node.attrs as Record<string, Record<string, unknown>>) };
      const rawNodeLabel = (node as { label?: string }).label;
      if (rawNodeLabel && (!attrsCopy["label"] || attrsCopy["label"]["text"] === undefined)) {
        attrsCopy["label"] = { ...(attrsCopy["label"] || {}), text: rawNodeLabel };
      }
      if (!isDark) {
        const bodyFill = attrsCopy["body"]?.["fill"];
        if (bodyFill === "#1e1e1e" || bodyFill === "#1e293b" || bodyFill === "#0f172a") {
          attrsCopy["body"] = { ...attrsCopy["body"], fill: "#ffffff" };
        }
        const labelFill = attrsCopy["label"]?.["fill"];
        if (labelFill === "#e0e0e0" || labelFill === "#f8fafc" || labelFill === "#f1f5f9") {
          attrsCopy["label"] = { ...attrsCopy["label"], fill: "#0f172a" };
        }
        const subFill = attrsCopy["subtitle"]?.["fill"];
        if (subFill === "#94a3b8" || subFill === "#cbd5e1") {
          attrsCopy["subtitle"] = { ...attrsCopy["subtitle"], fill: "#475569" };
        }
        for (const [selKey, selVal] of Object.entries(attrsCopy)) {
          if (selKey.startsWith("entry_") && selVal && typeof selVal === "object") {
            const ef = selVal["fill"];
            if (ef === "#cbd5e1" || ef === "#e2e8f0" || ef === "#f8fafc") {
              attrsCopy[selKey] = { ...selVal, fill: "#334155" };
            }
          }
        }
      }
      nodeData.attrs = attrsCopy;
    } else if (!node.markup) {
      const rawLabel =
        (node as { label?: string; name?: string }).label ||
        (node as { name?: string }).name ||
        node.properties?.name ||
        node.id;
      const rawKind = (node as { kind?: string }).kind || node.properties?.className || "component";
      const lines = String(rawLabel).split(/\r?\n/);
      const titleText = lines[0] || node.id;
      const subText = lines.slice(1).join(" ");
      const strokeColor = isDark ? "#38bdf8" : "#0284c7";
      const bodyFill = isDark ? "#1e293b" : "#f8fafc";
      const titleFill = isDark ? "#f1f5f9" : "#0f172a";
      const subFill = isDark ? "#94a3b8" : "#475569";

      nodeData.markup = [
        { tagName: "rect", selector: "body" },
        { tagName: "text", selector: "stereotype" },
        { tagName: "text", selector: "label" },
        ...(subText ? [{ tagName: "text", selector: "subtitle" }] : []),
      ];
      nodeData.attrs = {
        body: {
          fill: bodyFill,
          stroke: strokeColor,
          strokeWidth: 1.5,
          rx: 6,
          ry: 6,
          refWidth: "100%",
          refHeight: "100%",
        },
        stereotype: {
          text: `«${String(rawKind).toLowerCase()}»`,
          fill: strokeColor,
          fontSize: 10,
          fontStyle: "italic",
          textAnchor: "middle",
          textVerticalAnchor: "top",
          refX: 0.5,
          refY: 6,
        },
        label: {
          text: titleText,
          fill: titleFill,
          fontSize: 12,
          fontWeight: "bold",
          textAnchor: "middle",
          textVerticalAnchor: "top",
          refX: 0.5,
          refY: subText ? 22 : 26,
        },
        ...(subText
          ? {
              subtitle: {
                text: subText,
                fill: subFill,
                fontSize: 10,
                textAnchor: "middle",
                textVerticalAnchor: "top",
                refX: 0.5,
                refY: 42,
              },
            }
          : {}),
      };
    }
    if (node.shape) nodeData.shape = node.shape;
    if (node.parent) nodeData.parent = node.parent;
    nodes.push(nodeData);
  }

  for (const edge of data.edges) {
    const rawEdge = edge as {
      sourcePort?: string | undefined;
      targetPort?: string | undefined;
      style?: Record<string, unknown> | undefined;
    };
    const resolvedSource =
      typeof edge.source === "string" && rawEdge.sourcePort
        ? { cell: edge.source, port: rawEdge.sourcePort }
        : edge.source;
    const resolvedTarget =
      typeof edge.target === "string" && rawEdge.targetPort
        ? { cell: edge.target, port: rawEdge.targetPort }
        : edge.target;

    const edgeData: RenderEdgeData = {
      id: edge.id,
      shape: edge.shape ?? "edge",
      zIndex: edge.zIndex,
      source: resolvedSource,
      target: resolvedTarget,
      vertices: edge.vertices,
      connector: edge.connector ?? { name: "rounded", args: { radius: 8 } },
      router: edge.router ?? { name: "normal" },
    };
    // Polyglot edges pass attrs as a full selector-keyed object;
    // Modelica edges have attrs.line specifically
    const edgeAttrs = edge.attrs as
      | { line?: Record<string, unknown> | undefined; [key: string]: Record<string, unknown> | undefined }
      | undefined;
    if (edgeAttrs?.line) {
      const lineCopy = { ...edgeAttrs.line };
      const tm = lineCopy["targetMarker"] as Record<string, unknown> | undefined;
      if (!isDark && tm && typeof tm === "object" && tm["fill"] === "#1e1e1e") {
        lineCopy["targetMarker"] = { ...tm, fill: "#ffffff" };
      }
      edgeData.attrs = { "z-index": "-10", line: lineCopy };
    } else if (edgeAttrs) {
      edgeData.attrs = edgeAttrs;
    } else {
      edgeData.attrs = {
        line: {
          stroke: isDark ? "#64748b" : "#475569",
          strokeWidth: 1.5,
          targetMarker: {
            name: "block",
            width: 8,
            height: 6,
          },
        },
      };
    }
    // Forward labels (polyglot edge stereotypes like «connect», «satisfy», or PSS/E branch labels)
    if (edge.labels) {
      edgeData.labels = (edge.labels as RenderEdgeData["labels"])?.map((lbl) => {
        if (!lbl || typeof lbl !== "object" || !lbl.attrs) return lbl;
        const rectAttr = lbl.attrs.rect as Record<string, unknown> | undefined;
        const textAttr = lbl.attrs.text as Record<string, unknown> | undefined;
        const rectFill = rectAttr?.["fill"];
        if (rectFill === "#1e1e1e" || rectFill === "#1e293b" || rectFill === "#0f172a") {
          const textFill = typeof textAttr?.["fill"] === "string" ? textAttr["fill"] : undefined;
          const adaptedTextFill: string = isDark
            ? textFill === "#999"
              ? "#cbd5e1"
              : (textFill ?? "#cbd5e1")
            : textFill === "#c084fc"
              ? "#7e22ce"
              : "#334155";
          return {
            ...lbl,
            attrs: {
              ...lbl.attrs,
              text: {
                ...(textAttr || {}),
                fill: adaptedTextFill,
                fontFamily: (textAttr?.["fontFamily"] as string | undefined) ?? "Inter, system-ui, sans-serif",
              },
              rect: {
                ...(rectAttr || {}),
                fill: isDark ? "#0f172a" : "#f8fafc",
                stroke: isDark ? "#334155" : "#cbd5e1",
                strokeWidth: 1,
                rx: 4,
                ry: 4,
              },
            },
          };
        }
        return lbl;
      });
    } else if ((edge as { label?: string }).label) {
      const rawEdgeLabel = (edge as { label?: string }).label!;
      edgeData.labels = [
        {
          attrs: {
            text: {
              text: rawEdgeLabel,
              fill: isDark ? "#cbd5e1" : "#334155",
              fontSize: 10,
              fontFamily: "Inter, system-ui, sans-serif",
            },
            rect: {
              fill: isDark ? "#0f172a" : "#f8fafc",
              stroke: isDark ? "#334155" : "#cbd5e1",
              strokeWidth: 1,
              rx: 4,
              ry: 4,
            },
          },
          position: 0.5,
        },
      ];
    }
    if (edge.data || rawEdge.style) {
      edgeData.data = { ...(rawEdge.style || {}), ...(edge.data || {}) };
    }
    edges.push(edgeData);
  }

  // Add diagram background if present
  if (data.coordinateSystem) {
    const cs = data.coordinateSystem;

    const children: unknown[] = [
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
  } else if (data.partitions && data.partitions.length > 0) {
    applySwimlaneLayout({ nodes, edges }, data.partitions);
  } else if (data.layout === "tsm-orthogonal" || data.layout === "orthogonal") {
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
          const s = typeof e.source === "string" ? e.source : e.source.cell;
          const t = typeof e.target === "string" ? e.target : e.target.cell;
          return childIds.has(s) && childIds.has(t);
        })
        .map((e) => ({
          source: typeof e.source === "string" ? e.source : e.source.cell,
          target: typeof e.target === "string" ? e.target : e.target.cell,
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
          subEdges.push({ source: isolatedSub[i]!, target: isolatedSub[i + cols]! });
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

      const subResult = subDagre.layout(subModel);

      let minX = Infinity;
      let minY = Infinity;
      const layoutCoords = new Map<string, { leftX: number; topY: number }>();

      subResult.nodes?.forEach((laid: DagreLayoutResultNode) => {
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
      const tabAttr = parentNode.attrs?.["tab"] as { width?: number | undefined } | undefined;
      const minParentWidth = tabAttr?.width ? Math.round(tabAttr.width + 30) : 220;
      parentNode.width = Math.max(maxRight, minParentWidth);
      parentNode.height = Math.max(maxBottom, 80);
    }

    // ── Phase 2: Top-level Dagre layout with expanded container sizes ──
    const nodesToLayout: string[] = [];

    nodes.forEach((node: RenderNodeData) => {
      if (node.autoLayout && !node.parent) {
        nodesToLayout.push(node.id ?? "");
      }
    });

    if (nodesToLayout.length > 0) {
      const isUpwardHierarchyEdge = (e: RenderEdgeData): boolean => {
        const edgeType = e.data?.["type"];
        return (
          edgeType === "subClassOf" ||
          edgeType === "inferredSubClassOf" ||
          edgeType === "classAssertion" ||
          edgeType === "domain" ||
          edgeType === "specialization"
        );
      };
      const isHorizontalPeerEdge = (e: RenderEdgeData): boolean => {
        if (e.data?.["isHorizontalPeer"] === true) return true;
        const edgeType = e.data?.["type"];
        return (
          edgeType === "disjointWith" ||
          edgeType === "equivalentTo" ||
          edgeType === "inverseOf" ||
          edgeType === "objectPropertyAssertion" ||
          edgeType === "sameAs" ||
          edgeType === "differentFrom"
        );
      };
      const hasHierarchyEdges = edges.some(isUpwardHierarchyEdge);

      const dagreLayout = new DagreLayout({
        type: "dagre",
        rankdir: "TB",
        ...(hasHierarchyEdges ? {} : { align: "UL" }),
        ranksep: hasHierarchyEdges ? 92 : 60,
        nodesep: hasHierarchyEdges ? 56 : 60,
        begin: [20, 20],
        controlPoints: true,
      });

      const modelEdges = edges
        .filter((e) => {
          const s = typeof e.source === "string" ? e.source : e.source.cell;
          const t = typeof e.target === "string" ? e.target : e.target.cell;
          if (!nodesToLayout.includes(s) || !nodesToLayout.includes(t)) return false;
          if (hasHierarchyEdges && isHorizontalPeerEdge(e)) return false;
          return true;
        })
        .map((e) => {
          const s = typeof e.source === "string" ? e.source : e.source.cell;
          const t = typeof e.target === "string" ? e.target : e.target.cell;
          if (isUpwardHierarchyEdge(e)) {
            return { source: t, target: s };
          }
          return { source: s, target: t };
        });

      // Inject fake edges to wrap isolated top-level packages into 2 rows
      const connectedTop = new Set<string>();
      edges.forEach((e) => {
        const s = typeof e.source === "string" ? e.source : e.source.cell;
        const t = typeof e.target === "string" ? e.target : e.target.cell;
        connectedTop.add(s);
        connectedTop.add(t);
      });
      const isolatedTop = nodes
        .filter((n) => nodesToLayout.includes(n.id ?? ""))
        .filter((n) => !connectedTop.has(n.id ?? ""))
        .map((n) => n.id ?? "");
      if (isolatedTop.length > 2) {
        const cols = Math.ceil(Math.sqrt(isolatedTop.length));
        for (let i = 0; i < isolatedTop.length - cols; i++) {
          modelEdges.push({ source: isolatedTop[i]!, target: isolatedTop[i + cols]! });
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

      const newModel = dagreLayout.layout(model);

      newModel.nodes?.forEach((n: DagreLayoutResultNode) => {
        const node = nodes.find((no: RenderNodeData) => no.id === n.id);
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
      if (activeDrop && isComponentPresentInData) {
        const ph = g.getCellById("__drop_placeholder__");
        if (ph) g.removeCell(ph);
        clearActiveDropPlaceholder();
      }
      // ── Fast path: incremental update ──
      g.batchUpdate("diagram-diff", () => {
        if (!data.coordinateSystem) {
          const bg = g.getCellById("__diagram_background__");
          if (bg) g.removeCell(bg);
          const axes = g.getCellById("__diagram_axes__");
          if (axes) g.removeCell(axes);
        }

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

        // Update edge vertices, endpoints, attrs, labels, router, and data
        for (const edgeData of edges) {
          const cell = g.getCellById(edgeData.id);
          if (!cell || !cell.isEdge()) continue;

          if (edgeData.vertices) {
            const curVerts = cell.getVertices() || [];
            const vertsChanged =
              curVerts.length !== edgeData.vertices.length ||
              curVerts.some(
                (v: PointLike, idx: number) =>
                  Math.abs(v.x - (edgeData.vertices![idx]?.x ?? 0)) > 0.5 ||
                  Math.abs(v.y - (edgeData.vertices![idx]?.y ?? 0)) > 0.5,
              );
            if (vertsChanged) {
              cell.setVertices(edgeData.vertices, { ignoreSnap: true });
            }
          }
          if (edgeData.source && typeof edgeData.source === "object") {
            const curSrc = cell.getSource();
            if (curSrc?.cell !== edgeData.source.cell || curSrc?.port !== edgeData.source.port) {
              cell.setSource(edgeData.source);
            }
          }
          if (edgeData.target && typeof edgeData.target === "object") {
            const curTgt = cell.getTarget();
            if (curTgt?.cell !== edgeData.target.cell || curTgt?.port !== edgeData.target.port) {
              cell.setTarget(edgeData.target);
            }
          }
          if (edgeData.router) {
            cell.setRouter?.(edgeData.router);
          }
          if (edgeData.connector) {
            cell.setConnector?.(edgeData.connector);
          }
          if (edgeData.labels) {
            cell.setLabels?.(edgeData.labels);
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

  // If a drop placeholder was active and the new component has NOT yet arrived in data.nodes,
  // keep the placeholder visible until the real component arrives.
  // If the new component IS present, it is already rendered in g.fromJSON — do not cover it up!
  if (activeDrop && !isComponentPresentInData) {
    const { width, height } = getTypicalNodeSize(g);
    dropComponentGhost(g, activeDrop.x, activeDrop.y, activeDrop.className, activeDrop.iconSvg, isDark, width, height);
  } else if (activeDrop && isComponentPresentInData) {
    clearActiveDropPlaceholder();
  }

  // 3. Programmatically establish all embedding relationships via standard API
  for (const [childId, parentId] of relations) {
    const parentCell = g.getCellById(parentId);
    const childCell = g.getCellById(childId);
    if (parentCell && childCell && parentCell.isNode() && childCell.isNode()) {
      parentCell.addChild(childCell);
    }
  }

  updateBreadcrumbs(data.breadcrumbs || data.metadata?.breadcrumbs);

  const currentModule = data.metadata?.currentModule ?? data.className ?? null;
  const moduleChanged = lastRenderedModule !== null && currentModule !== null && lastRenderedModule !== currentModule;
  lastRenderedModule = currentModule;

  // Only fit view on first render or when switching modules — preserve zoom/pan on subsequent updates
  if (isFirstRender || moduleChanged) {
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
        if (g && (typeof g.isDisposed === "function" ? !g.isDisposed() : true)) {
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
    if (graph === g && !g.disposed) {
      updateSolderDots(g);
    }
  }, 50);
}

// Handle deferred diagram updates to avoid interrupting active interactions
let isMouseDown = false;

let pendingDiagramData: { data: RenderDiagramInput; isDark: boolean } | null = null;

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
      if (pendingDiagramData) {
        const pd = pendingDiagramData;
        pendingDiagramData = null;
        if (pd.data?.isLoading) {
          Spinner.show();
        }
        renderDiagram(pd.data, pd.isDark);
        if (!pd.data?.isLoading) {
          Spinner.hide();
        }
      }
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
    const win = window as unknown as DiagramWindow;
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
          renderDiagram(message.data, message.isDark ?? true);
          if (!message.data?.isLoading) {
            Spinner.hide();
          }
        }
        break;
      }
      case "dragEnd": {
        if (!graph) return;
        win.__handleDragEnd?.();
        break;
      }
      case "workbenchDragOver": {
        if (!graph) return;
        const { clientX, clientY } = message;
        if (typeof clientX === "number" && typeof clientY === "number") {
          const p = graph.clientToLocal(clientX, clientY);
          const snappedX = Math.round(p.x / 20) * 20;
          const snappedY = Math.round(p.y / 20) * 20;
          win.__movePlacementGhost?.(snappedX, snappedY);
        }
        break;
      }
      case "workbenchDrop": {
        if (!graph) return;
        const { clientX, clientY } = message;
        const targetX = typeof clientX === "number" ? clientX : win.__lastCanvasPos?.x;
        const targetY = typeof clientY === "number" ? clientY : win.__lastCanvasPos?.y;
        if (typeof targetX === "number" && typeof targetY === "number") {
          const p = graph.clientToLocal(targetX, targetY);
          win.__handlePlacementClick?.(p.x, p.y);
        } else {
          win.__handleDragEnd?.();
        }
        break;
      }
      case "startPlacement": {
        if (!graph) return;
        const { className, classKind, iconSvg, isDrag } = message;
        if (!className) break;
        // Calls the startPlacement function defined inside initGraph
        // which creates the ghost cursor and enters placement mode
        win.__startPlacement?.({ className, classKind, iconSvg, isDrag });
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

        const newModel = dagreLayout.layout(model);
        const g = graph;

        g.batchUpdate("layout", () => {
          newModel.nodes?.forEach((n: DagreLayoutResultNode) => {
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
              graph.container.clientWidth > 0 ? graph.container.clientWidth : graph.options?.width || 800;
            const containerH =
              graph.container.clientHeight > 0 ? graph.container.clientHeight : graph.options?.height || 600;
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
        const isPscad = Boolean(message.language && /^(pscad|pscx|pslx|pswx|psmx)$/i.test(message.language));
        const canvasHud = document.getElementById("canvas-hud");
        if (canvasHud) {
          canvasHud.style.display = isPscad ? "flex" : "none";
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
 * Updates the breadcrumb bar in the webview if present.
 */
function updateBreadcrumbs(breadcrumbs?: { id: string; label: string }[]) {
  if (typeof document === "undefined") return;
  const bar = document.getElementById("breadcrumb-bar");
  if (!bar) return;
  if (!breadcrumbs || breadcrumbs.length <= 1) {
    bar.style.display = "none";
    bar.innerHTML = "";
    return;
  }
  bar.style.display = "flex";
  bar.innerHTML = "";

  breadcrumbs.forEach((crumb, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "breadcrumb-separator";
      sep.textContent = "›";
      bar.appendChild(sep);
    }
    const item = document.createElement("span");
    const isLast = idx === breadcrumbs.length - 1;
    item.className = `breadcrumb-item${isLast ? " active" : ""}`;
    item.textContent = crumb.label;
    if (!isLast) {
      item.onclick = () => {
        postMessageToHost({
          type: "navigateTo",
          className: crumb.id,
          diagramType: "All",
        });
      };
    }
    bar.appendChild(item);
  });

  const backBtn = document.createElement("button");
  backBtn.className = "breadcrumb-back-btn";
  backBtn.innerHTML = "◀ Back to Overview";
  backBtn.onclick = () => {
    postMessageToHost({
      type: "navigateTo",
      className: breadcrumbs[0]?.id ?? "",
      diagramType: "All",
    });
  };
  bar.appendChild(backBtn);
}

/**
 * Invokes the registered `onShowProperties` callback to display or update the component inspector.
 */

function showProperties(nodeData: { id: string; properties?: unknown; isLoading?: boolean | undefined }) {
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
  if (!g || g.disposed) return;
  if (solderDotsRaf !== null) return;
  solderDotsRaf = requestAnimationFrame(() => {
    solderDotsRaf = null;
    if (g && !g.disposed) {
      updateSolderDots(g);
    }
  });
}

/**
 * Recomputes and synchronizes electrical/topological T-junction solder dot nodes across all edges
 * in the graph, excluding component port pin locations.
 */
export function updateSolderDots(g: Graph) {
  if (!g || g.disposed) return;

  const edges = g.getEdges();
  const existingDots = g.getNodes().filter((n: Node) => n.id.startsWith("solder_dot_"));

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
    const src = edge.getSource();
    if (src?.port) {
      portPoints.push(source);
    }
    const tgt = edge.getTarget();
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

  // Also collect port coordinates from all component nodes in graph
  for (const node of g.getNodes()) {
    if (isEphemeralDiagramNode(node.id)) continue;
    const ports = node.getPorts?.() || [];
    const nodePos = node.getPosition();
    const nodeSize = node.getSize();
    const angleDeg = node.getAngle?.() ?? 0;
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = (nodeSize?.width ?? 0) / 2;
    const cy = (nodeSize?.height ?? 0) / 2;
    for (const p of ports) {
      const pos = node.getPortProp?.(p.id, "args");
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
  const existingIds = new Set<string>(existingDots.map((n: Node) => n.id));
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
        g.addNode(solderDotToDiagramNode(dot, dotSize) as unknown as Record<string, unknown>);
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
    (window as unknown as DiagramWindow).debugSolderDotsInfo =
      `Edges: ${edges.length}, Paths: ${allPaths.length}, Dots: ${dots.length}`;
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

  const texts = Array.from(svgEl.querySelectorAll("text"));
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
export function toggleGroupNodeCollapse(node: Node | null | undefined): void {
  if (!node) return;
  const data = node.getData?.() || {};
  const isCollapsed = Boolean(data.collapsed);
  const children = node.getChildren?.() || [];

  if (!isCollapsed) {
    const currentSize = typeof node.size === "function" ? node.size() : { width: 240, height: 180 };
    node.setData?.({ ...data, collapsed: true, origWidth: currentSize.width, origHeight: currentSize.height });
    children.forEach((c: Cell) => c.setVisible?.(false));
    node.resize?.(Math.max(180, currentSize.width), 40);
  } else {
    node.setData?.({ ...data, collapsed: false });
    node.resize?.(data.origWidth || 240, data.origHeight || 180);
    children.forEach((c: Cell) => c.setVisible?.(true));
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
  const interactiveBindings = node.getData()?.interactive;
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
export * from "./aspen-diagram-builder.js";
export * from "./autosar-diagram-builder.js";
export * from "./collab-manager.js";
export * from "./collab-overlay.js";
export * from "./color-inversion.js";
export * from "./eclipse-diagram-builder.js";
export * from "./fault-tree.js";
export * from "./glyphs.js";
export * from "./html-diff-bundle.js";
export * from "./incremental-layout.js";
export * from "./interactive.js";
export * from "./jsbsim-diagram-builder.js";
export * from "./kinematic-diagram-builder.js";
export * from "./layout-storage.js";
export * from "./lps-diagram-builder.js";
export * from "./olga-diagram-builder.js";
export * from "./opendss-diagram-builder.js";
export * from "./openscenario-diagram-builder.js";
export * from "./plcopen-diagram-builder.js";
export * from "./polyglot-diagram-builder.js";
export * from "./port-ilp-solver.js";
export * from "./port-router.js";
export * from "./property-evaluator.js";
export * from "./property-sheet-controller.js";
export * from "./property-validator.js";
export * from "./protocol.js";
export type { ReactiveAnimationBinding, X6Markup } from "./protocol.js";
export * from "./pscad-diagram-builder.js";
export * from "./psse-diagram-builder.js";
export * from "./relap5-diagram-builder.js";
export * from "./sbml-diagram-builder.js";
export * from "./sima-diagram-builder.js";
export * from "./simulink-diagram-builder.js";
export * from "./spice-diagram-builder.js";
export * from "./svg-renderer.js";
export * from "./swimlane-layout.js";
export * from "./swmm-diagram-builder.js";
export * from "./telemetry.js";
export type { TopologyEdge, TopologyGraph, TopologyNode } from "./topology.js";
export * from "./touchstone-diagram-builder.js";
export * from "./tsm-layout.js";
export * from "./verilog-a-diagram-builder.js";
export * from "./visual-diff-graph.js";
export * from "./visual-diff-renderer.js";
