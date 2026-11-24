// SPDX-License-Identifier: AGPL-3.0-or-later

import { sampleTelemetryFrame } from "@modelscript/cad";
import {
  createCanonicalPolyglotDemoBoard,
  SpatialSurfaceBridge,
  type CanvasDocument,
  type CanvasPeerPresence,
} from "@modelscript/canvas";
import type { DiagramEditAction } from "@modelscript/diagram/protocol";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useXR, XR } from "@react-three/xr";
import React, { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import * as THREE from "three";
import { createDefaultAssemblyVisibility } from "../cad-viewer/assembly-visibility.js";
import { AssemblyInspectorPanel } from "../cad-viewer/AssemblyInspectorPanel.js";
import { StudioSsaoPass } from "../cad-viewer/HeroCadMaterials.js";
import { SimulatorTelemetryHud } from "../cad-viewer/SimulatorTelemetryHud.js";
import type { GalleryComponentItem } from "../componentGalleryCatalog.js";
import { paintBoardToTextureCanvas } from "./board-painter.js";
import { DraftingPodium } from "./DraftingPodium.js";
import { getEnvironmentSceneBackdrop, RotundaEnvironment } from "./environments.js";
import { FloatingToolWings } from "./FloatingToolWings.js";
import { MultiplayerPresence } from "./MultiplayerPresence.js";
import {
  OCTOPUS_HUD_SPEC,
  OCTOPUS_MISSION_DURATION_SEC,
  OCTOPUS_SUBSYSTEMS,
  sampleOctopusTelemetryChannel,
} from "./OctopusShowcaseAssembly.js";
import type { SpatialNodePose3D } from "./spatial-diagram-state.js";
import type { SpatialInteractionLock } from "./spatial-interaction.js";
import { SpatialDiagramStage } from "./SpatialDiagramStage.js";
import { TurntableCarousel } from "./TurntableCarousel.js";
import {
  buildPodiumSpatialPlane,
  createInitialRotundaState,
  extractModelsFromCanvasDocument,
  PLINTH_CENTER_REAL_SCALE,
  PLINTH_CENTER_TABLETOP,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
  ROTUNDA_ENVIRONMENTS,
  rotundaReducer,
  wrapIndex,
  type EngineeringRotundaProps,
  type RotundaAction,
  type RotundaAnimationControllerLike,
  type RotundaCaeOverlay,
  type RotundaEnvironmentId,
  type RotundaModelEntry,
  type RotundaScenarioPreset,
  type RotundaState,
} from "./types.js";
import { XrControllerBindings, XrLocomotionRig } from "./xr-gestures.js";
import {
  enterXrSession,
  exitXrSession,
  getSharedXrStore,
  playRotundaCue,
  pulseXrHaptics,
  useXrCapabilities,
  type RotundaCueKind,
} from "./xr-session.js";

/** Stereo-safety rendering policy contract gating desktop-only GPU features out of active WebXR sessions. */
export interface RotundaRenderPolicy {
  readonly enablePmremIbl: boolean;
  readonly enableSsao: boolean;
  readonly enableDynamicShadows: boolean;
  readonly calloutLabelMode: "dom" | "sprite";
  readonly jetParticleBudget: number;
}

export function resolveRotundaRenderPolicy(isInXr: boolean): RotundaRenderPolicy {
  return {
    enablePmremIbl: true,
    enableSsao: !isInXr,
    enableDynamicShadows: !isInXr,
    calloutLabelMode: isInXr ? "sprite" : "dom",
    jetParticleBudget: isInXr ? 1000 : 3600,
  };
}

function detectWebGlSupport(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    return gl !== null && typeof (gl as Partial<WebGLRenderingContext>).getShaderPrecisionFormat === "function";
  } catch {
    return false;
  }
}

interface RotundaErrorBoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface RotundaErrorBoundaryState {
  hasError: boolean;
}

class RotundaErrorBoundary extends React.Component<RotundaErrorBoundaryProps, RotundaErrorBoundaryState> {
  override state: RotundaErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): RotundaErrorBoundaryState {
    return { hasError: true };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Headless / WebGL-unavailable Canvas2D preview surface used in JSDOM tests or
 * environments without WebGL context support. Uses the exact same board painter.
 */
function SpatialFallbackBoardCanvas({
  doc,
  simulationTime,
  activeHeroTileId,
}: {
  doc: CanvasDocument;
  simulationTime: number;
  activeHeroTileId: string | null;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = ROTUNDA_BOARD_CANVAS_WIDTH;
    canvas.height = ROTUNDA_BOARD_CANVAS_HEIGHT;
    paintBoardToTextureCanvas(canvas, doc, simulationTime, null, null, activeHeroTileId);
  }, [doc, simulationTime, activeHeroTileId]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="spatial-vr-fallback-canvas"
      style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
    />
  );
}

interface RotundaSceneContentsProps {
  doc: CanvasDocument;
  models: readonly RotundaModelEntry[];
  state: RotundaState;
  effectiveSimTime: number;
  controlledSimTime: boolean;
  bridge: SpatialSurfaceBridge;
  dispatch: React.Dispatch<RotundaAction>;
  activeScenario?: RotundaScenarioPreset | undefined;
  onCycleScenario?: (() => void) | undefined;
  peers?: readonly CanvasPeerPresence[] | undefined;
  animationController?: RotundaAnimationControllerLike | null | undefined;
  onTileSelect?: ((tileId: string) => void) | undefined;
  onMoveTile?: ((tileId: string, x: number, y: number) => void) | undefined;
  onCreateSpatialWire?: ((sourceTileId: string, targetTileId: string, sourceAnchor?: string) => void) | undefined;
  onSimulationTimeChange?: ((time: number) => void) | undefined;
  onHudStatusChange?: ((status: string | null) => void) | undefined;
  onCue: (kind: RotundaCueKind) => void;
  onExitVr?: (() => void) | undefined;
  onSelectEnvironment?: ((env: RotundaEnvironmentId) => void) | undefined;
  libraryCatalog?: readonly GalleryComponentItem[] | undefined;
  onDiagramEdit?:
    | ((
        actions: DiagramEditAction[],
        context: {
          tileId: string;
          spatial3DLayout: Record<string, SpatialNodePose3D>;
          diagramData: { nodes: unknown[]; edges: unknown[] };
        },
      ) => void)
    | undefined;
  onExposeDiagramActions?:
    | ((api: {
        undo: () => void;
        redo: () => void;
        autoLayerByDomain: () => void;
        flattenTo2D: () => void;
        canUndo: boolean;
        canRedo: boolean;
        nodeCount: number;
        edgeCount: number;
      }) => void)
    | undefined;
}

