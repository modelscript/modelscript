// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { CanvasPeerPresence } from "../collab/crdt-store.js";
import { computeSnapAndGuides, type AlignmentGuideLine } from "../core/alignment-guides.js";
import { CameraController, type CameraState } from "../core/camera.js";
import { resolveTileLodTier, WebGlContextBudget } from "../core/lod-scheduler.js";
import { CanvasSpatialIndex } from "../core/spatial-index.js";
import { Scissor3DPortalManager } from "../renderers/scissor-3d-manager.js";
import type { SurfacePresentationMode } from "../renderers/spatial-vr-bridge.js";
import type {
  CanvasCommentThread,
  CanvasDocument,
  CanvasLensId,
  CanvasTile,
  CanvasWire,
  TileAnchorSpec,
  TileLodTier,
} from "../schema/canvas-document.js";
import { resolveAnchorWorldPoint } from "../threads/anchor-projector.js";
import { computeCanvasBlastRadius, routeCanvasWire, validateFmiWire } from "../threads/wire-router.js";
import { POLYGLOT_LANGUAGE_CATALOG, TileAdapterRegistry } from "../tiles/registry.js";
import { renderPolyglotTileContent } from "./TileRenderers.js";

export interface SpatialCanvasProps {
  document: CanvasDocument;
  peers?: CanvasPeerPresence[] | undefined;
  registry?: TileAdapterRegistry | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** Initial or controlled surface mode: Desktop 2D, 3D Spatial workbench, or WebXR VR. */
  surfaceMode?: SurfacePresentationMode | undefined;
  onSurfaceModeChange?: ((mode: SurfacePresentationMode) => void) | undefined;
  /** Synchronized simulation timeline position (seconds) shared across schematics, plots, and 3D CAD/FEA. */
  simulationTime?: number | undefined;
  simulationEndTime?: number | undefined;
  onSimulationTimeChange?: ((time: number) => void) | undefined;
  onTileMove?: ((tileId: string, x: number, y: number) => void) | undefined;
  onTileResize?: ((tileId: string, width: number, height: number) => void) | undefined;
  onTileDrop?: ((tile: CanvasTile) => void) | undefined;
  onTileFocus?: ((tile: CanvasTile) => void) | undefined;
  onWireCreate?: ((wire: CanvasWire) => void) | undefined;
  onWireClick?: ((wire: CanvasWire) => void) | undefined;
  onParameterEdit?: ((tileId: string, anchorPath: string, numericValue: number) => void) | undefined;
  onCommentCreate?: ((comment: CanvasCommentThread) => void) | undefined;
  onExportSsp?: ((doc: CanvasDocument) => void) | undefined;
  renderTileContent?: ((tile: CanvasTile, lod: TileLodTier, isWebGlLive: boolean) => React.ReactNode) | undefined;
}

const WIRE_COLORS: Record<CanvasWire["kind"], string> = {
  "fmi-signal": "#10b981",
  "shared-parameter": "#38bdf8",
  "requirement-trace": "#a855f7",
  "annotation-link": "#94a3b8",
};

/**
 * Unified Polyglot Infinite Spatial & Schematic Canvas React Host Component.
 *
 * Implements the 4-layer hybrid compositor:
 * 0. Infinite world grid + grouping frames + smart alignment snap guides
 * 1. Shared single-context scissor-rendered 3D CAD/FEA/CFD portal scheduler
 * 2. Frustum-culled CSS-3D virtualized tile host with 4-tier semantic LOD & focus capture
 * 3. Vector overlay for live Digital Thread ribbons, animated FMI signal pipes, blast-radius spotlight, comments & peer cursors
 * Supports seamless toggling across Desktop 2D, 3D Spatial, and WebXR VR surfaces.
 */
