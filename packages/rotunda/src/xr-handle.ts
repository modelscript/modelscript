// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from "three";

/**
 * Unified XR / desktop pointer binding for the 3D diagram editor.
 *
 * Every grab / wire / palette-pull session is bound to the exact input source that
 * started it (via the `@pmndrs/pointer-events` `pointerState`), and is then driven
 * every frame from that input source's own WebXR space — never from the head camera.
 *
 *  - `"desktop"` — mouse / pen / touchscreen ray from the camera (only path that uses `camera`).
 *  - `"ray"`     — far-field controller or hand laser (`targetRaySpace`, released on `selectend`).
 *  - `"grab"`    — near-field direct grab with the grip button (`gripSpace`, released on `squeezeend`).
 *  - `"touch"`   — hand index-finger poke (released on pointer-up).
 */
export type XrPointerKind = "desktop" | "ray" | "grab" | "touch";

export interface XrPointerBinding {
  readonly kind: XrPointerKind;
  readonly pointerId: number;
  readonly handedness: "left" | "right" | undefined;
  readonly inputSource: XRInputSource | null;
  /** `true` when the input source is an articulated hand (vs. a tracked controller). */
  readonly isHand: boolean;
  /** Distance from the pointer origin to the hit point at session start (meters). */
  readonly hitDistance: number;
  /** Optional explicit release event override (e.g. far-field ray drag initiated with controller grab/squeeze). */
  readonly releaseEvent?: "selectend" | "squeezeend" | undefined;
}

interface PointerStateLike {
  inputSource?: XRInputSource;
}

interface XrPointerEventLike {
  pointerId?: number;
  pointerType?: string;
  pointerState?: unknown;
  distance?: number;
  target?: unknown;
}

/** Resolves which input source (and interaction kind) produced a pointer event. */
export function resolveXrPointerBinding(event: unknown): XrPointerBinding {
  const e = (event ?? {}) as XrPointerEventLike;
  const pointerId = typeof e.pointerId === "number" ? e.pointerId : -1;
  const state = e.pointerState as PointerStateLike | undefined;
  const inputSource = state && typeof state === "object" && state.inputSource ? state.inputSource : null;
  const hitDistance = typeof e.distance === "number" && Number.isFinite(e.distance) ? e.distance : 0;

  if (!inputSource) {
    return { kind: "desktop", pointerId, handedness: undefined, inputSource: null, isHand: false, hitDistance };
  }

  const pt = (e.pointerType ?? "ray").toLowerCase();
  const kind: XrPointerKind = pt === "grab" ? "grab" : pt === "touch" ? "touch" : "ray";
  const handedness =
    inputSource.handedness === "left" || inputSource.handedness === "right" ? inputSource.handedness : undefined;
  return { kind, pointerId, handedness, inputSource, isHand: Boolean(inputSource.hand), hitDistance };
}

/** WebXR session event that ends a session bound to the given pointer kind (`null` = pointer-up only). */
export function releaseEventForBinding(binding: XrPointerBinding): "selectend" | "squeezeend" | null {
  if (binding.releaseEvent) return binding.releaseEvent;
  if (binding.kind === "desktop" || binding.kind === "touch") return null;
  // Controllers grab with squeeze; articulated hands grab and ray-select with a pinch (= select).
  if (binding.kind === "grab" && !binding.isHand) return "squeezeend";
  return "selectend";
}

/** Pulses the haptic actuator of the exact input source behind a pointer event (no-op on desktop). */
export function pulseEventHaptic(event: unknown, intensity = 0.08, durationMs = 6): void {
  const binding = resolveXrPointerBinding(event);
  const actuator = binding.inputSource?.gamepad?.hapticActuators?.[0] as
    { pulse?: (value: number, duration: number) => Promise<boolean> } | undefined;
  if (actuator && typeof actuator.pulse === "function") {
    void actuator.pulse(intensity, durationMs).catch(() => undefined);
  }
}

/** Best-effort pointer capture so move/up events keep flowing to the grabbed object. */
export function tryCapturePointer(event: unknown): void {
  const e = (event ?? {}) as XrPointerEventLike;
  const target = e.target as { setPointerCapture?: (id: number) => void } | null | undefined;
  if (target && typeof target.setPointerCapture === "function" && typeof e.pointerId === "number") {
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      /* capture is optional */
    }
  }
}

const originPosScratch = new THREE.Vector3();
const originQuatScratch = new THREE.Quaternion();
const originScaleScratch = new THREE.Vector3();
const FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * Samples a WebXR space pose for this frame and converts it from reference space
 * into three.js world space (applying the `XROrigin` transform used for locomotion).
 */