function RotundaSceneContents({
  doc,
  models,
  state,
  effectiveSimTime,
  controlledSimTime,
  bridge,
  dispatch,
  activeScenario,
  onCycleScenario,
  peers,
  animationController,
  onTileSelect,
  onMoveTile,
  onCreateSpatialWire,
  onSimulationTimeChange,
  onHudStatusChange,
  onCue,
  onExitVr,
  onSelectEnvironment,
  libraryCatalog,
  onDiagramEdit,
  onExposeDiagramActions,
}: RotundaSceneContentsProps): React.ReactElement {
  const isInXr = useXR((s) => Boolean(s.session));
  const isArSession = useXR((s) => s.mode === "immersive-ar");
  const [podiumLocked, setPodiumLocked] = useState(false);
  const [plinthDragging, setPlinthDragging] = useState(false);
  const [diagramLocked, setDiagramLocked] = useState(false);
  const diagramInteractionLockRef = useRef<SpatialInteractionLock>("none");

  const activeModel = models[wrapIndex(state.activeModelIndex, models.length)] ?? models[0];
  const activeHeroTileId = activeModel?.sourceTileId ?? null;
  const plinthCenter: [number, number, number] =
    state.scaleMode === "real-scale" ? PLINTH_CENTER_REAL_SCALE : PLINTH_CENTER_TABLETOP;

  // Resolve active schematic tile for the 3D Diagram Editor (explicit ID -> first schematic tile -> starter circuit)
  const activeDiagramTile = useMemo(() => {
    if (state.activeDiagramTileId && doc.tiles[state.activeDiagramTileId]) {
      return doc.tiles[state.activeDiagramTileId] ?? null;
    }
    const allTiles = Object.values(doc.tiles);
    return allTiles.find((t) => t.archetype === "schematic") ?? allTiles[0] ?? null;
  }, [doc.tiles, state.activeDiagramTileId]);

  // Zero-React-churn 72/90 FPS simulation clock: advance a mutable ref inside useFrame without any dispatch()
  const liveSimTimeRef = useRef<number>(effectiveSimTime);

  // Sync mutable simulation clock whenever externally controlled or explicitly scrubbed
  useEffect(() => {
    liveSimTimeRef.current = effectiveSimTime;
  }, [effectiveSimTime]);

  useFrame((_, rawDelta) => {
    if (!state.isPlaying || controlledSimTime) return;
    const dur = Math.max(
      0.1,
      activeModel?.kind === "octopus-rov" ? OCTOPUS_MISSION_DURATION_SEC : state.simulationDuration,
    );
    const next = (liveSimTimeRef.current + Math.min(rawDelta, 0.05)) % dur;
    liveSimTimeRef.current = next < 0 ? next + dur : next;
  });

  // Notify external simulation time listener when user scrubs inside VR wings
  const prevSimTimeRef = useRef(state.simulationTime);
  useEffect(() => {
    if (state.simulationTime !== prevSimTimeRef.current) {
      prevSimTimeRef.current = state.simulationTime;
      if (!controlledSimTime) {
        onSimulationTimeChange?.(state.simulationTime);
      }
    }
  }, [state.simulationTime, controlledSimTime, onSimulationTimeChange]);

  const handlePageModel = useCallback(
    (delta: number) => {
      dispatch({ type: "pageModel", delta, modelCount: models.length });
      onCue("page");
    },
    [dispatch, models.length, onCue],
  );

  const handleSelectModelIndex = useCallback(
    (index: number) => {
      dispatch({ type: "selectModelIndex", index, modelCount: models.length });
      onCue("page");
    },
    [dispatch, models.length, onCue],
  );

  const handleFocusTileOnPlinth = useCallback(
    (tileId: string) => {
      const matchedIdx = models.findIndex((m) => m.sourceTileId === tileId);
      if (matchedIdx >= 0) {
        dispatch({ type: "selectModelIndex", index: matchedIdx, modelCount: models.length });
        onCue("snap");
      }
    },
    [dispatch, models, onCue],
  );

  const handleTileSelect = useCallback(
    (tileId: string) => {
      dispatch({ type: "selectTile", tileId });
      onTileSelect?.(tileId);
    },
    [dispatch, onTileSelect],
  );

  const handlePlinthYawChange = useCallback(
    (yaw: number) => {
      dispatch({ type: "setPlinthYaw", yaw });
    },
    [dispatch],
  );

  const handleSectionCutOffsetChange = useCallback(
    (offset: number) => {
      dispatch({ type: "setSectionCutOffset", offset });
    },
    [dispatch],
  );

  const handleTogglePlaying = useCallback(() => {
    dispatch({ type: "togglePlaying" });
    onCue("click");
  }, [dispatch, onCue]);

  const handleToggleTilt = useCallback(() => {
    dispatch({ type: "togglePodiumTilt" });
    onCue("click");
  }, [dispatch, onCue]);

  const handleResetView = useCallback(() => {
    dispatch({ type: "resetPlinthView" });
    onCue("snap");
  }, [dispatch, onCue]);

  const isOctopus = activeModel?.kind === "octopus-rov";
  const backdrop = getEnvironmentSceneBackdrop(state.environment);
  const renderPolicy = useMemo(() => resolveRotundaRenderPolicy(isInXr), [isInXr]);
  const enableStudioSsao = renderPolicy.enableSsao && state.studioSsaoEnabled && state.environment !== "passthrough";
  const visibility = useMemo(
    () =>
      createDefaultAssemblyVisibility({
        isolatedSubsystemId: state.isolatedSubsystemId,
        ghostShellEnabled: state.ghostShellEnabled,
        showLabels: state.showLabels,
        autoTurntable: state.autoTurntable,
        explodeFactor: state.explodeFactor,
      }),
    [state.isolatedSubsystemId, state.ghostShellEnabled, state.showLabels, state.autoTurntable, state.explodeFactor],
  );

  const handleSelectSubsystem = useCallback(
    (subsystemId: string) => {
      dispatch({ type: "setIsolatedSubsystem", subsystemId });
      onCue("click");
    },
    [dispatch, onCue],
  );

  const handleFocusTileFullscreen = useCallback(
    (tileId: string | null) => {
      dispatch({ type: "setFocusedTile", tileId });
      onCue(tileId ? "snap" : "click");
    },
    [dispatch, onCue],
  );

  const handleToggleWristPalette = useCallback(() => {
    dispatch({ type: "toggleWristPalette" });
  }, [dispatch]);

  const handleSetWristPaletteOpen = useCallback(
    (open: boolean) => {
      dispatch({ type: "setWristPaletteOpen", open });
    },
    [dispatch],
  );

  const handleCycleSnapMode = useCallback(() => {
    dispatch({ type: "cycleDiagramSnapMode" });
  }, [dispatch]);

  return (
    <>
      {/* WebXR Standing Origin, Left-Stick Smooth Locomotion, Snap-Turn & 14m Floor Teleportation */}
      <XrLocomotionRig scaleMode={state.scaleMode} onCue={onCue} />

      {/* Native WebXR Controller Gestures (Orbital Flick, Plinth Zoom, Two-Hand Squeeze Explode, A/B/X/Y) */}
      <XrControllerBindings
        dispatch={dispatch}
        modelCount={models.length}
        explodeFactor={state.explodeFactor}
        scaleMode={state.scaleMode}
        onCue={onCue}
        interactionLockRef={diagramInteractionLockRef}
      />

      {/* Desktop-only optional Studio SSAO cavity shading (strictly disabled in WebXR & AR passthrough) */}
      {enableStudioSsao && (
        <StudioSsaoPass enabled={true} kernelRadius={0.22} minDistance={0.0015} maxDistance={0.09} />
      )}

      {/* 5 Photorealistic Procedural PBR Environments + Matched Equirectangular HDRI PMREM IBL */}
      <RotundaEnvironment environment={state.environment} plinthCenter={plinthCenter} scaleMode={state.scaleMode} />

      {/* Circular Metrology Plinth + Orbital 3D Model Carousel + Section Cut + CAE Overlays */}
      <TurntableCarousel
        models={models}
        activeModelIndex={state.activeModelIndex}
        carouselStep={state.carouselStep}
        plinthYaw={state.plinthYaw}
        plinthZoom={state.plinthZoom}
        explodeFactor={state.explodeFactor}
        caeOverlay={state.caeOverlay}
        renderStyle={state.renderStyle}
        scaleMode={state.scaleMode}
        sectionCutEnabled={state.sectionCutEnabled}
        sectionCutAxis={state.sectionCutAxis}
        sectionCutOffset={state.sectionCutOffset}
        simulationTime={effectiveSimTime}
        simulationTimeRef={liveSimTimeRef}
        isPlaying={state.isPlaying}
        animationController={animationController}
        visibility={visibility}
        autoTurntable={state.autoTurntable}
        isInXr={isInXr}
        dark={!backdrop.isLight}
        onSelectSubsystem={handleSelectSubsystem}
        onPageModel={handlePageModel}
        onSelectModelIndex={handleSelectModelIndex}
        onPlinthYawChange={handlePlinthYawChange}
        onSectionCutOffsetChange={handleSectionCutOffsetChange}
        onDraggingChange={setPlinthDragging}
      />

      {/* Full 3D WebXR & Desktop Volumetric Diagram Editor (Auto-Extruded 2D SVG Icons, Magnetic Wires & Wrist Library) */}
      <SpatialDiagramStage
        visible={state.diagramEditorEnabled}
        tile={activeDiagramTile}
        snapMode={state.diagramSnapMode}
        waferStyle={state.diagramWaferStyle}
        wristPaletteOpen={state.wristPaletteOpen}
        isPlaying={state.isPlaying}
        dark={!backdrop.isLight}
        libraryCatalog={libraryCatalog}
        interactionLockRef={diagramInteractionLockRef}
        onInteractionLockChange={setDiagramLocked}
        onToggleWristPalette={handleToggleWristPalette}
        onSetWristPaletteOpen={handleSetWristPaletteOpen}
        onCycleSnapMode={handleCycleSnapMode}
        onTogglePlaying={handleTogglePlaying}
        onDiagramEdit={onDiagramEdit}
        onHudStatusChange={onHudStatusChange}
        onCue={onCue}
        onExposeActions={onExposeDiagramActions}
      />

      {/* Ergonomic 45° Drafting Podium Hosting the Miro-like Infinite Canvas + Fiber-Optic Tethers */}
      <DraftingPodium
        document={doc}
        bridge={bridge}
        tiltDeg={state.diagramEditorEnabled ? 12 : state.podiumTiltDeg}
        simulationTime={effectiveSimTime}
        isPlaying={state.isPlaying}
        activeHeroTileId={activeHeroTileId}
        focusedTileId={state.focusedTileId}
        plinthWorldCenter={plinthCenter}
        visible={state.podiumVisible}
        onTileSelect={handleTileSelect}
        onFocusTileOnPlinth={handleFocusTileOnPlinth}
        onFocusTileFullscreen={handleFocusTileFullscreen}
        onMoveTile={onMoveTile}
        onCreateSpatialWire={onCreateSpatialWire}
        onPageModel={handlePageModel}
        onTogglePlaying={handleTogglePlaying}
        onToggleTilt={handleToggleTilt}
        onResetView={handleResetView}
        onHudStatusChange={onHudStatusChange}
        onInteractionLockChange={setPodiumLocked}
      />

      {/* Left & Right Curved Diegetic 3D Glass Tool Wings (Native WebXR & Desktop 3D) */}
      <FloatingToolWings
        state={{ ...state, simulationTime: effectiveSimTime }}
        activeModelTitle={activeModel?.title ?? "Model"}
        modelCount={models.length}
        visible={state.wingsVisible}
        dispatch={dispatch}
        activeScenarioLabel={activeScenario?.shortLabel ?? activeScenario?.label}
        onCycleScenario={onCycleScenario}
        onPlayCue={onCue}
        simulationTimeRef={liveSimTimeRef}
        telemetrySpec={isOctopus ? OCTOPUS_HUD_SPEC : null}
        telemetryProvider={isOctopus ? sampleOctopusTelemetryChannel : null}
        subsystems={isOctopus ? OCTOPUS_SUBSYSTEMS : undefined}
        onSeekSimulationTime={(t) => {
          liveSimTimeRef.current = t;
          onSimulationTimeChange?.(t);
        }}
        isInXr={isInXr}
        isArSession={isArSession}
        onExitVr={onExitVr}
        onSelectEnvironment={onSelectEnvironment}
      />

      {/* Remote Multiplayer VR Engineer Avatars & Live Podium/Plinth Laser Pointers */}
      {peers && peers.length > 0 && (
        <MultiplayerPresence
          peers={peers}
          bridge={bridge}
          podiumTiltDeg={state.podiumTiltDeg}
          plinthCenter={plinthCenter}
        />
      )}

      {/* Desktop 3D Spatial Orbit Controls (unmounted during WebXR so OrbitControls never fights stereo head tracking) */}
      {!isInXr && (
        <OrbitControls
          makeDefault
          enabled={!podiumLocked && !plinthDragging && !diagramLocked}
          target={[0, 1.24, -1.65]}
          minDistance={0.85}
          maxDistance={7.5}
          maxPolarAngle={Math.PI * 0.495}
          enableDamping
          dampingFactor={0.08}
        />
      )}
    </>
  );
}

