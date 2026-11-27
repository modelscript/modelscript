// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CanvasCommandBus,
  createCanonicalPolyglotDemoBoard,
  paintCanvasPlot,
  propagateParameterEdit,
  renderPolyglotTileContent,
  SpatialCanvas,
  TileAdapterRegistry,
  UnifiedGraph,
  type Canvas2DContextLike,
  type CanvasCommentThread,
  type CanvasDocument,
  type CanvasTile,
  type CanvasWire,
  type PlotSeriesData,
  type SurfacePresentationMode,
  type TileLodTier,
} from "@modelscript/canvas";
import type { EngineeringRotundaProps, RotundaEnvironmentId } from "@modelscript/rotunda/types.js";
import React, { Component, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

const LazyEngineeringRotunda = React.lazy(async () => {
  const mod = (await import("@modelscript/rotunda/EngineeringRotunda.js")) as {
    default?: React.ComponentType<EngineeringRotundaProps>;
    EngineeringRotunda?: React.ComponentType<EngineeringRotundaProps>;
  };
  const LoadedComponent = mod.EngineeringRotunda ?? mod.default;
  if (!LoadedComponent) {
    throw new Error("EngineeringRotunda export not found.");
  }
  return { default: LoadedComponent };
});

interface RotundaErrorBoundaryProps {
  children: React.ReactNode;
  onExitTo2D: () => void;
  onOpenExternalVr: () => void;
}

interface RotundaErrorBoundaryState {
  hasError: boolean;
  message?: string;
}

class RotundaErrorBoundary extends Component<RotundaErrorBoundaryProps, RotundaErrorBoundaryState> {
  constructor(props: RotundaErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: unknown): RotundaErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[CanvasWebview] 3D Engineering Rotunda failed to render:", error, info);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            width: "100vw",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            background: "#050914",
            color: "#e2e8f0",
            fontFamily: "system-ui, -apple-system, sans-serif",
            padding: 24,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc" }}>3D Engineering Rotunda Unavailable</div>
          <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 460 }}>
            {this.state.message ?? "WebGL or the 3D spatial workspace could not initialize inside this webview."}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={this.props.onOpenExternalVr}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              🥽 Open in VR Headset ↗
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false });
                this.props.onExitTo2D();
              }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #334155",
                background: "#1e293b",
                color: "#f8fafc",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              ← Return to 2D Canvas
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi: VsCodeApi =
  typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : { postMessage: () => undefined };

const ideRegistry = new TileAdapterRegistry();

function IdeUnifiedSchematicCanvas({ tile }: { tile: CanvasTile }): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const cssW = 360;
    const cssH = 165;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const graph = new UnifiedGraph({ width: cssW, height: cssH, renderMode: "canvas2d" });
    const rawDiagram = tile.viewState?.["diagramData"] as
      { nodes?: Record<string, unknown>[]; edges?: Record<string, unknown>[] } | undefined;

    if (rawDiagram && Array.isArray(rawDiagram.nodes) && rawDiagram.nodes.length > 0) {
      graph.fromJSON({ nodes: rawDiagram.nodes, edges: rawDiagram.edges ?? [] });
    } else {
      const accent = tile.archetype === "fmu" ? "#10b981" : "#38bdf8";
      graph.addNode({
        id: "in_blk",
        x: 20,
        y: 52,
        width: 82,
        height: 54,
        attrs: {
          body: { fill: "#1e293b", stroke: accent, strokeWidth: 1.5, rx: 6 },
          label: { text: tile.languageId === "simulink" ? "PID Gain" : "Input", fill: "#f8fafc", fontSize: 11 },
        },
        ports: { items: [{ id: "out", args: { x: 82, y: 27 } }] },
      });
      graph.addNode({
        id: "core_blk",
        x: 138,
        y: 40,
        width: 100,
        height: 78,
        attrs: {
          body: { fill: "#0f172a", stroke: "#38bdf8", strokeWidth: 1.8, rx: 6 },
          label: { text: tile.targetSymbol ?? tile.title.slice(0, 14), fill: "#f8fafc", fontSize: 11 },
        },
        ports: {
          items: [
            { id: "in", args: { x: 0, y: 39 } },
            { id: "out", args: { x: 100, y: 39 } },
          ],
        },
      });
      graph.addNode({
        id: "out_blk",
        x: 272,
        y: 52,
        width: 72,
        height: 54,
        attrs: {
          body: { fill: "#1e293b", stroke: "#10b981", strokeWidth: 1.5, rx: 6 },
          label: { text: "Output", fill: "#f8fafc", fontSize: 11 },
        },
        ports: { items: [{ id: "in", args: { x: 0, y: 27 } }] },
      });
      graph.addEdge({
        id: "e1",
        source: { cell: "in_blk", port: "out" },
        target: { cell: "core_blk", port: "in" },
        attrs: { line: { stroke: accent, strokeWidth: 1.8 } },
      });
      graph.addEdge({
        id: "e2",
        source: { cell: "core_blk", port: "out" },
        target: { cell: "out_blk", port: "in" },
        attrs: { line: { stroke: "#10b981", strokeWidth: 1.8 } },
      });
    }

    graph.zoomToFit({ padding: 14, maxScale: 1.1 });
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#090f1d";
    ctx.fillRect(0, 0, cssW, cssH);
    graph.paintToCanvas2D(ctx as unknown as Canvas2DContextLike, { dark: true });
    ctx.restore();
    graph.dispose();
  }, [tile]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={`ide-unified-schematic-${tile.id}`}
      style={{ width: "100%", height: 165, display: "block", borderRadius: 6 }}
    />
  );
}

