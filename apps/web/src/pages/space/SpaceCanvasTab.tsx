// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CanvasCrdtStore,
  CanvasIndexedDbCache,
  CanvasWebSocketClient,
  createCanonicalPolyglotDemoBoard,
  exportCanvasToSspXml,
  exportCanvasToSvg,
  propagateParameterEdit,
  SpatialCanvas,
  type CanvasCommentThread,
  type CanvasDocument,
  type CanvasPeerPresence,
  type CanvasTile,
  type CanvasWire,
  type SurfacePresentationMode,
  type TileLodTier,
} from "@modelscript/canvas";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { renderLiveWebTileContent } from "../../components/canvas/LivePolyglotTileRenderer";
import { SharedScissor3DHost } from "../../components/canvas/SharedScissor3DHost";
import { SpatialVrSurface } from "../../components/canvas/SpatialVrSurface";

export interface SpaceCanvasTabProps {
  spaceSlug: string;
  spaceName?: string | undefined;
}

function generatePeerId(): string {
  return `space_${crypto.randomUUID().slice(0, 8)}`;
}

function extractHydratedDiagramData(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const rec = payload as Record<string, unknown>;
  const candidate = rec["diagramData"] ?? rec["diagram"] ?? (Array.isArray(rec["nodes"]) ? rec : null);
  if (!candidate || typeof candidate !== "object") return null;
  const diagramRec = candidate as Record<string, unknown>;
  if (!Array.isArray(diagramRec["nodes"]) || diagramRec["nodes"].length === 0) {
    return null;
  }
  return diagramRec;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string | undefined;
    isContentEditable?: boolean | undefined;
    getAttribute?: ((name: string) => string | null) | undefined;
    closest?: ((selector: string) => unknown) | undefined;
  };
  const tag = el.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  const contentEditableAttr = el.getAttribute?.("contenteditable");
  if (contentEditableAttr === "" || contentEditableAttr?.toLowerCase() === "true") {
    return true;
  }
  if (el.closest?.('[contenteditable=""], [contenteditable="true"]')) {
    return true;
  }
  return false;
}

/**
 * Embedded Polyglot Infinite Spatial Canvas tab for Ansatz Spaces (`SpacePage`).
 * Scopes the multiplayer CRDT room to `space_${spaceSlug}` with live WebSocket sync,
 * offline IndexedDB caching, single-context scissor 3D viewports, 3D/VR Spatial Surface
 * toggling with full write-back editing, and a one-click fullscreen link to `/canvas/:boardId`.
 */
