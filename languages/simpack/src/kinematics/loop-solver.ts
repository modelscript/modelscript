// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Vector3D } from "../types.js";
import { getWasmKinematicsBridge } from "./wasm-bridge.js";

export interface KinematicLoopConstraint {
  loopId: string;
  bodyIndices: string[];
  closureError: Vector3D;
  isClosed: boolean;
}

/**
 * Pure TypeScript implementation of solveLoopClosureResidual.
 */
export function pureTsSolveLoopClosureResidual(
  bodyPositions: Map<string, Vector3D>,
  chain: string[],
): KinematicLoopConstraint {
  let rx = 0;
  let ry = 0;
  let rz = 0;

  for (let i = 0; i < chain.length - 1; i++) {
    const b1 = bodyPositions.get(chain[i]!) ?? { x: 0, y: 0, z: 0 };
    const b2 = bodyPositions.get(chain[i + 1]!) ?? { x: 0, y: 0, z: 0 };
    rx += b2.x - b1.x;
    ry += b2.y - b1.y;
    rz += b2.z - b1.z;
  }

  // Complete loop back to start
  if (chain.length > 2) {
    const bLast = bodyPositions.get(chain[chain.length - 1]!) ?? { x: 0, y: 0, z: 0 };
    const bFirst = bodyPositions.get(chain[0]!) ?? { x: 0, y: 0, z: 0 };
    rx += bFirst.x - bLast.x;
    ry += bFirst.y - bLast.y;
    rz += bFirst.z - bLast.z;
  }

  const errMag = Math.sqrt(rx * rx + ry * ry + rz * rz);

  return {
    loopId: `loop_${chain.join("_")}`,
    bodyIndices: chain,
    closureError: { x: rx, y: ry, z: rz },
    isClosed: errMag < 1e-4,
  };
}

/**
 * Computes cut-joint closure equations for closed kinematic chains in spatial mechanisms.
 * For a closed loop \sum \mathbf{r}_i = \mathbf{0}, calculates displacement residual vector.
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
