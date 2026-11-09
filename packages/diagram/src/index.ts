// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Webview-side script: receives diagram data via postMessage and
// renders it using AntV X6.

import * as antvLayout from "@antv/layout";
import * as x6 from "@antv/x6";

import {
  applyNodeFlipVisuals,
  computeNodeAlignment,
  computeNodeNudge,
  computeSmartAlignmentGuides,
  ensureAlignmentToolbar,
  renderSmartGuidesSvgMarkup,
  showAlignmentToolbar,
  type AlignableNode,
  type AlignmentType,
  type ArrowKeyDirection,
  type SmartGuideLine,
} from "./alignment.js";
import { adaptColorForDarkMode, adaptX6Markup } from "./color-inversion.js";
import { hideContextMenu, showContextMenu } from "./context-menu.js";
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
import { ensureMinimapHud, isMinimapOpen, toggleMinimapHud, updateMinimapHud } from "./minimap.js";
import {
  computeFilletedOrthogonalPath,
  computeJumpoverPath,
  computeOrthogonalRoute,
  computeSmoothBezierPath,
  getNodeBBox,
  getPortOutwardNormal,
  healOrthogonalVertices,
  portOrthogonalRouter,
  regularizeOrthogonalPolyline,
  resolveNodePortWorldPoint,
  simplifyCollinearPoints,
  translateConnectedEdgeStubs,
  type JumpoverOptions,
  type JumpoverSegment,
  type PointLike,
  type RectLike,
  type RouterNodeLike,
  type RouterPortConfig,
} from "./port-router.js";
import type { CoordinateSystem, ReactiveAnimationBinding } from "./protocol.js";
import {
  alignNodeSelectionBox,
  ensurePatchedVerticesTool,
  getEdgeToolConfig,
  resolveEdgeSelectionStyle,
  syncAllNodeSelectionBoxes,
  type EdgeSelectionStyle,
  type ResolvedEdgeSelectionStyle,
} from "./selection-handles.js";
import { applySequenceLayout } from "./sequence-layout.js";
import {
  computeEdgeNetIds,
  computeSolderDots,
  computeWireCrossings,
  resolveWireCrossingStyle,
  solderDotToDiagramNode,
  wireCrossingToDiagramNode,
  type EdgePath,
  type WireCrossingStyle,
} from "./solder-dots.js";
import * as Spinner from "./spinner.js";
import { applySwimlaneLayout, type SwimlanePartition } from "./swimlane-layout.js";
import { animateCells, type SimulationFrame } from "./telemetry.js";
import { applyTsmOrthogonalLayout } from "./tsm-layout.js";
import { scheduleViewportCulling } from "./viewport-culling.js";

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
  getMarkup?: (() => unknown) | undefined;
  setMarkup(markup: unknown): void;
  getAttrs?: (() => Record<string, unknown>) | undefined;
  setAttrs(attrs: Record<string, unknown>): void;
  attr(path: string, val?: unknown): unknown;
  prop?: ((path: string, val?: unknown, options?: unknown) => unknown) | undefined;
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
  addEdge(metadata: Record<string, unknown> | Edge): Edge;
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
  zoomTo?: ((factor: number) => void) | undefined;
  resize(width: number, height: number): void;
  zoomToRect(rect: RectLike, options?: Record<string, unknown>): void;
  zoomToFit(options?: Record<string, unknown>): void;
  centerContent(): void;
  batchUpdate(name: string, execute: () => void): void;
  fromJSON(data: { nodes: unknown[]; edges: unknown[] }): void;
  clearCells(): void;
  clientToLocal(x: number, y: number): PointLike;
  showGrid?: (() => void) | undefined;
  hideGrid?: (() => void) | undefined;
  clearGrid?: (() => void) | undefined;
  setGridSize?: ((size: number) => void) | undefined;
  getGridSize?: (() => number) | undefined;
  isSelected?: ((cell: Cell) => boolean) | undefined;
  cleanSelection?: (() => void) | undefined;
  select?: ((cell: Cell | Cell[]) => void) | undefined;
  matrix?: (() => { a: number; d: number; e: number; f: number }) | undefined;
  coord?: { localToGraphRect?: (rect: RectLike) => RectLike } | undefined;
  getPlugin?: ((name: string) => unknown) | undefined;
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
  alignNodeSelectionBox,
  clearActiveDropPlaceholder,
  computeEdgeNetIds,
  dropComponentGhost,
  ensureDiagramStyles,
  getActiveDropPlaceholder,
  getEdgeToolConfig,
  getTypicalNodeSize,
  isEphemeralDiagramNode,
  syncAllNodeSelectionBoxes,
  type DropPlaceholderOptions,
};

if (typeof Graph.registerRouter === "function") {
  try {
    Graph.registerRouter("port-orthogonal-astar", portOrthogonalRouter, true);
  } catch {
    // Already registered or duplicate in HMR
  }
}

interface JumpoverEdgeLike {
  id?: string | undefined;
  findView?: ((graph: unknown) => { routePoints?: PointLike[] } | null | undefined) | undefined;
  getVertices?: (() => PointLike[]) | undefined;
  getSourcePoint?: (() => PointLike) | undefined;
  source?: PointLike | undefined;
  getTargetPoint?: (() => PointLike) | undefined;
  target?: PointLike | undefined;
  getConnector?: (() => string | { name?: string }) | undefined;
  connector?: string | { name?: string } | undefined;
}

interface JumpoverNodeLike {
  id?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  getPosition?: (() => PointLike | undefined) | undefined;
  getSize?: (() => { width?: number; height?: number } | undefined) | undefined;
}

interface JumpoverEdgeViewLike {
  graph?:
    | {
        getEdges?: (() => JumpoverEdgeLike[]) | undefined;
        getNodes?: (() => JumpoverNodeLike[]) | undefined;
      }
    | undefined;
  cell?: { id?: string | undefined } | undefined;
}

