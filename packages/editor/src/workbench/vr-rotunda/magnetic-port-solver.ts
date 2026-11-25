// SPDX-License-Identifier: AGPL-3.0-or-later

import { evaluateModelScriptPortCompatibility } from "@modelscript/diagram/protocol";
import * as THREE from "three";
import type { SpatialDiagramPort3D } from "./spatial-diagram-state.js";

/**
 * Pure 3D Magnetic Port Capture Solver, Canonical ModelScript Port-Compatibility Bridge,
 * and Infinite-Length 3D Cubic Bézier + Catenary Cable Geometry Evaluator.
 */

export interface WorldPortCandidate {
  readonly port: SpatialDiagramPort3D;
  /** World-space position of the port socket (meters). */
  readonly worldPosition: [number, number, number];
  /** World-space outward unit normal of the port socket. */
  readonly worldNormal: [number, number, number];
}

export interface PortCompatibilityResult {
  readonly compatible: boolean;
  readonly reason?: string | undefined;
}

export interface MagneticSnapEvaluation {
  /** Magnetically locked compatible target port (null if free-floating). */
  readonly snappedTarget: WorldPortCandidate | null;
  /** Nearest incompatible port within snap distance (triggers amber warning & rejection buzz). */
  readonly rejectedTarget: { readonly candidate: WorldPortCandidate; readonly reason: string } | null;
  /** Compatible candidate ports within the outer approach halo (`approachRadiusMeters`), sorted nearest-first. */
  readonly approachCandidates: readonly { readonly candidate: WorldPortCandidate; readonly proximity01: number }[];
  /** True on the rising edge when magnetic lock first engages. */
  readonly justSnapped: boolean;
  /** True on the rising edge when hovering an incompatible port inside snap well. */
  readonly justRejected: boolean;
}

export interface MagneticSolverOptions {
  /** Outer halo radius where compatible ports bloom & invite the user's hand (default: 0.20m). */
  approachRadiusMeters?: number | undefined;
  /** Inner magnetic snap engagement radius (default: 0.078m). */
  snapEngageMeters?: number | undefined;
  /** Hysteresis release radius to prevent snap chatter (default: 0.108m). */
  snapReleaseMeters?: number | undefined;
  /** Key of currently locked target (`"${nodeId}::${portId}"`) for Schmitt hysteresis. */
  currentlySnappedKey?: string | null | undefined;
  /** Key of previously rejected target for rising-edge haptic guard. */
  previouslyRejectedKey?: string | null | undefined;
  /** Existing undirected connections (`"nodeA::portA|nodeB::portB"`) to exclude duplicates. */
  existingConnectionKeys?: ReadonlySet<string> | undefined;
  /** Allow wiring two distinct ports on the same component (default: false). */
  allowSameNode?: boolean | undefined;
}

export function makePortKey(nodeId: string, portId: string): string {
  return `${nodeId}::${portId}`;
}

export function makeUndirectedConnectionKey(nodeA: string, portA: string, nodeB: string, portB: string): string {
  const kA = makePortKey(nodeA, portA);
  const kB = makePortKey(nodeB, portB);
  return kA < kB ? `${kA}|${kB}` : `${kB}|${kA}`;
}

/**
 * Evaluates plug compatibility between two 3D diagram ports by delegating directly
 * to ModelScript's canonical `@modelscript/diagram/protocol` port compatibility API
 * (`evaluateModelScriptPortCompatibility`), ensuring 100% parity between 2D Diagram
 * mode and VR 3D Diagram mode.
 */
