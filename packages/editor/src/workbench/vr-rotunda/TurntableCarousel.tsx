// SPDX-License-Identifier: AGPL-3.0-or-later

import { Line } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { AssemblyVisibilityState } from "../cad-viewer/assembly-visibility.js";
import { HeroModelAsset } from "./HeroModelAsset.js";
import {
  createBrushedAluminumPbr,
  createKnurledMetalNormalMap,
  createRadialContactShadowTexture,
} from "./procedural-pbr.js";
import {
  PLINTH_CENTER_REAL_SCALE,
  PLINTH_CENTER_TABLETOP,
  clampNumber,
  wrapIndex,
  type RotundaAnimationControllerLike,
  type RotundaCaeOverlay,
  type RotundaClipAxis,
  type RotundaModelEntry,
  type RotundaRenderStyle,
  type RotundaScaleMode,
} from "./types.js";
import { playRotundaCue } from "./xr-session.js";

export interface CarouselSlotTransform {
  position: [number, number, number];
  scale: number;
  opacity: number;
  yaw: number;
}

const DEFAULT_ORBIT_RADIUS = 1.45;
const ORBIT_ARC_STEP_RAD = Math.PI / 3; // 60° per slot -> -1 at 10 o'clock, +1 at 2 o'clock
const DETENT_RAD = Math.PI / 6; // 30° mechanical detent tick interval
const SECTION_CUT_HALF_SPAN = 0.65; // sectionCutOffset (-1..1) mapped to [-0.65m, +0.65m]
const HERO_LOCAL_CENTER_Y = 0.36;
const EMPTY_CLIPPING_PLANES: THREE.Plane[] = [];

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Pure orbital math helper computing local plinth-relative 3D transform for a model slot
 * at fractional orbital offset `slotDelta` (0 = center hero, -1 = 10 o'clock prev, +1 = 2 o'clock next).
 */
export function computeCarouselSlotTransform(slotDelta: number, radius = DEFAULT_ORBIT_RADIUS): CarouselSlotTransform {
  const safeDelta = Number.isFinite(slotDelta) ? slotDelta : 0;
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_ORBIT_RADIUS;
  const absDelta = Math.abs(safeDelta);

  const clampedAngle = clampNumber(safeDelta, -2.5, 2.5) * ORBIT_ARC_STEP_RAD;
  const x = normalizeZero(Math.sin(clampedAngle) * safeRadius);
  const z = normalizeZero(-(1 - Math.cos(clampedAngle)) * safeRadius);
  const y = normalizeZero(0.16 * (1 - Math.exp(-absDelta * absDelta * 2.1)));

  const focus = Math.exp(-absDelta * absDelta * 1.8);
  const scale = normalizeZero(clampNumber(0.36 + 0.64 * focus, 0.28, 1));

  let opacity = 0;
  if (absDelta < 1.85) {
    const baseOpacity = Math.max(0, 1 - absDelta * 0.58);
    const outerFade = absDelta <= 1 ? 1 : clampNumber((1.85 - absDelta) / 0.85, 0, 1);
    opacity = normalizeZero(clampNumber(baseOpacity * outerFade, 0, 1));
  }

  const yaw = normalizeZero(-clampedAngle * 0.4);

  return {
    position: [x, y, z],
    scale,
    opacity,
    yaw,
  };
}

export interface TurntableCarouselProps {
  models: readonly RotundaModelEntry[];
  activeModelIndex: number;
  carouselStep: number;
  plinthYaw: number;
  plinthZoom: number;
  explodeFactor: number;
  caeOverlay: RotundaCaeOverlay;
  renderStyle: RotundaRenderStyle;
  scaleMode: RotundaScaleMode;
  sectionCutEnabled: boolean;
  sectionCutAxis: RotundaClipAxis;
  sectionCutOffset: number;
  simulationTime: number;
  simulationTimeRef?: React.RefObject<number> | undefined;
  isPlaying: boolean;
  animationController?: RotundaAnimationControllerLike | null | undefined;
  visibility?: AssemblyVisibilityState | undefined;
  autoTurntable?: boolean | undefined;
  isInXr?: boolean | undefined;
  dark?: boolean | undefined;
  onSelectSubsystem?: ((subsystemId: string) => void) | undefined;
  onPageModel: (delta: number) => void;
  onSelectModelIndex: (index: number) => void;
  onPlinthYawChange: (yaw: number) => void;
  onSectionCutOffsetChange: (offset: number) => void;
  onDraggingChange?: ((dragging: boolean) => void) | undefined;
}

/** Builds a CNC-turned multi-step chamfered plinth head housing (`LatheGeometry`). */
function createCncPlinthHousingGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.34, -0.148),
    new THREE.Vector2(0.68, -0.148),
    new THREE.Vector2(0.725, -0.132),
    new THREE.Vector2(0.768, -0.098),
    // Recessed indirect LED reveal shadow groove
    new THREE.Vector2(0.742, -0.088),
    new THREE.Vector2(0.742, -0.068),
    new THREE.Vector2(0.792, -0.056),
    new THREE.Vector2(0.792, -0.016),
    // Crisp 45° CNC machined top chamfer bezel
    new THREE.Vector2(0.772, 0.002),
    new THREE.Vector2(0.662, 0.002),
    new THREE.Vector2(0.654, -0.008),
  ];
  const geom = new THREE.LatheGeometry(pts, 64);
  geom.computeVertexNormals();
  return geom;
}

/** Builds a flared CNC-machined architectural pedestal column with chamfered floor flange. */
function createCncPedestalColumnGeometry(): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.56, -0.48),
    new THREE.Vector2(0.56, -0.452),
    new THREE.Vector2(0.52, -0.43),
    new THREE.Vector2(0.41, -0.418),
    new THREE.Vector2(0.35, -0.32),
    new THREE.Vector2(0.305, 0.16),
    new THREE.Vector2(0.335, 0.44),
    new THREE.Vector2(0.37, 0.48),
  ];
  const geom = new THREE.LatheGeometry(pts, 48);
  geom.computeVertexNormals();
  return geom;
}

// ── Metrology Plinth 36-Tick Perimeter Ring ─────────────────────────────────

