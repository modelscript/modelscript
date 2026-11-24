// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createCanonicalPolyglotDemoBoard,
  SpatialSurfaceBridge,
  type CanvasDocument,
  type CanvasPeerPresence,
} from "@modelscript/canvas";
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useXR, XR } from "@react-three/xr";
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import * as THREE from "three";
import { paintBoardToTextureCanvas } from "./board-painter.js";
import { DraftingPodium } from "./DraftingPodium.js";
import { getEnvironmentSceneBackdrop, RotundaEnvironment } from "./environments.js";
import { FloatingToolWings } from "./FloatingToolWings.js";
import { MultiplayerPresence } from "./MultiplayerPresence.js";
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
  getSharedXrStore,
  playRotundaCue,
  pulseXrHaptics,
  useXrCapabilities,
  type RotundaCueKind,
} from "./xr-session.js";

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

const SCENARIO_BUTTON_WIDTH = 0.88;
const SCENARIO_BUTTON_HEIGHT = 0.095;
const SCENARIO_BUTTON_POS: [number, number, number] = [-1.18, 1.835, -1.32];
const SCENARIO_BUTTON_YAW_RAD = (26 * Math.PI) / 180;

function drawScenarioPillPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

interface FloatingScenarioCycleButton3DProps {
  scenarioShortLabel: string;
  scenarioIndex: number;
  scenarioCount: number;
  onCycle: () => void;
}

/**
 * Compact WebXR-native 3D Floating Scenario Cycle button (`Next Scenario ↻`) mounted
 * cleanly above the Left Tool Wing so headset and desktop 3D users can switch worlds in one tap.
 */
