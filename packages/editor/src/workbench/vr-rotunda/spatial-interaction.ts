// SPDX-License-Identifier: AGPL-3.0-or-later

import * as THREE from "three";
import { DOMAIN_LAYER_Z_PLANES, type SpatialDiagramSnapMode, type SpatialNodePose3D } from "./spatial-diagram-state.js";

/**
 * Pure 6DOF Spatial Grab Math, Anti-Jitter Smoothing, Snap Constraints,
 * Soft Gravity-Leveling & Interaction Priority Arbitration.
 */

export type SpatialInteractionLock = "none" | "wire-drag" | "node-grab" | "palette-pull" | "stage-nav" | "panel-drag";

const LOCK_PRIORITY: Record<SpatialInteractionLock, number> = {
  none: 0,
  "stage-nav": 1,
  "panel-drag": 2,
  "node-grab": 3,
  "palette-pull": 4,
  "wire-drag": 5,
};

/** Returns true if a requested interaction lock can preempt the currently active lock. */
export function canAcquireInteractionLock(current: SpatialInteractionLock, requested: SpatialInteractionLock): boolean {
  if (requested === "none") return true;
  if (current === "none" || current === requested) return true;
  return LOCK_PRIORITY[requested] > LOCK_PRIORITY[current];
}

export interface GrabOffsetRigidTransform {
  readonly positionOffset: [number, number, number];
  readonly rotationOffset: [number, number, number, number];
}

/**
 * Computes the local rigid offset from a hand/controller pose to an object's pose at grab start,
 * preserving the exact contact point so grabbed components never snap awkwardly to palm center.
 */
export function computeGrabOffset(
  handPos: THREE.Vector3,
  handQuat: THREE.Quaternion,
  nodePos: THREE.Vector3,
  nodeQuat: THREE.Quaternion,
): GrabOffsetRigidTransform {
  const invHandQuat = handQuat.clone().invert();
  const relPos = nodePos.clone().sub(handPos).applyQuaternion(invHandQuat);
  const relQuat = invHandQuat.multiply(nodeQuat).normalize();
  return {
    positionOffset: [relPos.x, relPos.y, relPos.z],
    rotationOffset: [relQuat.x, relQuat.y, relQuat.z, relQuat.w],
  };
}

/** Applies a stored grab offset to the live hand/controller pose to obtain the raw target 6DOF pose. */
export function applyGrabOffset(
  handPos: THREE.Vector3,
  handQuat: THREE.Quaternion,
  offset: GrabOffsetRigidTransform,
  outPos: THREE.Vector3,
  outQuat: THREE.Quaternion,
): void {
  outPos
    .set(offset.positionOffset[0], offset.positionOffset[1], offset.positionOffset[2])
    .applyQuaternion(handQuat)
    .add(handPos);
  outQuat
    .set(offset.rotationOffset[0], offset.rotationOffset[1], offset.rotationOffset[2], offset.rotationOffset[3])
    .premultiply(handQuat)
    .normalize();
}

/**
 * Frame-rate-independent exponential smoothing factor `alpha ∈ [0, 1]`.
 * Eliminates bare-hand optical tracking micro-tremor while remaining crisp at 60–120 FPS.
 */
export function computeSmoothingAlpha(deltaSec: number, halfLifeSec = 0.02): number {
  if (!Number.isFinite(deltaSec) || deltaSec <= 0) return 0;
  if (!Number.isFinite(halfLifeSec) || halfLifeSec <= 1e-5) return 1;
  return 1 - Math.pow(0.5, deltaSec / halfLifeSec);
}

/**
 * Applies optional ergonomic spatial snap constraints (`free-3d`, `domain-layers`, `grid-5cm`, `flat-2d`)
 * and soft upright gravity-leveling to a candidate 3D component pose.
 */