function PlinthTickMarks({ plinthYaw, accentColor }: { plinthYaw: number; accentColor: string }): React.ReactElement {
  const minorRef = useRef<THREE.InstancedMesh | null>(null);
  const cardinalRef = useRef<THREE.InstancedMesh | null>(null);

  useEffect(() => {
    const minorMesh = minorRef.current;
    const cardinalMesh = cardinalRef.current;
    const dummy = new THREE.Object3D();
    let minorIdx = 0;
    let cardinalIdx = 0;

    for (let i = 0; i < 36; i++) {
      const angle = (i * Math.PI * 2) / 36; // Every 10°
      const isCardinal = i % 9 === 0; // 0°, 90°, 180°, 270°
      const r = isCardinal ? 0.695 : 0.708;

      dummy.position.set(Math.sin(angle) * r, 0.004, Math.cos(angle) * r);
      dummy.rotation.set(0, angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      if (isCardinal && cardinalMesh) {
        cardinalMesh.setMatrixAt(cardinalIdx++, dummy.matrix);
      } else if (!isCardinal && minorMesh) {
        minorMesh.setMatrixAt(minorIdx++, dummy.matrix);
      }
    }

    if (minorMesh) minorMesh.instanceMatrix.needsUpdate = true;
    if (cardinalMesh) cardinalMesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group rotation={[0, plinthYaw, 0]}>
      {/* 32 minor 10° ticks */}
      <instancedMesh ref={minorRef} args={[undefined, undefined, 32]} frustumCulled={false}>
        <boxGeometry args={[0.008, 0.005, 0.036]} />
        <meshStandardMaterial
          color="#64748b"
          emissive="#0284c7"
          emissiveIntensity={0.14}
          metalness={0.45}
          roughness={0.32}
        />
      </instancedMesh>
      {/* 4 accentuated 90° cardinal ticks */}
      <instancedMesh ref={cardinalRef} args={[undefined, undefined, 4]} frustumCulled={false}>
        <boxGeometry args={[0.016, 0.007, 0.068]} />
        <meshStandardMaterial
          color={accentColor}
          emissive={accentColor}
          emissiveIntensity={0.95}
          metalness={0.32}
          roughness={0.22}
        />
      </instancedMesh>
    </group>
  );
}

// ── Orbital Slot Wrapper (60fps ref-driven transform without React churn) ───

interface CarouselSlotNodeProps {
  step: number;
  targetStep: number;
  model: RotundaModelEntry;
  animatedStepRef: React.MutableRefObject<number>;
  plinthYawRef: React.MutableRefObject<number>;
  plinthZoomRef: React.MutableRefObject<number>;
  explodeFactor: number;
  caeOverlay: RotundaCaeOverlay;
  renderStyle: RotundaRenderStyle;
  simulationTime: number;
  simulationTimeRef?: React.RefObject<number> | undefined;
  isPlaying: boolean;
  clippingPlanes: THREE.Plane[];
  animationController?: RotundaAnimationControllerLike | null | undefined;
  visibility?: AssemblyVisibilityState | undefined;
  isInXr?: boolean | undefined;
  dark?: boolean | undefined;
  onSelectSubsystem?: ((subsystemId: string) => void) | undefined;
  onClickGhost: (direction: number) => void;
}

function CarouselSlotNode({
  step,
  targetStep,
  model,
  animatedStepRef,
  plinthYawRef,
  plinthZoomRef,
  explodeFactor,
  caeOverlay,
  renderStyle,
  simulationTime,
  simulationTimeRef,
  isPlaying,
  clippingPlanes,
  animationController,
  visibility,
  isInXr,
  dark,
  onSelectSubsystem,
  onClickGhost,
}: CarouselSlotNodeProps): React.ReactElement {
  const slotGroupRef = useRef<THREE.Group | null>(null);
  const padGroupRef = useRef<THREE.Group | null>(null);
  const [hovered, setHovered] = useState(false);

  const isTargetHero = step === targetStep;
  const pageDelta = step < targetStep ? -1 : 1;

  useEffect(() => {
    if (!hovered || isTargetHero) return;
    if (typeof document !== "undefined") {
      document.body.style.cursor = "pointer";
      return () => {
        document.body.style.cursor = "auto";
      };
    }
    return undefined;
  }, [hovered, isTargetHero]);

  useFrame((state) => {
    const group = slotGroupRef.current;
    if (!group) return;

    const slotDelta = step - animatedStepRef.current;
    const xform = computeCarouselSlotTransform(slotDelta, DEFAULT_ORBIT_RADIUS);
    const heroFocus = clampNumber(1 - Math.abs(slotDelta), 0, 1);
    const zoomBlend = 1 + (plinthZoomRef.current - 1) * heroFocus;
    const hoverBoost = !isTargetHero && hovered ? 1.08 : 1;
    const finalScale = xform.scale * zoomBlend * hoverBoost;
    const ghostIdleSpin = (1 - heroFocus) * state.clock.elapsedTime * 0.28;

    group.position.set(xform.position[0], xform.position[1], xform.position[2]);
    group.scale.setScalar(finalScale);
    group.rotation.y = xform.yaw + plinthYawRef.current * heroFocus + ghostIdleSpin;
    group.visible = xform.opacity > 0.015;

    if (padGroupRef.current) {
      const padAlpha = clampNumber(1 - heroFocus * 1.4, 0, 1);
      padGroupRef.current.visible = padAlpha > 0.05 && xform.opacity > 0.015;
      padGroupRef.current.position.set(xform.position[0], xform.position[1] - 0.02, xform.position[2]);
      padGroupRef.current.scale.setScalar(Math.max(0.2, xform.scale * hoverBoost));
    }
  });

  const handleGhostClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (isTargetHero) return;
      e.stopPropagation();
      playRotundaCue("page");
      onClickGhost(pageDelta);
    },
    [isTargetHero, onClickGhost, pageDelta],
  );

  const initialTransform = computeCarouselSlotTransform(step - targetStep, DEFAULT_ORBIT_RADIUS);

  return (
    <group>
      {/* Floating hologram preview ring underneath prev/next miniature models */}
      <group
        ref={padGroupRef}
        visible={!isTargetHero}
        position={[initialTransform.position[0], initialTransform.position[1] - 0.02, initialTransform.position[2]]}
        onClick={handleGhostClick}
        onPointerOver={(e) => {
          if (isTargetHero) return;
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.56, 0.018, 12, 48]} />
          <meshStandardMaterial
            color={hovered ? "#67e8f9" : "#38bdf8"}
            emissive={hovered ? "#22d3ee" : "#0284c7"}
            emissiveIntensity={hovered ? 1.7 : 0.95}
            transparent={true}
            opacity={hovered ? 0.92 : 0.62}
            depthWrite={false}
          />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <torusGeometry args={[0.42, 0.008, 8, 36]} />
          <meshStandardMaterial
            color="#818cf8"
            emissive="#4f46e5"
            emissiveIntensity={0.85}
            transparent={true}
            opacity={0.48}
            depthWrite={false}
          />
        </mesh>
        {/* Translucent clickable hologram emitter disc */}
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.55, 36]} />
          <meshStandardMaterial
            color="#0ea5e9"
            emissive="#1d4ed8"
            emissiveIntensity={hovered ? 0.75 : 0.35}
            transparent={true}
            opacity={hovered ? 0.24 : 0.12}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* Model assembly slot */}
      <group
        ref={slotGroupRef}
        position={initialTransform.position}
        scale={initialTransform.scale}
        rotation={[0, initialTransform.yaw, 0]}
        onClick={handleGhostClick}
        onPointerOver={(e) => {
          if (isTargetHero) return;
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <HeroModelAsset
          model={model}
          explodeFactor={isTargetHero ? explodeFactor : 0}
          caeOverlay={isTargetHero ? caeOverlay : "none"}
          renderStyle={renderStyle}
          simulationTime={simulationTime}
          simulationTimeRef={isTargetHero ? simulationTimeRef : undefined}
          isPlaying={isPlaying}
          clippingPlanes={isTargetHero ? clippingPlanes : EMPTY_CLIPPING_PLANES}
          animationController={isTargetHero ? animationController : null}
          isGhost={!isTargetHero}
          ghostOpacity={hovered ? 0.56 : 0.38}
          visibility={isTargetHero ? visibility : undefined}
          isInXr={isInXr}
          dark={dark}
          onSelectSubsystem={isTargetHero ? onSelectSubsystem : undefined}
        />
      </group>
    </group>
  );
}

