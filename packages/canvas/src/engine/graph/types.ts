// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WorldBounds, WorldPoint } from "../../schema/canvas-document.js";
import type { CanvasPlotSpec } from "../../widgets/canvas-plot.js";
import type { CanvasTableSpec, StickyBadgeSpec } from "../../widgets/canvas-table.js";
import type { DiagramMarkupNode } from "../glyph-compiler.js";
import type { SoaSceneGraph } from "../soa-scene.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

export interface UnifiedEdgeTerminal {
  cell?: string | undefined;
  port?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  anchor?: unknown;
  connectionPoint?: unknown;
}

export interface UnifiedPortItem {
  id: string;
  group?: string | undefined;
  args?: { x?: number | undefined; y?: number | undefined; angle?: number | undefined } | undefined;
  markup?: DiagramMarkupNode | DiagramMarkupNode[] | undefined;
  attrs?: Record<string, Record<string, unknown>> | undefined;
  direction?: string | undefined;
  [key: string]: unknown;
}

export interface UnifiedCanvasWidgetSpec {
  id: string;
  kind: "plot" | "table" | "sticky";
  bounds: WorldBounds;
  plot?: CanvasPlotSpec | undefined;
  table?: CanvasTableSpec | undefined;
  sticky?: StickyBadgeSpec | undefined;
  /** Optional world-space leader tether target (wire/port) drawn as a dashed connector. */
  tetherTarget?: { x: number; y: number; label?: string | undefined } | undefined;
}

/** Minimal structural host interface used by `UnifiedCell` and graph subsystems to avoid circular imports. */
export interface UnifiedCellHost<TCell = unknown> {
  readonly scene: SoaSceneGraph;
  removeCell(cellOrId: unknown): TCell | null;
  syncCellDom(cell: TCell): void;
  resizeCellVisualDom(cell: TCell, prevWidth: number, prevHeight: number): void;
  reorderCellDomByZIndex(cell: TCell): void;
  rebuildCellDom(cell: TCell): void;
  patchCellSelectorDom(cell: TCell, selector: string, key: string, val: unknown): void;
  syncEdgeToScene(edge: TCell): void;
  getCellById(id?: string): TCell | null;
  getCells(): TCell[];
  getNodes(): TCell[];
  getEdges(): TCell[];
  getConnectedEdges(node: { id?: string | undefined } | string): TCell[];
  syncEdgeToolsDom(edge: TCell): void;
  findViewByCell(cell: TCell | string): UnifiedCellViewBase<TCell, UnifiedCellHost<TCell>> | null;
  emit(event: string, args?: unknown): void;
}

export interface UnifiedCellViewBase<TCell, TGraph = UnifiedCellHost<TCell>> {
  cell: TCell;
  graph: TGraph;
  container: Element | null;
  routePoints: WorldPoint[];
  sourcePoint?: WorldPoint | undefined;
  targetPoint?: WorldPoint | undefined;
  getVertexIndex(x: number, y: number): number;
}

export type UnifiedRouterFnBase<TCell, TGraph = UnifiedCellHost<TCell>> = (
  vertices: WorldPoint[],
  args: Record<string, unknown>,
  view: UnifiedCellViewBase<TCell, TGraph>,
) => WorldPoint[];

export type UnifiedConnectorFnBase<TCell, TGraph = UnifiedCellHost<TCell>> = (
  sourcePoint: WorldPoint,
  targetPoint: WorldPoint,
  routePoints: WorldPoint[],
  args: Record<string, unknown>,
  view: UnifiedCellViewBase<TCell, TGraph>,
) => string;

export interface UnifiedSelectionOptionsBase<TCell> {
  enabled?: boolean | undefined;
  showNodeSelectionBox?: boolean | undefined;
  showEdgeSelectionBox?: boolean | undefined;
  rubberband?: boolean | undefined;
  multiple?: boolean | undefined;
  modifiers?: string | string[] | undefined;
  multipleSelectionModifiers?: string | string[] | undefined;
  pointerEvents?: string | undefined;
  filter?: ((cell: TCell) => boolean) | undefined;
}

export interface UnifiedTransformOptionsBase<TCell> {
  resizing?: boolean | { enabled?: boolean | ((node: TCell) => boolean) | undefined } | undefined;
  rotating?: boolean | { enabled?: boolean | ((node: TCell) => boolean) | undefined } | undefined;
}

