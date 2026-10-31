// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Vector3D } from "../types.js";
import { getWasmKinematicsBridge } from "./wasm-bridge.js";

export interface KinematicLoopConstraint {
  loopId: string;
  bodyIndices: string[];
  closureError: Vector3D;
  isClosed: boolean;
  adjustedPositions?: Map<string, Vector3D> | undefined;
}

/**
 * Pure TypeScript implementation of solveLoopClosureResidual.
 * Evaluates cut-joint and link-length closure residuals around the cycle and
 * iteratively adjusts dependent body coordinates to close the kinematic loop.
 */
export function pureTsSolveLoopClosureResidual(
  bodyPositions: Map<string, Vector3D>,
  chain: string[],
): KinematicLoopConstraint {
  const count = chain.length;
  const adjustedPositions = new Map<string, Vector3D>();
  for (const id of chain) {
    const pos = bodyPositions.get(id) ?? { x: 0, y: 0, z: 0 };
    adjustedPositions.set(id, { x: pos.x, y: pos.y, z: pos.z });
  }

  if (count <= 1) {
    return {
      loopId: `loop_${chain.join("_")}`,
      bodyIndices: chain,
      closureError: { x: 0, y: 0, z: 0 },
      isClosed: true,
      adjustedPositions,
    };
  }

  if (count === 2) {
    const b0 = bodyPositions.get(chain[0]!) ?? { x: 0, y: 0, z: 0 };
    const b1 = bodyPositions.get(chain[1]!) ?? { x: 0, y: 0, z: 0 };
    const rx = b1.x - b0.x;
    const ry = b1.y - b0.y;
    const rz = b1.z - b0.z;
    const errMag = Math.sqrt(rx * rx + ry * ry + rz * rz);
    adjustedPositions.set(chain[1]!, { x: b0.x, y: b0.y, z: b0.z });
    return {
      loopId: `loop_${chain.join("_")}`,
      bodyIndices: chain,
      closureError: { x: rx, y: ry, z: rz },
      isClosed: errMag < 1e-4,
      adjustedPositions,
    };
  }

  const pts: Vector3D[] = chain.map((id) => {
    const p = bodyPositions.get(id) ?? { x: 0, y: 0, z: 0 };
    return { x: p.x, y: p.y, z: p.z };
  });

  // Evaluate open-chain link lengths L_i = ||p_{i+1} - p_i|| for i = 0 .. n-2
  let sumLinkLen = 0;
  let refLen = 0;
  for (let i = 0; i < count - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    sumLinkLen += len;
    if (i === 0) refLen = len;
  }

  const meanOpenLen = sumLinkLen / (count - 1);
  const targetLen = refLen > 1e-12 ? refLen : meanOpenLen;

  // Evaluate cut-joint closing link vector from last body (n-1) back to first body (0)
  const pFirst = pts[0]!;
  const pLast = pts[count - 1]!;
  const closeDx = pFirst.x - pLast.x;
  const closeDy = pFirst.y - pLast.y;
  const closeDz = pFirst.z - pLast.z;
  const closeLen = Math.sqrt(closeDx * closeDx + closeDy * closeDy + closeDz * closeDz);

  let rx = 0;
  let ry = 0;
  let rz = 0;
  if (closeLen > 1e-12) {
    const scale = (closeLen - targetLen) / closeLen;
    rx = closeDx * scale;
    ry = closeDy * scale;
    rz = closeDz * scale;
  } else {
    rx = targetLen;
  }

  let lengthVarSq = 0;
  for (let i = 1; i < count - 1; i++) {
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const diff = len - targetLen;
    lengthVarSq += diff * diff;
    if (len > 1e-12 && Math.abs(diff) > 1e-9) {
      rx += (dx / len) * diff;
      ry += (dy / len) * diff;
      rz += (dz / len) * diff;
    }
  }

  const errMag = Math.sqrt(rx * rx + ry * ry + rz * rz + lengthVarSq);

  // Iteratively adjust dependent body coordinates (indices 2 .. count-1) to close the loop
  if (errMag >= 1e-8 && targetLen > 1e-12) {
    for (let iter = 0; iter < 30; iter++) {
      for (let i = 1; i < count - 1; i++) {
        const p1 = pts[i]!;
        const p2 = pts[i + 1]!;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dz = p2.z - p1.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 1e-12) {
          const s = targetLen / dist;
          p2.x = p1.x + dx * s;
          p2.y = p1.y + dy * s;
          p2.z = p1.z + dz * s;
        }
      }
      const p0 = pts[0]!;
      const pn = pts[count - 1]!;
      const bdx = pn.x - p0.x;
      const bdy = pn.y - p0.y;
      const bdz = pn.z - p0.z;
      const bdist = Math.sqrt(bdx * bdx + bdy * bdy + bdz * bdz);
      if (bdist > 1e-12) {
        const bs = targetLen / bdist;
        pn.x = p0.x + bdx * bs;
        pn.y = p0.y + bdy * bs;
        pn.z = p0.z + bdz * bs;
      }
      for (let i = count - 1; i > 2; i--) {
        const pc = pts[i]!;
        const pp = pts[i - 1]!;
        const dx = pp.x - pc.x;
        const dy = pp.y - pc.y;
        const dz = pp.z - pc.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > 1e-12) {
          const s = targetLen / dist;
          pp.x = pc.x + dx * s;
          pp.y = pc.y + dy * s;
          pp.z = pc.z + dz * s;
        }
      }
    }
  }

  for (let i = 0; i < count; i++) {
    adjustedPositions.set(chain[i]!, pts[i]!);
  }

  return {
    loopId: `loop_${chain.join("_")}`,
    bodyIndices: chain,
    closureError: { x: rx, y: ry, z: rz },
    isClosed: errMag < 1e-4,
    adjustedPositions,
  };
}

/**
 * Computes cut-joint closure equations for closed kinematic chains in spatial mechanisms.
 * Evaluates actual joint/link closure residuals around the cycle and iteratively adjusts
 * dependent body coordinates to close the loop.
 *
 * Accelerated via WebAssembly linear memory kernel with transparent TypeScript fallback.
 */
export function solveLoopClosureResidual(
  bodyPositions: Map<string, Vector3D>,
  chain: string[],
): KinematicLoopConstraint {
  try {
    return getWasmKinematicsBridge().solveLoopClosureResidual(bodyPositions, chain);
  } catch {
    return pureTsSolveLoopClosureResidual(bodyPositions, chain);
  }
}
