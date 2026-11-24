// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CanvasCrdtStore,
  CanvasIndexedDbCache,
  CanvasWebSocketClient,
  createCanonicalPolyglotDemoBoard,
  deserializeCanvasDocument,
  exportCanvasToSspXml,
  exportCanvasToSvg,
  propagateParameterEdit,
  serializeCanvasDocument,
  SpatialCanvas,
  type CanvasCommentThread,
  type CanvasDocument,
  type CanvasPeerPresence,
  type CanvasTile,
  type CanvasWire,
  type SurfacePresentationMode,
  type TileLodTier,
} from "@modelscript/canvas";
import {
  getRotundaScenarioById,
  ROTUNDA_SHOWCASE_SCENARIOS,
} from "@modelscript/editor/workbench/vr-rotunda/showcase-catalog.js";
import { buildRotundaCanvasDocument } from "@modelscript/editor/workbench/vr-rotunda/types.js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { renderLiveWebTileContent } from "../components/canvas/LivePolyglotTileRenderer";
import { SharedScissor3DHost } from "../components/canvas/SharedScissor3DHost";
import {
  SpatialVrSurface,
  type RotundaEnvironmentId,
  type RotundaScenarioPreset,
} from "../components/canvas/SpatialVrSurface";
import { parseModelicaParameters } from "../util/modelica-params";

const VALID_ROTUNDA_ENVIRONMENTS: readonly RotundaEnvironmentId[] = [
  "outdoors",
  "warehouse",
  "office",
  "dark-lab",
  "passthrough",
];

const DEFAULT_SHOWCASE_SCENARIO_ID = "all-showcase";
const VR_HANDOFF_CHANNEL_NAME = "modelscript-vr-handoff";
const MAX_VR_BOARD_HASH_CHARS = 2 * 1024 * 1024;

function resolveShowcaseScenario(rawId: string | null | undefined): RotundaScenarioPreset | undefined {
  return (
    getRotundaScenarioById(rawId) ??
    getRotundaScenarioById(DEFAULT_SHOWCASE_SCENARIO_ID) ??
    ROTUNDA_SHOWCASE_SCENARIOS[0]
  );
}

function generatePeerId(): string {
  return `web_${crypto.randomUUID().slice(0, 8)}`;
}

function parseSurfaceModeParam(raw: string | null): SurfacePresentationMode {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "webxr-vr") return "webxr-vr";
  if (normalized === "spatial-3d") return "spatial-3d";
  return "desktop-2d";
}

function tryParseRotundaEnvironmentParam(raw: unknown): RotundaEnvironmentId | null {
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    for (const env of VALID_ROTUNDA_ENVIRONMENTS) {
      if (normalized === env) {
        return env;
      }
    }
  }
  return null;
}

function resolveCanvasSessionState(params: {
  boardId: string | undefined;
  vrHandoffBoard: CanvasDocument | null;
  handoffId: string | null;
  handoffEnvironment: RotundaEnvironmentId | null;
  scenarioOverrideActive: boolean;
  activeScenarioId: string;
  scenarioEnvironmentOverride: RotundaEnvironmentId | null;
  envParam: string | null;
}): {
  isVrHandoffBoard: boolean;
  isHandoffActive: boolean;
  activeScenario: RotundaScenarioPreset | undefined;
  initialEnvironment: RotundaEnvironmentId;
  activeBoardId: string;
} {
  const isVrHandoffBoard = params.vrHandoffBoard !== null;
  const isHandoffActive = !params.scenarioOverrideActive && (isVrHandoffBoard || params.handoffId !== null);
  const activeScenario = resolveShowcaseScenario(params.activeScenarioId);
  const explicitEnvParam = tryParseRotundaEnvironmentParam(params.envParam);
  const initialEnvironment: RotundaEnvironmentId =
    params.handoffEnvironment ??
    (!isHandoffActive && params.scenarioEnvironmentOverride ? params.scenarioEnvironmentOverride : null) ??
    explicitEnvParam ??
    (!isHandoffActive && activeScenario ? activeScenario.recommendedEnvironment : null) ??
    "outdoors";
  const activeBoardId =
    params.boardId ||
    params.vrHandoffBoard?.id ||
    (!isHandoffActive && activeScenario && activeScenario.id !== DEFAULT_SHOWCASE_SCENARIO_ID
      ? `scenario-${activeScenario.id}`
      : "demo-polyglot-actuator");
  return {
    isVrHandoffBoard,
    isHandoffActive,
    activeScenario,
    initialEnvironment,
    activeBoardId,
  };
}

