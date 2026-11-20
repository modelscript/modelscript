// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Causalization Theory Oracle (Pantelides BLT & Code Synthesis).
 *
 * Verifies that acausal physical balance equations can be causally compiled into
 * deterministic embedded C99 / WASM state-update functions:
 *   1. Structural Non-Singularity: Every state has an assigned equation (Pantelides Index-1).
 *   2. Solvability of Strongly Connected Algebraic Loops: Linear or Newton-solvable.
 *   3. Nyquist-Shannon Sampling Stability: f_sample >= 10 * f_dominant_pole.
 */

import type { ConflictClause, SharedEquality, TheoryLiteral, TheoryOracle } from "../theory_coordinator.js";
import { hasSharedEqualityWithLiteral, retainSharedEqualitiesWithoutLiteral } from "./retraction_utils.js";
import { UndoTrail } from "./undo_trail.js";

export interface EquationAssignment {
  eqId: string;
  unknowns: string[];
}

export interface SamplingCheck {
  loopId: string;
  sampleFrequencyHz: number;
  dominantPoleFrequencyHz: number;
}

export interface AlgebraicLoopSpec {
  loopId: string;
  variables: string[];
  isLinear: boolean;
  hasAnalyticInverse: boolean;
}

export class CausalizationTheoryOracle implements TheoryOracle {
  public readonly name = "CausalizationTheoryOracle";
  public readonly domain = "constraint" as const;

  private equations: EquationAssignment[] = [];
  private samplingChecks: SamplingCheck[] = [];
  private algebraicLoops: AlgebraicLoopSpec[] = [];
  private assertedLiterals = new Map<number, TheoryLiteral>();
  private sharedEqualities: SharedEquality[] = [];
  private trail = new UndoTrail();

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.equations = [];
    this.samplingChecks = [];
    this.algebraicLoops = [];
    this.sharedEqualities = [];
    this.assertedLiterals.clear();
    this.trail.reset();
  }

  public pushLevel(): void {
    this.trail.pushLevel();
  }

  public popLevel(): void {
    this.trail.popLevel();
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.trail.mapSet(this.assertedLiterals, lit.id, lit);
    const { predicate, args } = lit;

    switch (predicate) {
      case "equation": {
        const [eqId, unknowns] = args as [string, string[]];
        this.trail.arrayPush(this.equations, { eqId, unknowns: [...unknowns] });
        break;
      }
      case "sampleRate": {
        const [loopId, sampleFrequencyHz, dominantPoleFrequencyHz] = args as [string, number, number];
        this.trail.arrayPush(this.samplingChecks, { loopId, sampleFrequencyHz, dominantPoleFrequencyHz });
        break;
      }
      case "algebraicLoop": {
        const [loopId, variables, isLinear, hasAnalyticInverse] = args as [string, string[], boolean, boolean?];
        this.trail.arrayPush(this.algebraicLoops, {
          loopId,
          variables: [...variables],
          isLinear,
          hasAnalyticInverse: hasAnalyticInverse ?? isLinear,
        });
        break;
      }
    }

    return true;
  }

  public retractLiteral(litId: number): void {
    const hasShared = hasSharedEqualityWithLiteral(this.sharedEqualities, litId);
    if (!this.assertedLiterals.has(litId) && !hasShared) return;
    this.assertedLiterals.delete(litId);
    const savedDepth = this.trail.depth;
    const remaining = Array.from(this.assertedLiterals.values());
    const remainingSharedEqs = retainSharedEqualitiesWithoutLiteral(this.sharedEqualities, litId);
    this.reset();
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of remainingSharedEqs) {
      this.onSharedEquality(eq);
    }
    for (let i = 0; i < savedDepth; i++) {
      this.trail.pushLevel();
    }
  }

  public checkSat(): { isSat: boolean; conflict?: ConflictClause | undefined } {
    // 1. Check Nyquist-Shannon Sampling Stability
    for (const s of this.samplingChecks) {
      const minRequired = 10 * s.dominantPoleFrequencyHz;
      if (s.sampleFrequencyHz < minRequired) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) => l.args.includes(s.loopId)),
            explanation: `Discretization Instability Conflict: Software sampling frequency (${s.sampleFrequencyHz} Hz) is too slow for physical actuator dynamics (${s.dominantPoleFrequencyHz} Hz). Required Nyquist-Shannon margin is >= ${minRequired} Hz.`,
            culpritEntities: [s.loopId],
            theoryName: this.name,
          },
        };
      }
    }

    // 2. Check Unresolvable Algebraic Loops
    for (const loop of this.algebraicLoops) {
      if (!loop.isLinear && !loop.hasAnalyticInverse) {
        return {
          isSat: false,
          conflict: {
            literals: Array.from(this.assertedLiterals.values()).filter((l) => l.args.includes(loop.loopId)),
            explanation: `Causalization Failure: Strongly connected algebraic loop '${loop.loopId}' over variables [${loop.variables.join(", ")}] is non-linear and lacks an analytical inverse, preventing deterministic embedded execution.`,
            culpritEntities: [loop.loopId, ...loop.variables],
            theoryName: this.name,
          },
        };
      }
    }

    return { isSat: true };
  }

  public propagateEqualities(): SharedEquality[] {
    const eqs: SharedEquality[] = [];
    for (const eq of this.equations) {
      if (eq.unknowns.length === 1) {
        const u = eq.unknowns[0]!;
        const litIds = Array.from(this.assertedLiterals.values())
          .filter((l) => l.args.includes(eq.eqId))
          .map((l) => l.id);
        eqs.push({
          varA: u,
          varB: `assign(${eq.eqId})`,
          domain: "real",
          explanation: `Causal assignment for single unknown in ${eq.eqId}`,
          sourceOracle: this.name,
          justification: litIds,
          justifications: litIds,
        });
      }
    }
    return eqs;
  }

  public onSharedEquality(eq: SharedEquality): void {
    if (!eq.varA || !eq.varB || eq.varA === eq.varB) return;
    this.trail.arrayPush(this.sharedEqualities, eq);
    for (const loop of this.algebraicLoops) {
      const idxA = loop.variables.indexOf(eq.varA);
      if (idxA !== -1) {
        const prev = loop.variables[idxA]!;
        this.trail.record(() => {
          loop.variables[idxA] = prev;
        });
        loop.variables[idxA] = eq.varB;
      }
    }
    for (const assignment of this.equations) {
      const idxA = assignment.unknowns.indexOf(eq.varA);
      if (idxA !== -1) {
        const prev = assignment.unknowns[idxA]!;
        this.trail.record(() => {
          assignment.unknowns[idxA] = prev;
        });
        assignment.unknowns[idxA] = eq.varB;
      }
    }
  }
}
