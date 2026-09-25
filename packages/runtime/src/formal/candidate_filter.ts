// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Multi-Fidelity Candidate Filter & CEGAR Refinement Engine.
 *
 * Implements:
 *   1. Multi-Objective Pareto Non-Dominated Sorting (NSGA-II) & Crowding Distance Selection:
 *      Prunes 1,000–10,000 Tier-2 surrogate variants down to 3–5 diverse candidate designs
 *      for heavy Tier-3 confirmation (3D FEA stress, Navier-Stokes CFD, HiL test benches).
 *   2. Counterexample-Guided Abstraction Refinement (CEGAR) Synthesizer:
 *      Extracts physical failure witnesses from refuted Tier-3 simulations, synthesizes
 *      analytical supporting hyperplanes and tightened parameter bounds, and feeds them
 *      back into the Semantic Theory Coordinator to monotonically shrink the feasible space:
 *        μ(F_{k+1}) < μ(F_k)
 */

import type { SemanticTheoryCoordinator } from "./theory_coordinator.js";

export type ObjectiveDirection = "min" | "max";

export interface DesignCandidate {
  id: string;
  name: string;
  parameters: Record<string, number>;
  objectives: Record<string, number>; // e.g. { mass: 1.4, drag: 12.5, margin: 0.18 }
  tier1Passed: boolean;
  tier2Passed: boolean;
  tier3Status?: "unverified" | "running" | "confirmed" | "refuted";
  tier3Witness?: any;
  rank?: number;
  crowdingDistance?: number;
}

export interface CandidateFilterOptions {
  targetCount?: number;
  directions?: Record<string, ObjectiveDirection>; // default: "min" for all objectives
}

export interface PhysicalRefutationWitness {
  candidateId: string;
  failedProperty: string; // e.g. "vonMisesStress"
  actualValue: number; // e.g. 582 MPa
  thresholdValue: number; // e.g. 553 MPa
  criticalCoordinates?: [number, number, number];
  sensitivityGradients?: Record<string, number>; // ∂g/∂p_i
  parameters: Record<string, number>;
}

export interface RefinementInvariant {
  id: string;
  witnessCandidateId: string;
  failedProperty: string;
  hyperplane: {
    coefficients: Record<string, number>;
    constant: number; // ∑ a_i * p_i >= constant
  };
  suggestedBounds: Record<string, { min?: number; max?: number }>;
  explanation: string;
}

/**
 * Determines whether candidate A dominates candidate B.
 */
export function dominates(
  a: DesignCandidate,
  b: DesignCandidate,
  directions: Record<string, ObjectiveDirection>,
): boolean {
  let atLeastOneBetter = false;

  for (const objKey of Object.keys(a.objectives)) {
    const valA = a.objectives[objKey]!;
    const valB = b.objectives[objKey] ?? 0;
    const dir = directions[objKey] ?? "min";

    if (dir === "min") {
      if (valA > valB) return false; // A is worse than B in this objective
      if (valA < valB) atLeastOneBetter = true;
    } else {
      if (valA < valB) return false;
      if (valA > valB) atLeastOneBetter = true;
    }
  }

  return atLeastOneBetter;
}

export class CandidateFilter {
  /**
   * Performs Fast Non-Dominated Sorting (Deb et al., NSGA-II) to partition candidates into Pareto fronts.
   */
  public static extractParetoFronts(
    candidates: DesignCandidate[],
    directions: Record<string, ObjectiveDirection> = {},
  ): DesignCandidate[][] {
    const fronts: DesignCandidate[][] = [[]];
    const n = candidates.length;
    const dominationCounts = new Int32Array(n);
    const dominatedSets: number[][] = Array.from({ length: n }, () => []);

    for (let p = 0; p < n; p++) {
      const candP = candidates[p]!;
      for (let q = 0; q < n; q++) {
        if (p === q) continue;
        const candQ = candidates[q]!;

        if (dominates(candP, candQ, directions)) {
          dominatedSets[p]!.push(q);
        } else if (dominates(candQ, candP, directions)) {
          dominationCounts[p]++;
        }
      }

      if (dominationCounts[p] === 0) {
        candP.rank = 1;
        fronts[0]!.push(candP);
      }
    }

    let i = 0;
    while (fronts[i] && fronts[i]!.length > 0) {
      const nextFront: DesignCandidate[] = [];
      for (const pCand of fronts[i]!) {
        const pIdx = candidates.indexOf(pCand);
        for (const qIdx of dominatedSets[pIdx]!) {
          dominationCounts[qIdx]--;
          if (dominationCounts[qIdx] === 0) {
            const qCand = candidates[qIdx]!;
            qCand.rank = i + 2;
            nextFront.push(qCand);
          }
        }
      }
      i++;
      if (nextFront.length > 0) {
        fronts.push(nextFront);
      }
    }

    return fronts;
  }