export function sampleXrSpaceWorldPose(
  frame: XRFrame | undefined,
  refSpace: XRReferenceSpace | null | undefined,
  origin: THREE.Object3D | null | undefined,
  space: XRSpace | undefined | null,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): boolean {
  if (!frame || !refSpace || !space || typeof frame.getPose !== "function") return false;
  let pose: XRPose | undefined;
  try {
    pose = frame.getPose(space, refSpace);
  } catch {
    return false;
  }
  if (!pose) return false;
  const p = pose.transform.position;
  const o = pose.transform.orientation;
  outPos.set(p.x, p.y, p.z);
  outQuat.set(o.x, o.y, o.z, o.w);
  if (origin) {
    origin.updateWorldMatrix(true, false);
    origin.matrixWorld.decompose(originPosScratch, originQuatScratch, originScaleScratch);
    outPos.multiply(originScaleScratch).applyQuaternion(originQuatScratch).add(originPosScratch);
    outQuat.premultiply(originQuatScratch);
  }
  return true;
}

/**
 * Samples the pose that a bound session should follow this frame:
 *  - `"ray"`  → controller / hand `targetRaySpace` (origin + quaternion; forward is local -Z)
 *  - `"grab"` → controller `gripSpace` (hands: index tip)
 */
export function sampleBindingPose(
  binding: XrPointerBinding,
  frame: XRFrame | undefined,
  refSpace: XRReferenceSpace | null | undefined,
  origin: THREE.Object3D | null | undefined,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): boolean {
  const src = binding.inputSource;
  if (!src) return false;
  let space: XRSpace | undefined;
  if (binding.kind === "grab" || binding.kind === "touch") {
    space = binding.isHand ? (src.hand?.get("index-finger-tip") ?? undefined) : (src.gripSpace ?? undefined);
  }
  space ??= src.targetRaySpace;
  return sampleXrSpaceWorldPose(frame, refSpace, origin, space, outPos, outQuat);
}

/** Point along a ray pose at `distance` meters (ray forward = local -Z). */
export function pointAlongRayPose(
  rayPos: THREE.Vector3,
  rayQuat: THREE.Quaternion,
  distance: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out.copy(FORWARD).applyQuaternion(rayQuat).multiplyScalar(distance).add(rayPos);
}

/** Reads the xr-standard thumbstick (`axes[2], axes[3]`, falling back to `axes[0], axes[1]`). */
export function readThumbstick(binding: XrPointerBinding | undefined): { x: number; y: number } {
  const axes = binding?.inputSource?.gamepad?.axes;
  if (!axes || axes.length === 0) return { x: 0, y: 0 };
  const x = axes.length >= 4 ? (axes[2] ?? 0) : (axes[0] ?? 0);
  const y = axes.length >= 4 ? (axes[3] ?? 0) : (axes[1] ?? 0);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/** Applies a radial dead-zone and re-normalizes so motion starts smoothly at the edge. */
export function applyStickDeadzone(value: number, deadzone = 0.18): number {
  const a = Math.abs(value);
  if (a <= deadzone) return 0;
  return (Math.sign(value) * (a - deadzone)) / (1 - deadzone);
}

/**
 * Critically-damped spring step (per axis) giving grabbed objects a sense of weight:
 * heavier objects (larger `halfLifeSec`) trail the hand slightly, light ones are crisp.
 * Mutates `pos` and `vel` in place.
 */
export function springFollowStep(
  pos: THREE.Vector3,
  vel: THREE.Vector3,
  target: THREE.Vector3,
  deltaSec: number,
  halfLifeSec = 0.035,
): void {
  if (!Number.isFinite(deltaSec) || deltaSec <= 0) return;
  // ω derived so the error halves every `halfLifeSec` (critically damped).
  const omega = (2 * Math.LN2) / Math.max(1e-4, halfLifeSec);
  const x = omega * deltaSec;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const cx = pos.x - target.x;
  const cy = pos.y - target.y;
  const cz = pos.z - target.z;
  const tx = (vel.x + omega * cx) * deltaSec;
  const ty = (vel.y + omega * cy) * deltaSec;
  const tz = (vel.z + omega * cz) * deltaSec;
  vel.set((vel.x - omega * tx) * exp, (vel.y - omega * ty) * exp, (vel.z - omega * tz) * exp);
  pos.set(target.x + (cx + tx) * exp, target.y + (cy + ty) * exp, target.z + (cz + tz) * exp);
}
