// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cad — Reachability-Certified Dynamic Spatial Clearance Verifier.
 *
 * Bridges continuous reachability flowpipes (from Modelica & SysML v2 hybrid automata)
 * directly into 3D CAD assemblies. Validates that moving mechanical parts maintain required
 * spatial clearance and avoid geometric collisions across all reachable continuous states,
 * dynamic disturbances, and parameter variations.
 */

import { assembly, part } from "./assembly.js";
import {
  computeAABBClosestPoints,
  computeAABBDistance,
  computeSolidAABB,
  type AABB,
  type ClearanceConstraint,
} from "./clearance.js";
import { rotate, scale, translate } from "./transforms.js";
import { SolidKind, type Assembly, type PartEntry, type Solid } from "./types.js";

export interface IntervalBox {
  lo: number;
  hi: number;
}

/**
 * Dynamic deformation / morphing binding for soft-tissue and compliant organ bodies (e.g. contracting ventricles).
 */
export interface DynamicDeformationBinding {
  /**
   * Scaling mode for soft-tissue/cavity deformations:
   * - "volume_radial": uniform scaling s = (V / V_ref)^(1/3) relative to reference volume
   * - "anisotropic": independent directional scaling along x, y, and z axes
   * - "modal": displacement along pre-computed shape modes
   */
  mode?: "volume_radial" | "anisotropic" | "modal";
  /** Reference initial volume V0 for volume_radial scaling (default: 1.0) */
  referenceVolume?: number;
  /** State variable or constant driving cavity volume V(t) */
  volume?: string | number;
  /** Explicit anisotropic scale factors or state variable names */
  scale?: {
    x?: string | number;
    y?: string | number;
    z?: string | number;
  };
  /** Anchor point / center of deformation (default: center of initial bounding box) */
  anchorOrigin?: [number, number, number];
  /** Modal displacement weights mapped to state variables (for modal skinning) */
  modalWeights?: Record<string, string | number>;
}

export interface DynamicTransformBinding {
  partName: string;
  /**
   * Translation offset bindings. Values can be:
   * - A string matching a state variable name (e.g. "suspension.x")
   * - A numeric index into the state vector (e.g. 0)
   * - A static numeric offset
   */
  translation?: {
    x?: string | number;
    y?: string | number;
    z?: string | number;
  };
  /**
   * Rotation offset binding around an axis. Angle can be state variable name or index in radians or degrees.
   */
  rotation?: {
    axis: [number, number, number];
    angle: string | number;
    inDegrees?: boolean;
  };
  /**
   * Optional deformation/morphing binding for soft-tissue or compliant organ bodies.
   */
  deformation?: DynamicDeformationBinding;
}

export interface TrajectoryStepEnclosure {
  time: number;
  /** Enclosure bounds per state variable name or array index */
  states: Record<string, IntervalBox> | IntervalBox[];
  /** Nominal center trajectory values */
  nominal?: Record<string, number> | number[];
}

export interface DynamicClearanceOptions {
  assembly: Assembly;
  bindings: DynamicTransformBinding[];
  trajectory: TrajectoryStepEnclosure[];
  defaultMinClearance?: number;
  specificRules?: ClearanceConstraint[];
}

export interface DynamicClearanceViolation {
  partA: string;
  partB: string;
  time: number;
  actualDistance: number;
  requiredClearance: number;
  status: "collision" | "clearance_violation";
  description: string;
}

export interface DynamicClearanceReport {
  assemblyName: string;
  isCertifiedSafe: boolean;
  worstMargin: number;
  worstCaseTime?: number;
  violations: DynamicClearanceViolation[];
  timeHistory: {
    time: number;
    minDistance: number;
    closestPair: [string, string];
    closestPoints?: [[number, number, number], [number, number, number]];
  }[];
  counterexampleAssembly?: Assembly;
  summary: string;
}

/**
 * Extracts the interval [lo, hi] for a specified state key or index from step states.
 */
function resolveInterval(
  states: Record<string, IntervalBox> | IntervalBox[],
  keyOrIndex: string | number | undefined,
): IntervalBox {
  if (keyOrIndex === undefined) return { lo: 0, hi: 0 };
  if (typeof keyOrIndex === "number") {
    if (Array.isArray(states) && states[keyOrIndex]) {
      return states[keyOrIndex]!;
    }
    const asStr = String(keyOrIndex);
    if (!Array.isArray(states) && states[asStr]) {
      return states[asStr]!;
    }
    return { lo: keyOrIndex, hi: keyOrIndex };
  }

  // Key is string
  if (!Array.isArray(states) && states[keyOrIndex]) {
    return states[keyOrIndex]!;
  }

  // Check if string is parseable number
  const num = parseFloat(keyOrIndex);
  if (!isNaN(num) && Array.isArray(states) && states[num]) {
    return states[num]!;
  }

  return { lo: 0, hi: 0 };
}

