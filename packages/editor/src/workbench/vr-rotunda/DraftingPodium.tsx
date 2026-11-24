// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  projectRayToPlane,
  type CanvasDocument,
  type CanvasTile,
  type SpatialPlane3D,
  type SpatialSurfaceBridge,
} from "@modelscript/canvas";
import { Line } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  paintBoardToTextureCanvas,
  resolveEffectiveBounds,
  type BoardPaintOptions,
  type DragPreviewState,
} from "./board-painter.js";
import { createBrushedAluminumPbr, createRadialContactShadowTexture } from "./procedural-pbr.js";
import {
  boardBoundsToPlaneBounds,
  buildPodiumSpatialPlane,
  clampNumber,
  getTileMaximizeButtonRect,
  planeUvToBoard,
  PODIUM_BACK_BTN_RECT,
  PODIUM_CENTER,
  PODIUM_HEADER_HEIGHT,
  PODIUM_HEIGHT_METERS,
  PODIUM_NEXT_TILE_BTN_RECT,
  PODIUM_PREV_TILE_BTN_RECT,
  PODIUM_RESET_PAN_BTN_RECT,
  PODIUM_WIDTH_METERS,
  pointInPodiumRect,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
} from "./types.js";
import { playRotundaCue } from "./xr-session.js";

/** Builds a rounded-corner CNC-milled unibody aluminum console shell with real machined chamfers. */
function createChamferedChassisGeometry(
  width: number,
  height: number,
  depth: number,
  radius = 0.036,
): THREE.ExtrudeGeometry {
  const hw = width * 0.5;
  const hh = height * 0.5;
  const r = Math.min(radius, hw * 0.4, hh * 0.4);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.011,
    bevelSize: 0.01,
    bevelSegments: 4,
    curveSegments: 8,
  });
  geom.translate(0, 0, -depth * 0.5);
  geom.computeVertexNormals();
  return geom;
}

/** Builds a CNC-turned chamfered floor base plate for the drafting console pedestal. */
function createPodiumBasePlateGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.45, 0.0),
    new THREE.Vector2(0.45, 0.016),
    new THREE.Vector2(0.415, 0.034),
    new THREE.Vector2(0.24, 0.044),
    new THREE.Vector2(0.185, 0.082),
    new THREE.Vector2(0.14, 0.098),
    new THREE.Vector2(0.0, 0.098),
  ];
  const geom = new THREE.LatheGeometry(pts, 48);
  geom.computeVertexNormals();
  return geom;
}

export interface DraftingPodiumProps {
  document: CanvasDocument;
  bridge: SpatialSurfaceBridge;
  tiltDeg: number;
  simulationTime: number;
  isPlaying: boolean;
  activeHeroTileId: string | null;
  focusedTileId?: string | null | undefined;
  plinthWorldCenter: [number, number, number];
  visible: boolean;
  onTileSelect?: ((tileId: string) => void) | undefined;
  onFocusTileOnPlinth?: ((tileId: string) => void) | undefined;
  onFocusTileFullscreen?: ((tileId: string | null) => void) | undefined;
  onMoveTile?: ((tileId: string, x: number, y: number) => void) | undefined;
  onCreateSpatialWire?: ((sourceTileId: string, targetTileId: string, sourceAnchor?: string) => void) | undefined;
  onPageModel?: ((delta: number) => void) | undefined;
  onTogglePlaying?: (() => void) | undefined;
  onToggleTilt?: (() => void) | undefined;
  onResetView?: (() => void) | undefined;
  onHudStatusChange?: ((status: string | null) => void) | undefined;
  onInteractionLockChange?: ((locked: boolean) => void) | undefined;
}

interface ActiveSpatialWireDrag {
  sourceTileId: string;
  sourceTitle: string;
  sourceAnchor: string;
  from3D: [number, number, number];
}

interface TetherSpec {
  id: string;
  tileId: string;
  isHero: boolean;
  color: string;
  p0: [number, number, number];
  p1: [number, number, number];
  p2: [number, number, number];
  p3: [number, number, number];
  points: [number, number, number][];
}

interface CadPortDescriptor {
  tile: CanvasTile;
  localPos: [number, number, number];
  worldPos: [number, number, number];
  portU: number;
  portV: number;
}

const DOUBLE_CLICK_MS = 550;
const DRAG_THRESHOLD_BOARD_UNITS = 3;
const BEZEL_RIM_HEIGHT = 0.114;
const BEZEL_KEYCAP_Y = -(PODIUM_HEIGHT_METERS / 2) - BEZEL_RIM_HEIGHT * 0.5;
const PODIUM_CANVAS_DPR = 1.25;

function planeUvToWorld3D(plane: SpatialPlane3D, u: number, v: number, liftMeters = 0): [number, number, number] {
  const um = u / plane.unitsPerMeter;
  const vm = v / plane.unitsPerMeter;
  return [
    plane.origin[0] + plane.right[0] * um + plane.down[0] * vm + plane.normal[0] * liftMeters,
    plane.origin[1] + plane.right[1] * um + plane.down[1] * vm + plane.normal[1] * liftMeters,
    plane.origin[2] + plane.right[2] * um + plane.down[2] * vm + plane.normal[2] * liftMeters,
  ];
}

function planeUvToPodiumLocal(u: number, v: number, liftMeters = 0): [number, number, number] {
  const localX = (u / ROTUNDA_BOARD_CANVAS_WIDTH - 0.5) * PODIUM_WIDTH_METERS;
  const localY = (0.5 - v / ROTUNDA_BOARD_CANVAS_HEIGHT) * PODIUM_HEIGHT_METERS;
  return [localX, localY, liftMeters];
}

function sampleCubicBezier(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  segments = 16,
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;
    pts.push([
      mt3 * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t3 * p3[0],
      mt3 * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t3 * p3[1],
      mt3 * p0[2] + 3 * mt2 * t * p1[2] + 3 * mt * t2 * p2[2] + t3 * p3[2],
    ]);
  }
  return pts;
}

function sampleQuadraticBezier(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  segments = 16,
): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const twoMtT = 2 * mt * t;
    const t2 = t * t;
    pts.push([
      mt2 * p0[0] + twoMtT * p1[0] + t2 * p2[0],
      mt2 * p0[1] + twoMtT * p1[1] + t2 * p2[1],
      mt2 * p0[2] + twoMtT * p1[2] + t2 * p2[2],
    ]);
  }
  return pts;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function setDocumentCursor(cursor: string): void {
  if (typeof document !== "undefined" && document.body) {
    document.body.style.cursor = cursor;
  }
}

interface BezelKeycapButtonProps {
  label: string;
  position: [number, number, number];
  width: number;
  height: number;
  accentColor: string;
  active?: boolean | undefined;
  onPress: () => void;
}

/**
 * Tactile 3D physical bezel keycap mounted along the lower rim of the drafting desk.
 * Uses a single persistent high-DPI CanvasTexture that disposes cleanly on unmount.
 */
function BezelKeycapButton({
  label,
  position,
  width,
  height,
  accentColor,
  active = false,
  onPress,
}: BezelKeycapButtonProps): React.ReactElement {
  const groupRef = useRef<THREE.Group | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 88;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
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

    // Bright frosted light-slate keycap gradient for instant Quest 2 legibility
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (active) {
      grad.addColorStop(0, "#0284c7");
      grad.addColorStop(1, "#0369a1");
    } else if (pressed) {
      grad.addColorStop(0, "#cbd5e1");
      grad.addColorStop(1, "#e2e8f0");
    } else if (hovered) {
      grad.addColorStop(0, "#e0f2fe");
      grad.addColorStop(1, "#bae6fd");
    } else {
      grad.addColorStop(0, "#ffffff");
      grad.addColorStop(1, "#f1f5f9");
    }

    drawRoundedRectPath(ctx, 4, 4, w - 8, h - 8, 16);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle top specular highlight
    drawRoundedRectPath(ctx, 10, 8, w - 20, 12, 6);
    ctx.fillStyle = active ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.72)";
    ctx.fill();

    // Crisp rim border
    drawRoundedRectPath(ctx, 4, 4, w - 8, h - 8, 16);
    ctx.lineWidth = hovered || active ? 3.5 : 2.2;
    ctx.strokeStyle = active ? "#0369a1" : hovered ? accentColor : "#cbd5e1";
    ctx.stroke();

    // Small active indicator LED on the bottom center
    if (active) {
      ctx.fillStyle = "#e0f2fe";
      drawRoundedRectPath(ctx, w * 0.5 - 26, h - 13, 52, 4, 2);
      ctx.fill();
    }

    // Crisp high-contrast keycap typography
    ctx.fillStyle = active ? "#ffffff" : "#0f172a";
    ctx.font = "700 28px Inter, system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, w / 2, active ? h / 2 - 2 : h / 2 + 1);

    tex.needsUpdate = true;
  }, [label, accentColor, active, hovered, pressed, texture]);

  useEffect(() => {
    return () => {
      setDocumentCursor("auto");
    };
  }, []);

  useFrame((_, delta) => {
    const grp = groupRef.current;
    if (!grp) return;
    const targetZ = pressed ? 0.002 : hovered ? 0.014 : 0.008;
    const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 18);
    grp.position.z += (targetZ - grp.position.z) * alpha;
  });

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    setDocumentCursor("pointer");
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    setPressed(false);
    setDocumentCursor("auto");
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setPressed(true);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (pressed) {
      setPressed(false);
      onPress();
    }
  };

  return (
    <group
      ref={groupRef}
      position={[position[0], position[1], position[2]]}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {/* Raised brushed-silver tactile keycap chassis */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[width, height, 0.016]} />
        <meshStandardMaterial
          color={active ? "#0284c7" : hovered ? "#bae6fd" : "#cbd5e1"}
          emissive={active ? "#0284c7" : hovered ? accentColor : "#94a3b8"}
          emissiveIntensity={active ? 0.24 : hovered ? 0.14 : 0.04}
          roughness={0.32}
          metalness={0.35}
        />
      </mesh>
      {/* Crisp high-DPI keycap top faceplate */}
      <mesh position={[0, 0, 0.009]}>
        <planeGeometry args={[width - 0.006, height - 0.006]} />
        {texture ? (
          <meshBasicMaterial key="keycap-tex" color="#ffffff" map={texture} transparent toneMapped={false} />
        ) : (
          <meshBasicMaterial key="keycap-fallback" color="#f8fafc" toneMapped={false} />
        )}
      </mesh>
    </group>
  );
}

