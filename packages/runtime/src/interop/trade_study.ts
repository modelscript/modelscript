// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Multi-Disciplinary Trade Studies & Pareto Front Engine.
 *
 * Implements non-dominated Pareto ranking, crowding distance assignment, knee-point selection,
 * and design alternative branching across the 16-domain digital thread.
 *
 * Mathematical formulation:
 *   A dominates B (A < B) iff:
 *     forall i in {1..M}: J_i(A) <= J_i(B) and exists j in {1..M}: J_j(A) < J_j(B)
 *
 * Knee point:
 *   x_knee = argmin_{x in Pareto} || J_norm(x) - J_utopia ||_2
 */

import { DigitalThreadHypergraph } from "./thread_hypergraph.js";

export type ObjectiveSense = "minimize" | "maximize";

export interface ObjectiveDef {
  name: string;
  sense: ObjectiveSense;
  unit?: string;
  weight?: number;
}

export interface TradeStudyCandidate {
  id: string;
  name: string;
  parameters: Record<string, number | string>;
  objectives: Record<string, number>;
  branchId?: number;
  metadata?: Record<string, any>;
}

export interface ParetoPoint extends TradeStudyCandidate {
  rank: number; // 0 = non-dominated frontier
  crowdingDistance: number;
  isKneePoint: boolean;
  normalizedDistanceToUtopia: number;
}

export interface TradeStudyResult {
  studyName: string;
  totalCandidates: number;
  paretoFront: ParetoPoint[];
  allRankedCandidates: ParetoPoint[];
  kneePoint: ParetoPoint;
  hypervolumeEstimate: number;
}

export class TradeStudyEngine {
  public readonly studyName: string;
  public readonly objectives: ObjectiveDef[];
  private candidates: TradeStudyCandidate[] = [];

  constructor(studyName: string, objectives: ObjectiveDef[]) {
    this.studyName = studyName;
    this.objectives = objectives;
    if (objectives.length === 0) {
      throw new Error("Must specify at least one optimization objective");
    }
  }

  public addCandidate(candidate: TradeStudyCandidate): void {
    this.candidates.push(candidate);
  }

  public addCandidates(candidates: TradeStudyCandidate[]): void {
    for (const c of candidates) this.addCandidate(c);
  }

  /**
   * Checks if candidate A dominates candidate B.
   */
  private dominates(a: TradeStudyCandidate, b: TradeStudyCandidate): boolean {
    let atLeastOneBetter = false;

    for (const obj of this.objectives) {
      const valA = a.objectives[obj.name] ?? (obj.sense === "minimize" ? Infinity : -Infinity);
      const valB = b.objectives[obj.name] ?? (obj.sense === "minimize" ? Infinity : -Infinity);

      if (obj.sense === "minimize") {
        if (valA > valB) return false;
        if (valA < valB) atLeastOneBetter = true;
      } else {
        if (valA < valB) return false;
        if (valA > valB) atLeastOneBetter = true;
      }
    }

    return atLeastOneBetter;
  }