function IdeCanvasPlotCanvas({
  tile,
  lod,
  simulationTime,
  onTimeScrub,
}: {
  tile: CanvasTile;
  lod: TileLodTier;
  simulationTime: number;
  onTimeScrub: (t: number) => void;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    const cssW = 356;
    const cssH = 175;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const providedSeries = tile.viewState?.["simulationSeries"] as PlotSeriesData[] | undefined;
    let series: PlotSeriesData[];
    if (Array.isArray(providedSeries) && providedSeries.length > 0) {
      series = providedSeries;
    } else {
      const xs = new Float64Array(400);
      const ys = new Float64Array(400);
      for (let i = 0; i < 400; i++) {
        const t = (i / 399) * 10;
        xs[i] = t;
        ys[i] = 342 + 12 * Math.sin(t * 0.9) + 3 * Math.cos(t * 2.5);
      }
      series = [{ id: "T_max", label: "T_max (K)", color: "#14b8a6", unit: "K", x: xs, y: ys }];
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    paintCanvasPlot(
      ctx as unknown as Canvas2DContextLike,
      {
        id: tile.id,
        title: tile.title,
        kind: "timeseries",
        series,
        thresholds: [{ label: "360 K", axis: "y", value: 360, direction: "above-fail" }],
        crosshairX: simulationTime,
        dark: true,
        lod,
      },
      0,
      0,
      cssW,
      cssH,
    );
    ctx.restore();
  }, [tile, lod, simulationTime]);

  return (
    <canvas
      ref={canvasRef}
      data-testid={`ide-canvas-plot-${tile.id}`}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left - 42) / Math.max(1, rect.width - 54)));
        onTimeScrub(Number((frac * 10).toFixed(2)));
      }}
      style={{ width: "100%", height: 175, display: "block", borderRadius: 6, cursor: "crosshair" }}
    />
  );
}