function FloatingScenarioCycleButton3D({
  scenarioShortLabel,
  scenarioIndex,
  scenarioCount,
  onCycle,
}: FloatingScenarioCycleButton3DProps): React.ReactElement {
  const groupRef = useRef<THREE.Group | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 96;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    canvasRef.current = canvas;
    textureRef.current = tex;
    setTexture(tex);

    return () => {
      canvasRef.current = null;
      textureRef.current = null;
      setTexture(null);
      tex.dispose();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const tex = textureRef.current;
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    drawScenarioPillPath(ctx, 3, 3, w - 6, h - 6, 18);
    ctx.fillStyle = pressed ? "rgba(18, 44, 72, 0.96)" : hovered ? "rgba(16, 36, 62, 0.94)" : "rgba(11, 17, 32, 0.92)";
    ctx.fill();
    ctx.lineWidth = hovered ? 3 : 2;
    ctx.strokeStyle = hovered ? "#7dd3fc" : "rgba(56, 189, 248, 0.72)";
    ctx.stroke();

    // Glowing scenario status indicator dot
    ctx.beginPath();
    ctx.arc(30, h / 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#22d3ee";
    ctx.fill();

    // Active scenario counter + short label
    ctx.fillStyle = "#94a3b8";
    ctx.font = "700 20px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`SCENARIO ${scenarioIndex + 1}/${scenarioCount}`, 50, 31);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 26px Inter, system-ui, -apple-system, sans-serif";
    const clippedLabel = scenarioShortLabel.length > 22 ? `${scenarioShortLabel.slice(0, 21)}…` : scenarioShortLabel;
    ctx.fillText(clippedLabel, 50, 64);

    // Highlighted right-side action pill ("Next Scenario ↻")
    const pillW = 248;
    const pillH = 58;
    const pillX = w - pillW - 18;
    const pillY = (h - pillH) / 2;
    drawScenarioPillPath(ctx, pillX, pillY, pillW, pillH, 14);
    ctx.fillStyle = hovered ? "rgba(56, 189, 248, 0.3)" : "rgba(56, 189, 248, 0.18)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = hovered ? "#bae6fd" : "#38bdf8";
    ctx.stroke();

    ctx.fillStyle = "#f0f9ff";
    ctx.font = "700 24px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Next Scenario ↻", pillX + pillW / 2, h / 2 + 1);

    tex.needsUpdate = true;
  }, [scenarioShortLabel, scenarioIndex, scenarioCount, hovered, pressed, texture]);

  useEffect(() => {
    return () => {
      if (typeof document !== "undefined" && document.body) {
        document.body.style.cursor = "auto";
      }
    };
  }, []);

  useFrame((_, delta) => {
    const grp = groupRef.current;
    if (!grp) return;
    const targetZ = pressed ? 0.002 : hovered ? 0.018 : 0;
    const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 16);
    grp.position.z += (targetZ - grp.position.z) * alpha;
  });

  return (
    <group
      name="rotunda-scenario-cycle-button"
      position={SCENARIO_BUTTON_POS}
      rotation={[0, SCENARIO_BUTTON_YAW_RAD, 0]}
    >
      <group
        ref={groupRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          if (typeof document !== "undefined" && document.body) {
            document.body.style.cursor = "pointer";
          }
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          setPressed(false);
          if (typeof document !== "undefined" && document.body) {
            document.body.style.cursor = "auto";
          }
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          setPressed(true);
        }}
        onPointerUp={(e) => {
          e.stopPropagation();
          if (pressed) {
            setPressed(false);
            onCycle();
          }
        }}
      >
        <mesh position={[0, 0, -0.006]}>
          <boxGeometry args={[SCENARIO_BUTTON_WIDTH, SCENARIO_BUTTON_HEIGHT, 0.012]} />
          <meshStandardMaterial
            color="#0b1120"
            emissive="#38bdf8"
            emissiveIntensity={hovered ? 0.34 : 0.14}
            roughness={0.28}
            metalness={0.55}
          />
        </mesh>
        <mesh position={[0, 0, 0.002]}>
          <planeGeometry args={[SCENARIO_BUTTON_WIDTH, SCENARIO_BUTTON_HEIGHT]} />
          {texture ? (
            <meshBasicMaterial map={texture} transparent toneMapped={false} />
          ) : (
            <meshBasicMaterial color="#0f172a" transparent opacity={0.9} />
          )}
        </mesh>
      </group>
    </group>
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
  scenarioIndex: number;
  scenarioCount: number;
  onCycleScenario?: (() => void) | undefined;
  peers?: readonly CanvasPeerPresence[] | undefined;
  animationController?: RotundaAnimationControllerLike | null | undefined;
  onTileSelect?: ((tileId: string) => void) | undefined;
  onMoveTile?: ((tileId: string, x: number, y: number) => void) | undefined;
  onCreateSpatialWire?: ((sourceTileId: string, targetTileId: string, sourceAnchor?: string) => void) | undefined;
  onSimulationTimeChange?: ((time: number) => void) | undefined;
  onHudStatusChange?: ((status: string | null) => void) | undefined;
  onCue: (kind: RotundaCueKind) => void;
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
  scenarioIndex,
  scenarioCount,
  onCycleScenario,
  peers,
  animationController,
  onTileSelect,
  onMoveTile,
  onCreateSpatialWire,
  onSimulationTimeChange,
  onHudStatusChange,
  onCue,
}: RotundaSceneContentsProps): React.ReactElement {
  const isInXr = useXR((s) => Boolean(s.session));
  const [podiumLocked, setPodiumLocked] = useState(false);
  const [plinthDragging, setPlinthDragging] = useState(false);

  const activeModel = models[wrapIndex(state.activeModelIndex, models.length)] ?? models[0];
  const activeHeroTileId = activeModel?.sourceTileId ?? null;
  const plinthCenter: [number, number, number] =
    state.scaleMode === "real-scale" ? PLINTH_CENTER_REAL_SCALE : PLINTH_CENTER_TABLETOP;

  // Drive smooth autonomous simulation clock when playing and not externally frozen
  const simAccumRef = useRef(0);
  useFrame((_, rawDelta) => {
    if (!state.isPlaying || controlledSimTime) return;
    const delta = Math.min(rawDelta, 0.05);
    simAccumRef.current += delta;
    // Throttle React state clock dispatch to ~20 Hz while Three.js meshes animate at 60–90 Hz
    if (simAccumRef.current >= 0.05) {
      const step = simAccumRef.current;
      simAccumRef.current = 0;
      dispatch({ type: "advanceSimulationTime", delta: step });
    }
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
      />

      {/* 5 Selectable Procedural Environments + Lighting */}
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
        isPlaying={state.isPlaying}
        animationController={animationController}
        onPageModel={handlePageModel}
        onSelectModelIndex={handleSelectModelIndex}
        onPlinthYawChange={handlePlinthYawChange}
        onSectionCutOffsetChange={handleSectionCutOffsetChange}
        onDraggingChange={setPlinthDragging}
      />

      {/* Ergonomic 45° Drafting Podium Hosting the Miro-like Infinite Canvas + Fiber-Optic Tethers */}
      <DraftingPodium
        document={doc}
        bridge={bridge}
        tiltDeg={state.podiumTiltDeg}
        simulationTime={effectiveSimTime}
        isPlaying={state.isPlaying}
        activeHeroTileId={activeHeroTileId}
        plinthWorldCenter={plinthCenter}
        visible={state.podiumVisible}
        onTileSelect={handleTileSelect}
        onFocusTileOnPlinth={handleFocusTileOnPlinth}
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
        onPlayCue={onCue}
      />

      {/* Compact WebXR-Native 3D Floating Scenario Cycle Button ("Next Scenario ↻") */}
      {activeScenario && scenarioCount > 1 && state.wingsVisible && onCycleScenario && (
        <FloatingScenarioCycleButton3D
          scenarioShortLabel={activeScenario.shortLabel}
          scenarioIndex={scenarioIndex}
          scenarioCount={scenarioCount}
          onCycle={onCycleScenario}
        />
      )}

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
          enabled={!podiumLocked && !plinthDragging}
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
  initialEnvironment = "dark-lab",
  simulationTime: controlledSimulationTime,
  onSimulationTimeChange,
  onExitTo2D,
  onOpenExternalVr,
  onTileSelect,
  onMoveTile,
  onCreateSpatialWire,
  peers,
  animationController,
  title,
  hideDesktopHud = false,
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
  const doc = providedDoc ?? scenarioBoard ?? defaultBoard;

  const models = useMemo<readonly RotundaModelEntry[]>(() => {
    if (providedModels && providedModels.length > 0) return providedModels;
    if (activeScenario && activeScenario.models.length > 0) return activeScenario.models;
    return extractModelsFromCanvasDocument(doc);
  }, [providedModels, activeScenario, doc]);

  const [state, dispatch] = useReducer(
    rotundaReducer,
    {
      environment: initialEnvironment,
      simulationTime: controlledSimulationTime ?? 0,
    },
    (init) => createInitialRotundaState(init),
  );

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
  }, [activeScenarioId, scenarios, models.length]);

  // Keyboard shortcuts for desktop 3D exploration (ArrowLeft/Right carousel, 1-5 envs, Space play/pause, R reset)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;

      if (e.key === "ArrowLeft") {
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
          dispatch({ type: "setEnvironment", environment: env.id });
          triggerCue("env");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [models.length, triggerCue]);

  const handleEnterVr = useCallback(() => {
    triggerCue("env");
    void xrStore.enterVR();
  }, [xrStore, triggerCue]);

  const handleEnterAr = useCallback(() => {
    dispatch({ type: "setEnvironment", environment: "passthrough" });
    triggerCue("env");
    void xrStore.enterAR();
  }, [xrStore, triggerCue]);

  const handleSelectEnvironment = useCallback(
    (env: RotundaEnvironmentId) => {
      dispatch({ type: "setEnvironment", environment: env });
      triggerCue("env");
    },
    [triggerCue],
  );

  const handleSelectScenario = useCallback(
    (scenarioId: string) => {
      const target = scenarios?.find((s) => s.id === scenarioId);
      if (!target) return;
      if (activeScenarioId === undefined) {
        setInternalScenarioId(target.id);
      }
      const targetCount = Math.max(1, target.models.length);
      dispatch({ type: "selectModelIndex", index: 0, modelCount: targetCount });
      dispatch({ type: "setEnvironment", environment: target.recommendedEnvironment });
      dispatch({ type: "setCaeOverlay", overlay: target.recommendedCaeOverlay ?? "none" });
      dispatch({ type: "setScaleMode", mode: target.recommendedScaleMode ?? "tabletop" });
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
              shadows="basic"
              dpr={[1, 1.5]}
              camera={{ position: [0, 1.68, 0.72], fov: 50, near: 0.05, far: 160 }}
              gl={{ antialias: true, alpha: true, localClippingEnabled: true }}
            >
              <XR store={xrStore}>
                <RotundaSceneContents
                  doc={doc}
                  models={models}
                  state={state}
                  effectiveSimTime={effectiveSimTime}
                  controlledSimTime={controlledSimulationTime !== undefined}
                  bridge={bridge}
                  dispatch={dispatch}
                  activeScenario={activeScenario}
                  scenarioIndex={activeScenarioIndex}
                  scenarioCount={scenarios?.length ?? 0}
                  onCycleScenario={scenarios && scenarios.length > 1 ? handleCycleScenario : undefined}
                  peers={peers}
                  animationController={animationController}
                  onTileSelect={onTileSelect}
                  onMoveTile={onMoveTile}
                  onCreateSpatialWire={onCreateSpatialWire}
                  onSimulationTimeChange={onSimulationTimeChange}
                  onHudStatusChange={setHudStatus}
                  onCue={triggerCue}
                />
              </XR>
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
            top: 12,
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
            top: 12,
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
              title="Open in a top-level browser tab to launch WebXR VR/AR headset sessions"
            >
              Open in VR Headset ↗
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
              Return to 2D Canvas
            </button>
          )}
        </div>
      )}

      {/* Subtle VR HUD Interaction Status Hint (preserved data-testid for existing test suite) */}
      <div
        data-testid="spatial-vr-hud-status"
        style={{
          position: "absolute",
          bottom: hideDesktopHud ? 12 : 62,
          left: 12,
          padding: "5px 11px",
          borderRadius: 8,
          border: hudStatus ? "1px solid #38bdf8" : "1px solid #1e293b",
          background: "rgba(9, 15, 29, 0.84)",
          color: hudStatus ? "#f8fafc" : "#94a3b8",
          fontSize: 11,
          pointerEvents: "none",
          zIndex: 20,
        }}
      >
        {hudStatus ??
          "Engineering Rotunda · Spin plinth rim · Drag tiles on 45° podium · Pull CADPort to wire 3D → 2D · ←/→ page models"}
      </div>

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
        </div>
      )}
    </div>
  );
}

export default EngineeringRotunda;