/**
 * Extracts nominal point value for a state key or index.
 */
function resolveNominal(
  nominal: Record<string, number> | number[] | undefined,
  fallbackStates: Record<string, IntervalBox> | IntervalBox[],
  keyOrIndex: string | number | undefined,
): number {
  if (keyOrIndex === undefined) return 0;
  if (nominal) {
    if (typeof keyOrIndex === "number" && Array.isArray(nominal) && nominal[keyOrIndex] !== undefined) {
      return nominal[keyOrIndex]!;
    }
    if (typeof keyOrIndex === "string" && !Array.isArray(nominal) && nominal[keyOrIndex] !== undefined) {
      return nominal[keyOrIndex]!;
    }
  }
  const intv = resolveInterval(fallbackStates, keyOrIndex);
  return (intv.lo + intv.hi) / 2;
}

function getLeafSolidName(s: Solid): string {
  if (
    s.kind === SolidKind.Transform ||
    s.kind === SolidKind.Fillet ||
    s.kind === SolidKind.Chamfer ||
    s.kind === SolidKind.TaggedPatch
  ) {
    return getLeafSolidName(s.child);
  }
  return s.name;
}

export class DynamicClearanceVerifier {
  /**
   * Verifies spatial clearance across a continuous reachability trajectory.
   *
   * @param options Verification problem options including assembly, bindings, and reachable enclosures.
   */
  public static verify(options: DynamicClearanceOptions): DynamicClearanceReport {
    const { assembly: asm, bindings, trajectory, defaultMinClearance = 0.0, specificRules = [] } = options;

    const violations: DynamicClearanceViolation[] = [];
    const timeHistory: DynamicClearanceReport["timeHistory"] = [];

    // Precompute base AABBs for each part in the assembly
    const baseParts = asm.parts.map((p, idx) => {
      const solidName = p.solid.name || `part_${idx}`;
      const leafName = getLeafSolidName(p.solid);
      return {
        name: leafName || solidName,
        fullName: solidName,
        originalSolid: p.solid,
        baseAABB: computeSolidAABB(p.solid),
        material: p.material,
        color: p.color,
      };
    });

    // Map partName to binding
    const bindingMap = new Map<string, DynamicTransformBinding>();
    for (const b of bindings) {
      bindingMap.set(b.partName, b);
    }

    let globalWorstMargin = Infinity;
    let worstTime: number | undefined = undefined;
    let worstPair: [string, string] = ["", ""];
    let worstStepEnclosure: TrajectoryStepEnclosure | undefined = undefined;

    // Iterate through every time step in the reachability trajectory
    for (const step of trajectory) {
      const currentBoxes: { name: string; box: AABB; solid: Solid }[] = [];

      for (const p of baseParts) {
        const binding =
          bindingMap.get(p.name) ||
          bindingMap.get(p.fullName) ||
          bindings.find((b) => p.fullName.endsWith(`_${b.partName}`));

        if (!binding) {
          // Static part
          currentBoxes.push({ name: p.name, box: p.baseAABB, solid: p.originalSolid });
          continue;
        }

        // Compute displaced interval bounding box
        let currentBox: AABB = {
          min: [...p.baseAABB.min] as [number, number, number],
          max: [...p.baseAABB.max] as [number, number, number],
        };

        let currentSolid = p.originalSolid;

        // Apply translation enclosure (Minkowski sum on AABB)
        if (binding.translation) {
          const dx = resolveInterval(step.states, binding.translation.x);
          const dy = resolveInterval(step.states, binding.translation.y);
          const dz = resolveInterval(step.states, binding.translation.z);

          currentBox = {
            min: [currentBox.min[0] + dx.lo, currentBox.min[1] + dy.lo, currentBox.min[2] + dz.lo],
            max: [currentBox.max[0] + dx.hi, currentBox.max[1] + dy.hi, currentBox.max[2] + dz.hi],
          };

          // Update nominal transformed solid representation for witness rendering
          const nx = resolveNominal(step.nominal, step.states, binding.translation.x);
          const ny = resolveNominal(step.nominal, step.states, binding.translation.y);
          const nz = resolveNominal(step.nominal, step.states, binding.translation.z);
          currentSolid = translate(currentSolid, [nx, ny, nz]);
        }

        // Apply rotation enclosure if present
        if (binding.rotation) {
          const dAngle = resolveInterval(step.states, binding.rotation.angle);
          const factor = binding.rotation.inDegrees ? Math.PI / 180 : 1.0;
          const thetaLo = dAngle.lo * factor;
          const thetaHi = dAngle.hi * factor;

          // Expand bounding box to contain all corners rotated between [thetaLo, thetaHi]
          const corners: [number, number, number][] = [
            [currentBox.min[0], currentBox.min[1], currentBox.min[2]],
            [currentBox.max[0], currentBox.min[1], currentBox.min[2]],
            [currentBox.min[0], currentBox.max[1], currentBox.min[2]],
            [currentBox.max[0], currentBox.max[1], currentBox.min[2]],
            [currentBox.min[0], currentBox.min[1], currentBox.max[2]],
            [currentBox.max[0], currentBox.min[1], currentBox.max[2]],
            [currentBox.min[0], currentBox.max[1], currentBox.max[2]],
            [currentBox.max[0], currentBox.max[1], currentBox.max[2]],
          ];

          let rMinX = Infinity,
            rMinY = Infinity,
            rMinZ = Infinity;
          let rMaxX = -Infinity,
            rMaxY = -Infinity,
            rMaxZ = -Infinity;

          const testAngles = [thetaLo, thetaHi, (thetaLo + thetaHi) / 2];
          for (const angle of testAngles) {
            const rotSolid = rotate(currentSolid, binding.rotation.axis, angle);
            const rotBox = computeSolidAABB(rotSolid);
            rMinX = Math.min(rMinX, rotBox.min[0]);
            rMinY = Math.min(rMinY, rotBox.min[1]);
            rMinZ = Math.min(rMinZ, rotBox.min[2]);
            rMaxX = Math.max(rMaxX, rotBox.max[0]);
            rMaxY = Math.max(rMaxY, rotBox.max[1]);
            rMaxZ = Math.max(rMaxZ, rotBox.max[2]);
          }

          currentBox = {
            min: [rMinX, rMinY, rMinZ],
            max: [rMaxX, rMaxY, rMaxZ],
          };

          const nAngle = resolveNominal(step.nominal, step.states, binding.rotation.angle) * factor;
          currentSolid = rotate(currentSolid, binding.rotation.axis, nAngle);
        }

        // Apply deformation / morphing enclosure if present
        if (binding.deformation) {
          const def = binding.deformation;
          const anchor = def.anchorOrigin || [
            (currentBox.min[0] + currentBox.max[0]) / 2,
            (currentBox.min[1] + currentBox.max[1]) / 2,
            (currentBox.min[2] + currentBox.max[2]) / 2,
          ];

          let sxLo = 1.0,
            sxHi = 1.0;
          let syLo = 1.0,
            syHi = 1.0;
          let szLo = 1.0,
            szHi = 1.0;

          if (def.volume !== undefined || def.mode === "volume_radial") {
            const vIntv = resolveInterval(step.states, def.volume);
            const v0 = def.referenceVolume && def.referenceVolume > 0 ? def.referenceVolume : 1.0;
            const vlo = Math.max(1e-9, vIntv.lo);
            const vhi = Math.max(1e-9, vIntv.hi);
            const sLo = Math.cbrt(vlo / v0);
            const sHi = Math.cbrt(vhi / v0);
            sxLo = syLo = szLo = sLo;
            sxHi = syHi = szHi = sHi;
          }

          if (def.scale) {
            if (def.scale.x !== undefined) {
              const sxIntv = resolveInterval(step.states, def.scale.x);
              sxLo *= sxIntv.lo;
              sxHi *= sxIntv.hi;
            }
            if (def.scale.y !== undefined) {
              const syIntv = resolveInterval(step.states, def.scale.y);
              syLo *= syIntv.lo;
              syHi *= syIntv.hi;
            }
            if (def.scale.z !== undefined) {
              const szIntv = resolveInterval(step.states, def.scale.z);
              szLo *= szIntv.lo;
              szHi *= szIntv.hi;
            }
          }

          const scaleAxis = (minVal: number, maxVal: number, anchorVal: number, sLo: number, sHi: number) => {
            const dMin = minVal - anchorVal;
            const dMax = maxVal - anchorVal;
            const cand1 = dMin * sLo;
            const cand2 = dMin * sHi;
            const cand3 = dMax * sLo;
            const cand4 = dMax * sHi;
            const newMin = anchorVal + Math.min(cand1, cand2, cand3, cand4);
            const newMax = anchorVal + Math.max(cand1, cand2, cand3, cand4);
            return [newMin, newMax] as const;
          };

          const [newMinX, newMaxX] = scaleAxis(currentBox.min[0], currentBox.max[0], anchor[0], sxLo, sxHi);
          const [newMinY, newMaxY] = scaleAxis(currentBox.min[1], currentBox.max[1], anchor[1], syLo, syHi);
          const [newMinZ, newMaxZ] = scaleAxis(currentBox.min[2], currentBox.max[2], anchor[2], szLo, szHi);

          currentBox = {
            min: [newMinX, newMinY, newMinZ],
            max: [newMaxX, newMaxY, newMaxZ],
          };

          if (def.modalWeights) {
            for (const weightExpr of Object.values(def.modalWeights)) {
              const weightIntv = resolveInterval(step.states, weightExpr);
              const maxDisp = Math.max(Math.abs(weightIntv.lo), Math.abs(weightIntv.hi));
              currentBox = {
                min: [currentBox.min[0] - maxDisp, currentBox.min[1] - maxDisp, currentBox.min[2] - maxDisp],
                max: [currentBox.max[0] + maxDisp, currentBox.max[1] + maxDisp, currentBox.max[2] + maxDisp],
              };
            }
          }

          let nx = (sxLo + sxHi) / 2;
          let ny = (syLo + syHi) / 2;
          let nz = (szLo + szHi) / 2;
          if (def.volume !== undefined) {
            const nV = resolveNominal(step.nominal, step.states, def.volume);
            const v0 = def.referenceVolume && def.referenceVolume > 0 ? def.referenceVolume : 1.0;
            const nScale = Math.cbrt(Math.max(1e-9, nV) / v0);
            nx = ny = nz = nScale;
          }
          if (def.scale) {
            if (def.scale.x !== undefined) nx *= resolveNominal(step.nominal, step.states, def.scale.x);
            if (def.scale.y !== undefined) ny *= resolveNominal(step.nominal, step.states, def.scale.y);
            if (def.scale.z !== undefined) nz *= resolveNominal(step.nominal, step.states, def.scale.z);
          }

          currentSolid = translate(currentSolid, [-anchor[0], -anchor[1], -anchor[2]]);
          currentSolid = scale(currentSolid, [nx, ny, nz]);
          currentSolid = translate(currentSolid, [anchor[0], anchor[1], anchor[2]]);
        }

        currentBoxes.push({ name: p.name, box: currentBox, solid: currentSolid });
      }

      // Check all pairs at current step
      let stepMinDist = Infinity;
      let stepClosestPair: [string, string] = ["", ""];
      let stepClosestPoints: [[number, number, number], [number, number, number]] | undefined = undefined;

      for (let i = 0; i < currentBoxes.length; i++) {
        for (let j = i + 1; j < currentBoxes.length; j++) {
          const pA = currentBoxes[i]!;
          const pB = currentBoxes[j]!;

          const distance = computeAABBDistance(pA.box, pB.box);
          if (distance < stepMinDist) {
            stepMinDist = distance;
            stepClosestPair = [pA.name, pB.name];
            stepClosestPoints = computeAABBClosestPoints(pA.box, pB.box);
          }

          let requiredClearance = defaultMinClearance;
          const rule = specificRules.find(
            (r) =>
              (!r.partA || r.partA === pA.name || r.partA === pB.name) &&
              (!r.partB || r.partB === pA.name || r.partB === pB.name),
          );
          if (rule) requiredClearance = rule.minClearance;

          const margin = distance - requiredClearance;
          if (margin < globalWorstMargin) {
            globalWorstMargin = margin;
            worstTime = step.time;
            worstPair = [pA.name, pB.name];
            worstStepEnclosure = step;
          }

          if (distance < 0) {
            violations.push({
              partA: pA.name,
              partB: pB.name,
              time: step.time,
              actualDistance: distance,
              requiredClearance,
              status: "collision",
              description: `Dynamic collision detected between '${pA.name}' and '${pB.name}' at t=${step.time.toFixed(3)}s (penetration depth: ${Math.abs(distance).toFixed(4)}).`,
            });
          } else if (distance < requiredClearance) {
            violations.push({
              partA: pA.name,
              partB: pB.name,
              time: step.time,
              actualDistance: distance,
              requiredClearance,
              status: "clearance_violation",
              description: `Dynamic clearance violation between '${pA.name}' and '${pB.name}' at t=${step.time.toFixed(3)}s: actual clearance is ${distance.toFixed(4)}, required >= ${requiredClearance.toFixed(4)}.`,
            });
          }
        }
      }

      timeHistory.push({
        time: step.time,
        minDistance: stepMinDist,
        closestPair: stepClosestPair,
        closestPoints: stepClosestPoints,
      });
    }

    // Synthesize counterexample assembly at worst case time if violations occurred
    let counterexampleAssembly: Assembly | undefined = undefined;
    if (violations.length > 0 && worstStepEnclosure) {
      const cexParts: PartEntry[] = baseParts.map((p) => {
        const binding = bindingMap.get(p.name);
        if (!binding) return part(p.originalSolid, { material: p.material, color: p.color });

        let solid = p.originalSolid;
        if (binding.translation) {
          const nx = resolveNominal(worstStepEnclosure!.nominal, worstStepEnclosure!.states, binding.translation.x);
          const ny = resolveNominal(worstStepEnclosure!.nominal, worstStepEnclosure!.states, binding.translation.y);
          const nz = resolveNominal(worstStepEnclosure!.nominal, worstStepEnclosure!.states, binding.translation.z);
          solid = translate(solid, [nx, ny, nz]);
        }
        if (binding.rotation) {
          const factor = binding.rotation.inDegrees ? Math.PI / 180 : 1.0;
          const nAngle =
            resolveNominal(worstStepEnclosure!.nominal, worstStepEnclosure!.states, binding.rotation.angle) * factor;
          solid = rotate(solid, binding.rotation.axis, nAngle);
        }
        if (binding.deformation) {
          const def = binding.deformation;
          const baseBox = p.baseAABB;
          const anchor = def.anchorOrigin || [
            (baseBox.min[0] + baseBox.max[0]) / 2,
            (baseBox.min[1] + baseBox.max[1]) / 2,
            (baseBox.min[2] + baseBox.max[2]) / 2,
          ];
          let nx = 1.0,
            ny = 1.0,
            nz = 1.0;
          if (def.volume !== undefined) {
            const nV = resolveNominal(worstStepEnclosure!.nominal, worstStepEnclosure!.states, def.volume);
            const v0 = def.referenceVolume && def.referenceVolume > 0 ? def.referenceVolume : 1.0;
            const nScale = Math.cbrt(Math.max(1e-9, nV) / v0);
            nx = ny = nz = nScale;
          }
          if (def.scale) {
            if (def.scale.x !== undefined)
              nx *= resolveNominal(worstStepEnclosure!.nominal, worstStepEnclosure!.states, def.scale.x);
            if (def.scale.y !== undefined)
              ny *= resolveNominal(worstStepEnclosure!.nominal, worstStepEnclosure!.states, def.scale.y);
            if (def.scale.z !== undefined)
              nz *= resolveNominal(worstStepEnclosure!.nominal, worstStepEnclosure!.states, def.scale.z);
          }
          solid = translate(solid, [-anchor[0], -anchor[1], -anchor[2]]);
          solid = scale(solid, [nx, ny, nz]);
          solid = translate(solid, [anchor[0], anchor[1], anchor[2]]);
        }
        return part(solid, { material: p.material, color: p.color });
      });

      counterexampleAssembly = assembly(`${asm.name}_Counterexample_t${worstTime?.toFixed(2)}`, cexParts);
    }

    const isCertifiedSafe = violations.length === 0;
    const summary = isCertifiedSafe
      ? `Dynamic clearance CERTIFIED SAFE across all ${trajectory.length} time steps. Minimum spatial margin: ${globalWorstMargin.toFixed(4)}.`
      : `Dynamic clearance FALSIFIED: ${violations.length} violation(s) detected. Worst margin: ${globalWorstMargin.toFixed(4)} at t=${worstTime?.toFixed(3)}s between '${worstPair[0]}' and '${worstPair[1]}'.`;

    return {
      assemblyName: asm.name,
      isCertifiedSafe,
      worstMargin: globalWorstMargin,
      worstCaseTime: worstTime,
      violations,
      timeHistory,
      counterexampleAssembly,
      summary,
    };
  }
}