// ── Interactive 3D Section Cut Slicing Sheet ────────────────────────────────

interface SectionCutSheetProps {
  axis: RotundaClipAxis;
  offset: number;
  plinthRootRef: React.MutableRefObject<THREE.Group | null>;
  onOffsetChange: (nextOffset: number) => void;
  onDraggingChange?: ((dragging: boolean) => void) | undefined;
}

const SHEET_HALF_W = 0.62;
const SHEET_HALF_H = 0.48;

const SHEET_FRAME_POINTS: ReadonlyArray<[number, number, number]> = [
  [-SHEET_HALF_W, -SHEET_HALF_H, 0],
  [SHEET_HALF_W, -SHEET_HALF_H, 0],
  [SHEET_HALF_W, SHEET_HALF_H, 0],
  [-SHEET_HALF_W, SHEET_HALF_H, 0],
  [-SHEET_HALF_W, -SHEET_HALF_H, 0],
];

const SHEET_CORNERS: ReadonlyArray<[number, number, number]> = [
  [-SHEET_HALF_W, SHEET_HALF_H, 0],
  [SHEET_HALF_W, SHEET_HALF_H, 0],
  [-SHEET_HALF_W, -SHEET_HALF_H, 0],
  [SHEET_HALF_W, -SHEET_HALF_H, 0],
];

function computeSectionSheetLocalPose(
  axis: RotundaClipAxis,
  offset: number,
): {
  position: [number, number, number];
  rotation: [number, number, number];
  localNormal: [number, number, number];
} {
  const d = clampNumber(offset, -1, 1) * SECTION_CUT_HALF_SPAN;
  switch (axis) {
    case "x":
      return {
        position: [d, HERO_LOCAL_CENTER_Y, 0],
        rotation: [0, Math.PI / 2, 0],
        localNormal: [1, 0, 0],
      };
    case "y":
      return {
        position: [0, HERO_LOCAL_CENTER_Y + d, 0],
        rotation: [-Math.PI / 2, 0, 0],
        localNormal: [0, 1, 0],
      };
    case "z":
      return {
        position: [0, HERO_LOCAL_CENTER_Y, d],
        rotation: [0, 0, 0],
        localNormal: [0, 0, 1],
      };
  }
}

