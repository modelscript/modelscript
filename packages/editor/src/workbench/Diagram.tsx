// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  autoLayoutDiagramAsync,
  disposeDiagram,
  dropComponentGhost,
  flipSelectedNodes,
  getGraphFor,
  hydrateDiagramWasm,
  initGraph,
  isEphemeralDiagramNode,
  isMinimapVisible,
  renderDiagram,
  rotateSelectedNodes,
  setDiagramGrid,
  setDiagramOptions,
  setDiagramSnap,
  toggleMinimap,
  updateParameterText,
  type DiagramGridMode,
} from "@modelscript/diagram";
import type { DiagramData } from "@modelscript/diagram/protocol";
import type { Theme } from "@monaco-editor/react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Scissor3DViewport, SharedScissor3DHost, type Embedded3DPortalKind } from "./cad-viewer/SharedScissor3DHost";
import { DiagramZonotopeOverlay } from "./panels/DiagramZonotopeOverlay";
import { clearPlacement, movePlacementGhost } from "./placement";
import type { AnsatzRelationalHypergraphRecord } from "./util/lsp-bridge";
import type {
  FaultGeneratorSpec,
  LinearConstraintSpec,
  ZonotopePendingOverride,
  ZonotopeWorkbenchState,
} from "./util/zonotope-workbench-state";

export interface PinPlotSeriesInput {
  id: string;
  label: string;
  color: string;
  unit?: string | undefined;
  x: Float64Array | number[];
  y: Float64Array | number[];
}

export interface PinPlotWidgetInput {
  id?: string | undefined;
  title: string;
  kind?: "timeseries" | "xy" | "bode" | "scatter" | "pareto" | undefined;
  series: PinPlotSeriesInput[];
  bounds?: { x: number; y: number; width: number; height: number } | undefined;
  xLabel?: string | undefined;
  yLabel?: string | undefined;
  crosshairX?: number | undefined;
}

export interface PinStickyWidgetInput {
  id?: string | undefined;
  label: string;
  value: string;
  unit?: string | undefined;
  status?: "ok" | "warning" | "error" | "stale" | undefined;
  tetherTarget?: { x: number; y: number } | undefined;
  bounds?: { x: number; y: number; width: number; height: number } | undefined;
}

export interface EmbeddedPortalScissorRect {
  portalId: string;
  kind: Embedded3DPortalKind;
  artifactUri: string;
  cssX: number;
  cssY: number;
  cssWidth: number;
  cssHeight: number;
  glX: number;
  glY: number;
  glWidth: number;
  glHeight: number;
  renderLive: boolean;
  lod: string;
  snapshotDataUrl?: string | undefined;
}

interface EmbeddedPortalOverlayState extends EmbeddedPortalScissorRect {
  vtkBuffer?: Uint8Array | null | undefined;
  badgeLabel?: string | undefined;
}

export interface SimulationResultInput {
  time: number[] | Float64Array;
  signals: Record<string, number[] | Float64Array>;
}

interface NormalizedSimulationData {
  time: Float64Array;
  signals: Record<string, Float64Array>;
  signalNames: string[];
  varIndexMap: Map<string, number>;
  frameBuffer: Float64Array;
}

interface SimulationPlaybackState {
  start: number;
  end: number;
  current: number;
  isPlaying: boolean;
}

export interface DiagramEditorHandle {
  fitContent: () => void;
  layout: () => Promise<boolean>;
  zoomIn: (factor?: number) => number;
  zoomOut: (factor?: number) => number;
  zoomTo: (scale: number) => void;
  zoomToFit: () => void;
  getZoom: () => number;
  rotateSelected: (deltaDegrees?: number) => void;
  flipSelected?: (axis?: "x" | "y") => void;
  updateParameterText?: (nodeId: string, paramName: string, oldValue: string, newValue: string) => void;
  toggleMinimap: () => boolean;
  isMinimapOpen: () => boolean;
  setGridMode: (mode: DiagramGridMode) => void;
  setSnapToGrid: (enabled: boolean) => void;
  centerCell?: (cellId: string) => void;
  pinPlotWidget: (spec: PinPlotWidgetInput) => string | null;
  pinStickyWidget: (spec: PinStickyWidgetInput) => string | null;
  loadSimulationResult: (result: SimulationResultInput) => void;
  playSimulation: () => void;
  pauseSimulation: () => void;
  seekSimulation: (time: number) => void;
  exportSvgDataUrl?: () => string | null;
}

export type DiagramDataProp = (DiagramData & { isLoading?: boolean }) | null;

interface DiagramEditorProps {
  diagramData: DiagramDataProp;
  diagramClassName?: string | null | undefined;
  onZoomChange?: ((zoom: number) => void) | undefined;
  onSelect?: ((componentName: string | null) => void) | undefined;
  onDrop?: ((className: string, x: number, y: number, iconSvg?: string | null) => void) | undefined;
  onConnect?: ((source: string, target: string, points?: { x: number; y: number }[]) => void) | undefined;
  onMove?:
    | ((
        items: {
          name: string;
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
          edges?: { source: string; target: string; points: { x: number; y: number }[] }[] | undefined;
          connectedOnly?: boolean | undefined;
        }[],
      ) => void)
    | undefined;
  onResize?:
    | ((
        name: string,
        x: number,
        y: number,
        width: number,
        height: number,
        rotation: number,
        edges?: { source: string; target: string; points: { x: number; y: number }[] }[],
      ) => void)
    | undefined;
  onEdgeMove?: ((edges: { source: string; target: string; points: { x: number; y: number }[] }[]) => void) | undefined;
  onEdgeDelete?: ((source: string, target: string) => void) | undefined;
  onComponentDelete?: ((name: string) => void) | undefined;
  onComponentsDelete?: ((names: string[]) => void) | undefined;
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
  onAutoLayout?: (() => void) | undefined;
  selectedName?: string | null | undefined;
  theme: Theme;
  isLoading?: boolean | undefined;
  onRenderComplete?: ((diagramData: DiagramData) => void) | undefined;
  onInteractiveWrite?: ((variableName: string, value: unknown, nodeId: string) => void) | undefined;
  onAction?: ((action: Record<string, unknown>) => void) | undefined;
  onMessage?: ((msg: unknown) => void) | undefined;
  onShowProperties?: ((nodeId: string, cachedProps?: unknown, isLoading?: boolean) => void) | undefined;
  onNodeDoubleClick?: ((nodeId: string, nodeData?: unknown) => void) | undefined;
  fitInsets?: { top: number; right: number; bottom: number; left: number } | undefined;
  onFetchArtifactBytes?: ((artifactUri: string) => Promise<Uint8Array | null>) | undefined;
  onTessellateStep?: ((artifactUri: string) => Promise<string | Uint8Array | null>) | undefined;
  showZonotopeOverlay?: boolean | undefined;
  zonotopeWorkbenchState?: ZonotopeWorkbenchState | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onAddZonotopeConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  onToggleFaultGenerator?: ((spec: FaultGeneratorSpec) => void) | undefined;
}

type DiagramGraphInstance = {
  cleanSelection?: () => void;
  select?: (cell: unknown) => void;
  centerCell?: (cell: unknown, opts?: { animation?: { duration?: number } }) => void;
  findViewByCell?: (cell: unknown) => { container?: HTMLElement | null } | null;
  off?: (event: string, fn: unknown) => void;
  on?: (event: string, fn: unknown) => void;
  getCellById?: (id: string) => unknown;
  resize?: (width: number, height: number) => void;
  zoom?: (factor?: number, opts?: { absolute?: boolean }) => number;
  zoomTo?: (factor: number) => void;
  zoomToFit?: (opts?: {
    maxScale?: number;
    padding?: number;
    viewportArea?: { x: number; y: number; width: number; height: number };
  }) => void;
  zoomToRect?: (
    rect: { x: number; y: number; width: number; height: number },
    opts?: { viewportArea?: { x: number; y: number; width: number; height: number } },
  ) => void;
  centerPoint?: (x: number, y: number) => void;
  centerContent?: () => void;
  scale?: () => { sx: number; sy: number };
  translate?: (tx?: number, ty?: number) => { tx: number; ty: number };
  computeEmbedded3DScissorRects?: () => EmbeddedPortalScissorRect[];
  portal3DManager?:
    | {
        setFocusedPortal?: (id: string | null) => void;
        updatePortalBounds?: (id: string, bounds: { x: number; y: number; width: number; height: number }) => void;
        getPortal?: (id: string) => unknown;
      }
    | undefined;
  registerCanvasWidget?: (widget: Record<string, unknown>) => void;
  getCanvasWidgets?: () => Array<Record<string, unknown>>;
  syncPlotCrosshair?: (time: number | undefined) => void;
  tickAnimations?: (frame: Float64Array, dt?: number) => number;
  animationEngine?: { bindVariableIndices?: (m: Map<string, number>) => void } | undefined;
  timelineStore?:
    | {
        loadTrajectories?: (time: Float64Array, signals: Record<string, Float64Array>) => void;
        seek?: (time: number) => { currentTime: number };
        setPlaying?: (playing: boolean) => void;
        getState?: () => { currentTime: number; startTime: number; endTime: number; playing: boolean };
        subscribe?: (
          fn: (
            state: { currentTime: number; startTime: number; endTime: number; playing: boolean },
            values: Float64Array,
            varIndexMap: Map<string, number>,
          ) => void,
        ) => () => void;
      }
    | undefined;
  snapshotBaker?:
    | {
        captureFromCanvas?: (
          portalId: string,
          sourceCanvas: HTMLCanvasElement | null,
          rect: { x: number; y: number; width: number; height: number },
          stampKey: string,
        ) => Promise<boolean>;
        hasSnapshot?: (portalId: string, stampKey?: string) => boolean;
      }
    | undefined;
  loadSimulationResult?: (result: { time: Float64Array; signals: Record<string, Float64Array> }) => void;
  playSimulation?: () => void;
  pauseSimulation?: () => void;
  seekSimulation?: (time: number) => void;
};