export interface UnifiedGraphOptionsBase<TCell> {
  container?: HTMLElement | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** Rendering backend mode: "auto" switches to virtualized Canvas2D/WebGPU above highScaleThreshold nodes. */
  renderMode?: "auto" | "svg" | "canvas2d" | undefined;
  /** Node threshold at which "auto" mode switches from SVG DOM to high-scale Canvas2D/WebGPU (default: 1500). */
  highScaleThreshold?: number | undefined;
  /** Prefer WebGPU instanced schematic pipeline when high-scale mode activates and `navigator.gpu` is available. */
  preferWebGpu?: boolean | undefined;
  /** Callback fired when the user brushes scatter/Pareto samples on a pinned plot widget. */
  onWidgetBrush?: ((widgetId: string, brushedIndices: number[], linkedIds: string[]) => void) | undefined;
  async?: boolean | undefined;
  autoResize?: boolean | undefined;
  background?: { color?: string | undefined } | undefined;
  grid?:
    | boolean
    | number
    | {
        size?: number | undefined;
        visible?: boolean | undefined;
        type?: string | undefined;
        args?: unknown;
      }
    | undefined;
  panning?: boolean | { enabled?: boolean | undefined } | undefined;
  mousewheel?:
    | boolean
    | { enabled?: boolean | undefined; global?: boolean | undefined; modifiers?: string | string[] | undefined }
    | undefined;
  embedding?: { enabled?: boolean | undefined } | undefined;
  interacting?: boolean | ((view: { cell: TCell }) => boolean | Record<string, boolean>) | undefined;
  connecting?:
    | {
        router?: unknown;
        connector?: unknown;
        snap?: boolean | { radius?: number | undefined } | undefined;
        allowBlank?: boolean | (() => boolean) | undefined;
        allowMulti?: boolean | (() => boolean) | undefined;
        allowLoop?: boolean | (() => boolean) | undefined;
        allowNode?: boolean | (() => boolean) | undefined;
        allowEdge?: boolean | (() => boolean) | undefined;
        allowPort?: boolean | (() => boolean) | undefined;
        highlight?: boolean | undefined;
        highlighting?: Record<string, unknown> | undefined;
        validateMagnet?:
          ((args: { cell?: TCell | null | undefined; magnet?: Element | null | undefined }) => boolean) | undefined;
        validateConnection?:
          | ((args: {
              sourceCell?: TCell | null | undefined;
              targetCell?: TCell | null | undefined;
              sourceMagnet?: Element | null | undefined;
              targetMagnet?: Element | null | undefined;
              sourcePort?: string | null | undefined;
              targetPort?: string | null | undefined;
            }) => boolean)
          | undefined;
        validateEdge?: ((args: { edge: TCell }) => boolean) | undefined;
        createEdge?: (() => TCell) | undefined;
      }
    | undefined;
  [key: string]: unknown;
}

export interface GridStyleState {
  gridSize: number;
  gridVisible: boolean;
  gridType: string;
  gridColor: string;
  gridThickness: number;
  gridFactor: number;
  gridMinorColor: string;
  gridMinorThickness: number;
  lastGridZoom: number;
}

export interface GraphDomLayers {
  rootEl: HTMLElement;
  svgEl: SVGSVGElement;
  defsEl: SVGDefsElement;
  canvas2DEl: HTMLCanvasElement;
  widgetCanvasEl: HTMLCanvasElement;
  gridPatternEl: SVGPatternElement;
  gridRectEl: SVGRectElement;
  viewportG: SVGGElement;
  edgesG: SVGGElement;
  nodesG: SVGGElement;
  toolsG: SVGGElement;
  guidesG: SVGGElement;
  edgeToolsG: SVGGElement;
  marqueeRectEl: SVGRectElement;
  selectionOverlayEl: HTMLElement;
  widgetLayerEl: HTMLElement;
  wirePreviewPathEl: SVGPathElement;
}

export interface ActiveWidgetInteraction {
  mode: "drag" | "resize" | "brush";
  widgetId: string;
  startU: number;
  startV: number;
  origBounds: WorldBounds;
}

export interface EdgeRenderPathResult {
  d: string;
  sourcePt: WorldPoint;
  targetPt: WorldPoint;
  routePoints: WorldPoint[];
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string | undefined;
  sourceMarker?: unknown;
  targetMarker?: unknown;
}
