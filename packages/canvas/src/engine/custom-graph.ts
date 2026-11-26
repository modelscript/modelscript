// SPDX-License-Identifier: AGPL-3.0-or-later

import { CameraController } from "../core/camera.js";
import { Scissor3DPortalManager, type Embedded3DPortalSpec } from "../renderers/scissor-3d-manager.js";
import { ScissorSnapshotBaker } from "../renderers/snapshot-baker.js";
import { SpatialSurfaceBridge } from "../renderers/spatial-vr-bridge.js";
import { WebGpuSchematicRenderer, type WebGpuLike } from "../renderers/webgpu-renderer.js";
import type { WorldBounds, WorldPoint } from "../schema/canvas-document.js";
import { CompiledAnimationEngine, SimulationTimelineStore, type AnimationBindingSpec } from "./animation-engine.js";
import type { Canvas2DContextLike } from "./glyph-compiler.js";
import {
  addEdgeToGraph,
  addNodeToGraph,
  applyAnimationUpdateToCell,
  applyGridArgs,
  applyRenderModeToDom,
  attachGraphDomEventListeners,
  brushPlotWidgetInHost,
  cleanSelectionInStore,
  clearCellsFromGraph,
  computeEdgeRenderPath as computeEdgeRenderPathImpl,
  computeZoomToRectState,
  createGraphFsmCallbacks,
  createInitialGridState,
  createWebGpuCanvasEl,
  disposeCellsAndCollections,
  findOrCreateCellView,
  getSelectedCellsFromStore,
  loadSimulationResultInHost,
  mountGraphDom,
  nextAutoCellId,
  paintSceneToCanvas2D,
  patchCellSelectorDom as patchCellSelectorDomImpl,
  pauseSimulationInHost,
  playSimulationInHost,
  rebuildCellDom as rebuildCellDomImpl,
  removeCellFromGraph,
  renderCanvas2DFrame,
  renderWidgetCanvasDom,
  reorderCellDomByZIndex as reorderCellDomByZIndexImpl,
  resizeCellVisualDom as resizeCellVisualDomImpl,
  resolveDesiredRenderMode,
  seekSimulationInHost,
  selectCellsInStore,
  setWidgetPositionInHost,
  setWidgetSizeInHost,
  setWidgetTetherInHost,
  syncAlignmentGuidesDom,
  syncCellDom as syncCellDomImpl,
  syncEdgeToolsDom as syncEdgeToolsDomImpl,
  syncEdgeToScene as syncEdgeToSceneImpl,
  syncGridPatternDom,
  syncHoveredPortDom,
  syncMagnetHighlightsDom,
  syncMarqueeDom,
  syncPlotCrosshairInHost,
  syncSelectionBoxesDom as syncSelectionBoxesDomImpl,
  syncSelectionFromFsmInStore,
  UnifiedCell,
  UnifiedSelection,
  UnifiedTransform,
  unselectCellsInStore,
  type ActiveWidgetInteraction,
  type Canvas2DPaintContext,
  type CellDomSyncContext,
  type CellStoreHost,
  type EdgeRenderPathResult,
  type GraphDomLayers,
  type GridStyleState,
  type OverlayDomContext,
  type SimulationPlaybackState,
  type SimulationWidgetsHost,
  type UnifiedCanvasWidgetSpec,
  type UnifiedCellViewBase,
  type UnifiedConnectorFnBase,
  type UnifiedEdgeTerminal,
  type UnifiedGraphOptions,
  type UnifiedPortItem,
  type UnifiedRouterFnBase,
  type UnifiedSelectionOptions,
  type UnifiedTransformOptions,
} from "./graph/index.js";
import { CanvasPointerFSM } from "./pointer-fsm.js";
import { SoaSceneGraph } from "./soa-scene.js";

export { UnifiedCell, UnifiedSelection, UnifiedTransform };
export type {
  UnifiedCanvasWidgetSpec,
  UnifiedEdgeTerminal,
  UnifiedGraphOptions,
  UnifiedPortItem,
  UnifiedSelectionOptions,
  UnifiedTransformOptions,
};

export type UnifiedCellView = UnifiedCellViewBase<UnifiedCell, UnifiedGraph>;
export type UnifiedRouterFn = UnifiedRouterFnBase<UnifiedCell, UnifiedGraph>;
export type UnifiedConnectorFn = UnifiedConnectorFnBase<UnifiedCell, UnifiedGraph>;

/**
 * Custom Unified Graph Engine — 100% AntV X6 Replacement.
 *
 * Combines:
 *  - SoaSceneGraph (50,000+ node scalability & zero-copy WASM export)
 *  - CameraController (cursor-centered zoom, pan, fit, bookmarks)
 *  - CanvasPointerFSM (DOM-free 2D/3D/VR interaction with native rotated handles & orthogonal segment drag)
 *  - Scissor3DPortalManager (unlimited embedded CAD/FEA/CFD viewports on 1 WebGL context)
 *  - CompiledAnimationEngine + SimulationTimelineStore (zero-GC 60 FPS SCADA & Modelica animation)
 *  - Canvas2D Plot/Table widgets (Modelon Impact-style pinned widgets & VR CanvasTexture support)
 */