const CAE_CYCLE_OPTIONS: readonly { id: RotundaCaeOverlay; label: string }[] = [
  { id: "none", label: "CAD" },
  { id: "fea-stress", label: "FEA" },
  { id: "cfd-flow", label: "CFD" },
  { id: "thermal", label: "Thermal" },
];

interface CaeLegendSpec {
  readonly title: string;
  readonly unit: string;
  readonly gradient: string;
  readonly ticks: readonly string[];
  readonly summary: string;
  readonly accent: string;
}

const CAE_LEGEND_META: Record<Exclude<RotundaCaeOverlay, "none">, CaeLegendSpec> = {
  "fea-stress": {
    title: "Von Mises Stress",
    unit: "MPa",
    gradient: "linear-gradient(90deg, #12369c 0%, #1582dc 24%, #10c4a0 45%, #8de028 65%, #f5b818 82%, #ea3a14 100%)",
    ticks: ["0", "65", "130", "195", "245"],
    summary: "Yield 412 MPa · Min FoS 1.68",
    accent: "#f97316",
  },
  "cfd-flow": {
    title: "Flow Velocity |U|",
    unit: "m/s",
    gradient: "linear-gradient(90deg, #102a78 0%, #1478e2 28%, #0ed2d0 55%, #34e070 76%, #facc15 90%, #f97316 100%)",
    ticks: ["6", "15", "24", "33", "42"],
    summary: "U∞ 18 m/s · Re 6.5×10⁵",
    accent: "#38bdf8",
  },
  thermal: {
    title: "Temperature Field",
    unit: "K",
    gradient: "linear-gradient(90deg, #1e1872 0%, #7c1f9c 28%, #dc2646 56%, #f97316 78%, #fde047 92%, #fffbeb 100%)",
    ticks: ["295", "325", "355", "385", "415"],
    summary: "Ambient 295 K · ΔT 120 K",
    accent: "#fb923c",
  },
};

/**
 * Engineering Rotunda — World-Class Unified VR & Desktop 3D Spatial Workstation.
 *
 * Combines:
 *  - Circular Metrology Plinth with Orbital 3D Model Carousel, CAD Explode, Section Cut,
 *    CAE overlays (FEA stress / CFD streamlines / thermal), and Tabletop ↔ 1:1 Floor Scale.
 *  - 45°-Angled Drafting Podium displaying the live Miro-like `.mscanvas` infinite canvas
 *    simultaneously with glowing fiber-optic tethers and 3D CADPort-to-2D wiring.
 *  - Curved Left & Right Floating 3D Diegetic Tool Wings (100% WebXR-native).
 *  - 5 Switchable Procedural Environments (Warehouse, Office, Outdoors, Dark Lab, MR Passthrough).
 */
