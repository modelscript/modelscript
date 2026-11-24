// SPDX-License-Identifier: AGPL-3.0-or-later

import { useFrame, useThree } from "@react-three/fiber";
import { TeleportTarget, XROrigin, useXR, useXRControllerLocomotion, useXRInputSourceState } from "@react-three/xr";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { SpatialInteractionLock } from "./spatial-interaction.js";
import { clampNumber, type RotundaAction, type RotundaScaleMode } from "./types.js";
import type { RotundaCueKind } from "./xr-session.js";

const DEFAULT_ORIGIN_POS: [number, number, number] = [0, 0, 0.22];
const DEFAULT_MAX_TELEPORT_RADIUS = 6.0;
const DEFAULT_TWO_HAND_SENSITIVITY = 1.6;
const DEFAULT_PINCH_ENGAGE_M = 0.024;
const DEFAULT_PINCH_RELEASE_M = 0.036;
const HAND_PAGE_COOLDOWN_MS = 450;
const HAND_SCALE_COOLDOWN_MS = 550;
const PAGE_FLICK_THRESHOLD = 0.72;
const PAGE_SCHMITT_RESET = 0.3;
const PAGE_DEBOUNCE_MS = 380;
const ZOOM_DEADZONE = 0.25;
const ZOOM_SPEED = 0.9;
const TELEPORT_RING_DURATION_SEC = 0.95;

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Pure Schmitt-hysteresis helper evaluating whether a thumb-to-finger tip distance (in meters)
 * represents an active bare-hand pinch gesture. Engages at `<= engageThreshold` (default `0.024m`)
 * and releases once `>= releaseThreshold` (default `0.036m`) to eliminate hand-tracking jitter.
 */
export function evaluatePinchState(
  tipDistanceMeters: number,
  currentlyPinched: boolean,
  engageThreshold = DEFAULT_PINCH_ENGAGE_M,
  releaseThreshold = DEFAULT_PINCH_RELEASE_M,
): boolean {
  if (!Number.isFinite(tipDistanceMeters) || tipDistanceMeters < 0) {
    return false;
  }
  const safeEngage = Number.isFinite(engageThreshold) && engageThreshold > 0 ? engageThreshold : DEFAULT_PINCH_ENGAGE_M;
  const safeRelease =
    Number.isFinite(releaseThreshold) && releaseThreshold >= safeEngage
      ? releaseThreshold
      : Math.max(safeEngage, DEFAULT_PINCH_RELEASE_M);

  if (currentlyPinched) {
    return tipDistanceMeters < safeRelease;
  }
  return tipDistanceMeters <= safeEngage;
}

/**
 * Pure helper computing the CAD explode-factor delta from a two-hand squeeze or index-pinch
 * pull-apart / push-together gesture. Positive values pull parts apart; negative collapse.
 */
export function computeTwoHandExplodeDelta(
  prevDistance: number,
  nextDistance: number,
  sensitivity = DEFAULT_TWO_HAND_SENSITIVITY,
): number {
  if (!Number.isFinite(prevDistance) || !Number.isFinite(nextDistance) || !Number.isFinite(sensitivity)) {
    return 0;
  }
  const safePrev = Math.max(0, prevDistance);
  const safeNext = Math.max(0, nextDistance);
  const safeSens = Math.max(0, sensitivity);
  const rawDelta = (safeNext - safePrev) * safeSens;
  return normalizeZero(clampNumber(rawDelta, -1, 1));
}

/**
 * Pure helper clamping a WebXR floor teleport destination onto the standing floor plane (`y = 0`)
 * within a safe circular Rotunda perimeter of radius `maxRadius` meters.
 */
export function clampTeleportDestination(
  x: number,
  z: number,
  maxRadius = DEFAULT_MAX_TELEPORT_RADIUS,
): [number, number, number] {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeZ = Number.isFinite(z) ? z : 0;
  const safeMax = Number.isFinite(maxRadius) && maxRadius > 0 ? maxRadius : DEFAULT_MAX_TELEPORT_RADIUS;
  const dist = Math.hypot(safeX, safeZ);

  if (dist > safeMax && dist > 0) {
    const scale = safeMax / dist;
    return [normalizeZero(safeX * scale), 0, normalizeZero(safeZ * scale)];
  }
  return [normalizeZero(safeX), 0, normalizeZero(safeZ)];
}