if (typeof Graph.registerConnector === "function") {
  try {
    Graph.registerConnector(
      "jumpover",
      (
        sourcePoint: PointLike,
        targetPoint: PointLike,
        routePoints: PointLike[] = [],
        args: JumpoverOptions = {},
        edgeView?: JumpoverEdgeViewLike,
      ) => {
        const points = [sourcePoint, ...routePoints, targetPoint];
        const obstacles: JumpoverSegment[] = [];
        const solderDots: PointLike[] = [];

        if (edgeView?.graph && typeof edgeView.graph.getEdges === "function") {
          const currentCell = edgeView.cell;
          const currentEdgeId = currentCell?.id;
          const allEdges = edgeView.graph.getEdges();

          // Collect solder dot positions to suppress jumpovers near connected net junctions
          if (typeof edgeView.graph.getNodes === "function") {
            for (const n of edgeView.graph.getNodes()) {
              if (typeof n.id === "string" && n.id.startsWith("solder_dot_")) {
                const pos = typeof n.getPosition === "function" ? n.getPosition() : { x: n.x, y: n.y };
                const size = typeof n.getSize === "function" ? n.getSize() : { width: 3, height: 3 };
                if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
                  solderDots.push({
                    x: pos.x + (size?.width ?? 3) / 2,
                    y: pos.y + (size?.height ?? 3) / 2,
                  });
                }
              }
            }
          }

          for (const edge of allEdges) {
            if (edge.id === currentEdgeId) continue;

            const otherView = typeof edge.findView === "function" ? edge.findView(edgeView.graph) : null;
            const otherRoute = otherView?.routePoints;
            const otherVertices =
              otherRoute && otherRoute.length > 0
                ? otherRoute
                : typeof edge.getVertices === "function"
                  ? edge.getVertices()
                  : [];
            const otherSrc = typeof edge.getSourcePoint === "function" ? edge.getSourcePoint() : edge.source;
            const otherTgt = typeof edge.getTargetPoint === "function" ? edge.getTargetPoint() : edge.target;

            if (otherSrc && otherTgt && typeof otherSrc.x === "number" && typeof otherTgt.x === "number") {
              const otherConnector = typeof edge.getConnector === "function" ? edge.getConnector() : edge.connector;
              const otherConnectorName = typeof otherConnector === "string" ? otherConnector : otherConnector?.name;
              const hasJumpover = otherConnectorName === "jumpover";

              const otherPoints: PointLike[] = [otherSrc, ...otherVertices, otherTgt];
              for (let j = 0; j < otherPoints.length - 1; j++) {
                obstacles.push({
                  p1: otherPoints[j]!,
                  p2: otherPoints[j + 1]!,
                  edgeId: edge.id,
                  hasJumpover,
                });
              }
            }
          }
        }

        return computeJumpoverPath(points, obstacles, {
          radius: args.radius ?? 5,
          axis: args.axis ?? "both",
          horizontalHop: args.horizontalHop ?? "up",
          verticalHop: args.verticalHop ?? "right",
          edgeId: edgeView?.cell?.id,
          solderDots,
        });
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
  /** Coordinate snap raster in pixels (default 20, or 18 for PSCAD). */
  snapGrid?: number | undefined;
  /** Default connector style for newly created and unspecified edges (e.g. "normal" or { name: "rounded", args: { radius: 8 } }). */
  defaultConnector?: unknown | undefined;
  /** Wire crossing style ("none" | "micro-arc" | "gap" | "auto"). */
  wireCrossingStyle?: WireCrossingStyle | undefined;
  /** Edge selection visual strategy ("minimalist" | "hud" | "trace" | "halo" | "auto"). */
  edgeSelectionStyle?: EdgeSelectionStyle | undefined;
  /** Target language ID (e.g. "modelica", "pscad", "spice"). */
  language?: string | undefined;
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
  /** Callback invoked when auto-layout is triggered from canvas context menu. */
  onAutoLayout?: (() => void) | undefined;
  /** Generic message callback for non-action messages (revealSource, navigateTo, etc.) */
  onMessage?: ((msg: DiagramHostMessage) => void) | undefined;
}

/** Active diagram renderer configuration options. */
let currentOptions: DiagramRendererOptions | null = null;

interface ContainerDiagramInstance {
  graph: Graph;
  options: DiagramRendererOptions;
  selectedNodeId: string | null;
  cleanupListeners?: (() => void) | undefined;
  metadata?: Record<string, unknown> | undefined;
  rotateSelectedNodes?: ((deltaDegrees: number) => void) | undefined;
  flipSelectedNodes?: ((axis: "x" | "y") => void) | undefined;
  syncAlignmentToolbar?: (() => void) | undefined;
}

let activeRotateSelectedNodes: ((deltaDegrees: number, targetGraph?: Graph) => void) | null = null;
let activeFlipSelectedNodes: ((axis: "x" | "y", targetGraph?: Graph) => void) | null = null;
let activeSyncAlignmentToolbar: (() => void) | null = null;

const containerInstances = new Map<HTMLElement, ContainerDiagramInstance>();

function getOptionsForGraph(g?: Graph | null): DiagramRendererOptions | null {
  if (g?.container && containerInstances.has(g.container)) {
    return containerInstances.get(g.container)!.options;
  }
  return currentOptions;
}

function getMetadataForGraph(g?: Graph | null): Record<string, unknown> | null {
  if (g?.container && containerInstances.has(g.container)) {
    return containerInstances.get(g.container)!.metadata ?? null;
  }
  return activeDiagramMetadata ?? null;
}

/**
 * Sets or updates the active configuration options and callbacks for the diagram renderer.
 */
export function setDiagramOptions(options: DiagramRendererOptions) {
  currentOptions = options;
  if (options.container && containerInstances.has(options.container)) {
    const inst = containerInstances.get(options.container)!;
    inst.options = options;
    graph = inst.graph;
  }
}

/**
 * Dispatches a structural or spatial diagram edit action to the registered `onAction` callback.
 */
function enqueueDiagramAction(action: Record<string, unknown> | InteractiveWriteAction, g?: Graph | null) {
  const opts = getOptionsForGraph(g);
  if (opts?.onAction) opts.onAction(action);
}

/**
 * Forwards host-bound messages (`undo`, `redo`, `getProperties`, `revealSource`, `navigateTo`)
 * to the appropriate callback in `currentOptions`.
 */
function postMessageToHost(msg: DiagramHostMessage, g?: Graph | null) {
  const opts = getOptionsForGraph(g);
  if (msg.type === "undo" && opts?.onUndo) {
    opts.onUndo();
    return;
  }
  if (msg.type === "redo" && opts?.onRedo) {
    opts.onRedo();
    return;
  }
  if (msg.type === "getProperties") {
    if (opts?.onMessage) {
      opts.onMessage(msg);
      return;
    }
    if (opts?.onShowProperties && msg.componentName) {
      opts.onShowProperties(msg.componentName, undefined, true);
      return;
    }
  }
  // Forward all other messages (revealSource, navigateTo, changeDiagramType, etc.)
  if (opts?.onMessage) opts.onMessage(msg);
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

/** Whether the currently rendered diagram is read-only (disables canvas node/edge mutations) */
let isCurrentDiagramReadOnly = false;

/** Active diagram's language or metadata default connector (e.g. "normal" for Modelica, or "rounded" for SysML2) */
let activeDefaultConnector: unknown | undefined;

/** Active diagram metadata (language, wireCrossingStyle, etc.) */
let activeDiagramMetadata: Record<string, unknown> | undefined;

export { translateConnectedEdgeStubs };

export { applyNodeFlipVisuals } from "./alignment.js";

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
export { ensurePatchedVerticesTool };

/**
 * Initializes (or reconfigures) the AntV X6 graph canvas, plugins, interaction handlers,
 * orthogonal edge routers, and keyboard shortcuts.
 */
export function initGraph(isDark: boolean, targetContainer?: HTMLElement): Graph | null {
  ensurePatchedVerticesTool(x6);
  ensureDiagramStyles();
  let container = targetContainer ?? currentOptions?.container;
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

  const existingInst = containerInstances.get(container);
  if (existingInst && !existingInst.graph.disposed) {
    if (currentOptions && currentOptions.container === container) {
      existingInst.options = currentOptions;
    }
    graph = existingInst.graph;
    graph.drawBackground({ color: bgColor });
    graph.drawGrid({
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    });
    return graph;
  }

  if (graph && graph.container === container) {
    graph.drawBackground({ color: bgColor });
    graph.drawGrid({
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    });
    return graph;
  }

  const parent = container.parentElement;
  const parentW = parent?.clientWidth ?? 0;
  const parentH = parent?.clientHeight ?? 0;
  const clientW = container.clientWidth > 0 ? container.clientWidth : 0;
  const clientH = container.clientHeight > 0 ? container.clientHeight : 0;
  const containerW = parentW > 0 ? parentW : clientW > 0 ? clientW : 800;
  const containerH = parentH > 0 ? parentH : clientH > 0 ? clientH : 600;

  const initialEdgeStyle = resolveEdgeSelectionStyle(currentOptions?.language, currentOptions?.edgeSelectionStyle);
  container.setAttribute("data-edge-selection", initialEdgeStyle);

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
      if (isCurrentDiagramReadOnly) {
        return false;
      }
      return { nodeMovable: true, edgeMovable: true, edgeLabelMovable: true };
    },
    connecting: {
      snap: { radius: 24 },
      allowBlank: false,
      allowMulti: () => !isCurrentDiagramReadOnly,
      allowLoop: false,
      allowNode: () => !isCurrentDiagramReadOnly && (currentOptions?.allowNodeConnection ?? true),
      allowEdge: false,
      allowPort: () => !isCurrentDiagramReadOnly,
      highlight: true,
      highlighting: {
        magnetAvailable: {
          name: "stroke",
          args: {
            attrs: {
              fill: "#fff",
              stroke: "#0891b2",
              strokeWidth: 3.5,
            },
          },
        },
        magnetAdsorbed: {
          name: "stroke",
          args: {
            attrs: {
              fill: "#0891b2",
              stroke: "#22d3ee",
              strokeWidth: 5,
            },
          },
        },
      },
      validateMagnet: ({ cell }: { cell?: { id: string } | null | undefined } = {}) => {
        if (isCurrentDiagramReadOnly) return false;
        if (cell && isEphemeralDiagramNode(cell.id)) return false;
        return true;
      },
      validateConnection: ({
        sourceCell,
        targetCell,
      }: {
        sourceCell?: { id: string } | null | undefined;
        targetCell?: { id: string } | null | undefined;
      }) => {
        if (!sourceCell || !targetCell) return false;
        if (sourceCell.id === targetCell.id) return false;
        if (isEphemeralDiagramNode(sourceCell.id) || isEphemeralDiagramNode(targetCell.id)) return false;
        return true;
      },
      validateEdge: () => true,
      createEdge: (): ReturnType<Graph["createEdge"]> => {
        return g.createEdge({
          zIndex: 1000,
          router: { name: "port-orthogonal-astar" },
          connector: activeDefaultConnector ??
            currentOptions?.defaultConnector ?? { name: "rounded", args: { radius: 8 } },
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

  const selectionPlugin = new Selection({
    enabled: true,
    showNodeSelectionBox: true,
    showEdgeSelectionBox: false,
    rubberband: true,
    multiple: true,
    modifiers: ["ctrl", "meta", "shift"],
    multipleSelectionModifiers: ["ctrl", "meta", "shift"],
    pointerEvents: "none",
    filter: (cell: Cell) => !isEphemeralDiagramNode(cell.id),
  });
  g.use(selectionPlugin);

  // Hook into SelectionImpl to align and rotate node selection boxes
  const selectionImpl = (selectionPlugin as unknown as { selectionImpl?: Record<string, unknown> }).selectionImpl as
    | {
        container?: HTMLElement | undefined;
        createSelectionBox?: ((cell: Cell) => void) | undefined;
        repositionSelectionBoxesInPlace?: (() => void) | undefined;
      }
    | undefined;

  if (selectionImpl) {
    const origCreateSelectionBox = selectionImpl.createSelectionBox?.bind(selectionImpl);
    if (origCreateSelectionBox) {
      selectionImpl.createSelectionBox = (cell: Cell) => {
        origCreateSelectionBox(cell);
        if (cell && typeof cell.isNode === "function" && cell.isNode()) {
          const box = selectionImpl.container?.querySelector(`[data-cell-id="${cell.id}"]`) as HTMLElement | null;
          if (box) {
            alignNodeSelectionBox(box, cell as Node, g);
          }
        }
      };
    }

    const origReposition = selectionImpl.repositionSelectionBoxesInPlace?.bind(selectionImpl);
    if (origReposition) {
      selectionImpl.repositionSelectionBoxesInPlace = () => {
        origReposition();
        syncAllNodeSelectionBoxes(g, selectionImpl.container);
      };
    }
  }

  const updateNodeBox = ({ node, cell }: { node?: Node; cell?: Cell } = {}) => {
    const n = (node || cell) as Node | undefined;
    if (!n || typeof n.isNode !== "function" || !n.isNode()) return;
    const container = selectionImpl?.container || g.container?.querySelector(".x6-widget-selection");
    const box = container?.querySelector(`[data-cell-id="${n.id}"]`) as HTMLElement | null;
    if (box) {
      alignNodeSelectionBox(box, n, g);
    }
  };

  g.on("node:change:angle", updateNodeBox);
  g.on("node:rotate", updateNodeBox);
  g.on("node:rotated", updateNodeBox);
  g.on("node:change:position", updateNodeBox);
  g.on("node:change:size", updateNodeBox);

  g.use(
    new Transform({
      resizing: { enabled: (node: Node) => !isEphemeralDiagramNode(node.id) },
      rotating: { enabled: (node: Node) => !isEphemeralDiagramNode(node.id) },
    }),
  );

  const refreshSelectedEdgeTools = () => {
    const selectedEdges = (typeof g.getSelectedCells === "function" ? g.getSelectedCells() : []).filter(
      (c: Cell) => typeof c.isEdge === "function" && c.isEdge(),
    );
    const activeStyle = (container?.getAttribute("data-edge-selection") as ResolvedEdgeSelectionStyle) ?? "halo";
    selectedEdges.forEach((edge: Cell) => {
      edge.removeTools();
      edge.addTools(getEdgeToolConfig(edge, g, isDark, activeStyle));
    });
  };

  // ── Minimap HUD ──
  const minimapHud = ensureMinimapHud(
    container,
    (worldX, worldY) => {
      const graphWithCenter = g as unknown as { centerPoint?: (x: number, y: number) => void };
      if (typeof graphWithCenter.centerPoint === "function") {
        graphWithCenter.centerPoint(worldX, worldY);
      }
    },
    container?.getAttribute("data-show-minimap") === "true",
  );

  let triggerInlineNodeEdit: ((node: Node) => void) | null = null;

  // ── Extract Primary Parameter Chip (e.g. "C=1e-4", "R=100") ──
  const extractNodePrimaryParam = (
    targetGraph: Graph,
    node: Node,
  ): { label: string; paramName: string; paramValue: string } | undefined => {
    const view = targetGraph.findViewByCell?.(node);
    const svgEl = view?.container;
    if (svgEl && typeof svgEl.querySelectorAll === "function") {
      const texts = Array.from(svgEl.querySelectorAll("text"));
      for (const t of texts) {
        const raw = (t.textContent ?? "").trim();
        const eqIdx = raw.indexOf("=");
        if (eqIdx > 0 && eqIdx < raw.length - 1) {
          const paramName = raw.slice(0, eqIdx).trim();
          const paramValue = raw.slice(eqIdx + 1).trim();
          if (/^[A-Za-z_]\w*$/.test(paramName)) {
            return { label: `${paramName}=${paramValue}`, paramName, paramValue };
          }
        }
      }
    }
    const cached = propertyCache.get(node.id) as
      | { parameters?: { name?: string; value?: string; defaultValue?: string }[] }
      | undefined;
    const firstParam = cached?.parameters?.find((p) => p.name && (p.value || p.defaultValue));
    if (firstParam?.name) {
      const val = String(firstParam.value || firstParam.defaultValue || "");
      return { label: `${firstParam.name}=${val}`, paramName: firstParam.name, paramValue: val };
    }
    const data = (typeof node.getData === "function" ? node.getData() : {}) || {};
    const propParams = (data["properties"]?.["parameters"] ?? data["parameters"]) as
      | { name?: string; value?: string; defaultValue?: string }[]
      | undefined;
    const firstPropParam = propParams?.find?.((p) => p.name && (p.value || p.defaultValue));
    if (firstPropParam?.name) {
      const val = String(firstPropParam.value || firstPropParam.defaultValue || "");
      return { label: `${firstPropParam.name}=${val}`, paramName: firstPropParam.name, paramValue: val };
    }
    return undefined;
  };

  // ── Node Rotation Helper ──
  const rotateSelectedNodes = (deltaDegrees: number, targetGraph: Graph = g) => {
    const selectedNodes = targetGraph
      .getSelectedCells()
      .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
    if (selectedNodes.length === 0) return;

    const moveItems: Record<string, unknown>[] = [];
    targetGraph.batchUpdate("rotate", () => {
      for (const node of selectedNodes) {
        const curAngle = node.getAngle?.() || 0;
        const newAngle = (((curAngle + deltaDegrees) % 360) + 360) % 360;
        node.rotate?.(newAngle, { absolute: true });
      }

      const touchedEdges = new Set<Edge>();
      for (const node of selectedNodes) {
        for (const edge of targetGraph.getConnectedEdges(node)) {
          touchedEdges.add(edge);
        }
      }
      for (const edge of touchedEdges) {
        rerouteEdgeOrthogonal(edge, targetGraph, { skipEnqueue: true });
      }

      for (const node of selectedNodes) {
        const p = node.getPosition();
        const s = node.getSize();
        const newAngle = node.getAngle?.() || 0;
        const edges = getConnectedEdges(targetGraph, node);
        const data = node.getData?.() || {};
        const name = (data["name"] as string) || node.id;
        moveItems.push({
          name,
          x: p.x,
          y: p.y,
          width: s.width,
          height: s.height,
          rotation: newAngle,
          ...(typeof data["flipX"] === "boolean" ? { flipX: data["flipX"] } : {}),
          ...(typeof data["flipY"] === "boolean" ? { flipY: data["flipY"] } : {}),
          edges,
        });
      }
    });

    syncAllNodeSelectionBoxes(targetGraph, selectionImpl?.container);
    syncAlignmentToolbar();

    if (moveItems.length > 0) {
      enqueueDiagramAction({ type: "move", items: moveItems }, targetGraph);
      scheduleUpdateSolderDots(targetGraph);
    }
  };

  // ── Node Flip Helper (Horizontal / Vertical Mirror) ──
  const flipSelectedNodes = (axis: "x" | "y", targetGraph: Graph = g) => {
    const selectedNodes = targetGraph
      .getSelectedCells()
      .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
    if (selectedNodes.length === 0) return;

    const moveItems: Record<string, unknown>[] = [];
    targetGraph.batchUpdate("flip", () => {
      for (const node of selectedNodes) {
        const curData = node.getData?.() || {};
        const curFlipX = Boolean(curData["flipX"]);
        const curFlipY = Boolean(curData["flipY"]);
        const nextFlipX = axis === "x" ? !curFlipX : curFlipX;
        const nextFlipY = axis === "y" ? !curFlipY : curFlipY;
        node.setData?.({ ...curData, flipX: nextFlipX, flipY: nextFlipY });
        applyNodeFlipVisuals(node, targetGraph, nextFlipX, nextFlipY);
      }

      const touchedEdges = new Set<Edge>();
      for (const node of selectedNodes) {
        for (const edge of targetGraph.getConnectedEdges(node)) {
          touchedEdges.add(edge);
        }
      }
      for (const edge of touchedEdges) {
        rerouteEdgeOrthogonal(edge, targetGraph, { skipEnqueue: true });
      }

      for (const node of selectedNodes) {
        const p = node.getPosition();
        const s = node.getSize();
        const curAngle = node.getAngle?.() || 0;
        const edges = getConnectedEdges(targetGraph, node);
        const curData = node.getData?.() || {};
        const name = (curData["name"] as string) || node.id;
        moveItems.push({
          name,
          x: p.x,
          y: p.y,
          width: s.width,
          height: s.height,
          rotation: curAngle,
          flipX: Boolean(curData["flipX"]),
          flipY: Boolean(curData["flipY"]),
          edges,
        });
      }
    });

    syncAllNodeSelectionBoxes(targetGraph, selectionImpl?.container);
    syncAlignmentToolbar();

    if (moveItems.length > 0) {
      enqueueDiagramAction({ type: "move", items: moveItems }, targetGraph);
      scheduleUpdateSolderDots(targetGraph);
    }
  };

  activeRotateSelectedNodes = rotateSelectedNodes;
  activeFlipSelectedNodes = flipSelectedNodes;

  // ── Node Duplicate Helper (Ctrl+D / Floating Toolbar) ──
  const duplicateSelectedNodes = (targetGraph: Graph = g) => {
    if (isCurrentDiagramReadOnly) return;
    const selectedNodes = targetGraph
      .getSelectedCells()
      .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
    if (selectedNodes.length === 0) return;

    for (const node of selectedNodes) {
      const data = node.getData?.() || {};
      const className = (data.properties?.className as string | undefined) || (data["className"] as string | undefined);
      if (!className) continue;
      const p = node.getPosition();
      const s = node.getSize();
      const centerX = p.x + s.width / 2;
      const centerY = -(p.y + s.height / 2);
      enqueueDiagramAction(
        {
          type: "addComponent",
          className,
          x: Math.round(centerX + 20),
          y: Math.round(centerY - 20),
        },
        targetGraph,
      );
    }
  };

  // ── Delete Selected Cells Helper (Del/Backspace / Floating Toolbar) ──
  const deleteSelectedCells = (targetGraph: Graph = g) => {
    if (isCurrentDiagramReadOnly) return;
    const cells = targetGraph.getSelectedCells();
    if (cells.length === 0) return;

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
        const name = (cell.getData?.()?.["name"] as string) || cell.id;
        componentNames.push(name);
      }
    });

    if (edgesToDelete.length > 0) {
      for (const edge of edgesToDelete) {
        enqueueDiagramAction({ type: "disconnect", ...edge }, targetGraph);
      }
    }
    if (componentNames.length > 0) {
      enqueueDiagramAction({ type: "deleteComponents", names: componentNames }, targetGraph);
    }
    targetGraph.removeCells(cells);
    showAlignmentToolbar(alignmentToolbar, container, [], { sx: 1, sy: 1 }, { tx: 0, ty: 0 });
    scheduleUpdateSolderDots(targetGraph);
  };

  // ── Quick Inline Parameter Value Editor in Floating Toolbar ──
  const startInlineParamEdit = (node: Node, targetGraph: Graph = g) => {
    if (isCurrentDiagramReadOnly || isEphemeralDiagramNode(node.id)) return;
    const paramInfo = extractNodePrimaryParam(targetGraph, node);
    if (!paramInfo) {
      const nodeName = (node.getData?.()?.["name"] as string) || node.id;
      postMessageToHost({ type: "getProperties", componentName: nodeName }, targetGraph);
      return;
    }

    const paramBtn = alignmentToolbar?.querySelector("[data-action='edit-param'], [data-align='edit-param']") as
      | HTMLElement
      | null
      | undefined;
    if (!paramBtn) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "align-param-input";
    input.value = paramInfo.paramValue;
    input.title = `Edit ${paramInfo.paramName} (Enter to apply, Esc to cancel)`;
    paramBtn.replaceWith(input);

    let committed = false;
    const commit = (applyChange: boolean) => {
      if (committed) return;
      committed = true;
      const newVal = input.value.trim();
      input.remove();
      alignmentToolbar?.removeAttribute("data-mode-key");
      if (applyChange && newVal && newVal !== paramInfo.paramValue) {
        updateParameterText(node.id, paramInfo.paramName, paramInfo.paramValue, newVal);
        const nodeName = (node.getData?.()?.["name"] as string) || node.id;
        enqueueDiagramAction(
          {
            type: "updateProperty",
            componentName: nodeName,
            propKey: paramInfo.paramName,
            propValue: newVal,
          },
          targetGraph,
        );
      }
      syncAlignmentToolbar();
    };

    input.addEventListener("mousedown", (ev) => ev.stopPropagation());
    input.addEventListener("keydown", (ev: KeyboardEvent) => {
      ev.stopPropagation();
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", () => commit(true));
    input.focus();
    input.select();
  };

  // ── Live Coordinate & Delta Nudge HUD Pill ──
  let nudgeHudEl: HTMLElement | null = null;
  let nudgeHudFadeTimeout: ReturnType<typeof setTimeout> | null = null;
  let nudgeAccumDx = 0;
  let nudgeAccumDy = 0;

  const showNudgeHud = (targetGraph: Graph, nodes: Node[], deltaX: number, deltaY: number) => {
    if (!container || typeof document === "undefined" || nodes.length === 0) return;
    if (!nudgeHudEl || !container.contains(nudgeHudEl)) {
      nudgeHudEl = container.querySelector(".modelscript-nudge-hud") as HTMLElement | null;
      if (!nudgeHudEl) {
        nudgeHudEl = document.createElement("div");
        nudgeHudEl.className = "modelscript-nudge-hud";
        container.appendChild(nudgeHudEl);
      }
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const p = n.getPosition();
      const s = n.getSize();
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.width);
      maxY = Math.max(maxY, p.y + s.height);
    }

    const sc = typeof targetGraph.scale === "function" ? targetGraph.scale() : { sx: 1, sy: 1 };
    const tr = typeof targetGraph.translate === "function" ? targetGraph.translate() : { tx: 0, ty: 0 };
    const screenCenterX = ((minX + maxX) / 2) * sc.sx + tr.tx;
    const screenBottomY = maxY * sc.sy + tr.ty + 18;

    const modelX = Math.round((minX + maxX) / 2);
    const modelY = Math.round(-((minY + maxY) / 2));
    const signX = deltaX >= 0 ? `+${Math.round(deltaX)}` : `${Math.round(deltaX)}`;
    const signY = -deltaY >= 0 ? `+${Math.round(-deltaY)}` : `${Math.round(-deltaY)}`;

    nudgeHudEl.innerHTML = `<span class="nudge-coords">(${modelX}, ${modelY})</span><span class="nudge-delta">Δ(${signX}, ${signY})</span>`;
    nudgeHudEl.style.left = `${Math.round(screenCenterX)}px`;
    nudgeHudEl.style.top = `${Math.round(screenBottomY)}px`;
    nudgeHudEl.classList.add("visible");

    if (nudgeHudFadeTimeout) clearTimeout(nudgeHudFadeTimeout);
    nudgeHudFadeTimeout = setTimeout(() => {
      nudgeHudEl?.classList.remove("visible");
      nudgeAccumDx = 0;
      nudgeAccumDy = 0;
      nudgeHudFadeTimeout = null;
    }, 900);
  };

  // ── Contextual Floating Edit Bar (Single-Node & Multi-Node) ──
  const alignmentToolbar = ensureAlignmentToolbar(container, (type: AlignmentType) => {
    const currentSelected = g
      .getSelectedCells()
      .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
    if (currentSelected.length === 0) return;

    if (type === "rotate-cw") {
      rotateSelectedNodes(90, g);
      return;
    }
    if (type === "rotate-ccw") {
      rotateSelectedNodes(-90, g);
      return;
    }
    if (type === "flip-h") {
      flipSelectedNodes("x", g);
      return;
    }
    if (type === "flip-v") {
      flipSelectedNodes("y", g);
      return;
    }
    if (type === "duplicate") {
      duplicateSelectedNodes(g);
      return;
    }
    if (type === "delete") {
      deleteSelectedCells(g);
      return;
    }
    if (type === "properties") {
      const first = currentSelected[0]!;
      const nodeName = (first.getData?.()?.["name"] as string) || first.id;
      const cachedProps = propertyCache.get(first.id);
      if (cachedProps) {
        showProperties({ id: first.id, properties: cachedProps }, g);
      } else {
        showProperties({ id: first.id, properties: first.getData?.()?.properties, isLoading: true }, g);
        postMessageToHost({ type: "getProperties", componentName: nodeName }, g);
      }
      return;
    }
    if (type === "rename") {
      const first = currentSelected[0];
      if (first && triggerInlineNodeEdit) {
        triggerInlineNodeEdit(first);
      }
      return;
    }
    if (type === "edit-param") {
      const first = currentSelected[0];
      if (first) {
        startInlineParamEdit(first, g);
      }
      return;
    }

    if (currentSelected.length < 2) return;
    const nodesToAlign: AlignableNode[] = currentSelected.map((n: Node) => {
      const pos = n.getPosition();
      const sz = n.getSize();
      return { id: n.id, x: pos.x, y: pos.y, width: sz.width, height: sz.height };
    });
    const snapGrid = 1;
    const updates = computeNodeAlignment(nodesToAlign, type, snapGrid);
    if (updates.length === 0) return;

    g.batchUpdate("align", () => {
      for (const u of updates) {
        const node = g.getCellById(u.id) as Node;
        if (node && typeof node.isNode === "function" && node.isNode()) {
          const oldPos = node.getPosition();
          const dx = u.x - oldPos.x;
          const dy = u.y - oldPos.y;
          node.setPosition(u.x, u.y);
          translateConnectedEdgeStubs(g, node, dx, dy);
        }
      }
    });

    enqueueDiagramAction(
      {
        type: "move",
        items: updates.map((u) => {
          const node = g.getCellById(u.id);
          const name = (node?.getData?.()?.["name"] as string) || u.id;
          return { name, x: u.x, y: u.y };
        }),
      },
      g,
    );

    syncAlignmentToolbar();
  });

  const syncAlignmentToolbar = () => {
    const selectedNodes = g
      .getSelectedCells()
      .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];

    if (
      typeof document !== "undefined" &&
      document.activeElement &&
      alignmentToolbar?.contains(document.activeElement) &&
      document.activeElement.tagName === "INPUT"
    ) {
      const activeNodeId = alignmentToolbar.getAttribute?.("data-active-node-id");
      const isEditingCurrentSingle = selectedNodes.length === 1 && selectedNodes[0]?.id === activeNodeId;
      if (isEditingCurrentSingle) {
        return;
      }
      (document.activeElement as HTMLElement).blur();
    }
    if (selectedNodes.length >= 1) {
      const nodesToAlign: AlignableNode[] = selectedNodes.map((n: Node) => {
        const pos = n.getPosition();
        const sz = n.getSize();
        const data = n.getData?.() || {};
        const name = String(data["name"] ?? data["properties"]?.["name"] ?? n.id);
        const extractedParam = selectedNodes.length === 1 ? extractNodePrimaryParam(g, n) : undefined;
        const primaryParam = extractedParam
          ? { name: extractedParam.paramName, value: extractedParam.paramValue }
          : undefined;
        return {
          id: n.id,
          x: pos.x,
          y: pos.y,
          width: sz.width,
          height: sz.height,
          name,
          primaryParam,
        };
      });
      const sc = typeof g.scale === "function" ? g.scale() : { sx: 1, sy: 1 };
      const tr = typeof g.translate === "function" ? g.translate() : { tx: 0, ty: 0 };
      showAlignmentToolbar(alignmentToolbar, container, nodesToAlign, sc, tr);
    } else {
      showAlignmentToolbar(alignmentToolbar, container, [], { sx: 1, sy: 1 }, { tx: 0, ty: 0 });
    }
  };

  // Helper to toggle connected port highlights on edge selection
  const setEdgePortHighlight = (cell: Cell, active: boolean) => {
    if (typeof (cell as Edge).getSource !== "function") return;
    const edge = cell as Edge;
    const src = edge.getSource?.();
    const tgt = edge.getTarget?.();
    [src, tgt].forEach((terminal) => {
      if (!terminal?.cell || !terminal?.port) return;
      const node = g.getCellById?.(terminal.cell);
      if (!node) return;
      const view = g.findViewByCell?.(node);
      if (!view?.container) return;
      const portEl = view.container.querySelector(`[data-port="${terminal.port}"]`);
      if (portEl) {
        if (active) {
          portEl.classList.add("x6-port-edge-selected");
        } else {
          portEl.classList.remove("x6-port-edge-selected");
        }
      }
    });
  };

  // ── Selection change events — add/remove edge tools & align node selection boxes ──
  g.on("selection:changed", ({ added, removed }: { added: Cell[]; removed: Cell[] }) => {
    const activeStyle = (container?.getAttribute("data-edge-selection") as ResolvedEdgeSelectionStyle) ?? "halo";
    added.forEach((cell: Cell) => {
      if (typeof cell.isEdge === "function" && cell.isEdge()) {
        cell.removeTools();
        cell.addTools(getEdgeToolConfig(cell, g, isDark, activeStyle));
        setEdgePortHighlight(cell, true);
      } else if (typeof cell.isNode === "function" && cell.isNode()) {
        const selContainer = selectionImpl?.container || g.container?.querySelector(".x6-widget-selection");
        const box = selContainer?.querySelector(`[data-cell-id="${cell.id}"]`) as HTMLElement | null;
        if (box) {
          alignNodeSelectionBox(box, cell as Node, g);
        }
      }
    });
    removed.forEach((cell: Cell) => {
      if (typeof cell.isEdge === "function" && cell.isEdge()) {
        cell.removeTools();
        setEdgePortHighlight(cell, false);
      }
    });
    syncAlignmentToolbar();
  });

  // ── Viewport Level-of-Detail (LOD) & Scale/Translate Sync ──
  g.on("scale", ({ sx }: { sx: number }) => {
    syncAllNodeSelectionBoxes(g, selectionImpl?.container);
    refreshSelectedEdgeTools();
    scheduleViewportCulling(g);
    syncAlignmentToolbar();
    updateMinimapHud(minimapHud, g);
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

  g.on("translate", () => {
    syncAllNodeSelectionBoxes(g, selectionImpl?.container);
    scheduleViewportCulling(g);
    syncAlignmentToolbar();
    updateMinimapHud(minimapHud, g);
  });

  g.on("node:change:position", () => {
    syncAlignmentToolbar();
    updateMinimapHud(minimapHud, g);
  });

  g.on("node:change:size", () => {
    updateMinimapHud(minimapHud, g);
  });

  g.on("edge:change:vertices", () => {
    updateMinimapHud(minimapHud, g);
  });

  g.on("edge:change:source", () => {
    updateMinimapHud(minimapHud, g);
  });

  g.on("edge:change:target", () => {
    updateMinimapHud(minimapHud, g);
  });

  g.on("cell:added", () => {
    updateMinimapHud(minimapHud, g);
  });

  g.on("cell:removed", () => {
    updateMinimapHud(minimapHud, g);
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
      enqueueDiagramAction({ type: "addComponent", className: dataToPlace.className, x: snappedX, y: snappedY }, g);
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
    if (isWireToolActive && activeWireState?.previewEdge) {
      const raster = currentOptions?.snapGrid ?? 20;
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

  // ── Universal Point-by-Point Wire Tool (W key) ──
  let isWireToolActive = false;
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
    isWireToolActive = active !== undefined ? active : !isWireToolActive;
    if (!isWireToolActive) {
      cancelWireToolInProgress();
      const container = g.container;
      if (container) container.style.cursor = "default";
    } else {
      const container = g.container;
      if (container) container.style.cursor = "crosshair";
    }
    return isWireToolActive;
  };

  g.on("blank:click", ({ x, y }: { x: number; y: number }) => {
    if (placementData) {
      handlePlacementClick(x, y);
      return;
    }
    if (isWireToolActive && activeWireState) {
      const raster = currentOptions?.snapGrid ?? 20;
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
    if (isWireToolActive && cell.isNode()) {
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

        const roundedSrc = {
          x: Math.round(activeWireState.sourcePoint.x),
          y: Math.round(-activeWireState.sourcePoint.y),
        };
        const roundedTgt = {
          x: Math.round(portPoint.x),
          y: Math.round(-portPoint.y),
        };
        const roundedWaypoints = activeWireState.waypoints.map((w) => ({
          x: Math.round(w.x),
          y: Math.round(-w.y),
        }));
        const points = [roundedSrc, ...roundedWaypoints, roundedTgt];

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
      if (isWireToolActive) {
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
    win.__isWireToolActive = () => isWireToolActive;
    win.__cancelWireTool = cancelWireToolInProgress;
    win.__startInlineNodeEdit = (nodeId: string) => {
      const node = g.getCellById(nodeId);
      if (node && node.isNode()) {
        startInlineNodeEdit(node);
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
    if (isRenderingDiagram) return;
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
    enqueueDiagramAction(
      {
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

  const resolveNearestNodePortId = (
    node: Cell | null | undefined,
    referencePt: PointLike | null | undefined,
  ): string | undefined => {
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
  };

  g.on("edge:connected", ({ isNew, edge }: { isNew?: boolean | undefined; edge: Edge }) => {
    if (isRenderingDiagram) return;

    const source = edge.getSource();
    const target = edge.getTarget();
    if (!source?.cell || !target?.cell) return;

    const sourceCell = g.getCellById(source.cell);
    const targetCell = g.getCellById(target.cell);

    let sourcePortId = source.port;
    let targetPortId = target.port;

    // If a connection landed on a port-bearing node without a port ID, snap to its nearest port
    if (sourcePortId === undefined && sourceCell?.isNode()) {
      const snappedSrcPort = resolveNearestNodePortId(sourceCell, edge.getSourcePoint());
      if (snappedSrcPort !== undefined) {
        sourcePortId = snappedSrcPort;
      }
    }
    if (targetPortId === undefined && targetCell?.isNode()) {
      const snappedTgtPort = resolveNearestNodePortId(targetCell, edge.getTargetPoint());
      if (snappedTgtPort !== undefined) {
        targetPortId = snappedTgtPort;
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

    if (!srcStr || !tgtStr) return;

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
      const edgeView = g.findViewByCell(edge);
      if (edgeView?.routePoints && edgeView.routePoints.length > 0) {
        intermediateVertices = healOrthogonalVertices(sourcePoint, targetPoint, edgeView.routePoints);
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
        intermediateVertices = computeOrthogonalRoute(sourcePoint, targetPoint, obstacles, {
          sourceSide,
          targetSide,
          sourceBox,
          targetBox,
        });
      }
    } else if (vertices.length > 0 && sourcePoint && targetPoint) {
      intermediateVertices = healOrthogonalVertices(sourcePoint, targetPoint, vertices);
    }

    const simplifiedVertices =
      sourcePoint && targetPoint
        ? healOrthogonalVertices(sourcePoint, targetPoint, simplifyCollinearPoints(intermediateVertices, 0.05))
        : simplifyCollinearPoints(intermediateVertices, 0.05);

    if (typeof edge.setVertices === "function") {
      edge.setVertices(simplifiedVertices, { ignoreSnap: true });
    }

    const roundedSrc = { x: Math.round(sourcePoint.x), y: Math.round(-sourcePoint.y) };
    const roundedTgt = { x: Math.round(targetPoint.x), y: Math.round(-targetPoint.y) };
    const roundedIntermediate = healOrthogonalVertices(
      roundedSrc,
      roundedTgt,
      simplifiedVertices.map((p: { x: number; y: number }) => ({
        x: Math.round(p.x),
        y: Math.round(-p.y),
      })),
    );
    const points = [roundedSrc, ...roundedIntermediate, roundedTgt];

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

  // Edge vertices changed: debounced with orthogonal regularization and collinear pruning
  let edgeUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
  g.on(
    "edge:change:vertices",
    ({
      edge,
      options,
    }: {
      edge: Edge;
      options?: { ignoreSnap?: boolean | undefined; ui?: boolean | undefined; toolId?: string | undefined } | undefined;
    }) => {
      if (isRenderingDiagram || options?.ignoreSnap) return;

      const isUserInteracting = Boolean(options?.ui || options?.toolId);

      // Do NOT mutate vertices synchronously while the user is actively interacting with the vertex tool.
      // Doing so prunes newly added collinear vertices before X6 can create their handles, causing
      // handle.onMouseDown undefined TypeError and freezing the diagram.
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

      if (edgeUpdateTimeout) clearTimeout(edgeUpdateTimeout);
      edgeUpdateTimeout = setTimeout(() => {
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
            const changed =
              healed.length !== curVertices.length ||
              healed.some(
                (nv: PointLike, idx: number) =>
                  Math.abs(nv.x - (curVertices[idx]?.x ?? 0)) > 0.5 ||
                  Math.abs(nv.y - (curVertices[idx]?.y ?? 0)) > 0.5,
              );
            if (changed) {
              edge.setVertices(healed, { ignoreSnap: true });
            }
          }

          const finalVertices = edge.getVertices() || [];
          const finalSrcPt = edge.getSourcePoint();
          const finalTgtPt = edge.getTargetPoint();
          const roundedSrc = { x: Math.round(finalSrcPt.x), y: Math.round(-finalSrcPt.y) };
          const roundedTgt = { x: Math.round(finalTgtPt.x), y: Math.round(-finalTgtPt.y) };
          const roundedVerts = healOrthogonalVertices(
            roundedSrc,
            roundedTgt,
            finalVertices.map((p: PointLike) => ({
              x: Math.round(p.x),
              y: Math.round(-p.y),
            })),
          );
          const points = [roundedSrc, ...roundedVerts, roundedTgt];
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
                  source: srcStr,
                  target: tgtStr,
                  points,
                },
              ],
            },
            g,
          );
        }
        edgeUpdateTimeout = null;
      }, 500);
    },
  );

  let isSnappingPortAlignment = false;
  let isAltPressed = false;
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
      if (!isRenderingDiagram && !isSnappingPortAlignment && cell && cell.isNode() && current && previous) {
        if (!isEphemeralDiagramNode(cell.id)) {
          let snapDx = 0;
          let snapDy = 0;
          let guideX: SmartGuideLine | null = null;
          let guideY: SmartGuideLine | null = null;
          const snapThreshold = 4;

          if (!isAltPressed) {
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
            isSnappingPortAlignment = true;
            cell.setPosition?.(current.x + snapDx, current.y + snapDy);
            isSnappingPortAlignment = false;
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
            translateConnectedEdgeStubs(g, cell, totalDx, totalDy, { forceReroute: isAltPressed });
          } else {
            const effectiveDx = current.x + snapDx - previous.x;
            const effectiveDy = current.y + snapDy - previous.y;
            translateConnectedEdgeStubs(g, cell, effectiveDx, effectiveDy, { forceReroute: isAltPressed });
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
  g.on("edge:removed", () => scheduleUpdateSolderDots(g));

  // Quick re-route orthogonal on edge double-click or context menu
  g.on("edge:dblclick", ({ edge }: { edge: Edge }) => {
    if (edge && edge.isEdge()) {
      rerouteEdgeOrthogonal(edge, g);
    }
  });

  // ── Desktop CAD Context Menus ──
  g.on("node:contextmenu", ({ node, e }: { node: Node; e: MouseEvent }) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!node || isEphemeralDiagramNode(node.id)) return;

    if (!g.isSelected?.(node)) {
      g.cleanSelection?.();
      g.select?.(node);
    }

    const nodeName = (node.getData?.()?.["name"] as string) || node.id;
    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      container,
      items: [
        {
          label: "Rotate 90° Clockwise",
          shortcut: "R",
          action: () => rotateSelectedNodes(90, g),
        },
        {
          label: "Rotate 90° Counter-CW",
          shortcut: "Shift+R",
          action: () => rotateSelectedNodes(-90, g),
        },
        {
          label: "Flip Horizontal",
          shortcut: "H",
          action: () => flipSelectedNodes("x", g),
        },
        {
          label: "Flip Vertical",
          shortcut: "V",
          action: () => flipSelectedNodes("y", g),
        },
        { type: "separator" },
        {
          label: "Rename Component…",
          shortcut: "F2",
          action: () => {
            if (triggerInlineNodeEdit) triggerInlineNodeEdit(node);
          },
        },
        {
          label: "Duplicate Component",
          shortcut: "Ctrl+D",
          action: () => duplicateSelectedNodes(g),
        },
        {
          label: "Inspect Properties",
          shortcut: "Enter",
          action: () => {
            postMessageToHost({ type: "getProperties", componentName: nodeName }, g);
          },
        },
        { type: "separator" },
        {
          label: "Delete Component",
          shortcut: "Del",
          danger: true,
          action: () => deleteSelectedCells(g),
        },
      ],
    });
  });

  g.on("edge:contextmenu", ({ edge, e }: { edge: Edge; e: MouseEvent }) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!edge || !edge.isEdge()) return;

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      container,
      items: [
        {
          label: "Re-route Orthogonal",
          action: () => {
            rerouteEdgeOrthogonal(edge, g);
          },
        },
        {
          label: "Clear Bends / Vertices",
          action: () => {
            edge.setVertices([]);
            rerouteEdgeOrthogonal(edge, g);
          },
        },
        { type: "separator" },
        {
          label: "Delete Connection",
          shortcut: "Del",
          danger: true,
          action: () => {
            const src = edge.getSource() as { cell?: string; port?: string } | undefined;
            const tgt = edge.getTarget() as { cell?: string; port?: string } | undefined;
            if (src?.cell && src?.port && tgt?.cell && tgt?.port) {
              enqueueDiagramAction(
                { type: "disconnect", source: `${src.cell}.${src.port}`, target: `${tgt.cell}.${tgt.port}` },
                g,
              );
            }
            g.removeCell?.(edge);
            scheduleUpdateSolderDots(g);
          },
        },
      ],
    });
  });

  g.on("blank:contextmenu", ({ e }: { e: MouseEvent }) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      container,
      items: [
        {
          label: "Zoom to Fit",
          shortcut: "Shift+1",
          action: () => {
            g.zoomToFit({ maxScale: 1, padding: 24 });
          },
        },
        {
          label: "Reset Zoom (100%)",
          shortcut: "Ctrl+0",
          action: () => {
            if (typeof g.zoomTo === "function") g.zoomTo(1);
            else g.zoom(1, { absolute: true });
          },
        },
        { type: "separator" },
        {
          label: "Auto-layout Diagram",
          action: () => {
            const opts = getOptionsForGraph(g);
            if (opts?.onAutoLayout) {
              opts.onAutoLayout();
            } else {
              postMessageToHost({ type: "autoLayout" }, g);
            }
          },
        },
        {
          label: isMinimapOpen(container) ? "Hide Minimap" : "Show Minimap",
          shortcut: "M",
          action: () => {
            toggleMinimapHud(container);
            updateMinimapHud(minimapHud, g);
          },
        },
      ],
    });
  });

  g.on("blank:click", () => {
    hideContextMenu(container);
    try {
      const edges = typeof g.getEdges === "function" ? g.getEdges() : [];
      for (const e of edges) {
        if (!g.isSelected?.(e)) {
          e.removeTools?.();
        }
      }
    } catch {}
  });

  const onAltKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Alt" || e.altKey) isAltPressed = true;
  };
  const onAltKeyUp = (e: KeyboardEvent) => {
    if (e.key === "Alt" || !e.altKey) isAltPressed = false;
  };

  let nudgeCommitTimeout: ReturnType<typeof setTimeout> | null = null;
  const pendingNudgeNodeIds = new Set<string>();

  // Keyboard shortcuts: Delete, Arrow Key Shifting, Flip, Duplicate, Rename, Align, Zoom
  const onDocKeyDown = (e: KeyboardEvent) => {
    if (g.disposed) return;

    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        (active as HTMLElement).isContentEditable ||
        Boolean((active as HTMLElement).closest?.(".monaco-editor")))
    ) {
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      deleteSelectedCells(g);
      return;
    }

    if (graph === g) {
      const nav = navigator as unknown as {
        platform?: string | undefined;
        userAgent?: string | undefined;
        userAgentData?: { platform?: string | undefined } | undefined;
      };
      const platform = (nav.platform || nav.userAgentData?.platform || nav.userAgent || "").toUpperCase();
      const isMac = platform.indexOf("MAC") >= 0;
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // ── 3-Gear Precision Arrow Key Shifting (Normal: 2px, Shift: 10px, Alt: 1px) ──
      if (!mod && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const selectedNodes = g
          .getSelectedCells()
          .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
        if (selectedNodes.length > 0 && !isCurrentDiagramReadOnly) {
          e.preventDefault();
          const alignable: AlignableNode[] = selectedNodes.map((n: Node) => {
            const p = n.getPosition();
            const s = n.getSize();
            return { id: n.id, x: p.x, y: p.y, width: s.width, height: s.height };
          });
          const nudges = computeNodeNudge(alignable, e.key as ArrowKeyDirection, {
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            baseStep: 2,
          });
          if (nudges.length > 0) {
            const stepDx = nudges[0]!.dx;
            const stepDy = nudges[0]!.dy;
            nudgeAccumDx += stepDx;
            nudgeAccumDy += stepDy;

            isSnappingPortAlignment = true;
            g.batchUpdate("nudge", () => {
              for (const u of nudges) {
                const node = g.getCellById(u.id) as Node;
                if (node && typeof node.isNode === "function" && node.isNode()) {
                  node.setPosition(u.x, u.y);
                  translateConnectedEdgeStubs(g, node, u.dx, u.dy);
                  pendingNudgeNodeIds.add(u.id);
                }
              }
            });
            isSnappingPortAlignment = false;

            syncAllNodeSelectionBoxes(g, selectionImpl?.container);
            syncAlignmentToolbar();
            showNudgeHud(g, selectedNodes, nudgeAccumDx, nudgeAccumDy);
            scheduleUpdateSolderDots(g);

            if (nudgeCommitTimeout) clearTimeout(nudgeCommitTimeout);
            nudgeCommitTimeout = setTimeout(() => {
              const moveItems: Record<string, unknown>[] = [];
              pendingNudgeNodeIds.forEach((id) => {
                const n = g.getCellById(id) as Node | null;
                if (n && typeof n.isNode === "function" && n.isNode()) {
                  const p = n.getPosition();
                  const s = n.getSize();
                  const r = n.getAngle?.() || 0;
                  const edges = getConnectedEdges(g, n);
                  const name = (n.getData?.()?.["name"] as string) || n.id;
                  moveItems.push({
                    name,
                    x: p.x,
                    y: p.y,
                    width: s.width,
                    height: s.height,
                    rotation: r,
                    edges,
                  });
                }
              });
              pendingNudgeNodeIds.clear();
              nudgeCommitTimeout = null;
              if (moveItems.length > 0) {
                enqueueDiagramAction({ type: "move", items: moveItems }, g);
              }
            }, 150);
          }
          return;
        }
      }

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        Spinner.show();
        if (e.shiftKey) {
          postMessageToHost({ type: "redo" }, g);
        } else {
          postMessageToHost({ type: "undo" }, g);
        }
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        Spinner.show();
        postMessageToHost({ type: "redo" }, g);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelectedNodes(g);
      } else if (mod && (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd")) {
        e.preventDefault();
        const current = g.zoom();
        const next = Math.min(3, Math.round((current + 0.15) * 100) / 100);
        if (typeof g.zoomTo === "function") g.zoomTo(next);
        else g.zoom(next, { absolute: true });
      } else if (mod && (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract")) {
        e.preventDefault();
        const current = g.zoom();
        const next = Math.max(0.1, Math.round((current - 0.15) * 100) / 100);
        if (typeof g.zoomTo === "function") g.zoomTo(next);
        else g.zoom(next, { absolute: true });
      } else if (mod && (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0")) {
        e.preventDefault();
        if (typeof g.zoomTo === "function") g.zoomTo(1);
        else g.zoom(1, { absolute: true });
      } else if ((mod && (e.key === "1" || e.code === "Digit1")) || (e.shiftKey && (e.key === "1" || e.key === "!"))) {
        e.preventDefault();
        g.zoomToFit({ maxScale: 1, padding: 24 });
      } else if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleMinimapHud(container);
        updateMinimapHud(minimapHud, g);
      } else if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        rotateSelectedNodes(e.shiftKey ? -90 : 90, g);
      } else if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        flipSelectedNodes("x", g);
      } else if ((e.key === "v" || e.key === "V") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        flipSelectedNodes("y", g);
      } else if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const selectedNodes = g
          .getSelectedCells()
          .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
        if (selectedNodes.length === 1 && triggerInlineNodeEdit) {
          e.preventDefault();
          triggerInlineNodeEdit(selectedNodes[0]!);
        }
      } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const selectedNodes = g
          .getSelectedCells()
          .filter((c: Cell) => typeof c.isNode === "function" && c.isNode() && !isEphemeralDiagramNode(c.id)) as Node[];
        if (selectedNodes.length === 1) {
          e.preventDefault();
          const first = selectedNodes[0]!;
          const nodeName = (first.getData?.()?.["name"] as string) || first.id;
          const cachedProps = propertyCache.get(first.id);
          if (cachedProps) {
            showProperties({ id: first.id, properties: cachedProps }, g);
          } else {
            showProperties({ id: first.id, properties: first.getData?.()?.properties, isLoading: true }, g);
            postMessageToHost({ type: "getProperties", componentName: nodeName }, g);
          }
        }
      } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const alignMap: Record<string, AlignmentType> = {
          l: "align-left",
          c: "align-center",
          r: "align-right",
          t: "align-top",
          m: "align-middle",
          b: "align-bottom",
          h: "distribute-horizontal",
          v: "distribute-vertical",
        };
        const alignType = alignMap[e.key.toLowerCase()];
        if (alignType) {
          const btn = alignmentToolbar?.querySelector(`[data-action="${alignType}"], [data-align="${alignType}"]`) as
            | HTMLButtonElement
            | null
            | undefined;
          if (btn) {
            e.preventDefault();
            btn.click();
          }
        }
      }
    }
  };

  let onSpaceKeyDown: ((e: KeyboardEvent) => void) | null = null;
  let onSpaceKeyUp: ((e: KeyboardEvent) => void) | null = null;
  let onContainerMouseDownCapture: ((e: MouseEvent) => void) | null = null;
  let onWindowMouseMoveCapture: ((e: MouseEvent) => void) | null = null;
  let onWindowMouseUpCapture: ((e: MouseEvent) => void) | null = null;
  let onWindowBlur: (() => void) | null = null;

  if (typeof document !== "undefined") {
    document.addEventListener("keydown", onAltKeyDown);
    document.addEventListener("keyup", onAltKeyUp);
    document.addEventListener("keydown", onDocKeyDown);

    // ── CAD Spacebar Hand Pan Mode ──
    let isSpacePressed = false;
    let isSpacePanning = false;
    let spacePanStartX = 0;
    let spacePanStartY = 0;

    const isTargetEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const htmlEl = el as HTMLElement;
      if (
        htmlEl.tagName === "INPUT" ||
        htmlEl.tagName === "TEXTAREA" ||
        htmlEl.tagName === "SELECT" ||
        htmlEl.isContentEditable ||
        Boolean(htmlEl.closest?.(".monaco-editor, [contenteditable='true'], input, textarea, select"))
      ) {
        return true;
      }
      return false;
    };

    onSpaceKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        if (isTargetEditable(document.activeElement) || isTargetEditable(e.target as Element)) {
          return;
        }
        const isOverContainer = Boolean(
          (typeof container.matches === "function" && container.matches(":hover")) ||
          (e.target && container.contains(e.target as unknown as globalThis.Node)) ||
          (document.activeElement && container.contains(document.activeElement)),
        );
        if (!isOverContainer) {
          return;
        }
        if (!isSpacePressed) {
          isSpacePressed = true;
          container.classList.add("x6-hand-panning");
        }
        e.preventDefault();
      }
    };

    onSpaceKeyUp = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") {
        isSpacePressed = false;
        isSpacePanning = false;
        container.classList.remove("x6-hand-panning");
        container.classList.remove("x6-hand-panning-active");
      }
    };

    onContainerMouseDownCapture = (e: MouseEvent) => {
      if (isSpacePressed) {
        isSpacePanning = true;
        spacePanStartX = e.clientX;
        spacePanStartY = e.clientY;
        container.classList.add("x6-hand-panning-active");
        e.preventDefault();
        e.stopPropagation();
      }
    };

    onWindowMouseMoveCapture = (e: MouseEvent) => {
      if (isSpacePanning) {
        const dx = e.clientX - spacePanStartX;
        const dy = e.clientY - spacePanStartY;
        spacePanStartX = e.clientX;
        spacePanStartY = e.clientY;
        const cur = typeof g.translate === "function" ? g.translate() : { tx: 0, ty: 0 };
        g.translate(cur.tx + dx, cur.ty + dy);
        e.preventDefault();
        e.stopPropagation();
      }
    };

    onWindowMouseUpCapture = (e: MouseEvent) => {
      if (isSpacePanning) {
        isSpacePanning = false;
        container.classList.remove("x6-hand-panning-active");
        if (!isSpacePressed) {
          container.classList.remove("x6-hand-panning");
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };

    onWindowBlur = () => {
      isSpacePressed = false;
      isSpacePanning = false;
      container.classList.remove("x6-hand-panning");
      container.classList.remove("x6-hand-panning-active");
    };

    container.addEventListener("mousedown", onContainerMouseDownCapture, true);
    window.addEventListener("mousemove", onWindowMouseMoveCapture, true);
    window.addEventListener("mouseup", onWindowMouseUpCapture, true);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("keydown", onSpaceKeyDown);
    document.addEventListener("keyup", onSpaceKeyUp);
  }

  g.on("node:mousedown", ({ node }: { node: Node }) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const interactiveBindings = node.getData()?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "momentary") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "mousedown");
          if (action) enqueueDiagramAction(action, g);
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
          if (action) enqueueDiagramAction(action, g);
        }
      }
    }
  });

  g.on("node:click", ({ node }: { node: Node }) => {
    if (g.disposed) return;
    const opts = getOptionsForGraph(g);
    if (isEphemeralDiagramNode(node.id)) {
      selectedNodeId = null;
      const inst = containerInstances.get(container);
      if (inst) inst.selectedNodeId = null;
      if (opts?.onSelect) opts.onSelect(null);
      return;
    }
    selectedNodeId = node.id;
    const inst = containerInstances.get(container);
    if (inst) inst.selectedNodeId = node.id;
    const data = node.getData();

    // Module link button single-click navigation (e.g. 'More on Passive Elements' in PSCAD library)
    if (data?.kind === "module-link" && data.targetModule) {
      postMessageToHost(
        {
          type: "navigateTo",
          className: data.targetModule,
          diagramType: "All",
        },
        g,
      );
      return;
    }

    // Process interactive bindings on click (toggle, numeric, selector, faceplate)
    const interactiveBindings = data?.interactive;
    if (Array.isArray(interactiveBindings)) {
      for (const binding of interactiveBindings) {
        if (binding.action === "toggle" || binding.action === "faceplate") {
          const action = defaultInteractiveStateManager.handleInteraction(node, binding, "click");
          if (action) enqueueDiagramAction(action, g);
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
              if (action) enqueueDiagramAction(action, g);
            }
          }
        }
      }
    }

    // Show properties panel immediately with lightweight data, then request full properties
    const cachedProps = propertyCache.get(node.id);
    if (cachedProps) {
      showProperties({ id: node.id, properties: cachedProps }, g);
    } else {
      // Show panel with lightweight data (className, name, description) + loading indicator
      showProperties({ id: node.id, properties: data?.properties, isLoading: true }, g);
      // Request full properties from host on-demand
      postMessageToHost({ type: "getProperties", componentName: node.id }, g);
    }

    // Reveal the source location of the clicked element in the text editor
    const props = data?.properties;
    if (props?.sourceRange) {
      postMessageToHost(
        {
          type: "revealSource",
          startOffset: props.sourceRange.startOffset,
          endOffset: props.sourceRange.endOffset,
        },
        g,
      );
    }

    // Only pan to the clicked node if it is clipped or outside the comfortable visible viewport
    const bbox = node.getBBox();
    const scale = g.scale().sx;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const paddingRight = 300;
    const containerRect = g.container.getBoundingClientRect();
    const visibleWidth = Math.max(200, containerRect.width - paddingRight);
    const { tx: ctx, ty: cty } = g.translate();

    const screenLeft = bbox.x * scale + ctx;
    const screenTop = bbox.y * scale + cty;
    const screenRight = (bbox.x + bbox.width) * scale + ctx;
    const screenBottom = (bbox.y + bbox.height) * scale + cty;
    const margin = 36;
    const isComfortablyVisible =
      screenLeft >= margin &&
      screenTop >= margin &&
      screenRight <= visibleWidth - margin &&
      screenBottom <= containerRect.height - margin;

    if (!isComfortablyVisible && containerRect.width > 0 && containerRect.height > 0) {
      const targetTx = visibleWidth / 2 - cx * scale;
      const targetTy = containerRect.height / 2 - cy * scale;
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
    }
  });

  const startInlineNodeEdit = (node: Node) => {
    if (isCurrentDiagramReadOnly || isEphemeralDiagramNode(node.id)) return;
    const existingInput = document.getElementById("__diagram_inline_input__");
    if (existingInput) existingInput.remove();

    const view = g.findViewByCell(node);
    const containerEl = g.container;
    if (!view?.container || !containerEl) return;

    const rect = view.container.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();
    const left = Math.max(8, rect.left - containerRect.left);
    const top = Math.max(8, rect.bottom - containerRect.top - 26);
    const width = Math.min(260, Math.max(90, rect.width));

    const data = node.getData();
    const currentName = String(data?.["name"] ?? data?.properties?.name ?? node.id);

    const input = document.createElement("input");
    input.id = "__diagram_inline_input__";
    input.type = "text";
    input.value = currentName;
    input.style.position = "absolute";
    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.width = `${width}px`;
    input.style.height = "24px";
    input.style.boxSizing = "border-box";
    input.style.background = isDark ? "#1e1e1e" : "#ffffff";
    input.style.color = isDark ? "#cccccc" : "#333333";
    input.style.border = "1.5px solid #007fd4";
    input.style.borderRadius = "3px";
    input.style.fontFamily = "inherit";
    input.style.fontSize = "12px";
    input.style.textAlign = "center";
    input.style.zIndex = "100000";
    input.style.outline = "none";
    input.style.padding = "0 6px";
    input.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        node.setData({ ...node.getData(), name: newName });
        enqueueDiagramAction({ type: "updateName", oldName: currentName, newName }, g);
        syncAlignmentToolbar();
      }
      input.remove();
    };

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        committed = true;
        input.remove();
      }
    });

    input.addEventListener("blur", () => {
      commit();
    });

    containerEl.appendChild(input);
    input.focus();
    input.select();
  };
  triggerInlineNodeEdit = startInlineNodeEdit;

  // ── Double-click navigation: drill into child diagram views ──
  // E.g., double-click a StateDefinition in BDD → open StateMachine view for it.
  g.on("node:dblclick", ({ node }: { node: Node }) => {
    if (isEphemeralDiagramNode(node.id)) return;
    const data = node.getData();
    if (data?.kind === "module-link" && data.targetModule) {
      postMessageToHost(
        {
          type: "navigateTo",
          className: data.targetModule,
          diagramType: "All",
        },
        g,
      );
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

    const targetDiagramType = props?.ruleName ? navigationMap[props.ruleName] : undefined;
    if (targetDiagramType) {
      postMessageToHost(
        {
          type: "navigateTo",
          className: props.description, // the element name
          diagramType: targetDiagramType,
        },
        g,
      );
      return;
    }

    // Leaf component: trigger inline canvas rename
    startInlineNodeEdit(node);
  });

  g.on("blank:click", () => {
    selectedNodeId = null;
    const inst = containerInstances.get(container);
    if (inst) inst.selectedNodeId = null;
    const opts = getOptionsForGraph(g);
    if (opts?.onSelect) opts.onSelect(null);
  });

  activeSyncAlignmentToolbar = syncAlignmentToolbar;

  // Register container-scoped instance with listener cleanup
  containerInstances.set(container, {
    graph: g,
    options: currentOptions && currentOptions.container === container ? currentOptions : { container, isDark },
    selectedNodeId: null,
    rotateSelectedNodes,
    flipSelectedNodes,
    syncAlignmentToolbar,
    cleanupListeners: () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("keydown", onWindowEscape);
        if (onWindowMouseMoveCapture) window.removeEventListener("mousemove", onWindowMouseMoveCapture, true);
        if (onWindowMouseUpCapture) window.removeEventListener("mouseup", onWindowMouseUpCapture, true);
        if (onWindowBlur) window.removeEventListener("blur", onWindowBlur);
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("keydown", onAltKeyDown);
        document.removeEventListener("keyup", onAltKeyUp);
        document.removeEventListener("keydown", onDocKeyDown);
        if (onSpaceKeyDown) document.removeEventListener("keydown", onSpaceKeyDown);
        if (onSpaceKeyUp) document.removeEventListener("keyup", onSpaceKeyUp);
      }
      if (onContainerMouseDownCapture) {
        container.removeEventListener("mousedown", onContainerMouseDownCapture, true);
      }
    },
  });

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
  __toggleWireTool?: ((active?: boolean) => boolean) | undefined;
  __isWireToolActive?: (() => boolean) | undefined;
  __cancelWireTool?: (() => void) | undefined;
  __startInlineNodeEdit?: ((nodeId: string) => void) | undefined;
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
  coordinateSystem?: CoordinateSystem | null | undefined;
  diagramBackground?: unknown;
  breadcrumbs?: { id: string; label: string }[] | undefined;
  metadata?:
    | {
        breadcrumbs?: { id: string; label: string }[] | undefined;
        currentModule?: string | undefined;
        readOnly?: boolean | undefined;
        defaultConnector?: unknown | undefined;
        [key: string]: unknown;
      }
    | undefined;
  className?: string | undefined;
  isLoading?: boolean | undefined;
  readOnly?: boolean | undefined;
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