function isVtkArtifactUri(uri: string | undefined): uri is string {
  if (!uri) return false;
  const clean = uri.split(/[?#]/)[0] ?? "";
  const lower = clean.toLowerCase();
  return lower.endsWith(".vtk") || lower.endsWith(".vtu");
}

function isHttpOrRootUri(uri: string): boolean {
  return uri.startsWith("/") || uri.startsWith("http://") || uri.startsWith("https://");
}

function normalizeSimulationResult(input: SimulationResultInput): NormalizedSimulationData | null {
  if (!input || !input.time || !input.signals) return null;
  const time = input.time instanceof Float64Array ? input.time : Float64Array.from(input.time);
  if (time.length === 0) return null;

  const signals: Record<string, Float64Array> = {};
  const signalNames: string[] = [];
  const varIndexMap = new Map<string, number>();
  let idx = 0;
  for (const [name, raw] of Object.entries(input.signals)) {
    if (!raw) continue;
    const f64 = raw instanceof Float64Array ? raw : Float64Array.from(raw);
    signals[name] = f64;
    signalNames.push(name);
    varIndexMap.set(name, idx++);
  }
  return {
    time,
    signals,
    signalNames,
    varIndexMap,
    frameBuffer: new Float64Array(idx),
  };
}

function sampleSimulationAtTime(
  data: NormalizedSimulationData,
  t: number,
): { time: number; values: Record<string, number>; frame: Float64Array } {
  const n = data.time.length;
  const values: Record<string, number> = {};
  if (n === 0) {
    return { time: t, values, frame: data.frameBuffer };
  }

  let lo = 0;
  let hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if ((data.time[mid] ?? 0) <= t) lo = mid;
    else hi = mid;
  }

  const t0 = data.time[lo] ?? 0;
  const t1 = data.time[hi] ?? t0;
  const alpha = t1 > t0 ? Math.max(0, Math.min(1, (t - t0) / (t1 - t0))) : 0;

  for (let i = 0; i < data.signalNames.length; i++) {
    const name = data.signalNames[i];
    if (!name) continue;
    const arr = data.signals[name];
    if (!arr || arr.length === 0) continue;
    const v0 = arr[Math.min(lo, arr.length - 1)] ?? 0;
    const v1 = arr[Math.min(hi, arr.length - 1)] ?? v0;
    const interpolated = v0 + (v1 - v0) * alpha;
    data.frameBuffer[i] = interpolated;
    if (i < 64) {
      values[name] = interpolated;
    }
  }

  return { time: t, values, frame: data.frameBuffer };
}

function arePortalListsEqual(
  a: ReadonlyArray<EmbeddedPortalOverlayState>,
  b: ReadonlyArray<EmbeddedPortalOverlayState>,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = b[i];
    if (!p || !q) return false;
    if (
      p.portalId !== q.portalId ||
      p.kind !== q.kind ||
      p.artifactUri !== q.artifactUri ||
      p.cssX !== q.cssX ||
      p.cssY !== q.cssY ||
      p.cssWidth !== q.cssWidth ||
      p.cssHeight !== q.cssHeight ||
      p.renderLive !== q.renderLive ||
      p.lod !== q.lod ||
      p.snapshotDataUrl !== q.snapshotDataUrl ||
      p.vtkBuffer !== q.vtkBuffer ||
      p.badgeLabel !== q.badgeLabel
    ) {
      return false;
    }
  }
  return true;
}

const PIN_PLOT_PALETTE = ["#38bdf8", "#34d399", "#f59e0b", "#f472b6"] as const;