export function evaluatePortCompatibility(
  source: Pick<SpatialDiagramPort3D, "nodeId" | "portId" | "domain" | "polarity"> & {
    readonly connectorType?: string | undefined;
    readonly isConjugated?: boolean | undefined;
  },
  target: Pick<SpatialDiagramPort3D, "nodeId" | "portId" | "domain" | "polarity"> & {
    readonly connectorType?: string | undefined;
    readonly isConjugated?: boolean | undefined;
  },
  allowSameNode = false,
  languageId?: string,
): PortCompatibilityResult {
  const result = evaluateModelScriptPortCompatibility(
    {
      nodeId: source.nodeId,
      portId: source.portId,
      domain: source.domain,
      direction: source.polarity,
      connectorType: source.connectorType,
      isConjugated: source.isConjugated,
    },
    {
      nodeId: target.nodeId,
      portId: target.portId,
      domain: target.domain,
      direction: target.polarity,
      connectorType: target.connectorType,
      isConjugated: target.isConjugated,
    },
    { allowSameNode, languageId },
  );
  return result.compatible ? { compatible: true } : { compatible: false, reason: result.reason };
}

/**
 * Two-zone magnetic proximity solver with Schmitt hysteresis:
 *  - Computes glowing approach halo intensities for compatible ports within `approachRadiusMeters`.
 *  - Captures the nearest compatible port inside `snapEngageMeters` (and holds lock until `snapReleaseMeters`).
 *  - Surfaces the nearest incompatible port inside the snap well for non-intrusive rejection feedback.
 */
export function evaluateMagneticPortSnap(
  sourcePort: SpatialDiagramPort3D,
  tipWorldPos: readonly [number, number, number],
  candidates: readonly WorldPortCandidate[],
  options: MagneticSolverOptions = {},
): MagneticSnapEvaluation {
  const approachR = options.approachRadiusMeters ?? 0.2;
  const engageR = options.snapEngageMeters ?? 0.078;
  const releaseR = Math.max(engageR, options.snapReleaseMeters ?? 0.108);
  const currentKey = options.currentlySnappedKey ?? null;
  const prevRejectedKey = options.previouslyRejectedKey ?? null;
  const existingConns = options.existingConnectionKeys;
  const allowSameNode = Boolean(options.allowSameNode);

  const approachCandidates: { candidate: WorldPortCandidate; proximity01: number; dist: number }[] = [];
  let bestCompatible: { candidate: WorldPortCandidate; dist: number } | null = null;
  let heldCurrent: { candidate: WorldPortCandidate; dist: number } | null = null;
  let bestIncompatible: { candidate: WorldPortCandidate; dist: number; reason: string } | null = null;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.port.nodeId === sourcePort.nodeId && c.port.portId === sourcePort.portId) continue;

    const dx = c.worldPosition[0] - tipWorldPos[0];
    const dy = c.worldPosition[1] - tipWorldPos[1];
    const dz = c.worldPosition[2] - tipWorldPos[2];
    const dist = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(dist) || dist > Math.max(approachR, releaseR)) continue;

    if (existingConns) {
      const connKey = makeUndirectedConnectionKey(sourcePort.nodeId, sourcePort.portId, c.port.nodeId, c.port.portId);
      if (existingConns.has(connKey)) continue;
    }

    const compat = evaluatePortCompatibility(sourcePort, c.port, allowSameNode);
    const key = makePortKey(c.port.nodeId, c.port.portId);

    if (compat.compatible) {
      if (dist <= approachR) {
        const proximity01 = Math.max(0, Math.min(1, 1 - dist / approachR));
        approachCandidates.push({ candidate: c, proximity01, dist });
      }
      if (currentKey && key === currentKey && dist <= releaseR) {
        heldCurrent = { candidate: c, dist };
      }
      if (dist <= engageR && (!bestCompatible || dist < bestCompatible.dist)) {
        bestCompatible = { candidate: c, dist };
      }
    } else if (c.port.nodeId !== sourcePort.nodeId && dist <= engageR) {
      if (!bestIncompatible || dist < bestIncompatible.dist) {
        bestIncompatible = {
          candidate: c,
          dist,
          reason: compat.reason ?? "Incompatible ports",
        };
      }
    }
  }

  approachCandidates.sort((a, b) => a.dist - b.dist);

  // Schmitt hysteresis: prefer newly closer compatible target if inside engageR, otherwise hold current lock up to releaseR
  const snappedTarget = bestCompatible
    ? heldCurrent && heldCurrent.dist <= bestCompatible.dist + 0.015
      ? heldCurrent.candidate
      : bestCompatible.candidate
    : (heldCurrent?.candidate ?? null);

  const snappedKey = snappedTarget ? makePortKey(snappedTarget.port.nodeId, snappedTarget.port.portId) : null;
  const rejectedTarget =
    !snappedTarget && bestIncompatible
      ? { candidate: bestIncompatible.candidate, reason: bestIncompatible.reason }
      : null;
  const rejectedKey = rejectedTarget
    ? makePortKey(rejectedTarget.candidate.port.nodeId, rejectedTarget.candidate.port.portId)
    : null;

  return {
    snappedTarget,
    rejectedTarget,
    approachCandidates: approachCandidates.map(({ candidate, proximity01 }) => ({ candidate, proximity01 })),
    justSnapped: Boolean(snappedKey && snappedKey !== currentKey),
    justRejected: Boolean(rejectedKey && rejectedKey !== prevRejectedKey),
  };
}