export function renderDiagramInternal(g: Graph, data: RenderDiagramInput, isDark: boolean) {
  isCurrentDiagramReadOnly = Boolean(data.readOnly || data.metadata?.readOnly);
  activeDefaultConnector = data.metadata?.defaultConnector ?? currentOptions?.defaultConnector;
  activeDiagramMetadata = data.metadata as Record<string, unknown> | undefined;
  if (g?.container && containerInstances.has(g.container)) {
    containerInstances.get(g.container)!.metadata = activeDiagramMetadata;
  }

  // Resolve and apply language-adaptive edge selection style
  const opts = getOptionsForGraph(g);
  const lang = (data.metadata?.["language"] as string | undefined) ?? (data.diagramType as string) ?? opts?.language;
  const userEdgePref =
    (activeDiagramMetadata?.["edgeSelectionStyle"] as EdgeSelectionStyle) ?? opts?.edgeSelectionStyle;
  const resolvedEdgeStyle = resolveEdgeSelectionStyle(lang, userEdgePref);
  if (g.container) {
    g.container.setAttribute("data-edge-selection", resolvedEdgeStyle);
  }

  // Dynamically configure canvas grid from coordinateSystem if specified
  if (data.coordinateSystem?.grid) {
    const gridConfig = data.coordinateSystem.grid;
    if (Array.isArray(gridConfig)) {
      if (typeof gridConfig[0] === "number" && gridConfig[0] > 0) {
        g.setGridSize?.(gridConfig[0]);
      }
    } else if (typeof gridConfig === "object") {
      if (gridConfig.visible === false) {
        g.hideGrid?.();
      } else {
        g.showGrid?.();
        if (typeof gridConfig.x === "number" && gridConfig.x > 0) {
          g.setGridSize?.(gridConfig.x);
        }
        if (gridConfig.type) {
          const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";
          if (gridConfig.type === "dot") {
            g.drawGrid({ type: "dot", args: { color: gridConfig.color ?? gridColor, thickness: 1.5 } });
          } else if (gridConfig.type === "mesh") {
            g.drawGrid({ type: "mesh", args: { color: gridConfig.color ?? gridColor, thickness: 1 } });
          } else if (gridConfig.type === "doubleMesh") {
            g.drawGrid({
              type: "doubleMesh",
              args: [
                { color: "transparent", thickness: 0 },
                { color: gridConfig.color ?? gridColor, thickness: 1, factor: 10 },
              ],
            });
          }
        }
      }
    }
  }

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

    const effectiveMarkup =
      isDark && node.markup ? adaptX6Markup(node.markup, { isDark, targetBg: "#121212" }) : node.markup;
    const portsObj =
      isDark && normalizedPorts && typeof normalizedPorts === "object"
        ? (normalizedPorts as { items?: unknown[] })
        : undefined;
    const effectivePorts =
      portsObj && Array.isArray(portsObj.items)
        ? {
            ...portsObj,
            items: portsObj.items.map((item) => {
              if (!item || typeof item !== "object") return item;
              const portItem = item as Record<string, unknown>;
              if (!portItem["markup"]) return item;
              return {
                ...portItem,
                markup: adaptX6Markup(portItem["markup"], { isDark, targetBg: "#121212" }),
              };
            }),
          }
        : normalizedPorts;

    const nodeData: RenderNodeData = {
      id: node.id,
      x: node.x ?? 0,
      y: node.y ?? 0,
      width: node.width ?? 180,
      height: node.height ?? 70,
      angle: node.angle,
      zIndex: node.zIndex,
      opacity: node.opacity,
      markup: effectiveMarkup,
      ports: effectivePorts,
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
      } else {
        for (const [selKey, selVal] of Object.entries(attrsCopy)) {
          if (selVal && typeof selVal === "object") {
            const valObj = { ...(selVal as Record<string, unknown>) };
            const isTextSel =
              selKey === "label" || selKey === "subtitle" || selKey === "stereotype" || selKey.includes("text");
            if (typeof valObj["fill"] === "string" && valObj["fill"] !== "none" && valObj["fill"] !== "transparent") {
              valObj["fill"] = adaptColorForDarkMode(
                valObj["fill"],
                { isDark: true, targetBg: "#121212" },
                isTextSel ? "text" : "fill",
              );
            }
            if (
              typeof valObj["stroke"] === "string" &&
              valObj["stroke"] !== "none" &&
              valObj["stroke"] !== "transparent"
            ) {
              valObj["stroke"] = adaptColorForDarkMode(
                valObj["stroke"],
                { isDark: true, targetBg: "#121212" },
                "stroke",
              );
            }
            attrsCopy[selKey] = valObj;
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
      connector: edge.connector ??
        activeDefaultConnector ??
        currentOptions?.defaultConnector ?? { name: "rounded", args: { radius: 8 } },
      router: edge.router ?? (edge.connector === "smooth" ? { name: "normal" } : { name: "port-orthogonal-astar" }),
    };
    // Polyglot edges pass attrs as a full selector-keyed object;
    // Modelica edges have attrs.line specifically
    const edgeAttrs = edge.attrs as
      | { line?: Record<string, unknown> | undefined; [key: string]: Record<string, unknown> | undefined }
      | undefined;
    if (edgeAttrs?.line) {
      const lineCopy = { ...edgeAttrs.line };
      if (isDark) {
        if (
          typeof lineCopy["stroke"] === "string" &&
          lineCopy["stroke"] !== "none" &&
          lineCopy["stroke"] !== "transparent"
        ) {
          lineCopy["stroke"] = adaptColorForDarkMode(
            lineCopy["stroke"],
            { isDark: true, targetBg: "#121212" },
            "stroke",
          );
        }
        if (typeof lineCopy["strokeWidth"] === "number" && lineCopy["strokeWidth"] < 1.5) {
          lineCopy["strokeWidth"] = 1.75;
        }
        const sm = lineCopy["sourceMarker"] as Record<string, unknown> | undefined;
        if (sm && typeof sm === "object") {
          const smCopy = { ...sm };
          if (typeof smCopy["fill"] === "string" && smCopy["fill"] !== "none") {
            smCopy["fill"] = adaptColorForDarkMode(smCopy["fill"], { isDark: true, targetBg: "#121212" }, "fill");
          }
          if (typeof smCopy["stroke"] === "string" && smCopy["stroke"] !== "none") {
            smCopy["stroke"] = adaptColorForDarkMode(smCopy["stroke"], { isDark: true, targetBg: "#121212" }, "stroke");
          }
          lineCopy["sourceMarker"] = smCopy;
        }
        const tm = lineCopy["targetMarker"] as Record<string, unknown> | undefined;
        if (tm && typeof tm === "object") {
          const tmCopy = { ...tm };
          if (typeof tmCopy["fill"] === "string" && tmCopy["fill"] !== "none") {
            tmCopy["fill"] = adaptColorForDarkMode(tmCopy["fill"], { isDark: true, targetBg: "#121212" }, "fill");
          }
          if (typeof tmCopy["stroke"] === "string" && tmCopy["stroke"] !== "none") {
            tmCopy["stroke"] = adaptColorForDarkMode(tmCopy["stroke"], { isDark: true, targetBg: "#121212" }, "stroke");
          }
          lineCopy["targetMarker"] = tmCopy;
        }
      } else {
        const tm = lineCopy["targetMarker"] as Record<string, unknown> | undefined;
        if (tm && typeof tm === "object" && tm["fill"] === "#1e1e1e") {
          lineCopy["targetMarker"] = { ...tm, fill: "#ffffff" };
        }
      }
      edgeData.attrs = { "z-index": "-10", line: lineCopy };
    } else if (edgeAttrs) {
      if (isDark) {
        const adaptedEdgeAttrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(edgeAttrs)) {
          if (v && typeof v === "object") {
            const vObj = { ...(v as Record<string, unknown>) };
            if (typeof vObj["stroke"] === "string" && vObj["stroke"] !== "none") {
              vObj["stroke"] = adaptColorForDarkMode(vObj["stroke"], { isDark: true, targetBg: "#121212" }, "stroke");
            }
            if (typeof vObj["fill"] === "string" && vObj["fill"] !== "none") {
              vObj["fill"] = adaptColorForDarkMode(vObj["fill"], { isDark: true, targetBg: "#121212" }, "fill");
            }
            adaptedEdgeAttrs[k] = vObj;
          } else {
            adaptedEdgeAttrs[k] = v;
          }
        }
        edgeData.attrs = adaptedEdgeAttrs as RenderEdgeData["attrs"];
      } else {
        edgeData.attrs = edgeAttrs;
      }
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
    const showBounds = cs.boundsStyle?.visible !== false;
    const boundsStroke = cs.boundsStyle?.stroke ?? "#999";
    const boundsDash = cs.boundsStyle?.strokeDasharray ? ` stroke-dasharray: ${cs.boundsStyle.strokeDasharray};` : "";
    const boundsWidth = cs.boundsStyle?.strokeWidth ?? 1;
    const boundsFill = cs.boundsStyle?.fill ?? "transparent";

    const children: unknown[] = [];
    if (showBounds) {
      children.push({
        tagName: "rect",
        attrs: {
          style: `fill: ${boundsFill}; stroke: ${boundsStroke}; stroke-width: ${boundsWidth}px;${boundsDash} vector-effect: non-scaling-stroke; pointer-events: none;`,
          width: cs.width,
          height: cs.height,
        },
      });

      if (cs.boundsStyle?.headerText) {
        const headerText = cs.boundsStyle.headerText;
        const badgeW = Math.min(cs.width, Math.max(80, headerText.length * 7 + 16));
        children.push(
          {
            tagName: "rect",
            attrs: {
              x: "0",
              y: "0",
              width: String(badgeW),
              height: "20",
              fill: isDark ? "#1e293b" : "#f1f5f9",
              stroke: boundsStroke,
              "stroke-width": "1",
            },
          },
          {
            tagName: "text",
            textContent: headerText,
            attrs: {
              x: "8",
              y: "14",
              fill: isDark ? "#94a3b8" : "#475569",
              "font-size": "10.5",
              "font-family": "Inter, system-ui, sans-serif",
              "font-weight": "600",
            },
          },
        );
      }
    }
    if (data.diagramBackground) {
      children.push(
        isDark ? adaptX6Markup(data.diagramBackground, { isDark, targetBg: "#121212" }) : data.diagramBackground,
      );
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
    const cs = data.coordinateSystem;
    const showAxes = cs.axesStyle?.visible !== false;
    if (showAxes) {
      const defaultAxisStroke = isDark ? "rgba(255, 255, 255, 0.12)" : "#999";
      const axisStroke = cs.axesStyle?.stroke ?? defaultAxisStroke;
      const axisWidth = String(cs.axesStyle?.strokeWidth ?? 1);
      const axisDash = cs.axesStyle?.strokeDasharray;
      const boundsOnly = cs.axesStyle?.boundsOnly === true;
      const ox = cs.axesStyle?.origin?.[0] ?? 0;
      const oy = cs.axesStyle?.origin?.[1] ?? 0;

      const minX = boundsOnly ? cs.x : -100000;
      const maxX = boundsOnly ? cs.x + cs.width : 100000;
      const minY = boundsOnly ? cs.y : -100000;
      const maxY = boundsOnly ? cs.y + cs.height : 100000;

      const lineAttrsX: Record<string, string> = {
        x1: String(minX),
        y1: String(oy),
        x2: String(maxX),
        y2: String(oy),
        stroke: axisStroke,
        "stroke-width": axisWidth,
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "none",
      };
      if (axisDash) {
        lineAttrsX["stroke-dasharray"] = axisDash;
      }

      const lineAttrsY: Record<string, string> = {
        x1: String(ox),
        y1: String(minY),
        x2: String(ox),
        y2: String(maxY),
        stroke: axisStroke,
        "stroke-width": axisWidth,
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "none",
      };
      if (axisDash) {
        lineAttrsY["stroke-dasharray"] = axisDash;
      }

      const axisChildren: unknown[] = [
        {
          tagName: "line",
          attrs: lineAttrsX,
        },
        {
          tagName: "line",
          attrs: lineAttrsY,
        },
      ];

      if (cs.axesStyle?.xLabel) {
        axisChildren.push({
          tagName: "text",
          textContent: cs.axesStyle.xLabel,
          attrs: {
            x: String(maxX - 4),
            y: String(oy - 6),
            "text-anchor": "end",
            fill: axisStroke,
            "font-size": "10",
            "font-family": "Inter, system-ui, sans-serif",
          },
        });
      }

      if (cs.axesStyle?.yLabel) {
        axisChildren.push({
          tagName: "text",
          textContent: cs.axesStyle.yLabel,
          attrs: {
            x: String(ox + 6),
            y: String(minY + 12),
            "text-anchor": "start",
            fill: axisStroke,
            "font-size": "10",
            "font-family": "Inter, system-ui, sans-serif",
          },
        });
      }

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
          children: axisChildren,
        },
      });
    }
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

  const currentModule = data.metadata?.currentModule ?? data.className ?? null;
  const moduleChanged = lastRenderedModule !== null && currentModule !== null && lastRenderedModule !== currentModule;
  lastRenderedModule = currentModule;

  // ── Diff-based incremental update ──
  // If the graph already has cells and the module hasn't changed,
  // update positions, properties, and cells in-place instead of destroying
  // the entire DOM via fromJSON. This guarantees zero flicker and preserves
  // active drag handles, selection states, and focus.
  const existingCells = g.getCells();
  const isFirstRender = existingCells.length === 0;

  if (!isFirstRender && !moduleChanged) {
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

    if (activeDrop && isComponentPresentInData) {
      const ph = g.getCellById("__drop_placeholder__");
      if (ph) g.removeCell(ph);
      clearActiveDropPlaceholder();
    }

    // ── Keyed Differential Cell Reconciler (Zero-Flicker) ──
    g.batchUpdate("diagram-diff", () => {
      if (!data.coordinateSystem) {
        const bg = g.getCellById("__diagram_background__");
        if (bg) g.removeCell(bg);
        const axes = g.getCellById("__diagram_axes__");
        if (axes) g.removeCell(axes);
      }

      // 1. Remove deleted nodes and edges
      for (const cell of existingCells) {
        if (isEphemeralDiagramNode(cell.id)) continue;
        if (cell.isNode() && !newNodeIds.has(cell.id)) {
          g.removeCell(cell);
        } else if (cell.isEdge() && !newEdgeIds.has(cell.id)) {
          g.removeCell(cell);
        }
      }

      for (const nodeData of nodes) {
        const cell = g.getCellById(nodeData.id);
        if (!cell || !cell.isNode()) {
          const added = g.addNode(nodeData);
          if (nodeData.data?.["flipX"] || nodeData.data?.["flipY"]) {
            applyNodeFlipVisuals(added, g, Boolean(nodeData.data["flipX"]), Boolean(nodeData.data["flipY"]));
          }
          continue;
        }

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
          if (nodeData.data["flipX"] !== undefined || nodeData.data["flipY"] !== undefined) {
            applyNodeFlipVisuals(cell, g, Boolean(nodeData.data["flipX"]), Boolean(nodeData.data["flipY"]));
          }
        }

        // Update markup and attrs (e.g. parameter ratings, breaker open/closed color, labels)
        if (nodeData.markup && JSON.stringify(cell.getMarkup?.()) !== JSON.stringify(nodeData.markup)) {
          cell.setMarkup(nodeData.markup);
          const view = g.findViewByCell(cell);
          const viewWithRender = view as unknown as { render?: () => void };
          if (viewWithRender && typeof viewWithRender.render === "function") {
            try {
              viewWithRender.render();
            } catch {
              // fallback if headless or view render fails
            }
          }
        }
        if (nodeData.attrs && JSON.stringify(cell.getAttrs?.()) !== JSON.stringify(nodeData.attrs)) {
          cell.setAttrs(nodeData.attrs);
        }

        // Update ports if changed (e.g. conditional ports like heatPort toggled via parameters)
        interface DiagramPortLike {
          id?: string;
          name?: string;
          args?: { x?: number; y?: number; angle?: number };
        }
        const currentPorts = (cell.getPorts?.() || []) as DiagramPortLike[];
        const newPortItems: DiagramPortLike[] = nodeData.ports
          ? Array.isArray(nodeData.ports)
            ? (nodeData.ports as DiagramPortLike[])
            : (nodeData.ports as { items?: DiagramPortLike[] })?.items || []
          : [];
        const currentSig = currentPorts
          .map((p) => `${p.id}:${p.args?.x ?? ""},${p.args?.y ?? ""},${p.args?.angle ?? ""}`)
          .join(";");
        const newSig = newPortItems
          .map((p) => `${p.id || p.name}:${p.args?.x ?? ""},${p.args?.y ?? ""},${p.args?.angle ?? ""}`)
          .join(";");
        if (currentSig !== newSig) {
          cell.prop?.("ports", nodeData.ports ?? { items: [], groups: {} }, { rewrite: true });
        }
      }

      // Update edge vertices, endpoints, attrs, labels, router, and data
      for (const edgeData of edges) {
        const cell = g.getCellById(edgeData.id);
        if (!cell || !cell.isEdge()) {
          g.addEdge(edgeData);
          continue;
        }

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

      // 4. Update embedding relationships
      for (const [childId, parentId] of relations) {
        const parentCell = g.getCellById(parentId);
        const childCell = g.getCellById(childId);
        if (parentCell && childCell && parentCell.isNode() && childCell.isNode()) {
          parentCell.addChild(childCell);
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
    scheduleViewportCulling(g);
    updateBreadcrumbs(data.breadcrumbs || data.metadata?.breadcrumbs);
    const hud = (g.container as HTMLElement | undefined)?.querySelector?.(
      "#modelscript-minimap-hud",
    ) as HTMLElement | null;
    if (hud) {
      updateMinimapHud(hud, g);
    }
    return;
  }

  // ── Full render path (first render or topology changed) ──
  const prevZoom = isFirstRender || typeof g.zoom !== "function" ? null : g.zoom();
  const prevTrans = isFirstRender || typeof g.translate !== "function" ? null : g.translate();

  // 2. Load the flat graph
  g.fromJSON({ nodes, edges });

  for (const nodeData of nodes) {
    if (nodeData.data?.["flipX"] || nodeData.data?.["flipY"]) {
      const cell = g.getCellById(nodeData.id);
      if (cell && cell.isNode()) {
        applyNodeFlipVisuals(cell, g, Boolean(nodeData.data["flipX"]), Boolean(nodeData.data["flipY"]));
      }
    }
  }

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

  // Only fit view on first render or when switching modules — preserve zoom/pan on subsequent updates
  if (isFirstRender || moduleChanged) {
    const parent = g.container?.parentElement;
    const parentW = parent?.clientWidth ?? 0;
    const parentH = parent?.clientHeight ?? 0;
    const clientW = g.container.clientWidth > 0 ? g.container.clientWidth : 0;
    const clientH = g.container.clientHeight > 0 ? g.container.clientHeight : 0;
    const containerW = parentW > 0 ? parentW : clientW > 0 ? clientW : 800;
    const containerH = parentH > 0 ? parentH : clientH > 0 ? clientH : 600;
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
      const ox = cs.axesStyle?.origin?.[0] ?? 0;
      const oy = cs.axesStyle?.origin?.[1] ?? 0;
      const gWithCenter = g as unknown as { centerPoint?: (x: number, y: number) => void };
      if (typeof gWithCenter.centerPoint === "function") {
        gWithCenter.centerPoint(ox, oy);
      } else if (typeof g.centerContent === "function") {
        g.centerContent();
      }
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
    const checkAndRecenter = () => {
      try {
        if (g && (typeof g.isDisposed === "function" ? !g.isDisposed() : true)) {
          const p = g.container?.parentElement;
          const pw = p?.clientWidth ?? 0;
          const ph = p?.clientHeight ?? 0;
          const cw = pw > 0 ? pw : (g.container?.clientWidth ?? 0);
          const ch = ph > 0 ? ph : (g.container?.clientHeight ?? 0);
          if (cw > 0 && ch > 0) {
            g.resize(cw, ch);
          }
          if (cs) {
            const currentViewport = { x: 0, y: 0, width: cw > 0 ? cw : containerW, height: ch > 0 ? ch : containerH };
            const expandedRect = {
              x: cs.x - cs.width * 0.125,
              y: cs.y - cs.height * 0.125,
              width: cs.width * 1.25,
              height: cs.height * 1.25,
            };
            g.zoomToRect(expandedRect, { viewportArea: currentViewport });
            const ox = cs.axesStyle?.origin?.[0] ?? 0;
            const oy = cs.axesStyle?.origin?.[1] ?? 0;
            const gCheckWithCenter = g as unknown as { centerPoint?: (x: number, y: number) => void };
            if (typeof gCheckWithCenter.centerPoint === "function") {
              gCheckWithCenter.centerPoint(ox, oy);
            } else if (typeof g.centerContent === "function") {
              g.centerContent();
            }
          } else {
            g.zoomToFit({ padding: 40, maxScale: 1.0, minScale: 0.2 });
            g.centerContent();
          }
        }
      } catch {
        // ignore
      }
    };
    setTimeout(checkAndRecenter, 60);
    setTimeout(checkAndRecenter, 300);
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
  scheduleViewportCulling(g);
  const inst = (g.container && containerInstances.get(g.container)) || null;
  inst?.syncAlignmentToolbar?.();
  if (!inst) {
    activeSyncAlignmentToolbar?.();
  }
  const hud = (g.container as HTMLElement | undefined)?.querySelector?.(
    "#modelscript-minimap-hud",
  ) as HTMLElement | null;
  if (hud) {
    updateMinimapHud(hud, g);
  }
  setTimeout(() => {
    if (graph === g && !g.disposed) {
      updateSolderDots(g);
      scheduleViewportCulling(g);
      const h = (g.container as HTMLElement | undefined)?.querySelector?.(
        "#modelscript-minimap-hud",
      ) as HTMLElement | null;
      if (h) {
        updateMinimapHud(h, g);
      }
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
      case "simulationFrame": {
        if (message.stateVector) {
          applySimulationFrame(message.stateVector, message.varIndexMap);
        }
        break;
      }
      case "simulationBatch": {
        if (Array.isArray(message.frames)) {
          applySimulationBatch(message.frames, message.fps);
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

function showProperties(
  nodeData: { id: string; properties?: unknown; isLoading?: boolean | undefined },
  g?: Graph | null,
) {
  const opts = getOptionsForGraph(g);
  if (opts?.onShowProperties) {
    opts.onShowProperties(nodeData.id, nodeData.properties, nodeData.isLoading);
  }
}

export {
  performViewportCulling,
  scheduleViewportCulling,
  type ViewportCullingGraph,
  type ViewportCullingGraphNode,
} from "./viewport-culling.js";

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

  const dotSize = 3;
  const radius = dotSize / 2;

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

/**
 * Disposes the AntV X6 graph instance for `targetContainer` (or the active graph if omitted)
 * and restores the remaining active container instance, if any.
 */
export function disposeDiagram(targetContainer?: HTMLElement | null) {
  if (targetContainer) {
    const inst = containerInstances.get(targetContainer);
    if (inst) {
      inst.cleanupListeners?.();
      try {
        inst.graph.dispose();
      } catch {
        // ignore dispose errors
      }
      containerInstances.delete(targetContainer);
      if (graph === inst.graph) {
        const remaining = Array.from(containerInstances.values()).pop();
        graph = remaining?.graph ?? null;
        currentOptions = remaining?.options ?? null;
        selectedNodeId = remaining?.selectedNodeId ?? null;
      }
    }
    return;
  }

  if (graph) {
    const container = graph.container;
    const inst = container ? containerInstances.get(container) : undefined;
    inst?.cleanupListeners?.();
    if (container) containerInstances.delete(container);
    try {
      graph.dispose();
    } catch {
      // ignore dispose errors
    }
    const remaining = Array.from(containerInstances.values()).pop();
    graph = remaining?.graph ?? null;
    currentOptions = remaining?.options ?? null;
    selectedNodeId = remaining?.selectedNodeId ?? null;
  } else {
    currentOptions = null;
  }
}

/**
 * Optimistically patch the SVG text label of a component in the diagram
 * when a parameter value changes. This avoids a full diagram re-render and
 * gives the user instant visual feedback as they type.
 *
 * The function walks all `<text>` elements inside the node's SVG and replaces
 * text content that matches the old parameter value pattern with the new one.
 */
export function updateParameterText(
  nodeId: string,
  paramName: string,
  oldValue: string,
  newValue: string,
  targetGraphOrContainer?: Graph | HTMLElement | null,
): void {
  const g =
    (targetGraphOrContainer &&
    typeof (targetGraphOrContainer as unknown as { getCellById?: unknown }).getCellById === "function"
      ? (targetGraphOrContainer as Graph)
      : targetGraphOrContainer && containerInstances.has(targetGraphOrContainer as HTMLElement)
        ? containerInstances.get(targetGraphOrContainer as HTMLElement)!.graph
        : getGraph(targetGraphOrContainer as HTMLElement)) ?? graph;
  if (!g) return;
  const cell = g.getCellById(nodeId);
  if (!cell || !cell.isNode()) return;

  const view = g.findViewByCell(cell);
  if (!view) return;

  const svgEl = view.container;
  if (!svgEl) return;

  const texts = Array.from(svgEl.querySelectorAll("text"));
  for (const textEl of texts) {
    const content = textEl.textContent ?? "";
    if (!content) continue;

    // Match patterns like "L=1", "R=100", or "R = 100" by parameter name prefix first
    const eqIdx = content.indexOf("=");
    if (eqIdx !== -1) {
      const left = content.slice(0, eqIdx).trim();
      if (left === paramName || left.endsWith(`.${paramName}`)) {
        textEl.textContent = `${paramName}=${newValue}`;
        continue;
      }
    }

    // Match patterns like "R=100", "100 Ω", or just "100"
    // Be specific: only replace if the text contains the exact old value
    if (oldValue && content.includes(oldValue)) {
      textEl.textContent = content.replace(oldValue, newValue);
    }
  }

  // Update cell's markup data structure so future getMarkup() is consistent
  const currentMarkup = cell.getMarkup?.();
  if (currentMarkup) {
    const patchMarkupText = (item: unknown) => {
      if (!item || typeof item !== "object") return;
      const rec = item as Record<string, unknown>;
      if (rec["tagName"] === "text") {
        const c = typeof rec["children"] === "string" ? rec["children"] : rec["textContent"];
        if (typeof c === "string") {
          const eq = c.indexOf("=");
          if (eq !== -1) {
            const left = c.slice(0, eq).trim();
            if (left === paramName || left.endsWith(`.${paramName}`)) {
              if (typeof rec["children"] === "string") rec["children"] = `${paramName}=${newValue}`;
              if (rec["textContent"]) rec["textContent"] = `${paramName}=${newValue}`;
            }
          } else if (oldValue && c.includes(oldValue)) {
            if (typeof rec["children"] === "string") rec["children"] = c.replace(oldValue, newValue);
            if (rec["textContent"]) rec["textContent"] = c.replace(oldValue, newValue);
          }
        }
      }
      if (Array.isArray(rec["children"])) {
        for (const ch of rec["children"]) {
          patchMarkupText(ch);
        }
      }
    };
    patchMarkupText(currentMarkup);
  }

  // Update propertyCache and cell data properties if present
  interface ParameterEntry {
    name?: string;
    value?: string;
  }
  const cached = propertyCache.get(nodeId) as { parameters?: ParameterEntry[] } | undefined;
  if (cached?.parameters && Array.isArray(cached.parameters)) {
    const p = cached.parameters.find(
      (item: ParameterEntry) => item && (item.name === paramName || item.name === `${paramName}`),
    );
    if (p) {
      p.value = newValue;
    }
  }
  const curData = cell.getData?.();
  const curProps = curData?.["properties"] as { parameters?: ParameterEntry[] } | undefined;
  if (curProps?.parameters && Array.isArray(curProps.parameters)) {
    const p = curProps.parameters.find(
      (item: ParameterEntry) => item && (item.name === paramName || item.name === `${paramName}`),
    );
    if (p) {
      p.value = newValue;
    }
  }

  // Synchronize alignment toolbar if this node is currently selected
  const inst = (g.container && containerInstances.get(g.container)) || null;
  inst?.syncAlignmentToolbar?.();
  if (!inst) {
    activeSyncAlignmentToolbar?.();
  }
}

/**
 * Returns the AntV X6 graph instance for `targetContainer` (or the active graph if omitted),
 * or `null` if none is initialized.
 */
export function getGraph(targetContainer?: HTMLElement | null): Graph | null {
  if (targetContainer && containerInstances.has(targetContainer)) {
    return containerInstances.get(targetContainer)!.graph;
  }
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

let activeSimulationBatchId: number | null = null;

/**
 * Applies and plays back a batch of simulation telemetry frames over time at the requested FPS.
 */
export function applySimulationBatch(frames: SimulationFrame[], fps = 30): void {
  if (!graph || !Array.isArray(frames) || frames.length === 0) return;
  if (typeof window === "undefined" || !window.requestAnimationFrame) {
    const last = frames[frames.length - 1];
    if (last) {
      applySimulationFrame(last.stateVector, last.varIndexMap);
    }
    return;
  }

  if (activeSimulationBatchId !== null) {
    cancelAnimationFrame(activeSimulationBatchId);
    activeSimulationBatchId = null;
  }

  let frameIdx = 0;
  let lastTime = 0;
  const interval = 1000 / Math.max(1, Math.min(120, fps));

  function tick(timestamp: number) {
    if (!lastTime) lastTime = timestamp;
    const elapsed = timestamp - lastTime;
    if (elapsed >= interval) {
      lastTime = timestamp;
      const frame = frames[frameIdx];
      if (frame) {
        applySimulationFrame(frame.stateVector, frame.varIndexMap);
      }
      frameIdx++;
    }
    if (frameIdx < frames.length) {
      activeSimulationBatchId = requestAnimationFrame(tick);
    } else {
      activeSimulationBatchId = null;
    }
  }

  activeSimulationBatchId = requestAnimationFrame(tick);
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
export * from "./alignment.js";
export * from "./aspen-diagram-builder.js";
export * from "./autosar-diagram-builder.js";
export * from "./collab-manager.js";
export * from "./collab-overlay.js";
export * from "./color-inversion.js";
export * from "./context-menu.js";
export * from "./easy5-diagram-builder.js";
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
export * from "./minimap.js";
export * from "./olga-diagram-builder.js";
export * from "./opendss-diagram-builder.js";
export * from "./openscenario-diagram-builder.js";
export * from "./oscal-diagram-builder.js";
export * from "./plcopen-diagram-builder.js";
export * from "./polyglot-diagram-builder.js";
export * from "./port-ilp-solver.js";
export * from "./port-router.js";
export * from "./properties/index.js";
export * from "./property-evaluator.js";
export * from "./property-sheet-controller.js";
export * from "./property-validator.js";
export * from "./protocol.js";
export type { ReactiveAnimationBinding, X6Markup } from "./protocol.js";
export * from "./pscad-diagram-builder.js";
export * from "./psse-diagram-builder.js";
export * from "./relap5-diagram-builder.js";
export * from "./rocets-diagram-builder.js";
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
export * from "./viewport-culling.js";
export * from "./visual-diff-graph.js";
export * from "./visual-diff-renderer.js";

export type DiagramGridMode = "doubleMesh" | "dot" | "mesh" | "none";

/**
 * Dynamically switches the canvas background grid style.
 */
export function setDiagramGrid(mode: DiagramGridMode, g?: Graph | null): void {
  const targetGraph = g ?? graph;
  if (!targetGraph || targetGraph.disposed) return;
  if (mode === "none") {
    targetGraph.hideGrid?.();
    return;
  }
  targetGraph.showGrid?.();
  const isDark =
    (targetGraph.options as { background?: { color?: string } } | undefined)?.background?.color !== "#ffffff";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";
  if (mode === "dot") {
    targetGraph.drawGrid({
      type: "dot",
      args: { color: gridColor, thickness: 1.5 },
    });
  } else if (mode === "mesh") {
    targetGraph.drawGrid({
      type: "mesh",
      args: { color: gridColor, thickness: 1 },
    });
  } else if (mode === "doubleMesh") {
    targetGraph.drawGrid({
      type: "doubleMesh",
      args: [
        { color: "transparent", thickness: 0 },
        { color: gridColor, thickness: 1, factor: 10 },
      ],
    });
  }
}

/**
 * Toggles snap-to-grid on the active diagram canvas.
 */
export function setDiagramSnap(enabled: boolean, g?: Graph | null): void {
  const targetGraph = g ?? graph;
  if (!targetGraph || targetGraph.disposed) return;
  targetGraph.setGridSize?.(enabled ? 10 : 1);
}

/**
 * Toggles the Minimap HUD for the active diagram.
 */
export function toggleMinimap(container?: HTMLElement | null): boolean {
  const c = container ?? graph?.container;
  if (!c) return false;
  const isOpened = toggleMinimapHud(c);
  if (isOpened && graph && !graph.disposed) {
    const hud = c.querySelector("#modelscript-minimap-hud") as HTMLElement | null;
    if (hud) {
      updateMinimapHud(hud, graph);
    }
  }
  return isOpened;
}

/**
 * Returns true if the Minimap HUD is currently open.
 */
export function isMinimapVisible(container?: HTMLElement | null): boolean {
  const c = container ?? graph?.container;
  if (!c) return false;
  return isMinimapOpen(c);
}

export {
  detectPrimarySymbol,
  getDialectMeta,
  highlightCodeLineToSvgTspans,
  renderUniversalCodeThumbnailSvg,
  type CodeThumbnailOptions,
  type DialectMeta,
} from "./code-thumbnail-builder.js";

export { resolveWireCrossingStyle, type WireCrossingStyle } from "./solder-dots.js";

export {
  resolveEdgeSelectionStyle,
  type EdgeSelectionStyle,
  type ResolvedEdgeSelectionStyle,
} from "./selection-handles.js";

/**
 * Rotates the currently selected nodes on the target graph (or active graph)
 * by `deltaDegrees`, re-routing all connected edges and updating solder dots.
 */
export function rotateSelectedNodes(deltaDegrees = 90, targetGraph?: Graph | null): void {
  const g = targetGraph ?? graph;
  if (!g || g.disposed) return;
  if (g.container && containerInstances.has(g.container)) {
    const inst = containerInstances.get(g.container);
    if (inst?.rotateSelectedNodes) {
      inst.rotateSelectedNodes(deltaDegrees);
      return;
    }
  }
  if (activeRotateSelectedNodes) {
    activeRotateSelectedNodes(deltaDegrees, g);
  }
}

/**
 * Flips the currently selected nodes on the target graph (or active graph)
 * along `axis` ('x' for horizontal, 'y' for vertical mirror), re-routing all connected edges and updating solder dots.
 */
export function flipSelectedNodes(axis: "x" | "y" = "x", targetGraph?: Graph | null): void {
  const g = targetGraph ?? graph;
  if (!g || g.disposed) return;
  if (g.container && containerInstances.has(g.container)) {
    const inst = containerInstances.get(g.container);
    if (inst?.flipSelectedNodes) {
      inst.flipSelectedNodes(axis);
      return;
    }
  }
  if (activeFlipSelectedNodes) {
    activeFlipSelectedNodes(axis, g);
  }
}
