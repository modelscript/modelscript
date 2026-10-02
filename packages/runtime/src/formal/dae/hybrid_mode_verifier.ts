// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Hybrid Mode Consistency & Zeno Verifier.
 *
 * Verifies discrete-continuous interactions across hybrid physical models:
 *   1. Impulsive State Continuity: Ensures continuous dynamic states (voltages, velocities, pressures)
 *      do not undergo discontinuous jumps violating physical conservation laws without series impedance.
 *   2. Switch Determinism: Verifies mode transitions and when-clauses are mutually exclusive (pairwise disjoint guards).
 *   3. Minimum Dwell Time (\tau_min) & Zeno Prevention: Verifies reset maps x^+ = f(x^-) do not immediately
 *      re-satisfy the entry guard at t^+ = t_0, preventing infinite event chattering and solver lockup.
 */

import { DAEBuilder, EqKind, ExprKind, Variability } from "../../dae/wasm_dae.js";
import { NumericalInterval } from "../abstract_interpretation/interval_domain.js";
import { DaeIntervalEvaluator } from "./dae_interval_evaluator.js";

export type HybridIssueKind = "state_jump_discontinuity" | "nondeterministic_mode_switch" | "zeno_chattering_detected";

export interface HybridVerificationIssue {
  kind: HybridIssueKind;
  severity: "definite" | "possible";
  whenEqIdx: number;
  message: string;
  varIdx?: number;
  varName?: string;
  details?: Record<string, unknown>;
}

export interface HybridVerificationResult {
  isCertifiedConsistent: boolean;
  totalWhenEquations: number;
  issues: HybridVerificationIssue[];
}

export interface HybridVerifierOptions {
  /** Known continuous state variable indices */
  stateVars?: Set<number>;
  /** Explicit bounds for variables */
  variableBounds?: Map<number, NumericalInterval>;
}

export class HybridModeConsistencyVerifier {
  private evaluator: DaeIntervalEvaluator;
  private stateVars: Set<number>;

  constructor(
    public readonly arena: DAEBuilder,
    options: HybridVerifierOptions = {},
  ) {
    this.evaluator = new DaeIntervalEvaluator(arena, {
      varBounds: options.variableBounds,
    });
    this.stateVars = options.stateVars ?? new Set();

    // Auto-detect continuous variables with derivatives
    if (this.stateVars.size === 0) {
      for (let i = 0; i < arena.varCount; i++) {
        const variability = arena.getVarVariability(i);
        if (variability === Variability.Continuous) {
          this.stateVars.add(i);
        }
      }
    }
  }

  /**
   * Verifies all when-equations and hybrid mode transitions in the DAEBuilder arena.
   */
  public verify(): HybridVerificationResult {
    const issues: HybridVerificationIssue[] = [];
    let totalWhenEquations = 0;

    for (let eqIdx = 0; eqIdx < this.arena.eqCount; eqIdx++) {
      const kind = this.arena.getEqKind(eqIdx);
      if (kind !== EqKind.When) continue;

      totalWhenEquations++;
      const meta = this.arena.getWhenEquationMeta(eqIdx);
      if (!meta) continue;

      // 1. Check Impulsive Continuity on state variables
      this.checkImpulsiveContinuity(eqIdx, meta, issues);

      // 2. Check Switch Determinism across multiple clauses
      this.checkSwitchDeterminism(eqIdx, meta, issues);

      // 3. Check Minimum Dwell Time and Zeno Chattering
      this.checkMinimumDwellTime(eqIdx, meta, issues);
    }

    const hasDefiniteErrors = issues.some((i) => i.severity === "definite");

    return {
      isCertifiedConsistent: !hasDefiniteErrors && issues.length === 0,
      totalWhenEquations,
      issues,
    };
  }

  /**
   * 1. Impulsive State Continuity:
   * Checks if continuous states x are modified discontinuously in a when-clause
   * such that \Delta x = x^+ - x^- != 0.
   */
  private checkImpulsiveContinuity(
    whenEqIdx: number,
    meta: {
      conditionExprId: number;
      equations: { kind: EqKind; lhs: number; rhs: number }[];
      elseWhenClauses?: { conditionExprId: number; equations: { kind: EqKind; lhs: number; rhs: number }[] }[];
    },
    issues: HybridVerificationIssue[],
  ): void {
    const allEqs = [...meta.equations];
    if (meta.elseWhenClauses) {
      for (const clause of meta.elseWhenClauses) {
        allEqs.push(...clause.equations);
      }
    }

    for (const eq of allEqs) {
      const lhsExpr = eq.lhs;
      const rhsExpr = eq.rhs;

      let targetVarIdx = -1;
      let targetVarName = "";

      const lhsKind = this.arena.getExprKind(lhsExpr);
      if (lhsKind === ExprKind.Name) {
        const nameId = this.arena.getExprData1(lhsExpr);
        targetVarIdx = this.arena.lookupVariable(nameId);
        targetVarName = this.arena.interner.resolve(nameId) ?? `var_${targetVarIdx}`;
      }

      if (targetVarIdx >= 0 && this.stateVars.has(targetVarIdx)) {
        // Continuous state is being reassigned upon discrete event trigger!
        const currentBound = this.evaluator.getVarBound(targetVarIdx);
        const resetBound = this.evaluator.evaluateExpr(rhsExpr).interval;

        // Discontinuous jump: \Delta x = x^+ - x^-
        const jump = resetBound.sub(currentBound);

        // If jump cannot be zero (0 \notin [jump.low, jump.high]) -> definite jump discontinuity
        if (!jump.canBeZero()) {
          issues.push({
            kind: "state_jump_discontinuity",
            severity: "definite",
            whenEqIdx,
            varIdx: targetVarIdx,
            varName: targetVarName,
            message: `Continuous dynamic state '${targetVarName}' has definite discontinuous jump \u0394${targetVarName} \u2208 [${jump.low}, ${jump.high}] != 0 across when-equation. Violates physical continuity/conservation.`,
            details: { currentBound, resetBound, jump },
          });
        } else if (!jump.isConstant() || jump.low !== 0) {
          issues.push({
            kind: "state_jump_discontinuity",
            severity: "possible",
            whenEqIdx,
            varIdx: targetVarIdx,
            varName: targetVarName,
            message: `Continuous dynamic state '${targetVarName}' may have impulsive jump \u0394${targetVarName} \u2208 [${jump.low}, ${jump.high}] across when-equation.`,
            details: { currentBound, resetBound, jump },
          });
        }
      }
    }
  }