interface PointerCaptureTarget {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

function is3dXrPointerEvent(e: ThreeEvent<PointerEvent>, gl: THREE.WebGLRenderer): boolean {
  const ptrType = (e as unknown as { pointerType?: string }).pointerType;
  if (gl.xr.isPresenting || ptrType === "ray" || ptrType === "grab" || ptrType === "lines") {
    return true;
  }
  const hasScreenCoords =
    typeof e.clientX === "number" &&
    Number.isFinite(e.clientX) &&
    typeof e.clientY === "number" &&
    Number.isFinite(e.clientY);
  return !hasScreenCoords || (e.clientX === 0 && e.clientY === 0);
}

function tryCapture3dPointer(e: ThreeEvent<PointerEvent>, is3dPointer: boolean): PointerCaptureTarget | null {
  if (!is3dPointer || typeof e.pointerId !== "number") return null;
  const target = e.target as unknown as PointerCaptureTarget | null;
  if (target && typeof target.setPointerCapture === "function") {
    try {
      target.setPointerCapture(e.pointerId);
      return target;
    } catch {
      return null;
    }
  }
  return null;
}

function tryRelease3dPointer(target: PointerCaptureTarget | null, pointerId: number | null): void {
  if (!target || pointerId === null || typeof target.releasePointerCapture !== "function") return;
  try {
    target.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture may already have been released on pointerup/cancel
  }
}

interface SectionCutDragSession {
  pointerId: number | null;
  is3dPointer: boolean;
  startX: number;
  startY: number;
  startOffset: number;
  lastDetent: number;
  screenDx: number;
  screenDy: number;
  screenLenSq: number;
  startWorldPoint: THREE.Vector3;
  worldCutNormal: THREE.Vector3;
  worldHalfSpan: number;
  hadWindowMove: boolean;
  captureTarget: PointerCaptureTarget | null;
}

function SectionCutPlaneGizmo({
  axis,
  offset,
  plinthRootRef,
  onOffsetChange,
  onDraggingChange,
}: SectionCutSheetProps): React.ReactElement {
  const { camera, gl } = useThree();
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const dragSessionRef = useRef<SectionCutDragSession | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const tmpDeltaRef = useRef(new THREE.Vector3());
  const onOffsetChangeRef = useRef(onOffsetChange);
  const onDraggingChangeRef = useRef(onDraggingChange);
  onOffsetChangeRef.current = onOffsetChange;
  onDraggingChangeRef.current = onDraggingChange;

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (dragging) {
      document.body.style.cursor = "grabbing";
      return () => {
        document.body.style.cursor = "auto";
      };
    }
    if (hovered) {
      document.body.style.cursor = "grab";
      return () => {
        document.body.style.cursor = "auto";
      };
    }
    return undefined;
  }, [hovered, dragging]);

  const pose = computeSectionSheetLocalPose(axis, offset);

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      dragCleanupRef.current?.();

      const startX = Number.isFinite(e.clientX) ? e.clientX : 0;
      const startY = Number.isFinite(e.clientY) ? e.clientY : 0;
      const startOffset = clampNumber(offset, -1, 1);
      const is3dPointer = is3dXrPointerEvent(e, gl);
      const pointerId = typeof e.pointerId === "number" ? e.pointerId : null;

      // Project the cut normal into both world space (for 3D WebXR ray/hand drag) and screen space (for desktop mouse)
      const root = plinthRootRef.current;
      const p0 = new THREE.Vector3(...pose.position);
      const p1 = new THREE.Vector3(
        pose.position[0] + pose.localNormal[0] * SECTION_CUT_HALF_SPAN,
        pose.position[1] + pose.localNormal[1] * SECTION_CUT_HALF_SPAN,
        pose.position[2] + pose.localNormal[2] * SECTION_CUT_HALF_SPAN,
      );
      if (root) {
        root.localToWorld(p0);
        root.localToWorld(p1);
      }

      const worldAxisSpan = p1.clone().sub(p0);
      const worldHalfSpan = Math.max(0.05, worldAxisSpan.length());
      const worldCutNormal =
        worldAxisSpan.lengthSq() > 1e-8
          ? worldAxisSpan.clone().normalize()
          : new THREE.Vector3(...pose.localNormal).normalize();

      const ndc0 = p0.clone().project(camera);
      const ndc1 = p1.clone().project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);

      // Screen vector representing +1.0 change in sectionCutOffset
      let screenDx = ((ndc1.x - ndc0.x) * width) / 2;
      let screenDy = -((ndc1.y - ndc0.y) * height) / 2;
      let screenLenSq = screenDx * screenDx + screenDy * screenDy;

      // Graceful fallback when looking almost directly head-on at the slicing sheet
      if (screenLenSq < 400) {
        if (axis === "y") {
          screenDx = 0;
          screenDy = -160;
        } else {
          screenDx = 160;
          screenDy = 0;
        }
        screenLenSq = screenDx * screenDx + screenDy * screenDy;
      }

      const captureTarget = tryCapture3dPointer(e, is3dPointer);
      const session: SectionCutDragSession = {
        pointerId,
        is3dPointer,
        startX,
        startY,
        startOffset,
        lastDetent: Math.round(startOffset * 10),
        screenDx,
        screenDy,
        screenLenSq,
        startWorldPoint: e.point.clone(),
        worldCutNormal,
        worldHalfSpan,
        hadWindowMove: false,
        captureTarget,
      };
      dragSessionRef.current = session;

      setDragging(true);
      onDraggingChangeRef.current?.(true);
      playRotundaCue("click");

      const handleWindowMove = (ev: PointerEvent) => {
        if (dragSessionRef.current !== session || session.is3dPointer) return;
        session.hadWindowMove = true;
        const mx = ev.clientX - session.startX;
        const my = ev.clientY - session.startY;
        const deltaOffset = (mx * session.screenDx + my * session.screenDy) / session.screenLenSq;
        const nextOffset = clampNumber(session.startOffset + deltaOffset, -1, 1);
        const detent = Math.round(nextOffset * 10);
        if (detent !== session.lastDetent) {
          session.lastDetent = detent;
          playRotundaCue("tick");
        }
        onOffsetChangeRef.current(nextOffset);
      };

      const handleUp = () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("pointermove", handleWindowMove);
          window.removeEventListener("pointerup", handleUp);
          window.removeEventListener("pointercancel", handleUp);
        }
        tryRelease3dPointer(session.captureTarget, session.pointerId);
        if (dragSessionRef.current === session) {
          dragSessionRef.current = null;
        }
        dragCleanupRef.current = null;
        setDragging(false);
        onDraggingChangeRef.current?.(false);
      };

      dragCleanupRef.current = handleUp;

      if (typeof window !== "undefined") {
        window.addEventListener("pointermove", handleWindowMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleUp);
      }
    },
    [axis, camera, gl, offset, plinthRootRef, pose.localNormal, pose.position],
  );

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const session = dragSessionRef.current;
    if (!session) return;
    if (session.pointerId !== null && typeof e.pointerId === "number" && e.pointerId !== session.pointerId) {
      return;
    }

    const use3dPoint =
      session.is3dPointer ||
      (!session.hadWindowMove &&
        (typeof e.clientX !== "number" ||
          !Number.isFinite(e.clientX) ||
          (e.clientX === session.startX && e.clientY === session.startY)));
    if (!use3dPoint) return;

    e.stopPropagation();
    const deltaVec = tmpDeltaRef.current.copy(e.point).sub(session.startWorldPoint);
    const projMeters = deltaVec.dot(session.worldCutNormal);
    const deltaOffset = projMeters / session.worldHalfSpan;
    const nextOffset = clampNumber(session.startOffset + deltaOffset, -1, 1);
    const detent = Math.round(nextOffset * 10);
    if (detent !== session.lastDetent) {
      session.lastDetent = detent;
      playRotundaCue("tick");
    }
    onOffsetChangeRef.current(nextOffset);
  }, []);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    const session = dragSessionRef.current;
    if (!session) return;
    if (session.pointerId !== null && typeof e.pointerId === "number" && e.pointerId !== session.pointerId) {
      return;
    }
    e.stopPropagation();
    dragCleanupRef.current?.();
  }, []);

  const highlight = hovered || dragging;

  return (
    <group position={pose.position} rotation={pose.rotation}>
      {/* Glowing translucent cyan glass slicing sheet */}
      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <planeGeometry args={[SHEET_HALF_W * 2, SHEET_HALF_H * 2]} />
        <meshStandardMaterial
          color={highlight ? "#67e8f9" : "#06b6d4"}
          emissive="#06b6d4"
          emissiveIntensity={highlight ? 0.62 : 0.35}
          transparent={true}
          opacity={highlight ? 0.2 : 0.13}
          roughness={0.12}
          metalness={0.1}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Laser perimeter frame & subtle reticle crosshairs */}
      <Line
        points={SHEET_FRAME_POINTS}
        color={highlight ? "#a5f3fc" : "#22d3ee"}
        lineWidth={highlight ? 2.6 : 1.8}
        transparent={true}
        opacity={highlight ? 0.96 : 0.78}
      />
      <Line
        points={[
          [-SHEET_HALF_W, 0, 0.002],
          [SHEET_HALF_W, 0, 0.002],
        ]}
        color="#38bdf8"
        lineWidth={1}
        dashed={true}
        dashSize={0.04}
        gapSize={0.03}
        transparent={true}
        opacity={0.45}
      />
      <Line
        points={[
          [0, -SHEET_HALF_H, 0.002],
          [0, SHEET_HALF_H, 0.002],
        ]}
        color="#38bdf8"
        lineWidth={1}
        dashed={true}
        dashSize={0.04}
        gapSize={0.03}
        transparent={true}
        opacity={0.45}
      />

      {/* Four brushed metallic corner grab rails */}
      {SHEET_CORNERS.map(([cx, cy, cz], idx) => {
        const sx = cx < 0 ? 1 : -1;
        const sy = cy < 0 ? 1 : -1;
        return (
          <group
            key={`cut-rail-${idx}`}
            position={[cx, cy, cz]}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHovered(true);
            }}
            onPointerOut={() => setHovered(false)}
          >
            {/* Horizontal corner rail arm */}
            <mesh position={[sx * 0.07, 0, 0]}>
              <boxGeometry args={[0.14, 0.022, 0.024]} />
              <meshStandardMaterial
                color={highlight ? "#e2e8f0" : "#94a3b8"}
                emissive={highlight ? "#22d3ee" : "#0891b2"}
                emissiveIntensity={highlight ? 0.85 : 0.3}
                metalness={0.86}
                roughness={0.22}
              />
            </mesh>
            {/* Vertical corner rail arm */}
            <mesh position={[0, sy * 0.07, 0]}>
              <boxGeometry args={[0.022, 0.14, 0.024]} />
              <meshStandardMaterial
                color={highlight ? "#e2e8f0" : "#94a3b8"}
                emissive={highlight ? "#22d3ee" : "#0891b2"}
                emissiveIntensity={highlight ? 0.85 : 0.3}
                metalness={0.86}
                roughness={0.22}
              />
            </mesh>
            {/* Normal-direction tactile grip knob */}
            <mesh position={[0, 0, 0.02]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.016, 0.016, 0.036, 12]} />
              <meshStandardMaterial
                color="#22d3ee"
                emissive="#06b6d4"
                emissiveIntensity={highlight ? 1.5 : 0.7}
                metalness={0.4}
                roughness={0.2}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ── Main TurntableCarousel Component ────────────────────────────────────────

export function TurntableCarousel({
  models,
  activeModelIndex,
  carouselStep,
  plinthYaw,
  plinthZoom,
  explodeFactor,
  caeOverlay,
  renderStyle,
  scaleMode,
  sectionCutEnabled,
  sectionCutAxis,
  sectionCutOffset,
  simulationTime,
  simulationTimeRef,
  isPlaying,
  animationController,
  visibility,
  autoTurntable = false,
  isInXr = false,
  dark = true,
  onSelectSubsystem,
  onPageModel,
  onSelectModelIndex,
  onPlinthYawChange,
  onSectionCutOffsetChange,
  onDraggingChange,
}: TurntableCarouselProps): React.ReactElement {
  const { gl } = useThree();

  // Enable local clipping planes on the active Three.js WebGLRenderer
  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  const plinthRootRef = useRef<THREE.Group | null>(null);
  const pedestalStemRef = useRef<THREE.Mesh | null>(null);
  const contactShadowRef = useRef<THREE.Mesh | null>(null);
  const haloMatRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const pulseRingRef = useRef<THREE.Mesh | null>(null);
  const pulseMatRef = useRef<THREE.MeshStandardMaterial | null>(null);

  const contactShadowTex = useMemo(() => createRadialContactShadowTexture(0.46, 0.22, 128), []);
  const stageShadowTex = useMemo(() => createRadialContactShadowTexture(0.32, 0.14, 128), []);
  const plinthMetalPbr = useMemo(() => createBrushedAluminumPbr(4, 2, "#b4c0ce", 128), []);
  const plinthDarkPbr = useMemo(() => createBrushedAluminumPbr(4, 2, "#546170", 128), []);
  const knurlNormal = useMemo(() => createKnurledMetalNormalMap(48, 2, 64), []);
  const plinthHousingGeom = useMemo(() => createCncPlinthHousingGeometry(), []);
  const pedestalColumnGeom = useMemo(() => createCncPedestalColumnGeometry(), []);

  useEffect(() => {
    return () => {
      contactShadowTex.dispose();
      stageShadowTex.dispose();
      plinthMetalPbr.dispose();
      plinthDarkPbr.dispose();
      knurlNormal.dispose();
      plinthHousingGeom.dispose();
      pedestalColumnGeom.dispose();
    };
  }, [
    contactShadowTex,
    stageShadowTex,
    plinthMetalPbr,
    plinthDarkPbr,
    knurlNormal,
    plinthHousingGeom,
    pedestalColumnGeom,
  ]);

  // Ref-driven smooth animation state (zero per-frame React re-renders)
  const animatedStepRef = useRef<number>(carouselStep);
  const currentPosRef = useRef<THREE.Vector3>(
    new THREE.Vector3(...(scaleMode === "real-scale" ? PLINTH_CENTER_REAL_SCALE : PLINTH_CENTER_TABLETOP)),
  );
  const currentScaleRef = useRef<number>(scaleMode === "real-scale" ? 2.15 : 1.0);
  const plinthYawRef = useRef<number>(plinthYaw);
  const plinthZoomRef = useRef<number>(plinthZoom);
  plinthZoomRef.current = plinthZoom;

  // Rim grab-to-spin interaction state & inertial momentum (Desktop 2D clientX + WebXR 3D e.point)
  const [rimHovered, setRimHovered] = useState(false);
  const [rimDragging, setRimDragging] = useState(false);
  const isRimDraggingRef = useRef(false);
  const angularVelRef = useRef(0);
  const lastDetentRef = useRef(Math.floor(plinthYaw / DETENT_RAD));
  const rimCleanupRef = useRef<(() => void) | null>(null);
  const rimDragRef = useRef<{
    pointerId: number | null;
    is3dPointer: boolean;
    lastClientX: number;
    lastLocalAngle: number;
    lastTime: number;
    hadWindowMove: boolean;
    captureTarget: PointerCaptureTarget | null;
  } | null>(null);
  const tmpRimLocalRef = useRef(new THREE.Vector3());

  const onPlinthYawChangeRef = useRef(onPlinthYawChange);
  const onDraggingChangeRef = useRef(onDraggingChange);
  onPlinthYawChangeRef.current = onPlinthYawChange;
  onDraggingChangeRef.current = onDraggingChange;

  // Sync external plinthYaw changes when user is not actively dragging or coasting
  useEffect(() => {
    if (!isRimDraggingRef.current && Math.abs(angularVelRef.current) < 0.01) {
      plinthYawRef.current = plinthYaw;
      lastDetentRef.current = Math.floor(plinthYaw / DETENT_RAD);
    }
  }, [plinthYaw]);

  useEffect(() => {
    return () => {
      rimCleanupRef.current?.();
      rimCleanupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    if (rimDragging) {
      document.body.style.cursor = "grabbing";
      return () => {
        document.body.style.cursor = "auto";
      };
    }
    if (rimHovered) {
      document.body.style.cursor = "grab";
      return () => {
        document.body.style.cursor = "auto";
      };
    }
    return undefined;
  }, [rimHovered, rimDragging]);

  // World-space clipping plane synced smoothly in useFrame
  const clipPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0));
  const activeClippingPlanes = useMemo(
    () => (sectionCutEnabled ? [clipPlaneRef.current] : EMPTY_CLIPPING_PLANES),
    [sectionCutEnabled],
  );
  const tmpClipPointRef = useRef(new THREE.Vector3());
  const tmpClipNormalRef = useRef(new THREE.Vector3());
  const tmpTargetPosRef = useRef(new THREE.Vector3());

  const activeModel = models.length > 0 ? models[wrapIndex(activeModelIndex, models.length)] : undefined;
  const accentColor = activeModel?.accentColor ?? "#38bdf8";

  // Interactive Rim Grab-to-Spin pointer handlers (supports both Desktop Mouse & WebXR 3D ray/hand/grab)
  const handleRimPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      rimCleanupRef.current?.();

      const is3dPointer = is3dXrPointerEvent(e, gl);
      const pointerId = typeof e.pointerId === "number" ? e.pointerId : null;
      const localPt = tmpRimLocalRef.current.copy(e.point);
      if (plinthRootRef.current) {
        plinthRootRef.current.worldToLocal(localPt);
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      const captureTarget = tryCapture3dPointer(e, is3dPointer);
      const session = {
        pointerId,
        is3dPointer,
        lastClientX: Number.isFinite(e.clientX) ? e.clientX : 0,
        lastLocalAngle: Math.atan2(localPt.x, localPt.z),
        lastTime: now,
        hadWindowMove: false,
        captureTarget,
      };
      rimDragRef.current = session;

      isRimDraggingRef.current = true;
      angularVelRef.current = 0;
      setRimDragging(true);
      onDraggingChangeRef.current?.(true);

      const handleWindowMove = (ev: PointerEvent) => {
        if (rimDragRef.current !== session || session.is3dPointer) return;
        session.hadWindowMove = true;
        const t = typeof performance !== "undefined" ? performance.now() : Date.now();
        const dt = Math.max(0.004, (t - session.lastTime) / 1000);
        const dx = ev.clientX - session.lastClientX;
        session.lastClientX = ev.clientX;
        session.lastTime = t;

        const deltaYaw = dx * 0.0085;
        const nextYaw = plinthYawRef.current + deltaYaw;
        plinthYawRef.current = nextYaw;

        const instVel = clampNumber(deltaYaw / dt, -10, 10);
        angularVelRef.current = angularVelRef.current * 0.55 + instVel * 0.45;

        const detent = Math.floor(nextYaw / DETENT_RAD);
        if (detent !== lastDetentRef.current) {
          lastDetentRef.current = detent;
          playRotundaCue("tick");
        }

        onPlinthYawChangeRef.current(nextYaw);
      };

      const handleUp = () => {
        if (typeof window !== "undefined") {
          window.removeEventListener("pointermove", handleWindowMove);
          window.removeEventListener("pointerup", handleUp);
          window.removeEventListener("pointercancel", handleUp);
        }
        tryRelease3dPointer(session.captureTarget, session.pointerId);
        if (rimDragRef.current === session) {
          rimDragRef.current = null;
        }
        rimCleanupRef.current = null;
        isRimDraggingRef.current = false;
        setRimDragging(false);
        onDraggingChangeRef.current?.(false);
      };

      rimCleanupRef.current = handleUp;

      if (typeof window !== "undefined") {
        window.addEventListener("pointermove", handleWindowMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleUp);
      }
    },
    [gl],
  );

  const handleRimPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const session = rimDragRef.current;
    if (!session) return;
    if (session.pointerId !== null && typeof e.pointerId === "number" && e.pointerId !== session.pointerId) {
      return;
    }

    const use3dPoint =
      session.is3dPointer ||
      (!session.hadWindowMove &&
        (typeof e.clientX !== "number" || !Number.isFinite(e.clientX) || e.clientX === session.lastClientX));
    if (!use3dPoint) return;

    e.stopPropagation();
    const localPt = tmpRimLocalRef.current.copy(e.point);
    if (plinthRootRef.current) {
      plinthRootRef.current.worldToLocal(localPt);
    }
    if (Math.hypot(localPt.x, localPt.z) < 0.05) return;

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt = Math.max(0.004, (now - session.lastTime) / 1000);
    const nextAngle = Math.atan2(localPt.x, localPt.z);
    let deltaYaw = nextAngle - session.lastLocalAngle;
    if (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    if (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;

    session.lastLocalAngle = nextAngle;
    session.lastTime = now;

    if (Math.abs(deltaYaw) < 1e-6) return;

    const nextYaw = plinthYawRef.current + deltaYaw;
    plinthYawRef.current = nextYaw;

    const instVel = clampNumber(deltaYaw / dt, -10, 10);
    angularVelRef.current = angularVelRef.current * 0.55 + instVel * 0.45;

    const detent = Math.floor(nextYaw / DETENT_RAD);
    if (detent !== lastDetentRef.current) {
      lastDetentRef.current = detent;
      playRotundaCue("tick");
    }

    onPlinthYawChangeRef.current(nextYaw);
  }, []);

  const handleRimPointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    const session = rimDragRef.current;
    if (!session) return;
    if (session.pointerId !== null && typeof e.pointerId === "number" && e.pointerId !== session.pointerId) {
      return;
    }
    e.stopPropagation();
    rimCleanupRef.current?.();
  }, []);

  // Main per-frame spring dynamics: scaleMode transition, orbital carousel damping, rim inertia, LED halo, & world clipping plane
  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.1);

    // 1. Plinth Tabletop <-> 1:1 Real-Scale spring interpolation
    const targetCoords = scaleMode === "real-scale" ? PLINTH_CENTER_REAL_SCALE : PLINTH_CENTER_TABLETOP;
    const targetScale = scaleMode === "real-scale" ? 2.15 : 1.0;
    const plinthAlpha = 1 - Math.exp(-delta * 7.2);

    tmpTargetPosRef.current.set(targetCoords[0], targetCoords[1], targetCoords[2]);
    currentPosRef.current.lerp(tmpTargetPosRef.current, plinthAlpha);
    currentScaleRef.current += (targetScale - currentScaleRef.current) * plinthAlpha;

    if (plinthRootRef.current) {
      plinthRootRef.current.position.copy(currentPosRef.current);
      plinthRootRef.current.scale.setScalar(currentScaleRef.current);
      plinthRootRef.current.updateMatrixWorld();
    }

    // Smoothly retract the pedestal column as plinth drops flush into floor for real-scale walkthrough
    if (pedestalStemRef.current) {
      const tabletopRatio = clampNumber(
        (currentPosRef.current.y - PLINTH_CENTER_REAL_SCALE[1]) /
          Math.max(0.1, PLINTH_CENTER_TABLETOP[1] - PLINTH_CENTER_REAL_SCALE[1]),
        0,
        1,
      );
      pedestalStemRef.current.visible = tabletopRatio > 0.04;
      pedestalStemRef.current.scale.y = Math.max(0.01, tabletopRatio);
      pedestalStemRef.current.position.y = -0.14 - 0.48 * tabletopRatio;
    }

    // Keep lightweight floor contact-shadow disc flush with y = 0.005m across tabletop/real-scale transitions
    if (contactShadowRef.current) {
      const safeScale = Math.max(0.05, currentScaleRef.current);
      contactShadowRef.current.position.y = (0.005 - currentPosRef.current.y) / safeScale;
    }

    // 2. Orbital Carousel exponential spring damping
    const stepDiff = carouselStep - animatedStepRef.current;
    if (Math.abs(stepDiff) > 0.0005) {
      const stepAlpha = 1 - Math.exp(-delta * 8.5);
      animatedStepRef.current += stepDiff * stepAlpha;
    } else {
      animatedStepRef.current = carouselStep;
    }

    const transitionMag = Math.abs(carouselStep - animatedStepRef.current);

    // 3. Inertial momentum damping after rim grab-to-spin release + hands-free auto-turntable
    if (!isRimDraggingRef.current && autoTurntable && Math.abs(angularVelRef.current) <= 0.012) {
      plinthYawRef.current += delta * 0.34;
    }
    if (!isRimDraggingRef.current && Math.abs(angularVelRef.current) > 0.012) {
      const decay = Math.exp(-delta * 4.8);
      const nextYaw = plinthYawRef.current + angularVelRef.current * delta;
      plinthYawRef.current = nextYaw;
      angularVelRef.current *= decay;

      const detent = Math.floor(nextYaw / DETENT_RAD);
      if (detent !== lastDetentRef.current) {
        lastDetentRef.current = detent;
        playRotundaCue("tick");
      }

      onPlinthYawChangeRef.current(nextYaw);
      if (Math.abs(angularVelRef.current) <= 0.012) {
        angularVelRef.current = 0;
      }
    }

    // 4. Animated LED status halo under the plinth bezel
    if (haloMatRef.current) {
      const breath = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 2.2);
      const boost = isRimDraggingRef.current ? 0.9 : transitionMag > 0.08 ? 1.1 : 0;
      haloMatRef.current.emissiveIntensity = 0.72 + breath * 0.35 + boost;
    }

    // 5. Holographic transition ring pulse during orbital paging (|delta| > 0.08)
    if (pulseRingRef.current && pulseMatRef.current) {
      const isTransitioning = transitionMag > 0.08;
      pulseRingRef.current.visible = isTransitioning;
      if (isTransitioning) {
        const pulseWave = clampNumber(1 - transitionMag, 0, 1);
        const expand = 1.0 + pulseWave * 0.34;
        pulseRingRef.current.scale.set(expand, expand, 1);
        pulseRingRef.current.position.y = 0.02 + pulseWave * 0.22;
        pulseMatRef.current.opacity = clampNumber(transitionMag * 0.85, 0.12, 0.78);
      }
    }

    // 6. Synchronize world-space THREE.Plane to visual section-cut slicing sheet
    if (sectionCutEnabled && plinthRootRef.current) {
      const d = clampNumber(sectionCutOffset, -1, 1) * SECTION_CUT_HALF_SPAN;
      const pt = tmpClipPointRef.current;
      const normal = tmpClipNormalRef.current;

      if (sectionCutAxis === "x") {
        pt.set(d, HERO_LOCAL_CENTER_Y, 0);
        normal.set(-1, 0, 0);
      } else if (sectionCutAxis === "y") {
        pt.set(0, HERO_LOCAL_CENTER_Y + d, 0);
        normal.set(0, -1, 0);
      } else {
        pt.set(0, HERO_LOCAL_CENTER_Y, d);
        normal.set(0, 0, -1);
      }

      plinthRootRef.current.localToWorld(pt);
      clipPlaneRef.current.setFromNormalAndCoplanarPoint(normal, pt);
    }
  });

  // Determine the 1..3 unwrapped integer orbital steps to keep mounted around carouselStep
  const visibleSlots = useMemo(() => {
    if (models.length === 0) return [];
    const offsets = models.length === 1 ? [0] : [-1, 0, 1];
    return offsets.map((offset) => {
      const step = carouselStep + offset;
      const modelIdx = wrapIndex(activeModelIndex + offset, models.length);
      return {
        step,
        model: models[modelIdx]!,
      };
    });
  }, [models, carouselStep, activeModelIndex]);

  const initialPos = scaleMode === "real-scale" ? PLINTH_CENTER_REAL_SCALE : PLINTH_CENTER_TABLETOP;
  const initialScale = scaleMode === "real-scale" ? 2.15 : 1.0;
  const initialShadowLocalY = (0.005 - initialPos[1]) / initialScale;

  return (
    <group ref={plinthRootRef} name="rotunda-turntable-carousel" position={initialPos} scale={initialScale}>
      {/* ── Circular Metrology Plinth Stage (CNC Machined Brushed Titanium) ── */}
      <group name="metrology-plinth">
        {/* Lightweight soft radial contact-shadow disc on the floor (ZERO shadow-map GPU cost) */}
        <mesh ref={contactShadowRef} position={[0, initialShadowLocalY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[1.18, 40]} />
          <meshBasicMaterial map={contactShadowTex} transparent={true} depthWrite={false} />
        </mesh>

        {/* Retractable flared CNC-turned anodized titanium pedestal column (collapses cleanly in real-scale) */}
        <mesh ref={pedestalStemRef} geometry={pedestalColumnGeom} position={[0, -0.62, 0]}>
          <meshStandardMaterial
            map={plinthDarkPbr.map}
            normalMap={plinthDarkPbr.normalMap}
            normalScale={new THREE.Vector2(0.42, 0.42)}
            roughnessMap={plinthDarkPbr.roughnessMap}
            roughness={1.0}
            metalness={0.86}
          />
        </mesh>

        {/* Single-mesh CNC-turned multi-step chamfered plinth head housing with shadow-line reveal */}
        <mesh geometry={plinthHousingGeom} position={[0, 0, 0]}>
          <meshStandardMaterial
            map={plinthMetalPbr.map}
            normalMap={plinthMetalPbr.normalMap}
            normalScale={new THREE.Vector2(0.45, 0.45)}
            roughnessMap={plinthMetalPbr.roughnessMap}
            roughness={1.0}
            metalness={0.86}
          />
        </mesh>

        {/* Interactive grab-to-spin diamond-knurled CNC anodized metallic rim torus */}
        <mesh
          position={[0, 0.002, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          onPointerDown={handleRimPointerDown}
          onPointerMove={handleRimPointerMove}
          onPointerUp={handleRimPointerUp}
          onPointerCancel={handleRimPointerUp}
          onPointerOver={(e) => {
            e.stopPropagation();
            setRimHovered(true);
          }}
          onPointerOut={() => setRimHovered(false)}
        >
          <torusGeometry args={[0.768, 0.031, 20, 72]} />
          <meshStandardMaterial
            color={rimHovered || rimDragging ? "#38bdf8" : "#8b98a8"}
            normalMap={knurlNormal}
            normalScale={new THREE.Vector2(0.75, 0.75)}
            emissive={rimHovered || rimDragging ? "#0284c7" : "#1e293b"}
            emissiveIntensity={rimDragging ? 0.55 : rimHovered ? 0.3 : 0.04}
            metalness={0.88}
            roughness={0.24}
          />
        </mesh>

        {/* Satin bead-blasted optical ceramic / frosted glass center stage deck */}
        <mesh position={[0, -0.004, 0]}>
          <cylinderGeometry args={[0.656, 0.656, 0.012, 64]} />
          <meshStandardMaterial
            map={plinthMetalPbr.map}
            normalMap={plinthMetalPbr.normalMap}
            normalScale={new THREE.Vector2(0.18, 0.18)}
            roughnessMap={plinthMetalPbr.roughnessMap}
            color="#e2e8f0"
            emissive="#f8fafc"
            emissiveIntensity={0.08}
            metalness={0.28}
            roughness={0.55}
            transparent={true}
            opacity={0.97}
          />
        </mesh>

        {/* Soft radial contact-shadow decal right beneath the hero CAD assembly on the turntable stage */}
        <mesh position={[0, 0.0035, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.52, 36]} />
          <meshBasicMaterial map={stageShadowTex} transparent={true} depthWrite={false} />
        </mesh>

        {/* Precision laser-etched hairline metrology reticle rings on the stage deck */}
        {[0.22, 0.42, 0.61].map((r, idx) => (
          <mesh key={`reticle-${idx}`} position={[0, 0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[r, 0.0024, 8, 64]} />
            <meshStandardMaterial
              color="#0284c7"
              emissive="#0284c7"
              emissiveIntensity={0.48}
              transparent={true}
              opacity={0.45}
              toneMapped={false}
            />
          </mesh>
        ))}

        {/* 36 Radial Perimeter Tick Marks (10° ticks + accentuated 90° cardinal ticks) */}
        <PlinthTickMarks plinthYaw={plinthYaw} accentColor="#0284c7" />

        {/* Recessed indirect LED cove halo tucked cleanly inside the CNC shadow-line groove */}
        <mesh position={[0, -0.078, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.752, 0.011, 12, 72]} />
          <meshStandardMaterial
            ref={haloMatRef}
            color="#0284c7"
            emissive="#0284c7"
            emissiveIntensity={1.1}
            roughness={0.2}
            metalness={0.2}
            toneMapped={false}
          />
        </mesh>

        {/* Front bezel orbital index pips (clickable direct model selection via onSelectModelIndex) */}
        {models.length > 1 && (
          <group position={[0, 0.018, 0]}>
            {models.map((entry, idx) => {
              const spanAngle = Math.min(0.65, (models.length - 1) * 0.14);
              const frac = models.length === 1 ? 0 : idx / (models.length - 1) - 0.5;
              const pipAngle = frac * spanAngle;
              const isSelected = idx === wrapIndex(activeModelIndex, models.length);
              const pipColor = entry.accentColor ?? accentColor;
              return (
                <mesh
                  key={`pip-${entry.id}`}
                  position={[Math.sin(pipAngle) * 0.765, 0.018, Math.cos(pipAngle) * 0.765]}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isSelected) {
                      playRotundaCue("page");
                      onSelectModelIndex(idx);
                    }
                  }}
                >
                  <sphereGeometry args={[isSelected ? 0.02 : 0.013, 14, 14]} />
                  <meshStandardMaterial
                    color={isSelected ? pipColor : "#94a3b8"}
                    emissive={isSelected ? pipColor : "#64748b"}
                    emissiveIntensity={isSelected ? 1.5 : 0.18}
                    roughness={0.22}
                    metalness={0.28}
                  />
                </mesh>
              );
            })}
          </group>
        )}

        {/* Holographic transition pulse ring around plinth during orbital paging */}
        <mesh ref={pulseRingRef} visible={false} position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.82, 0.014, 12, 72]} />
          <meshStandardMaterial
            ref={pulseMatRef}
            color="#38bdf8"
            emissive="#0284c7"
            emissiveIntensity={1.6}
            transparent={true}
            opacity={0.65}
            depthWrite={false}
          />
        </mesh>
      </group>

      {/* ── Orbital 3D Model Carousel Slots (Prev / Center Hero / Next) ──── */}
      <group name="orbital-carousel-slots">
        {visibleSlots.map(({ step, model }) => (
          <CarouselSlotNode
            key={step}
            step={step}
            targetStep={carouselStep}
            model={model}
            animatedStepRef={animatedStepRef}
            plinthYawRef={plinthYawRef}
            plinthZoomRef={plinthZoomRef}
            explodeFactor={explodeFactor}
            caeOverlay={caeOverlay}
            renderStyle={renderStyle}
            simulationTime={simulationTime}
            simulationTimeRef={simulationTimeRef}
            isPlaying={isPlaying}
            clippingPlanes={activeClippingPlanes}
            animationController={animationController}
            visibility={visibility}
            isInXr={isInXr}
            dark={dark}
            onSelectSubsystem={onSelectSubsystem}
            onClickGhost={onPageModel}
          />
        ))}
      </group>

      {/* ── Interactive 3D Section Cut Slicing Plane ─────────────────────── */}
      {sectionCutEnabled && (
        <SectionCutPlaneGizmo
          axis={sectionCutAxis}
          offset={sectionCutOffset}
          plinthRootRef={plinthRootRef}
          onOffsetChange={onSectionCutOffsetChange}
          onDraggingChange={onDraggingChange}
        />
      )}
    </group>
  );
}