export function applySpatialSnapConstraint(
  rawPosition: readonly [number, number, number],
  rawQuaternion: readonly [number, number, number, number],
  snapMode: SpatialDiagramSnapMode,
  preferredLayerIndex = 1,
  softLevelAssist = true,
): SpatialNodePose3D {
  let x = Number.isFinite(rawPosition[0]) ? rawPosition[0] : 0;
  let y = Number.isFinite(rawPosition[1]) ? rawPosition[1] : 0;
  let z = Number.isFinite(rawPosition[2]) ? rawPosition[2] : 0;
  let domainLayer: number | undefined = preferredLayerIndex;

  if (snapMode === "flat-2d") {
    z = 0;
  } else if (snapMode === "grid-5cm") {
    const step = 0.05;
    x = Math.round(x / step) * step;
    y = Math.round(y / step) * step;
    z = Math.round(z / step) * step;
  } else if (snapMode === "domain-layers") {
    // Snap Z to nearest semantic domain plane
    let nearest = DOMAIN_LAYER_Z_PLANES[1]!;
    let bestDist = Infinity;
    for (const plane of DOMAIN_LAYER_Z_PLANES) {
      const d = Math.abs(z - plane.zMeters);
      if (d < bestDist) {
        bestDist = d;
        nearest = plane;
      }
    }
    z = nearest.zMeters;
    domainLayer = nearest.index;
  }

  const q = new THREE.Quaternion(rawQuaternion[0], rawQuaternion[1], rawQuaternion[2], rawQuaternion[3]);
  if (q.lengthSq() < 1e-6) {
    q.identity();
  } else {
    q.normalize();
  }

  if (snapMode === "flat-2d") {
    // Restrict to crisp 90°/15° planar Z rotation so components stay flush with the 2D plane
    const euler = new THREE.Euler().setFromQuaternion(q, "YXZ");
    const snappedZ = Math.round(euler.z / (Math.PI / 12)) * (Math.PI / 12);
    q.setFromEuler(new THREE.Euler(0, 0, snappedZ, "YXZ"));
  } else if (softLevelAssist) {
    // Soft gravity-leveling: gently damp unintended pitch/roll < 20° while preserving intentional 3D tilts & 90° turns
    const euler = new THREE.Euler().setFromQuaternion(q, "YXZ");
    const levelThreshRad = (20 * Math.PI) / 180;
    const nextX = Math.abs(euler.x) < levelThreshRad ? euler.x * 0.25 : euler.x;
    const nextZ = Math.abs(euler.z) < levelThreshRad ? 0 : Math.round(euler.z / (Math.PI / 12)) * (Math.PI / 12);
    q.setFromEuler(new THREE.Euler(nextX, euler.y, nextZ, "YXZ"));
  }

  return {
    position: [normalizeZero(x), normalizeZero(y), normalizeZero(z)],
    quaternion: [normalizeZero(q.x), normalizeZero(q.y), normalizeZero(q.z), normalizeZero(q.w)],
    scale: 1,
    domainLayer,
  };
}

function normalizeZero(v: number): number {
  return Math.abs(v) < 1e-7 ? 0 : v;
}

/** Pure test helper checking whether a dropped component intersects the tactile Recycle Delete Ring. */
export function isInsideDeleteRing(
  nodeStagePos: readonly [number, number, number],
  ringStagePos: readonly [number, number, number],
  ringRadiusMeters = 0.115,
): boolean {
  const dist = Math.hypot(
    nodeStagePos[0] - ringStagePos[0],
    nodeStagePos[1] - ringStagePos[1],
    nodeStagePos[2] - ringStagePos[2],
  );
  return Number.isFinite(dist) && dist <= ringRadiusMeters;
}

export interface TossPredictionResult {
  readonly willHit: boolean;
  readonly impactTimeSec: number;
  readonly minDistance: number;
}

/**
 * Predicts whether a released component with stage-local velocity `vel` will arc into
 * the disposal bin (Job Simulator style "toss to delete"). Evaluates the parabolic trajectory
 * `p(t) = pos + vel * t + 0.5 * [0, gravity, 0] * t^2` over `[0, maxTimeSec]`.
 */
export function predictTossIntoRecycleBin(
  pos: readonly [number, number, number],
  vel: readonly [number, number, number],
  binPos: readonly [number, number, number],
  captureRadius = 0.18,
  minThrowSpeed = 0.55,
  gravity = -3.6,
  maxTimeSec = 0.85,
): TossPredictionResult {
  const speed = Math.hypot(vel[0], vel[1], vel[2]);
  if (!Number.isFinite(speed) || speed < minThrowSpeed) {
    return { willHit: false, impactTimeSec: 0, minDistance: Infinity };
  }

  let bestDist = Infinity;
  let bestT = 0;
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * maxTimeSec;
    const px = pos[0] + vel[0] * t;
    const py = pos[1] + vel[1] * t + 0.5 * gravity * t * t;
    const pz = pos[2] + vel[2] * t;
    const d = Math.hypot(px - binPos[0], py - binPos[1], pz - binPos[2]);
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
    if (d <= captureRadius) {
      return { willHit: true, impactTimeSec: t, minDistance: d };
    }
  }
  return { willHit: false, impactTimeSec: bestT, minDistance: bestDist };
}

/**
 * Detects an intentional brisk backward wrist flick ("Gravity Gloves" force-pull) along
 * a far-field ray pointer: returns true when the pointer pulls backward along `-rayDir`
 * faster than `speedThreshold` (default 1.35 m/s) while holding an object farther than `minDistance`.
 */
export function shouldTriggerForcePull(
  prevPointerPos: readonly [number, number, number],
  currPointerPos: readonly [number, number, number],
  rayForwardDir: readonly [number, number, number],
  deltaSec: number,
  currentDistance: number,
  speedThreshold = 1.35,
  minDistance = 0.36,
): boolean {
  if (!Number.isFinite(deltaSec) || deltaSec <= 1e-4 || currentDistance < minDistance) return false;
  const vx = (currPointerPos[0] - prevPointerPos[0]) / deltaSec;
  const vy = (currPointerPos[1] - prevPointerPos[1]) / deltaSec;
  const vz = (currPointerPos[2] - prevPointerPos[2]) / deltaSec;
  // Negative dot with forward means pulling BACK toward the user
  const pullSpeed = -(vx * rayForwardDir[0] + vy * rayForwardDir[1] + vz * rayForwardDir[2]);
  return Number.isFinite(pullSpeed) && pullSpeed >= speedThreshold;
}