  /**
   * 2. Switch Determinism:
   * Proves that all when/elsewhen conditions are pairwise disjoint (cannot fire at the same time).
   */
  private checkSwitchDeterminism(
    whenEqIdx: number,
    meta: {
      conditionExprId: number;
      elseWhenClauses?: { conditionExprId: number }[];
    },
    issues: HybridVerificationIssue[],
  ): void {
    if (!meta.elseWhenClauses || meta.elseWhenClauses.length === 0) return;

    const allConditions = [meta.conditionExprId, ...meta.elseWhenClauses.map((c) => c.conditionExprId)];

    for (let i = 0; i < allConditions.length; i++) {
      for (let j = i + 1; j < allConditions.length; j++) {
        const cond1 = allConditions[i]!;
        const cond2 = allConditions[j]!;

        const res1 = this.evaluator.evaluateExpr(cond1);
        const res2 = this.evaluator.evaluateExpr(cond2);

        // Check if both can be simultaneously true (both intervals contain 1 / positive)
        const canBothFire = res1.interval.high >= 1.0 && res2.interval.high >= 1.0;

        if (canBothFire) {
          const bothDefinite = res1.interval.isDefinitePositive() && res2.interval.isDefinitePositive();

          issues.push({
            kind: "nondeterministic_mode_switch",
            severity: bothDefinite ? "definite" : "possible",
            whenEqIdx,
            message: `Hybrid mode switch has non-disjoint guards: Guard #${i + 1} and Guard #${j + 1} can simultaneously be satisfied, creating nondeterministic execution.`,
            details: { cond1Interval: res1.interval, cond2Interval: res2.interval },
          });
        }
      }
    }
  }

  /**
   * 3. Minimum Dwell Time (\tau_min) & Zeno Chattering Prevention:
   * Checks if the post-reset state x^+ satisfies the guard G(x^+), causing
   * an immediate re-trigger at t^+ = t_0.
   */
  private checkMinimumDwellTime(
    whenEqIdx: number,
    meta: {
      conditionExprId: number;
      equations: { kind: EqKind; lhs: number; rhs: number }[];
    },
    issues: HybridVerificationIssue[],
  ): void {
    const condExpr = meta.conditionExprId;
    if (condExpr < 0) return;

    // Create a local post-reset state map
    const postResetEnv = new Map<number, NumericalInterval>();

    for (const eq of meta.equations) {
      const lhsExpr = eq.lhs;
      const rhsExpr = eq.rhs;

      if (this.arena.getExprKind(lhsExpr) === ExprKind.Name) {
        const nameId = this.arena.getExprData1(lhsExpr);
        const vIdx = this.arena.lookupVariable(nameId);
        if (vIdx >= 0) {
          const resetEval = this.evaluator.evaluateExpr(rhsExpr);
          postResetEnv.set(vIdx, resetEval.interval);
        }
      }
    }

    if (postResetEnv.size === 0) return;

    // Evaluate entry guard condition under post-reset state x^+
    const postGuardEval = this.evaluator.evaluateExpr(condExpr, postResetEnv);

    if (postGuardEval.interval.isDefinitePositive()) {
      // Guard is unconditionally TRUE immediately after reset! Zeno chattering lockup!
      issues.push({
        kind: "zeno_chattering_detected",
        severity: "definite",
        whenEqIdx,
        message: `Zeno chattering detected: entry guard is definitely satisfied at post-reset state x^+ (guard \u2208 [${postGuardEval.interval.low}, ${postGuardEval.interval.high}]). Minimum dwell time \u03c4_min = 0, causing solver freezing.`,
        details: { postResetEnv, postGuardInterval: postGuardEval.interval },
      });
    } else if (postGuardEval.interval.high >= 1.0) {
      issues.push({
        kind: "zeno_chattering_detected",
        severity: "possible",
        whenEqIdx,
        message: `Potential Zeno phenomenon: entry guard may remain satisfied at post-reset state x^+ (\u03c4_min may reach zero).`,
        details: { postResetEnv, postGuardInterval: postGuardEval.interval },
      });
    }
  }
}