  /**
   * Fast non-dominated sorting algorithm (Deb et al. NSGA-II).
   */
  public evaluate(): TradeStudyResult {
    const N = this.candidates.length;
    if (N === 0) {
      throw new Error("No candidates registered in trade study");
    }

    const dominationCounts = new Int32Array(N); // number of solutions that dominate i
    const dominatedSets: number[][] = Array.from({ length: N }, () => []);

    const fronts: number[][] = [[]];

    for (let p = 0; p < N; p++) {
      const candP = this.candidates[p]!;
      for (let q = p + 1; q < N; q++) {
        const candQ = this.candidates[q]!;

        if (this.dominates(candP, candQ)) {
          dominatedSets[p]!.push(q);
          dominationCounts[q]++;
        } else if (this.dominates(candQ, candP)) {
          dominatedSets[q]!.push(p);
          dominationCounts[p]++;
        }
      }

      if (dominationCounts[p] === 0) {
        fronts[0]!.push(p);
      }
    }

    let curFrontIdx = 0;
    while (fronts[curFrontIdx] && fronts[curFrontIdx]!.length > 0) {
      const nextFront: number[] = [];
      for (const p of fronts[curFrontIdx]!) {
        for (const q of dominatedSets[p]!) {
          dominationCounts[q]--;
          if (dominationCounts[q] === 0) {
            nextFront.push(q);
          }
        }
      }
      curFrontIdx++;
      if (nextFront.length > 0) fronts.push(nextFront);
    }

    // Assign Pareto points with rank
    const allRanked: ParetoPoint[] = [];

    // Compute min and max bounds for each objective (for normalization)
    const bounds: Record<string, { min: number; max: number }> = {};
    for (const obj of this.objectives) {
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (const c of this.candidates) {
        const v = c.objectives[obj.name] ?? 0;
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
      bounds[obj.name] = { min: minVal, max: maxVal };
    }

    // Process each front and compute crowding distances
    for (let f = 0; f < fronts.length; f++) {
      const frontIndices = fronts[f]!;
      const frontPoints: ParetoPoint[] = frontIndices.map((idx) => {
        const c = this.candidates[idx]!;
        return {
          ...c,
          rank: f,
          crowdingDistance: 0.0,
          isKneePoint: false,
          normalizedDistanceToUtopia: 0.0,
        };
      });

      // Calculate crowding distance for this front
      const numPts = frontPoints.length;
      if (numPts > 2) {
        for (const obj of this.objectives) {
          const b = bounds[obj.name]!;
          const span = b.max - b.min || 1e-12;

          frontPoints.sort((p1, p2) => (p1.objectives[obj.name] ?? 0) - (p2.objectives[obj.name] ?? 0));

          // Boundary points have infinite distance
          frontPoints[0]!.crowdingDistance = Infinity;
          frontPoints[numPts - 1]!.crowdingDistance = Infinity;

          for (let i = 1; i < numPts - 1; i++) {
            if (frontPoints[i]!.crowdingDistance !== Infinity) {
              const diff =
                (frontPoints[i + 1]!.objectives[obj.name]! - frontPoints[i - 1]!.objectives[obj.name]!) / span;
              frontPoints[i]!.crowdingDistance += Math.abs(diff);
            }
          }
        }
      } else {
        for (const p of frontPoints) p.crowdingDistance = Infinity;
      }

      allRanked.push(...frontPoints);
    }

    // Extract Pareto Front (Rank 0)
    const paretoFront = allRanked.filter((p) => p.rank === 0);

    // Find Knee Point (point on Pareto front minimizing Euclidean distance to Utopia point)
    let bestDist = Infinity;
    let kneePoint: ParetoPoint = paretoFront[0]!;

    for (const pt of paretoFront) {
      let sumSq = 0.0;
      for (const obj of this.objectives) {
        const b = bounds[obj.name]!;
        const span = b.max - b.min || 1e-12;
        const v = pt.objectives[obj.name] ?? b.min;

        // Utopia point is 0.0 when normalized in direction of optimization
        const normVal = obj.sense === "minimize" ? (v - b.min) / span : (b.max - v) / span;
        const weight = obj.weight ?? 1.0;
        sumSq += weight * normVal * normVal;
      }

      const dist = Math.sqrt(sumSq);
      pt.normalizedDistanceToUtopia = dist;

      if (dist < bestDist) {
        bestDist = dist;
        kneePoint = pt;
      }
    }

    kneePoint.isKneePoint = true;

    // Approximate hypervolume indicator of Pareto front
    let hv = 0.0;
    if (this.objectives.length === 2) {
      const obj0 = this.objectives[0]!;
      const obj1 = this.objectives[1]!;
      paretoFront.sort((a, b) => (a.objectives[obj0.name] ?? 0) - (b.objectives[obj0.name] ?? 0));

      const b0 = bounds[obj0.name]!;
      const b1 = bounds[obj1.name]!;
      const span0 = b0.max - b0.min || 1.0;
      const span1 = b1.max - b1.min || 1.0;

      for (let i = 0; i < paretoFront.length - 1; i++) {
        const p1 = paretoFront[i]!;
        const p2 = paretoFront[i + 1]!;
        const w = Math.abs((p2.objectives[obj0.name]! - p1.objectives[obj0.name]!) / span0);
        const h = Math.abs((b1.max - p1.objectives[obj1.name]!) / span1);
        hv += w * h;
      }
    }

    return {
      studyName: this.studyName,
      totalCandidates: N,
      paretoFront,
      allRankedCandidates: allRanked,
      kneePoint,
      hypervolumeEstimate: parseFloat(hv.toFixed(4)),
    };
  }

  /**
   * Forks a variant branch in the DigitalThreadHypergraph for each Pareto alternative.
   */
  public federateToHypergraph(hypergraph: DigitalThreadHypergraph, parentBranchId: number = 0): Map<string, number> {
    const branchMap = new Map<string, number>();
    const res = this.evaluate();

    let variantCounter = 1;
    for (const pt of res.paretoFront) {
      const variantBranchId = parentBranchId * 100 + variantCounter++;
      hypergraph.forkBranch(parentBranchId, variantBranchId);
      pt.branchId = variantBranchId;
      branchMap.set(pt.id, variantBranchId);
    }

    return branchMap;
  }
}
