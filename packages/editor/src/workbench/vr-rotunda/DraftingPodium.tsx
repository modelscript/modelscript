// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  projectRayToPlane,
  type CanvasDocument,
  type CanvasTile,
  type SpatialPlane3D,
  type SpatialSurfaceBridge,
} from "@modelscript/canvas";
import { Line } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { paintBoardToTextureCanvas, resolveEffectiveBounds, type DragPreviewState } from "./board-painter.js";
import {
  boardBoundsToPlaneBounds,
  buildPodiumSpatialPlane,
  clampNumber,
  planeUvToBoard,
  PODIUM_CENTER,
  PODIUM_HEIGHT_METERS,
  PODIUM_WIDTH_METERS,
  ROTUNDA_BOARD_CANVAS_HEIGHT,
  ROTUNDA_BOARD_CANVAS_WIDTH,
} from "./types.js";
import { playRotundaCue } from "./xr-session.js";

export interface DraftingPodiumProps {
  document: CanvasDocument;
  bridge: SpatialSurfaceBridge;
  tiltDeg: number;
  simulationTime: number;
  isPlaying: boolean;
  activeHeroTileId: string | null;
  plinthWorldCenter: [number, number, number];
  visible: boolean;
  onTileSelect?: ((tileId: string) => void) | undefined;
  onFocusTileOnPlinth?: ((tileId: string) => void) | undefined;
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

const DOUBLE_CLICK_MS = 380;
const DRAG_THRESHOLD_BOARD_UNITS = 3;
const BEZEL_RIM_HEIGHT = 0.114;
const BEZEL_KEYCAP_Y = -(PODIUM_HEIGHT_METERS / 2) - BEZEL_RIM_HEIGHT * 0.5;

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