function resolveBroadcastHandoffDocument(msg: Record<string, unknown>): CanvasDocument | null {
  const boardJson = typeof msg["boardJson"] === "string" ? msg["boardJson"].trim() : "";
  if (boardJson.length > 0) {
    try {
      return deserializeCanvasDocument(boardJson);
    } catch {
      // Fall through to fileContent / synthesized board
    }
  }

  const fileContent = typeof msg["fileContent"] === "string" ? msg["fileContent"] : "";
  const trimmedFileContent = fileContent.trim();
  if (trimmedFileContent.startsWith("{")) {
    try {
      return deserializeCanvasDocument(trimmedFileContent);
    } catch {
      // Not a .mscanvas JSON payload; synthesize a live Rotunda board below
    }
  }

  const title = typeof msg["title"] === "string" && msg["title"].trim() ? msg["title"].trim() : "";
  const languageId = typeof msg["languageId"] === "string" && msg["languageId"].trim() ? msg["languageId"].trim() : "";
  const artifactUri =
    typeof msg["artifactUri"] === "string" && msg["artifactUri"].trim() ? msg["artifactUri"].trim() : "";

  if (!title && !languageId && !artifactUri && !trimmedFileContent) {
    return null;
  }

  const parsedParams =
    trimmedFileContent.length > 0
      ? Object.entries(parseModelicaParameters(trimmedFileContent)).map(([name, value]) => ({ name, value }))
      : [];

  const synthesized = buildRotundaCanvasDocument({
    title: title || artifactUri || "Local Engineering Model",
    ...(languageId ? { languageId } : {}),
    ...(artifactUri ? { artifactUri } : {}),
    ...(parsedParams.length > 0 ? { parameters: parsedParams } : {}),
  });

  if (trimmedFileContent.length > 0 && synthesized.tiles["tile_primary_schematic"]) {
    const schem = synthesized.tiles["tile_primary_schematic"];
    synthesized.tiles["tile_primary_schematic"] = {
      ...schem,
      viewState: {
        ...schem.viewState,
        code: fileContent,
      },
    };
  }

  return synthesized;
}