export class UnifiedGraph {
  private static readonly routerRegistry = new Map<string, UnifiedRouterFn>();
  private static readonly connectorRegistry = new Map<string, UnifiedConnectorFn>();

  public static registerRouter(name: string, fn: UnifiedRouterFn, force = true): void {
    if (force || !UnifiedGraph.routerRegistry.has(name)) UnifiedGraph.routerRegistry.set(name, fn);
  }

  public static registerConnector(name: string, fn: UnifiedConnectorFn, force = true): void {
    if (force || !UnifiedGraph.connectorRegistry.has(name)) UnifiedGraph.connectorRegistry.set(name, fn);
  }

  public readonly container: HTMLElement;
  public readonly options: UnifiedGraphOptions;
  public readonly scene: SoaSceneGraph;
  public readonly camera: CameraController;
  public readonly fsm: CanvasPointerFSM;
  public readonly portal3DManager: Scissor3DPortalManager;
  public readonly snapshotBaker: ScissorSnapshotBaker;
  public readonly webGpuRenderer: WebGpuSchematicRenderer;
  public readonly animationEngine: CompiledAnimationEngine;
  public readonly timelineStore: SimulationTimelineStore;

  public disposed = false;
  public readonly coord: { localToGraphRect: (rect: WorldBounds) => WorldBounds };

  private width: number;
  private height: number;
  private gridState: GridStyleState;
  private bgColor = "transparent";
  private renderModePreference: "auto" | "svg" | "canvas2d" = "auto";
  private highScaleThreshold = 1500;
  private activeRenderMode: "svg" | "canvas2d" = "svg";
  private preferWebGpu = false;
  private webGpuInitAttempted = false;

  private cells = new Map<string, UnifiedCell>();
  private selectedIds = new Set<string>();
  private widgets = new Map<string, UnifiedCanvasWidgetSpec>();
  private plugins = new Map<string, unknown>();
  private listeners = new Map<string, Set<(args: unknown) => void>>();
  private batchDepth = 0;
  private markerCache = new Map<string, string>();
  private canvas2DRafId: number | null = null;
  private simState: SimulationPlaybackState = {
    simPlaybackRafId: null,
    simLastFrameMs: 0,
    hasLoadedSimulation: false,
  };
  private hoveredCellId: string | null = null;
  private activeWidgetInteraction: ActiveWidgetInteraction | null = null;

  // Browser DOM layers (null in headless Node environment)
  private dom: GraphDomLayers | null = null;
  private webGpuCanvasEl: HTMLCanvasElement | null = null;
  private gridPatternId: string;
  private resizeObserver: ResizeObserver | null = null;
  private cleanupDomListeners: (() => void)[] = [];

  constructor(options: UnifiedGraphOptions = {}) {
    this.options = options;
    this.container = options.container ?? ({} as HTMLElement);
    this.width = options.width ?? (this.container?.clientWidth || 800);
    this.height = options.height ?? (this.container?.clientHeight || 600);
    this.renderModePreference = options.renderMode ?? "auto";
    this.highScaleThreshold = Math.max(100, options.highScaleThreshold ?? 1500);
    this.preferWebGpu = options.preferWebGpu === true;
    this.activeRenderMode = this.renderModePreference === "canvas2d" ? "canvas2d" : "svg";
    this.gridPatternId = nextAutoCellId("ms-grid-");
    this.gridState = createInitialGridState(options.grid);
    if (options.background?.color) this.bgColor = options.background.color;

    this.scene = new SoaSceneGraph(1024, 256);
    this.camera = new CameraController({ minZoom: 0.02, maxZoom: 20, initial: { tx: 0, ty: 0, zoom: 1 } });
    this.portal3DManager = new Scissor3DPortalManager({
      devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    });
    this.snapshotBaker = new ScissorSnapshotBaker();
    this.webGpuRenderer = new WebGpuSchematicRenderer();
    this.animationEngine = new CompiledAnimationEngine();
    this.timelineStore = new SimulationTimelineStore();

    this.fsm = new CanvasPointerFSM(
      this.scene,
      createGraphFsmCallbacks({
        graph: this,
        options: this.options,
        scene: this.scene,
        camera: this.camera,
        cells: this.cells,
        routerRegistry: UnifiedGraph.routerRegistry,
        connectorRegistry: UnifiedGraph.connectorRegistry,
        getWirePreviewPathEl: () => this.dom?.wirePreviewPathEl ?? null,
        getEdges: () => this.getEdges(),
        createEdge: (metadata) => this.createEdge(metadata),
        addEdge: (metadata) => this.addEdge(metadata),
        getPlugin: (name) => this.getPlugin(name),
        syncSelectionFromFsm: (nodeIds, edgeIds) =>
          syncSelectionFromFsmInStore(this.createCellStoreHost(), nodeIds, edgeIds),
        syncCellDom: (cell) => this.syncCellDom(cell),
        resizeCellVisualDom: (cell, pw, ph) => this.resizeCellVisualDom(cell, pw, ph),
        refreshConnectedEdges: (node) => this.refreshConnectedEdges(node),
        syncSelectionBoxesDom: (panOnly) => this.syncSelectionBoxesDom(panOnly),
        syncEdgeToolsDom: (edge) => this.syncEdgeToolsDom(edge),
        syncAlignmentGuidesDom: (guides) => syncAlignmentGuidesDom(this.dom?.guidesG ?? null, guides),
        syncMarqueeDom: (rect) => syncMarqueeDom(this.dom?.marqueeRectEl ?? null, rect),
        syncMagnetHighlightsDom: (preview) =>
          syncMagnetHighlightsDom(this.dom?.nodesG ?? null, preview, (sId, sPort, tId, tPort) => {
            const validator = this.options.connecting?.validateConnection;
            if (!validator) return true;
            try {
              return validator({
                sourceCell: this.cells.get(sId) ?? null,
                targetCell: this.cells.get(tId) ?? null,
                sourcePort: sPort,
                targetPort: tPort,
              });
            } catch {
              return true;
            }
          }),
        applyViewportTransformDom: (panOnly) => this.applyViewportTransformDom(panOnly),
        scheduleCanvas2DRender: () => this.scheduleCanvas2DRender(),
        emit: (event, args) => this.emit(event, args),
      }),
      { gridSize: this.gridState.gridSize },
    );

    this.coord = {
      localToGraphRect: (rect: WorldBounds): WorldBounds => {
        const s = this.camera.getState();
        return {
          x: rect.x * s.zoom + s.tx,
          y: rect.y * s.zoom + s.ty,
          width: rect.width * s.zoom,
          height: rect.height * s.zoom,
        };
      },
    };

    this.mountDomIfAvailable();
  }