const DiagramEditor = forwardRef<DiagramEditorHandle, DiagramEditorProps>((props, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInternalSelectionRef = useRef<string | null>(null);
  const widgetCounterRef = useRef(0);
  const scrubHistoryRef = useRef<Array<{ time: number; values: Record<string, number> }>>([]);
  const mountedRef = useRef(true);
  const mountGenRef = useRef(0);
  const vtkFetchStateRef = useRef<Set<string>>(new Set());
  const simDataRef = useRef<NormalizedSimulationData | null>(null);
  const simStateRef = useRef<SimulationPlaybackState | null>(null);
  const simRafRef = useRef<number | null>(null);
  const timelineUnsubRef = useRef<(() => void) | null>(null);
  const lastGraphTimelineTickRef = useRef<number>(0);

  const [embeddedPortals, setEmbeddedPortals] = useState<EmbeddedPortalOverlayState[]>([]);
  const [focusedPortalId, setFocusedPortalId] = useState<string | null>(null);
  const [fetchedVtkBuffers, setFetchedVtkBuffers] = useState<Record<string, Uint8Array>>({});
  const [simPlayback, setSimPlayback] = useState<SimulationPlaybackState | null>(null);
  const [scrubbedPoint, setScrubbedPoint] = useState<{
    time: number | null;
    values: Record<string, number> | null;
  }>({ time: null, values: null });
  const [zonotopeViewport, setZonotopeViewport] = useState<{ x: number; y: number; scale: number } | undefined>(
    undefined,
  );

  // Use a ref for props so callbacks in event listeners have access to latest props
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  const syncZonotopeViewport = useCallback(() => {
    if (!propsRef.current.showZonotopeOverlay) return;
    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    if (!g || typeof g.scale !== "function" || typeof g.translate !== "function") {
      return;
    }
    const s = g.scale();
    const t = g.translate();
    if (
      s &&
      t &&
      typeof s.sx === "number" &&
      Number.isFinite(s.sx) &&
      s.sx > 0 &&
      typeof t.tx === "number" &&
      Number.isFinite(t.tx) &&
      typeof t.ty === "number" &&
      Number.isFinite(t.ty)
    ) {
      setZonotopeViewport((prev) =>
        prev && Math.abs(prev.x - t.tx) < 0.25 && Math.abs(prev.y - t.ty) < 0.25 && Math.abs(prev.scale - s.sx) < 0.001
          ? prev
          : { x: t.tx, y: t.ty, scale: s.sx },
      );
    }
  }, []);

  useEffect(() => {
    if (props.showZonotopeOverlay) {
      syncZonotopeViewport();
    }
  }, [props.showZonotopeOverlay, props.diagramData, syncZonotopeViewport]);

  const syncEmbeddedPortals = useCallback(() => {
    syncZonotopeViewport();
    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    if (!g || typeof g.computeEmbedded3DScissorRects !== "function") {
      setEmbeddedPortals((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const rects = g.computeEmbedded3DScissorRects();
    const next: EmbeddedPortalOverlayState[] = rects
      .filter((r) => r.cssWidth > 1 && r.cssHeight > 1)
      .map((r) => {
        const cell = g.getCellById?.(r.portalId) as { getData?: () => Record<string, unknown> | undefined } | null;
        const cellData = typeof cell?.getData === "function" ? cell.getData() : undefined;
        const portalMeta =
          cellData && typeof cellData["portal"] === "object" && cellData["portal"] !== null
            ? (cellData["portal"] as Record<string, unknown>)
            : undefined;
        const propsMeta =
          cellData && typeof cellData["properties"] === "object" && cellData["properties"] !== null
            ? (cellData["properties"] as Record<string, unknown>)
            : undefined;
        const rawVtk = portalMeta?.["vtkBuffer"] ?? cellData?.["vtkBuffer"];
        const vtkBuffer = rawVtk instanceof Uint8Array ? rawVtk : undefined;
        const rawLabel = portalMeta?.["badgeLabel"] ?? propsMeta?.["name"];
        const badgeLabel = typeof rawLabel === "string" && rawLabel.length > 0 ? rawLabel : undefined;
        return {
          ...r,
          vtkBuffer,
          badgeLabel,
        };
      });
    setEmbeddedPortals((prev) => (arePortalListsEqual(prev, next) ? prev : next));
  }, [syncZonotopeViewport]);

  const portalSyncRafRef = useRef<number | null>(null);
  const centerCellHaloTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSyncEmbeddedPortals = useCallback(() => {
    if (typeof requestAnimationFrame !== "function") {
      syncEmbeddedPortals();
      return;
    }
    if (portalSyncRafRef.current !== null) return;
    portalSyncRafRef.current = requestAnimationFrame(() => {
      portalSyncRafRef.current = null;
      if (mountedRef.current) {
        syncEmbeddedPortals();
      }
    });
  }, [syncEmbeddedPortals]);

  const handlePortalViewportChange = useCallback(() => {
    scheduleSyncEmbeddedPortals();
  }, [scheduleSyncEmbeddedPortals]);

  const handlePortalNodeGeometryChange = useCallback(
    (payload?: { node?: unknown; cell?: unknown }) => {
      const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
      const targetCell = (payload?.node ?? payload?.cell) as
        { id?: string; getBBox?: () => { x: number; y: number; width: number; height: number } } | undefined;
      if (
        g?.portal3DManager?.updatePortalBounds &&
        targetCell?.id &&
        typeof targetCell.getBBox === "function" &&
        (!g.portal3DManager.getPortal || g.portal3DManager.getPortal(targetCell.id))
      ) {
        g.portal3DManager.updatePortalBounds(targetCell.id, targetCell.getBBox());
      }
      scheduleSyncEmbeddedPortals();
    },
    [scheduleSyncEmbeddedPortals],
  );

  const handleNodeDblClick = useCallback(({ node }: { node?: { id: string; getData?: () => unknown } }) => {
    if (!node || isEphemeralDiagramNode(node.id)) return;
    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    const hasPortal =
      Boolean(g?.portal3DManager?.getPortal?.(node.id)) ||
      Boolean(g?.computeEmbedded3DScissorRects?.().some((r) => r.portalId === node.id));
    if (hasPortal) {
      setFocusedPortalId(node.id);
      return;
    }
    const data = typeof node.getData === "function" ? node.getData() : undefined;
    propsRef.current.onNodeDoubleClick?.(node.id, data);
  }, []);

  const handleScale = useCallback(
    ({ sx }: { sx?: number }) => {
      if (typeof sx === "number" && !isNaN(sx)) {
        propsRef.current.onZoomChange?.(Math.round(sx * 100) / 100);
      }
      syncEmbeddedPortals();
    },
    [syncEmbeddedPortals],
  );

  const attachGraphListeners = () => {
    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    if (g && typeof g.on === "function") {
      g.off?.("node:dblclick", handleNodeDblClick);
      g.on("node:dblclick", handleNodeDblClick);
      g.off?.("scale", handleScale);
      g.on("scale", handleScale);
      g.off?.("translate", handlePortalViewportChange);
      g.on("translate", handlePortalViewportChange);
      g.off?.("node:moved", handlePortalNodeGeometryChange);
      g.on("node:moved", handlePortalNodeGeometryChange);
      g.off?.("node:resized", handlePortalNodeGeometryChange);
      g.on("node:resized", handlePortalNodeGeometryChange);
      g.off?.("node:change:position", handlePortalNodeGeometryChange);
      g.on("node:change:position", handlePortalNodeGeometryChange);
      g.off?.("node:change:size", handlePortalNodeGeometryChange);
      g.on("node:change:size", handlePortalNodeGeometryChange);
      g.off?.("node:added", handlePortalViewportChange);
      g.on("node:added", handlePortalViewportChange);
      g.off?.("node:removed", handlePortalViewportChange);
      g.on("node:removed", handlePortalViewportChange);
    }
  };

  const syncDiagramOptions = () => {
    if (!containerRef.current) return;

    setDiagramOptions({
      container: containerRef.current,
      isDark: props.theme === "vs-dark",
      onAction: (action) => {
        const p = propsRef.current;
        const actionRec = action as unknown as Record<string, unknown>;
        switch (action.type) {
          case "move":
            if (p.onMove) p.onMove(action.items);
            else p.onAction?.(actionRec);
            break;
          case "resize":
            if (p.onResize)
              p.onResize(
                action.item.name,
                action.item.x,
                action.item.y,
                action.item.width,
                action.item.height,
                action.item.rotation,
                action.item.edges,
              );
            else p.onAction?.(actionRec);
            break;
          case "connect":
            if (p.onConnect) p.onConnect(action.source, action.target, action.points);
            else p.onAction?.(actionRec);
            break;
          case "disconnect":
            if (p.onEdgeDelete) p.onEdgeDelete(action.source, action.target);
            else p.onAction?.(actionRec);
            break;
          case "moveEdge":
            if (p.onEdgeMove) p.onEdgeMove(action.edges);
            else p.onAction?.(actionRec);
            break;
          case "deleteComponents":
            if (p.onComponentsDelete) p.onComponentsDelete(action.names);
            else if (p.onComponentDelete && action.names.length > 0) p.onComponentDelete(action.names[0]!);
            else p.onAction?.(actionRec);
            break;
          case "interactiveWrite":
            if (p.onInteractiveWrite) p.onInteractiveWrite(action.variableName, action.value, action.nodeId);
            else p.onAction?.(actionRec);
            break;
          default:
            // Forward addComponent, reconnect, updateName, updateProperty, rotate, etc.
            p.onAction?.(actionRec);
            break;
        }
      },
      onSelect: (id) => {
        isInternalSelectionRef.current = id;
        if (propsRef.current.onSelect) propsRef.current.onSelect(id);
      },
      onShowProperties: (id, cachedProps, isLoading) => {
        isInternalSelectionRef.current = id;
        if (propsRef.current.onShowProperties) {
          propsRef.current.onShowProperties(id, cachedProps, isLoading);
        }
      },
      onUndo: () => propsRef.current.onUndo?.(),
      onRedo: () => propsRef.current.onRedo?.(),
      onAutoLayout: () => propsRef.current.onAutoLayout?.(),
      onMessage: (msg) => propsRef.current.onMessage?.(msg),
      fitInsets: propsRef.current.fitInsets,
    });
    attachGraphListeners();
  };

  const applyDiagramViewportFit = (g: DiagramGraphInstance, cw: number, ch: number, padding = 24) => {
    const insets = propsRef.current.fitInsets;
    const top = insets?.top ?? 0;
    const right = insets?.right ?? 0;
    const bottom = insets?.bottom ?? 0;
    const left = insets?.left ?? 0;
    const vw = Math.max(120, cw - left - right);
    const vh = Math.max(120, ch - top - bottom);
    const viewportArea = { x: left, y: top, width: vw, height: vh };
    const shiftX = (left - right) / 2;
    const shiftY = (top - bottom) / 2;

    const cs = propsRef.current.diagramData?.coordinateSystem;
    const hasExplicitCoordBounds = Boolean(
      cs && (cs.boundsStyle?.visible !== false || cs.axesStyle?.visible !== false),
    );
    if (hasExplicitCoordBounds && cs) {
      const expandedRect = {
        x: cs.x - cs.width * 0.125,
        y: cs.y - cs.height * 0.125,
        width: cs.width * 1.25,
        height: cs.height * 1.25,
      };
      if (typeof g.zoomToRect === "function") {
        g.zoomToRect(expandedRect, { viewportArea });
      } else {
        g.zoomToFit?.({ maxScale: 1, padding, viewportArea });
      }
      const ox = cs.axesStyle?.origin?.[0] ?? 0;
      const oy = cs.axesStyle?.origin?.[1] ?? 0;
      if (typeof g.centerPoint === "function") {
        g.centerPoint(ox, oy);
      } else if (typeof g.centerContent === "function") {
        g.centerContent();
      }
    } else if (typeof g.zoomToFit === "function") {
      g.zoomToFit({ maxScale: 1, padding, viewportArea });
      g.centerContent?.();
    }

    if ((shiftX !== 0 || shiftY !== 0) && typeof g.translate === "function") {
      const cur = g.translate();
      if (cur && typeof cur.tx === "number" && typeof cur.ty === "number") {
        g.translate(cur.tx + shiftX, cur.ty + shiftY);
      }
    }
  };

  const computeDefaultWidgetBounds = useCallback(
    (
      g: DiagramGraphInstance,
      width: number,
      height: number,
    ): { x: number; y: number; width: number; height: number } => {
      const existingCount = g.getCanvasWidgets?.().length ?? 0;
      let x = 40 + existingCount * 24;
      let y = 40 + existingCount * 24;
      if (typeof g.scale === "function" && typeof g.translate === "function") {
        const s = g.scale();
        const t = g.translate();
        const zoom = s && typeof s.sx === "number" && Number.isFinite(s.sx) && s.sx > 0 ? s.sx : 1;
        const tx = t && typeof t.tx === "number" && Number.isFinite(t.tx) ? t.tx : 0;
        const ty = t && typeof t.ty === "number" && Number.isFinite(t.ty) ? t.ty : 0;
        x = (24 - tx) / zoom + existingCount * (24 / zoom);
        y = (60 - ty) / zoom + existingCount * (24 / zoom);
      }
      return { x, y, width, height };
    },
    [],
  );

  const pinPlotWidget = useCallback(
    (spec: PinPlotWidgetInput): string | null => {
      const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
      if (!g || typeof g.registerCanvasWidget !== "function") return null;
      widgetCounterRef.current += 1;
      const id = spec.id ?? `pinned_plot_${widgetCounterRef.current}`;
      const bounds = spec.bounds ?? computeDefaultWidgetBounds(g, 260, 150);
      g.registerCanvasWidget({
        id,
        kind: "plot",
        bounds,
        plot: {
          id,
          title: spec.title,
          kind: spec.kind ?? "timeseries",
          series: spec.series,
          xLabel: spec.xLabel,
          yLabel: spec.yLabel,
          crosshairX: spec.crosshairX,
          dark: propsRef.current.theme === "vs-dark",
        },
      });
      return id;
    },
    [computeDefaultWidgetBounds],
  );

  const pinStickyWidget = useCallback(
    (spec: PinStickyWidgetInput): string | null => {
      const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
      if (!g || typeof g.registerCanvasWidget !== "function") return null;
      widgetCounterRef.current += 1;
      const id = spec.id ?? `pinned_sticky_${widgetCounterRef.current}`;
      const bounds = spec.bounds ?? computeDefaultWidgetBounds(g, 170, 54);
      g.registerCanvasWidget({
        id,
        kind: "sticky",
        bounds,
        sticky: {
          label: spec.label,
          value: spec.value,
          unit: spec.unit,
          status: spec.status,
          tetherTarget: spec.tetherTarget,
          dark: propsRef.current.theme === "vs-dark",
        },
      });
      return id;
    },
    [computeDefaultWidgetBounds],
  );

  const stopSimPlaybackLoop = useCallback(() => {
    if (simRafRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(simRafRef.current);
    }
    simRafRef.current = null;
  }, []);

  const bindGraphTimelineSubscription = useCallback((g: DiagramGraphInstance | null) => {
    if (timelineUnsubRef.current) {
      timelineUnsubRef.current();
      timelineUnsubRef.current = null;
    }
    if (!g?.timelineStore?.subscribe) return;
    timelineUnsubRef.current = g.timelineStore.subscribe((state, frame, varIndexMap) => {
      lastGraphTimelineTickRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
      const prev = simStateRef.current;
      if (!prev) return;
      const nextCurrent = state.currentTime;
      simStateRef.current = {
        ...prev,
        current: nextCurrent,
        isPlaying: state.playing,
      };
      setSimPlayback((cur) =>
        cur
          ? cur.current === nextCurrent && cur.isPlaying === state.playing
            ? cur
            : { ...cur, current: nextCurrent, isPlaying: state.playing }
          : cur,
      );
      const values: Record<string, number> = {};
      let count = 0;
      for (const [name, idx] of varIndexMap.entries()) {
        if (count >= 64) break;
        const val = frame[idx];
        if (typeof val === "number" && Number.isFinite(val)) {
          values[name] = val;
          count++;
        }
      }
      setScrubbedPoint({ time: nextCurrent, values: count > 0 ? values : null });
    });
  }, []);

  const loadSimulationResult = useCallback(
    (result: SimulationResultInput) => {
      const normalized = normalizeSimulationResult(result);
      if (!normalized) return;

      stopSimPlaybackLoop();
      simDataRef.current = normalized;

      const rawStart = normalized.time[0] ?? 0;
      const rawEnd = normalized.time[normalized.time.length - 1] ?? rawStart;
      const start = Number.isFinite(rawStart) ? rawStart : 0;
      const end = Number.isFinite(rawEnd) && rawEnd >= start ? rawEnd : start;

      const nextState: SimulationPlaybackState = {
        start,
        end,
        current: start,
        isPlaying: false,
      };
      simStateRef.current = nextState;
      setSimPlayback(nextState);

      const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
      g?.animationEngine?.bindVariableIndices?.(normalized.varIndexMap);
      if (typeof g?.loadSimulationResult === "function") {
        g.loadSimulationResult({ time: normalized.time, signals: normalized.signals });
      } else {
        g?.timelineStore?.loadTrajectories?.(normalized.time, normalized.signals);
      }

      bindGraphTimelineSubscription(g);

      const sampled = sampleSimulationAtTime(normalized, start);
      setScrubbedPoint({ time: start, values: sampled.values });
      g?.syncPlotCrosshair?.(start);
      if (typeof g?.loadSimulationResult !== "function" && g?.tickAnimations) {
        g.tickAnimations(sampled.frame, 1 / 60);
      }
    },
    [bindGraphTimelineSubscription, stopSimPlaybackLoop],
  );

  const seekSimulation = useCallback((time: number) => {
    if (!Number.isFinite(time)) return;
    const prev = simStateRef.current;
    const targetTime = prev ? Math.max(prev.start, Math.min(prev.end, time)) : time;

    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    if (typeof g?.seekSimulation === "function") {
      g.seekSimulation(targetTime);
    }

    const data = simDataRef.current;
    if (data) {
      const sampled = sampleSimulationAtTime(data, targetTime);
      if (typeof g?.seekSimulation !== "function") {
        g?.tickAnimations?.(sampled.frame, 1 / 60);
      }
      g?.syncPlotCrosshair?.(targetTime);
      if (prev) {
        const nextState = { ...prev, current: targetTime };
        simStateRef.current = nextState;
        setSimPlayback(nextState);
      }
      setScrubbedPoint({ time: targetTime, values: sampled.values });
    } else {
      g?.syncPlotCrosshair?.(targetTime);
      if (prev) {
        const nextState = { ...prev, current: targetTime };
        simStateRef.current = nextState;
        setSimPlayback(nextState);
      }
      setScrubbedPoint((cur) => ({ time: targetTime, values: cur.values }));
    }
  }, []);

  const pauseSimulation = useCallback(() => {
    stopSimPlaybackLoop();
    const prev = simStateRef.current;
    if (prev) {
      const nextState = { ...prev, isPlaying: false };
      simStateRef.current = nextState;
      setSimPlayback(nextState);
    }
    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    if (typeof g?.pauseSimulation === "function") {
      g.pauseSimulation();
    } else {
      g?.timelineStore?.setPlaying?.(false);
    }
  }, [stopSimPlaybackLoop]);

  const playSimulation = useCallback(() => {
    const prev = simStateRef.current;
    if (!prev) return;
    stopSimPlaybackLoop();

    const nextState: SimulationPlaybackState = { ...prev, isPlaying: true };
    simStateRef.current = nextState;
    setSimPlayback(nextState);

    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    const graphHasNativePlayback = typeof g?.playSimulation === "function";
    if (graphHasNativePlayback) {
      g.playSimulation?.();
    } else {
      g?.timelineStore?.setPlaying?.(true);
    }

    if (typeof requestAnimationFrame !== "function") return;

    let lastTs = typeof performance !== "undefined" ? performance.now() : Date.now();
    let lastUiCommitTs = 0;
    const UI_COMMIT_INTERVAL_MS = 80; // ~12.5 Hz for React scrubber UI; canvas ticks at full 60 FPS
    const step = (now: number) => {
      const state = simStateRef.current;
      if (!mountedRef.current || !state || !state.isPlaying) {
        simRafRef.current = null;
        return;
      }

      const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;

      const activeGraph = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
      const graphTickedRecently = graphHasNativePlayback && now - lastGraphTimelineTickRef.current < 150;

      if (!graphTickedRecently && dt > 0) {
        const span = state.end - state.start;
        let nextTime = state.current + dt;
        if (span > 0 && nextTime > state.end) {
          nextTime = state.start + ((nextTime - state.start) % span);
        } else if (span <= 0) {
          nextTime = state.start;
        }

        const updated: SimulationPlaybackState = { ...state, current: nextTime };
        simStateRef.current = updated;
        const shouldCommitUi = now - lastUiCommitTs >= UI_COMMIT_INTERVAL_MS;

        const data = simDataRef.current;
        if (data) {
          const sampled = sampleSimulationAtTime(data, nextTime);
          if (!graphHasNativePlayback) {
            activeGraph?.tickAnimations?.(sampled.frame, dt);
          }
          activeGraph?.syncPlotCrosshair?.(nextTime);
          if (shouldCommitUi) {
            lastUiCommitTs = now;
            setSimPlayback(updated);
            setScrubbedPoint({ time: nextTime, values: sampled.values });
          }
        } else {
          activeGraph?.syncPlotCrosshair?.(nextTime);
          if (shouldCommitUi) {
            lastUiCommitTs = now;
            setSimPlayback(updated);
            setScrubbedPoint((cur) => ({ time: nextTime, values: cur.values }));
          }
        }
      }

      simRafRef.current = requestAnimationFrame(step);
    };

    simRafRef.current = requestAnimationFrame(step);
  }, [stopSimPlaybackLoop]);

  useImperativeHandle(ref, () => ({
    fitContent: () => {
      syncDiagramOptions();
      const container = containerRef.current;
      const g = getGraphFor(container) ?? (container ? initGraph(props.theme === "vs-dark", container) : null);
      if (g && container) {
        try {
          const parent = container.parentElement;
          const parentW = parent?.clientWidth ?? 0;
          const parentH = parent?.clientHeight ?? 0;
          const cw = parentW > 0 ? parentW : container.clientWidth > 0 ? container.clientWidth : 800;
          const ch = parentH > 0 ? parentH : container.clientHeight > 0 ? container.clientHeight : 600;
          const gInst = g as DiagramGraphInstance;
          if (typeof gInst.resize === "function" && cw > 0 && ch > 0) {
            gInst.resize(cw, ch);
          }
          applyDiagramViewportFit(gInst, cw, ch, 20);
          if (typeof gInst.zoom === "function") {
            propsRef.current.onZoomChange?.(Math.round(gInst.zoom() * 100) / 100);
          }
          syncEmbeddedPortals();
        } catch {
          // ignore if zoom fails before layout
        }
      }
    },
    layout: async () => {
      const container = containerRef.current;
      const g = getGraphFor(container);
      if (g) {
        return autoLayoutDiagramAsync(g);
      } else if (typeof window !== "undefined") {
        window.postMessage({ type: "autoLayout" }, "*");
        return true;
      }
      return false;
    },
    zoomIn: (factor = 0.15) => {
      const container = containerRef.current;
      const g = getGraphFor(container) as DiagramGraphInstance | null;
      if (g && typeof g.zoom === "function") {
        const current = g.zoom();
        const next = Math.min(10.0, Math.round((current + factor) * 100) / 100);
        if (typeof g.zoomTo === "function") {
          g.zoomTo(next);
        } else {
          g.zoom(next, { absolute: true });
        }
        propsRef.current.onZoomChange?.(next);
        syncEmbeddedPortals();
        return next;
      }
      return 1;
    },
    zoomOut: (factor = 0.15) => {
      const container = containerRef.current;
      const g = getGraphFor(container) as DiagramGraphInstance | null;
      if (g && typeof g.zoom === "function") {
        const current = g.zoom();
        const next = Math.max(0.1, Math.round((current - factor) * 100) / 100);
        if (typeof g.zoomTo === "function") {
          g.zoomTo(next);
        } else {
          g.zoom(next, { absolute: true });
        }
        propsRef.current.onZoomChange?.(next);
        syncEmbeddedPortals();
        return next;
      }
      return 1;
    },
    zoomTo: (scale: number) => {
      const container = containerRef.current;
      const g = getGraphFor(container) as DiagramGraphInstance | null;
      if (g && (typeof g.zoomTo === "function" || typeof g.zoom === "function")) {
        const clamped = Math.max(0.1, Math.min(10.0, scale));
        if (typeof g.zoomTo === "function") {
          g.zoomTo(clamped);
        } else {
          g.zoom?.(clamped, { absolute: true });
        }
        propsRef.current.onZoomChange?.(clamped);
        syncEmbeddedPortals();
      }
    },
    zoomToFit: () => {
      syncDiagramOptions();
      const container = containerRef.current;
      const g = getGraphFor(container) as DiagramGraphInstance | null;
      if (g && typeof g.zoomToFit === "function") {
        const parent = container?.parentElement;
        const parentW = parent?.clientWidth ?? 0;
        const parentH = parent?.clientHeight ?? 0;
        const cw =
          parentW > 0 ? parentW : container?.clientWidth && container.clientWidth > 0 ? container.clientWidth : 800;
        const ch =
          parentH > 0 ? parentH : container?.clientHeight && container.clientHeight > 0 ? container.clientHeight : 600;
        if (typeof g.resize === "function" && cw > 0 && ch > 0) {
          g.resize(cw, ch);
        }
        applyDiagramViewportFit(g, cw, ch, 24);
        if (typeof g.zoom === "function") {
          propsRef.current.onZoomChange?.(Math.round(g.zoom() * 100) / 100);
        }
        syncEmbeddedPortals();
      }
    },
    getZoom: () => {
      const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
      if (g && typeof g.zoom === "function") {
        return Math.round(g.zoom() * 100) / 100;
      }
      return 1;
    },
    rotateSelected: (deltaDegrees = 90) => {
      const g = getGraphFor(containerRef.current);
      if (!g) return;
      rotateSelectedNodes(deltaDegrees, g);
    },
    flipSelected: (axis: "x" | "y" = "x") => {
      const g = getGraphFor(containerRef.current);
      if (!g) return;
      flipSelectedNodes(axis, g);
    },
    updateParameterText: (nodeId: string, paramName: string, oldValue: string, newValue: string) => {
      updateParameterText(nodeId, paramName, oldValue, newValue, containerRef.current);
    },
    toggleMinimap: () => {
      return toggleMinimap(containerRef.current);
    },
    isMinimapOpen: () => {
      return isMinimapVisible(containerRef.current);
    },
    setGridMode: (mode: DiagramGridMode) => {
      setDiagramGrid(mode, getGraphFor(containerRef.current) ?? undefined);
    },
    setSnapToGrid: (enabled: boolean) => {
      setDiagramSnap(enabled, getGraphFor(containerRef.current) ?? undefined);
    },
    centerCell: (cellId: string) => {
      const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
      if (!g || !cellId) return;
      const cell = g.getCellById?.(cellId);
      if (cell) {
        try {
          const cellView = g.findViewByCell?.(cell);
          if (cellView?.container) {
            if (centerCellHaloTimerRef.current) {
              clearTimeout(centerCellHaloTimerRef.current);
              centerCellHaloTimerRef.current = null;
            }
            cellView.container.classList.add("modelscript-anchor-halo");
            centerCellHaloTimerRef.current = setTimeout(() => {
              centerCellHaloTimerRef.current = null;
              cellView.container?.classList.remove("modelscript-anchor-halo");
            }, 3000);
          }
          g.centerCell?.(cell, { animation: { duration: 300 } });
          syncEmbeddedPortals();
        } catch {
          // fallback if animation unsupported
        }
      }
    },
    pinPlotWidget,
    pinStickyWidget,
    loadSimulationResult,
    playSimulation,
    pauseSimulation,
    seekSimulation,
    exportSvgDataUrl: () => {
      if (typeof document === "undefined" || typeof XMLSerializer === "undefined") {
        return null;
      }
      const container = containerRef.current;
      if (!container) return null;

      const svg =
        container.querySelector<SVGSVGElement>("svg.x6-graph-svg, svg.ms-graph-svg") ??
        container.querySelector<SVGSVGElement>(":scope > svg") ??
        container.querySelector<SVGSVGElement>("svg");
      if (!svg) return null;

      const viewportEl = svg.querySelector<SVGGElement>(".ms-canvas-viewport, .x6-graph-svg-viewport");
      const edgesLayer = svg.querySelector<SVGGElement>(".ms-edges-layer");
      const nodesLayer = svg.querySelector<SVGGElement>(".ms-nodes-layer");

      const contentElementCount =
        (nodesLayer?.children.length ?? 0) +
        (edgesLayer?.children.length ?? 0) +
        (!nodesLayer && !edgesLayer ? (viewportEl?.children.length ?? 0) : 0);

      if (viewportEl && contentElementCount === 0) {
        const canvas2d = container.querySelector<HTMLCanvasElement>("canvas.ms-canvas2d-layer");
        if (canvas2d && canvas2d.width > 0 && canvas2d.height > 0 && canvas2d.style.display !== "none") {
          try {
            return canvas2d.toDataURL("image/png");
          } catch {
            return null;
          }
        }
        return null;
      }
      if (!viewportEl && svg.children.length === 0) {
        return null;
      }

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let measuredInViewportSpace = false;

      const includeBBox = (el: SVGGraphicsElement | null): void => {
        if (!el || typeof el.getBBox !== "function") return;
        try {
          const box = el.getBBox();
          if (
            Number.isFinite(box.x) &&
            Number.isFinite(box.y) &&
            Number.isFinite(box.width) &&
            Number.isFinite(box.height) &&
            (box.width > 0 || box.height > 0)
          ) {
            if (box.x < minX) minX = box.x;
            if (box.y < minY) minY = box.y;
            if (box.x + box.width > maxX) maxX = box.x + box.width;
            if (box.y + box.height > maxY) maxY = box.y + box.height;
          }
        } catch {
          // Ignore getBBox errors in headless/detached SVG subtrees
        }
      };

      if (nodesLayer || edgesLayer) {
        includeBBox(edgesLayer);
        includeBBox(nodesLayer);
        if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
          measuredInViewportSpace = true;
        }
      }
      if (!measuredInViewportSpace && viewportEl) {
        includeBBox(viewportEl);
        if (Number.isFinite(minX) && maxX > minX && maxY > minY) {
          measuredInViewportSpace = true;
        }
      }
      if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
        includeBBox(svg);
      }
      if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
        const rect = svg.getBoundingClientRect();
        if (rect.width > 1 && rect.height > 1) {
          minX = 0;
          minY = 0;
          maxX = rect.width;
          maxY = rect.height;
        } else {
          return null;
        }
      }

      const rawW = maxX - minX;
      const rawH = maxY - minY;
      if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 1 || rawH <= 1) {
        return null;
      }

      const pad = Math.max(18, Math.min(48, Math.max(rawW, rawH) * 0.05));
      const vbX = Math.floor(minX - pad);
      const vbY = Math.floor(minY - pad);
      const vbW = Math.ceil(rawW + pad * 2);
      const vbH = Math.ceil(rawH + pad * 2);

      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
      clone.removeAttribute("style");

      clone
        .querySelectorAll(".ms-tools-layer, .ms-marquee-rect, .ms-alignment-guides, .x6-graph-svg-decorator")
        .forEach((el) => el.remove());

      for (const child of Array.from(clone.children)) {
        if (
          child.tagName.toLowerCase() === "rect" &&
          child.getAttribute("width") === "100%" &&
          child.getAttribute("height") === "100%"
        ) {
          child.remove();
        }
      }

      if (measuredInViewportSpace) {
        const cloneViewport = clone.querySelector<SVGGElement>(".ms-canvas-viewport, .x6-graph-svg-viewport");
        if (cloneViewport) {
          cloneViewport.removeAttribute("transform");
        }
      }

      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("x", String(vbX));
      bgRect.setAttribute("y", String(vbY));
      bgRect.setAttribute("width", String(vbW));
      bgRect.setAttribute("height", String(vbH));
      bgRect.setAttribute("fill", propsRef.current.theme === "vs-dark" ? "#121214" : "#ffffff");
      const firstNonDefs = Array.from(clone.children).find((el) => el.tagName.toLowerCase() !== "defs") ?? null;
      clone.insertBefore(bgRect, firstNonDefs);

      const maxDim = Math.max(vbW, vbH);
      const targetMax = Math.max(1280, Math.min(2048, maxDim));
      const rasterScale = maxDim > 0 ? targetMax / maxDim : 1;
      clone.setAttribute("width", String(Math.round(vbW * rasterScale)));
      clone.setAttribute("height", String(Math.round(vbH * rasterScale)));
      clone.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);

      try {
        const svgStr = new XMLSerializer().serializeToString(clone);
        if (!svgStr || svgStr.length === 0) return null;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
      } catch {
        return null;
      }
    },
  }));

  useEffect(() => {
    syncDiagramOptions();
  }, [props.theme]);

  const hasFittedViewportRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const configuredWasmUrl =
      (typeof window !== "undefined" &&
        ((window as unknown as { __MODELSCRIPT_WASM_URL__?: string }).__MODELSCRIPT_WASM_URL__ ||
          container.dataset?.["wasmUrl"])) ||
      "/lsp/server/dist/release.wasm";
    void hydrateDiagramWasm(configuredWasmUrl);

    const target = container.parentElement ?? container;

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const { width, height } = entry.contentRect;
            if (width <= 0 || height <= 0) return;

            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
              const g = getGraphFor(container);
              const zoomable = g as unknown as {
                isDisposed?: () => boolean;
                zoomToRect?: (rect: unknown, options?: unknown) => void;
                zoomToFit?: (options?: unknown) => void;
                centerContent?: () => void;
              };
              if (g && (typeof zoomable.isDisposed === "function" ? !zoomable.isDisposed() : true)) {
                g.resize(Math.round(width), Math.round(height));
                // Only fit/center automatically if the canvas had not yet been fitted in a visible viewport
                // (e.g., transitioning from a 0x0 hidden tab). Subsequent resizes such as opening/closing the
                // Properties panel on component selection must preserve the user's current pan and zoom.
                if (
                  !hasFittedViewportRef.current &&
                  propsRef.current.diagramData &&
                  !propsRef.current.diagramData.isLoading
                ) {
                  hasFittedViewportRef.current = true;
                  applyDiagramViewportFit(g, width, height, 24);
                }
                const gInst = g as DiagramGraphInstance;
                if (typeof gInst.zoom === "function") {
                  propsRef.current.onZoomChange?.(Math.round(gInst.zoom() * 100) / 100);
                }
                syncEmbeddedPortals();
              }
            }, 60);
          })
        : null;

    ro?.observe(target);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      if (portalSyncRafRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(portalSyncRafRef.current);
        portalSyncRafRef.current = null;
      }
      if (centerCellHaloTimerRef.current) {
        clearTimeout(centerCellHaloTimerRef.current);
        centerCellHaloTimerRef.current = null;
      }
      ro?.disconnect();
      disposeDiagram(container);
    };
  }, []);

  useEffect(() => {
    if (containerRef.current && getGraphFor(containerRef.current)) {
      syncDiagramOptions();
    }
  }, [props.fitInsets?.top, props.fitInsets?.right, props.fitInsets?.bottom, props.fitInsets?.left]);

  const prevThemeRef = useRef(props.theme);
  const prevDiagramDataRef = useRef(props.diagramData);

  useEffect(() => {
    const isThemeOnlyChange = prevThemeRef.current !== props.theme && prevDiagramDataRef.current === props.diagramData;
    prevThemeRef.current = props.theme;
    prevDiagramDataRef.current = props.diagramData;

    if (!isThemeOnlyChange) {
      setFocusedPortalId(null);
    }

    if (props.diagramData && containerRef.current) {
      try {
        const existingGraph = getGraphFor(containerRef.current) as {
          zoom?: () => number;
          zoomTo?: (s: number) => void;
          translate?: (tx?: number, ty?: number) => { tx: number; ty: number };
        } | null;
        const savedScale = isThemeOnlyChange && existingGraph?.zoom ? existingGraph.zoom() : null;
        const savedTranslate = isThemeOnlyChange && existingGraph?.translate ? existingGraph.translate() : null;

        syncDiagramOptions();
        renderDiagram(props.diagramData, props.theme === "vs-dark");
        attachGraphListeners();

        if (isThemeOnlyChange && savedScale !== null && savedTranslate) {
          const nextGraph = getGraphFor(containerRef.current) as {
            zoomTo?: (s: number) => void;
            zoom?: (s: number, opts?: { absolute?: boolean }) => number;
            translate?: (tx: number, ty: number) => void;
          } | null;
          if (nextGraph) {
            if (typeof nextGraph.zoomTo === "function") nextGraph.zoomTo(savedScale);
            else nextGraph.zoom?.(savedScale, { absolute: true });
            nextGraph.translate?.(savedTranslate.tx, savedTranslate.ty);
          }
        }

        const rect = (containerRef.current.parentElement ?? containerRef.current).getBoundingClientRect();
        if (!props.diagramData.isLoading && rect.width > 0 && rect.height > 0) {
          hasFittedViewportRef.current = true;
        }
        syncEmbeddedPortals();
      } catch (err) {
        console.error("Failed to render diagram:", err);
      } finally {
        if (props.onRenderComplete) props.onRenderComplete(props.diagramData);
      }
    } else if (!props.diagramData && containerRef.current) {
      try {
        syncDiagramOptions();
        renderDiagram({ nodes: [], edges: [] } as unknown as DiagramData, props.theme === "vs-dark");
        attachGraphListeners();
        syncEmbeddedPortals();
      } catch {
        // ignore empty canvas initialization errors
      }
      hasFittedViewportRef.current = false;
      if (props.onRenderComplete) props.onRenderComplete(null);
    } else if (!props.diagramData && props.onRenderComplete) {
      hasFittedViewportRef.current = false;
      setEmbeddedPortals([]);
      props.onRenderComplete(null);
    }
  }, [props.diagramData, props.theme]);

  useEffect(() => {
    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    g?.portal3DManager?.setFocusedPortal?.(focusedPortalId);
    syncEmbeddedPortals();

    if (!focusedPortalId || typeof window === "undefined") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFocusedPortalId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [focusedPortalId, syncEmbeddedPortals]);

  useEffect(() => {
    scrubHistoryRef.current = [];
  }, [props.diagramClassName]);

  useEffect(() => {
    if (props.selectedName !== undefined) {
      const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
      if (!g) return;
      if (!props.selectedName || isEphemeralDiagramNode(props.selectedName)) {
        isInternalSelectionRef.current = null;
        g.cleanSelection?.();
      } else {
        const isInternal = isInternalSelectionRef.current === props.selectedName;
        isInternalSelectionRef.current = null;

        const cell = g.getCellById?.(props.selectedName);
        if (cell) {
          if (!isInternal) {
            g.cleanSelection?.();
            g.select?.(cell);
          }
        }
      }
    }
  }, [props.selectedName, props.theme]);

  useEffect(() => {
    mountedRef.current = true;
    mountGenRef.current += 1;
    return () => {
      mountedRef.current = false;
      stopSimPlaybackLoop();
      if (timelineUnsubRef.current) {
        timelineUnsubRef.current();
        timelineUnsubRef.current = null;
      }
      vtkFetchStateRef.current.clear();
    };
  }, [stopSimPlaybackLoop]);

  useEffect(() => {
    if (embeddedPortals.length === 0) return;
    const urisToFetch: string[] = [];
    for (const p of embeddedPortals) {
      if (p.vtkBuffer && p.vtkBuffer.length > 0) continue;
      const uri = p.artifactUri;
      if (!isVtkArtifactUri(uri)) continue;
      if (fetchedVtkBuffers[uri] || vtkFetchStateRef.current.has(uri)) continue;
      const canCustomFetch = typeof propsRef.current.onFetchArtifactBytes === "function";
      const canBrowserFetch = typeof fetch === "function" && isHttpOrRootUri(uri);
      if (!canCustomFetch && !canBrowserFetch) continue;
      urisToFetch.push(uri);
    }
    if (urisToFetch.length === 0) return;

    const gen = mountGenRef.current;
    const uniqueUris = Array.from(new Set(urisToFetch));
    const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    for (const uri of uniqueUris) {
      vtkFetchStateRef.current.add(uri);
      const fetchBytes = async (): Promise<Uint8Array | null> => {
        const customFetcher = propsRef.current.onFetchArtifactBytes;
        if (typeof customFetcher === "function") {
          const customBytes = await customFetcher(uri);
          if (customBytes && customBytes.length > 0) return customBytes;
        }
        if (typeof fetch === "function" && isHttpOrRootUri(uri)) {
          const response = await fetch(uri, abortController ? { signal: abortController.signal } : undefined);
          if (!response.ok) return null;
          const arrayBuf = await response.arrayBuffer();
          return arrayBuf.byteLength > 0 ? new Uint8Array(arrayBuf) : null;
        }
        return null;
      };
      void fetchBytes()
        .then((bytes) => {
          if (!mountedRef.current || mountGenRef.current !== gen) {
            vtkFetchStateRef.current.delete(uri);
            return;
          }
          if (bytes && bytes.length > 0) {
            setFetchedVtkBuffers((prev) => (prev[uri] === bytes ? prev : { ...prev, [uri]: bytes }));
          } else {
            vtkFetchStateRef.current.delete(uri);
          }
        })
        .catch(() => {
          vtkFetchStateRef.current.delete(uri);
        });
    }
    return () => {
      abortController?.abort();
    };
  }, [embeddedPortals, fetchedVtkBuffers, props.onFetchArtifactBytes]);

  // Bake offscreen ImageBitmap snapshots from the shared WebGL scissor canvas while portals are live
  // so zoomed-out / idle portals stamp crisp frozen frames on Layer 0 at 0 GPU cost.
  useEffect(() => {
    if (embeddedPortals.length === 0 || typeof document === "undefined") return;
    const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
    const baker = g?.snapshotBaker;
    if (!baker?.captureFromCanvas) return;

    const hostRoot = containerRef.current?.closest?.('[data-testid="shared-scissor-3d-host"]') ?? document;
    const glCanvas = hostRoot.querySelector('canvas[data-shared-webgl-canvas="true"]') as HTMLCanvasElement | null;
    if (!glCanvas || glCanvas.width <= 0 || glCanvas.height <= 0) return;

    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const simTimeBucket = Math.round((scrubbedPoint.time ?? simPlayback?.current ?? 0) * 4);
    for (const p of embeddedPortals) {
      if (!p.renderLive || p.cssWidth < 24 || p.cssHeight < 24) continue;
      const stampKey = `${p.artifactUri}@${simTimeBucket}@${Math.round(p.cssWidth)}x${Math.round(p.cssHeight)}`;
      if (baker.hasSnapshot?.(p.portalId, stampKey)) continue;
      const hostRect = containerRef.current?.getBoundingClientRect();
      const sx = Math.max(0, Math.round(((hostRect?.left ?? 0) + p.cssX) * dpr));
      const sy = Math.max(0, Math.round(((hostRect?.top ?? 0) + p.cssY) * dpr));
      const sw = Math.min(glCanvas.width - sx, Math.round(p.cssWidth * dpr));
      const sh = Math.min(glCanvas.height - sy, Math.round(p.cssHeight * dpr));
      if (sw > 4 && sh > 4) {
        void baker.captureFromCanvas(p.portalId, glCanvas, { x: sx, y: sy, width: sw, height: sh }, stampKey);
      }
    }
  }, [embeddedPortals, scrubbedPoint.time, simPlayback?.current]);

  const handlePinScrubbedPlot = useCallback(() => {
    const simData = simDataRef.current;
    const currentTime = scrubbedPoint.time ?? simStateRef.current?.current ?? null;
    if (currentTime == null) return;

    if (simData && simData.time.length > 0) {
      const plotSignalNames = simData.signalNames.filter((n) => n !== "time").slice(0, 4);
      const series: PinPlotSeriesInput[] =
        plotSignalNames.length > 0
          ? plotSignalNames.map((varName, idx) => ({
              id: varName,
              label: varName,
              color: PIN_PLOT_PALETTE[idx % PIN_PLOT_PALETTE.length] ?? "#38bdf8",
              x: simData.time,
              y: simData.signals[varName] ?? new Float64Array(simData.time.length),
            }))
          : [
              {
                id: "time",
                label: "t",
                color: "#38bdf8",
                x: simData.time,
                y: simData.time,
              },
            ];

      const firstVar = plotSignalNames[0];
      const title =
        plotSignalNames.length === 1 && firstVar
          ? `${firstVar} (t)`
          : `${propsRef.current.diagramClassName || "Simulation"} Telemetry`;

      pinPlotWidget({
        title,
        kind: "timeseries",
        series,
        xLabel: "t (s)",
        crosshairX: currentTime,
      });
      return;
    }

    const entries = scrubbedPoint.values
      ? Object.entries(scrubbedPoint.values)
          .filter(([, v]) => typeof v === "number" && Number.isFinite(v))
          .slice(0, 4)
      : [];

    const history = scrubHistoryRef.current;
    const series: PinPlotSeriesInput[] =
      entries.length > 0
        ? entries.map(([varName, currentVal], idx) => {
            const xs: number[] = [];
            const ys: number[] = [];
            for (const sample of history) {
              const v = sample.values[varName];
              if (typeof v === "number" && Number.isFinite(v)) {
                xs.push(sample.time);
                ys.push(v);
              }
            }
            if (xs.length < 2) {
              xs.length = 0;
              ys.length = 0;
              const t0 = currentTime > 0 ? 0 : currentTime - 1;
              xs.push(t0, currentTime);
              ys.push(currentVal, currentVal);
            }
            return {
              id: varName,
              label: varName,
              color: PIN_PLOT_PALETTE[idx % PIN_PLOT_PALETTE.length] ?? "#38bdf8",
              x: xs,
              y: ys,
            };
          })
        : [
            {
              id: "time",
              label: "t",
              color: "#38bdf8",
              x: [0, currentTime > 0 ? currentTime : 1],
              y: [0, currentTime],
            },
          ];

    const firstVar = entries[0]?.[0];
    const title =
      entries.length === 1 && firstVar
        ? `${firstVar} (t)`
        : `${propsRef.current.diagramClassName || "Simulation"} Telemetry`;

    pinPlotWidget({
      title,
      kind: "timeseries",
      series,
      xLabel: "t (s)",
      crosshairX: currentTime,
    });
  }, [pinPlotWidget, scrubbedPoint.time, scrubbedPoint.values]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSimulationResult = (e: Event) => {
      const detail = (e as CustomEvent<SimulationResultInput | null | undefined>).detail;
      if (!detail || !detail.time || !detail.signals) return;
      loadSimulationResult(detail);
    };
    window.addEventListener("ansatz:simulation-result", handleSimulationResult);
    return () => window.removeEventListener("ansatz:simulation-result", handleSimulationResult);
  }, [loadSimulationResult]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleTimeScrub = (e: Event) => {
      const detail = (e as CustomEvent<{ time?: number | null; values?: Record<string, number> | null }>).detail;
      const g = containerRef.current ? (getGraphFor(containerRef.current) as DiagramGraphInstance | null) : null;

      if (detail && detail.time != null && Number.isFinite(detail.time)) {
        const scrubTime = detail.time;
        setScrubbedPoint({ time: scrubTime, values: detail.values ?? null });
        if (simStateRef.current) {
          const clamped = Math.max(simStateRef.current.start, Math.min(simStateRef.current.end, scrubTime));
          simStateRef.current = { ...simStateRef.current, current: clamped };
          setSimPlayback((prev) => (prev ? { ...prev, current: clamped } : prev));
        }
        if (detail.values) {
          const hist = scrubHistoryRef.current;
          const existingIdx = hist.findIndex((s) => Math.abs(s.time - scrubTime) < 1e-9);
          if (existingIdx >= 0) {
            hist[existingIdx] = { time: scrubTime, values: { ...detail.values } };
          } else {
            hist.push({ time: scrubTime, values: { ...detail.values } });
            hist.sort((a, b) => a.time - b.time);
            if (hist.length > 256) {
              hist.splice(0, hist.length - 256);
            }
          }
        }
        g?.syncPlotCrosshair?.(scrubTime);
        if (detail.values && g?.tickAnimations) {
          const existingMap =
            (
              g as unknown as { timelineStore?: { getVarIndexMap?: () => Map<string, number> } }
            ).timelineStore?.getVarIndexMap?.() ?? simDataRef.current?.varIndexMap;
          if (existingMap && existingMap.size > 0) {
            const frame = new Float64Array(existingMap.size);
            frame.fill(Number.NaN);
            for (const [k, v] of Object.entries(detail.values)) {
              const idx = existingMap.get(k);
              if (idx !== undefined && idx >= 0 && idx < frame.length && Number.isFinite(v)) {
                frame[idx] = v;
              }
            }
            g.tickAnimations(frame, 1 / 60);
          } else if (g.animationEngine?.bindVariableIndices) {
            const entries = Object.entries(detail.values);
            const varMap = new Map<string, number>();
            const frame = new Float64Array(entries.length);
            for (let i = 0; i < entries.length; i++) {
              const entry = entries[i];
              if (!entry) continue;
              varMap.set(entry[0], i);
              frame[i] = entry[1];
            }
            g.animationEngine.bindVariableIndices(varMap);
            g.tickAnimations(frame, 1 / 60);
          }
        }
      } else {
        setScrubbedPoint({ time: null, values: null });
        g?.syncPlotCrosshair?.(undefined);
      }
    };
    window.addEventListener("ansatz:time-scrub", handleTimeScrub);
    return () => window.removeEventListener("ansatz:time-scrub", handleTimeScrub);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let currentHighlightedContainer: HTMLElement | null = null;
    let currentGlowElement: SVGElement | null = null;

    const clearHighlight = () => {
      if (currentGlowElement) {
        currentGlowElement.remove();
        currentGlowElement = null;
      }
      if (currentHighlightedContainer) {
        currentHighlightedContainer.classList.remove("modelscript-hover-halo");
        currentHighlightedContainer = null;
      }
    };

    const handleHighlight = (e: Event) => {
      const detail = (e as CustomEvent<{ name?: string | null }>).detail;
      const targetName = detail?.name;

      clearHighlight();

      if (targetName && containerRef.current) {
        const g = getGraphFor(containerRef.current) as DiagramGraphInstance | null;
        if (g) {
          const cell = g.getCellById?.(targetName);
          if (cell) {
            const cellView = g.findViewByCell?.(cell);
            if (cellView?.container) {
              const svgNs = "http://www.w3.org/2000/svg";
              const size = (cell as { getSize?: () => { width?: number; height?: number } }).getSize?.();
              const width = size?.width && size.width > 0 ? size.width : 40;
              const height = size?.height && size.height > 0 ? size.height : 40;
              const cx = width / 2;
              const cy = height / 2;
              const radius = Math.max(width, height) * 0.9;
              const gradId = `modelscript-hover-radial-glow-${targetName.replace(/[^A-Za-z0-9_-]/g, "_")}`;

              const glowGroup = document.createElementNS(svgNs, "g");
              glowGroup.setAttribute("class", "modelscript-hover-glow");
              glowGroup.setAttribute("pointer-events", "none");

              const defs = document.createElementNS(svgNs, "defs");
              const grad = document.createElementNS(svgNs, "radialGradient");
              grad.setAttribute("id", gradId);
              grad.setAttribute("cx", "50%");
              grad.setAttribute("cy", "50%");
              grad.setAttribute("r", "50%");

              const stops: Array<[string, string]> = [
                ["0%", "0.45"],
                ["45%", "0.24"],
                ["75%", "0.08"],
                ["100%", "0"],
              ];
              for (const [offset, opacity] of stops) {
                const stop = document.createElementNS(svgNs, "stop");
                stop.setAttribute("offset", offset);
                stop.setAttribute("stop-color", "#0ea5e9");
                stop.setAttribute("stop-opacity", opacity);
                grad.appendChild(stop);
              }
              defs.appendChild(grad);
              glowGroup.appendChild(defs);

              const circle = document.createElementNS(svgNs, "circle");
              circle.setAttribute("cx", String(cx));
              circle.setAttribute("cy", String(cy));
              circle.setAttribute("r", String(radius));
              circle.setAttribute("fill", `url(#${gradId})`);
              circle.setAttribute("pointer-events", "none");
              glowGroup.appendChild(circle);

              cellView.container.insertBefore(glowGroup, cellView.container.firstChild);
              cellView.container.classList.add("modelscript-hover-halo");
              currentHighlightedContainer = cellView.container;
              currentGlowElement = glowGroup;
            }
          }
        }
      }
    };

    window.addEventListener("ansatz:highlight-component", handleHighlight);
    return () => {
      clearHighlight();
      window.removeEventListener("ansatz:highlight-component", handleHighlight);
    };
  }, []);

  useEffect(() => {
    const highlightedContainers: Element[] = [];
    const clearPsseHighlights = () => {
      for (const el of highlightedContainers) {
        (el as HTMLElement).style.filter = "";
        (el as HTMLElement).style.outline = "";
      }
      highlightedContainers.length = 0;
    };
    const handler = (ev: Event) => {
      clearPsseHighlights();
      const detail = (ev as CustomEvent<{ buses?: number[]; branches?: string[] }>).detail;
      const g = getGraphFor(containerRef.current) as
        | (DiagramGraphInstance & {
            getNodes?: () => Array<{ id?: string }>;
            getEdges?: () => Array<{ id?: string }>;
            findViewByCell?: (cellId: string) => { container?: Element } | null;
          })
        | null;
      if (!g || !detail) return;
      const busIds = new Set((detail.buses ?? []).map((b) => `bus_${b}`));
      const branchSet = new Set((detail.branches ?? []).map((s) => s.trim()));
      for (const id of busIds) {
        const view = g.findViewByCell?.(id);
        if (view?.container) {
          (view.container as HTMLElement).style.filter = "drop-shadow(0 0 8px #f85149)";
          highlightedContainers.push(view.container);
        }
      }
      if (branchSet.size > 0) {
        for (const edge of g.getEdges?.() ?? []) {
          const eid = String(edge.id ?? "");
          for (const br of branchSet) {
            if (eid.includes(br) || br.includes(eid)) {
              const view = g.findViewByCell?.(eid);
              if (view?.container) {
                (view.container as HTMLElement).style.filter = "drop-shadow(0 0 6px #f85149)";
                highlightedContainers.push(view.container);
              }
              break;
            }
          }
        }
      }
    };
    window.addEventListener("modelscript:psse-highlight", handler);
    return () => {
      clearPsseHighlights();
      window.removeEventListener("modelscript:psse-highlight", handler);
    };
  }, []);

  return (
    <SharedScissor3DHost>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
        <div
          ref={containerRef}
          role="application"
          aria-label="Schematic diagram canvas"
          style={{ width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%" }}
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            const g = getGraphFor(containerRef.current);
            if (g && containerRef.current) {
              const p = g.clientToLocal(e.clientX, e.clientY);
              movePlacementGhost(p.x, p.y);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            let className = e.dataTransfer.getData("application/vnd.modelscript.classname");
            let iconSvg = e.dataTransfer.getData("application/vnd.modelscript.iconsvg");
            if (!className) {
              try {
                const json = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
                if (json) {
                  const parsed = JSON.parse(json);
                  if (parsed.className) {
                    className = parsed.className;
                    if (parsed.iconSvg) iconSvg = parsed.iconSvg;
                  }
                }
              } catch {
                // ignore json parse error
              }
            }

            if (className && containerRef.current) {
              syncDiagramOptions();
              const g = getGraphFor(containerRef.current) ?? initGraph(props.theme === "vs-dark", containerRef.current);
              if (!g) return;
              const p = g.clientToLocal(e.clientX, e.clientY);

              // Clear drag placement ghost without dispatching Escape (which would destroy the drop placeholder)
              clearPlacement();

              // Render the pop & bounce animation placeholder while the action queues
              dropComponentGhost(g, p.x, p.y, className, iconSvg, props.theme === "vs-dark");

              if (props.onDrop) {
                props.onDrop(className, p.x, p.y, iconSvg);
              }
            }
          }}
        />
        {embeddedPortals.map((p) => {
          const isFocused = focusedPortalId === p.portalId;
          return (
            <div
              key={p.portalId}
              data-testid={`diagram-embedded-portal-${p.portalId}`}
              data-portal-kind={p.kind}
              data-portal-focused={isFocused ? "true" : "false"}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setFocusedPortalId(p.portalId);
              }}
              style={{
                position: "absolute",
                left: p.cssX,
                top: p.cssY,
                width: p.cssWidth,
                height: p.cssHeight,
                pointerEvents: "auto",
                borderRadius: 6,
                boxSizing: "border-box",
              }}
            >
              {!p.renderLive && p.snapshotDataUrl && !isFocused ? (
                <div
                  style={{ position: "relative", width: "100%", height: "100%", borderRadius: 6, overflow: "hidden" }}
                >
                  <img
                    src={p.snapshotDataUrl}
                    alt={`${p.kind.toUpperCase()} portal snapshot`}
                    draggable={false}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  <button
                    type="button"
                    data-testid={`diagram-embedded-portal-orbit-${p.portalId}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFocusedPortalId(p.portalId);
                    }}
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      zIndex: 6,
                      pointerEvents: "auto",
                      cursor: "pointer",
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#e2e8f0",
                      background: "rgba(15, 23, 42, 0.88)",
                      border: "1px solid rgba(56, 189, 248, 0.55)",
                      borderRadius: 4,
                      padding: "2px 6px",
                    }}
                  >
                    Orbit 3D
                  </button>
                </div>
              ) : (
                <Scissor3DViewport
                  kind={p.kind}
                  artifactUri={p.artifactUri}
                  vtkBuffer={p.vtkBuffer ?? fetchedVtkBuffers[p.artifactUri] ?? null}
                  onTessellateStep={props.onTessellateStep}
                  simulationTime={scrubbedPoint.time ?? 0}
                  animate={simPlayback ? simPlayback.isPlaying : scrubbedPoint.time != null}
                  interactive={isFocused}
                  width="100%"
                  height="100%"
                  badgeLabel={p.badgeLabel ?? `${p.kind.toUpperCase()} · ${p.portalId}`}
                  onToggleInteract={() => {
                    setFocusedPortalId((prev) => (prev === p.portalId ? null : p.portalId));
                  }}
                />
              )}
            </div>
          );
        })}
        {props.showZonotopeOverlay && props.zonotopeWorkbenchState && props.diagramData && (
          <DiagramZonotopeOverlay
            diagramData={props.diagramData}
            hypergraphRecord={props.hypergraphRecord}
            workbenchState={props.zonotopeWorkbenchState}
            colorMode={props.theme === "vs-dark" ? "dark" : "light"}
            viewportTransform={zonotopeViewport}
            onSelectGroup={props.onSelectZonotopeGroup}
            onAddOverride={props.onAddZonotopeOverride}
            onAddConstraint={props.onAddZonotopeConstraint}
            onToggleFaultGenerator={props.onToggleFaultGenerator}
          />
        )}
        {scrubbedPoint.time != null && (
          <div
            data-testid="diagram-time-scrub-hud"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 20,
              pointerEvents: "none",
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px 12px",
              padding: "6px 12px",
              borderRadius: "999px",
              fontSize: "11px",
              fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
              backgroundColor: "var(--ms-surface-glass)",
              color: "var(--fgColor-default, var(--ms-text-1))",
              border: "1px solid var(--borderColor-default, var(--ms-border))",
              boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
              backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ fontWeight: 700, color: "var(--fgColor-accent, var(--ms-brand))" }}>
              t = {scrubbedPoint.time.toFixed(3)}s
            </span>
            {scrubbedPoint.values &&
              Object.entries(scrubbedPoint.values)
                .slice(0, 4)
                .map(([varName, val]) => (
                  <span key={varName} style={{ display: "inline-flex", gap: 4 }}>
                    <span style={{ opacity: 0.75 }}>{varName}:</span>
                    <span style={{ fontWeight: 600, color: "var(--ms-status-pass-fg, #34d399)" }}>
                      {typeof val === "number" && Number.isFinite(val) ? val.toFixed(3) : String(val)}
                    </span>
                  </span>
                ))}
            <button
              type="button"
              data-testid="diagram-pin-plot-btn"
              title="Pin live Canvas2D plot widget onto the schematic"
              onClick={handlePinScrubbedPlot}
              style={{
                pointerEvents: "auto",
                cursor: "pointer",
                fontSize: "10px",
                fontWeight: 600,
                lineHeight: 1.2,
                padding: "2px 8px",
                borderRadius: "999px",
                border: "1px solid var(--borderColor-accent-muted, rgba(56, 189, 248, 0.45))",
                backgroundColor: "var(--bgColor-accent-muted, rgba(56, 189, 248, 0.14))",
                color: "var(--fgColor-accent, #38bdf8)",
              }}
            >
              + Pin Plot
            </button>
          </div>
        )}
        {simPlayback && (
          <div
            data-testid="diagram-sim-transport"
            style={{
              position: "absolute",
              bottom: 14,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 25,
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 12px",
              borderRadius: "999px",
              fontSize: "11px",
              fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
              backgroundColor: "var(--ms-surface-glass, rgba(15, 23, 42, 0.88))",
              color: "var(--fgColor-default, var(--ms-text-1, #e2e8f0))",
              border: "1px solid var(--borderColor-default, var(--ms-border, rgba(148, 163, 184, 0.25)))",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
              backdropFilter: "blur(10px)",
              maxWidth: "calc(100% - 32px)",
            }}
          >
            <button
              type="button"
              data-testid="diagram-sim-play-toggle"
              aria-label={simPlayback.isPlaying ? "Pause simulation" : "Play simulation"}
              title={simPlayback.isPlaying ? "Pause simulation playback" : "Play simulation playback"}
              onClick={() => {
                if (simPlayback.isPlaying) {
                  pauseSimulation();
                } else {
                  playSimulation();
                }
              }}
              style={{
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                minWidth: 58,
                padding: "3px 9px",
                borderRadius: "999px",
                fontSize: "10px",
                fontWeight: 700,
                lineHeight: 1.2,
                border: "1px solid rgba(56, 189, 248, 0.55)",
                backgroundColor: simPlayback.isPlaying ? "rgba(56, 189, 248, 0.24)" : "rgba(56, 189, 248, 0.14)",
                color: "var(--fgColor-accent, #38bdf8)",
              }}
            >
              {simPlayback.isPlaying ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              data-testid="diagram-sim-slider"
              aria-label="Simulation time"
              min={simPlayback.start}
              max={simPlayback.end > simPlayback.start ? simPlayback.end : simPlayback.start + 1}
              step={Math.max(1e-6, (simPlayback.end - simPlayback.start) / 500 || 0.01)}
              value={simPlayback.current}
              onChange={(e) => {
                seekSimulation(Number(e.target.value));
              }}
              style={{
                width: 150,
                accentColor: "#38bdf8",
                cursor: "pointer",
              }}
            />
            <span
              data-testid="diagram-sim-time"
              style={{
                fontWeight: 600,
                whiteSpace: "nowrap",
                color: "var(--fgColor-accent, var(--ms-brand, #38bdf8))",
              }}
            >
              t = {simPlayback.current.toFixed(3)}s / {simPlayback.end.toFixed(2)}s
            </span>
            <button
              type="button"
              data-testid="diagram-sim-pin-plot-btn"
              title="Pin live Float64Array plot widget onto the schematic"
              onClick={handlePinScrubbedPlot}
              style={{
                cursor: "pointer",
                fontSize: "10px",
                fontWeight: 600,
                lineHeight: 1.2,
                padding: "2px 8px",
                borderRadius: "999px",
                whiteSpace: "nowrap",
                border: "1px solid var(--borderColor-accent-muted, rgba(56, 189, 248, 0.45))",
                backgroundColor: "var(--bgColor-accent-muted, rgba(56, 189, 248, 0.14))",
                color: "var(--fgColor-accent, #38bdf8)",
              }}
            >
              + Pin Plot
            </button>
          </div>
        )}
        {props.isLoading &&
          (() => {
            const g = getGraphFor(containerRef.current) as {
              scale?: () => { sx: number; sy: number };
              translate?: () => { tx: number; ty: number };
            } | null;
            const cs = props.diagramData?.coordinateSystem;
            const ox = cs?.axesStyle?.origin?.[0] ?? 0;
            const oy = cs?.axesStyle?.origin?.[1] ?? 0;
            let originScreenPos: { x: number; y: number } | null = null;
            if (
              g &&
              hasFittedViewportRef.current &&
              typeof g.scale === "function" &&
              typeof g.translate === "function"
            ) {
              const s = g.scale();
              const t = g.translate();
              if (s && t && typeof s.sx === "number" && typeof t.tx === "number") {
                originScreenPos = { x: ox * s.sx + t.tx, y: oy * s.sy + t.ty };
              }
            }
            return (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  paddingTop: originScreenPos ? 0 : (props.fitInsets?.top ?? 0),
                  paddingRight: originScreenPos ? 0 : (props.fitInsets?.right ?? 0),
                  paddingBottom: originScreenPos ? 0 : (props.fitInsets?.bottom ?? 0),
                  paddingLeft: originScreenPos ? 0 : (props.fitInsets?.left ?? 0),
                  boxSizing: "border-box",
                  backgroundColor: props.theme === "vs-dark" ? "rgba(18, 18, 20, 0.72)" : "rgba(248, 250, 252, 0.72)",
                  zIndex: 1000,
                  pointerEvents: "none",
                }}
              >
                <div
                  style={
                    originScreenPos
                      ? {
                          position: "absolute",
                          left: originScreenPos.x,
                          top: originScreenPos.y,
                          transform: "translate(-50%, -50%)",
                        }
                      : undefined
                  }
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      border: `3px solid ${props.theme === "vs-dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"}`,
                      borderTopColor: props.theme === "vs-dark" ? "#ccc" : "#333",
                      borderRadius: "50%",
                      animation: "diagram-spin 0.7s linear infinite",
                    }}
                  />
                </div>
              </div>
            );
          })()}
        <style>{`
          @keyframes diagram-spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    </SharedScissor3DHost>
  );
});

export default DiagramEditor;