    // Subtle glass keycap gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (pressed) {
      grad.addColorStop(0, "#1e293b");
      grad.addColorStop(1, "#0f172a");
    } else if (active) {
      grad.addColorStop(0, "#132c45");
      grad.addColorStop(1, "#0b192c");
    } else if (hovered) {
      grad.addColorStop(0, "#1c2b42");
      grad.addColorStop(1, "#0f1a2d");
    } else {
      grad.addColorStop(0, "#131d30");
      grad.addColorStop(1, "#0a111f");
    }

    drawRoundedRectPath(ctx, 4, 4, w - 8, h - 8, 16);
    ctx.fillStyle = grad;
    ctx.fill();

    // Top specular glass highlight
    drawRoundedRectPath(ctx, 10, 8, w - 20, 14, 7);
    ctx.fillStyle = hovered || active ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.06)";
    ctx.fill();

    // Crisp illuminated border
    drawRoundedRectPath(ctx, 4, 4, w - 8, h - 8, 16);
    ctx.lineWidth = hovered || active ? 3.5 : 2;
    ctx.strokeStyle = hovered || active ? accentColor : "rgba(148, 163, 184, 0.32)";
    ctx.stroke();

    // Small active indicator LED on the bottom center
    if (active) {
      ctx.fillStyle = accentColor;
      drawRoundedRectPath(ctx, w * 0.5 - 24, h - 13, 48, 4, 2);
      ctx.fill();
    }

    // Keycap typography
    ctx.fillStyle = hovered || active ? "#f8fafc" : "#cbd5e1";
    ctx.font = "600 28px Inter, system-ui, -apple-system, sans-serif";
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
      {/* Raised physical keycap chassis */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[width, height, 0.016]} />
        <meshStandardMaterial
          color={hovered || active ? "#17253d" : "#0e1726"}
          emissive={hovered || active ? accentColor : "#020617"}
          emissiveIntensity={hovered ? 0.28 : active ? 0.18 : 0.04}
          roughness={0.28}
          metalness={0.55}
        />
      </mesh>
      {/* Crisp high-DPI keycap top faceplate */}
      <mesh position={[0, 0, 0.009]}>
        <planeGeometry args={[width - 0.006, height - 0.006]} />
        {texture ? (
          <meshBasicMaterial map={texture} transparent toneMapped={false} />
        ) : (
          <meshBasicMaterial color="#0f172a" />
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
  plinthWorldCenter,
  visible,
  onTileSelect,
  onFocusTileOnPlinth,
  onMoveTile,
  onCreateSpatialWire,
  onPageModel,
  onTogglePlaying,
  onToggleTilt,
  onResetView,
  onHudStatusChange,
  onInteractionLockChange,
}: DraftingPodiumProps): React.ReactElement | null {
  const podiumTiltGroupRef = useRef<THREE.Group | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textureRef = useRef<THREE.CanvasTexture | null>(null);
  const lastClickRef = useRef<{ tileId: string; timeMs: number } | null>(null);
  const dragStartBoardRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);

  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const [reticlePos, setReticlePos] = useState<[number, number, number] | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewState | null>(null);
  const [activeWireDrag, setActiveWireDrag] = useState<ActiveSpatialWireDrag | null>(null);
  const [hoverTargetTileId, setHoverTargetTileId] = useState<string | null>(null);

  const clampedTiltDeg = clampNumber(tiltDeg, 0, 85);
  const targetTiltRad = -(clampedTiltDeg * Math.PI) / 180;

  // Exact SpatialPlane3D corresponding to the tilted podium surface
  const podiumPlane = useMemo(() => buildPodiumSpatialPlane(clampedTiltDeg), [clampedTiltDeg]);

  // Register/update the podium plane on the SpatialSurfaceBridge whenever tilt changes
  useEffect(() => {
    bridge.registerPlane(podiumPlane);
  }, [bridge, podiumPlane]);

  // Zero-allocation persistent offscreen 1600x1000 canvas + THREE.CanvasTexture created once
  useEffect(() => {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = ROTUNDA_BOARD_CANVAS_WIDTH;
    canvas.height = ROTUNDA_BOARD_CANVAS_HEIGHT;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
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

  // Repaint the persistent texture whenever board state or interactions change
  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    const tex = textureRef.current;
    if (!canvas || !tex) return;
    paintBoardToTextureCanvas(canvas, doc, simulationTime, dragPreview, hoverTargetTileId, activeHeroTileId);
    tex.needsUpdate = true;
  }, [doc, simulationTime, dragPreview, hoverTargetTileId, activeHeroTileId, texture, visible]);

  // Clear active interactions if podium is hidden
  useEffect(() => {
    if (!visible) {
      setDragPreview(null);
      setActiveWireDrag(null);
      setHoverTargetTileId(null);
      setReticlePos(null);
      dragStartBoardRef.current = null;
      dragMovedRef.current = false;
    }
  }, [visible]);

  // Notify parent when OrbitControls should lock during tile drag or CADPort wire drag
  const interactionLocked = visible && (dragPreview !== null || activeWireDrag !== null);
  useEffect(() => {
    onInteractionLockChange?.(interactionLocked);
  }, [interactionLocked, onInteractionLockChange]);

  useEffect(() => {
    return () => {
      onInteractionLockChange?.(false);
    };
  }, [onInteractionLockChange]);

  // Safety release if pointerup happens outside the podium mesh
  useEffect(() => {
    if (!interactionLocked || typeof window === "undefined") return;
    const handleWindowPointerUp = () => {
      setDragPreview(null);
      setActiveWireDrag(null);
      setHoverTargetTileId(null);
      dragStartBoardRef.current = null;
      dragMovedRef.current = false;
    };
    window.addEventListener("pointerup", handleWindowPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleWindowPointerUp);
    };
  }, [interactionLocked]);

  // Publish live HUD hint while dragging a tile or wiring a 3D CADPort
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
    } else {
      onHudStatusChange(null);
    }
  }, [activeWireDrag, dragPreview, hoverTargetTileId, doc.tiles, visible, onHudStatusChange]);

  // Smoothly animate podium tilt angle (45° ↔ 12°) in useFrame
  useFrame((_, delta) => {
    const grp = podiumTiltGroupRef.current;
    if (!grp) return;
    const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 10);
    grp.rotation.x += (targetTiltRad - grp.rotation.x) * alpha;
  });

  // Compute interactive CADPort sphere descriptors for all `cad3d` tiles
  const cadPorts = useMemo<CadPortDescriptor[]>(() => {
    const tiles = Object.values(doc.tiles);
    const out: CadPortDescriptor[] = [];
    for (const tile of tiles) {
      if (tile.archetype !== "cad3d") continue;
      const effBounds = resolveEffectiveBounds(tile, dragPreview);
      const planeBounds = boardBoundsToPlaneBounds(effBounds);
      // Anchor glowing CADPort sphere near the lower-right corner of the card
      const portU = planeBounds.x + planeBounds.width - 28;
      const portV = planeBounds.y + planeBounds.height - 24;
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
  }, [doc.tiles, dragPreview, podiumPlane]);

  // Compute glowing curved Bezier fiber-optic tethers from `cad3d` tiles & activeHeroTileId up to the circular plinth
  const fiberTethers = useMemo<TetherSpec[]>(() => {
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
      const planeBounds = boardBoundsToPlaneBounds(effBounds);
      const centerU = planeBounds.x + planeBounds.width * 0.5;
      const centerV = planeBounds.y + planeBounds.height * 0.5;
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
  }, [doc.tiles, activeHeroTileId, dragPreview, podiumPlane, plinthWorldCenter]);

  // Compute 3D-to-2D curved spatial wires from CADPort handles to connected 2D schematic tiles
  const cadSpatialWires = useMemo(() => {
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
        const otherPlaneBounds = boardBoundsToPlaneBounds(resolveEffectiveBounds(other, dragPreview));
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
  }, [cadPorts, doc.wires, doc.tiles, dragPreview, podiumPlane]);

  // Sync bridge 3D-to-2D wire registry in useEffect (keeps render pure)
  useEffect(() => {
    if (!visible) return;
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
        const otherPlaneBounds = boardBoundsToPlaneBounds(resolveEffectiveBounds(other, dragPreview));
        bridge.upsert3DTo2DWire(wire.id, port.worldPos, "podium", {
          u: otherPlaneBounds.x + otherPlaneBounds.width * 0.5,
          v: otherPlaneBounds.y + otherPlaneBounds.height * 0.5,
        });
      }
    }
  }, [bridge, cadPorts, doc.wires, doc.tiles, dragPreview, visible]);

  // Live curved wire preview while pulling from a CADPort sphere
  const liveWirePreviewPoints = useMemo<[number, number, number][] | null>(() => {
    if (!activeWireDrag || !reticlePos) return null;
    const from = activeWireDrag.from3D;
    const to = reticlePos;
    const mid: [number, number, number] = [
      (from[0] + to[0]) * 0.5 + podiumPlane.normal[0] * 0.14,
      (from[1] + to[1]) * 0.5 + podiumPlane.normal[1] * 0.14,
      (from[2] + to[2]) * 0.5 + podiumPlane.normal[2] * 0.14,
    ];
    return sampleQuadraticBezier(from, mid, to, 16);
  }, [activeWireDrag, reticlePos, podiumPlane]);

  const findTileAtBoardPoint = useCallback(
    (bx: number, by: number): CanvasTile | undefined => {
      const sorted = Object.values(doc.tiles).sort((a, b) => b.zIndex - a.zIndex);
      return sorted.find((t) => {
        const b = resolveEffectiveBounds(t, dragPreview);
        return bx >= b.x && bx <= b.x + b.width && by >= b.y && by <= b.y + b.height;
      });
    },
    [doc.tiles, dragPreview],
  );

  const handleStartWireFromPort = useCallback(
    (descriptor: CadPortDescriptor) => {
      setDragPreview(null);
      dragStartBoardRef.current = null;
      dragMovedRef.current = false;
      setActiveWireDrag({
        sourceTileId: descriptor.tile.id,
        sourceTitle: descriptor.tile.title,
        sourceAnchor: "CADPort",
        from3D: descriptor.worldPos,
      });
      onTileSelect?.(descriptor.tile.id);
      playRotundaCue("click");
    },
    [onTileSelect],
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
      const hit =
        dispatchedHit && dispatchedHit.planeId === "podium"
          ? dispatchedHit
          : (() => {
              const direct = projectRayToPlane(rayOrigin, rayDir, podiumPlane);
              return direct.hit ? direct : null;
            })();

      if (!hit) {
        if (phase === "up") {
          setDragPreview(null);
          setActiveWireDrag(null);
          setHoverTargetTileId(null);
          dragStartBoardRef.current = null;
          dragMovedRef.current = false;
        }
        return;
      }

      // Lift reticle 4mm along podium normal so it never z-fights with the board surface
      setReticlePos([
        hit.worldPoint[0] + podiumPlane.normal[0] * 0.004,
        hit.worldPoint[1] + podiumPlane.normal[1] * 0.004,
        hit.worldPoint[2] + podiumPlane.normal[2] * 0.004,
      ]);

      const boardPt = planeUvToBoard(hit.u, hit.v);

      if (phase === "down") {
        const hitTile = findTileAtBoardPoint(boardPt.x, boardPt.y);

        if (activeWireDrag) {
          if (hitTile && hitTile.id !== activeWireDrag.sourceTileId) {
            onCreateSpatialWire?.(activeWireDrag.sourceTileId, hitTile.id, activeWireDrag.sourceAnchor);
            playRotundaCue("snap");
          }
          setActiveWireDrag(null);
          setHoverTargetTileId(null);
          return;
        }

        if (hitTile) {
          onTileSelect?.(hitTile.id);

          const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
          const prevClick = lastClickRef.current;
          const isDoubleClick =
            prevClick !== null && prevClick.tileId === hitTile.id && nowMs - prevClick.timeMs < DOUBLE_CLICK_MS;
          lastClickRef.current = { tileId: hitTile.id, timeMs: nowMs };

          const hasCadTiles = Object.values(doc.tiles).some((t) => t.archetype === "cad3d");
          const isPlinthLinked =
            hitTile.archetype === "cad3d" ||
            hitTile.id === activeHeroTileId ||
            (!hasCadTiles && (hitTile.archetype === "schematic" || hitTile.archetype === "fmu"));

          if (isPlinthLinked || isDoubleClick) {
            onFocusTileOnPlinth?.(hitTile.id);
            playRotundaCue("page");
          } else {
            playRotundaCue("click");
          }

          if (!hitTile.locked) {
            dragStartBoardRef.current = { x: boardPt.x, y: boardPt.y };
            dragMovedRef.current = false;
            setDragPreview({
              tileId: hitTile.id,
              offsetX: boardPt.x - hitTile.bounds.x,
              offsetY: boardPt.y - hitTile.bounds.y,
              x: hitTile.bounds.x,
              y: hitTile.bounds.y,
            });
          }
        }
        return;
      }

      if (phase === "move") {
        if (activeWireDrag) {
          const candidate = findTileAtBoardPoint(boardPt.x, boardPt.y);
          setHoverTargetTileId(candidate && candidate.id !== activeWireDrag.sourceTileId ? candidate.id : null);
          return;
        }
        if (dragPreview) {
          const startPt = dragStartBoardRef.current;
          const movedPastThreshold =
            dragMovedRef.current ||
            !startPt ||
            Math.hypot(boardPt.x - startPt.x, boardPt.y - startPt.y) >= DRAG_THRESHOLD_BOARD_UNITS;
          if (!movedPastThreshold) return;
          dragMovedRef.current = true;
          const newX = Math.round(boardPt.x - dragPreview.offsetX);
          const newY = Math.round(boardPt.y - dragPreview.offsetY);
          if (newX !== dragPreview.x || newY !== dragPreview.y) {
            setDragPreview({ ...dragPreview, x: newX, y: newY });
            onMoveTile?.(dragPreview.tileId, newX, newY);
          }
        }
        return;
      }

      if (phase === "up") {
        if (activeWireDrag) {
          const targetTile = findTileAtBoardPoint(boardPt.x, boardPt.y);
          if (targetTile && targetTile.id !== activeWireDrag.sourceTileId) {
            onCreateSpatialWire?.(activeWireDrag.sourceTileId, targetTile.id, activeWireDrag.sourceAnchor);
            playRotundaCue("snap");
          }
          setActiveWireDrag(null);
          setHoverTargetTileId(null);
          return;
        }
        if (dragPreview) {
          if (dragMovedRef.current) {
            const finalX = Math.round(boardPt.x - dragPreview.offsetX);
            const finalY = Math.round(boardPt.y - dragPreview.offsetY);
            onMoveTile?.(dragPreview.tileId, finalX, finalY);
            playRotundaCue("tick");
          }
          setDragPreview(null);
          dragStartBoardRef.current = null;
          dragMovedRef.current = false;
        }
      }
    },
    [
      bridge,
      podiumPlane,
      findTileAtBoardPoint,
      activeWireDrag,
      onCreateSpatialWire,
      onTileSelect,
      doc.tiles,
      activeHeroTileId,
      onFocusTileOnPlinth,
      dragPreview,
      onMoveTile,
    ],
  );

  if (!visible) {
    return null;
  }

  // Chassis geometry constants
  const topBezel = 0.044;
  const sideBezel = 0.048;
  const totalWidth = PODIUM_WIDTH_METERS + sideBezel * 2;
  const totalHeight = PODIUM_HEIGHT_METERS + topBezel + BEZEL_RIM_HEIGHT;
  const chassisCenterY = (topBezel - BEZEL_RIM_HEIGHT) * 0.5;
  const accentColor = activeWireDrag ? "#f59e0b" : "#38bdf8";

  // 5 tactile bezel buttons distributed evenly along the lower control rim
  const keycapWidth = 0.258;
  const keycapHeight = 0.068;
  const keycapGap = 0.024;
  const keycapStride = keycapWidth + keycapGap;
  const keycapStartX = -2 * keycapStride;

  return (
    <group name="rotunda-drafting-podium">
      {/* Floor-Anchored Architectural Pedestal Column & Tilt Yoke (stationary in world space) */}
      <group position={[PODIUM_CENTER[0], 0, PODIUM_CENTER[2]]}>
        {/* Grounded octagonal obsidian base plate */}
        <mesh position={[0, 0.016, -0.08]} receiveShadow castShadow>
          <cylinderGeometry args={[0.36, 0.42, 0.032, 8]} />
          <meshStandardMaterial color="#0b1120" roughness={0.34} metalness={0.78} />
        </mesh>
        {/* Subtle glowing cyan base collar ring */}
        <mesh position={[0, 0.033, -0.08]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.31, 0.33, 32]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.42} side={THREE.DoubleSide} />
        </mesh>
        {/* Inner machined base riser */}
        <mesh position={[0, 0.068, -0.08]} castShadow>
          <cylinderGeometry args={[0.14, 0.21, 0.078, 16]} />
          <meshStandardMaterial color="#111827" roughness={0.3} metalness={0.82} />
        </mesh>
        {/* Angled twin-ribbed obsidian pedestal column */}
        <mesh position={[0, 0.47, -0.095]} rotation={[-0.08, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.16, 0.8, 0.11]} />
          <meshStandardMaterial color="#0f172a" roughness={0.32} metalness={0.76} />
        </mesh>
        {/* Brushed titanium front/rear vertical structural ribs */}
        <mesh position={[-0.086, 0.47, -0.095]} rotation={[-0.08, 0, 0]}>
          <boxGeometry args={[0.018, 0.78, 0.125]} />
          <meshStandardMaterial color="#334155" roughness={0.28} metalness={0.86} />
        </mesh>
        <mesh position={[0.086, 0.47, -0.095]} rotation={[-0.08, 0, 0]}>
          <boxGeometry args={[0.018, 0.78, 0.125]} />
          <meshStandardMaterial color="#334155" roughness={0.28} metalness={0.86} />
        </mesh>
        {/* Subtle front accent strip on column */}
        <mesh position={[0, 0.46, -0.038]} rotation={[-0.08, 0, 0]}>
          <boxGeometry args={[0.01, 0.62, 0.006]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={1.1} />
        </mesh>
        {/* Machined horizontal tilt-hinge axle & twin yoke brackets */}
        <mesh position={[0, 0.865, -0.06]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.032, 0.032, 0.46, 20]} />
          <meshStandardMaterial color="#475569" roughness={0.25} metalness={0.88} />
        </mesh>
        <mesh position={[-0.19, 0.855, -0.06]}>
          <boxGeometry args={[0.042, 0.09, 0.09]} />
          <meshStandardMaterial color="#1e293b" roughness={0.32} metalness={0.8} />
        </mesh>
        <mesh position={[0.19, 0.855, -0.06]}>
          <boxGeometry args={[0.042, 0.09, 0.09]} />
          <meshStandardMaterial color="#1e293b" roughness={0.32} metalness={0.8} />
        </mesh>
      </group>

      {/* Tilted 45° Architectural Drafting Console Desk */}
      <group ref={podiumTiltGroupRef} position={PODIUM_CENTER} rotation={[targetTiltRad, 0, 0]}>
        {/* Main rear obsidian aluminum chassis body */}
        <mesh position={[0, chassisCenterY, -0.024]} castShadow receiveShadow>
          <boxGeometry args={[totalWidth, totalHeight, 0.036]} />
          <meshStandardMaterial color="#0b1220" roughness={0.32} metalness={0.76} />
        </mesh>

        {/* Chamfered rear stiffening shroud */}
        <mesh position={[0, chassisCenterY + 0.02, -0.048]} castShadow>
          <boxGeometry args={[totalWidth - 0.16, totalHeight - 0.14, 0.018]} />
          <meshStandardMaterial color="#111827" roughness={0.36} metalness={0.78} />
        </mesh>

        {/* Perimeter chamfered anodized aluminum bezel rails */}
        {/* Top bezel rail */}
        <mesh position={[0, PODIUM_HEIGHT_METERS / 2 + topBezel / 2, 0.002]}>
          <boxGeometry args={[totalWidth, topBezel, 0.02]} />
          <meshStandardMaterial color="#111827" roughness={0.26} metalness={0.82} />
        </mesh>
        {/* Left bezel rail */}
        <mesh position={[-(PODIUM_WIDTH_METERS / 2 + sideBezel / 2), chassisCenterY, 0.002]}>
          <boxGeometry args={[sideBezel, totalHeight, 0.02]} />
          <meshStandardMaterial color="#111827" roughness={0.26} metalness={0.82} />
        </mesh>
        {/* Right bezel rail */}
        <mesh position={[PODIUM_WIDTH_METERS / 2 + sideBezel / 2, chassisCenterY, 0.002]}>
          <boxGeometry args={[sideBezel, totalHeight, 0.02]} />
          <meshStandardMaterial color="#111827" roughness={0.26} metalness={0.82} />
        </mesh>
        {/* Ergonomic lower palm-rest & physical controls rim */}
        <mesh position={[0, BEZEL_KEYCAP_Y, 0.003]}>
          <boxGeometry args={[PODIUM_WIDTH_METERS, BEZEL_RIM_HEIGHT, 0.022]} />
          <meshStandardMaterial color="#0d1526" roughness={0.3} metalness={0.78} />
        </mesh>

        {/* Soft glowing edge accent strips along top, sides, and lower lip */}
        <mesh position={[0, PODIUM_HEIGHT_METERS / 2 + topBezel - 0.004, 0.013]}>
          <boxGeometry args={[totalWidth - 0.02, 0.005, 0.004]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={1.25}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[-(PODIUM_WIDTH_METERS / 2 + sideBezel - 0.004), chassisCenterY, 0.013]}>
          <boxGeometry args={[0.005, totalHeight - 0.02, 0.004]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={1.0} toneMapped={false} />
        </mesh>
        <mesh position={[PODIUM_WIDTH_METERS / 2 + sideBezel - 0.004, chassisCenterY, 0.013]}>
          <boxGeometry args={[0.005, totalHeight - 0.02, 0.004]} />
          <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={1.0} toneMapped={false} />
        </mesh>
        <mesh position={[0, -(PODIUM_HEIGHT_METERS / 2) - BEZEL_RIM_HEIGHT + 0.004, 0.015]}>
          <boxGeometry args={[totalWidth - 0.02, 0.005, 0.004]} />
          <meshStandardMaterial
            color={accentColor}
            emissive={accentColor}
            emissiveIntensity={0.95}
            toneMapped={false}
          />
        </mesh>
        {/* Subtle inner hairline separating board glass from lower keycap bay */}
        <mesh position={[0, -(PODIUM_HEIGHT_METERS / 2) - 0.002, 0.014]}>
          <boxGeometry args={[PODIUM_WIDTH_METERS, 0.003, 0.003]} />
          <meshStandardMaterial color="#1e293b" emissive={accentColor} emissiveIntensity={0.45} />
        </mesh>

        {/* Live Interactive `.mscanvas` Board Mesh (Zero-Allocation Persistent CanvasTexture) */}
        <mesh
          name="rotunda-podium-board"
          position={[0, 0, 0]}
          onPointerDown={(e) => handleBoardPointer("down", e)}
          onPointerMove={(e) => handleBoardPointer("move", e)}
          onPointerUp={(e) => handleBoardPointer("up", e)}
          onPointerOut={() => {
            if (!dragPreview && !activeWireDrag) {
              setReticlePos(null);
            }
          }}
        >
          <planeGeometry args={[PODIUM_WIDTH_METERS, PODIUM_HEIGHT_METERS]} />
          {texture ? (
            <meshStandardMaterial
              map={texture}
              roughness={0.42}
              metalness={0.05}
              emissive="#091322"
              emissiveIntensity={0.14}
            />
          ) : (
            <meshStandardMaterial color="#0f172a" roughness={0.5} />
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

        {/* 5 Tactile Physical Bezel Controls along the lower rim */}
        <BezelKeycapButton
          label="◀ Prev Model"
          position={[keycapStartX + keycapStride * 0, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor="#38bdf8"
          onPress={() => {
            playRotundaCue("page");
            onPageModel?.(-1);
          }}
        />
        <BezelKeycapButton
          label="Next Model ▶"
          position={[keycapStartX + keycapStride * 1, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor="#38bdf8"
          onPress={() => {
            playRotundaCue("page");
            onPageModel?.(1);
          }}
        />
        <BezelKeycapButton
          label={isPlaying ? "⏸ Pause" : "▶ Play"}
          position={[keycapStartX + keycapStride * 2, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor={isPlaying ? "#10b981" : "#f59e0b"}
          active={isPlaying}
          onPress={() => {
            playRotundaCue("click");
            onTogglePlaying?.();
          }}
        />
        <BezelKeycapButton
          label={clampedTiltDeg >= 30 ? "45° / Flat" : "Flat / 45°"}
          position={[keycapStartX + keycapStride * 3, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor="#38bdf8"
          active={clampedTiltDeg >= 30}
          onPress={() => {
            playRotundaCue("tick");
            onToggleTilt?.();
          }}
        />
        <BezelKeycapButton
          label="↺ Reset"
          position={[keycapStartX + keycapStride * 4, BEZEL_KEYCAP_Y, 0.01]}
          width={keycapWidth}
          height={keycapHeight}
          accentColor="#a855f7"
          onPress={() => {
            playRotundaCue("snap");
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

      {/* Live 3D / WebXR Ray Laser Reticle on the Angled Drafting Desk */}
      {reticlePos && (
        <group position={reticlePos} rotation={[targetTiltRad, 0, 0]}>
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
      )}
    </group>
  );
}
