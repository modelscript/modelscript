// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCanonicalPolyglotDemoBoard,
  deserializeCanvasDocument,
  propagateParameterEdit,
  SpatialCanvas,
  type CanvasCommentThread,
  type CanvasDocument,
  type CanvasTile,
  type CanvasWire,
  type SurfacePresentationMode,
  type TileLodTier,
} from "@modelscript/canvas";
import { EngineeringRotunda } from "@modelscript/editor/workbench/vr-rotunda/EngineeringRotunda.js";
import type { RotundaEnvironmentId } from "@modelscript/editor/workbench/vr-rotunda/types.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderLiveWebTileContent } from "../canvas/LivePolyglotTileRenderer";
import { SharedScissor3DHost } from "../canvas/SharedScissor3DHost";
import {
  parseRotundaEnvironmentId,
  parseSurfacePresentationMode,
  resolveInlineCanvasDocument,
} from "./rotunda-board-adapter";

export interface SpatialCanvasArtifactViewerProps {
  artifactId?: number | string | undefined;
  viewConfig?: Record<string, unknown> | null | undefined;
  isFullScreen?: boolean | undefined;
  initialMode?: SurfacePresentationMode | undefined;
}

/**
 * First-class artifact viewer for `.mscanvas` / `spatial-canvas` / `canvas-board` artifacts.
 *
 * Resolves a `CanvasDocument` from `viewConfig.document`, `viewConfig.canvas`, `viewConfig.code`
 * (via `deserializeCanvasDocument`), or asynchronously fetches `viewConfig.url`, safely falling
 * back to `createCanonicalPolyglotDemoBoard()`.
 *
 * Renders the 2D `<SpatialCanvas>` inside a single-WebGL-context `<SharedScissor3DHost>` with
 * instant switching into the 3D Spatial & WebXR VR `<EngineeringRotunda>` workstation.
 */