interface TetherPulseBeadProps {
  p0: [number, number, number];
  p1: [number, number, number];
  p2: [number, number, number];
  p3: [number, number, number];
  color: string;
  phaseOffset: number;
}

/** Smoothly glides a glowing optical packet along a fiber-optic Bezier tether into the plinth. */
function TetherPulseBead({ p0, p1, p2, p3, color, phaseOffset }: TetherPulseBeadProps): React.ReactElement {
  const beadRef = useRef<THREE.Mesh | null>(null);

  useFrame((state) => {
    const mesh = beadRef.current;
    if (!mesh) return;
    const t = (state.clock.elapsedTime * 0.42 + phaseOffset) % 1;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;
    mesh.position.set(
      mt3 * p0[0] + 3 * mt2 * t * p1[0] + 3 * mt * t2 * p2[0] + t3 * p3[0],
      mt3 * p0[1] + 3 * mt2 * t * p1[1] + 3 * mt * t2 * p2[1] + t3 * p3[1],
      mt3 * p0[2] + 3 * mt2 * t * p1[2] + 3 * mt * t2 * p2[2] + t3 * p3[2],
    );
  });

  return (
    <mesh ref={beadRef} position={p0}>
      <sphereGeometry args={[0.011, 12, 12]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

interface CadPortHandleProps {
  descriptor: CadPortDescriptor;
  isWiring: boolean;
  isHero: boolean;
  onStartWire: (descriptor: CadPortDescriptor) => void;
}

/** Floating interactive CADPort sphere above a `cad3d` tile on the 45° podium desk. */
function CadPortHandle({ descriptor, isWiring, isHero, onStartWire }: CadPortHandleProps): React.ReactElement {
  const sphereRef = useRef<THREE.Mesh | null>(null);
  const ringRef = useRef<THREE.Mesh | null>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    return () => {
      setDocumentCursor("auto");
    };
  }, []);

  useFrame((state, delta) => {
    const sphere = sphereRef.current;
    if (sphere) {
      const targetScale = isWiring ? 1.32 : hovered ? 1.22 : 1.0;
      const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 14);
      const next = sphere.scale.x + (targetScale - sphere.scale.x) * alpha;
      sphere.scale.setScalar(next);
    }
    const ring = ringRef.current;
    if (ring) {
      ring.rotation.z = state.clock.elapsedTime * (isWiring ? 2.4 : 0.9);
    }
  });

  const baseColor = isWiring ? "#fbbf24" : isHero ? "#38bdf8" : "#60a5fa";
  const emissiveColor = isWiring ? "#f59e0b" : isHero ? "#0ea5e9" : "#3b82f6";

  return (
    <group position={descriptor.localPos}>
      {/* Slim glowing stem anchoring the floating CADPort down to the 2D card */}
      <mesh position={[0, 0, -descriptor.localPos[2] * 0.5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.0032, 0.0045, descriptor.localPos[2], 10]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={emissiveColor}
          emissiveIntensity={0.8}
          transparent
          opacity={0.78}
        />
      </mesh>

      {/* Subtle halo ring on the board surface beneath the port */}
      <mesh ref={ringRef} position={[0, 0, -descriptor.localPos[2] + 0.003]}>
        <ringGeometry args={[0.022, 0.029, 24]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={hovered || isWiring ? 0.92 : 0.55}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Interactive glowing CADPort sphere */}
      <mesh
        ref={sphereRef}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          setDocumentCursor("crosshair");
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          setDocumentCursor("auto");
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onStartWire(descriptor);
        }}
      >
        <sphereGeometry args={[0.024, 20, 20]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={emissiveColor}
          emissiveIntensity={isWiring ? 1.8 : hovered ? 1.45 : 0.95}
          roughness={0.18}
          metalness={0.28}
        />
      </mesh>
    </group>
  );
}

/**
 * 45°-Angled Architectural Drafting Podium hosting the live Miro-like `.mscanvas`
 * infinite canvas simultaneously with the Circular Center Plinth.
 */