/* -------------------------------------------------------------------------- */
/*  Infinite-Length 3D Cubic Bézier + Catenary Cable Spline & Zero-Alloc Tube */
/* -------------------------------------------------------------------------- */

export interface WireSplineControlPoints {
  readonly p0: [number, number, number];
  readonly p1: [number, number, number];
  readonly p2: [number, number, number];
  readonly p3: [number, number, number];
  readonly chordLength: number;
}

/**
 * Computes tangent-aligned 3D cubic Bézier control points for an arbitrary-length wire
 * (works cleanly from 2 cm adjacent pins up to 15+ meter cross-room cables) with subtle
 * natural instrumentation-lead gravity sag.
 */
export function computeInfiniteWireControlPoints(
  startPos: readonly [number, number, number],
  startNormal: readonly [number, number, number],
  endPos: readonly [number, number, number],
  endNormal?: readonly [number, number, number] | null,
  sagScale = 1.0,
): WireSplineControlPoints {
  const dx = endPos[0] - startPos[0];
  const dy = endPos[1] - startPos[1];
  const dz = endPos[2] - startPos[2];
  const chordLength = Math.hypot(dx, dy, dz);

  const handleLen = Math.min(0.58, Math.max(0.036, chordLength * 0.34));
  const sag = Math.min(0.085, chordLength * 0.065) * sagScale;

  // Normalize start normal safely
  const snLen = Math.hypot(startNormal[0], startNormal[1], startNormal[2]);
  const snx = snLen > 1e-5 ? startNormal[0] / snLen : 1;
  const sny = snLen > 1e-5 ? startNormal[1] / snLen : 0;
  const snz = snLen > 1e-5 ? startNormal[2] / snLen : 0;

  let enx: number;
  let eny: number;
  let enz: number;
  if (endNormal) {
    const enLen = Math.hypot(endNormal[0], endNormal[1], endNormal[2]);
    enx = enLen > 1e-5 ? endNormal[0] / enLen : -snx;
    eny = enLen > 1e-5 ? endNormal[1] / enLen : -sny;
    enz = enLen > 1e-5 ? endNormal[2] / enLen : -snz;
  } else {
    // Free-hand dragging tip: aim incoming handle gently back toward start with slight downward drape
    const inv = chordLength > 1e-5 ? 1 / chordLength : 0;
    enx = -dx * inv;
    eny = -dy * inv;
    enz = -dz * inv;
  }

  return {
    p0: [startPos[0], startPos[1], startPos[2]],
    p1: [startPos[0] + snx * handleLen, startPos[1] + sny * handleLen - sag * 0.45, startPos[2] + snz * handleLen],
    p2: [endPos[0] + enx * handleLen, endPos[1] + eny * handleLen - sag * 0.45, endPos[2] + enz * handleLen],
    p3: [endPos[0], endPos[1], endPos[2]],
    chordLength,
  };
}