export function EngineeringRotunda({
  document: providedDoc,
  models: providedModels,
  scenarios,
  activeScenarioId,
  onSelectScenario,
  mode = "spatial-3d",
  initialEnvironment = "outdoors",
  simulationTime: controlledSimulationTime,
  onSimulationTimeChange,
  onExitTo2D,
  exitTo2DLabel = "Return to 2D Canvas",
  onOpenExternalVr,
  onTileSelect,
  onMoveTile,
  onCreateSpatialWire,
  peers,
  animationController,
  title,
  hideDesktopHud = false,
  topOverlayInset = 12,
  initialDiagramEditorEnabled = false,
  libraryCatalog,
  onDiagramEdit,
}: EngineeringRotundaProps): React.ReactElement {
  const [internalScenarioId, setInternalScenarioId] = useState<string | undefined>(
    () => activeScenarioId ?? scenarios?.[0]?.id,
  );
  const effectiveScenarioId = activeScenarioId ?? internalScenarioId;

  const activeScenario = useMemo<RotundaScenarioPreset | undefined>(() => {
    if (!scenarios || scenarios.length === 0) return undefined;
    if (effectiveScenarioId) {
      const matched = scenarios.find((s) => s.id === effectiveScenarioId);
      if (matched) return matched;
    }
    return scenarios[0];
  }, [scenarios, effectiveScenarioId]);

  const activeScenarioIndex = useMemo(() => {
    if (!scenarios || !activeScenario) return 0;
    const idx = scenarios.findIndex((s) => s.id === activeScenario.id);
    return idx >= 0 ? idx : 0;
  }, [scenarios, activeScenario]);

  const defaultBoard = useMemo(() => createCanonicalPolyglotDemoBoard(), []);
  const scenarioBoard = useMemo<CanvasDocument | undefined>(
    () => (providedDoc ? undefined : activeScenario?.createDocument()),
    [providedDoc, activeScenario],
  );
  const baseDoc = providedDoc ?? scenarioBoard ?? defaultBoard;

  // Local fallback position, wire, and 3D diagram persistence so editing tiles, schematics,
  // and 3D extruded circuits always works seamlessly even when embedded without a host backend.
  const [tilePositionOverrides, setTilePositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [localAddedWires, setLocalAddedWires] = useState<Record<string, CanvasDocument["wires"][string]>>({});
  const [localDiagramOverrides, setLocalDiagramOverrides] = useState<
    Record<
      string,
      {
        diagramData: { nodes: unknown[]; edges: unknown[] };
        spatial3DLayout: Record<string, SpatialNodePose3D>;
      }
    >
  >({});

  useEffect(() => {
    setTilePositionOverrides({});
    setLocalAddedWires({});
    setLocalDiagramOverrides({});
  }, [baseDoc.id]);

  const doc = useMemo<CanvasDocument>(() => {
    const hasPosOverrides = Object.keys(tilePositionOverrides).length > 0;
    const hasWireOverrides = Object.keys(localAddedWires).length > 0;
    const hasDiagramOverrides = Object.keys(localDiagramOverrides).length > 0;
    if (!hasPosOverrides && !hasWireOverrides && !hasDiagramOverrides) return baseDoc;
    let nextTiles = baseDoc.tiles;
    if (hasPosOverrides || hasDiagramOverrides) {
      nextTiles = { ...baseDoc.tiles };
      for (const [tid, pos] of Object.entries(tilePositionOverrides)) {
        const existing = nextTiles[tid];
        if (!existing) continue;
        nextTiles[tid] = {
          ...existing,
          bounds: {
            ...existing.bounds,
            x: pos.x,
            y: pos.y,
          },
        };
      }
      for (const [tid, diag] of Object.entries(localDiagramOverrides)) {
        const existing = nextTiles[tid];
        if (!existing) continue;
        nextTiles[tid] = {
          ...existing,
          viewState: {
            ...existing.viewState,
            diagramData: diag.diagramData,
            spatial3DLayout: diag.spatial3DLayout,
          },
        };
      }
    }
    const nextWires = hasWireOverrides ? { ...baseDoc.wires, ...localAddedWires } : baseDoc.wires;
    return {
      ...baseDoc,
      tiles: nextTiles,
      wires: nextWires,
    };
  }, [baseDoc, tilePositionOverrides, localAddedWires, localDiagramOverrides]);

  const handleDiagramEdit = useCallback(
    (
      actions: DiagramEditAction[],
      context: {
        tileId: string;
        spatial3DLayout: Record<string, SpatialNodePose3D>;
        diagramData: { nodes: unknown[]; edges: unknown[] };
      },
    ) => {
      setLocalDiagramOverrides((prev) => ({
        ...prev,
        [context.tileId]: {
          diagramData: context.diagramData,
          spatial3DLayout: context.spatial3DLayout,
        },
      }));
      onDiagramEdit?.(actions, context);
    },
    [onDiagramEdit],
  );

  const [diagramHudApi, setDiagramHudApi] = useState<{
    undo: () => void;
    redo: () => void;
    autoLayerByDomain: () => void;
    flattenTo2D: () => void;
    canUndo: boolean;
    canRedo: boolean;
    nodeCount: number;
    edgeCount: number;
  } | null>(null);

  const handleMoveTile = useCallback(
    (tileId: string, x: number, y: number) => {
      if (onMoveTile) {
        onMoveTile(tileId, x, y);
      } else {
        setTilePositionOverrides((prev) => ({ ...prev, [tileId]: { x, y } }));
      }
    },
    [onMoveTile],
  );

  const handleCreateSpatialWire = useCallback(
    (sourceTileId: string, targetTileId: string, sourceAnchor?: string) => {
      if (onCreateSpatialWire) {
        onCreateSpatialWire(sourceTileId, targetTileId, sourceAnchor);
        return;
      }
      if (sourceTileId === targetTileId) return;
      const sourceTile = doc.tiles[sourceTileId];
      const targetTile = doc.tiles[targetTileId];
      if (!sourceTile || !targetTile) return;
      const targetAnchor =
        targetTile.pinnedAnchors?.find((a) => a.kind === "fmi-input" || a.kind === "parameter") ??
        targetTile.pinnedAnchors?.[0];
      const kind: CanvasDocument["wires"][string]["kind"] =
        targetTile.archetype === "table" || targetAnchor?.kind === "requirement"
          ? "requirement-trace"
          : targetAnchor?.kind === "fmi-input" || targetAnchor?.kind === "fmi-output" || targetTile.archetype === "fmu"
            ? "fmi-signal"
            : "shared-parameter";
      const wireId = `wire_spatial_${sourceTileId}_${targetTileId}_${Date.now()}`;
      setLocalAddedWires((prev) => ({
        ...prev,
        [wireId]: {
          id: wireId,
          kind,
          source: { tileId: sourceTileId, anchorPath: sourceAnchor ?? "CADPort" },
          target: { tileId: targetTileId, anchorPath: targetAnchor?.path ?? "in" },
          origin: "user-authored",
          status: "synced",
          liveValue: sourceTile.pinnedAnchors?.[0]?.currentValue ?? "3D CADPort",
        },
      }));
    },
    [onCreateSpatialWire, doc.tiles],
  );

  const models = useMemo<readonly RotundaModelEntry[]>(() => {
    if (providedModels && providedModels.length > 0) return providedModels;
    if (activeScenario && activeScenario.models.length > 0) return activeScenario.models;
    return extractModelsFromCanvasDocument(baseDoc);
  }, [providedModels, activeScenario, baseDoc]);

  const initialTelemetryEnabled = activeScenario?.id === "subsea-octopus" || models[0]?.kind === "octopus-rov";

  const [state, dispatch] = useReducer(
    rotundaReducer,
    {
      environment: initialEnvironment,
      simulationTime: controlledSimulationTime ?? 0,
      telemetryWingEnabled: initialTelemetryEnabled,
      diagramEditorEnabled: Boolean(initialDiagramEditorEnabled),
    },
    (init) => createInitialRotundaState(init),
  );

  // Clear full-screen block zoom if the active board switches and no longer contains the focused tile
  useEffect(() => {
    if (state.focusedTileId && !doc.tiles[state.focusedTileId]) {
      dispatch({ type: "setFocusedTile", tileId: null });
    }
  }, [doc.tiles, state.focusedTileId]);

  const effectiveSimTime = controlledSimulationTime !== undefined ? controlledSimulationTime : state.simulationTime;
  const activeModel = models[wrapIndex(state.activeModelIndex, models.length)] ?? models[0];
  const activeHeroTileId = activeModel?.sourceTileId ?? null;

  const bridge = useMemo(() => {
    const b = new SpatialSurfaceBridge(buildPodiumSpatialPlane(45));
    b.setMode(mode);
    return b;
  }, [mode]);

  const xrStore = useMemo(() => getSharedXrStore(), []);
  const xrCaps = useXrCapabilities();
  const [webglSupported] = useState<boolean>(detectWebGlSupport);
  const [hudStatus, setHudStatus] = useState<string | null>(null);

  const triggerCue = useCallback(
    (kind: RotundaCueKind) => {
      playRotundaCue(kind);
      pulseXrHaptics(xrStore, kind === "page" || kind === "snap" ? 0.3 : 0.16, 26);
    },
    [xrStore],
  );

  // Sync external initialEnvironment prop if it changes (e.g. URL query param navigation)
  useEffect(() => {
    dispatch({ type: "setEnvironment", environment: initialEnvironment });
  }, [initialEnvironment]);

  // Reset orbital carousel index cleanly whenever the host changes activeScenarioId externally
  const prevActiveScenarioIdRef = useRef<string | undefined>(activeScenarioId);
  useEffect(() => {
    if (activeScenarioId === prevActiveScenarioIdRef.current) return;
    prevActiveScenarioIdRef.current = activeScenarioId;
    const matched = scenarios?.find((s) => s.id === activeScenarioId);
    const targetCount = Math.max(1, matched?.models.length ?? models.length);
    dispatch({ type: "selectModelIndex", index: 0, modelCount: targetCount });
    dispatch({ type: "setFocusedTile", tileId: null });
    dispatch({
      type: "setTelemetryWing",
      enabled: matched?.id === "subsea-octopus" || matched?.models[0]?.kind === "octopus-rov",
    });
  }, [activeScenarioId, scenarios, models.length]);

  const preArEnvironmentRef = useRef<RotundaEnvironmentId>(
    initialEnvironment === "passthrough" ? "outdoors" : initialEnvironment,
  );
  const currentEnvRef = useRef<RotundaEnvironmentId>(state.environment);
  currentEnvRef.current = state.environment;
  const focusedTileIdRef = useRef<string | null>(state.focusedTileId);
  focusedTileIdRef.current = state.focusedTileId;

  // Restore previous non-passthrough environment automatically when an MR/XR session ends
  useEffect(() => {
    let prevSession = xrStore.getState().session;
    const unsubscribe = xrStore.subscribe((xrState) => {
      const nextSession = xrState.session;
      if (prevSession && !nextSession && currentEnvRef.current === "passthrough") {
        dispatch({ type: "setEnvironment", environment: preArEnvironmentRef.current });
      }
      prevSession = nextSession;
    });
    return () => {
      unsubscribe();
    };
  }, [xrStore]);

  const handleSelectEnvironment = useCallback(
    (env: RotundaEnvironmentId) => {
      const xrState = xrStore.getState();
      if (env === "passthrough" && xrState.session && xrState.mode === "immersive-vr") {
        setHudStatus("Passthrough requires Mixed Reality (MR) mode — exit VR and enter MR Passthrough.");
        triggerCue("tick");
        return;
      }
      if (env !== "passthrough") {
        preArEnvironmentRef.current = env;
      }
      dispatch({ type: "setEnvironment", environment: env });
      triggerCue("env");
    },
    [xrStore, triggerCue],
  );

  // Keyboard shortcuts for desktop 3D exploration (ArrowLeft/Right carousel, 1-5 envs, Space play/pause, R reset, Esc unzoom/exit)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;

      if (e.key === "Escape") {
        if (focusedTileIdRef.current) {
          e.preventDefault();
          dispatch({ type: "setFocusedTile", tileId: null });
          setHudStatus("Returned to full 45° desk overview");
          triggerCue("click");
          return;
        }
        if (onExitTo2D && !xrStore.getState().session) {
          e.preventDefault();
          onExitTo2D();
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        dispatch({ type: "pageModel", delta: -1, modelCount: models.length });
        triggerCue("page");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        dispatch({ type: "pageModel", delta: 1, modelCount: models.length });
        triggerCue("page");
      } else if (e.key === " ") {
        e.preventDefault();
        dispatch({ type: "togglePlaying" });
        triggerCue("click");
      } else if (e.key === "r" || e.key === "R") {
        dispatch({ type: "resetPlinthView" });
        triggerCue("snap");
      } else if (e.key >= "1" && e.key <= "5") {
        const idx = Number(e.key) - 1;
        const env = ROTUNDA_ENVIRONMENTS[idx];
        if (env) {
          handleSelectEnvironment(env.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [models.length, triggerCue, handleSelectEnvironment, onExitTo2D, xrStore]);

  const handleEnterVr = useCallback(() => {
    triggerCue("env");
    if (currentEnvRef.current === "passthrough") {
      dispatch({ type: "setEnvironment", environment: preArEnvironmentRef.current });
    }
    void enterXrSession(xrStore, "vr").then((result) => {
      if (!result.ok && result.error) {
        setHudStatus(result.error);
      }
    });
  }, [xrStore, triggerCue]);

  const handleEnterAr = useCallback(() => {
    if (currentEnvRef.current !== "passthrough") {
      preArEnvironmentRef.current = currentEnvRef.current;
    }
    dispatch({ type: "setEnvironment", environment: "passthrough" });
    triggerCue("env");
    void enterXrSession(xrStore, "ar").then((result) => {
      if (!result.ok) {
        dispatch({ type: "setEnvironment", environment: preArEnvironmentRef.current });
        if (result.error) {
          setHudStatus(result.error);
        }
      }
    });
  }, [xrStore, triggerCue]);

  const handleExitVr = useCallback(() => {
    triggerCue("snap");
    void exitXrSession(xrStore);
  }, [xrStore, triggerCue]);

  const handleSelectScenario = useCallback(
    (scenarioId: string) => {
      const target = scenarios?.find((s) => s.id === scenarioId);
      if (!target) return;
      if (activeScenarioId === undefined) {
        setInternalScenarioId(target.id);
      }
      const targetCount = Math.max(1, target.models.length);
      dispatch({ type: "selectModelIndex", index: 0, modelCount: targetCount });
      dispatch({ type: "setFocusedTile", tileId: null });
      dispatch({ type: "setEnvironment", environment: target.recommendedEnvironment });
      dispatch({ type: "setCaeOverlay", overlay: target.recommendedCaeOverlay ?? "none" });
      dispatch({ type: "setScaleMode", mode: target.recommendedScaleMode ?? "tabletop" });
      dispatch({
        type: "setTelemetryWing",
        enabled: target.id === "subsea-octopus" || target.models[0]?.kind === "octopus-rov",
      });
      triggerCue("env");
      onSelectScenario?.(target.id);
    },
    [scenarios, activeScenarioId, triggerCue, onSelectScenario],
  );

  const handleCycleScenario = useCallback(() => {
    if (!scenarios || scenarios.length < 2) return;
    const nextScenario = scenarios[wrapIndex(activeScenarioIndex + 1, scenarios.length)];
    if (nextScenario) {
      handleSelectScenario(nextScenario.id);
    }
  }, [scenarios, activeScenarioIndex, handleSelectScenario]);

  const isOctopusHero = activeModel?.kind === "octopus-rov";
  const [hudClockSec, setHudClockSec] = useState(effectiveSimTime);

  useEffect(() => {
    setHudClockSec(effectiveSimTime);
  }, [effectiveSimTime]);

  useEffect(() => {
    if (!state.telemetryWingEnabled || !isOctopusHero || !state.isPlaying || controlledSimulationTime !== undefined) {
      return;
    }
    const id = window.setInterval(() => {
      setHudClockSec((prev) => (prev + 0.1) % OCTOPUS_MISSION_DURATION_SEC);
    }, 100);
    return () => window.clearInterval(id);
  }, [state.telemetryWingEnabled, isOctopusHero, state.isPlaying, controlledSimulationTime]);

  const desktopOctopusFrame = useMemo(() => {
    if (!state.telemetryWingEnabled || !isOctopusHero || hideDesktopHud) return null;
    return sampleTelemetryFrame(OCTOPUS_HUD_SPEC, hudClockSec, null, sampleOctopusTelemetryChannel);
  }, [state.telemetryWingEnabled, isOctopusHero, hideDesktopHud, hudClockSec]);

  const desktopVisibility = useMemo(
    () =>
      createDefaultAssemblyVisibility({
        isolatedSubsystemId: state.isolatedSubsystemId,
        ghostShellEnabled: state.ghostShellEnabled,
        showLabels: state.showLabels,
        autoTurntable: state.autoTurntable,
        explodeFactor: state.explodeFactor,
      }),
    [state.isolatedSubsystemId, state.ghostShellEnabled, state.showLabels, state.autoTurntable, state.explodeFactor],
  );

  const hasScenarios = Boolean(scenarios && scenarios.length > 0);
  const backdrop = getEnvironmentSceneBackdrop(state.environment);
  const fallbackView = (
    <SpatialFallbackBoardCanvas doc={doc} simulationTime={effectiveSimTime} activeHeroTileId={activeHeroTileId} />
  );

  return (
    <div
      data-testid="spatial-vr-surface"
      data-rotunda="engineering-rotunda"
      data-surface-mode={mode}
      data-rotunda-env={state.environment}
      data-scale-mode={state.scaleMode}
      data-active-model={activeModel?.id ?? ""}
      data-cae-overlay={state.caeOverlay}
      data-focused-tile={state.focusedTileId ?? ""}
      data-diagram-editor={state.diagramEditorEnabled ? "open" : "closed"}
      data-wrist-palette={state.wristPaletteOpen ? "open" : "closed"}
      {...(activeScenario ? { "data-active-scenario": activeScenario.id } : {})}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: backdrop.background ?? "#060b16",
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {typeof window !== "undefined" ? (
        webglSupported ? (
          <RotundaErrorBoundary fallback={fallbackView}>
            <Canvas
              dpr={[1, 1.5]}
              camera={{ position: [0, 1.68, 0.72], fov: 50, near: 0.05, far: 160 }}
              gl={{
                antialias: true,
                alpha: true,
                localClippingEnabled: true,
                toneMapping: THREE.ACESFilmicToneMapping,
                toneMappingExposure: 1.04,
              }}
            >
              <Suspense fallback={null}>
                <XR store={xrStore}>
                  <Suspense fallback={null}>
                    <RotundaSceneContents
                      doc={doc}
                      models={models}
                      state={state}
                      effectiveSimTime={effectiveSimTime}
                      controlledSimTime={controlledSimulationTime !== undefined}
                      bridge={bridge}
                      dispatch={dispatch}
                      activeScenario={activeScenario}
                      onCycleScenario={scenarios && scenarios.length > 1 ? handleCycleScenario : undefined}
                      peers={peers}
                      animationController={animationController}
                      onTileSelect={onTileSelect}
                      onMoveTile={handleMoveTile}
                      onCreateSpatialWire={handleCreateSpatialWire}
                      onSimulationTimeChange={onSimulationTimeChange}
                      onHudStatusChange={setHudStatus}
                      onCue={triggerCue}
                      onExitVr={handleExitVr}
                      onSelectEnvironment={handleSelectEnvironment}
                      libraryCatalog={libraryCatalog}
                      onDiagramEdit={handleDiagramEdit}
                      onExposeDiagramActions={setDiagramHudApi}
                    />
                  </Suspense>
                </XR>
              </Suspense>
            </Canvas>
          </RotundaErrorBoundary>
        ) : (
          fallbackView
        )
      ) : (
        <div style={{ padding: 24, color: "#cbd5e1" }}>
          Engineering Rotunda — 3D Spatial / WebXR VR Workstation ({mode} · {state.environment})
        </div>
      )}

      {/* Top-Left Model Carousel Pill & Compact Scenario Switcher */}
      {!hideDesktopHud && (
        <div
          data-testid="rotunda-carousel-bar"
          style={{
            position: "absolute",
            top: topOverlayInset,
            left: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 10,
            border: "1px solid rgba(56, 189, 248, 0.35)",
            background: "rgba(9, 15, 29, 0.86)",
            backdropFilter: "blur(10px)",
            color: "#f8fafc",
            zIndex: 20,
            maxWidth: hasScenarios ? "min(64%, 740px)" : "46%",
          }}
        >
          {hasScenarios && scenarios && (
            <>
              <select
                data-testid="rotunda-scenario-select"
                aria-label="VR Scenario Preset"
                title={activeScenario?.description ?? "Switch VR engineering scenario"}
                value={activeScenario?.id ?? scenarios[0]?.id ?? ""}
                onChange={(e) => handleSelectScenario(e.target.value)}
                style={{
                  border: "1px solid rgba(56, 189, 248, 0.48)",
                  background: "rgba(15, 23, 42, 0.94)",
                  color: "#e0f2fe",
                  borderRadius: 6,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  maxWidth: 196,
                  flexShrink: 0,
                  outline: "none",
                }}
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id} style={{ background: "#0f172a", color: "#f8fafc" }}>
                    {scenario.label}
                  </option>
                ))}
              </select>
              <span style={{ color: "#334155", flexShrink: 0 }}>|</span>
            </>
          )}
          <button
            type="button"
            aria-label="Previous 3D model"
            onClick={() => {
              dispatch({ type: "pageModel", delta: -1, modelCount: models.length });
              triggerCue("page");
            }}
            style={{
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#e2e8f0",
              borderRadius: 6,
              padding: "3px 8px",
              fontSize: 12,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ◀
          </button>
          <div style={{ minWidth: 0, overflow: "hidden" }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {activeModel?.title ?? title ?? "Engineering Rotunda"}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#94a3b8",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Model {wrapIndex(state.activeModelIndex, models.length) + 1}/{models.length}
              {activeModel?.subtitle ? ` · ${activeModel.subtitle}` : ""}
            </div>
          </div>
          <button
            type="button"
            aria-label="Next 3D model"
            onClick={() => {
              dispatch({ type: "pageModel", delta: 1, modelCount: models.length });
              triggerCue("page");
            }}
            style={{
              border: "1px solid #334155",
              background: "#1e293b",
              color: "#e2e8f0",
              borderRadius: 6,
              padding: "3px 8px",
              fontSize: 12,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ▶
          </button>
        </div>
      )}

      {/* Top-Right WebXR Headset / Handoff & Exit Controls */}
      {!hideDesktopHud && (
        <div
          style={{
            position: "absolute",
            top: topOverlayInset,
            right: 12,
            display: "flex",
            gap: 8,
            alignItems: "center",
            zIndex: 20,
          }}
        >
          {xrCaps.vrSupported && (
            <button
              type="button"
              data-testid="rotunda-enter-vr-btn"
              onClick={handleEnterVr}
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(99, 102, 241, 0.35)",
              }}
            >
              Enter WebXR VR Headset
            </button>
          )}
          {xrCaps.arSupported && (
            <button
              type="button"
              data-testid="rotunda-enter-ar-btn"
              onClick={handleEnterAr}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid rgba(168, 85, 247, 0.55)",
                background: "rgba(88, 28, 135, 0.72)",
                color: "#f5d0fe",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              MR Passthrough
            </button>
          )}
          {onOpenExternalVr && (!xrCaps.vrSupported || xrCaps.isSandboxedIframe) && (
            <button
              type="button"
              data-testid="rotunda-open-external-vr-btn"
              onClick={() =>
                onOpenExternalVr({
                  environment: state.environment,
                  activeModelIndex: state.activeModelIndex,
                })
              }
              style={{
                padding: "6px 14px",
                borderRadius: 8,
                border: "none",
                background: "linear-gradient(135deg, #6366f1, #06b6d4)",
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
              title="Open in a top-level browser tab to launch WebXR VR/MR headset sessions"
            >
              Open in Browser for VR ↗
            </button>
          )}
          {onExitTo2D && (
            <button
              type="button"
              onClick={onExitTo2D}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid #334155",
                background: "rgba(15, 23, 42, 0.9)",
                color: "#f8fafc",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {exitTo2DLabel}
            </button>
          )}
        </div>
      )}

      {/* Subtle VR HUD Interaction Status Hint (preserved data-testid for existing test suite) */}
      <div
        data-testid="spatial-vr-hud-status"
        style={{
          position: "absolute",
          ...(hideDesktopHud
            ? { bottom: 12, left: 12 }
            : desktopOctopusFrame
              ? { top: topOverlayInset + 108, left: 196 }
              : { top: topOverlayInset + 52, left: 12 }),
          maxWidth: "min(620px, calc(100% - 24px))",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          padding: "4px 10px",
          borderRadius: 8,
          border: hudStatus ? "1px solid #38bdf8" : "1px solid rgba(51, 65, 85, 0.72)",
          background: "rgba(9, 15, 29, 0.78)",
          color: hudStatus ? "#f8fafc" : "#cbd5e1",
          fontSize: 11,
          pointerEvents: "none",
          zIndex: 20,
        }}
      >
        {hudStatus ??
          "Engineering Rotunda · Drag tiles or desk to pan · Click ⤢ or double-click block to zoom · Pull CADPort to wire"}
      </div>

      {/* Scientific CAE Colorbar Legend (FEA Von Mises Stress / CFD Flow Velocity / Thermal Field) */}
      {!hideDesktopHud &&
        state.caeOverlay !== "none" &&
        (() => {
          const legend = CAE_LEGEND_META[state.caeOverlay];
          return (
            <div
              data-testid="rotunda-cae-legend"
              data-cae-mode={state.caeOverlay}
              style={{
                position: "absolute",
                bottom: 64,
                right: desktopOctopusFrame ? 248 : 14,
                width: 244,
                padding: "9px 12px",
                borderRadius: 10,
                border: `1px solid ${legend.accent}66`,
                background: "rgba(9, 15, 29, 0.88)",
                backdropFilter: "blur(12px)",
                color: "#f8fafc",
                fontSize: 11,
                zIndex: 20,
                pointerEvents: "none",
                boxShadow: "0 8px 24px rgba(2, 6, 23, 0.42)",
              }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}
              >
                <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: "0.02em", color: "#f8fafc" }}>
                  {legend.title}
                </span>
                <span style={{ fontSize: 10, fontFamily: "monospace", color: legend.accent, fontWeight: 600 }}>
                  [{legend.unit}]
                </span>
              </div>
              <div
                style={{
                  height: 11,
                  borderRadius: 5,
                  background: legend.gradient,
                  border: "1px solid rgba(255, 255, 255, 0.18)",
                  marginBottom: 4,
                }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: "monospace",
                  fontSize: 9.5,
                  color: "#cbd5e1",
                  marginBottom: 5,
                }}
              >
                {legend.ticks.map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>
              <div
                style={{
                  fontSize: 9.5,
                  color: "#94a3b8",
                  fontFamily: "monospace",
                  borderTop: "1px solid rgba(51, 65, 85, 0.65)",
                  paddingTop: 4,
                }}
              >
                {legend.summary}
              </div>
            </div>
          );
        })()}

      {/* Bottom Compact Desktop Control Dock (mirrors the 3D Floating Tool Wings for mouse users) */}
      {!hideDesktopHud && (
        <div
          data-testid="rotunda-control-dock"
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 12,
            border: "1px solid rgba(148, 163, 184, 0.25)",
            background: "rgba(9, 15, 29, 0.88)",
            backdropFilter: "blur(12px)",
            color: "#e2e8f0",
            fontSize: 11,
            zIndex: 20,
            maxWidth: "calc(100% - 24px)",
          }}
        >
          {/* 5 Environment Presets */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {ROTUNDA_ENVIRONMENTS.map((env) => {
              const active = state.environment === env.id;
              return (
                <button
                  key={env.id}
                  type="button"
                  data-testid={`rotunda-env-${env.id}`}
                  onClick={() => handleSelectEnvironment(env.id)}
                  title={env.description}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 999,
                    border: active ? `1px solid ${env.accentColor}` : "1px solid #334155",
                    background: active ? "rgba(56, 189, 248, 0.18)" : "rgba(15, 23, 42, 0.7)",
                    color: active ? "#f8fafc" : "#94a3b8",
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {env.shortLabel}
                </button>
              );
            })}
          </div>

          <span style={{ color: "#334155" }}>|</span>

          {/* Explode Slider */}
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#cbd5e1" }}>
            <span>Explode</span>
            <input
              type="range"
              aria-label="CAD Explode Factor"
              min={0}
              max={100}
              value={Math.round(state.explodeFactor * 100)}
              onChange={(e) => dispatch({ type: "setExplode", factor: Number(e.target.value) / 100 })}
              style={{ width: 68, accentColor: "#38bdf8", cursor: "pointer" }}
            />
          </label>

          {/* CAE Overlays */}
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {CAE_CYCLE_OPTIONS.map((opt) => {
              const active = state.caeOverlay === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`rotunda-cae-${opt.id}`}
                  onClick={() => {
                    dispatch({ type: "setCaeOverlay", overlay: opt.id });
                    triggerCue("click");
                  }}
                  style={{
                    padding: "3px 7px",
                    borderRadius: 6,
                    border: active ? "1px solid #38bdf8" : "1px solid #334155",
                    background: active ? "rgba(56, 189, 248, 0.2)" : "transparent",
                    color: active ? "#f8fafc" : "#94a3b8",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <span style={{ color: "#334155" }}>|</span>

          {/* Section Cut, 1:1 Scale, Podium & Wings Toggles */}
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "toggleSectionCut" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: state.sectionCutEnabled ? "1px solid #06b6d4" : "1px solid #334155",
              background: state.sectionCutEnabled ? "rgba(6, 182, 212, 0.22)" : "transparent",
              color: state.sectionCutEnabled ? "#67e8f9" : "#cbd5e1",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Cut
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "toggleScaleMode" });
              triggerCue("snap");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: state.scaleMode === "real-scale" ? "1px solid #f59e0b" : "1px solid #334155",
              background: state.scaleMode === "real-scale" ? "rgba(245, 158, 11, 0.2)" : "transparent",
              color: state.scaleMode === "real-scale" ? "#fcd34d" : "#cbd5e1",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {state.scaleMode === "real-scale" ? "1:1 Scale" : "Tabletop"}
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "togglePodiumVisible" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: state.podiumVisible ? "1px solid #38bdf8" : "1px solid #334155",
              background: state.podiumVisible ? "rgba(56, 189, 248, 0.16)" : "transparent",
              color: state.podiumVisible ? "#e0f2fe" : "#94a3b8",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            45° Desk
          </button>
          <button
            type="button"
            onClick={() => {
              dispatch({ type: "toggleWingsVisible" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: state.wingsVisible ? "1px solid #8b5cf6" : "1px solid #334155",
              background: state.wingsVisible ? "rgba(139, 92, 246, 0.18)" : "transparent",
              color: state.wingsVisible ? "#ede9fe" : "#94a3b8",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            3D Menus
          </button>
          <button
            type="button"
            data-testid="rotunda-toggle-ghost"
            onClick={() => {
              dispatch({ type: "toggleGhostShell" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: state.ghostShellEnabled ? "1px solid #06b6d4" : "1px solid #334155",
              background: state.ghostShellEnabled ? "rgba(6, 182, 212, 0.2)" : "transparent",
              color: state.ghostShellEnabled ? "#a5f3fc" : "#94a3b8",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Ghost Shell
          </button>
          <button
            type="button"
            data-testid="rotunda-toggle-labels"
            onClick={() => {
              dispatch({ type: "toggleShowLabels" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: state.showLabels ? "1px solid #f97316" : "1px solid #334155",
              background: state.showLabels ? "rgba(249, 115, 22, 0.2)" : "transparent",
              color: state.showLabels ? "#fed7aa" : "#94a3b8",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Labels
          </button>
          <button
            type="button"
            data-testid="rotunda-toggle-turntable"
            onClick={() => {
              dispatch({ type: "toggleAutoTurntable" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: state.autoTurntable ? "1px solid #22c55e" : "1px solid #334155",
              background: state.autoTurntable ? "rgba(34, 197, 94, 0.2)" : "transparent",
              color: state.autoTurntable ? "#bbf7d0" : "#94a3b8",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Turntable
          </button>
          <button
            type="button"
            data-testid="rotunda-toggle-telemetry"
            onClick={() => {
              dispatch({ type: "toggleTelemetryWing" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: state.telemetryWingEnabled ? "1px solid #f97316" : "1px solid #334155",
              background: state.telemetryWingEnabled ? "rgba(249, 115, 22, 0.22)" : "transparent",
              color: state.telemetryWingEnabled ? "#ffedd5" : "#94a3b8",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Field HUD
          </button>
          <button
            type="button"
            data-testid="rotunda-toggle-diagram-3d"
            title="Toggle full 3D WebXR Volumetric Diagram Editor (auto-extruded 2D SVG icons, magnetic 3D wiring & wrist library)"
            onClick={() => {
              dispatch({ type: "toggleDiagramEditor" });
              triggerCue("env");
            }}
            style={{
              padding: "3px 9px",
              borderRadius: 6,
              border: state.diagramEditorEnabled ? "1px solid #22d3ee" : "1px solid rgba(34, 211, 238, 0.45)",
              background: state.diagramEditorEnabled
                ? "linear-gradient(135deg, rgba(2, 132, 199, 0.85), rgba(6, 182, 212, 0.85))"
                : "rgba(6, 182, 212, 0.14)",
              color: state.diagramEditorEnabled ? "#ffffff" : "#67e8f9",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ✦ 3D Diagram
          </button>
          <button
            type="button"
            data-testid="rotunda-toggle-ao"
            disabled={state.environment === "passthrough"}
            title={
              state.environment === "passthrough"
                ? "Studio SSAO is disabled in AR passthrough to preserve real-room alpha"
                : "Toggle desktop-only Studio SSAO cavity shading (automatically disabled in WebXR)"
            }
            onClick={() => {
              dispatch({ type: "toggleStudioSsao" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border:
                state.studioSsaoEnabled && state.environment !== "passthrough"
                  ? "1px solid #38bdf8"
                  : "1px solid #334155",
              background:
                state.studioSsaoEnabled && state.environment !== "passthrough"
                  ? "rgba(56, 189, 248, 0.22)"
                  : "transparent",
              color: state.environment === "passthrough" ? "#475569" : state.studioSsaoEnabled ? "#e0f2fe" : "#94a3b8",
              fontSize: 11,
              cursor: state.environment === "passthrough" ? "not-allowed" : "pointer",
            }}
          >
            AO
          </button>
        </div>
      )}

      {/* Floating Desktop 3D Diagram Studio Bar (mirrors the WebXR Wrist Tool for desktop 3D parity) */}
      {!hideDesktopHud && state.diagramEditorEnabled && (
        <div
          data-testid="rotunda-diagram-studio-bar"
          style={{
            position: "absolute",
            bottom: 58,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            borderRadius: 10,
            border: "1px solid rgba(34, 211, 238, 0.45)",
            background: "rgba(9, 15, 29, 0.90)",
            backdropFilter: "blur(10px)",
            color: "#e2e8f0",
            fontSize: 11,
            zIndex: 21,
          }}
        >
          <button
            type="button"
            data-testid="rotunda-toggle-wrist-library"
            onClick={() => {
              dispatch({ type: "toggleWristPalette" });
              triggerCue(state.wristPaletteOpen ? "click" : "env");
            }}
            style={{
              padding: "3px 9px",
              borderRadius: 6,
              border: state.wristPaletteOpen ? "1px solid #22d3ee" : "1px solid #0284c7",
              background: state.wristPaletteOpen ? "#0284c7" : "rgba(2, 132, 199, 0.22)",
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {state.wristPaletteOpen ? "✕ Close Library" : "+ Library (L)"}
          </button>
          <span style={{ color: "#334155" }}>|</span>
          <button
            type="button"
            data-testid="rotunda-cycle-snap-mode"
            onClick={() => {
              dispatch({ type: "cycleDiagramSnapMode" });
              triggerCue("tick");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "rgba(30, 41, 59, 0.8)",
              color: "#bae6fd",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Snap:{" "}
            {state.diagramSnapMode === "free-3d"
              ? "Free 3D"
              : state.diagramSnapMode === "domain-layers"
                ? "Domain Layers"
                : state.diagramSnapMode === "grid-5cm"
                  ? "5cm Grid"
                  : "Flat 2D"}
          </button>
          <button
            type="button"
            data-testid="rotunda-toggle-wafer-style"
            onClick={() => {
              dispatch({ type: "toggleDiagramWaferStyle" });
              triggerCue("click");
            }}
            style={{
              padding: "3px 8px",
              borderRadius: 6,
              border: "1px solid #334155",
              background: "rgba(30, 41, 59, 0.8)",
              color: "#cbd5e1",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {state.diagramWaferStyle === "tactile-tile" ? "Wafer Tile" : "Pure 3D SVG"}
          </button>
          {diagramHudApi && (
            <>
              <button
                type="button"
                data-testid="rotunda-diagram-autolayer"
                onClick={() => diagramHudApi.autoLayerByDomain()}
                style={{
                  padding: "3px 7px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Layers
              </button>
              <button
                type="button"
                data-testid="rotunda-diagram-flatten"
                onClick={() => diagramHudApi.flattenTo2D()}
                style={{
                  padding: "3px 7px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: "transparent",
                  color: "#94a3b8",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                Flat 2D
              </button>
              <span style={{ color: "#334155" }}>|</span>
              <button
                type="button"
                data-testid="rotunda-diagram-undo"
                disabled={!diagramHudApi.canUndo}
                onClick={() => {
                  diagramHudApi.undo();
                  triggerCue("snap");
                }}
                style={{
                  padding: "3px 7px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: "transparent",
                  color: diagramHudApi.canUndo ? "#e2e8f0" : "#475569",
                  fontSize: 11,
                  cursor: diagramHudApi.canUndo ? "pointer" : "not-allowed",
                }}
              >
                ↶
              </button>
              <button
                type="button"
                data-testid="rotunda-diagram-redo"
                disabled={!diagramHudApi.canRedo}
                onClick={() => {
                  diagramHudApi.redo();
                  triggerCue("snap");
                }}
                style={{
                  padding: "3px 7px",
                  borderRadius: 6,
                  border: "1px solid #334155",
                  background: "transparent",
                  color: diagramHudApi.canRedo ? "#e2e8f0" : "#475569",
                  fontSize: 11,
                  cursor: diagramHudApi.canRedo ? "pointer" : "not-allowed",
                }}
              >
                ↷
              </button>
              <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: 10 }}>
                {diagramHudApi.nodeCount} parts · {diagramHudApi.edgeCount} wires
              </span>
            </>
          )}
        </div>
      )}

      {/* Desktop Field-Simulator Telemetry HUD + Subsystem Inspector + Operation Log Scrubber for Pelagos OC-8 */}
      {desktopOctopusFrame && (
        <SimulatorTelemetryHud
          frame={desktopOctopusFrame}
          dark={!backdrop.isLight}
          isPlaying={state.isPlaying}
          topOffsetPx={62}
          bottomOffsetPx={60}
          onTogglePlaying={() => {
            dispatch({ type: "togglePlaying" });
            triggerCue("click");
          }}
          onSeek={(t) => {
            setHudClockSec(t);
            dispatch({ type: "setSimulationTime", time: t });
            onSimulationTimeChange?.(t);
            triggerCue("tick");
          }}
          rightExtraSlot={
            <AssemblyInspectorPanel
              subsystems={OCTOPUS_SUBSYSTEMS}
              visibility={desktopVisibility}
              dark={!backdrop.isLight}
              onChangeVisibility={(next) => {
                if (next.isolatedSubsystemId !== state.isolatedSubsystemId) {
                  dispatch({ type: "setIsolatedSubsystem", subsystemId: next.isolatedSubsystemId });
                }
                if (next.ghostShellEnabled !== state.ghostShellEnabled) {
                  dispatch({ type: "setGhostShell", enabled: next.ghostShellEnabled });
                }
                if (next.showLabels !== state.showLabels) {
                  dispatch({ type: "setShowLabels", visible: next.showLabels });
                }
                if (next.autoTurntable !== state.autoTurntable) {
                  dispatch({ type: "toggleAutoTurntable" });
                }
                if (Math.abs(next.explodeFactor - state.explodeFactor) > 1e-4) {
                  dispatch({ type: "setExplode", factor: next.explodeFactor });
                }
              }}
            />
          }
        />
      )}
    </div>
  );
}

export default EngineeringRotunda;
