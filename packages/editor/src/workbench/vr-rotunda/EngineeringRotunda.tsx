// SPDX-License-Identifier: AGPL-3.0-or-later

import { sampleTelemetryFrame } from "@modelscript/cad";
import {
  createCanonicalPolyglotDemoBoard,
  SpatialSurfaceBridge,
  type CanvasBoardThemeId,
  type CanvasDocument,
  type CanvasPeerPresence,
} from "@modelscript/canvas";
import type { DiagramEditAction } from "@modelscript/diagram/protocol";
import { Canvas, useFrame } from "@react-three/fiber";
import { useXR, XR } from "@react-three/xr";
import React, { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import * as THREE from "three";
import { createDefaultAssemblyVisibility } from "../cad-viewer/assembly-visibility.js";
import { AssemblyInspectorPanel } from "../cad-viewer/AssemblyInspectorPanel.js";
import { StudioSsaoPass } from "../cad-viewer/HeroCadMaterials.js";
import { SimulatorTelemetryHud } from "../cad-viewer/SimulatorTelemetryHud.js";
import type { GalleryComponentItem } from "../componentGalleryCatalog.js";
import { RotundaAmbientSoundscape } from "./ambient-audio.js";
import { paintBoardToTextureCanvas } from "./board-painter.js";
import { resolveDiagramLanguageTheme } from "./diagram-language-theme.js";
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
import { RotundaContextDock } from "./RotundaContextDock.js";
import { RotundaStageCameraRig } from "./RotundaStageCameraRig.js";
import type { SpatialNodePose3D } from "./spatial-diagram-state.js";
import type { SpatialInteractionLock } from "./spatial-interaction.js";
import { SpatialDiagramStage } from "./SpatialDiagramStage.js";
import { TurntableCarousel } from "./TurntableCarousel.js";
import {
  buildDeskSpatialPlane,
  createInitialRotundaState,
  DEFAULT_DESK_THEME,
  DEFAULT_PODIUM_TILT_DEG,
  extractModelsFromCanvasDocument,
  getRotundaPlinthPresentation,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
  ROTUNDA_ENVIRONMENTS,
  rotundaReducer,
  wrapIndex,
  type EngineeringRotundaProps,
  type RotundaAction,
  type RotundaActiveView,
  type RotundaAnimationControllerLike,
  type RotundaCaeOverlay,
  type RotundaEnvironmentId,
  type RotundaInspectorData,
  type RotundaModelEntry,
  type RotundaScenarioPreset,
  type RotundaSimulationData,
  type RotundaState,
  type RotundaWorkspaceFile,
} from "./types.js";
import { VrSimulationPanel3D } from "./VrSimulationPanel3D.js";
import { VrSpatialNavBar3D } from "./VrSpatialNavBar3D.js";
import { FloatingCodePanel3D, VrFileCarousel3D, VrInspectorPanel3D } from "./VrWorkspacePanels3D.js";
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
  boardTheme,
}: {
  doc: CanvasDocument;
  simulationTime: number;
  activeHeroTileId: string | null;
  boardTheme: CanvasBoardThemeId;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = ROTUNDA_BOARD_CANVAS_WIDTH;
    canvas.height = ROTUNDA_BOARD_CANVAS_HEIGHT;
    paintBoardToTextureCanvas(canvas, doc, simulationTime, null, null, activeHeroTileId, undefined, {
      theme: boardTheme,
    });
  }, [doc, simulationTime, activeHeroTileId, boardTheme]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="spatial-vr-fallback-canvas"
      style={{ width: "100%", height: "100%", display: "block", objectFit: "contain" }}
    />
  );
}

/**
 * Reads the headset (eye) height once per XR session — after ~0.6 s of plausible tracking —
 * and reports it so the drafting desk can be re-seated at `clamp(headY − 0.62, 0.65, 1.05)`.
 * Guarded: ignores implausible poses (tracking not yet initialized) and gives up after ~6 s.
 */