/** Evaluates a cubic Bézier point + unnormalized tangent at `t ∈ [0, 1]` with zero allocations. */
export function sampleWireSplineAt(
  ctrl: WireSplineControlPoints,
  t: number,
  outPos: THREE.Vector3,
  outTan?: THREE.Vector3,
): void {
  const u = 1 - t;
  const u2 = u * u;
  const u3 = u2 * u;
  const t2 = t * t;
  const t3 = t2 * t;

  const b0 = u3;
  const b1 = 3 * u2 * t;
  const b2 = 3 * u * t2;
  const b3 = t3;

  outPos.set(
    b0 * ctrl.p0[0] + b1 * ctrl.p1[0] + b2 * ctrl.p2[0] + b3 * ctrl.p3[0],
    b0 * ctrl.p0[1] + b1 * ctrl.p1[1] + b2 * ctrl.p2[1] + b3 * ctrl.p3[1],
    b0 * ctrl.p0[2] + b1 * ctrl.p1[2] + b2 * ctrl.p2[2] + b3 * ctrl.p3[2],
  );

  if (outTan) {
    const d0 = 3 * u2;
    const d1 = 6 * u * t;
    const d2 = 3 * t2;
    outTan.set(
      d0 * (ctrl.p1[0] - ctrl.p0[0]) + d1 * (ctrl.p2[0] - ctrl.p1[0]) + d2 * (ctrl.p3[0] - ctrl.p2[0]),
      d0 * (ctrl.p1[1] - ctrl.p0[1]) + d1 * (ctrl.p2[1] - ctrl.p1[1]) + d2 * (ctrl.p3[1] - ctrl.p2[1]),
      d0 * (ctrl.p1[2] - ctrl.p0[2]) + d1 * (ctrl.p2[2] - ctrl.p1[2]) + d2 * (ctrl.p3[2] - ctrl.p2[2]),
    );
    if (outTan.lengthSq() > 1e-10) {
      outTan.normalize();
    } else {
      outTan.set(1, 0, 0);
    }
  }
}

export interface DynamicWireTubeBuffer {
  readonly geometry: THREE.BufferGeometry;
  readonly tubularSegments: number;
  readonly radialSegments: number;
  update(ctrl: WireSplineControlPoints, radius: number): void;
  /** Deforms the tube along a flat XYZ polyline (e.g. a Verlet rope buffer) with zero allocations. */
  updateFromPolyline(points: Float32Array, pointCount: number, radius: number): void;
  dispose(): void;
}

/**
 * Creates a reusable, zero-per-frame-allocation dynamic 3D tubular cable `BufferGeometry`
 * using Parallel Transport (Bishop) frames so infinite-extending wires update smoothly at
 * 90 FPS in stereo WebXR without ever triggering garbage collection or Frenet twist flips.
 */