export function DraftingPodium({
  document: doc,
  bridge,
  tiltDeg,
  simulationTime,
  isPlaying,
  activeHeroTileId,
  focusedTileId = null,
  plinthWorldCenter,
  visible,
  onTileSelect,
  onFocusTileOnPlinth,
  onFocusTileFullscreen,
  onMoveTile,
  onCreateSpatialWire,
  onPageModel,
  onTogglePlaying,
  onToggleTilt,
  onResetView,
  onHudStatusChange,
  onInteractionLockChange,
}: DraftingPodiumProps): React.ReactElement | null {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls);
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const podiumTiltGroupRef = useRef<THREE.Group | null>(null);
  const reticleGroupRef = useRef<THREE.Group | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const lastClickRef = useRef<{ tileId: string; timeMs: number } | null>(null);
  const lastFocusedClickMsRef = useRef<number>(0);
  const lastZoomToggleMsRef = useRef<number>(0);
  const dragStartBoardRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);
  const panDragRef = useRef<{
    startU: number;
    startV: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const windowRaycasterRef = useRef(new THREE.Raycaster());
  const windowNdcRef = useRef(new THREE.Vector2());
  const boardCaptureRef = useRef<{
    target: { setPointerCapture?: (id: number) => void; releasePointerCapture?: (id: number) => void } | null;
    pointerId: number | null;
  }>({ target: null, pointerId: null });
  const capturedImageCacheRef = useRef<Map<string, { url: string; img: HTMLImageElement }>>(new Map());
  const latestSimTimeRef = useRef(simulationTime);
  latestSimTimeRef.current = simulationTime;
  const xrSession = useXR((s) => s.session);

  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [wireDragTargetPos, setWireDragTargetPos] = useState<[number, number, number] | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const dragPreviewRef = useRef<DragPreviewState | null>(null);
  dragPreviewRef.current = dragPreview;
  const [isPanningBoard, setIsPanningBoard] = useState(false);
  const [boardPan, setBoardPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const boardPanRef = useRef(boardPan);
  boardPanRef.current = boardPan;
  const [activeWireDrag, setActiveWireDrag] = useState<ActiveSpatialWireDrag | null>(null);
  const activeWireDragRef = useRef<ActiveSpatialWireDrag | null>(null);
  activeWireDragRef.current = activeWireDrag;
  const [hoverTargetTileId, setHoverTargetTileId] = useState<string | null>(null);
  const [hoveredMaximizeTileId, setHoveredMaximizeTileId] = useState<string | null>(null);
  const [hoveredHeaderBtn, setHoveredHeaderBtn] = useState<BoardPaintOptions["hoveredHeaderBtn"]>(null);
  const [capturedImages, setCapturedImages] = useState<Map<string, HTMLImageElement>>(() => new Map());

  // Reset board pan cleanly when switching documents
  useEffect(() => {
    setBoardPan({ x: 0, y: 0 });
  }, [doc.id]);

  // Synchronously toggle OrbitControls.enabled on the exact pointerdown tick BEFORE OrbitControls sees the event
  const setOrbitLockedImmediate = useCallback(
    (locked: boolean) => {
      const ctrl = controlsRef.current as unknown as { enabled?: boolean } | null;
      if (ctrl && typeof ctrl.enabled === "boolean") {
        ctrl.enabled = !locked;
      }
      onInteractionLockChange?.(locked);
    },
    [onInteractionLockChange],
  );

  const clampedTiltDeg = clampNumber(tiltDeg, 0, 85);
  const targetTiltRad = -(clampedTiltDeg * Math.PI) / 180;

  // Quantize simulationTime to 0.5s ticks (max 2 Hz, 0 Hz during ref-driven playback) for Quest 2 FPS
  const quantizedSimHalfSec = Number.isFinite(simulationTime) ? Math.floor(simulationTime * 2) : 0;

  // Exact SpatialPlane3D corresponding to the tilted podium surface
  const podiumPlane = useMemo(() => buildPodiumSpatialPlane(clampedTiltDeg), [clampedTiltDeg]);

  // Register/update the podium plane on the SpatialSurfaceBridge whenever tilt changes
  useEffect(() => {
    bridge.registerPlane(podiumPlane);
  }, [bridge, podiumPlane]);

  // Extract any live browser-captured SVG data URLs attached to tiles
  const capturedUrlEntries = useMemo(() => {
    const entries: Array<readonly [string, string]> = [];
    for (const tile of Object.values(doc.tiles)) {
      const raw = tile.viewState?.["capturedSvgDataUrl"];
      if (typeof raw === "string" && raw.length > 0) {
        entries.push([tile.id, raw] as const);
      }
    }
    return entries;
  }, [doc.tiles]);

  // Decode tile.viewState["capturedSvgDataUrl"] asynchronously into reusable HTMLImageElements
  useEffect(() => {
    if (typeof Image === "undefined") return;
    let cancelled = false;
    const cache = capturedImageCacheRef.current;
    const activeIds = new Set<string>();
    let removedAny = false;

    for (const [tileId] of capturedUrlEntries) {
      activeIds.add(tileId);
    }
    for (const existingId of Array.from(cache.keys())) {
      if (!activeIds.has(existingId)) {
        cache.delete(existingId);
        removedAny = true;
      }
    }

    const buildImageMap = (): Map<string, HTMLImageElement> => {
      const next = new Map<string, HTMLImageElement>();
      for (const [id, entry] of cache.entries()) {
        next.set(id, entry.img);
      }
      return next;
    };

    let pendingDecodes = 0;
    for (const [tileId, url] of capturedUrlEntries) {
      const existing = cache.get(tileId);
      if (existing && existing.url === url) {
        continue;
      }
      pendingDecodes += 1;
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (cancelled) return;
        cache.set(tileId, { url, img });
        setCapturedImages(buildImageMap());
      };
      img.onerror = () => {
        // Safely ignore invalid/corrupted captures so board-painter falls back to UnifiedGraph
      };
      img.src = url;
    }

    if (removedAny && pendingDecodes === 0) {
      setCapturedImages(buildImageMap());
    }

    return () => {
      cancelled = true;
    };
  }, [capturedUrlEntries]);

  useEffect(() => {
    const cache = capturedImageCacheRef.current;
    return () => {
      cache.clear();
    };
  }, []);

  // Zero-allocation persistent offscreen Retina 2000x1250 (1.25x logical 1600x1000) canvas + THREE.CanvasTexture
  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(ROTUNDA_BOARD_CANVAS_WIDTH * PODIUM_CANVAS_DPR);
    canvas.height = Math.round(ROTUNDA_BOARD_CANVAS_HEIGHT * PODIUM_CANVAS_DPR);
    const initCtx = canvas.getContext("2d");
    if (initCtx) {
      initCtx.fillStyle = "#f8fafc";
      initCtx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
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

  const validFocusedTileId = focusedTileId && doc.tiles[focusedTileId] ? focusedTileId : null;

  // Repaint and upload only when board state, interactions, focus zoom, pan, decoded SVGs, or 0.5s sim ticks change
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    const tex = textureRef.current;
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(PODIUM_CANVAS_DPR, 0, 0, PODIUM_CANVAS_DPR, 0, 0);
    }
    const latest = latestSimTimeRef.current;
    const displaySimTime =
      Number.isFinite(latest) && Math.floor(latest * 2) === quantizedSimHalfSec ? latest : quantizedSimHalfSec * 0.5;
    paintBoardToTextureCanvas(
      canvas,
      doc,
      displaySimTime,
      dragPreview,
      hoverTargetTileId,
      activeHeroTileId,
      capturedImages,
      {
        focusedTileId: validFocusedTileId,
        boardPan,
        hoveredMaximizeTileId,
        hoveredHeaderBtn,
      },
    );
    tex.needsUpdate = true;
  }, [
    doc,
    quantizedSimHalfSec,
    dragPreview,
    hoverTargetTileId,
    activeHeroTileId,
    capturedImages,
    texture,
    visible,
    validFocusedTileId,
    boardPan,
    hoveredMaximizeTileId,
    hoveredHeaderBtn,
  ]);

  // Clear active interactions if podium is hidden
  useEffect(() => {
    if (!visible) {
      setDragPreview(null);
      dragPreviewRef.current = null;
      panDragRef.current = null;
      setIsPanningBoard(false);
      setActiveWireDrag(null);
      setHoverTargetTileId(null);
      setHoveredMaximizeTileId(null);
      setHoveredHeaderBtn(null);
      setWireDragTargetPos(null);
      if (reticleGroupRef.current) {
        reticleGroupRef.current.visible = false;
      }
      dragStartBoardRef.current = null;
      dragMovedRef.current = false;
      setOrbitLockedImmediate(false);
    }
  }, [visible, setOrbitLockedImmediate]);

  // Keep OrbitControls lock synchronized during tile drag, background pan, or CADPort wire drag
  const interactionLocked = visible && (dragPreview !== null || isPanningBoard || activeWireDrag !== null);
  useEffect(() => {
    setOrbitLockedImmediate(interactionLocked);
  }, [interactionLocked, setOrbitLockedImmediate]);

  useEffect(() => {
    return () => {
      setOrbitLockedImmediate(false);
      setDocumentCursor("auto");
    };
  }, [setOrbitLockedImmediate]);

  const releaseBoardCapture = useCallback(() => {
    const { target, pointerId } = boardCaptureRef.current;
    if (target && pointerId !== null && typeof target.releasePointerCapture === "function") {
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        // Pointer capture may already have been released
      }
    }
    boardCaptureRef.current = { target: null, pointerId: null };
  }, []);

  const findTileAtBoardPoint = useCallback(
    (bx: number, by: number): CanvasTile | undefined => {
      const sorted = Object.values(doc.tiles).sort((a, b) => b.zIndex - a.zIndex);
      return sorted.find((t) => {
        const b = resolveEffectiveBounds(t, dragPreviewRef.current);
        return bx >= b.x && bx <= b.x + b.width && by >= b.y && by <= b.y + b.height;
      });
    },
    [doc.tiles],
  );

  const projectClientPointerToPodium = useCallback(
    (clientX: number, clientY: number) => {
      const dom = gl.domElement;
      const rect = dom.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const ndc = windowNdcRef.current;
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
      const raycaster = windowRaycasterRef.current;
      raycaster.setFromCamera(ndc, camera);
      const rayOrigin: [number, number, number] = [
        raycaster.ray.origin.x,
        raycaster.ray.origin.y,
        raycaster.ray.origin.z,
      ];
      const rayDir: [number, number, number] = [
        raycaster.ray.direction.x,
        raycaster.ray.direction.y,
        raycaster.ray.direction.z,
      ];
      const hit = projectRayToPlane(rayOrigin, rayDir, podiumPlane);
      return hit.hit ? hit : null;
    },
    [gl, camera, podiumPlane],
  );

  const finishActiveInteraction = useCallback(
    (finalUv?: { u: number; v: number } | null) => {
      releaseBoardCapture();
      const pendingWire = activeWireDragRef.current;
      if (pendingWire && finalUv) {
        const pan = boardPanRef.current;
        const boardPt = planeUvToBoard(finalUv.u, finalUv.v, pan.x, pan.y);
        const targetTile = findTileAtBoardPoint(boardPt.x, boardPt.y);
        if (targetTile && targetTile.id !== pendingWire.sourceTileId) {
          onCreateSpatialWire?.(pendingWire.sourceTileId, targetTile.id, pendingWire.sourceAnchor);
          playRotundaCue("snap");
        }
      }

      const pendingDrag = dragPreviewRef.current;
      if (pendingDrag && dragMovedRef.current) {
        let finalX = pendingDrag.x;
        let finalY = pendingDrag.y;
        if (finalUv) {
          const pan = boardPanRef.current;
          const boardPt = planeUvToBoard(finalUv.u, finalUv.v, pan.x, pan.y);
          finalX = Math.round(clampNumber(boardPt.x - pendingDrag.offsetX, -1200, 3200));
          finalY = Math.round(clampNumber(boardPt.y - pendingDrag.offsetY, -800, 2200));
        }
        onMoveTile?.(pendingDrag.tileId, finalX, finalY);
        playRotundaCue("tick");
      }

      dragPreviewRef.current = null;
      setDragPreview(null);
      panDragRef.current = null;
      setIsPanningBoard(false);
      activeWireDragRef.current = null;
      setActiveWireDrag(null);
      setHoverTargetTileId(null);
      setWireDragTargetPos(null);
      dragStartBoardRef.current = null;
      dragMovedRef.current = false;
      setOrbitLockedImmediate(false);
      setDocumentCursor("auto");
    },
    [releaseBoardCapture, findTileAtBoardPoint, onCreateSpatialWire, onMoveTile, setOrbitLockedImmediate],
  );

  // Global window raycast tracking while dragging a tile, panning the desk, or pulling a CADPort wire.
  // Ensures fast drags or drags past the desk bezel stay buttery-smooth and always commit on pointerup.
  useEffect(() => {
    if (!interactionLocked) return;

    const handleWindowPointerMove = (ev: PointerEvent) => {
      const hit = projectClientPointerToPodium(ev.clientX, ev.clientY);
      if (!hit) return;

      const rx = hit.worldPoint[0] + podiumPlane.normal[0] * 0.004;
      const ry = hit.worldPoint[1] + podiumPlane.normal[1] * 0.004;
      const rz = hit.worldPoint[2] + podiumPlane.normal[2] * 0.004;
      if (reticleGroupRef.current) {
        reticleGroupRef.current.position.set(rx, ry, rz);
        reticleGroupRef.current.visible = true;
      }

      const pendingWire = activeWireDragRef.current;
      if (pendingWire) {
        setWireDragTargetPos([rx, ry, rz]);
        const pan = boardPanRef.current;
        const boardPt = planeUvToBoard(hit.u, hit.v, pan.x, pan.y);
        const candidate = findTileAtBoardPoint(boardPt.x, boardPt.y);
        setHoverTargetTileId(candidate && candidate.id !== pendingWire.sourceTileId ? candidate.id : null);
        return;
      }

      const pendingDrag = dragPreviewRef.current;
      if (pendingDrag) {
        const pan = boardPanRef.current;
        const boardPt = planeUvToBoard(hit.u, hit.v, pan.x, pan.y);
        const startPt = dragStartBoardRef.current;
        const movedPastThreshold =
          dragMovedRef.current ||
          !startPt ||
          Math.hypot(boardPt.x - startPt.x, boardPt.y - startPt.y) >= DRAG_THRESHOLD_BOARD_UNITS;
        if (!movedPastThreshold) return;
        dragMovedRef.current = true;
        const newX = Math.round(clampNumber(boardPt.x - pendingDrag.offsetX, -1200, 3200));
        const newY = Math.round(clampNumber(boardPt.y - pendingDrag.offsetY, -800, 2200));
        if (newX !== pendingDrag.x || newY !== pendingDrag.y) {
          const next = { ...pendingDrag, x: newX, y: newY };
          dragPreviewRef.current = next;
          setDragPreview(next);
        }
        return;
      }

      const pendingPan = panDragRef.current;
      if (pendingPan) {
        const du = hit.u - pendingPan.startU;
        const dv = hit.v - pendingPan.startV;
        if (!pendingPan.moved && Math.hypot(du, dv) < 4) return;
        pendingPan.moved = true;
        const nextPanX = Math.round(clampNumber(pendingPan.startPanX + du, -900, 900));
        const nextPanY = Math.round(clampNumber(pendingPan.startPanY + dv, -650, 650));
        if (nextPanX !== boardPanRef.current.x || nextPanY !== boardPanRef.current.y) {
          const nextPan = { x: nextPanX, y: nextPanY };
          boardPanRef.current = nextPan;
          setBoardPan(nextPan);
        }
      }
    };

    const handleWindowPointerUp = (ev: PointerEvent) => {
      const hit = projectClientPointerToPodium(ev.clientX, ev.clientY);
      finishActiveInteraction(hit ? { u: hit.u, v: hit.v } : null);
    };

    const handleRelease = () => {
      finishActiveInteraction(null);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", handleWindowPointerMove);
      window.addEventListener("pointerup", handleWindowPointerUp);
      window.addEventListener("pointercancel", handleRelease);
    }
    if (xrSession && typeof xrSession.addEventListener === "function") {
      xrSession.addEventListener("selectend", handleRelease);
      xrSession.addEventListener("squeezeend", handleRelease);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("pointermove", handleWindowPointerMove);
        window.removeEventListener("pointerup", handleWindowPointerUp);
        window.removeEventListener("pointercancel", handleRelease);
      }
      if (xrSession && typeof xrSession.removeEventListener === "function") {
        xrSession.removeEventListener("selectend", handleRelease);
        xrSession.removeEventListener("squeezeend", handleRelease);
      }
    };
  }, [
    interactionLocked,
    xrSession,
    projectClientPointerToPodium,
    podiumPlane,
    findTileAtBoardPoint,
    finishActiveInteraction,
  ]);

  // Publish live HUD hint while dragging a tile, panning, zoomed into a block, or wiring a 3D CADPort
  useEffect(() => {
    if (!onHudStatusChange) return;
    if (!visible) {
      onHudStatusChange(null);
      return;
    }
    if (activeWireDrag) {
      const targetTile = hoverTargetTileId ? doc.tiles[hoverTargetTileId] : undefined;
      onHudStatusChange(
        targetTile
          ? `Wiring CADPort (${activeWireDrag.sourceTitle}) → Release to connect to "${targetTile.title}"`
          : `Wiring CADPort (${activeWireDrag.sourceTitle}) → Aim & release on any 2D tile on the desk`,
      );
    } else if (dragPreview) {
      const tile = doc.tiles[dragPreview.tileId];
      onHudStatusChange(
        `Moving "${tile?.title ?? dragPreview.tileId}" → (${Math.round(dragPreview.x)}, ${Math.round(dragPreview.y)})`,
      );
    } else if (isPanningBoard) {
      onHudStatusChange(`Panning 45° drafting board (${Math.round(boardPan.x)}, ${Math.round(boardPan.y)})`);
    } else if (validFocusedTileId) {
      const focusedTile = doc.tiles[validFocusedTileId];
      onHudStatusChange(
        `Desk Full-Screen: "${focusedTile?.title ?? validFocusedTileId}" · Click "← All Blocks", double-click, or press Esc to exit`,
      );
    } else {
      onHudStatusChange(null);
    }
  }, [
    activeWireDrag,
    dragPreview,
    isPanningBoard,
    boardPan.x,
    boardPan.y,
    validFocusedTileId,
    hoverTargetTileId,
    doc.tiles,
    visible,
    onHudStatusChange,
  ]);

  // Smoothly animate podium tilt angle (45° ↔ 12°) in useFrame
  useFrame((_, delta) => {
    const grp = podiumTiltGroupRef.current;
    if (!grp) return;
    const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 10);
    grp.rotation.x += (targetTiltRad - grp.rotation.x) * alpha;
    if (reticleGroupRef.current) {
      reticleGroupRef.current.rotation.x = grp.rotation.x;
    }
  });

  // Compute interactive CADPort sphere descriptors for all `cad3d` tiles (hidden when zoomed into a block)
  const cadPorts = useMemo<CadPortDescriptor[]>(() => {
    if (validFocusedTileId) return [];
    const tiles = Object.values(doc.tiles);
    const out: CadPortDescriptor[] = [];
    for (const tile of tiles) {
      if (tile.archetype !== "cad3d") continue;
      const effBounds = resolveEffectiveBounds(tile, dragPreview);
      const planeBounds = boardBoundsToPlaneBounds(effBounds, boardPan.x, boardPan.y);
      // Anchor glowing CADPort sphere near the lower-right corner of the card
      const portU = planeBounds.x + planeBounds.width - 28;
      const portV = planeBounds.y + planeBounds.height - 24;
      if (
        portU < 20 ||
        portU > ROTUNDA_BOARD_CANVAS_WIDTH - 20 ||
        portV < PODIUM_HEADER_HEIGHT + 10 ||
        portV > ROTUNDA_BOARD_CANVAS_HEIGHT - 10
      ) {
        continue;
      }
      const liftMeters = 0.044;
      out.push({
        tile,
        localPos: planeUvToPodiumLocal(portU, portV, liftMeters),
        worldPos: planeUvToWorld3D(podiumPlane, portU, portV, liftMeters),
        portU,
        portV,
      });
    }
    return out;
  }, [doc.tiles, dragPreview, boardPan.x, boardPan.y, podiumPlane, validFocusedTileId]);

  // Compute glowing curved Bezier fiber-optic tethers from `cad3d` tiles & activeHeroTileId up to the circular plinth
  const fiberTethers = useMemo<TetherSpec[]>(() => {
    if (validFocusedTileId) return [];
    const tiles = Object.values(doc.tiles);
    const seen = new Set<string>();
    const tetheredTiles: CanvasTile[] = [];

    for (const tile of tiles) {
      if (tile.archetype === "cad3d") {
        seen.add(tile.id);
        tetheredTiles.push(tile);
      }
    }
    if (activeHeroTileId && !seen.has(activeHeroTileId)) {
      const heroTile = doc.tiles[activeHeroTileId];
      if (heroTile) {
        seen.add(heroTile.id);
        tetheredTiles.push(heroTile);
      }
    }

    const out: TetherSpec[] = [];
    for (const tile of tetheredTiles) {
      const isHero = tile.id === activeHeroTileId;
      const effBounds = resolveEffectiveBounds(tile, dragPreview);
      const planeBounds = boardBoundsToPlaneBounds(effBounds, boardPan.x, boardPan.y);
      const centerU = clampNumber(planeBounds.x + planeBounds.width * 0.5, 24, ROTUNDA_BOARD_CANVAS_WIDTH - 24);
      const centerV = clampNumber(
        planeBounds.y + planeBounds.height * 0.5,
        PODIUM_HEADER_HEIGHT + 20,
        ROTUNDA_BOARD_CANVAS_HEIGHT - 20,
      );
      const p0 = planeUvToWorld3D(podiumPlane, centerU, centerV, 0.022);

      // Fan the upper tether endpoints neatly around the front rim of the circular plinth
      const dx = p0[0] - plinthWorldCenter[0];
      const dz = p0[2] - plinthWorldCenter[2];
      const horizLen = Math.hypot(dx, dz) || 1;
      const rimRadius = 0.42;
      const p3: [number, number, number] = [
        plinthWorldCenter[0] + (dx / horizLen) * rimRadius * 0.65,
        plinthWorldCenter[1] - 0.02,
        plinthWorldCenter[2] + (dz / horizLen) * rimRadius,
      ];

      // Graceful upward + forward Bezier arc
      const p1: [number, number, number] = [
        p0[0] + podiumPlane.normal[0] * 0.24,
        p0[1] + podiumPlane.normal[1] * 0.24 + 0.16,
        p0[2] + podiumPlane.normal[2] * 0.24 - 0.22,
      ];
      const p2: [number, number, number] = [
        p3[0] + (p0[0] - p3[0]) * 0.22,
        Math.max(p0[1], p3[1]) + 0.26,
        p3[2] + 0.44,
      ];

      out.push({
        id: `tether-${tile.id}`,
        tileId: tile.id,
        isHero,
        color: isHero ? "#38bdf8" : "#6366f1",
        p0,
        p1,
        p2,
        p3,
        points: sampleCubicBezier(p0, p1, p2, p3, 16),
      });
    }
    return out;
  }, [
    doc.tiles,
    activeHeroTileId,
    dragPreview,
    boardPan.x,
    boardPan.y,
    podiumPlane,
    plinthWorldCenter,
    validFocusedTileId,
  ]);

  // Compute 3D-to-2D curved spatial wires from CADPort handles to connected 2D schematic tiles
  const cadSpatialWires = useMemo(() => {
    if (validFocusedTileId) return [];
    const out: { id: string; points: [number, number, number][]; color: string }[] = [];
    for (const port of cadPorts) {
      for (const wire of Object.values(doc.wires)) {
        const otherId =
          wire.source.tileId === port.tile.id
            ? wire.target.tileId
            : wire.target.tileId === port.tile.id
              ? wire.source.tileId
              : null;
        if (!otherId) continue;
        const other = doc.tiles[otherId];
        if (!other) continue;
        const otherPlaneBounds = boardBoundsToPlaneBounds(
          resolveEffectiveBounds(other, dragPreview),
          boardPan.x,
          boardPan.y,
        );
        const toU = otherPlaneBounds.x + otherPlaneBounds.width * 0.5;
        const toV = otherPlaneBounds.y + otherPlaneBounds.height * 0.5;
        const to3D = planeUvToWorld3D(podiumPlane, toU, toV, 0.008);
        const mid3D: [number, number, number] = [
          (port.worldPos[0] + to3D[0]) * 0.5 + podiumPlane.normal[0] * 0.12,
          (port.worldPos[1] + to3D[1]) * 0.5 + podiumPlane.normal[1] * 0.12,
          (port.worldPos[2] + to3D[2]) * 0.5 + podiumPlane.normal[2] * 0.12,
        ];
        out.push({
          id: `${port.tile.id}-${wire.id}`,
          points: sampleQuadraticBezier(port.worldPos, mid3D, to3D, 16),
          color: wire.kind === "fmi-signal" ? "#10b981" : wire.kind === "requirement-trace" ? "#a855f7" : "#38bdf8",
        });
      }
    }
    return out;
  }, [cadPorts, doc.wires, doc.tiles, dragPreview, boardPan.x, boardPan.y, podiumPlane, validFocusedTileId]);

  // Sync bridge 3D-to-2D wire registry in useEffect (keeps render pure)
  useEffect(() => {
    if (!visible || validFocusedTileId) return;
    for (const port of cadPorts) {
      for (const wire of Object.values(doc.wires)) {
        const otherId =
          wire.source.tileId === port.tile.id
            ? wire.target.tileId
            : wire.target.tileId === port.tile.id
              ? wire.source.tileId
              : null;
        if (!otherId) continue;
        const other = doc.tiles[otherId];
        if (!other) continue;
        const otherPlaneBounds = boardBoundsToPlaneBounds(
          resolveEffectiveBounds(other, dragPreview),
          boardPan.x,
          boardPan.y,
        );
        bridge.upsert3DTo2DWire(wire.id, port.worldPos, "podium", {
          u: otherPlaneBounds.x + otherPlaneBounds.width * 0.5,
          v: otherPlaneBounds.y + otherPlaneBounds.height * 0.5,
        });
      }
    }
  }, [bridge, cadPorts, doc.wires, doc.tiles, dragPreview, boardPan.x, boardPan.y, visible, validFocusedTileId]);

  // Live curved wire preview while pulling from a CADPort sphere
  const liveWirePreviewPoints = useMemo<[number, number, number][] | null>(() => {
    if (!activeWireDrag || !wireDragTargetPos) return null;
    const from = activeWireDrag.from3D;
    const to = wireDragTargetPos;
    const mid: [number, number, number] = [
      (from[0] + to[0]) * 0.5 + podiumPlane.normal[0] * 0.14,
      (from[1] + to[1]) * 0.5 + podiumPlane.normal[1] * 0.14,
      (from[2] + to[2]) * 0.5 + podiumPlane.normal[2] * 0.14,
    ];
    return sampleQuadraticBezier(from, mid, to, 16);
  }, [activeWireDrag, wireDragTargetPos, podiumPlane]);

  const handleStartWireFromPort = useCallback(
    (descriptor: CadPortDescriptor) => {
      setOrbitLockedImmediate(true);
      dragPreviewRef.current = null;
      setDragPreview(null);
      panDragRef.current = null;
      setIsPanningBoard(false);
      dragStartBoardRef.current = null;
      dragMovedRef.current = false;
      const nextWire: ActiveSpatialWireDrag = {
        sourceTileId: descriptor.tile.id,
        sourceTitle: descriptor.tile.title,
        sourceAnchor: "CADPort",
        from3D: descriptor.worldPos,
      };
      activeWireDragRef.current = nextWire;
      setActiveWireDrag(nextWire);
      onTileSelect?.(descriptor.tile.id);
      playRotundaCue("click");
    },
    [onTileSelect, setOrbitLockedImmediate],
  );

  const stepFocusedTile = useCallback(
    (delta: number) => {
      const sorted = Object.values(doc.tiles).sort((a, b) => a.zIndex - b.zIndex);
      if (sorted.length === 0) return;
      const curIdx = validFocusedTileId ? sorted.findIndex((t) => t.id === validFocusedTileId) : 0;
      const safeCur = curIdx >= 0 ? curIdx : 0;
      const nextIdx = (((safeCur + delta) % sorted.length) + sorted.length) % sorted.length;
      const nextTile = sorted[nextIdx];
      if (nextTile) {
        onFocusTileFullscreen?.(nextTile.id);
        playRotundaCue("page");
      }
    },
    [doc.tiles, validFocusedTileId, onFocusTileFullscreen],
  );

  const handleBoardPointer = useCallback(
    (phase: "down" | "move" | "up", e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      if (!bridge.getPlane("podium")) {
        bridge.registerPlane(podiumPlane);
      }

      const rayOrigin: [number, number, number] = [e.ray.origin.x, e.ray.origin.y, e.ray.origin.z];
      const rayDir: [number, number, number] = [e.ray.direction.x, e.ray.direction.y, e.ray.direction.z];
      const dispatchedHit = bridge.dispatchRayPointer(rayOrigin, rayDir, phase);

      // Prefer exact Three.js mesh UV when available (exact even mid-tilt-animation!), fallback to plane projection
      let u: number;
      let v: number;
      let worldPt: [number, number, number];
      if (e.uv) {
        u = clampNumber(e.uv.x * ROTUNDA_BOARD_CANVAS_WIDTH, 0, ROTUNDA_BOARD_CANVAS_WIDTH);
        v = clampNumber((1 - e.uv.y) * ROTUNDA_BOARD_CANVAS_HEIGHT, 0, ROTUNDA_BOARD_CANVAS_HEIGHT);
        worldPt = [e.point.x, e.point.y, e.point.z];
      } else {
        const hit =
          dispatchedHit && dispatchedHit.planeId === "podium"
            ? dispatchedHit
            : (() => {
                const direct = projectRayToPlane(rayOrigin, rayDir, podiumPlane);
                return direct.hit ? direct : null;
              })();
        if (!hit) {
          if (phase === "up") finishActiveInteraction(null);
          return;
        }
        u = hit.u;
        v = hit.v;
        worldPt = hit.worldPoint;
      }

      // Lift reticle 4mm along podium normal so it never z-fights with the board surface.
      const rx = worldPt[0] + podiumPlane.normal[0] * 0.004;
      const ry = worldPt[1] + podiumPlane.normal[1] * 0.004;
      const rz = worldPt[2] + podiumPlane.normal[2] * 0.004;
      if (reticleGroupRef.current) {
        reticleGroupRef.current.position.set(rx, ry, rz);
        reticleGroupRef.current.visible = true;
      }
      if (activeWireDragRef.current) {
        setWireDragTargetPos([rx, ry, rz]);
      }

      const pan = boardPanRef.current;
      const isPanned = Math.hypot(pan.x, pan.y) > 2;
      const boardPt = planeUvToBoard(u, v, pan.x, pan.y);

      if (phase === "down") {
        // 1. Header strip button hits (works identically in both Overview and Full-Screen Zoom modes)
        if (v <= PODIUM_HEADER_HEIGHT) {
          if (validFocusedTileId) {
            if (pointInPodiumRect(u, v, PODIUM_BACK_BTN_RECT, 6)) {
              setOrbitLockedImmediate(true);
              onFocusTileFullscreen?.(null);
              playRotundaCue("click");
              window.setTimeout(() => setOrbitLockedImmediate(false), 60);
              return;
            }
            if (pointInPodiumRect(u, v, PODIUM_PREV_TILE_BTN_RECT, 6)) {
              setOrbitLockedImmediate(true);
              stepFocusedTile(-1);
              window.setTimeout(() => setOrbitLockedImmediate(false), 60);
              return;
            }
            if (pointInPodiumRect(u, v, PODIUM_NEXT_TILE_BTN_RECT, 6)) {
              setOrbitLockedImmediate(true);
              stepFocusedTile(1);
              window.setTimeout(() => setOrbitLockedImmediate(false), 60);
              return;
            }
            return;
          }
          if (isPanned && pointInPodiumRect(u, v, PODIUM_RESET_PAN_BTN_RECT, 6)) {
            setOrbitLockedImmediate(true);
            boardPanRef.current = { x: 0, y: 0 };
            setBoardPan({ x: 0, y: 0 });
            playRotundaCue("snap");
            window.setTimeout(() => setOrbitLockedImmediate(false), 60);
            return;
          }
          return;
        }

        // 2. Full-screen zoomed block mode: double-click anywhere on the zoomed block to exit back to board
        if (validFocusedTileId) {
          const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
          if (nowMs - lastFocusedClickMsRef.current < DOUBLE_CLICK_MS) {
            lastFocusedClickMsRef.current = 0;
            lastZoomToggleMsRef.current = nowMs;
            onFocusTileFullscreen?.(null);
            playRotundaCue("click");
          } else {
            lastFocusedClickMsRef.current = nowMs;
          }
          return;
        }

        // 3. Complete active CADPort 3D-to-2D wire drop
        if (activeWireDragRef.current) {
          finishActiveInteraction({ u, v });
          return;
        }

        const hitTile = findTileAtBoardPoint(boardPt.x, boardPt.y);

        if (hitTile) {
          const isHero = Boolean(activeHeroTileId && activeHeroTileId === hitTile.id);
          const maxBtnRect = getTileMaximizeButtonRect(hitTile.bounds, isHero);

          // 3A. Explicit `[⤢]` maximize button click -> Zoom this block full-screen on the 45° desk!
          if (pointInPodiumRect(boardPt.x, boardPt.y, maxBtnRect, 12)) {
            lastZoomToggleMsRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
            setOrbitLockedImmediate(true);
            onTileSelect?.(hitTile.id);
            onFocusTileFullscreen?.(hitTile.id);
            playRotundaCue("page");
            window.setTimeout(() => setOrbitLockedImmediate(false), 60);
            return;
          }

          onTileSelect?.(hitTile.id);

          const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
          const prevClick = lastClickRef.current;
          const isDoubleClick =
            prevClick !== null && prevClick.tileId === hitTile.id && nowMs - prevClick.timeMs < DOUBLE_CLICK_MS;
          lastClickRef.current = { tileId: hitTile.id, timeMs: nowMs };

          // 3B. Double-click any tile -> Zoom full-screen on the desk (and sync CAD plinth if applicable)
          if (isDoubleClick) {
            lastClickRef.current = null;
            lastZoomToggleMsRef.current = nowMs;
            setOrbitLockedImmediate(true);
            onFocusTileFullscreen?.(hitTile.id);
            if (hitTile.archetype === "cad3d" || hitTile.archetype === "schematic" || hitTile.archetype === "fmu") {
              onFocusTileOnPlinth?.(hitTile.id);
            }
            playRotundaCue("page");
            window.setTimeout(() => setOrbitLockedImmediate(false), 60);
            return;
          }

          const hasCadTiles = Object.values(doc.tiles).some((t) => t.archetype === "cad3d");
          const isPlinthLinked =
            hitTile.archetype === "cad3d" ||
            hitTile.id === activeHeroTileId ||
            (!hasCadTiles && (hitTile.archetype === "schematic" || hitTile.archetype === "fmu"));

          if (isPlinthLinked) {
            onFocusTileOnPlinth?.(hitTile.id);
            playRotundaCue("page");
          } else {
            playRotundaCue("click");
          }

          // 3C. Start tile drag with synchronous OrbitControls lock!
          if (!hitTile.locked) {
            setOrbitLockedImmediate(true);
            setDocumentCursor("grabbing");
            dragStartBoardRef.current = { x: boardPt.x, y: boardPt.y };
            dragMovedRef.current = false;
            const nextDrag: DragPreviewState = {
              tileId: hitTile.id,
              offsetX: boardPt.x - hitTile.bounds.x,
              offsetY: boardPt.y - hitTile.bounds.y,
              x: hitTile.bounds.x,
              y: hitTile.bounds.y,
            };
            dragPreviewRef.current = nextDrag;
            setDragPreview(nextDrag);
          }
          return;
        }

        // 4. Pressed on empty desk grid -> smoothly pan the drafting canvas (synchronously locking OrbitControls!)
        setOrbitLockedImmediate(true);
        setDocumentCursor("grabbing");
        panDragRef.current = {
          startU: u,
          startV: v,
          startPanX: pan.x,
          startPanY: pan.y,
          moved: false,
        };
        setIsPanningBoard(true);
        return;
      }

      if (phase === "move") {
        // Active drags/pans are handled smoothly via global window pointermove; here handle hover highlights & cursor
        if (activeWireDragRef.current || dragPreviewRef.current || panDragRef.current) {
          return;
        }

        if (v <= PODIUM_HEADER_HEIGHT) {
          let nextBtn: BoardPaintOptions["hoveredHeaderBtn"] = null;
          if (validFocusedTileId) {
            if (pointInPodiumRect(u, v, PODIUM_BACK_BTN_RECT, 6)) nextBtn = "back";
            else if (pointInPodiumRect(u, v, PODIUM_PREV_TILE_BTN_RECT, 6)) nextBtn = "prev";
            else if (pointInPodiumRect(u, v, PODIUM_NEXT_TILE_BTN_RECT, 6)) nextBtn = "next";
          } else if (isPanned && pointInPodiumRect(u, v, PODIUM_RESET_PAN_BTN_RECT, 6)) {
            nextBtn = "reset-pan";
          }
          setHoveredHeaderBtn((prev) => (prev === nextBtn ? prev : nextBtn));
          setHoveredMaximizeTileId((prev) => (prev === null ? prev : null));
          setDocumentCursor(nextBtn ? "pointer" : "default");
          return;
        }

        setHoveredHeaderBtn((prev) => (prev === null ? prev : null));

        if (validFocusedTileId) {
          setHoveredMaximizeTileId((prev) => (prev === null ? prev : null));
          setDocumentCursor("zoom-out");
          return;
        }

        const hitTile = findTileAtBoardPoint(boardPt.x, boardPt.y);
        if (hitTile) {
          const isHero = Boolean(activeHeroTileId && activeHeroTileId === hitTile.id);
          const maxBtnRect = getTileMaximizeButtonRect(hitTile.bounds, isHero);
          if (pointInPodiumRect(boardPt.x, boardPt.y, maxBtnRect, 10)) {
            setHoveredMaximizeTileId((prev) => (prev === hitTile.id ? prev : hitTile.id));
            setDocumentCursor("pointer");
          } else {
            setHoveredMaximizeTileId((prev) => (prev === null ? prev : null));
            setDocumentCursor(hitTile.locked ? "default" : "grab");
          }
        } else {
          setHoveredMaximizeTileId((prev) => (prev === null ? prev : null));
          setDocumentCursor("grab");
        }
        return;
      }

      if (phase === "up") {
        finishActiveInteraction({ u, v });
      }
    },
    [
      bridge,
      podiumPlane,
      validFocusedTileId,
      findTileAtBoardPoint,
      activeHeroTileId,
      doc.tiles,
      onTileSelect,
      onFocusTileOnPlinth,
      onFocusTileFullscreen,
      stepFocusedTile,
      setOrbitLockedImmediate,
      finishActiveInteraction,
    ],
  );

  // Native DOM dblclick backup on the board mesh so double-clicking a tile always zooms full-screen
  // even when GPU frame rendering stretches the pointerdown interval slightly past DOUBLE_CLICK_MS.
  const handleBoardDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (nowMs - lastZoomToggleMsRef.current < 320) return;

      let u: number;
      let v: number;
      if (e.uv) {
        u = clampNumber(e.uv.x * ROTUNDA_BOARD_CANVAS_WIDTH, 0, ROTUNDA_BOARD_CANVAS_WIDTH);
        v = clampNumber((1 - e.uv.y) * ROTUNDA_BOARD_CANVAS_HEIGHT, 0, ROTUNDA_BOARD_CANVAS_HEIGHT);
      } else {
        const direct = projectRayToPlane(
          [e.ray.origin.x, e.ray.origin.y, e.ray.origin.z],
          [e.ray.direction.x, e.ray.direction.y, e.ray.direction.z],
          podiumPlane,
        );
        if (!direct.hit) return;
        u = direct.u;
        v = direct.v;
      }
      if (v <= PODIUM_HEADER_HEIGHT) return;

      if (validFocusedTileId) {
        lastZoomToggleMsRef.current = nowMs;
        onFocusTileFullscreen?.(null);
        playRotundaCue("click");
        return;
      }

      const pan = boardPanRef.current;
      const boardPt = planeUvToBoard(u, v, pan.x, pan.y);
      const hitTile = findTileAtBoardPoint(boardPt.x, boardPt.y);
      if (hitTile) {
        lastZoomToggleMsRef.current = nowMs;
        finishActiveInteraction(null);
        onTileSelect?.(hitTile.id);
        onFocusTileFullscreen?.(hitTile.id);
        if (hitTile.archetype === "cad3d" || hitTile.archetype === "schematic" || hitTile.archetype === "fmu") {
          onFocusTileOnPlinth?.(hitTile.id);
        }
        playRotundaCue("page");
      }
    },
    [
      podiumPlane,
      validFocusedTileId,
      findTileAtBoardPoint,
      finishActiveInteraction,
      onTileSelect,
      onFocusTileFullscreen,
      onFocusTileOnPlinth,
    ],
  );

  // Chassis geometry constants (computed unconditionally before hooks & visibility guard)
  const topBezel = 0.044;
  const sideBezel = 0.048;
  const totalWidth = PODIUM_WIDTH_METERS + sideBezel * 2;
  const totalHeight = PODIUM_HEIGHT_METERS + topBezel + BEZEL_RIM_HEIGHT;
  const chassisCenterY = (topBezel - BEZEL_RIM_HEIGHT) * 0.5;
  const accentColor = activeWireDrag ? "#f59e0b" : "#0284c7";

  // Procedural CNC bead-blasted brushed-aluminum PBR maps, chamfered unibody geometries & floor contact shadow
  const chassisPbr = useMemo(() => createBrushedAluminumPbr(3, 2, "#8794a4", 256), []);
  const trimSilverPbr = useMemo(() => createBrushedAluminumPbr(2, 4, "#d2dbe6", 256), []);
  const floorShadowTex = useMemo(() => createRadialContactShadowTexture(0.46, 0.22, 128), []);
  const chassisGeom = useMemo(
    () => createChamferedChassisGeometry(totalWidth - 0.02, totalHeight - 0.02, 0.022, 0.034),
    [totalWidth, totalHeight],
  );
  const shroudGeom = useMemo(
    () => createChamferedChassisGeometry(totalWidth - 0.18, totalHeight - 0.16, 0.012, 0.028),
    [totalWidth, totalHeight],
  );
  const basePlateGeom = useMemo(() => createPodiumBasePlateGeometry(), []);

  useEffect(() => {
    return () => {
      chassisPbr.dispose();
      trimSilverPbr.dispose();
      floorShadowTex.dispose();
      chassisGeom.dispose();
      shroudGeom.dispose();
      basePlateGeom.dispose();
    };
  }, [chassisPbr, trimSilverPbr, floorShadowTex, chassisGeom, shroudGeom, basePlateGeom]);

  if (!visible) {
    return null;
  }

  // 5 tactile bezel buttons distributed evenly along the lower control rim
  const keycapWidth = 0.258;
  const keycapHeight = 0.068;
  const keycapGap = 0.024;
  const keycapStride = keycapWidth + keycapGap;
  const keycapStartX = -2 * keycapStride;

  return (
    <group name="rotunda-drafting-podium">
      {/* Floor-Anchored CNC Brushed Titanium Pedestal Column & Articulated Tilt Yoke */}
      <group position={[PODIUM_CENTER[0], 0, PODIUM_CENTER[2]]}>
        {/* Baked soft radial floor contact shadow under weighted pedestal base (zero shadow-map GPU cost) */}
        <mesh position={[0, 0.004, -0.08]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.72, 32]} />
          <meshBasicMaterial map={floorShadowTex} transparent depthWrite={false} />
        </mesh>
        {/* Chamfered CNC-turned weighted anodized steel floor base plate */}
        <mesh geometry={basePlateGeom} position={[0, 0.002, -0.08]}>
          <meshStandardMaterial
            map={chassisPbr.map}
            normalMap={chassisPbr.normalMap}
            normalScale={new THREE.Vector2(0.16, 0.16)}
            roughnessMap={chassisPbr.roughnessMap}
            roughness={1.0}
            metalness={0.82}
          />
        </mesh>
        {/* Subtle anodized recessed collar ring */}
        <mesh position={[0, 0.046, -0.08]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.24, 0.258, 48]} />
          <meshBasicMaterial
            color={accentColor}
            transparent
            opacity={0.55}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
        {/* Angled twin-ribbed brushed aluminum pedestal column */}
        <mesh position={[0, 0.47, -0.095]} rotation={[-0.08, 0, 0]}>
          <boxGeometry args={[0.16, 0.8, 0.11]} />
          <meshStandardMaterial
            map={chassisPbr.map}
            normalMap={chassisPbr.normalMap}
            normalScale={new THREE.Vector2(0.14, 0.14)}
            roughnessMap={chassisPbr.roughnessMap}
            roughness={1.0}
            metalness={0.8}
          />
        </mesh>
        {/* Brushed bead-blasted silver titanium structural ribs */}
        <mesh position={[-0.086, 0.47, -0.095]} rotation={[-0.08, 0, 0]}>
          <boxGeometry args={[0.018, 0.78, 0.125]} />
          <meshStandardMaterial
            map={trimSilverPbr.map}
            normalMap={trimSilverPbr.normalMap}
            normalScale={new THREE.Vector2(0.12, 0.12)}
            roughnessMap={trimSilverPbr.roughnessMap}
            roughness={1.0}
            metalness={0.86}
          />
        </mesh>
        <mesh position={[0.086, 0.47, -0.095]} rotation={[-0.08, 0, 0]}>
          <boxGeometry args={[0.018, 0.78, 0.125]} />
          <meshStandardMaterial
            map={trimSilverPbr.map}
            normalMap={trimSilverPbr.normalMap}
            normalScale={new THREE.Vector2(0.12, 0.12)}
            roughnessMap={trimSilverPbr.roughnessMap}
            roughness={1.0}
            metalness={0.86}
          />
        </mesh>
        {/* Subtle front accent strip on column */}
        <mesh position={[0, 0.46, -0.038]} rotation={[-0.08, 0, 0]}>
          <boxGeometry args={[0.008, 0.62, 0.006]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={1.0} toneMapped={false} />
        </mesh>
        {/* Machined stainless horizontal tilt-hinge axle, chamfered end caps & twin yoke brackets */}
        <mesh position={[0, 0.865, -0.06]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.032, 0.032, 0.48, 28]} />
          <meshStandardMaterial
            map={trimSilverPbr.map}
            normalMap={trimSilverPbr.normalMap}
            normalScale={new THREE.Vector2(0.12, 0.12)}
            roughnessMap={trimSilverPbr.roughnessMap}
            roughness={0.85}
            metalness={0.9}
          />
        </mesh>
        {[-0.245, 0.245].map((capX) => (
          <mesh key={capX} position={[capX, 0.865, -0.06]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.036, 0.036, 0.016, 24]} />
            <meshStandardMaterial color="#334155" metalness={0.88} roughness={0.24} />
          </mesh>
        ))}
        <mesh position={[-0.19, 0.855, -0.06]}>
          <boxGeometry args={[0.042, 0.09, 0.09]} />
          <meshStandardMaterial
            map={chassisPbr.map}
            normalMap={chassisPbr.normalMap}
            normalScale={new THREE.Vector2(0.14, 0.14)}
            roughnessMap={chassisPbr.roughnessMap}
            roughness={1.0}
            metalness={0.82}
          />
        </mesh>
        <mesh position={[0.19, 0.855, -0.06]}>
          <boxGeometry args={[0.042, 0.09, 0.09]} />
          <meshStandardMaterial
            map={chassisPbr.map}
            normalMap={chassisPbr.normalMap}
            normalScale={new THREE.Vector2(0.14, 0.14)}
            roughnessMap={chassisPbr.roughnessMap}
            roughness={1.0}
            metalness={0.82}
          />
        </mesh>
      </group>

      {/* Tilted 45° Architectural CNC Unibody Studio Drafting Console Desk */}
      <group ref={podiumTiltGroupRef} position={PODIUM_CENTER} rotation={[targetTiltRad, 0, 0]}>
        {/* Main CNC-milled rounded chamfered unibody aluminum shell (recessed cleanly behind z=0 screen) */}
        <mesh geometry={chassisGeom} position={[0, chassisCenterY, -0.036]}>
          <meshStandardMaterial
            map={chassisPbr.map}
            normalMap={chassisPbr.normalMap}
            normalScale={new THREE.Vector2(0.14, 0.14)}
            roughnessMap={chassisPbr.roughnessMap}
            roughness={1.0}
            metalness={0.82}
          />
        </mesh>

        {/* Chamfered rear stiffening plate */}
        <mesh geometry={shroudGeom} position={[0, chassisCenterY + 0.02, -0.062]}>
          <meshStandardMaterial
            map={trimSilverPbr.map}
            normalMap={trimSilverPbr.normalMap}
            normalScale={new THREE.Vector2(0.12, 0.12)}
            roughnessMap={trimSilverPbr.roughnessMap}
            roughness={1.0}
            metalness={0.8}
          />
        </mesh>

        {/* Machined brushed-aluminum perimeter bezel rails framing the optical glass screen */}
        <mesh position={[0, PODIUM_HEIGHT_METERS / 2 + topBezel / 2, -0.002]}>
          <boxGeometry args={[totalWidth - 0.04, topBezel, 0.018]} />
          <meshStandardMaterial
            map={chassisPbr.map}
            normalMap={chassisPbr.normalMap}
            normalScale={new THREE.Vector2(0.14, 0.14)}
            roughnessMap={chassisPbr.roughnessMap}
            roughness={1.0}
            metalness={0.82}
          />
        </mesh>
        <mesh position={[-(PODIUM_WIDTH_METERS / 2 + sideBezel / 2), chassisCenterY, -0.002]}>
          <boxGeometry args={[sideBezel, totalHeight - 0.04, 0.018]} />
          <meshStandardMaterial
            map={chassisPbr.map}
            normalMap={chassisPbr.normalMap}
            normalScale={new THREE.Vector2(0.14, 0.14)}
            roughnessMap={chassisPbr.roughnessMap}
            roughness={1.0}
            metalness={0.82}
          />
        </mesh>
        <mesh position={[PODIUM_WIDTH_METERS / 2 + sideBezel / 2, chassisCenterY, -0.002]}>
          <boxGeometry args={[sideBezel, totalHeight - 0.04, 0.018]} />
          <meshStandardMaterial
            map={chassisPbr.map}
            normalMap={chassisPbr.normalMap}
            normalScale={new THREE.Vector2(0.14, 0.14)}
            roughnessMap={chassisPbr.roughnessMap}
            roughness={1.0}
            metalness={0.82}
          />
        </mesh>
        {/* Diamond-cut anodized silver inner display trim */}
        <mesh position={[0, PODIUM_HEIGHT_METERS / 2 + 0.005, 0.011]}>
          <boxGeometry args={[PODIUM_WIDTH_METERS + 0.014, 0.01, 0.004]} />
          <meshStandardMaterial
            map={trimSilverPbr.map}
            normalMap={trimSilverPbr.normalMap}
            roughnessMap={trimSilverPbr.roughnessMap}
            roughness={0.85}
            metalness={0.88}
          />
        </mesh>
        <mesh position={[-(PODIUM_WIDTH_METERS / 2 + 0.005), 0, 0.011]}>
          <boxGeometry args={[0.01, PODIUM_HEIGHT_METERS + 0.01, 0.004]} />
          <meshStandardMaterial
            map={trimSilverPbr.map}
            normalMap={trimSilverPbr.normalMap}
            roughnessMap={trimSilverPbr.roughnessMap}
            roughness={0.85}
            metalness={0.88}
          />
        </mesh>
        <mesh position={[PODIUM_WIDTH_METERS / 2 + 0.005, 0, 0.011]}>
          <boxGeometry args={[0.01, PODIUM_HEIGHT_METERS + 0.01, 0.004]} />
          <meshStandardMaterial
            map={trimSilverPbr.map}
            normalMap={trimSilverPbr.normalMap}
            roughnessMap={trimSilverPbr.roughnessMap}
            roughness={0.85}
            metalness={0.88}
          />
        </mesh>
        {/* Ergonomic lower bead-blasted silver aluminum palm-rest & physical controls bay */}
        <mesh position={[0, BEZEL_KEYCAP_Y, 0.003]}>
          <boxGeometry args={[PODIUM_WIDTH_METERS, BEZEL_RIM_HEIGHT, 0.02]} />
          <meshStandardMaterial
            map={trimSilverPbr.map}
            normalMap={trimSilverPbr.normalMap}
            normalScale={new THREE.Vector2(0.32, 0.32)}
            roughnessMap={trimSilverPbr.roughnessMap}
            roughness={1.0}
            metalness={0.78}
          />
        </mesh>

        {/* Subtle recessed architectural edge light accent strips */}
        <mesh position={[0, PODIUM_HEIGHT_METERS / 2 + topBezel - 0.005, 0.012]}>
          <boxGeometry args={[totalWidth - 0.06, 0.004, 0.003]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={1.05}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[-(PODIUM_WIDTH_METERS / 2 + sideBezel - 0.005), chassisCenterY, 0.012]}>
          <boxGeometry args={[0.004, totalHeight - 0.06, 0.003]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.85}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[PODIUM_WIDTH_METERS / 2 + sideBezel - 0.005, chassisCenterY, 0.012]}>
          <boxGeometry args={[0.004, totalHeight - 0.06, 0.003]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.85}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, -(PODIUM_HEIGHT_METERS / 2) - BEZEL_RIM_HEIGHT + 0.005, 0.014]}>
          <boxGeometry args={[totalWidth - 0.06, 0.004, 0.003]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.85}
            toneMapped={false}
          />
        </mesh>
        {/* Crisp inner hairline separating backlit glass board from lower keycap bay */}
        <mesh position={[0, -(PODIUM_HEIGHT_METERS / 2) - 0.002, 0.013]}>
          <boxGeometry args={[PODIUM_WIDTH_METERS, 0.003, 0.003]} />
          <meshBasicMaterial color="#cbd5e1" toneMapped={false} />
        </mesh>

        {/* Live Backlit Retina `.mscanvas` Studio Glass Display (Zero-Allocation Persistent CanvasTexture) */}
        <mesh
          name="rotunda-podium-board"
          position={[0, 0, 0]}
          onPointerDown={(e) => handleBoardPointer("down", e)}
          onPointerMove={(e) => handleBoardPointer("move", e)}
          onPointerUp={(e) => handleBoardPointer("up", e)}
          onDoubleClick={handleBoardDoubleClick}
          onPointerCancel={() => finishActiveInteraction(null)}
          onPointerOut={() => {
            if (!dragPreviewRef.current && !activeWireDragRef.current && !panDragRef.current) {
              if (reticleGroupRef.current) {
                reticleGroupRef.current.visible = false;
              }
              setHoveredMaximizeTileId(null);
              setHoveredHeaderBtn(null);
              setDocumentCursor("auto");
            }
          }}
        >
          <planeGeometry args={[PODIUM_WIDTH_METERS, PODIUM_HEIGHT_METERS]} />
          {texture ? (
            <meshBasicMaterial key="podium-tex" color="#ffffff" map={texture} toneMapped={false} />
          ) : (
            <meshBasicMaterial key="podium-fallback" color="#f8fafc" toneMapped={false} />
          )}
        </mesh>

        {/* Interactive Glowing CADPort Handle Spheres floating above `cad3d` cards */}
        {cadPorts.map((desc) => (
          <CadPortHandle
            key={`cadport-${desc.tile.id}`}
            descriptor={desc}
            isWiring={activeWireDrag?.sourceTileId === desc.tile.id}
            isHero={desc.tile.id === activeHeroTileId}
            onStartWire={handleStartWireFromPort}
          />
        ))}

        {/* 5 Tactile Bright Frosted Bezel Controls along the lower rim */}
        <BezelKeycapButton
          label="◀ Prev Model"
          position={[keycapStartX + keycapStride * 0, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor="#0284c7"
          onPress={() => {
            onPageModel?.(-1);
          }}
        />
        <BezelKeycapButton
          label="Next Model ▶"
          position={[keycapStartX + keycapStride * 1, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor="#0284c7"
          onPress={() => {
            onPageModel?.(1);
          }}
        />
        <BezelKeycapButton
          label={isPlaying ? "⏸ Pause" : "▶ Play"}
          position={[keycapStartX + keycapStride * 2, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor={isPlaying ? "#059669" : "#d97706"}
          active={isPlaying}
          onPress={() => {
            onTogglePlaying?.();
          }}
        />
        <BezelKeycapButton
          label={clampedTiltDeg >= 30 ? "45° / Flat" : "Flat / 45°"}
          position={[keycapStartX + keycapStride * 3, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor="#0284c7"
          active={clampedTiltDeg >= 30}
          onPress={() => {
            onToggleTilt?.();
          }}
        />
        <BezelKeycapButton
          label="↺ Reset"
          position={[keycapStartX + keycapStride * 4, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor="#7c3aed"
          onPress={() => {
            boardPanRef.current = { x: 0, y: 0 };
            setBoardPan({ x: 0, y: 0 });
            onFocusTileFullscreen?.(null);
            onResetView?.();
          }}
        />
      </group>

      {/* Glowing Curved Fiber-Optic Bezier Tethers arcing from Podium Cards up to the Circular Plinth */}
      {fiberTethers.map((tether, index) => (
        <group key={tether.id}>
          <Line
            points={tether.points}
            color={tether.color}
            lineWidth={tether.isHero ? 2.8 : 1.6}
            transparent
            opacity={tether.isHero ? 0.9 : 0.48}
          />
          {tether.isHero && (
            <TetherPulseBead
              p0={tether.p0}
              p1={tether.p1}
              p2={tether.p2}
              p3={tether.p3}
              color="#7dd3fc"
              phaseOffset={(index * 0.27) % 1}
            />
          )}
        </group>
      ))}

      {/* Existing 3D-to-2D CADPort Spatial Wires */}
      {cadSpatialWires.map((w) => (
        <Line key={w.id} points={w.points} color={w.color} lineWidth={2.0} transparent opacity={0.82} />
      ))}

      {/* Live Amber 3D CADPort-to-2D Wire Drag Preview */}
      {liveWirePreviewPoints && (
        <Line points={liveWirePreviewPoints} color="#f59e0b" lineWidth={2.6} transparent opacity={0.95} />
      )}

      {/* Live 3D / WebXR Ray Laser Reticle on the Angled Drafting Desk (kept mounted; updated via ref) */}
      <group ref={reticleGroupRef} visible={false} rotation={[targetTiltRad, 0, 0]}>
        <mesh>
          <sphereGeometry args={[0.01, 14, 14]} />
          <meshBasicMaterial
            color={activeWireDrag ? "#f59e0b" : dragPreview ? "#38bdf8" : "#10b981"}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0, 0.001]}>
          <ringGeometry args={[0.017, 0.023, 24]} />
          <meshBasicMaterial
            color={activeWireDrag ? "#fbbf24" : dragPreview ? "#7dd3fc" : "#34d399"}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
