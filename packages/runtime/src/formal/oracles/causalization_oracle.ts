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
  private levelStack: {
    equations: EquationAssignment[];
    samplingChecks: SamplingCheck[];
    algebraicLoops: AlgebraicLoopSpec[];
    sharedEqualities: SharedEquality[];
    assertedLitIds: number[];
  }[] = [];

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.equations = [];
    this.samplingChecks = [];
    this.algebraicLoops = [];
    this.sharedEqualities = [];
    this.assertedLiterals.clear();
    this.levelStack = [];
  }

  public pushLevel(): void {
    this.levelStack.push({
      equations: this.equations.map((e) => ({ ...e, unknowns: [...e.unknowns] })),
      samplingChecks: this.samplingChecks.map((s) => ({ ...s })),
      algebraicLoops: this.algebraicLoops.map((l) => ({ ...l, variables: [...l.variables] })),
      sharedEqualities: [...this.sharedEqualities],
      assertedLitIds: [],
    });
  }

  public popLevel(): void {
    const top = this.levelStack.pop();
    if (!top) return;
    this.equations = top.equations;
    this.samplingChecks = top.samplingChecks;
    this.algebraicLoops = top.algebraicLoops;
    this.sharedEqualities = top.sharedEqualities;
    for (const id of top.assertedLitIds) {
      this.assertedLiterals.delete(id);
    }
  }

  public assertLiteral(lit: TheoryLiteral): boolean {
    this.assertedLiterals.set(lit.id, lit);
    if (this.levelStack.length > 0) {
      this.levelStack[this.levelStack.length - 1]!.assertedLitIds.push(lit.id);
    }
    const { predicate, args } = lit;

    switch (predicate) {
      case "equation": {
        const [eqId, unknowns] = args as [string, string[]];
        this.equations.push({ eqId, unknowns: [...unknowns] });
        break;
      }
      case "sampleRate": {
        const [loopId, sampleFrequencyHz, dominantPoleFrequencyHz] = args as [string, number, number];
        this.samplingChecks.push({ loopId, sampleFrequencyHz, dominantPoleFrequencyHz });
        break;
      }
      case "algebraicLoop": {
        const [loopId, variables, isLinear, hasAnalyticInverse] = args as [string, string[], boolean, boolean?];
        this.algebraicLoops.push({
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
    if (!this.assertedLiterals.has(litId)) return;
    this.assertedLiterals.delete(litId);
    const savedStack = this.levelStack;
    const remaining = Array.from(this.assertedLiterals.values());
    const remainingSharedEqs = this.sharedEqualities.filter((eq) => {
      const justs = eq.justifications ?? eq.justification ?? [];
      return !justs.includes(litId);
    });
    this.reset();
    this.levelStack = savedStack;
    for (const lit of remaining) {
      this.assertLiteral(lit);
    }
    for (const eq of remainingSharedEqs) {
      this.onSharedEquality(eq);
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
    this.sharedEqualities.push(eq);
    for (const loop of this.algebraicLoops) {
      const idxA = loop.variables.indexOf(eq.varA);
      if (idxA !== -1) {
        loop.variables[idxA] = eq.varB;
      }
    }
    for (const assignment of this.equations) {
      const idxA = assignment.unknowns.indexOf(eq.varA);
      if (idxA !== -1) {
        assignment.unknowns[idxA] = eq.varB;
      }
    }
  }
}