export const SpatialCanvasArtifactViewer: React.FC<SpatialCanvasArtifactViewerProps> = ({
  viewConfig,
  isFullScreen = false,
  initialMode,
}) => {
  const inlineDoc = useMemo(() => resolveInlineCanvasDocument(viewConfig), [viewConfig]);
  const remoteUrl = useMemo(() => {
    if (inlineDoc) return null;
    const rawUrl = viewConfig?.["url"];
    return typeof rawUrl === "string" && rawUrl.trim().length > 0 ? rawUrl.trim() : null;
  }, [inlineDoc, viewConfig]);

  const initialResolvedMode = useMemo<SurfacePresentationMode>(
    () => parseSurfacePresentationMode(initialMode ?? viewConfig?.["surfaceMode"], "desktop-2d"),
    [initialMode, viewConfig],
  );

  const initialEnvironment = useMemo<RotundaEnvironmentId>(
    () => parseRotundaEnvironmentId(viewConfig?.["environment"] ?? viewConfig?.["env"], "dark-lab"),
    [viewConfig],
  );

  const [doc, setDoc] = useState<CanvasDocument>(() => inlineDoc ?? createCanonicalPolyglotDemoBoard());
  const [surfaceMode, setSurfaceMode] = useState<SurfacePresentationMode>(initialResolvedMode);
  const [simulationTime, setSimulationTime] = useState<number>(0);
  const [highlightedRowIds, setHighlightedRowIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<{ width: number; height: number }>(() => ({
    width: 1120,
    height: isFullScreen ? 760 : 520,
  }));

  // Keep document synchronized if inline viewConfig document updates
  useEffect(() => {
    if (inlineDoc) {
      setDoc(inlineDoc);
    }
  }, [inlineDoc]);

  // Fetch remote `.mscanvas` JSON when `viewConfig.url` is provided without inline payload
  useEffect(() => {
    if (!remoteUrl || typeof window === "undefined" || typeof fetch !== "function") {
      return;
    }
    const controller = new AbortController();
    void fetch(remoteUrl, { signal: controller.signal, headers: { Accept: "application/json, text/plain" } })
      .then((res) => (res.ok ? res.text() : null))
      .then((text) => {
        if (controller.signal.aborted || !text) return;
        try {
          const parsed = deserializeCanvasDocument(text);
          setDoc(parsed);
        } catch {
          // Retain safe fallback board if remote payload is malformed
        }
      })
      .catch(() => {
        // Retain safe fallback board if offline or aborted
      });

    return () => {
      controller.abort();
    };
  }, [remoteUrl]);

  // Sync mode if caller changes initialMode or viewConfig.surfaceMode
  useEffect(() => {
    setSurfaceMode(initialResolvedMode);
  }, [initialResolvedMode]);

  // Track responsive container dimensions for 2D SpatialCanvas layout
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === "undefined") return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setViewport({ width: Math.round(rect.width), height: Math.round(rect.height) });
      }
    };

    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isFullScreen]);

  const handleTileMove = useCallback((tileId: string, x: number, y: number) => {
    setDoc((prev) => {
      const existing = prev.tiles[tileId];
      if (!existing) return prev;
      return {
        ...prev,
        tiles: {
          ...prev.tiles,
          [tileId]: {
            ...existing,
            bounds: { ...existing.bounds, x, y },
          },
        },
      };
    });
  }, []);

  const handleTileResize = useCallback((tileId: string, width: number, height: number) => {
    setDoc((prev) => {
      const existing = prev.tiles[tileId];
      if (!existing) return prev;
      return {
        ...prev,
        tiles: {
          ...prev.tiles,
          [tileId]: {
            ...existing,
            bounds: { ...existing.bounds, width: Math.max(120, width), height: Math.max(80, height) },
          },
        },
      };
    });
  }, []);

  const handleTileDrop = useCallback((tile: CanvasTile) => {
    setDoc((prev) => ({
      ...prev,
      tiles: {
        ...prev.tiles,
        [tile.id]: tile,
      },
    }));
  }, []);

  const handleWireCreate = useCallback((wire: CanvasWire) => {
    setDoc((prev) => ({
      ...prev,
      wires: {
        ...prev.wires,
        [wire.id]: wire,
      },
    }));
  }, []);

  const handleCreateSpatialWire = useCallback((sourceTileId: string, targetTileId: string, sourceAnchor?: string) => {
    setDoc((prev) => {
      const id = `spatial_wire_${Date.now()}`;
      const wire: CanvasWire = {
        id,
        kind: "shared-parameter",
        origin: "user-authored",
        source: { tileId: sourceTileId, anchorPath: sourceAnchor ?? "CADPort" },
        target: { tileId: targetTileId, anchorPath: "in" },
        liveValue: "3D → 2D Spatial",
        status: "synced",
      };
      return {
        ...prev,
        wires: {
          ...prev.wires,
          [id]: wire,
        },
      };
    });
  }, []);

  const handleParameterEdit = useCallback((tileId: string, anchorPath: string, numericValue: number) => {
    setDoc(
      (prev) =>
        propagateParameterEdit(prev, {
          tileId,
          anchorPath,
          numericValue,
          autoSync: true,
        }).document,
    );
  }, []);

  const handleCommentCreate = useCallback((comment: CanvasCommentThread) => {
    setDoc((prev) => ({
      ...prev,
      comments: {
        ...(prev.comments ?? {}),
        [comment.id]: comment,
      },
    }));
  }, []);

  const handleCodeChange = useCallback((tileId: string, code: string) => {
    setDoc((prev) => {
      const existing = prev.tiles[tileId];
      if (!existing) return prev;
      return {
        ...prev,
        tiles: {
          ...prev.tiles,
          [tileId]: {
            ...existing,
            viewState: { ...(existing.viewState ?? {}), code },
          },
        },
      };
    });
  }, []);

  const titleBadge =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"].trim()) || doc.name || "Spatial Canvas";

  return (
    <div
      ref={containerRef}
      data-testid="spatial-canvas-artifact-viewer"
      data-surface-mode={surfaceMode}
      style={{
        position: "relative",
        width: "100%",
        height: isFullScreen ? "100%" : "520px",
        minHeight: isFullScreen ? "100%" : "520px",
        background: "#090f1d",
        overflow: "hidden",
      }}
    >
      {surfaceMode === "desktop-2d" ? (
        <>
          <SharedScissor3DHost>
            <SpatialCanvas
              document={doc}
              width={viewport.width}
              height={viewport.height}
              surfaceMode={surfaceMode}
              onSurfaceModeChange={setSurfaceMode}
              simulationTime={simulationTime}
              simulationEndTime={10}
              onSimulationTimeChange={setSimulationTime}
              onTileMove={handleTileMove}
              onTileResize={handleTileResize}
              onTileDrop={handleTileDrop}
              onWireCreate={handleWireCreate}
              onParameterEdit={handleParameterEdit}
              onCommentCreate={handleCommentCreate}
              renderTileContent={(tile: CanvasTile, lod: TileLodTier, isWebGlLive: boolean) =>
                renderLiveWebTileContent(tile, lod, isWebGlLive, {
                  simulationTime,
                  onTimeScrub: setSimulationTime,
                  highlightedRowIds,
                  onBrushLinkedIds: setHighlightedRowIds,
                  onCodeChange: handleCodeChange,
                  onParameterEdit: handleParameterEdit,
                })
              }
            />
          </SharedScissor3DHost>

          {/* Compact Mode Switcher Overlay for instant 2D → 3D Spatial / WebXR VR Rotunda entry */}
          <div
            data-testid="spatial-canvas-mode-switcher"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 10,
              right: 12,
              zIndex: 30,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 5px",
              borderRadius: 999,
              border: "1px solid rgba(129, 140, 248, 0.35)",
              background: "rgba(9, 15, 29, 0.86)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
            }}
          >
            <button
              type="button"
              data-testid="spatial-canvas-enter-3d-btn"
              onClick={() => setSurfaceMode("spatial-3d")}
              title="Open board on the 45° Drafting Podium in 3D Engineering Rotunda"
              style={{
                border: "1px solid rgba(56, 189, 248, 0.45)",
                borderRadius: 999,
                padding: "3px 9px",
                background: "rgba(14, 116, 144, 0.35)",
                color: "#e0f2fe",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              3D Spatial
            </button>
            <button
              type="button"
              data-testid="spatial-canvas-enter-vr-btn"
              onClick={() => setSurfaceMode("webxr-vr")}
              title="Open Engineering Rotunda in WebXR VR mode"
              style={{
                border: "none",
                borderRadius: 999,
                padding: "4px 10px",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#ffffff",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              VR Rotunda
            </button>
          </div>
        </>
      ) : (
        <EngineeringRotunda
          document={doc}
          mode={surfaceMode}
          initialEnvironment={initialEnvironment}
          simulationTime={simulationTime}
          onSimulationTimeChange={setSimulationTime}
          onExitTo2D={() => setSurfaceMode("desktop-2d")}
          onMoveTile={handleTileMove}
          onCreateSpatialWire={handleCreateSpatialWire}
          title={titleBadge}
        />
      )}
    </div>
  );
};

export default SpatialCanvasArtifactViewer;