  private mountDomIfAvailable(): void {
    const layers = mountGraphDom({
      container: this.container,
      width: this.width,
      height: this.height,
      bgColor: this.bgColor,
      gridPatternId: this.gridPatternId,
      gridSize: this.gridState.gridSize,
      gridColor: this.gridState.gridColor,
      gridVisible: this.gridState.gridVisible,
      activeRenderMode: this.activeRenderMode,
    });
    if (!layers) return;
    this.dom = layers;
    this.syncGridDom();

    const cleanup = attachGraphDomEventListeners(layers.rootEl, {
      container: this.container,
      options: this.options,
      scene: this.scene,
      camera: this.camera,
      fsm: this.fsm,
      cells: this.cells,
      widgets: this.widgets,
      getActiveRenderModeInternal: () => this.activeRenderMode,
      getHoveredCellId: () => this.hoveredCellId,
      setHoveredCellId: (id) => {
        this.hoveredCellId = id;
      },
      getActiveWidgetInteraction: () => this.activeWidgetInteraction,
      setActiveWidgetInteraction: (inter) => {
        this.activeWidgetInteraction = inter;
      },
      clientToLocal: (x, y) => this.clientToLocal(x, y),
      setWidgetPosition: (id, x, y) => this.setWidgetPosition(id, x, y),
      setWidgetSize: (id, w, h) => this.setWidgetSize(id, w, h),
      brushPlotWidget: (id, rect) => this.brushPlotWidget(id, rect),
      applyViewportTransformDom: (panOnly) => this.applyViewportTransformDom(panOnly),
      syncHoveredPortDom: (hoveredPort) => syncHoveredPortDom(this.dom?.nodesG ?? null, hoveredPort),
      emit: (event, args) => this.emit(event, args),
    });
    this.cleanupDomListeners.push(cleanup);

    if (this.options.autoResize && typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.disposed) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w > 0 && h > 0 && (w !== this.width || h !== this.height)) this.resize(w, h);
      });
      this.resizeObserver.observe(this.container);
    }
  }

  public isDisposed(): boolean {
    return this.disposed;
  }

  public getWidth(): number {
    return this.width;
  }

  public getHeight(): number {
    return this.height;
  }

  public setReadOnly(readOnly: boolean): void {
    this.fsm.setOptions({ readOnly });
    this.syncSelectionBoxesDom();
  }

  public setSnapEnabled(enabled: boolean): void {
    this.fsm.setOptions({ snapEnabled: enabled });
  }

  public setSnapStep(step: number): void {
    this.fsm.setOptions({ gridSize: Math.max(1, step) });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pauseSimulation();
    if (this.canvas2DRafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.canvas2DRafId);
      this.canvas2DRafId = null;
    }
    this.webGpuRenderer.dispose();
    this.snapshotBaker.dispose();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const fn of this.cleanupDomListeners) fn();
    this.cleanupDomListeners = [];
    if (this.dom?.rootEl.parentElement) this.dom.rootEl.parentElement.removeChild(this.dom.rootEl);
    this.dom = null;
    this.webGpuCanvasEl = null;
    disposeCellsAndCollections(
      this.cells,
      this.selectedIds,
      this.widgets,
      this.plugins,
      this.markerCache,
      this.listeners,
      this.scene,
    );
  }

  // ── Event Bus ──

  public on<T = Record<string, unknown>>(event: string, handler: (args: T) => void): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler as (args: unknown) => void);
    return this;
  }

  public off<T = Record<string, unknown>>(event: string, handler?: (args: T) => void): this {
    if (!handler) this.listeners.delete(event);
    else this.listeners.get(event)?.delete(handler as (args: unknown) => void);
    return this;
  }

  public emit(event: string, args: unknown = {}): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of Array.from(set)) {
      try {
        fn(args);
      } catch (err) {
        console.error(`[UnifiedGraph] error in "${event}" listener:`, err);
      }
    }
  }

  // ── Plugins ──

  public use(plugin: unknown): this {
    if (plugin && typeof plugin === "object") {
      const p = plugin as { name?: string | undefined };
      this.plugins.set(p.name ?? `plugin_${this.plugins.size}`, plugin);
      if (plugin instanceof UnifiedSelection && this.dom?.selectionOverlayEl) {
        plugin.selectionImpl.container = this.dom.selectionOverlayEl;
      }
    }
    return this;
  }

  public getPlugin(name: string): unknown {
    return this.plugins.get(name);
  }

  // ── Background & Grid ──

  public drawBackground(options: { color: string }): void {
    this.bgColor = options.color;
    if (this.container?.style) this.container.style.backgroundColor = options.color;
  }

  private syncGridDom(panOnly = false): void {
    syncGridPatternDom(
      this.dom?.gridPatternEl ?? null,
      this.dom?.gridRectEl ?? null,
      this.gridPatternId,
      this.gridState,
      this.camera.getState(),
      panOnly,
    );
  }

  public drawGrid(options: Record<string, unknown>): void {
    this.gridState.gridVisible = true;
    this.gridState.lastGridZoom = -1;
    if (typeof options["type"] === "string") this.gridState.gridType = options["type"];
    applyGridArgs(this.gridState, options["args"]);
    this.syncGridDom();
  }

  public showGrid(): void {
    this.gridState.gridVisible = true;
    this.gridState.lastGridZoom = -1;
    this.syncGridDom();
  }

  public hideGrid(): void {
    this.gridState.gridVisible = false;
    this.dom?.gridRectEl.setAttribute("fill", "none");
  }

  public clearGrid(): void {
    this.hideGrid();
  }

  public setGridSize(size: number): void {
    this.gridState.gridSize = Math.max(1, size);
    this.gridState.lastGridZoom = -1;
    this.fsm.setOptions({ gridSize: this.gridState.gridSize });
    this.syncGridDom();
  }

  public getGridSize(): number {
    return this.gridState.gridSize;
  }

  public getGridType(): string {
    return this.gridState.gridType;
  }

  public snapToGrid(x: number, y: number): { x: number; y: number; toJSON: () => { x: number; y: number } } {
    const sx = this.fsm.snap(x);
    const sy = this.fsm.snap(y);
    return { x: sx, y: sy, toJSON: () => ({ x: sx, y: sy }) };
  }

  // ── Cells (Nodes & Edges) ──

  public createEdge(metadata: Record<string, unknown>): UnifiedCell {
    return new UnifiedCell("edge", metadata, this);
  }

  public addNode(metadata: Record<string, unknown> | UnifiedCell): UnifiedCell {
    return addNodeToGraph(this.createCellStoreHost(), metadata);
  }

  public addEdge(metadata: Record<string, unknown> | UnifiedCell): UnifiedCell {
    return addEdgeToGraph(this.createCellStoreHost(), metadata);
  }

  public syncEdgeToScene(edge: UnifiedCell): void {
    syncEdgeToSceneImpl(this.scene, edge);
  }

  public getCellById(id?: string): UnifiedCell | null {
    return id ? (this.cells.get(id) ?? null) : null;
  }

  public getCells(): UnifiedCell[] {
    return Array.from(this.cells.values());
  }

  public getNodes(): UnifiedCell[] {
    return Array.from(this.cells.values()).filter((c) => c.isNode());
  }

  public getEdges(): UnifiedCell[] {
    return Array.from(this.cells.values()).filter((c) => c.isEdge());
  }

  public getConnectedEdges(node: { id?: string | undefined } | string): UnifiedCell[] {
    const id = typeof node === "string" ? node : (node?.id ?? "");
    if (!id) return [];
    const out: UnifiedCell[] = [];
    for (const eid of this.scene.getConnectedEdgeIds(id)) {
      const c = this.cells.get(eid);
      if (c && c.isEdge()) out.push(c);
    }
    return out;
  }

  public removeCell(cellOrId: unknown): UnifiedCell | null {
    return removeCellFromGraph(this.createCellStoreHost(), cellOrId);
  }

  public removeCells(cells: UnifiedCell[]): UnifiedCell[] {
    const removed: UnifiedCell[] = [];
    for (const c of cells) {
      const r = this.removeCell(c);
      if (r) removed.push(r);
    }
    return removed;
  }

  public clearCells(): void {
    clearCellsFromGraph(this.createCellStoreHost());
  }

  public batchUpdate(_name: string, execute: () => void): void {
    this.batchDepth++;
    try {
      execute();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) this.applyViewportTransformDom();
    }
  }

  public fromJSON(data: {
    nodes?: Record<string, unknown>[] | undefined;
    edges?: Record<string, unknown>[] | undefined;
  }): void {
    this.batchUpdate("fromJSON", () => {
      this.clearCells();
      for (const n of data.nodes ?? []) this.addNode(n);
      for (const e of data.edges ?? []) this.addEdge(e);
    });
  }

  public findViewByCell(cell: UnifiedCell | string): UnifiedCellView | null {
    return findOrCreateCellView(this, this.cells, cell);
  }

  // ── Selection ──

  public getSelectedCells(): UnifiedCell[] {
    return getSelectedCellsFromStore(this.cells, this.selectedIds);
  }

  public isSelected(cell: UnifiedCell): boolean {
    return this.selectedIds.has(cell.id);
  }

  public select(cellOrCells: UnifiedCell | UnifiedCell[]): void {
    selectCellsInStore(this.createCellStoreHost(), cellOrCells);
  }

  public unselect(cellOrCells: UnifiedCell | UnifiedCell[]): void {
    unselectCellsInStore(this.createCellStoreHost(), cellOrCells);
  }

  public cleanSelection(): void {
    cleanSelectionInStore(this.createCellStoreHost());
  }

  // ── Viewport / Camera ──

  public scale(): { sx: number; sy: number } {
    const z = this.camera.getState().zoom;
    return { sx: z, sy: z };
  }

  public translate(tx?: number, ty?: number): { tx: number; ty: number } {
    if (typeof tx === "number" && typeof ty === "number") {
      const next = this.camera.setState({ tx, ty });
      this.applyViewportTransformDom();
      this.emit("translate", { tx: next.tx, ty: next.ty });
      return { tx: next.tx, ty: next.ty };
    }
    const s = this.camera.getState();
    return { tx: s.tx, ty: s.ty };
  }

  public zoom(factor?: number, options?: { absolute?: boolean | undefined }): number {
    const cur = this.camera.getState().zoom;
    if (typeof factor !== "number") return cur;
    const target = options?.absolute ? factor : cur + factor;
    const next = this.camera.zoomAtScreenPoint(target, { x: this.width / 2, y: this.height / 2 });
    this.applyViewportTransformDom();
    this.emit("scale", { sx: next.zoom, sy: next.zoom });
    return next.zoom;
  }

  public zoomTo(factor: number): void {
    this.zoom(factor, { absolute: true });
  }

  public resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    if (this.dom?.svgEl) {
      this.dom.svgEl.setAttribute("width", String(this.width));
      this.dom.svgEl.setAttribute("height", String(this.height));
    }
    this.scheduleCanvas2DRender();
    this.renderWidgetCanvasDom();
  }

  public zoomToRect(
    rect: WorldBounds,
    options?: {
      padding?: number | undefined;
      maxScale?: number | undefined;
      viewportArea?: WorldBounds | undefined;
    },
  ): void {
    const next = computeZoomToRectState(rect, this.width, this.height, (z) => this.camera.clampZoom(z), options);
    this.camera.setState(next);
    this.applyViewportTransformDom();
    const s = this.camera.getState();
    this.emit("scale", { sx: s.zoom, sy: s.zoom });
    this.emit("translate", { tx: s.tx, ty: s.ty });
  }

  public zoomToFit(options?: {
    padding?: number | undefined;
    maxScale?: number | undefined;
    viewportArea?: WorldBounds | undefined;
  }): void {
    const bounds = this.scene.getContentBounds();
    if (bounds) this.zoomToRect(bounds, options);
  }

  public centerPoint(worldX: number, worldY: number): void {
    const z = this.camera.getState().zoom;
    this.translate(this.width / 2 - worldX * z, this.height / 2 - worldY * z);
  }

  public centerContent(): void {
    const bounds = this.scene.getContentBounds();
    if (bounds) this.centerPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  }

  public centerCell(cell: UnifiedCell): void {
    const bb = cell.getBBox();
    this.centerPoint(bb.x + bb.width / 2, bb.y + bb.height / 2);
  }

  public clientToLocal(x: number, y: number): WorldPoint {
    const rect = this.container?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    return this.camera.screenToWorld({ x: x - rect.left, y: y - rect.top });
  }

  public matrix(): { a: number; d: number; e: number; f: number } {
    const s = this.camera.getState();
    return { a: s.zoom, d: s.zoom, e: s.tx, f: s.ty };
  }

  // ── First-Class Unified Extensions (Nested 3D Portals, Widgets, Animations, 3D/VR) ──

  /** Returns the active rendering backend ("svg" for standard schematics, "canvas2d" or "webgpu" above highScaleThreshold). */
  public getActiveRenderMode(): "svg" | "canvas2d" | "webgpu" {
    return this.activeRenderMode === "canvas2d" && this.webGpuRenderer.isReady() ? "webgpu" : this.activeRenderMode;
  }

  /** Initializes optional WebGPU instanced schematic rendering on a dedicated GPU canvas layer. */
  public async enableWebGpu(gpuOverride?: WebGpuLike | null): Promise<boolean> {
    this.preferWebGpu = true;
    this.webGpuInitAttempted = true;
    if (!this.webGpuCanvasEl) this.webGpuCanvasEl = createWebGpuCanvasEl(this.dom?.rootEl ?? null);
    const ok = await this.webGpuRenderer.initialize(this.webGpuCanvasEl, gpuOverride);
    if (ok && this.activeRenderMode === "canvas2d") this.scheduleCanvas2DRender();
    return ok;
  }

  /** Registers a live embedded 3D CAD / FEA / CFD / STEP / VTK portal inside this schematic canvas. */
  public registerEmbeddedPortal(spec: Embedded3DPortalSpec): void {
    this.portal3DManager.registerPortal(spec);
  }

  /** Computes clipped WebGL scissor rects for all visible 3D portals on 1 shared WebGL context. */
  public computeEmbedded3DScissorRects() {
    return this.portal3DManager.computeFrameScissorRects(this.camera, { width: this.width, height: this.height });
  }

  /** Pins a Modelon Impact-style Canvas2D plot, table, or KPI sticky widget onto the schematic canvas. */
  public registerCanvasWidget(widget: UnifiedCanvasWidgetSpec): void {
    this.widgets.set(widget.id, widget);
    this.renderWidgetCanvasDom();
    this.scheduleCanvas2DRender();
  }

  public removeCanvasWidget(widgetId: string): boolean {
    const deleted = this.widgets.delete(widgetId);
    if (deleted) {
      this.renderWidgetCanvasDom();
      this.scheduleCanvas2DRender();
    }
    return deleted;
  }

  /** Moves a pinned Canvas2D plot, table, or KPI sticky widget in world coordinates. */
  public setWidgetPosition(widgetId: string, x: number, y: number): boolean {
    return setWidgetPositionInHost(this.createSimWidgetsHost(), widgetId, x, y);
  }

  /** Resizes a pinned Canvas2D plot, table, or KPI sticky widget in world coordinates. */
  public setWidgetSize(widgetId: string, width: number, height: number): boolean {
    return setWidgetSizeInHost(this.createSimWidgetsHost(), widgetId, width, height);
  }

  /** Connects a pinned widget to a world-space wire or port via a dashed leader tether. */
  public setWidgetTether(
    widgetId: string,
    target: { x: number; y: number; label?: string | undefined } | undefined,
  ): boolean {
    return setWidgetTetherInHost(this.createSimWidgetsHost(), widgetId, target);
  }

  /**
   * Brushes a Monte Carlo / Pareto scatter plot widget in world coordinates,
   * automatically highlighting linked rows on any pinned `table` widgets and
   * notifying `onWidgetBrush` / `"widget:brushed"` listeners.
   */
  public brushPlotWidget(
    widgetId: string,
    brushRect: { x0: number; y0: number; x1: number; y1: number } | undefined,
  ): { indices: number[]; linkedIds: string[] } {
    return brushPlotWidgetInHost(this.createSimWidgetsHost(), widgetId, brushRect);
  }

  /** Synchronizes the vertical time crosshair across all pinned Canvas2D plot widgets. */
  public syncPlotCrosshair(time: number | undefined): void {
    syncPlotCrosshairInHost(this.createSimWidgetsHost(), time);
  }

  public getCanvasWidgets(): UnifiedCanvasWidgetSpec[] {
    return Array.from(this.widgets.values());
  }

  public getWidgetPortalLayer(): HTMLElement | null {
    return this.dom?.widgetLayerEl ?? null;
  }

  public getToolsLayer(): SVGGElement | null {
    return this.dom?.toolsG ?? null;
  }

  /** Compiles SCADA / Modelica `ReactiveAnimationBinding`s into zero-GC SoA tables. */
  public compileAnimations(bindings: AnimationBindingSpec[], varIndexMap?: Map<string, number>): void {
    this.animationEngine.compile(bindings, varIndexMap);
  }

  /**
   * Loads a full `Float64Array` simulation trajectory buffer into the shared
   * `SimulationTimelineStore`, re-syncs plot crosshairs, and ticks compiled animations at t0.
   */
  public loadSimulationResult(result: { time: ArrayLike<number>; signals: Record<string, ArrayLike<number>> }): void {
    loadSimulationResultInHost(this.createSimWidgetsHost(), this.simState, result);
  }

  /** Starts 60 FPS lockstep playback across 2D schematic animations, pinned plots, and `"simulation:tick"` subscribers. */
  public playSimulation(speed = 1): void {
    playSimulationInHost(this.createSimWidgetsHost(), this.simState, speed);
  }

  /** Pauses active simulation timeline playback. */
  public pauseSimulation(): void {
    pauseSimulationInHost(this.createSimWidgetsHost(), this.simState);
  }

  /** Seeks the loaded simulation timeline to an exact timestamp, updating animations & plots immediately. */
  public seekSimulation(time: number): void {
    seekSimulationInHost(this.createSimWidgetsHost(), time);
  }

  public isSimulationPlaying(): boolean {
    return this.timelineStore.getState().playing;
  }

  public getSimulationTimeRange(): { start: number; end: number; current: number } | null {
    if (!this.simState.hasLoadedSimulation) return null;
    const st = this.timelineStore.getState();
    return { start: st.startTime, end: st.endTime, current: st.currentTime };
  }

  /** Applies a single zero-GC Float64Array simulation frame across all compiled schematic animations. */
  public tickAnimations(frame: Float64Array, dtSeconds = 1 / 60): number {
    return this.animationEngine.tick(frame, dtSeconds, (upd) => {
      const cell = this.cells.get(upd.targetId);
      if (cell) applyAnimationUpdateToCell(cell, upd);
    });
  }

  /** Creates a 3D / WebXR VR surface bridge bound directly to this graph's `CanvasPointerFSM`. */
  public createSpatialBridge(): SpatialSurfaceBridge {
    const bridge = new SpatialSurfaceBridge();
    bridge.bindFsm("primary", this.fsm);
    return bridge;
  }

  /**
   * Paints the entire visible scene (nodes, orthogonal wires, frozen 3D portal snapshots,
   * pinned plots, tables, KPI stickies) onto any Canvas2D context (for 50,000+ node mode,
   * headless thumbnails, or WebXR VR `CanvasTexture`).
   */
  public paintToCanvas2D(
    ctx: Canvas2DContextLike,
    options: { dark?: boolean | undefined } = {},
  ): { drawnNodes: number; drawnEdges: number; drawnWidgets: number; drawnFrozenPortals: number } {
    return paintSceneToCanvas2D(ctx, this.createPaintContext(), options);
  }

  // ── Internal DOM Synchronization & Context Builders ──

  private createCellStoreHost(): CellStoreHost<UnifiedGraph> {
    return {
      graph: this,
      scene: this.scene,
      fsm: this.fsm,
      portal3DManager: this.portal3DManager,
      cells: this.cells,
      selectedIds: this.selectedIds,
      widgets: this.widgets,
      getEdgeToolsG: () => this.dom?.edgeToolsG ?? null,
      getGuidesG: () => this.dom?.guidesG ?? null,
      getHoveredCellId: () => this.hoveredCellId,
      setHoveredCellId: (id) => {
        this.hoveredCellId = id;
      },
      getActiveRenderModeInternal: () => this.activeRenderMode,
      evaluateRenderMode: () => this.evaluateRenderMode(),
      rebuildCellDom: (cell) => this.rebuildCellDom(cell),
      scheduleCanvas2DRender: () => this.scheduleCanvas2DRender(),
      syncSelectionBoxesDom: (panOnly) => this.syncSelectionBoxesDom(panOnly),
      registerEmbeddedPortal: (spec) => this.registerEmbeddedPortal(spec),
      registerCanvasWidget: (widget) => this.registerCanvasWidget(widget),
      emit: (event, args) => this.emit(event, args),
    };
  }

  private createSimWidgetsHost(): SimulationWidgetsHost {
    return {
      widgets: this.widgets,
      options: this.options,
      timelineStore: this.timelineStore,
      isDisposed: () => this.disposed,
      renderWidgetCanvasDom: () => this.renderWidgetCanvasDom(),
      scheduleCanvas2DRender: () => this.scheduleCanvas2DRender(),
      tickAnimations: (frame, dt) => this.tickAnimations(frame, dt),
      emit: (event, args) => this.emit(event, args),
    };
  }

  private createPaintContext(): Canvas2DPaintContext {
    return {
      width: this.width,
      height: this.height,
      bgColor: this.bgColor,
      activeRenderMode: this.activeRenderMode,
      camera: this.camera,
      scene: this.scene,
      cells: this.cells,
      widgets: this.widgets,
      portal3DManager: this.portal3DManager,
      snapshotBaker: this.snapshotBaker,
      webGpuRenderer: this.webGpuRenderer,
      getEdges: () => this.getEdges(),
      computeEdgeRenderPath: (edge) => this.computeEdgeRenderPath(edge),
    };
  }

  private createCellDomContext(): CellDomSyncContext<UnifiedGraph> {
    return {
      activeRenderMode: this.activeRenderMode,
      nodesG: this.dom?.nodesG ?? null,
      edgesG: this.dom?.edgesG ?? null,
      defsEl: this.dom?.defsEl ?? null,
      markerCache: this.markerCache,
      selectedIds: this.selectedIds,
      scheduleCanvas2DRender: () => this.scheduleCanvas2DRender(),
      findViewByCell: (cell) => this.findViewByCell(cell),
      computeEdgeRenderPath: (edge) => this.computeEdgeRenderPath(edge),
      syncEdgeToolsDom: (edge) => this.syncEdgeToolsDom(edge),
    };
  }

  private createOverlayDomContext(): OverlayDomContext {
    return {
      rootEl: this.dom?.rootEl ?? null,
      edgeToolsG: this.dom?.edgeToolsG ?? null,
      selectionOverlayEl: this.dom?.selectionOverlayEl ?? null,
      cells: this.cells,
      selectedIds: this.selectedIds,
      camera: this.camera,
      fsm: this.fsm,
      options: this.options,
      coord: this.coord,
      getPlugin: (name) => this.getPlugin(name),
      clientToLocal: (x, y) => this.clientToLocal(x, y),
      emit: (event, args) => this.emit(event, args),
      removeCell: (cellOrId) => this.removeCell(cellOrId),
    };
  }

  private computeEdgeRenderPath(edge: UnifiedCell): EdgeRenderPathResult {
    return computeEdgeRenderPathImpl(
      edge,
      this.scene,
      (c) => this.findViewByCell(c),
      UnifiedGraph.routerRegistry,
      UnifiedGraph.connectorRegistry,
    );
  }

  private evaluateRenderMode(): void {
    const desired = resolveDesiredRenderMode(this.renderModePreference, this.scene.nodeCount, this.highScaleThreshold);
    if (desired === this.activeRenderMode) return;
    this.activeRenderMode = desired;
    if (desired === "canvas2d" && this.preferWebGpu && !this.webGpuInitAttempted) void this.enableWebGpu();
    applyRenderModeToDom({
      desired,
      canvas2DEl: this.dom?.canvas2DEl ?? null,
      webGpuCanvasEl: this.webGpuCanvasEl,
      webGpuReady: this.webGpuRenderer.isReady(),
      nodesG: this.dom?.nodesG ?? null,
      edgesG: this.dom?.edgesG ?? null,
      cells: this.cells,
      scheduleCanvas2DRender: () => this.scheduleCanvas2DRender(),
      rebuildCellDom: (c) => this.rebuildCellDom(c),
    });
  }

  private scheduleCanvas2DRender(): void {
    if (this.activeRenderMode !== "canvas2d" || !this.dom?.canvas2DEl || this.disposed) return;
    if (this.canvas2DRafId !== null) return;
    const render = () => {
      this.canvas2DRafId = null;
      if (this.disposed || !this.dom?.canvas2DEl || this.activeRenderMode !== "canvas2d") return;
      renderCanvas2DFrame(
        this.dom.canvas2DEl,
        this.webGpuCanvasEl,
        this.dom.widgetCanvasEl,
        this.disposed,
        this.createPaintContext(),
      );
    };
    this.canvas2DRafId = typeof requestAnimationFrame === "function" ? requestAnimationFrame(render) : (render(), null);
  }

  private renderWidgetCanvasDom(): void {
    renderWidgetCanvasDom(this.dom?.widgetCanvasEl ?? null, this.disposed, this.createPaintContext());
  }

  private applyViewportTransformDom(panOnly = false): void {
    const s = this.camera.getState();
    this.fsm.setZoom(s.zoom);
    this.fsm.setPortSnapRadius(Math.max(4, Math.min(24, 14 / Math.max(0.05, s.zoom))));
    if (this.dom?.viewportG) {
      this.dom.viewportG.setAttribute("transform", `matrix(${s.zoom},0,0,${s.zoom},${s.tx},${s.ty})`);
    }
    this.syncGridDom(panOnly);
    this.syncSelectionBoxesDom(panOnly);
    this.scheduleCanvas2DRender();
    this.renderWidgetCanvasDom();
  }

  public reorderCellDomByZIndex(cell: UnifiedCell): void {
    reorderCellDomByZIndexImpl(cell, this.dom?.nodesG ?? null, this.dom?.edgesG ?? null);
  }

  public rebuildCellDom(cell: UnifiedCell): void {
    rebuildCellDomImpl(cell, this.createCellDomContext());
  }

  public resizeCellVisualDom(cell: UnifiedCell, prevWidth: number, prevHeight: number): void {
    resizeCellVisualDomImpl(cell, prevWidth, prevHeight, this.scene, this.activeRenderMode);
  }

  public syncCellDom(cell: UnifiedCell): void {
    syncCellDomImpl(cell, this.createCellDomContext());
  }

  public patchCellSelectorDom(cell: UnifiedCell, selector: string, key: string, val: unknown): void {
    patchCellSelectorDomImpl(cell, selector, key, val, this.activeRenderMode, () => this.scheduleCanvas2DRender());
  }

  public syncEdgeToolsDom(edge: UnifiedCell): void {
    syncEdgeToolsDomImpl(edge, this.createOverlayDomContext());
  }

  private refreshConnectedEdges(node: UnifiedCell): void {
    for (const edge of this.getConnectedEdges(node)) this.syncCellDom(edge);
  }

  private syncSelectionBoxesDom(panOnly = false): void {
    syncSelectionBoxesDomImpl(this.createOverlayDomContext(), panOnly);
  }
}

export { UnifiedCell as UnifiedEdge, UnifiedCell as UnifiedNode };