  /**
   * Computes crowding distances for candidates on a Pareto front to promote design diversity.
   */
  public static computeCrowdingDistances(
    front: DesignCandidate[],
    directions: Record<string, ObjectiveDirection> = {},
  ): void {
    const l = front.length;
    if (l === 0) return;

    for (const c of front) {
      c.crowdingDistance = 0;
    }

    if (l <= 2) {
      for (const c of front) {
        c.crowdingDistance = Infinity;
      }
      return;
    }

    const objKeys = Object.keys(front[0]!.objectives);

    for (const m of objKeys) {
      front.sort((a, b) => a.objectives[m]! - b.objectives[m]!);

      front[0]!.crowdingDistance = Infinity;
      front[l - 1]!.crowdingDistance = Infinity;

      const objMin = front[0]!.objectives[m]!;
      const objMax = front[l - 1]!.objectives[m]!;
      const range = objMax - objMin;

      if (range > 1e-9) {
        for (let i = 1; i < l - 1; i++) {
          if (isFinite(front[i]!.crowdingDistance!)) {
            front[i]!.crowdingDistance! += (front[i + 1]!.objectives[m]! - front[i - 1]!.objectives[m]!) / range;
          }
        }
      }
    }
  }

  /**
   * Prunes a large pool of candidates down to the targetCount best diverse candidates.
   */
  public static pruneToCandidates(
    candidates: DesignCandidate[],
    options: CandidateFilterOptions = {},
  ): DesignCandidate[] {
    const targetCount = options.targetCount ?? 5;
    const directions = options.directions ?? {};

    // Filter to only variants that passed Tier 1 and Tier 2
    const valid = candidates.filter((c) => c.tier1Passed && c.tier2Passed);
    if (valid.length <= targetCount) {
      return valid;
    }

    const fronts = this.extractParetoFronts(valid, directions);
    const selected: DesignCandidate[] = [];

    for (const front of fronts) {
      this.computeCrowdingDistances(front, directions);
      // Sort front descending by crowding distance to prioritize boundary and diverse designs
      front.sort((a, b) => (b.crowdingDistance ?? 0) - (a.crowdingDistance ?? 0));

      if (selected.length + front.length <= targetCount) {
        selected.push(...front);
      } else {
        const remaining = targetCount - selected.length;
        selected.push(...front.slice(0, remaining));
        break;
      }
    }

    return selected;
  }
}

export class CegarRefinementSynthesizer {
  private static nextId = 1;

  /**
   * Synthesizes an analytical refinement invariant from a physical refutation witness.
   */
  public static synthesizeRefinement(witness: PhysicalRefutationWitness): RefinementInvariant {
    const id = `cegar_inv_${this.nextId++}`;
    const delta = witness.actualValue - witness.thresholdValue; // > 0 means violation
    const suggestedBounds: Record<string, { min?: number; max?: number }> = {};
    const coefficients: Record<string, number> = {};

    let dominantParam = "";
    let maxSensitivity = 0;

    if (witness.sensitivityGradients && Object.keys(witness.sensitivityGradients).length > 0) {
      for (const [param, grad] of Object.entries(witness.sensitivityGradients)) {
        coefficients[param] = -grad; // To decrease stress, move in opposite direction of positive gradient
        const currentVal = witness.parameters[param];
        if (currentVal !== undefined && Math.abs(grad) > 1e-6) {
          if (grad < 0) {
            // Negative gradient: increasing parameter decreases stress (e.g. thickness or fillet radius)
            const requiredDelta = delta / Math.abs(grad);
            suggestedBounds[param] = { min: Number((currentVal + requiredDelta).toFixed(4)) };
          } else {
            // Positive gradient: decreasing parameter decreases stress
            const requiredDelta = delta / grad;
            suggestedBounds[param] = { max: Number((currentVal - requiredDelta).toFixed(4)) };
          }
        }
      }
    } else {
      // Default to uniform sensitivity across parameters if gradients not provided
      for (const [p, val] of Object.entries(witness.parameters)) {
        coefficients[p] = 1.0;
        suggestedBounds[p] = { min: Number((val + delta * 0.1).toFixed(4)) };
      }
    }

    const explanation = `CEGAR Refinement: Candidate '${witness.candidateId}' breached '${witness.failedProperty}' (${witness.actualValue.toFixed(2)} > ${witness.thresholdValue.toFixed(2)}). Generated supporting hyperplane invariant requiring ${Object.entries(
      suggestedBounds,
    )
      .map(([k, v]) => `${k} ${v.min !== undefined ? `>= ${v.min}` : `<= ${v.max}`}`)
      .join(", ")} to eliminate physical failure witness.`;

    return {
      id,
      witnessCandidateId: witness.candidateId,
      failedProperty: witness.failedProperty,
      hyperplane: {
        coefficients,
        constant: delta,
      },
      suggestedBounds,
      explanation,
    };
  }

  /**
   * Asserts the synthesized refinement bounds back into the Semantic Theory Coordinator.
   */
  public static applyRefinementToCoordinator(
    coordinator: SemanticTheoryCoordinator,
    refinement: RefinementInvariant,
  ): void {
    for (const [param, bounds] of Object.entries(refinement.suggestedBounds)) {
      if (bounds.min !== undefined) {
        coordinator.assertLiteral({
          predicate: "bound",
          args: [param, ">=", bounds.min],
          domain: "constraint",
        });
      }
      if (bounds.max !== undefined) {
        coordinator.assertLiteral({
          predicate: "bound",
          args: [param, "<=", bounds.max],
          domain: "constraint",
        });
      }
    }
  }
}