export function createDynamicWireTubeBuffer(tubularSegments = 28, radialSegments = 8): DynamicWireTubeBuffer {
  const ringVerts = radialSegments + 1;
  const totalVerts = (tubularSegments + 1) * ringVerts;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  const indices: number[] = [];
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      const c = (i + 1) * ringVerts + (j + 1);
      const d = i * ringVerts + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const normAttr = new THREE.BufferAttribute(normals, 3);
  normAttr.setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(uvs, 2);

  // Pre-fill static UVs once
  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const idx = (i * ringVerts + j) * 2;
      uvs[idx] = u;
      uvs[idx + 1] = v;
    }
  }

  geometry.setAttribute("position", posAttr);
  geometry.setAttribute("normal", normAttr);
  geometry.setAttribute("uv", uvAttr);
  geometry.setIndex(indices);

  // Pre-allocated scratch vectors (zero allocations inside update!)
  const pt = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const prevTan = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const rotAxis = new THREE.Vector3();
  const rotQuat = new THREE.Quaternion();
  const cosTable = new Float32Array(ringVerts);
  const sinTable = new Float32Array(ringVerts);
  for (let j = 0; j <= radialSegments; j++) {
    const angle = (j / radialSegments) * Math.PI * 2;
    cosTable[j] = Math.cos(angle);
    sinTable[j] = Math.sin(angle);
  }

  const writeRing = (i: number, r: number) => {
    if (i === 0) {
      // Pick an initial perpendicular normal safely away from tangent
      if (Math.abs(tan.y) < 0.9) {
        normal.set(0, 1, 0).cross(tan).normalize();
      } else {
        normal.set(1, 0, 0).cross(tan).normalize();
      }
      binormal.crossVectors(tan, normal).normalize();
    } else {
      // Parallel transport (minimum-twist rotation from prevTan -> tan)
      rotAxis.crossVectors(prevTan, tan);
      const axisLen = rotAxis.length();
      if (axisLen > 1e-5) {
        rotAxis.divideScalar(axisLen);
        const dot = Math.max(-1, Math.min(1, prevTan.dot(tan)));
        rotQuat.setFromAxisAngle(rotAxis, Math.acos(dot));
        normal.applyQuaternion(rotQuat).normalize();
      }
      binormal.crossVectors(tan, normal).normalize();
      normal.crossVectors(binormal, tan).normalize();
    }
    prevTan.copy(tan);

    for (let j = 0; j <= radialSegments; j++) {
      const c = cosTable[j]!;
      const s = sinTable[j]!;
      const nx = normal.x * c + binormal.x * s;
      const ny = normal.y * c + binormal.y * s;
      const nz = normal.z * c + binormal.z * s;

      const vIdx = (i * ringVerts + j) * 3;
      positions[vIdx] = pt.x + nx * r;
      positions[vIdx + 1] = pt.y + ny * r;
      positions[vIdx + 2] = pt.z + nz * r;
      normals[vIdx] = nx;
      normals[vIdx + 1] = ny;
      normals[vIdx + 2] = nz;
    }
  };

  return {
    geometry,
    tubularSegments,
    radialSegments,
    update(ctrl: WireSplineControlPoints, radius: number) {
      const r = Math.max(0.001, radius);
      for (let i = 0; i <= tubularSegments; i++) {
        const t = i / tubularSegments;
        sampleWireSplineAt(ctrl, t, pt, tan);
        writeRing(i, r);
      }
      posAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
      geometry.computeBoundingSphere();
    },
    updateFromPolyline(points: Float32Array, pointCount: number, radius: number) {
      if (pointCount < 2 || points.length < pointCount * 3) return;
      const r = Math.max(0.001, radius);
      const maxIdx = pointCount - 1;
      const exactMatch = pointCount === tubularSegments + 1;

      for (let i = 0; i <= tubularSegments; i++) {
        if (exactMatch) {
          const idx = i * 3;
          pt.set(points[idx]!, points[idx + 1]!, points[idx + 2]!);
          const prevI = Math.max(0, i - 1) * 3;
          const nextI = Math.min(maxIdx, i + 1) * 3;
          tan.set(
            points[nextI]! - points[prevI]!,
            points[nextI + 1]! - points[prevI + 1]!,
            points[nextI + 2]! - points[prevI + 2]!,
          );
        } else {
          const f = (i / tubularSegments) * maxIdx;
          const k0 = Math.floor(f);
          const k1 = Math.min(maxIdx, k0 + 1);
          const frac = f - k0;
          const a = k0 * 3;
          const b = k1 * 3;
          pt.set(
            points[a]! + (points[b]! - points[a]!) * frac,
            points[a + 1]! + (points[b + 1]! - points[a + 1]!) * frac,
            points[a + 2]! + (points[b + 2]! - points[a + 2]!) * frac,
          );
          const pA = Math.max(0, k0 - (k0 === k1 ? 1 : 0)) * 3;
          const pB = Math.min(maxIdx, k1 + (k0 === k1 ? 0 : 0)) * 3;
          tan.set(points[pB]! - points[pA]!, points[pB + 1]! - points[pA + 1]!, points[pB + 2]! - points[pA + 2]!);
        }
        if (tan.lengthSq() > 1e-10) {
          tan.normalize();
        } else if (i > 0) {
          tan.copy(prevTan);
        } else {
          tan.set(1, 0, 0);
        }
        writeRing(i, r);
      }

      posAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
      geometry.computeBoundingSphere();
    },
    dispose() {
      geometry.dispose();
    },
  };
}