export interface XrLocomotionRigProps {
  scaleMode: RotundaScaleMode;
  onCue: (kind: RotundaCueKind) => void;
  maxTeleportRadius?: number | undefined;
  children?: React.ReactNode | undefined;
}

/**
 * WebXR Standing Origin + Smooth Left-Thumbstick Locomotion + Right-Thumbstick Snap-Turn
 * + 14m × 14m Floor `<TeleportTarget>` with a glowing cyan landing ring pulse.
 */
export function XrLocomotionRig({
  scaleMode,
  onCue,
  maxTeleportRadius = DEFAULT_MAX_TELEPORT_RADIUS,
  children,
}: XrLocomotionRigProps): React.ReactElement {
  const originRef = useRef<THREE.Group | null>(null);
  const [originPos, setOriginPos] = useState<[number, number, number]>(DEFAULT_ORIGIN_POS);

  // Subtle glowing cyan teleport destination ring animation state
  const ringGroupRef = useRef<THREE.Group | null>(null);
  const outerRingMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const innerRingMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const discMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const ringTimerRef = useRef(0);
  const ringPosRef = useRef<[number, number, number]>(DEFAULT_ORIGIN_POS);

  const translationOptions = useMemo(() => ({ speed: scaleMode === "real-scale" ? 2.4 : 1.4 }), [scaleMode]);
  const rotationOptions = useMemo(
    () => (scaleMode === "real-scale" ? { type: "snap" as const, degrees: 45 } : (false as const)),
    [scaleMode],
  );

  useXRControllerLocomotion(originRef, translationOptions, rotationOptions, "left");

  const handleTeleport = useCallback(
    (pt: THREE.Vector3) => {
      const [cx, cy, cz] = clampTeleportDestination(pt.x, pt.z, maxTeleportRadius);
      setOriginPos([cx, cy, cz]);
      if (originRef.current) {
        originRef.current.position.set(cx, cy, cz);
      }
      ringPosRef.current = [cx, cy, cz];
      ringTimerRef.current = TELEPORT_RING_DURATION_SEC;
      if (ringGroupRef.current) {
        ringGroupRef.current.position.set(cx, 0.014, cz);
        ringGroupRef.current.visible = true;
      }
      onCue("snap");
    },
    [maxTeleportRadius, onCue],
  );

  useFrame((_, rawDelta) => {
    const group = ringGroupRef.current;
    if (!group) return;
    if (ringTimerRef.current <= 0) {
      if (group.visible) group.visible = false;
      return;
    }

    const delta = Math.min(rawDelta, 0.1);
    ringTimerRef.current = Math.max(0, ringTimerRef.current - delta);
    const progress = 1 - ringTimerRef.current / TELEPORT_RING_DURATION_SEC;
    const fade = Math.sin((1 - progress) * Math.PI * 0.5);
    const expand = 0.85 + progress * 0.55;

    group.visible = true;
    group.position.set(ringPosRef.current[0], 0.014, ringPosRef.current[2]);
    group.scale.set(expand, 1, expand);

    if (outerRingMatRef.current) {
      outerRingMatRef.current.opacity = 0.9 * fade;
    }
    if (innerRingMatRef.current) {
      innerRingMatRef.current.opacity = 0.65 * fade;
    }
    if (discMatRef.current) {
      discMatRef.current.opacity = 0.22 * fade;
    }
  });

  return (
    <>
      <XROrigin ref={originRef} position={originPos}>
        {children}
      </XROrigin>

      <TeleportTarget onTeleport={handleTeleport}>
        <mesh name="rotunda-teleport-floor" position={[0, 0.005, -1.6]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[14, 14]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </TeleportTarget>

      {/* Glowing cyan destination reticle pulse rendered upon teleport landing */}
      <group ref={ringGroupRef} visible={false} position={[0, 0.014, 0.22]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.31, 0.36, 48]} />
          <meshBasicMaterial
            ref={outerRingMatRef}
            color="#22d3ee"
            transparent
            opacity={0.85}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
          <ringGeometry args={[0.18, 0.205, 36]} />
          <meshBasicMaterial
            ref={innerRingMatRef}
            color="#67e8f9"
            transparent
            opacity={0.6}
            depthWrite={false}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
          <circleGeometry args={[0.31, 40]} />
          <meshBasicMaterial
            ref={discMatRef}
            color="#06b6d4"
            transparent
            opacity={0.2}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
    </>
  );
}