function decodeUtf8Base64Url(encoded: string): string | null {
  const trimmed = encoded.trim();
  if (!trimmed || trimmed.length > MAX_VR_BOARD_HASH_CHARS) return null;
  if (!/^[A-Za-z0-9\-_]+={0,2}$/.test(trimmed)) return null;

  const base64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);

  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeVrBoardFromHash(hash: string): CanvasDocument | null {
  if (!hash) return null;
  const hashIdx = hash.indexOf("#");
  const fragment = (hashIdx >= 0 ? hash.slice(hashIdx + 1) : hash).trim();
  if (!fragment) return null;

  const params = new URLSearchParams(fragment);
  const encoded = params.get("vrBoard");
  if (!encoded) return null;

  const json = decodeUtf8Base64Url(encoded);
  if (!json) return null;

  try {
    return deserializeCanvasDocument(json);
  } catch {
    return null;
  }
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
 * Full-screen Polyglot Infinite Spatial Canvas page (`/canvas` and `/canvas/:boardId`).
 * Connects to `/api/v1/canvas/stream` for real-time CRDT multiplayer sync while
 * persisting edits offline in IndexedDB for instant local-first resilience.
 * Supports direct VR Rotunda launch via `?mode=webxr-vr|spatial-3d`, `?env=...`,
 * and VS Code for Web `#vrBoard=<base64url>` board handoff.
 */
export default function SpatialCanvasPage(): React.ReactElement {
  const { boardId } = useParams<{ boardId?: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const { initialHash, modeParam, envParam, scenarioParam, handoffId, boardOmitted } = useMemo(() => {
    const hash = location.hash || (typeof window !== "undefined" ? window.location.hash : "");
    return {
      initialHash: hash,
      modeParam: searchParams.get("mode"),
      envParam: searchParams.get("env"),
      scenarioParam: searchParams.get("scenario"),
      handoffId: searchParams.get("handoffId")?.trim() || null,
      boardOmitted: searchParams.get("boardOmitted") === "1",
    };
  }, [location.hash, searchParams]);

  const [handoffEnvironment, setHandoffEnvironment] = useState<RotundaEnvironmentId | null>(null);
  const [handoffTitle, setHandoffTitle] = useState<string | null>(null);
  const [handoffWarning, setHandoffWarning] = useState<string | null>(() =>
    boardOmitted
      ? "Board exceeded the 128 KiB URL handoff limit and could not be embedded in the link. Showing default board."
      : null,
  );
  const [peerId] = useState<string>(generatePeerId);
  const [cache] = useState<CanvasIndexedDbCache>(() => new CanvasIndexedDbCache());
  const [vrHandoffBoard, setVrHandoffBoard] = useState<CanvasDocument | null>(() => decodeVrBoardFromHash(initialHash));
  const [scenarioOverrideActive, setScenarioOverrideActive] = useState<boolean>(false);
  const [activeScenarioId, setActiveScenarioId] = useState<string>(
    () => resolveShowcaseScenario(scenarioParam)?.id ?? DEFAULT_SHOWCASE_SCENARIO_ID,
  );
  const [scenarioEnvironmentOverride, setScenarioEnvironmentOverride] = useState<RotundaEnvironmentId | null>(null);
  const [store, setStore] = useState<CanvasCrdtStore>(() => {
    if (vrHandoffBoard) {
      return new CanvasCrdtStore(peerId, vrHandoffBoard);
    }
    const initialScenario = handoffId === null ? resolveShowcaseScenario(scenarioParam) : undefined;
    return new CanvasCrdtStore(peerId, initialScenario?.createDocument() ?? createCanonicalPolyglotDemoBoard());
  });
  const [doc, setDoc] = useState<CanvasDocument>(() => store.toDocument());
  const [peers, setPeers] = useState<CanvasPeerPresence[]>([]);
  const [connected, setConnected] = useState(false);
  const [canUndo, setCanUndo] = useState<boolean>(() => store.canUndo());
  const [canRedo, setCanRedo] = useState<boolean>(() => store.canRedo());
  const [surfaceMode, setSurfaceMode] = useState<SurfacePresentationMode>(() => parseSurfaceModeParam(modeParam));
  const [simulationTime, setSimulationTime] = useState<number>(0);
  const [highlightedRowIds, setHighlightedRowIds] = useState<string[]>([]);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1280,
    height: typeof window !== "undefined" ? Math.max(480, window.innerHeight - 48) : 800,
  }));

  const hydratedSchematicsRef = useRef<Set<string>>(new Set());
  const prevModeParamRef = useRef<string | null>(modeParam);
  const prevScenarioParamRef = useRef<string | null>(scenarioParam);
  const lastAppliedHashRef = useRef<string>(initialHash);

  const { isVrHandoffBoard, isHandoffActive, activeScenario, initialEnvironment, activeBoardId } =
    resolveCanvasSessionState({
      boardId,
      vrHandoffBoard,
      handoffId,
      handoffEnvironment,
      scenarioOverrideActive,
      activeScenarioId,
      scenarioEnvironmentOverride,
      envParam,
    });

  useEffect(() => {
    if (modeParam !== prevModeParamRef.current) {
      prevModeParamRef.current = modeParam;
      setSurfaceMode(parseSurfaceModeParam(modeParam));
    }
  }, [modeParam]);

  const handleSelectScenario = useCallback(
    (scenarioId: string) => {
      const nextScenario = getRotundaScenarioById(scenarioId);
      if (!nextScenario) return;
      const nextDoc = nextScenario.createDocument();
      const nextStore = new CanvasCrdtStore(peerId, nextDoc);
      hydratedSchematicsRef.current.clear();
      setScenarioOverrideActive(true);
      setVrHandoffBoard(null);
      setHandoffTitle(null);
      setHandoffEnvironment(null);
      setActiveScenarioId(nextScenario.id);
      setScenarioEnvironmentOverride(nextScenario.recommendedEnvironment);
      setStore(nextStore);
      setDoc(nextStore.toDocument());
      setCanUndo(nextStore.canUndo());
      setCanRedo(nextStore.canRedo());
    },
    [peerId],
  );

  useEffect(() => {
    if (scenarioParam !== prevScenarioParamRef.current) {
      prevScenarioParamRef.current = scenarioParam;
      if (!isHandoffActive) {
        const nextScenario = resolveShowcaseScenario(scenarioParam);
        if (nextScenario && nextScenario.id !== activeScenarioId) {
          handleSelectScenario(nextScenario.id);
        }
      }
    }
  }, [scenarioParam, isHandoffActive, activeScenarioId, handleSelectScenario]);

  const applyHandoffDocument = useCallback(
    (decoded: CanvasDocument) => {
      const nextStore = new CanvasCrdtStore(peerId, decoded);
      hydratedSchematicsRef.current.clear();
      setScenarioOverrideActive(false);
      setScenarioEnvironmentOverride(null);
      setVrHandoffBoard(decoded);
      setStore(nextStore);
      setDoc(nextStore.toDocument());
      setPeers([]);
      setConnected(false);
      setCanUndo(nextStore.canUndo());
      setCanRedo(nextStore.canRedo());
    },
    [peerId],
  );

  const applyVrBoardHash = useCallback(
    (nextHash: string) => {
      if (nextHash === lastAppliedHashRef.current) return;
      lastAppliedHashRef.current = nextHash;
      const decoded = decodeVrBoardFromHash(nextHash);
      if (!decoded) return;
      applyHandoffDocument(decoded);
    },
    [applyHandoffDocument],
  );

  useEffect(() => {
    if (location.hash) {
      applyVrBoardHash(location.hash);
    }
  }, [location.hash, applyVrBoardHash]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHashChange = () => {
      applyVrBoardHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [applyVrBoardHash]);

  // Same-origin local-file BroadcastChannel relay for `?handoffId=<id>` launches (e.g., from VS Code for Web / Ansatz)
  useEffect(() => {
    if (!handoffId || typeof BroadcastChannel === "undefined") return;
    let received = false;
    const channel = new BroadcastChannel(VR_HANDOFF_CHANNEL_NAME);

    const handleMessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const msg = data as Record<string, unknown>;
      if (msg["type"] !== "vr-handoff-payload") return;
      const msgHandoffId = typeof msg["handoffId"] === "string" ? msg["handoffId"].trim() : "";
      if (msgHandoffId !== handoffId) return;

      const nextDoc = resolveBroadcastHandoffDocument(msg);
      if (!nextDoc) return;

      received = true;
      setHandoffWarning(null);
      const parsedEnv = tryParseRotundaEnvironmentParam(msg["environment"]);
      if (parsedEnv) {
        setHandoffEnvironment(parsedEnv);
      }
      if (typeof msg["title"] === "string" && msg["title"].trim()) {
        setHandoffTitle(msg["title"].trim());
      }
      applyHandoffDocument(nextDoc);
      setSurfaceMode((prev) => (prev === "desktop-2d" ? "spatial-3d" : prev));
    };

    channel.onmessage = handleMessage;
    channel.postMessage({ type: "vr-handoff-request", handoffId });

    const timeoutId =
      typeof window !== "undefined" && !initialHash.includes("vrBoard=") && !boardOmitted
        ? window.setTimeout(() => {
            if (!received) {
              setHandoffWarning(
                "Local IDE file handoff timed out (cross-origin browser launch cannot relay unsaved local buffers). Showing default board.",
              );
            }
          }, 2500)
        : null;

    return () => {
      if (timeoutId !== null && typeof window !== "undefined") {
        window.clearTimeout(timeoutId);
      }
      channel.onmessage = null;
      channel.close();
    };
  }, [handoffId, applyHandoffDocument, initialHash, boardOmitted]);

  useEffect(() => {
    const onResize = () => {
      setViewport({
        width: window.innerWidth,
        height: Math.max(480, window.innerHeight - 48),
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const skipRemoteBoardSync = isHandoffActive;
    // Hydrate offline IndexedDB snapshot if present (skip when landing from a fresh VS Code #vrBoard or ?handoffId= handoff)
    if (!skipRemoteBoardSync) {
      void cache.load(activeBoardId).then((cachedDelta) => {
        if (cachedDelta) {
          store.mergeDelta(cachedDelta);
        }
      });
    }

    const unsub = store.onChange(() => {
      setDoc(store.toDocument());
      setPeers(store.getActivePeers());
      setCanUndo(store.canUndo());
      setCanRedo(store.canRedo());
      if (!skipRemoteBoardSync) {
        void cache.save(activeBoardId, store.exportFullDelta());
      }
    });

    if (skipRemoteBoardSync) {
      return () => {
        unsub();
      };
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/v1/canvas/stream`;
    const wsClient = new CanvasWebSocketClient({
      url: wsUrl,
      boardId: activeBoardId,
      userName: `Engineer ${peerId.slice(-4)}`,
      store,
      onConnectionChange: setConnected,
    });
    wsClient.connect();

    return () => {
      unsub();
      wsClient.dispose();
    };
  }, [activeBoardId, cache, isHandoffActive, peerId, store]);

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

  const handleExportJson = useCallback(() => {
    const json = serializeCanvasDocument(doc);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.id}.mscanvas`;
    a.click();
    URL.revokeObjectURL(url);
  }, [doc]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0b1120" }}>
      <header
        style={{
          height: 48,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#0f172a",
          borderBottom: "1px solid #1e293b",
          color: "#f8fafc",
          fontSize: 13,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <strong>Polyglot Spatial Canvas</strong>
          <span style={{ color: "#94a3b8" }}>{doc.name}</span>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 11,
              backgroundColor: connected ? "#05966933" : isVrHandoffBoard ? "#6366f133" : "#47556933",
              color: connected ? "#34d399" : isVrHandoffBoard ? "#a5b4fc" : "#94a3b8",
            }}
          >
            {connected
              ? `Live Multiplayer (${peers.length + 1} online)`
              : isVrHandoffBoard
                ? "VR Handoff · Local Mode"
                : "Offline-First Local Mode"}
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
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "#1e293b",
              color: canUndo ? "#f8fafc" : "#64748b",
              fontSize: 12,
              cursor: canUndo ? "pointer" : "not-allowed",
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
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "#1e293b",
              color: canRedo ? "#f8fafc" : "#64748b",
              fontSize: 12,
              cursor: canRedo ? "pointer" : "not-allowed",
              opacity: canRedo ? 1 : 0.55,
            }}
          >
            ↷ Redo
          </button>
          <button
            type="button"
            onClick={handleExportSvg}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#f8fafc",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Export SVG
          </button>
          <button
            type="button"
            onClick={handleExportJson}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#f8fafc",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Save .mscanvas
          </button>
          <select
            data-testid="canvas-scenario-select"
            aria-label="Engineering Scenario"
            title="Switch curated multi-physics VR & 2D engineering scenario"
            value={isHandoffActive ? "" : activeScenarioId}
            onChange={(e) => {
              if (e.target.value) {
                handleSelectScenario(e.target.value);
              }
            }}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#f8fafc",
              fontSize: 12,
              cursor: "pointer",
              maxWidth: 195,
            }}
          >
            {isHandoffActive && (
              <option value="" disabled>
                Custom VR Handoff
              </option>
            )}
            {ROTUNDA_SHOWCASE_SCENARIOS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.shortLabel}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="canvas-vr-rotunda-toggle"
            aria-pressed={surfaceMode !== "desktop-2d"}
            onClick={() => setSurfaceMode((prev) => (prev === "desktop-2d" ? "spatial-3d" : "desktop-2d"))}
            title={
              surfaceMode === "desktop-2d" ? "Enter 3D / WebXR Engineering Rotunda" : "Return to 2D Spatial Canvas"
            }
            style={{
              padding: "4px 11px",
              borderRadius: 6,
              border: surfaceMode !== "desktop-2d" ? "1px solid #38bdf8" : "1px solid rgba(99, 102, 241, 0.7)",
              background:
                surfaceMode !== "desktop-2d"
                  ? "linear-gradient(135deg, #0284c7, #6366f1)"
                  : "linear-gradient(135deg, rgba(99, 102, 241, 0.28), rgba(6, 182, 212, 0.24))",
              color: "#f8fafc",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              boxShadow: surfaceMode !== "desktop-2d" ? "0 0 12px rgba(56, 189, 248, 0.35)" : "none",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2" y="7" width="20" height="10" rx="3" />
              <path d="M9 17l1.5-2.5a1.8 1.8 0 0 1 3 0L15 17" />
              <circle cx="8" cy="12" r="1.5" />
              <circle cx="16" cy="12" r="1.5" />
            </svg>
            <span>VR Rotunda</span>
          </button>
        </div>
      </header>
      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {handoffWarning && (
          <div
            role="status"
            data-testid="vr-handoff-warning"
            style={{
              position: "absolute",
              top: 10,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 35,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid rgba(251, 191, 36, 0.55)",
              background: "rgba(120, 53, 15, 0.92)",
              color: "#fef3c7",
              fontSize: 12,
              maxWidth: "min(620px, calc(100% - 24px))",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
            }}
          >
            <span>{handoffWarning}</span>
            <button
              type="button"
              aria-label="Dismiss handoff notice"
              onClick={() => setHandoffWarning(null)}
              style={{
                border: "none",
                background: "transparent",
                color: "#fde68a",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13,
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </div>
        )}
        {surfaceMode === "desktop-2d" ? (
          <SharedScissor3DHost>
            <SpatialCanvas
              document={doc}
              peers={peers}
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
            initialEnvironment={initialEnvironment}
            simulationTime={simulationTime}
            onSimulationTimeChange={setSimulationTime}
            {...(!isHandoffActive && activeScenario
              ? {
                  models: activeScenario.models,
                  scenarios: ROTUNDA_SHOWCASE_SCENARIOS,
                  activeScenarioId,
                  onSelectScenario: handleSelectScenario,
                }
              : {})}
            peers={peers}
            title={searchParams.get("title") || handoffTitle || doc.name}
            onExitTo2D={() => setSurfaceMode("desktop-2d")}
            onMoveTile={handleTileMove}
            onCreateSpatialWire={handleCreateSpatialWire}
            onDiagramEdit={(_actions, ctx) => {
              const latestTile = store.toDocument().tiles[ctx.tileId];
              if (!latestTile) return;
              store.upsertTile({
                ...latestTile,
                viewState: {
                  ...latestTile.viewState,
                  diagramData: ctx.diagramData,
                  spatial3DLayout: ctx.spatial3DLayout,
                },
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