function CanvasWebviewApp(): React.ReactElement {
  const [bus, setBus] = useState<CanvasCommandBus>(() => new CanvasCommandBus(createCanonicalPolyglotDemoBoard()));
  const [doc, setDoc] = useState<CanvasDocument>(() => bus.getDocument());
  const [surfaceMode, setSurfaceMode] = useState<SurfacePresentationMode>("desktop-2d");
  const [vrEnvironment, setVrEnvironment] = useState<RotundaEnvironmentId>("dark-lab");
  const [simulationTime, setSimulationTime] = useState<number>(0);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth || 1200,
    height: window.innerHeight || 800,
  }));
  const docRef = useRef<CanvasDocument>(doc);
  docRef.current = doc;

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);

    const onMessage = (event: MessageEvent<Record<string, unknown>>) => {
      const msg = event.data;
      if (msg?.["type"] === "loadDocument" && msg["document"]) {
        const nextBus = new CanvasCommandBus(msg["document"] as CanvasDocument);
        setBus(nextBus);
        setDoc(nextBus.getDocument());
      } else if (msg?.["type"] === "simulationTime" && typeof msg["time"] === "number") {
        setSimulationTime(msg["time"]);
      } else if (msg?.["type"] === "surfaceMode" && typeof msg["mode"] === "string") {
        setSurfaceMode(msg["mode"] as SurfacePresentationMode);
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  // VS Code webviews run in double-nested sandboxed iframes that block WebXR.
  // Automatically hand off `webxr-vr` to a top-level browser tab while keeping inline 3D Rotunda active.
  useEffect(() => {
    if (surfaceMode === "webxr-vr") {
      vscodeApi.postMessage({
        type: "openInVr",
        environment: "dark-lab",
        title: docRef.current.name,
        document: docRef.current,
      });
    }
  }, [surfaceMode]);

  const persist = useCallback((nextDoc: CanvasDocument) => {
    setDoc(nextDoc);
    vscodeApi.postMessage({ type: "saveDocument", document: nextDoc });
  }, []);

  const handleTileMove = useCallback(
    (tileId: string, x: number, y: number) => {
      const next = bus.execute({ type: "moveTiles", moves: { [tileId]: { x, y } } });
      persist(next);
    },
    [bus, persist],
  );

  const handleTileResize = useCallback(
    (tileId: string, width: number, height: number) => {
      const tile = bus.getDocument().tiles[tileId];
      if (!tile) return;
      const next = bus.execute({
        type: "resizeTile",
        tileId,
        bounds: { x: tile.bounds.x, y: tile.bounds.y, width, height },
      });
      persist(next);
    },
    [bus, persist],
  );

  const handleTileDrop = useCallback(
    (tile: CanvasTile) => {
      const next = bus.execute({ type: "upsertTile", tile });
      persist(next);
    },
    [bus, persist],
  );

  const handleWireCreate = useCallback(
    (wire: CanvasWire) => {
      const next = bus.execute({ type: "upsertWire", wire });
      persist(next);
    },
    [bus, persist],
  );

  const handleCreateSpatialWire = useCallback(
    (sourceTileId: string, targetTileId: string, sourceAnchor = "CADPort") => {
      const currentDoc = bus.getDocument();
      const sourceTile = currentDoc.tiles[sourceTileId];
      const targetTile = currentDoc.tiles[targetTileId];
      if (!sourceTile || !targetTile) return;
      const targetAnchor =
        targetTile.pinnedAnchors?.find((a) => a.kind === "fmi-input" || a.kind === "parameter") ??
        targetTile.pinnedAnchors?.[0];
      const kind: CanvasWire["kind"] =
        targetTile.archetype === "table" || targetAnchor?.kind === "requirement"
          ? "requirement-trace"
          : targetAnchor?.kind === "fmi-input" || targetAnchor?.kind === "fmi-output" || targetTile.archetype === "fmu"
            ? "fmi-signal"
            : "shared-parameter";
      const wire: CanvasWire = {
        id: `wire_spatial_${sourceTileId}_${targetTileId}_${Date.now()}`,
        kind,
        source: { tileId: sourceTileId, anchorPath: sourceAnchor },
        target: { tileId: targetTileId, anchorPath: targetAnchor?.path ?? "in" },
        origin: "user-authored",
        status: "synced",
        liveValue: sourceTile.pinnedAnchors?.[0]?.currentValue ?? "3D CADPort",
      };
      const next = bus.execute({ type: "upsertWire", wire });
      persist(next);
    },
    [bus, persist],
  );

  const handleParameterEdit = useCallback(
    (tileId: string, anchorPath: string, numericValue: number) => {
      const result = propagateParameterEdit(bus.getDocument(), {
        tileId,
        anchorPath,
        numericValue,
        autoSync: true,
      });
      const nextBus = new CanvasCommandBus(result.document);
      setBus(nextBus);
      persist(result.document);
    },
    [bus, persist],
  );

  const handleCommentCreate = useCallback(
    (comment: CanvasCommentThread) => {
      const next = bus.execute({ type: "upsertComment", comment });
      persist(next);
    },
    [bus, persist],
  );

  const handleTileFocus = useCallback((tile: CanvasTile) => {
    vscodeApi.postMessage({ type: "openArtifact", artifactUri: tile.artifactUri });
  }, []);

  const handleExportSsp = useCallback(() => {
    vscodeApi.postMessage({ type: "exportSsp" });
  }, []);

  const handleExitTo2D = useCallback(() => {
    setSurfaceMode("desktop-2d");
    vscodeApi.postMessage({ type: "surfaceModeChanged", mode: "desktop-2d" });
  }, []);

  const handleOpenExternalVr = useCallback(
    (opts?: { environment?: RotundaEnvironmentId; activeModelIndex?: number }) => {
      const env = opts?.environment ?? vrEnvironment;
      setVrEnvironment(env);
      vscodeApi.postMessage({
        type: "openInVr",
        environment: env,
        activeModelIndex: opts?.activeModelIndex,
        title: docRef.current.name,
        document: docRef.current,
      });
    },
    [vrEnvironment],
  );

  const renderIdeTileContent = useCallback(
    (tile: CanvasTile, lod: TileLodTier, isWebGlLive: boolean): React.ReactNode => {
      if ((tile.archetype === "schematic" || tile.archetype === "fmu") && (lod === "interactive" || lod === "focus")) {
        return <IdeUnifiedSchematicCanvas tile={tile} />;
      }
      if (tile.archetype === "analytics" && (lod === "interactive" || lod === "focus")) {
        return (
          <IdeCanvasPlotCanvas tile={tile} lod={lod} simulationTime={simulationTime} onTimeScrub={setSimulationTime} />
        );
      }
      const descriptor = ideRegistry.resolveDescriptor(tile.languageId, tile.artifactUri);
      return renderPolyglotTileContent({ tile, lod, descriptor, isWebGlLive });
    },
    [simulationTime],
  );

  if (surfaceMode === "spatial-3d" || surfaceMode === "webxr-vr") {
    return (
      <div
        style={{
          position: "relative",
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          background: "#050914",
        }}
      >
        {surfaceMode === "webxr-vr" && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 60,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              borderRadius: 10,
              background: "rgba(15, 23, 42, 0.92)",
              border: "1px solid rgba(56, 189, 248, 0.45)",
              color: "#e2e8f0",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: 12,
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
              backdropFilter: "blur(10px)",
              maxWidth: "92vw",
              flexWrap: "wrap",
            }}
          >
            <span>🥽 WebXR VR session handed off to external browser tab (sandboxed VS Code webview).</span>
            <button
              type="button"
              onClick={() => handleOpenExternalVr({ environment: vrEnvironment })}
              style={{
                padding: "5px 11px",
                borderRadius: 6,
                border: "none",
                background: "linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Re-open in VR Headset ↗
            </button>
            <button
              type="button"
              onClick={() => setSurfaceMode("spatial-3d")}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                border: "1px solid #334155",
                background: "#1e293b",
                color: "#cbd5e1",
                fontWeight: 500,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        )}

        <RotundaErrorBoundary
          onExitTo2D={handleExitTo2D}
          onOpenExternalVr={() => handleOpenExternalVr({ environment: vrEnvironment })}
        >
          <Suspense
            fallback={
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  color: "#cbd5e1",
                  fontFamily: "system-ui, -apple-system, sans-serif",
                  fontSize: 14,
                }}
              >
                <div>Loading 3D Engineering Rotunda…</div>
                <button
                  type="button"
                  onClick={handleExitTo2D}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 6,
                    border: "1px solid #334155",
                    background: "#1e293b",
                    color: "#f8fafc",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ← Back to 2D Canvas
                </button>
              </div>
            }
          >
            <LazyEngineeringRotunda
              document={doc}
              mode="spatial-3d"
              initialEnvironment={vrEnvironment}
              simulationTime={simulationTime}
              onSimulationTimeChange={setSimulationTime}
              onMoveTile={handleTileMove}
              onCreateSpatialWire={handleCreateSpatialWire}
              onExitTo2D={handleExitTo2D}
              onOpenExternalVr={handleOpenExternalVr}
              title={doc.name}
            />
          </Suspense>
        </RotundaErrorBoundary>
      </div>
    );
  }

  return (
    <SpatialCanvas
      document={doc}
      width={viewport.width}
      height={viewport.height}
      surfaceMode={surfaceMode}
      onSurfaceModeChange={(mode) => {
        setSurfaceMode(mode);
        if (mode !== "webxr-vr") {
          vscodeApi.postMessage({ type: "surfaceModeChanged", mode });
        }
      }}
      simulationTime={simulationTime}
      simulationEndTime={10}
      onSimulationTimeChange={setSimulationTime}
      onTileMove={handleTileMove}
      onTileResize={handleTileResize}
      onTileDrop={handleTileDrop}
      onWireCreate={handleWireCreate}
      onParameterEdit={handleParameterEdit}
      onCommentCreate={handleCommentCreate}
      onTileFocus={handleTileFocus}
      onExportSsp={handleExportSsp}
      renderTileContent={renderIdeTileContent}
    />
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<CanvasWebviewApp />);
}