function XrDeskHeightAutoCalibrator({ onCalibrate }: { onCalibrate: (headY: number) => void }): null {
  const session = useXR((s) => s.session);
  const doneRef = useRef(false);
  const elapsedRef = useRef(0);
  const stableRef = useRef(0);
  const tmpRef = useRef(new THREE.Vector3());
  const onCalibrateRef = useRef(onCalibrate);
  onCalibrateRef.current = onCalibrate;

  useEffect(() => {
    doneRef.current = false;
    elapsedRef.current = 0;
    stableRef.current = 0;
  }, [session]);

  useFrame((state, delta) => {
    if (!session || doneRef.current) return;
    elapsedRef.current += delta;
    if (elapsedRef.current > 6) {
      doneRef.current = true;
      return;
    }
    state.camera.getWorldPosition(tmpRef.current);
    const headY = tmpRef.current.y;
    if (Number.isFinite(headY) && headY > 0.9 && headY < 2.4) {
      stableRef.current += delta;
      if (stableRef.current >= 0.6) {
        doneRef.current = true;
        onCalibrateRef.current(headY);
      }
    } else {
      stableRef.current = 0;
    }
  });

  return null;
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
  languageId?: string | undefined;
  diagramType?: string | undefined;
  sourceCode?: string | undefined;
  workspaceFiles?: readonly RotundaWorkspaceFile[] | undefined;
  activeFilePath?: string | undefined;
  onSelectWorkspaceFile?: ((filePath: string) => void) | undefined;
  inspectorData?: RotundaInspectorData | undefined;
  simulationData?: RotundaSimulationData | undefined;
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
  availableViews: readonly RotundaActiveView[];
  onSelectView: (view: RotundaActiveView) => void;
  onToggleSplitCode: () => void;
  codeScrollCommand?: { readonly action: "top" | "bottom"; readonly seq: number } | null | undefined;
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
  languageId,
  diagramType,
  sourceCode,
  workspaceFiles,
  activeFilePath,
  onSelectWorkspaceFile,
  inspectorData,
  simulationData,
  libraryCatalog,
  onDiagramEdit,
  onExposeDiagramActions,
  availableViews,
  onSelectView,
  onToggleSplitCode,
  codeScrollCommand,
}: RotundaSceneContentsProps): React.ReactElement {
  const isInXr = useXR((s) => Boolean(s.session));
  const isArSession = useXR((s) => s.mode === "immersive-ar");
  const [podiumLocked, setPodiumLocked] = useState(false);
  const [plinthDragging, setPlinthDragging] = useState(false);
  const [diagramLocked, setDiagramLocked] = useState(false);
  const [codeFocusLine, setCodeFocusLine] = useState<number | null>(null);
  const diagramInteractionLockRef = useRef<SpatialInteractionLock>("none");

  const activeModel = models[wrapIndex(state.activeModelIndex, models.length)] ?? models[0];
  const activeHeroTileId = activeModel?.sourceTileId ?? null;
  const plinthPresentation = getRotundaPlinthPresentation(state.scaleMode);
  const plinthCenter: [number, number, number] = plinthPresentation.center;
  const effectivePodiumTiltDeg = state.diagramEditorEnabled ? 12 : state.podiumTiltDeg;

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

  const handleCycleDeskScale = useCallback(() => {
    dispatch({ type: "cycleDeskScale" });
    onCue("click");
  }, [dispatch, onCue]);

  const handleRecalibrateDeskHeight = useCallback(
    (headY: number) => {
      dispatch({ type: "recalibrateDeskHeight", headY });
      onCue("snap");
    },
    [dispatch, onCue],
  );

  const handleResetDeskHeight = useCallback(() => {
    dispatch({ type: "resetDeskHeight" });
    onCue("click");
  }, [dispatch, onCue]);

  const handleCycleDeskTheme = useCallback(() => {
    dispatch({ type: "cycleDeskTheme" });
    onCue("click");
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

  const handleToggleDiagramEditor = useCallback(() => {
    onSelectView(state.activeView === "diagram" ? "3d" : "diagram");
    onCue("arena-rotate");
  }, [onSelectView, state.activeView, onCue]);

  const handleCycleSnapMode = useCallback(() => {
    dispatch({ type: "cycleDiagramSnapMode" });
  }, [dispatch]);

  const is3dStage = state.activeView === "3d";
  const isDiagramStage = state.activeView === "diagram";
  const isSimulationStage = state.activeView === "simulation";
  const isInspectorStage = state.activeView === "inspector";
  const isCodeStage = state.activeView === "code";
  const showCodePanel = isCodeStage || state.splitCodeOpen;
  const isStockroomOpen = isDiagramStage && state.wristPaletteOpen;

  // Dedicated 180° Rotunda Mode Turntable:
  //   - 0° hemisphere (-Z): 3D Metrology Plinth + optional Drafting Podium + Side Wings
  //   - 180° hemisphere (+Z): Dedicated wide-open 3D Diagram Stage (zero podium clutter)
  // Activating Diagram Mode smoothly rotates the arena 180° around the standing engineer.
  const arenaGroupRef = useRef<THREE.Group | null>(null);
  const targetArenaYaw = isDiagramStage ? Math.PI : 0;

  useFrame((_s, rawDelta) => {
    const grp = arenaGroupRef.current;
    if (!grp) return;
    const diff = targetArenaYaw - grp.rotation.y;
    if (Math.abs(diff) < 0.0008) {
      if (grp.rotation.y !== targetArenaYaw) grp.rotation.y = targetArenaYaw;
      return;
    }
    const alpha = 1 - Math.exp(-Math.min(rawDelta, 0.05) * 6.5);
    grp.rotation.y += diff * alpha;
  });

  return (
    <>
      {/* One-shot desk height calibration from the headset's eye height at XR session start */}
      <XrDeskHeightAutoCalibrator onCalibrate={handleRecalibrateDeskHeight} />

      {/* WebXR Standing Origin, Left-Stick Smooth Locomotion, Snap-Turn & 14m Floor Teleportation */}
      <XrLocomotionRig scaleMode={state.scaleMode} stockroomOpen={isStockroomOpen} onCue={onCue} />

      {/* Native WebXR Controller Gestures (Orbital Flick, Plinth Zoom, Two-Hand Squeeze Explode, A/B/X/Y) */}
      <XrControllerBindings
        dispatch={dispatch}
        modelCount={models.length}
        explodeFactor={state.explodeFactor}
        scaleMode={state.scaleMode}
        diagramEditorEnabled={isDiagramStage}
        stockroomOpen={isStockroomOpen}
        onCue={onCue}
        interactionLockRef={diagramInteractionLockRef}
      />

      {/* Desktop-only optional Studio SSAO cavity shading (strictly disabled in WebXR & AR passthrough) */}
      {enableStudioSsao && (
        <StudioSsaoPass enabled={true} kernelRadius={0.22} minDistance={0.0015} maxDistance={0.09} />
      )}

      {/* 6 Photoreal Procedural Environments (Future Atrium hero + 5 presets) with matched IBL */}
      <RotundaEnvironment environment={state.environment} plinthCenter={plinthCenter} scaleMode={state.scaleMode} />

      {/* Rotating 180° Rotunda Mode Arena: 3D Plinth Stage at 0°, Dedicated 3D Diagram Stage at 180° */}
      <group ref={arenaGroupRef} name="rotunda-mode-arena">
        {/* 0° Hemisphere: Circular Metrology Plinth + Orbital 3D Model Carousel (strictly visible only in 3D Stage) */}
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
          visible={is3dStage}
          onSelectSubsystem={handleSelectSubsystem}
          onPageModel={handlePageModel}
          onSelectModelIndex={handleSelectModelIndex}
          onPlinthYawChange={handlePlinthYawChange}
          onSectionCutOffsetChange={handleSectionCutOffsetChange}
          onDraggingChange={setPlinthDragging}
        />

        {/* 0° Hemisphere: Ergonomic Drafting Podium Hosting the Spread Blueprint Canvas (only in 3D Stage) */}
        <DraftingPodium
          document={doc}
          bridge={bridge}
          tiltDeg={effectivePodiumTiltDeg}
          deskScale={state.deskScale}
          deskHeightY={state.deskHeightY}
          boardTheme={state.deskTheme}
          onCycleDeskScale={handleCycleDeskScale}
          onCycleBoardTheme={handleCycleDeskTheme}
          onRecalibrateDeskHeight={handleRecalibrateDeskHeight}
          onResetDeskHeight={handleResetDeskHeight}
          showPlinthTethers={is3dStage}
          diagramEditorEnabled={isDiagramStage}
          stockroomOpen={isStockroomOpen}
          onToggleDiagramEditor={handleToggleDiagramEditor}
          onToggleStockroom={handleToggleWristPalette}
          simulationTime={effectiveSimTime}
          isPlaying={state.isPlaying}
          activeHeroTileId={activeHeroTileId}
          focusedTileId={state.focusedTileId}
          plinthWorldCenter={plinthCenter}
          visible={is3dStage && state.podiumVisible}
          onTileSelect={handleTileSelect}
          onFocusTileOnPlinth={handleFocusTileOnPlinth}
          onFocusTileFullscreen={handleFocusTileFullscreen}
          onMoveTile={onMoveTile}
          onCreateSpatialWire={onCreateSpatialWire}
          onPageModel={handlePageModel}
          onTogglePlaying={handleTogglePlaying}
          onToggleTilt={handleToggleTilt}
          onResetView={handleResetView}
          onHudStatusChange={isInXr ? undefined : onHudStatusChange}
          onInteractionLockChange={isInXr ? undefined : setPodiumLocked}
        />

        {/* 0° Hemisphere: Left & Right Podium-Docked CNC Side-Console Wings (only in 3D Stage) */}
        <FloatingToolWings
          state={{ ...state, simulationTime: effectiveSimTime }}
          activeModelTitle={activeModel?.title ?? "Model"}
          modelCount={models.length}
          visible={is3dStage && state.wingsVisible}
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
          deskScale={state.deskScale}
          deskHeightY={state.deskHeightY}
          podiumTiltDeg={effectivePodiumTiltDeg}
          podiumVisible={state.podiumVisible}
        />

        {/* 180° Opposite Hemisphere: Dedicated Uncluttered 3D Volumetric Diagram Arena + Matrix Stockroom */}
        <group name="rotunda-diagram-hemisphere" rotation={[0, Math.PI, 0]}>
          <SpatialDiagramStage
            visible={isDiagramStage}
            tile={activeDiagramTile}
            snapMode={state.diagramSnapMode}
            waferStyle={state.diagramWaferStyle}
            wristPaletteOpen={state.wristPaletteOpen}
            isPlaying={state.isPlaying}
            dark={!backdrop.isLight}
            languageId={languageId}
            diagramType={diagramType}
            activeFileName={activeFilePath}
            libraryCatalog={libraryCatalog}
            interactionLockRef={diagramInteractionLockRef}
            onInteractionLockChange={isInXr ? undefined : setDiagramLocked}
            onToggleWristPalette={handleToggleWristPalette}
            onSetWristPaletteOpen={handleSetWristPaletteOpen}
            onExitDiagramMode={handleToggleDiagramEditor}
            onCycleSnapMode={handleCycleSnapMode}
            onTogglePlaying={handleTogglePlaying}
            onDiagramEdit={onDiagramEdit}
            onHudStatusChange={isInXr ? undefined : onHudStatusChange}
            onCue={onCue}
            onExposeActions={onExposeDiagramActions}
          />
        </group>
      </group>

      {/* Dedicated Code Stage (centered) OR Orthogonal Split Code Companion Wing (docked right) */}
      <FloatingCodePanel3D
        visible={showCodePanel}
        code={sourceCode ?? ""}
        fileName={activeFilePath ?? activeModel?.title ?? "model.mo"}
        theme={resolveDiagramLanguageTheme(languageId, diagramType)}
        centered={isCodeStage}
        dockOffsetX={isDiagramStage ? 1.44 : 1.16}
        workspaceFiles={workspaceFiles}
        activeFilePath={activeFilePath}
        onSelectFile={(path) => onSelectWorkspaceFile?.(path)}
        diagnostics={inspectorData?.diagnostics}
        focusLine={codeFocusLine}
        scrollCommand={codeScrollCommand}
        onClose={() => {
          if (isCodeStage) {
            onSelectView("3d");
          } else {
            onToggleSplitCode();
          }
        }}
        onCue={onCue}
      />

      {/* Dedicated Spatial Engineering Inspector Stage (strictly active in Inspector View) */}
      <VrInspectorPanel3D
        visible={isInspectorStage}
        fileName={activeFilePath ?? activeModel?.title ?? "model.mo"}
        theme={resolveDiagramLanguageTheme(languageId, diagramType)}
        inspectorData={inspectorData}
        centered={true}
        onJumpToLine={(line) => {
          setCodeFocusLine(line);
          onSelectView("code");
        }}
        onClose={() => onSelectView("3d")}
        onCue={onCue}
      />

      {/* Animated Curved 3D Workspace File Switcher Carousel */}
      <VrFileCarousel3D
        visible={state.fileCarouselOpen}
        files={workspaceFiles ?? []}
        activeFilePath={activeFilePath}
        onSelectFile={(path) => onSelectWorkspaceFile?.(path)}
        onClose={() => dispatch({ type: "setFileCarouselOpen", open: false })}
        onCue={onCue}
      />

      {/* Dedicated Curved 3D VR Simulation & Multi-Channel Oscilloscope Theater (strictly active in Simulation View) */}
      <VrSimulationPanel3D
        visible={isSimulationStage}
        fileName={activeFilePath ?? activeModel?.title ?? "model.mo"}
        theme={resolveDiagramLanguageTheme(languageId, diagramType)}
        simulationData={simulationData}
        simulationTime={effectiveSimTime}
        isPlaying={state.isPlaying}
        centered={true}
        onTogglePlaying={handleTogglePlaying}
        onSeekSimulationTime={(t) => {
          liveSimTimeRef.current = t;
          dispatch({ type: "setSimulationTime", time: t });
          onSimulationTimeChange?.(t);
        }}
        onClose={() => onSelectView("3d")}
        onCue={onCue}
      />

      {/* Optional Synchronized Mini 3D CAD Preview beside Simulation Oscilloscope when live CAD bindings exist */}
      {isSimulationStage && Boolean(animationController?.hasData) && models.length > 0 && (
        <group name="vr-simulation-mini-plinth" position={[-1.45, 0.32, 0.15]} scale={0.42}>
          <TurntableCarousel
            models={models}
            activeModelIndex={state.activeModelIndex}
            carouselStep={state.carouselStep}
            plinthYaw={state.plinthYaw}
            plinthZoom={1}
            explodeFactor={0}
            caeOverlay={state.caeOverlay}
            renderStyle={state.renderStyle}
            scaleMode="tabletop"
            sectionCutEnabled={false}
            sectionCutAxis={state.sectionCutAxis}
            sectionCutOffset={0}
            simulationTime={effectiveSimTime}
            simulationTimeRef={liveSimTimeRef}
            isPlaying={state.isPlaying}
            animationController={animationController}
            visibility={visibility}
            autoTurntable={false}
            isInXr={isInXr}
            dark={!backdrop.isLight}
            visible={true}
            onSelectSubsystem={handleSelectSubsystem}
            onPageModel={handlePageModel}
            onSelectModelIndex={handleSelectModelIndex}
            onPlinthYawChange={handlePlinthYawChange}
            onSectionCutOffsetChange={handleSectionCutOffsetChange}
            onDraggingChange={setPlinthDragging}
          />
        </group>
      )}

      {/* In-Headset 1:1 Workbench View Switcher Bar (rendered inside WebXR sessions when DOM topbar is hidden) */}
      <VrSpatialNavBar3D
        visible={isInXr}
        activeView={state.activeView}
        availableViews={availableViews}
        splitCodeOpen={state.splitCodeOpen}
        fileCarouselOpen={state.fileCarouselOpen}
        fileCount={workspaceFiles?.length ?? 0}
        onSelectView={onSelectView}
        onToggleSplitCode={onToggleSplitCode}
        onToggleFileCarousel={() => dispatch({ type: "toggleFileCarousel" })}
        onExitVr={() => onExitVr?.()}
        onCue={onCue}
      />

      {/* Remote Multiplayer VR Engineer Avatars & Live Podium/Plinth Laser Pointers */}
      {peers && peers.length > 0 && (
        <MultiplayerPresence
          peers={peers}
          bridge={bridge}
          podiumTiltDeg={effectivePodiumTiltDeg}
          plinthCenter={plinthCenter}
          deskScale={state.deskScale}
          deskHeightY={state.deskHeightY}
          plinthScale={plinthPresentation.scale}
        />
      )}

      {/* Desktop 3D Stage-Aware Camera & Orbit Rig (unmounted during WebXR so it never fights stereo head tracking) */}
      {!isInXr && (
        <RotundaStageCameraRig
          activeView={state.activeView}
          scaleMode={state.scaleMode}
          splitCodeOpen={state.splitCodeOpen}
          enabled={!podiumLocked && !plinthDragging && !diagramLocked}
        />
      )}
    </>
  );
}

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
 *  - 6 Switchable Procedural Environments (Future Atrium, Warehouse, Office, Outdoors, Dark Lab, MR Passthrough).
 */
export function EngineeringRotunda({
  document: providedDoc,
  models: providedModels,
  scenarios,
  activeScenarioId,
  onSelectScenario,
  mode = "spatial-3d",
  initialEnvironment = "atrium",
  initialDeskTheme = DEFAULT_DESK_THEME,
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
  initialActiveView,
  activeView: controlledActiveView,
  onActiveViewChange,
  initialCodeOverlayOpen,
  splitCodeOpen: controlledSplitCodeOpen,
  onSplitCodeChange,
  hostedInWorkbench = false,
  vrQuickEditOpen = false,
  onToggleVrQuickEdit,
  availableViews,
  initialPodiumVisible,
  languageId,
  diagramType,
  sourceCode,
  workspaceFiles,
  activeFilePath,
  onSelectWorkspaceFile,
  inspectorData,
  simulationData,
  libraryCatalog,
  onDiagramEdit,
}: EngineeringRotundaProps): React.ReactElement {
  const [codeScrollCommand, setCodeScrollCommand] = useState<{
    readonly action: "top" | "bottom";
    readonly seq: number;
  } | null>(null);
  const langTheme = useMemo(() => resolveDiagramLanguageTheme(languageId, diagramType), [languageId, diagramType]);
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
  }, [baseDoc.id, activeFilePath]);

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

  const resolvedInitialView =
    controlledActiveView ?? initialActiveView ?? (initialDiagramEditorEnabled ? "diagram" : "3d");
  const resolvedInitialSplitCode =
    controlledSplitCodeOpen ?? Boolean(initialCodeOverlayOpen && resolvedInitialView !== "code");
  const resolvedInitialPodiumVisible = initialPodiumVisible ?? !hostedInWorkbench;

  const [state, dispatch] = useReducer(
    rotundaReducer,
    {
      environment: initialEnvironment,
      deskTheme: initialDeskTheme,
      simulationTime: controlledSimulationTime ?? 0,
      telemetryWingEnabled: initialTelemetryEnabled,
      podiumVisible: resolvedInitialPodiumVisible,
      wingsVisible: resolvedInitialPodiumVisible,
      activeView: resolvedInitialView,
      diagramEditorEnabled: resolvedInitialView === "diagram",
      splitCodeOpen: resolvedInitialSplitCode,
      codeOverlayOpen: resolvedInitialView === "code" || resolvedInitialSplitCode,
      inspectorOverlayOpen: resolvedInitialView === "inspector",
      simulationPanelOpen: resolvedInitialView === "simulation",
    },
    (init) => createInitialRotundaState(init),
  );

  // Sync controlled activeView & splitCodeOpen 1:1 from the host workbench navbar
  useEffect(() => {
    if (controlledActiveView && controlledActiveView !== state.activeView) {
      dispatch({ type: "setActiveView", view: controlledActiveView });
    }
  }, [controlledActiveView, state.activeView]);

  useEffect(() => {
    if (controlledSplitCodeOpen !== undefined && controlledSplitCodeOpen !== state.splitCodeOpen) {
      dispatch({ type: "setSplitCodeOpen", open: controlledSplitCodeOpen });
    }
  }, [controlledSplitCodeOpen, state.splitCodeOpen]);

  const effectiveAvailableViews = useMemo<readonly RotundaActiveView[]>(
    () =>
      availableViews && availableViews.length > 0
        ? availableViews
        : (["diagram", "3d", "simulation", "inspector", "code"] as const),
    [availableViews],
  );

  const handleSelectView = useCallback(
    (nextView: RotundaActiveView) => {
      dispatch({ type: "setActiveView", view: nextView });
      onActiveViewChange?.(nextView);
    },
    [onActiveViewChange],
  );

  const handleToggleSplitCode = useCallback(() => {
    const nextSplit = !state.splitCodeOpen;
    dispatch({ type: "setSplitCodeOpen", open: nextSplit });
    onSplitCodeChange?.(nextSplit);
  }, [state.splitCodeOpen, onSplitCodeChange]);

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
    // DraftingPodium re-registers the live (tilted/scaled) plane on mount; seed with the default desk layout
    const b = new SpatialSurfaceBridge(buildDeskSpatialPlane(DEFAULT_PODIUM_TILT_DEG));
    b.setMode(mode);
    return b;
  }, [mode]);

  const xrStore = useMemo(() => getSharedXrStore(), []);
  const xrCaps = useXrCapabilities();
  const [webglSupported] = useState<boolean>(detectWebGlSupport);
  const [hudStatus, setHudStatus] = useState<string | null>(null);
  const [ambientMuted, setAmbientMuted] = useState(false);
  const ambientMutedRef = useRef(ambientMuted);
  ambientMutedRef.current = ambientMuted;
  const ambientSoundscapeRef = useRef<RotundaAmbientSoundscape | null>(null);

  const triggerCue = useCallback(
    (kind: RotundaCueKind) => {
      if (!ambientMutedRef.current) {
        ambientSoundscapeRef.current?.start(currentEnvRef.current);
        playRotundaCue(kind);
      }
      pulseXrHaptics(xrStore, kind === "page" || kind === "snap" ? 0.3 : 0.16, 26);
    },
    [xrStore],
  );

  // Persistent soothing procedural ambient soundscape (auto-unlocks on first user or XR gesture)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const soundscape = new RotundaAmbientSoundscape();
    ambientSoundscapeRef.current = soundscape;

    const unlockAmbient = () => {
      if (!ambientMutedRef.current) {
        soundscape.start(currentEnvRef.current);
      }
    };

    window.addEventListener("pointerdown", unlockAmbient, { passive: true });
    window.addEventListener("keydown", unlockAmbient, { passive: true });
    const unsubXr = xrStore.subscribe((xrState) => {
      if (xrState.session && !ambientMutedRef.current) {
        soundscape.start(currentEnvRef.current);
      }
    });

    return () => {
      window.removeEventListener("pointerdown", unlockAmbient);
      window.removeEventListener("keydown", unlockAmbient);
      unsubXr();
      soundscape.dispose();
      ambientSoundscapeRef.current = null;
    };
  }, [xrStore]);

  useEffect(() => {
    ambientSoundscapeRef.current?.setEnvironment(state.environment);
  }, [state.environment]);

  useEffect(() => {
    const soundscape = ambientSoundscapeRef.current;
    if (!soundscape) return;
    soundscape.setMuted(ambientMuted);
    if (!ambientMuted) {
      soundscape.start(currentEnvRef.current);
    }
  }, [ambientMuted]);

  // Sync external initialEnvironment / initialDeskTheme props if they change
  useEffect(() => {
    dispatch({ type: "setEnvironment", environment: initialEnvironment });
  }, [initialEnvironment]);

  useEffect(() => {
    dispatch({ type: "setDeskTheme", theme: initialDeskTheme });
  }, [initialDeskTheme]);

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
    initialEnvironment === "passthrough" ? "atrium" : initialEnvironment,
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

  // Keyboard shortcuts for desktop 3D exploration (ArrowLeft/Right carousel, 1-5 envs, Space play/pause, R reset,
  // D desk size, M model scale mode, T desk tilt, Esc unzoom/exit)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && vrQuickEditOpen && onToggleVrQuickEdit) {
        e.preventDefault();
        onToggleVrQuickEdit();
        triggerCue("click");
        return;
      }
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
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "d" || e.key === "D")) {
        dispatch({ type: "cycleDeskScale" });
        triggerCue("click");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "m" || e.key === "M")) {
        dispatch({ type: "toggleScaleMode" });
        triggerCue("snap");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "t" || e.key === "T")) {
        dispatch({ type: "togglePodiumTilt" });
        triggerCue("click");
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "b" || e.key === "B")) {
        dispatch({ type: "cycleDeskTheme" });
        triggerCue("click");
      } else if (e.key >= "1" && e.key <= "6") {
        const idx = Number(e.key) - 1;
        const env = ROTUNDA_ENVIRONMENTS[idx];
        if (env) {
          handleSelectEnvironment(env.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [models.length, triggerCue, handleSelectEnvironment, onExitTo2D, xrStore, vrQuickEditOpen, onToggleVrQuickEdit]);

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
      dispatch({ type: "setScaleMode", mode: target.recommendedScaleMode ?? "hero" });
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
    <SpatialFallbackBoardCanvas
      doc={doc}
      simulationTime={effectiveSimTime}
      activeHeroTileId={activeHeroTileId}
      boardTheme={state.deskTheme}
    />
  );

  return (
    <div
      data-testid="spatial-vr-surface"
      data-rotunda="engineering-rotunda"
      data-surface-mode={mode}
      data-rotunda-env={state.environment}
      data-desk-theme={state.deskTheme}
      data-scale-mode={state.scaleMode}
      data-active-model={activeModel?.id ?? ""}
      data-cae-overlay={state.caeOverlay}
      data-focused-tile={state.focusedTileId ?? ""}
      data-diagram-editor={state.diagramEditorEnabled ? "open" : "closed"}
      data-wrist-palette={state.wristPaletteOpen ? "open" : "closed"}
      data-active-view={state.activeView}
      data-split-code={state.splitCodeOpen && state.activeView !== "code" ? "open" : "closed"}
      data-language-id={langTheme.languageId}
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
                powerPreference: "high-performance",
                localClippingEnabled: true,
                toneMapping: THREE.NeutralToneMapping,
                toneMappingExposure: 1.0,
              }}
              onCreated={({ gl }) => {
                // Keep Quest 2 stereo eye buffers crisp yet 28% lighter on fragment fill-rate
                if (typeof gl.xr?.setFramebufferScaleFactor === "function") {
                  gl.xr.setFramebufferScaleFactor(0.85);
                }
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
                      languageId={languageId}
                      diagramType={diagramType}
                      sourceCode={sourceCode}
                      workspaceFiles={workspaceFiles}
                      activeFilePath={activeFilePath}
                      onSelectWorkspaceFile={onSelectWorkspaceFile}
                      inspectorData={inspectorData}
                      simulationData={simulationData}
                      libraryCatalog={libraryCatalog}
                      onDiagramEdit={handleDiagramEdit}
                      onExposeDiagramActions={setDiagramHudApi}
                      availableViews={effectiveAvailableViews}
                      onSelectView={handleSelectView}
                      onToggleSplitCode={handleToggleSplitCode}
                      codeScrollCommand={codeScrollCommand}
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

      {/* Top-Left Model Carousel Pill & Compact Scenario Switcher (hidden in hosted single-model mode to keep viewport calm) */}
      {!hideDesktopHud && (!hostedInWorkbench || hasScenarios || (state.activeView === "3d" && models.length > 1)) && (
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

      {/* Top-Right WebXR Headset / Handoff & Exit Controls (standalone mode only; workbench navbar + context dock own these when hosted) */}
      {!hideDesktopHud && !hostedInWorkbench && (
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

      {/* Subtle VR HUD Interaction Status Hint (shown transiently when hosted; persistent in standalone mode) */}
      {(!hostedInWorkbench || Boolean(hudStatus)) && (
        <div
          data-testid="spatial-vr-hud-status"
          style={{
            position: "absolute",
            ...(hideDesktopHud
              ? { bottom: 12, left: 12 }
              : hostedInWorkbench
                ? { top: topOverlayInset, left: "50%", transform: "translateX(-50%)" }
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
      )}

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

      {/* Context-Aware Bottom Spatial Control Dock */}
      {!hideDesktopHud && (
        <RotundaContextDock
          hostedInWorkbench={hostedInWorkbench}
          activeView={state.activeView}
          splitCodeOpen={state.splitCodeOpen}
          state={state}
          langTheme={langTheme}
          workspaceFileCount={workspaceFiles?.length ?? 0}
          ambientMuted={ambientMuted}
          diagramHudApi={diagramHudApi}
          xrSupported={{ vr: xrCaps.vrSupported, ar: xrCaps.arSupported }}
          onSelectEnvironment={handleSelectEnvironment}
          onSelectView={handleSelectView}
          onToggleSplitCode={handleToggleSplitCode}
          onToggleAmbientMuted={() => {
            const nextMuted = !ambientMuted;
            setAmbientMuted(nextMuted);
            if (!nextMuted) {
              playRotundaCue("click");
            }
          }}
          onEnterVr={handleEnterVr}
          onEnterAr={handleEnterAr}
          onScrollCode={(action) => setCodeScrollCommand((prev) => ({ action, seq: (prev?.seq ?? 0) + 1 }))}
          vrQuickEditOpen={vrQuickEditOpen}
          onToggleVrQuickEdit={onToggleVrQuickEdit}
          dispatch={dispatch}
          onCue={triggerCue}
        />
      )}

      {/* Desktop Field-Simulator Telemetry HUD + Subsystem Inspector + Operation Log Scrubber for Pelagos OC-8 */}
      {desktopOctopusFrame && (
        <SimulatorTelemetryHud
          frame={desktopOctopusFrame}
          dark={!backdrop.isLight}
          isPlaying={state.isPlaying}
          topOffsetPx={62}
          bottomOffsetPx={hostedInWorkbench ? 68 : 116}
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