export function SpaceCanvasTab({ spaceSlug, spaceName }: SpaceCanvasTabProps): React.ReactElement {
  const boardId = `space_${spaceSlug}`;
  const [peerId] = useState<string>(generatePeerId);
  const [cache] = useState<CanvasIndexedDbCache>(() => new CanvasIndexedDbCache());
  const [store] = useState<CanvasCrdtStore>(() => {
    const base = createCanonicalPolyglotDemoBoard();
    base.id = boardId;
    if (spaceName) {
      base.name = `${spaceName} — Polyglot System Canvas`;
    }
    return new CanvasCrdtStore(peerId, base);
  });

  const [doc, setDoc] = useState<CanvasDocument>(() => store.toDocument());
  const [peers, setPeers] = useState<CanvasPeerPresence[]>([]);
  const [connected, setConnected] = useState(false);
  const [canUndo, setCanUndo] = useState<boolean>(() => store.canUndo());
  const [canRedo, setCanRedo] = useState<boolean>(() => store.canRedo());
  const [surfaceMode, setSurfaceMode] = useState<SurfacePresentationMode>("desktop-2d");
  const [simulationTime, setSimulationTime] = useState<number>(0);
  const [highlightedRowIds, setHighlightedRowIds] = useState<string[]>([]);
  const hydratedSchematicsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    void cache.load(boardId).then((cached) => {
      if (cached) store.mergeDelta(cached);
    });

    const unsub = store.onChange(() => {
      setDoc(store.toDocument());
      setPeers(store.getActivePeers());
      setCanUndo(store.canUndo());
      setCanRedo(store.canRedo());
      void cache.save(boardId, store.exportFullDelta());
    });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsClient = new CanvasWebSocketClient({
      url: `${protocol}//${window.location.host}/api/v1/canvas/stream`,
      boardId,
      userName: `Space Member ${peerId.slice(-4)}`,
      store,
      onConnectionChange: setConnected,
    });
    wsClient.connect();

    return () => {
      unsub();
      wsClient.dispose();
    };
  }, [boardId, cache, peerId, store]);

  const schematicHydrationKey = useMemo(
    () =>
      Object.values(doc.tiles)
        .filter((t) => t.archetype === "schematic" && !t.viewState?.["diagramData"] && t.artifactUri.trim().length > 0)
        .map((t) => `${t.id}:${t.artifactUri}`)
        .sort()
        .join("|"),
    [doc.tiles],
  );

  // Optional LSP/API hydration for schematic tiles missing viewState.diagramData
  useEffect(() => {
    if (typeof window === "undefined" || typeof fetch !== "function" || !schematicHydrationKey) {
      return;
    }
    const currentTiles = Object.values(store.toDocument().tiles).filter(
      (t) =>
        t.archetype === "schematic" &&
        !t.viewState?.["diagramData"] &&
        t.artifactUri.trim().length > 0 &&
        !hydratedSchematicsRef.current.has(`${t.id}:${t.artifactUri}`),
    );
    if (currentTiles.length === 0) return;

    const controller = new AbortController();
    for (const tile of currentTiles) {
      const key = `${tile.id}:${tile.artifactUri}`;
      hydratedSchematicsRef.current.add(key);
      void fetch(`/api/v1/diagram?uri=${encodeURIComponent(tile.artifactUri)}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((payload: unknown) => {
          if (controller.signal.aborted) return;
          const diagramData = extractHydratedDiagramData(payload);
          if (!diagramData) return;
          const latestTile = store.toDocument().tiles[tile.id];
          if (!latestTile) return;
          store.upsertTile({
            ...latestTile,
            viewState: { ...latestTile.viewState, diagramData },
          });
        })
        .catch(() => {
          // Silent fallback when API is offline or request is aborted
        });
    }

    return () => {
      controller.abort();
    };
  }, [schematicHydrationKey, store]);

  const handleTileMove = useCallback(
    (tileId: string, x: number, y: number) => {
      store.moveTile(tileId, x, y);
    },
    [store],
  );

  const handleTileResize = useCallback(
    (tileId: string, width: number, height: number) => {
      store.resizeTile(tileId, width, height);
    },
    [store],
  );

  const handleTileDrop = useCallback(
    (tile: CanvasTile) => {
      store.upsertTile(tile);
    },
    [store],
  );

  const handleWireCreate = useCallback(
    (wire: CanvasWire) => {
      store.upsertWire(wire);
    },
    [store],
  );

  const handleCreateSpatialWire = useCallback(
    (sourceTileId: string, targetTileId: string, sourceAnchor = "CADPort") => {
      if (sourceTileId === targetTileId) return;
      const current = store.toDocument();
      const sourceTile = current.tiles[sourceTileId];
      const targetTile = current.tiles[targetTileId];
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
      store.upsertWire(wire);
    },
    [store],
  );

  const handleParameterEdit = useCallback(
    (tileId: string, anchorPath: string, numericValue: number) => {
      const propagated = propagateParameterEdit(store.toDocument(), {
        tileId,
        anchorPath,
        numericValue,
        autoSync: true,
      });
      store.applyDocumentSnapshot(propagated.document);
    },
    [store],
  );

  const handleCodeChange = useCallback(
    (tileId: string, code: string) => {
      const latestTile = store.toDocument().tiles[tileId];
      if (!latestTile) return;
      store.upsertTile({
        ...latestTile,
        viewState: { ...latestTile.viewState, code },
      });
    },
    [store],
  );

  const handleCommentCreate = useCallback(
    (comment: CanvasCommentThread) => {
      store.upsertComment(comment);
    },
    [store],
  );

  const handleUndo = useCallback(() => {
    const delta = store.undo();
    if (delta) {
      setCanUndo(store.canUndo());
      setCanRedo(store.canRedo());
    }
  }, [store]);

  const handleRedo = useCallback(() => {
    const delta = store.redo();
    if (delta) {
      setCanUndo(store.canUndo());
      setCanRedo(store.canRedo());
    }
  }, [store]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditableKeyboardTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (key === "y") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  const handleExportSsp = useCallback((currentDoc: CanvasDocument) => {
    const xml = exportCanvasToSspXml(currentDoc);
    const blob = new Blob([xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentDoc.id}.ssd`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportSvg = useCallback(() => {
    const svg = exportCanvasToSvg(doc);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.id}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 12px",
          borderRadius: 8,
          backgroundColor: "#0f172a",
          border: "1px solid #1e293b",
          color: "#f8fafc",
          fontSize: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong>{doc.name}</strong>
          <span style={{ color: connected ? "#34d399" : "#94a3b8" }}>
            {connected ? `Live (${peers.length + 1} online)` : "Local Mode"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            data-testid="canvas-crdt-undo"
            disabled={!canUndo}
            onClick={handleUndo}
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "#1e293b",
              color: canUndo ? "#f8fafc" : "#64748b",
              cursor: canUndo ? "pointer" : "not-allowed",
              fontSize: 11,
              opacity: canUndo ? 1 : 0.55,
            }}
          >
            ↶ Undo
          </button>
          <button
            type="button"
            data-testid="canvas-crdt-redo"
            disabled={!canRedo}
            onClick={handleRedo}
            title="Redo (Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y)"
            aria-label="Redo"
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "#1e293b",
              color: canRedo ? "#f8fafc" : "#64748b",
              cursor: canRedo ? "pointer" : "not-allowed",
              fontSize: 11,
              opacity: canRedo ? 1 : 0.55,
            }}
          >
            ↷ Redo
          </button>
          <button
            type="button"
            onClick={handleExportSvg}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#f8fafc",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Export SVG
          </button>
          <Link
            to={`/canvas/${encodeURIComponent(boardId)}`}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              background: "#2563eb",
              color: "#ffffff",
              textDecoration: "none",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Open Fullscreen
          </Link>
        </div>
      </div>

      <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid #1e293b", height: 680 }}>
        {surfaceMode === "desktop-2d" ? (
          <SharedScissor3DHost>
            <SpatialCanvas
              document={doc}
              peers={peers}
              width={1220}
              height={680}
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
              onExportSsp={handleExportSsp}
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
        ) : (
          <SpatialVrSurface
            document={doc}
            mode={surfaceMode}
            simulationTime={simulationTime}
            onExitTo2D={() => setSurfaceMode("desktop-2d")}
            onMoveTile={handleTileMove}
            onCreateSpatialWire={handleCreateSpatialWire}
          />
        )}
      </div>
    </div>
  );
}
