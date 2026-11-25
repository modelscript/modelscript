// SPDX-License-Identifier: AGPL-3.0-or-later

import type { InteractiveBinding, InteractiveWriteAction } from "./interactive.js";
import type { PointLike, RectLike, RouterNodeLike, RouterPortConfig } from "./port-router.js";
import type { CoordinateSystem, ReactiveAnimationBinding } from "./protocol.js";
import type { EdgeSelectionStyle } from "./selection-handles.js";
import type { WireCrossingStyle } from "./solder-dots.js";
import type { SwimlanePartition } from "./swimlane-layout.js";

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
  getRouter?: (() => { name?: string } | string | null | undefined) | undefined;
  setRouter?: ((router: unknown) => void) | undefined;
  removeRouter?: (() => void) | undefined;
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
  getWidth?: (() => number) | undefined;
  getHeight?: (() => number) | undefined;
  setReadOnly?: ((readOnly: boolean) => void) | undefined;
  setSnapEnabled?: ((enabled: boolean) => void) | undefined;
  setSnapStep?: ((step: number) => void) | undefined;
  fsm?: { cancel: () => void; setPanToolActive: (active: boolean) => void } | undefined;
}

export interface GraphConstructor {
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

export type PluginConstructor = new (options: Record<string, unknown>) => unknown;

export interface DagreLayoutResultNode {
  id: string;
  x: number;
  y: number;
}

export interface DagreLayoutInstance {
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

export type DagreLayoutConstructor = new (options: Record<string, unknown>) => DagreLayoutInstance;

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
  /** Whether edges can connect directly to existing edge wires to create T-junctions (default: true). */
  allowEdgeConnection?: boolean | undefined;
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
  /** Prefer WebGPU instanced schematic pipeline for high-scale graphs (>1,500 nodes) with automatic Canvas2D fallback (default: true). */
  preferWebGpu?: boolean | undefined;
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
  /** Disable built-in context menus when the host webview provides its own custom context menu. */
  disableBuiltinContextMenu?: boolean | undefined;
  /** Optional viewport insets (in pixels) for floating overlays when fitting/centering. */
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
}

export interface ContainerDiagramInstance {
  graph: Graph;
  options: DiagramRendererOptions;
  selectedNodeId: string | null;
  cleanupListeners?: (() => void) | undefined;
  metadata?: Record<string, unknown> | undefined;
  rotateSelectedNodes?: ((deltaDegrees: number) => void) | undefined;
  flipSelectedNodes?: ((axis: "x" | "y") => void) | undefined;
  syncAlignmentToolbar?: (() => void) | undefined;
}

export interface PlacementData {
  className: string;
  classKind: string;
  iconSvg?: string | undefined;
  isDrag?: boolean | undefined;
}

export interface DiagramWindow {
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
          number | { distance?: number | undefined; offset?: number | undefined } | Record<string, unknown> | undefined;
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

export interface RenderNodeData {
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

export interface RenderEdgeData {
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
          number | { distance?: number | undefined; offset?: number | undefined; [key: string]: unknown } | undefined;
        [key: string]: unknown;
      }[]
    | undefined;
  data?: Record<string, unknown> | undefined;
  [key: string]: unknown;
}

export interface ClipboardNodeItem {
  sourceId: string;
  className: string;
  centerX: number;
  screenCenterY: number;
  rotation?: number | undefined;
  parameters?: Record<string, unknown> | undefined;
}

export interface ClipboardEdgeItem {
  sourceIdx: number;
  sourcePort?: string | undefined;
  targetIdx: number;
  targetPort?: string | undefined;
}

export interface DiagramClipboardSnapshot {
  format: "modelscript-diagram/v1";
  nodes: ClipboardNodeItem[];
  edges: ClipboardEdgeItem[];
}

export interface CanvasInteractionFlags {
  isSnappingPortAlignment: boolean;
  isAltPressed: boolean;
}