interface SampledHandPinch {
  indexPinched: boolean;
  middlePinched: boolean;
  hasPinchPoint: boolean;
}

function sampleHandPinch(
  frame: XRFrame,
  refSpace: XRReferenceSpace,
  xrHand: XRHand | undefined,
  prevIndex: boolean,
  prevMiddle: boolean,
  xrOrigin: THREE.Object3D | undefined,
  outPinchPoint: THREE.Vector3,
  outResult: SampledHandPinch,
): void {
  outResult.indexPinched = false;
  outResult.middlePinched = false;
  outResult.hasPinchPoint = false;

  if (!xrHand || typeof frame.getJointPose !== "function") {
    return;
  }

  const thumbJoint = xrHand.get("thumb-tip");
  const indexJoint = xrHand.get("index-finger-tip");
  const middleJoint = xrHand.get("middle-finger-tip");

  const thumbPose = thumbJoint ? frame.getJointPose(thumbJoint, refSpace) : undefined;
  if (!thumbPose) {
    return;
  }

  const tp = thumbPose.transform.position;

  if (indexJoint) {
    const indexPose = frame.getJointPose(indexJoint, refSpace);
    if (indexPose) {
      const ip = indexPose.transform.position;
      const dist = Math.hypot(ip.x - tp.x, ip.y - tp.y, ip.z - tp.z);
      outResult.indexPinched = evaluatePinchState(dist, prevIndex);
      outPinchPoint.set((tp.x + ip.x) * 0.5, (tp.y + ip.y) * 0.5, (tp.z + ip.z) * 0.5);
      if (xrOrigin) {
        outPinchPoint.applyMatrix4(xrOrigin.matrixWorld);
      }
      outResult.hasPinchPoint = true;
    }
  }

  if (middleJoint) {
    const middlePose = frame.getJointPose(middleJoint, refSpace);
    if (middlePose) {
      const mp = middlePose.transform.position;
      const dist = Math.hypot(mp.x - tp.x, mp.y - tp.y, mp.z - tp.z);
      outResult.middlePinched = evaluatePinchState(dist, prevMiddle);
    }
  }
}

export interface XrControllerBindingsProps {
  dispatch: React.Dispatch<RotundaAction>;
  modelCount: number;
  explodeFactor: number;
  scaleMode?: RotundaScaleMode | undefined;
  onCue: (kind: RotundaCueKind) => void;
  twoHandSensitivity?: number | undefined;
  /** Shared ref reporting active 3D diagram editor interaction lock (suspends explode/carousel when active). */
  interactionLockRef?: React.RefObject<SpatialInteractionLock> | undefined;
}

/**
 * Native WebXR Controller & Quest 2 Bare-Hand Tracking Gesture Bindings:
 *  - Right thumbstick X flick (`|x| > 0.72`, 380ms debounce + Schmitt reset `< 0.3`): pages Orbital Carousel in tabletop mode (yields to 45° snap-turn in 1:1 real-scale mode or active 3D diagram grabs).
 *  - Right thumbstick Y (`|y| > 0.25`): smoothly adjusts central plinth zoom.
 *  - Dual-controller squeeze pull-apart (`xr-standard-squeeze` on both hands): explodes/collapses CAD assembly with haptic detents (yields while 3D diagram editor interaction lock is held).
 *  - Face buttons (`a-button`/`x-button` toggle play/pause; `b-button`/`y-button` toggle tabletop ↔ 1:1 real-scale).
 *  - Two-hand bare-hand index-pinch pull-apart: smoothly drives CAD `explodeFactor` (`0..1`) with detent ticks.
 *  - Right-hand middle-finger pinch (rising edge, 450ms cooldown): pages Orbital Carousel (`+1`).
 *  - Left-hand middle-finger pinch (rising edge, 550ms cooldown): toggles Tabletop ↔ 1:1 Real-Scale.
 */