export function SpatialCanvas(props: SpatialCanvasProps): React.ReactElement {
  const {
    document: doc,
    peers = [],
    width = 1280,
    height = 800,
    surfaceMode: controlledSurfaceMode,
    onSurfaceModeChange,
    simulationTime: controlledSimTime,
    simulationEndTime = 10,
    onSimulationTimeChange,
    onTileMove,
    onTileResize,
    onTileDrop,
    onTileFocus,
    onWireCreate,
    onWireClick,
    onParameterEdit,
    onCommentCreate,
    onExportSsp,
    renderTileContent,
  } = props;

  const registry = useMemo(() => props.registry ?? new TileAdapterRegistry(), [props.registry]);
  const cameraRef = useRef<CameraController | null>(null);
  if (!cameraRef.current) {
    cameraRef.current = new CameraController({ initial: { tx: 24, ty: 24, zoom: 0.68 } });
  }
  const webglBudgetRef = useRef(new WebGlContextBudget(4));
  const scissor3DRef = useRef<Scissor3DPortalManager | null>(null);
  if (!scissor3DRef.current) {
    scissor3DRef.current = new Scissor3DPortalManager();
  }

  const [camera, setCamera] = useState<CameraState>(() => cameraRef.current!.getState());
  const [internalSurfaceMode, setInternalSurfaceMode] = useState<SurfacePresentationMode>(
    controlledSurfaceMode ?? "desktop-2d",
  );
  const surfaceMode = controlledSurfaceMode ?? internalSurfaceMode;
  const [internalSimTime, setInternalSimTime] = useState<number>(controlledSimTime ?? 0);
  const simTime = controlledSimTime ?? internalSimTime;
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [focusedTileId, setFocusedTileId] = useState<string | null>(null);
  const [blastRootTileId, setBlastRootTileId] = useState<string | null>(null);
  const [cosimRunning, setCosimRunning] = useState(false);
  const [commentMode, setCommentMode] = useState(false);
  const [activeGuides, setActiveGuides] = useState<AlignmentGuideLine[]>([]);
  const [paramEditor, setParamEditor] = useState<{
    tileId: string;
    anchor: TileAnchorSpec;
    valueText: string;
  } | null>(null);
  const [wiringSource, setWiringSource] = useState<{
    tileId: string;
    anchor: TileAnchorSpec;
  } | null>(null);
  const [wireToast, setWireToast] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [activeLenses, setActiveLenses] = useState<Set<CanvasLensId>>(() => new Set(doc.metadata.defaultLenses));
  const [dragState, setDragState] = useState<
    | { mode: "pan"; startX: number; startY: number }
    | { mode: "tile"; tileId: string; startWorldX: number; startWorldY: number; origX: number; origY: number }
    | { mode: "resize"; tileId: string; startWorldX: number; startWorldY: number; origW: number; origH: number }
    | null
  >(null);

  const spatialIndex = useMemo(() => {
    const idx = new CanvasSpatialIndex<CanvasTile>(512);
    idx.rebuild(Object.values(doc.tiles));
    return idx;
  }, [doc.tiles]);

  const visibleWorldBounds = useMemo(() => {
    const cam = cameraRef.current!;
    cam.setState(camera);
    return cam.getVisibleWorldBounds({ width, height }, 240);
  }, [camera, width, height]);

  const visibleTiles = useMemo(() => spatialIndex.queryRect(visibleWorldBounds), [spatialIndex, visibleWorldBounds]);

  const blastRadius = useMemo(
    () => (blastRootTileId ? computeCanvasBlastRadius(doc, blastRootTileId) : null),
    [doc, blastRootTileId],
  );

  const toggleLens = useCallback((lens: CanvasLensId) => {
    setActiveLenses((prev) => {
      const next = new Set(prev);
      if (next.has(lens)) next.delete(lens);
      else next.add(lens);
      return next;
    });
  }, []);

  const handleFitAll = useCallback(() => {
    const total = spatialIndex.getTotalBounds();
    if (!total) return;
    const next = cameraRef.current!.fitBounds(total, { width, height }, 64);
    setCamera(next);
  }, [spatialIndex, width, height]);

  const handleAnchorClick = useCallback(
    (tileId: string, anchor: TileAnchorSpec) => {
      if (!wiringSource && onParameterEdit && (anchor.kind === "parameter" || anchor.kind === "cad-feature")) {
        const numericMatch = /-?\d+(?:\.\d+)?/.exec(anchor.currentValue ?? "");
        if (numericMatch) {
          setParamEditor({ tileId, anchor, valueText: numericMatch[0] });
        }
      }

      if (!wiringSource) {
        setWiringSource({ tileId, anchor });
        setWireToast(`Wiring from ${anchor.label} — click a target anchor on another tile`);
        return;
      }
      if (wiringSource.tileId === tileId) {
        setWiringSource(null);
        setWireToast(null);
        return;
      }

      const isFmi =
        wiringSource.anchor.kind === "fmi-output" ||
        wiringSource.anchor.kind === "fmi-input" ||
        anchor.kind === "fmi-input" ||
        anchor.kind === "fmi-output";

      const validation = isFmi ? validateFmiWire(wiringSource.anchor, anchor) : null;
      if (validation && !validation.valid) {
        setWireToast(validation.errors[0] ?? "Invalid FMI connection");
        setWiringSource(null);
        return;
      }

      const wire: CanvasWire = {
        id: `wire_${Date.now()}`,
        kind: isFmi
          ? "fmi-signal"
          : anchor.kind === "requirement" || wiringSource.anchor.kind === "requirement"
            ? "requirement-trace"
            : "shared-parameter",
        source: { tileId: wiringSource.tileId, anchorPath: wiringSource.anchor.path },
        target: { tileId, anchorPath: anchor.path },
        origin: "user-authored",
        status: validation ? validation.status : "synced",
        transformExpr: validation?.suggestedTransformExpr,
        liveValue: wiringSource.anchor.currentValue ?? anchor.currentValue,
      };
      onWireCreate?.(wire);
      setWireToast(validation?.warnings[0] ?? `Connected ${wiringSource.anchor.label} → ${anchor.label}`);
      setWiringSource(null);
      setParamEditor(null);
    },
    [wiringSource, onWireCreate, onParameterEdit],
  );

  const handleQuickDropLanguage = useCallback(
    (languageId: string, ext: string) => {
      const center = cameraRef.current!.screenToWorld({ x: width / 2, y: height / 2 });
      const tile = registry.createTileForDrop({
        id: `tile_${languageId}_${Date.now()}`,
        artifactUri: `workspace/${languageId}_artifact${ext || ".txt"}`,
        languageId,
        x: Math.round(center.x - 200),
        y: Math.round(center.y - 150),
        zIndex: Object.keys(doc.tiles).length + 1,
      });
      onTileDrop?.(tile);
      setPaletteOpen(false);
    },
    [registry, width, height, doc.tiles, onTileDrop],
  );

  const handleOsFileDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!onTileDrop || !e.dataTransfer?.files?.length) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const baseWorld = cameraRef.current!.screenToWorld({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      Array.from(e.dataTransfer.files).forEach((file, idx) => {
        const tile = registry.createTileForDrop({
          id: `tile_drop_${Date.now()}_${idx}`,
          artifactUri: file.name,
          x: Math.round(baseWorld.x + idx * 36),
          y: Math.round(baseWorld.y + idx * 36),
          zIndex: Object.keys(doc.tiles).length + idx + 1,
        });
        onTileDrop(tile);
      });
    },
    [onTileDrop, registry, doc.tiles],
  );

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const focal = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const next = cameraRef.current!.zoomByWheelDelta(e.deltaY, focal);
    setCamera(next);
  }, []);

  const handlePointerDownBackground = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.button !== 1) return;
      if (commentMode && onCommentCreate) {
        const rect = e.currentTarget.getBoundingClientRect();
        const worldPt = cameraRef.current!.screenToWorld({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        onCommentCreate({
          id: `comment_${Date.now()}`,
          authorId: "local",
          authorName: "Engineer",
          text: "Review note pinned on board",
          createdAt: new Date().toISOString(),
          resolved: false,
          position: { x: Math.round(worldPt.x), y: Math.round(worldPt.y) },
          replies: [],
        });
        setCommentMode(false);
        return;
      }
      setSelectedTileId(null);
      setFocusedTileId(null);
      setWiringSource(null);
      setParamEditor(null);
      setDragState({ mode: "pan", startX: e.clientX, startY: e.clientY });
    },
    [commentMode, onCommentCreate],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragState) return;
      if (dragState.mode === "pan") {
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        setDragState({ mode: "pan", startX: e.clientX, startY: e.clientY });
        setCamera(cameraRef.current!.panByScreenDelta(dx, dy));
      } else if (dragState.mode === "tile") {
        const rect = e.currentTarget.getBoundingClientRect();
        const worldPt = cameraRef.current!.screenToWorld({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        const rawX = dragState.origX + (worldPt.x - dragState.startWorldX);
        const rawY = dragState.origY + (worldPt.y - dragState.startWorldY);
        const tile = doc.tiles[dragState.tileId];
        if (tile) {
          const others = Object.values(doc.tiles).filter((t) => t.id !== tile.id);
          const snapped = computeSnapAndGuides(
            { x: rawX, y: rawY, width: tile.bounds.width, height: tile.bounds.height },
            others,
            10,
          );
          setActiveGuides(snapped.guides);
          onTileMove?.(dragState.tileId, snapped.x, snapped.y);
        } else {
          onTileMove?.(dragState.tileId, Math.round(rawX), Math.round(rawY));
        }
      } else if (dragState.mode === "resize") {
        const rect = e.currentTarget.getBoundingClientRect();
        const worldPt = cameraRef.current!.screenToWorld({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        const nw = Math.max(220, Math.round(dragState.origW + (worldPt.x - dragState.startWorldX)));
        const nh = Math.max(160, Math.round(dragState.origH + (worldPt.y - dragState.startWorldY)));
        onTileResize?.(dragState.tileId, nw, nh);
      }
    },
    [dragState, doc.tiles, onTileMove, onTileResize],
  );

  const handlePointerUp = useCallback(() => {
    setDragState(null);
    setActiveGuides([]);
  }, []);

  const visibleWires = useMemo(() => {
    return Object.values(doc.wires).filter((w) => {
      if (w.kind === "fmi-signal" && !activeLenses.has("fmi-signals")) return false;
      if (w.kind === "shared-parameter" && !activeLenses.has("shared-parameters")) return false;
      if (w.kind === "requirement-trace" && !activeLenses.has("requirements")) return false;
      return Boolean(doc.tiles[w.source.tileId] && doc.tiles[w.target.tileId]);
    });
  }, [doc.wires, doc.tiles, activeLenses]);

  const filteredCatalog = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase();
    if (!q) return POLYGLOT_LANGUAGE_CATALOG.slice(0, 24);
    return POLYGLOT_LANGUAGE_CATALOG.filter(
      (l) =>
        l.languageId.toLowerCase().includes(q) ||
        l.label.toLowerCase().includes(q) ||
        l.archetype.includes(q) ||
        l.extensions.some((ext) => ext.includes(q)),
    ).slice(0, 24);
  }, [paletteQuery]);

  const totalBounds = useMemo(() => spatialIndex.getTotalBounds(), [spatialIndex]);

  // Register all 3D CAD/FEA/CFD tiles onto the single shared scissor WebGL manager
  const scissorRects = useMemo(() => {
    const mgr = scissor3DRef.current!;
    for (const tile of visibleTiles) {
      if (tile.archetype === "cad3d") {
        mgr.registerPortal({
          id: tile.id,
          kind: tile.languageId === "fea" ? "fea" : tile.languageId === "cfd" ? "cfd" : "cad",
          artifactUri: tile.artifactUri,
          bounds: tile.bounds,
          isAnimating: cosimRunning,
        });
      }
    }
    mgr.setFocusedPortal(focusedTileId);
    return mgr.computeFrameScissorRects(cameraRef.current!, { width, height });
  }, [visibleTiles, focusedTileId, cosimRunning, width, height]);

  // Recursive semantic zoom: smoothly descend into a schematic/FMU sub-scene when focused or deeply zoomed (>= 1.65x)
  const activeSubSceneTile = useMemo(() => {
    if (focusedTileId) {
      const focused = doc.tiles[focusedTileId];
      if (focused && (focused.archetype === "schematic" || focused.archetype === "fmu")) {
        return focused;
      }
    }
    if (camera.zoom >= 1.65) {
      const centerWorld = cameraRef.current!.screenToWorld({ x: width / 2, y: height / 2 });
      const centered = visibleTiles.find(
        (t) =>
          (t.archetype === "schematic" || t.archetype === "fmu") &&
          centerWorld.x >= t.bounds.x &&
          centerWorld.x <= t.bounds.x + t.bounds.width &&
          centerWorld.y >= t.bounds.y &&
          centerWorld.y <= t.bounds.y + t.bounds.height,
      );
      if (centered) return centered;
    }
    return null;
  }, [focusedTileId, doc.tiles, camera.zoom, visibleTiles, width, height]);

  const handleExitSubScene = useCallback(() => {
    setFocusedTileId(null);
    handleFitAll();
  }, [handleFitAll]);

  const worldTransform =
    surfaceMode === "desktop-2d"
      ? `translate3d(${camera.tx}px, ${camera.ty}px, 0) scale(${camera.zoom})`
      : `perspective(1200px) rotateX(18deg) translate3d(${camera.tx}px, ${camera.ty}px, 0) scale(${camera.zoom})`;

  return (
    <div
      data-testid="polyglot-spatial-canvas"
      data-surface-mode={surfaceMode}
      data-shared-webgl-contexts={scissor3DRef.current!.sharedWebGlContextCount}
      data-active-3d-portals={scissorRects.length}
      data-semantic-subscene={activeSubSceneTile?.id ?? ""}
      onWheel={handleWheel}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleOsFileDrop}
      onPointerDown={handlePointerDownBackground}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        backgroundColor: "#0b1120",
        backgroundImage: "radial-gradient(#1e293b 1px, transparent 1px)",
        backgroundSize: `${Math.max(12, 24 * camera.zoom)}px ${Math.max(12, 24 * camera.zoom)}px`,
        backgroundPosition: `${camera.tx}px ${camera.ty}px`,
        color: "#e2e8f0",
        fontFamily: "system-ui, -apple-system, sans-serif",
        userSelect: "none",
        cursor: commentMode ? "crosshair" : "default",
      }}
    >
      {/* Layer 1 & 2: GPU-composited world plane (Frames + Virtualized Polyglot Tiles + Shared Scissor 3D Host) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: "0 0",
          transform: worldTransform,
          transition: "transform 160ms ease-out",
        }}
      >
        {Object.values(doc.frames).map((frame) => (
          <div
            key={frame.id}
            style={{
              position: "absolute",
              left: frame.bounds.x,
              top: frame.bounds.y,
              width: frame.bounds.width,
              height: frame.bounds.height,
              border: `1.5px dashed ${frame.color}`,
              borderRadius: 12,
              backgroundColor: `${frame.color}22`,
              pointerEvents: "none",
            }}
          >
            <div style={{ padding: "6px 12px", fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{frame.title}</div>
          </div>
        ))}

        {visibleTiles.map((tile) => {
          const lod = resolveTileLodTier(tile, camera.zoom, { focusedTileId });
          const desc = registry.resolveDescriptor(tile.languageId, tile.artifactUri);
          const isSelected = selectedTileId === tile.id;
          const isFocused = focusedTileId === tile.id;
          const isWebGlLive =
            tile.archetype === "cad3d" && (isFocused || isSelected || webglBudgetRef.current.isLive(tile.id));
          const dimmed = blastRadius !== null && blastRadius.tileDistances[tile.id] === undefined;
          const hopDistance = blastRadius?.tileDistances[tile.id];

          return (
            <div
              key={tile.id}
              data-tile-id={tile.id}
              data-lod={lod}
              onPointerDown={(e) => {
                e.stopPropagation();
                setSelectedTileId(tile.id);
                if (tile.archetype === "cad3d") {
                  webglBudgetRef.current.acquire(tile.id);
                }
                const rect = e.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
                if (rect && !tile.locked) {
                  const worldPt = cameraRef.current!.screenToWorld({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                  setDragState({
                    mode: "tile",
                    tileId: tile.id,
                    startWorldX: worldPt.x,
                    startWorldY: worldPt.y,
                    origX: tile.bounds.x,
                    origY: tile.bounds.y,
                  });
                }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setFocusedTileId(tile.id);
                onTileFocus?.(tile);
              }}
              style={{
                position: "absolute",
                left: tile.bounds.x,
                top: tile.bounds.y,
                width: tile.bounds.width,
                height: tile.bounds.height,
                borderRadius: 10,
                backgroundColor: "#111827",
                border:
                  tile.health === "error"
                    ? "2px solid #ef4444"
                    : isSelected
                      ? `2px solid ${desc.accentColor}`
                      : "1px solid #334155",
                boxShadow: isFocused ? `0 0 0 3px ${desc.accentColor}55` : "0 8px 24px rgba(0,0,0,0.4)",
                opacity: dimmed ? 0.25 : 1,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                cursor: tile.locked ? "default" : "grab",
              }}
            >
              <div
                style={{
                  height: 36,
                  padding: "0 10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "#1e293b",
                  borderBottom: `2px solid ${desc.accentColor}`,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.title}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {hopDistance !== undefined && (
                    <span
                      style={{
                        backgroundColor: "#f59e0b",
                        color: "#0f172a",
                        borderRadius: 999,
                        padding: "1px 6px",
                        fontSize: 10,
                      }}
                    >
                      +{hopDistance}
                    </span>
                  )}
                  <span
                    style={{
                      backgroundColor: `${desc.accentColor}33`,
                      color: desc.accentColor,
                      borderRadius: 4,
                      padding: "2px 6px",
                      fontSize: 10,
                      textTransform: "uppercase",
                    }}
                  >
                    {tile.languageId}
                  </span>
                </span>
              </div>

              <div style={{ flex: 1, padding: 8, fontSize: 12, color: "#94a3b8", overflow: "hidden" }}>
                {renderTileContent
                  ? renderTileContent(tile, lod, isWebGlLive)
                  : renderPolyglotTileContent({
                      tile,
                      lod,
                      descriptor: desc,
                      isWebGlLive,
                      onAnchorClick: handleAnchorClick,
                      activeWiringSource: wiringSource
                        ? { tileId: wiringSource.tileId, anchorPath: wiringSource.anchor.path }
                        : null,
                    })}
              </div>

              {/* Bottom-Right Resize Handle */}
              {!tile.locked && onTileResize && (
                <div
                  title="Drag to resize tile"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.parentElement?.parentElement?.parentElement?.getBoundingClientRect();
                    if (!rect) return;
                    const worldPt = cameraRef.current!.screenToWorld({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top,
                    });
                    setDragState({
                      mode: "resize",
                      tileId: tile.id,
                      startWorldX: worldPt.x,
                      startWorldY: worldPt.y,
                      origW: tile.bounds.width,
                      origH: tile.bounds.height,
                    });
                  }}
                  style={{
                    position: "absolute",
                    right: 2,
                    bottom: 2,
                    width: 14,
                    height: 14,
                    cursor: "nwse-resize",
                    borderRight: `2px solid ${desc.accentColor}88`,
                    borderBottom: `2px solid ${desc.accentColor}88`,
                  }}
                />
              )}
            </div>
          );
        })}

        {/* Spatial Review Comment Pins */}
        {Object.values(doc.comments)
          .filter((c) => !c.resolved)
          .map((comment) => (
            <div
              key={comment.id}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: comment.position.x,
                top: comment.position.y,
                maxWidth: 200,
                padding: "6px 10px",
                borderRadius: "2px 10px 10px 10px",
                backgroundColor: "#fef08a",
                color: "#0f172a",
                fontSize: 11,
                fontWeight: 500,
                boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 10 }}>{comment.authorName}</div>
              <div>{comment.text}</div>
            </div>
          ))}

        {/* Layer 2: Live Visual Threads, Animated FMI Pipes, Smart Guides & Multiplayer Cursors */}
        <svg style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }}>
          {activeGuides.map((g, idx) =>
            g.orientation === "vertical" ? (
              <line
                key={`vg_${idx}`}
                x1={g.position}
                y1={g.start}
                x2={g.position}
                y2={g.end}
                stroke="#f43f5e"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            ) : (
              <line
                key={`hg_${idx}`}
                x1={g.start}
                y1={g.position}
                x2={g.end}
                y2={g.position}
                stroke="#f43f5e"
                strokeWidth={1.5}
                strokeDasharray="4 4"
              />
            ),
          )}

          {visibleWires.map((wire) => {
            const srcTile = doc.tiles[wire.source.tileId];
            const dstTile = doc.tiles[wire.target.tileId];
            if (!srcTile || !dstTile) return null;

            const srcAnchor = resolveAnchorWorldPoint(srcTile, wire.source.anchorPath, {
              isSource: true,
              lod: resolveTileLodTier(srcTile, camera.zoom, { focusedTileId }),
            });
            const dstAnchor = resolveAnchorWorldPoint(dstTile, wire.target.anchorPath, {
              isSource: false,
              lod: resolveTileLodTier(dstTile, camera.zoom, { focusedTileId }),
            });
            const routed = routeCanvasWire(wire, srcAnchor, dstAnchor);
            const color =
              wire.status === "conflict"
                ? "#ef4444"
                : wire.status === "stale" || wire.status === "unit-mismatch"
                  ? "#f59e0b"
                  : WIRE_COLORS[wire.kind];
            const dimmed = blastRadius !== null && !blastRadius.impactedWireIds.includes(wire.id);

            return (
              <g
                key={wire.id}
                style={{ opacity: dimmed ? 0.15 : 0.92, pointerEvents: "stroke", cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onWireClick?.(wire);
                }}
              >
                <path
                  id={`wire-path-${wire.id}`}
                  d={routed.svgPath}
                  fill="none"
                  stroke={color}
                  strokeWidth={wire.kind === "fmi-signal" ? 2.5 : 2}
                  strokeDasharray={wire.status === "stale" ? "6 4" : undefined}
                />
                {cosimRunning && wire.kind === "fmi-signal" && (
                  <circle r={4.5} fill="#fbbf24">
                    <animateMotion dur="1.4s" repeatCount="indefinite" path={routed.svgPath} />
                  </circle>
                )}
                <circle cx={routed.start.x} cy={routed.start.y} r={4} fill={color} />
                <circle cx={routed.end.x} cy={routed.end.y} r={4} fill={color} />
                {wire.liveValue && camera.zoom >= 0.4 && (
                  <text
                    x={routed.labelPoint.x}
                    y={routed.labelPoint.y - 6}
                    textAnchor="middle"
                    fill="#f8fafc"
                    fontSize={11}
                  >
                    {wire.liveValue}
                  </text>
                )}
              </g>
            );
          })}

          {activeLenses.has("presence") &&
            peers.map((peer) =>
              peer.cursor ? (
                <g key={peer.peerId} transform={`translate(${peer.cursor.x}, ${peer.cursor.y})`}>
                  <circle r={5} fill={peer.color} />
                  <text x={8} y={4} fill={peer.color} fontSize={12} fontWeight={600}>
                    {peer.userName}
                  </text>
                </g>
              ) : null,
            )}
        </svg>
      </div>

      {/* Floating Lens & Action Toolbar */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          padding: "6px 10px",
          borderRadius: 8,
          backgroundColor: "rgba(15, 23, 42, 0.92)",
          border: "1px solid #334155",
          fontSize: 12,
        }}
      >
        {(["shared-parameters", "fmi-signals", "requirements", "presence"] as CanvasLensId[]).map((lens) => (
          <button
            key={lens}
            type="button"
            onClick={() => toggleLens(lens)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              backgroundColor: activeLenses.has(lens) ? "#2563eb" : "#1e293b",
              color: "#f8fafc",
              fontSize: 11,
            }}
          >
            {lens}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setBlastRootTileId(blastRootTileId ? null : selectedTileId)}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            backgroundColor: blastRootTileId ? "#f59e0b" : "#1e293b",
            color: blastRootTileId ? "#0f172a" : "#f8fafc",
            fontSize: 11,
          }}
        >
          Blast Radius
        </button>
        <button
          type="button"
          onClick={() => setCosimRunning((r) => !r)}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            backgroundColor: cosimRunning ? "#10b981" : "#1e293b",
            color: cosimRunning ? "#0f172a" : "#f8fafc",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {cosimRunning ? "■ Stop Co-Sim" : "▶ Run Co-Sim"}
        </button>
        {onCommentCreate && (
          <button
            type="button"
            onClick={() => setCommentMode((c) => !c)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              backgroundColor: commentMode ? "#eab308" : "#1e293b",
              color: commentMode ? "#0f172a" : "#f8fafc",
              fontSize: 11,
            }}
          >
            + Comment
          </button>
        )}
        {onTileDrop && (
          <button
            type="button"
            onClick={() => setPaletteOpen((o) => !o)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              backgroundColor: paletteOpen ? "#7c3aed" : "#1e293b",
              color: "#f8fafc",
              fontSize: 11,
            }}
          >
            + Drop Artifact (106 langs)
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            const next: SurfacePresentationMode =
              surfaceMode === "desktop-2d" ? "spatial-3d" : surfaceMode === "spatial-3d" ? "webxr-vr" : "desktop-2d";
            setInternalSurfaceMode(next);
            onSurfaceModeChange?.(next);
          }}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            backgroundColor: surfaceMode === "desktop-2d" ? "#1e293b" : "#7c3aed",
            color: "#f8fafc",
            fontSize: 11,
          }}
        >
          {surfaceMode === "desktop-2d" ? "2D Surface" : surfaceMode === "spatial-3d" ? "3D Spatial" : "WebXR VR"}
        </button>
        <button
          type="button"
          onClick={handleFitAll}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            backgroundColor: "#1e293b",
            color: "#f8fafc",
            fontSize: 11,
          }}
        >
          Fit ({Math.round(camera.zoom * 100)}%)
        </button>
        {onExportSsp && (
          <button
            type="button"
            onClick={() => onExportSsp(doc)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              backgroundColor: "#059669",
              color: "#f8fafc",
              fontSize: 11,
            }}
          >
            Export .ssp
          </button>
        )}
      </div>

      {/* Synchronized Simulation / SCADA Timeline Scrubber Bar */}
      {(cosimRunning || onSimulationTimeChange) && (
        <div
          data-testid="canvas-simulation-timeline"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: 12,
            left: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 8,
            backgroundColor: "rgba(15, 23, 42, 0.92)",
            border: "1px solid #334155",
            fontSize: 11,
            color: "#cbd5e1",
          }}
        >
          <span style={{ fontWeight: 600, color: "#10b981" }}>t = {simTime.toFixed(2)}s</span>
          <input
            type="range"
            min={0}
            max={simulationEndTime}
            step={0.05}
            value={simTime}
            aria-label="Simulation timeline scrubber"
            onChange={(e) => {
              const t = Number(e.target.value);
              setInternalSimTime(t);
              onSimulationTimeChange?.(t);
            }}
            style={{ width: 160 }}
          />
          <span style={{ color: "#64748b" }}>/ {simulationEndTime.toFixed(1)}s</span>
        </div>
      )}

      {/* Recursive Semantic Zoom Breadcrumb Bar (Board -> Live Schematic Sub-Scene) */}
      {activeSubSceneTile && (
        <div
          data-testid="canvas-semantic-zoom-breadcrumb"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 56,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 14px",
            borderRadius: 999,
            backgroundColor: "rgba(15, 23, 42, 0.94)",
            border: "1px solid #38bdf8",
            boxShadow: "0 8px 24px rgba(2, 6, 23, 0.6)",
            fontSize: 12,
            color: "#e2e8f0",
            zIndex: 25,
          }}
        >
          <span style={{ color: "#94a3b8" }}>{doc.name}</span>
          <span style={{ color: "#475569" }}>›</span>
          <span style={{ fontWeight: 700, color: "#38bdf8" }}>{activeSubSceneTile.title}</span>
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 4,
              backgroundColor: "rgba(56, 189, 248, 0.16)",
              color: "#7dd3fc",
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            Sub-Scene ({Math.round(camera.zoom * 100)}%)
          </span>
          {(activeSubSceneTile.pinnedAnchors?.length ?? 0) > 0 && (
            <span style={{ fontSize: 10, color: "#94a3b8" }}>
              {activeSubSceneTile.pinnedAnchors!.length} projected ports
            </span>
          )}
          <button
            type="button"
            data-testid="canvas-semantic-zoom-exit"
            onClick={handleExitSubScene}
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              backgroundColor: "#1e293b",
              color: "#f8fafc",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            ← Back to Board
          </button>
        </div>
      )}

      {/* Inline Parameter Editor Popover (Live Reactive Propagation) */}
      {paramEditor && onParameterEdit && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 56,
            right: 12,
            width: 260,
            padding: 12,
            borderRadius: 10,
            backgroundColor: "#0f172a",
            border: "1px solid #38bdf8",
            boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Edit Parameter: {paramEditor.anchor.label}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="number"
              step="0.05"
              value={paramEditor.valueText}
              onChange={(e) => setParamEditor({ ...paramEditor, valueText: e.target.value })}
              style={{
                flex: 1,
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid #334155",
                backgroundColor: "#1e293b",
                color: "#f8fafc",
              }}
            />
            <button
              type="button"
              onClick={() => {
                const val = Number(paramEditor.valueText);
                if (Number.isFinite(val)) {
                  onParameterEdit(paramEditor.tileId, paramEditor.anchor.path, val);
                  setWireToast(`Propagated ${paramEditor.anchor.label} = ${val} ${paramEditor.anchor.unit ?? ""}`);
                }
                setParamEditor(null);
                setWiringSource(null);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "none",
                backgroundColor: "#2563eb",
                color: "#f8fafc",
                cursor: "pointer",
              }}
            >
              Propagate
            </button>
          </div>
        </div>
      )}

      {/* Wiring / Validation Status Toast */}
      {wireToast && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            padding: "6px 14px",
            borderRadius: 8,
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            border: "1px solid #38bdf8",
            fontSize: 12,
            color: "#f8fafc",
          }}
        >
          {wireToast}
        </div>
      )}

      {/* Quick-Drop 106-Language Palette */}
      {paletteOpen && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 56,
            left: 12,
            width: 340,
            maxHeight: 420,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 10,
            padding: 10,
            boxShadow: "0 16px 40px rgba(0,0,0,0.6)",
          }}
        >
          <input
            type="text"
            placeholder="Search 106 languages (Modelica, KiCad, STEP, ReqIF...)"
            value={paletteQuery}
            onChange={(e) => setPaletteQuery(e.target.value)}
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              backgroundColor: "#1e293b",
              color: "#f8fafc",
              fontSize: 12,
              marginBottom: 8,
            }}
          />
          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
            {filteredCatalog.map((item) => (
              <button
                key={item.languageId}
                type="button"
                onClick={() => handleQuickDropLanguage(item.languageId, item.extensions[0] ?? "")}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #1e293b",
                  backgroundColor: "#111827",
                  color: "#e2e8f0",
                  fontSize: 12,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span>{item.label}</span>
                <span style={{ fontSize: 10, color: item.accentColor }}>{item.archetype}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Compact Minimap Overlay */}
      {totalBounds && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: 180,
            height: 112,
            borderRadius: 8,
            backgroundColor: "rgba(15, 23, 42, 0.9)",
            border: "1px solid #334155",
            padding: 6,
          }}
        >
          <svg
            viewBox={`${totalBounds.x - 40} ${totalBounds.y - 40} ${Math.max(100, totalBounds.width + 80)} ${Math.max(100, totalBounds.height + 80)}`}
            style={{ width: "100%", height: "100%" }}
          >
            {Object.values(doc.tiles).map((t) => (
              <rect
                key={t.id}
                x={t.bounds.x}
                y={t.bounds.y}
                width={t.bounds.width}
                height={t.bounds.height}
                rx={16}
                fill={registry.resolveDescriptor(t.languageId, t.artifactUri).accentColor}
                opacity={0.75}
              />
            ))}
            <rect
              x={visibleWorldBounds.x}
              y={visibleWorldBounds.y}
              width={visibleWorldBounds.width}
              height={visibleWorldBounds.height}
              fill="none"
              stroke="#f8fafc"
              strokeWidth={18}
            />
          </svg>
        </div>
      )}
    </div>
  );
}