export function XrControllerBindings({
  dispatch,
  modelCount,
  explodeFactor,
  scaleMode = "tabletop",
  onCue,
  twoHandSensitivity = DEFAULT_TWO_HAND_SENSITIVITY,
  interactionLockRef,
}: XrControllerBindingsProps): null {
  const rightController = useXRInputSourceState("controller", "right");
  const leftController = useXRInputSourceState("controller", "left");
  const rightHand = useXRInputSourceState("hand", "right");
  const leftHand = useXRInputSourceState("hand", "left");
  const xrOrigin = useXR((s) => s.origin);
  const gl = useThree((s) => s.gl);

  // Schmitt trigger & debounce state for orbital carousel flick paging
  const pageArmedRef = useRef(true);
  const lastPageMsRef = useRef(0);

  // Two-hand squeeze / bare-hand index-pinch pull-apart CAD explode state (zero per-frame allocations)
  const prevTwoHandDistRef = useRef<number | null>(null);
  const isTwoHandSqueezingRef = useRef(false);
  const prevTwoHandPinchDistRef = useRef<number | null>(null);
  const isTwoHandPinchingRef = useRef(false);
  const explodeFactorRef = useRef(explodeFactor);
  const lastExplodeDetentRef = useRef(Math.round(explodeFactor * 16));
  const leftWorldPosRef = useRef(new THREE.Vector3());
  const rightWorldPosRef = useRef(new THREE.Vector3());
  const leftHandPinchPosRef = useRef(new THREE.Vector3());
  const rightHandPinchPosRef = useRef(new THREE.Vector3());

  // Bare-hand Schmitt pinch states, scratch sample records, and cooldowns
  const handPinchStateRef = useRef({
    leftIndex: false,
    rightIndex: false,
    leftMiddle: false,
    rightMiddle: false,
  });
  const leftHandSampleRef = useRef<SampledHandPinch>({
    indexPinched: false,
    middlePinched: false,
    hasPinchPoint: false,
  });
  const rightHandSampleRef = useRef<SampledHandPinch>({
    indexPinched: false,
    middlePinched: false,
    hasPinchPoint: false,
  });
  const lastHandPageMsRef = useRef(0);
  const lastHandScaleMsRef = useRef(0);

  // Rising-edge button trackers for A/X and B/Y face buttons
  const prevButtonsRef = useRef({ a: false, x: false, b: false, y: false });

  // Keep explodeFactorRef synced with external slider/button changes when not actively exploding
  useEffect(() => {
    if (!isTwoHandSqueezingRef.current && !isTwoHandPinchingRef.current) {
      explodeFactorRef.current = explodeFactor;
      lastExplodeDetentRef.current = Math.round(explodeFactor * 16);
    }
  }, [explodeFactor]);

  useFrame((_state, rawDelta, frame) => {
    // Yield cleanly while a 3D diagram grab, magnetic wire drag, or wrist palette pull is active
    const lock = interactionLockRef?.current ?? "none";
    const hasController = Boolean(rightController || leftController);
    const hasHand = Boolean(rightHand || leftHand);

    if ((!hasController && !hasHand) || lock !== "none") {
      isTwoHandSqueezingRef.current = false;
      prevTwoHandDistRef.current = null;
      isTwoHandPinchingRef.current = false;
      prevTwoHandPinchDistRef.current = null;
      handPinchStateRef.current.leftIndex = false;
      handPinchStateRef.current.rightIndex = false;
      handPinchStateRef.current.leftMiddle = false;
      handPinchStateRef.current.rightMiddle = false;
      return;
    }

    const delta = Math.min(rawDelta, 0.1);
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();

    if (hasController) {
      // 1. Right thumbstick X flick (Orbital Carousel paging in tabletop mode) & Y (smooth Plinth Zoom)
      const rightStick = rightController?.gamepad["xr-standard-thumbstick"];
      const rightX = rightStick?.xAxis ?? 0;
      const rightY = rightStick?.yAxis ?? 0;

      if (scaleMode === "tabletop") {
        if (Math.abs(rightX) < PAGE_SCHMITT_RESET) {
          pageArmedRef.current = true;
        } else if (
          Math.abs(rightX) > PAGE_FLICK_THRESHOLD &&
          pageArmedRef.current &&
          nowMs - lastPageMsRef.current >= PAGE_DEBOUNCE_MS &&
          modelCount > 0
        ) {
          pageArmedRef.current = false;
          lastPageMsRef.current = nowMs;
          dispatch({ type: "pageModel", delta: rightX > 0 ? 1 : -1, modelCount });
          onCue("page");
        }
      }

      if (Math.abs(rightY) > ZOOM_DEADZONE) {
        dispatch({ type: "adjustZoom", delta: -rightY * delta * ZOOM_SPEED });
      }

      // 2. Two-Hand Squeeze Pull-Apart Gesture -> CAD Radial Explode
      const leftSqueezed = leftController?.gamepad["xr-standard-squeeze"]?.state === "pressed";
      const rightSqueezed = rightController?.gamepad["xr-standard-squeeze"]?.state === "pressed";

      if (leftSqueezed && rightSqueezed && leftController?.object && rightController?.object) {
        leftController.object.getWorldPosition(leftWorldPosRef.current);
        rightController.object.getWorldPosition(rightWorldPosRef.current);
        const nextDist = leftWorldPosRef.current.distanceTo(rightWorldPosRef.current);

        if (prevTwoHandDistRef.current !== null) {
          const explodeDelta = computeTwoHandExplodeDelta(prevTwoHandDistRef.current, nextDist, twoHandSensitivity);
          if (Math.abs(explodeDelta) > 0.0005) {
            const nextFactor = clampNumber(explodeFactorRef.current + explodeDelta, 0, 1);
            if (Math.abs(nextFactor - explodeFactorRef.current) > 0.0001) {
              explodeFactorRef.current = nextFactor;
              dispatch({ type: "setExplode", factor: nextFactor });
              const detent = Math.round(nextFactor * 16);
              if (detent !== lastExplodeDetentRef.current) {
                lastExplodeDetentRef.current = detent;
                onCue("tick");
              }
            }
          }
        } else {
          isTwoHandSqueezingRef.current = true;
          explodeFactorRef.current = explodeFactor;
          lastExplodeDetentRef.current = Math.round(explodeFactor * 16);
          onCue("click");
        }

        prevTwoHandDistRef.current = nextDist;
      } else {
        isTwoHandSqueezingRef.current = false;
        prevTwoHandDistRef.current = null;
      }

      // 3. Primary (A/X -> Play/Pause) & Secondary (B/Y -> Tabletop <-> 1:1 Real-Scale) edge detection
      const aPressed = rightController?.gamepad["a-button"]?.state === "pressed";
      const xPressed = leftController?.gamepad["x-button"]?.state === "pressed";
      const bPressed = rightController?.gamepad["b-button"]?.state === "pressed";
      const yPressed = leftController?.gamepad["y-button"]?.state === "pressed";

      const prev = prevButtonsRef.current;
      if ((aPressed && !prev.a) || (xPressed && !prev.x)) {
        dispatch({ type: "togglePlaying" });
        onCue("click");
      }
      if ((bPressed && !prev.b) || (yPressed && !prev.y)) {
        dispatch({ type: "toggleScaleMode" });
        onCue("snap");
      }

      prev.a = Boolean(aPressed);
      prev.x = Boolean(xPressed);
      prev.b = Boolean(bPressed);
      prev.y = Boolean(yPressed);
    } else {
      isTwoHandSqueezingRef.current = false;
      prevTwoHandDistRef.current = null;
      prevButtonsRef.current.a = false;
      prevButtonsRef.current.x = false;
      prevButtonsRef.current.b = false;
      prevButtonsRef.current.y = false;
    }

    // 4. Quest 2 Bare-Hand Tracking Gestures (Two-Hand Index-Pinch Explode + Middle-Finger Pinches)
    const refSpace = gl.xr.getReferenceSpace();
    const leftXrHand = leftHand?.inputSource.hand;
    const rightXrHand = rightHand?.inputSource.hand;

    if (frame && refSpace && (leftXrHand || rightXrHand)) {
      const pinchState = handPinchStateRef.current;
      const leftSample = leftHandSampleRef.current;
      const rightSample = rightHandSampleRef.current;

      sampleHandPinch(
        frame,
        refSpace,
        leftXrHand,
        pinchState.leftIndex,
        pinchState.leftMiddle,
        xrOrigin,
        leftHandPinchPosRef.current,
        leftSample,
      );
      sampleHandPinch(
        frame,
        refSpace,
        rightXrHand,
        pinchState.rightIndex,
        pinchState.rightMiddle,
        xrOrigin,
        rightHandPinchPosRef.current,
        rightSample,
      );

      // 4a. Two-Hand Index-Pinch Pull-Apart -> CAD Radial Explode (0..1)
      if (
        leftSample.indexPinched &&
        rightSample.indexPinched &&
        leftSample.hasPinchPoint &&
        rightSample.hasPinchPoint
      ) {
        const nextDist = leftHandPinchPosRef.current.distanceTo(rightHandPinchPosRef.current);

        if (prevTwoHandPinchDistRef.current !== null) {
          const explodeDelta = computeTwoHandExplodeDelta(
            prevTwoHandPinchDistRef.current,
            nextDist,
            twoHandSensitivity,
          );
          if (Math.abs(explodeDelta) > 0.0005) {
            const nextFactor = clampNumber(explodeFactorRef.current + explodeDelta, 0, 1);
            if (Math.abs(nextFactor - explodeFactorRef.current) > 0.0001) {
              explodeFactorRef.current = nextFactor;
              dispatch({ type: "setExplode", factor: nextFactor });
              const detent = Math.round(nextFactor * 16);
              if (detent !== lastExplodeDetentRef.current) {
                lastExplodeDetentRef.current = detent;
                onCue("tick");
              }
            }
          }
        } else {
          isTwoHandPinchingRef.current = true;
          explodeFactorRef.current = explodeFactor;
          lastExplodeDetentRef.current = Math.round(explodeFactor * 16);
          onCue("click");
        }

        prevTwoHandPinchDistRef.current = nextDist;
      } else {
        isTwoHandPinchingRef.current = false;
        prevTwoHandPinchDistRef.current = null;
      }

      // 4b. Right-Hand Middle-Finger Pinch (rising edge, 450ms cooldown) -> Page Orbital Carousel
      if (
        rightSample.middlePinched &&
        !pinchState.rightMiddle &&
        !isTwoHandPinchingRef.current &&
        nowMs - lastHandPageMsRef.current >= HAND_PAGE_COOLDOWN_MS &&
        modelCount > 0
      ) {
        lastHandPageMsRef.current = nowMs;
        dispatch({ type: "pageModel", delta: 1, modelCount });
        onCue("page");
      }

      // 4c. Left-Hand Middle-Finger Pinch (rising edge, 550ms cooldown) -> Toggle Tabletop <-> 1:1 Real-Scale
      if (
        leftSample.middlePinched &&
        !pinchState.leftMiddle &&
        !isTwoHandPinchingRef.current &&
        nowMs - lastHandScaleMsRef.current >= HAND_SCALE_COOLDOWN_MS
      ) {
        lastHandScaleMsRef.current = nowMs;
        dispatch({ type: "toggleScaleMode" });
        onCue("snap");
      }

      pinchState.leftIndex = leftSample.indexPinched;
      pinchState.rightIndex = rightSample.indexPinched;
      pinchState.leftMiddle = leftSample.middlePinched;
      pinchState.rightMiddle = rightSample.middlePinched;
    } else {
      isTwoHandPinchingRef.current = false;
      prevTwoHandPinchDistRef.current = null;
      handPinchStateRef.current.leftIndex = false;
      handPinchStateRef.current.rightIndex = false;
      handPinchStateRef.current.leftMiddle = false;
      handPinchStateRef.current.rightMiddle = false;
    }
  });

  return null;
}
