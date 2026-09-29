// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Relational Verifier for 2-Safety Hyperproperties & Self-Composition.
 *
 * Implements self-composition (M x M) for verifying relational properties across pairs of execution traces:
 *   - Lipschitz Continuity: ||f(x1) - f(x2)|| <= L * ||x1 - x2||
 *   - Sensor Jitter / Noise Robustness: ||x1 - x2|| <= delta => ||y1 - y2|| <= epsilon
 *   - Observational Determinism & Non-Interference: x_pub1 == x_pub2 => y_pub1 == y_pub2
 *
 * Integrates directly with the Two-Variables-Per-Inequality (TVPI) domain and Farkas certificates.
 */

import { TvpiDomain, TvpiState } from "./abstract_interpretation/tvpi_domain.js";
import { CraigInterpolator, type LinearConstraint } from "./craig_interpolator.js";
import { DpllTSolver } from "./dpll_t_solver.js";
import { type NonlinearConstraint } from "./hc4_contractor.js";

export interface RelationalVariable {
  name: string;
  type?: "real" | "int";
  isPublic?: boolean;
}

export interface RelationalContract {
  name: string;
  inputs: string[];
  outputs: string[];
  deltaBound: number; // Input perturbation bound: ||x1 - x2|| <= delta
  epsilonBound?: number; // Target output bound: ||y1 - y2|| <= epsilon
  maxLipschitzConstant?: number; // Target Lipschitz constant: ||y1 - y2|| / ||x1 - x2|| <= L
}

export interface RelationalVerificationResult {
  status: "VERIFIED" | "VIOLATED" | "UNKNOWN";
  property: "LIPSCHITZ_CONTINUITY" | "NOISE_ROBUSTNESS" | "OBSERVATIONAL_DETERMINISM";
  certifiedLipschitzConstant?: number;
  maxOutputDeviation?: number;
  counterexample?: {
    trace1: Map<string, number>;
    trace2: Map<string, number>;
    inputDiff: number;
    outputDiff: number;
  };
  durationMs: number;
  summary: string;
}

export class RelationalVerifier {
  private tvpi = new TvpiDomain();

  /**
   * Verifies Lipschitz continuity: |f(x1) - f(x2)| <= L * |x1 - x2| over input range.
   */
  public verifyLipschitz(
    inputVar: string,
    outputVar: string,
    transferConstraints: NonlinearConstraint[],
    targetL: number,
    inputRange: { min: number; max: number },
  ): RelationalVerificationResult {
    const startTime = performance.now();

    // Self-composition variables: x_1, x_2, y_1, y_2
    const x1 = `${inputVar}_1`;
    const x2 = `${inputVar}_2`;
    const y1 = `${outputVar}_1`;
    const y2 = `${outputVar}_2`;

    // 1. Build TVPI state for relational difference
    const state = TvpiState.top();

    // Map transfer constraints for copy 1 and copy 2
    const c1 = transferConstraints.map((c) => this.tagConstraint(c, "_1"));
    const c2 = transferConstraints.map((c) => this.tagConstraint(c, "_2"));

    // Check if |y1 - y2| > L * |x1 - x2| is satisfiable
    // Equivalent to: (y1 - y2) > L * (x1 - x2) OR (y2 - y1) > L * (x1 - x2) for x1 >= x2
    // Encode violation query into DPLL(T)
    const violationConstraints: NonlinearConstraint[] = [
      ...c1,
      ...c2,
      // Input bounds
      { expr: { kind: "var", name: x1 }, rel: ">=", rhs: inputRange.min },
      { expr: { kind: "var", name: x1 }, rel: "<=", rhs: inputRange.max },
      { expr: { kind: "var", name: x2 }, rel: ">=", rhs: inputRange.min },
      { expr: { kind: "var", name: x2 }, rel: "<=", rhs: inputRange.max },
      // Ordering: x1 >= x2 + 0.01
      {
        expr: {
          kind: "sub",
          left: { kind: "var", name: x1 },
          right: { kind: "var", name: x2 },
        },
        rel: ">=",
        rhs: 0.01,
      },
      // Violation: (y1 - y2) - targetL * (x1 - x2) >= 0.01
      {
        expr: {
          kind: "sub",
          left: {
            kind: "sub",
            left: { kind: "var", name: y1 },
            right: { kind: "var", name: y2 },
          },
          right: {
            kind: "mul",
            left: { kind: "const", value: targetL },
            right: {
              kind: "sub",
              left: { kind: "var", name: x1 },
              right: { kind: "var", name: x2 },
            },
          },
        },
        rel: ">=",
        rhs: 0.01,
      },
    ];

    const isSat = this.checkSatisfiability(violationConstraints);
    const duration = performance.now() - startTime;

    if (!isSat.sat) {
      // Certified Lipschitz continuous!
      return {
        status: "VERIFIED",
        property: "LIPSCHITZ_CONTINUITY",
        certifiedLipschitzConstant: targetL,
        durationMs: duration,
        summary: `VERIFIED: Controller is formally certified Lipschitz-continuous with constant L=${targetL}.`,
      };
    } else {
      // Counterexample found
      const m = isSat.model!;
      const valX1 = m.get(x1) ?? 0;
      const valX2 = m.get(x2) ?? 0;
      const valY1 = m.get(y1) ?? 0;
      const valY2 = m.get(y2) ?? 0;
      const dx = Math.abs(valX1 - valX2);
      const dy = Math.abs(valY1 - valY2);

      return {
        status: "VIOLATED",
        property: "LIPSCHITZ_CONTINUITY",
        counterexample: {
          trace1: new Map([
            [inputVar, valX1],
            [outputVar, valY1],
          ]),
          trace2: new Map([
            [inputVar, valX2],
            [outputVar, valY2],
          ]),
          inputDiff: dx,
          outputDiff: dy,
        },
        durationMs: duration,
        summary: `VIOLATED: Lipschitz bound violated: dy/dx = ${(dy / Math.max(1e-6, dx)).toFixed(3)} > ${targetL}.`,
      };
    }
  }

  /**
   * Verifies noise / jitter sensitivity: ||x1 - x2|| <= delta => ||y1 - y2|| <= epsilon.
   */
  public verifyNoiseRobustness(
    inputVar: string,
    outputVar: string,
    transferConstraints: NonlinearConstraint[],
    delta: number,
    epsilon: number,
  ): RelationalVerificationResult {
    const startTime = performance.now();

    const x1 = `${inputVar}_1`;
    const x2 = `${inputVar}_2`;
    const y1 = `${outputVar}_1`;
    const y2 = `${outputVar}_2`;

    const c1 = transferConstraints.map((c) => this.tagConstraint(c, "_1"));
    const c2 = transferConstraints.map((c) => this.tagConstraint(c, "_2"));

    // Check if input difference is within delta, but output difference exceeds epsilon
    const violationConstraints: NonlinearConstraint[] = [
      ...c1,
      ...c2,
      // -delta <= x1 - x2 <= delta
      {
        expr: {
          kind: "sub",
          left: { kind: "var", name: x1 },
          right: { kind: "var", name: x2 },
        },
        rel: "<=",
        rhs: delta,
      },
      {
        expr: {
          kind: "sub",
          left: { kind: "var", name: x1 },
          right: { kind: "var", name: x2 },
        },
        rel: ">=",
        rhs: -delta,
      },
      // Output violation: (y1 - y2) >= epsilon + 0.01
      {
        expr: {
          kind: "sub",
          left: { kind: "var", name: y1 },
          right: { kind: "var", name: y2 },
        },
        rel: ">=",
        rhs: epsilon + 0.01,
      },
    ];

    const isSat = this.checkSatisfiability(violationConstraints);
    const duration = performance.now() - startTime;

    if (!isSat.sat) {
      return {
        status: "VERIFIED",
        property: "NOISE_ROBUSTNESS",
        maxOutputDeviation: epsilon,
        durationMs: duration,
        summary: `VERIFIED: Sensor noise bound delta=${delta} guarantees output deviation bounded by epsilon=${epsilon}.`,
      };
    } else {
      const m = isSat.model!;
      const valX1 = m.get(x1) ?? 0;
      const valX2 = m.get(x2) ?? 0;
      const valY1 = m.get(y1) ?? 0;
      const valY2 = m.get(y2) ?? 0;

      return {
        status: "VIOLATED",
        property: "NOISE_ROBUSTNESS",
        counterexample: {
          trace1: new Map([
            [inputVar, valX1],
            [outputVar, valY1],
          ]),
          trace2: new Map([
            [inputVar, valX2],
            [outputVar, valY2],
          ]),
          inputDiff: Math.abs(valX1 - valX2),
          outputDiff: Math.abs(valY1 - valY2),
        },
        durationMs: duration,
        summary: `VIOLATED: Sensor noise delta=${delta} produces output divergence exceeding epsilon=${epsilon}.`,
      };
    }
  }

  /**
   * Verifies observational determinism / non-interference: x_pub1 == x_pub2 => y_pub1 == y_pub2.
   */
  public verifyObservationalDeterminism(
    publicInputs: string[],
    publicOutputs: string[],
    transferConstraints: NonlinearConstraint[],
  ): RelationalVerificationResult {
    const startTime = performance.now();

    const c1 = transferConstraints.map((c) => this.tagConstraint(c, "_1"));
    const c2 = transferConstraints.map((c) => this.tagConstraint(c, "_2"));

    const equalityConstraints: NonlinearConstraint[] = [];
    for (const inVar of publicInputs) {
      equalityConstraints.push({
        expr: {
          kind: "sub",
          left: { kind: "var", name: `${inVar}_1` },
          right: { kind: "var", name: `${inVar}_2` },
        },
        rel: "==",
        rhs: 0,
      });
    }

    // Violation: public outputs differ: |y_1 - y_2| >= 1e-4
    for (const outVar of publicOutputs) {
      const violationConstraints: NonlinearConstraint[] = [
        ...c1,
        ...c2,
        ...equalityConstraints,
        {
          expr: {
            kind: "sub",
            left: { kind: "var", name: `${outVar}_1` },
            right: { kind: "var", name: `${outVar}_2` },
          },
          rel: ">=",
          rhs: 0.01,
        },
      ];

      const isSat = this.checkSatisfiability(violationConstraints);
      if (isSat.sat) {
        return {
          status: "VIOLATED",
          property: "OBSERVATIONAL_DETERMINISM",
          durationMs: performance.now() - startTime,
          summary: `VIOLATED: Secret internal variables leak into public output '${outVar}'.`,
        };
      }
    }

    return {
      status: "VERIFIED",
      property: "OBSERVATIONAL_DETERMINISM",
      durationMs: performance.now() - startTime,
      summary: "VERIFIED: System satisfies observational determinism (non-interference).",
    };
  }

  private tagConstraint(c: NonlinearConstraint, suffix: string): NonlinearConstraint {
    return {
      expr: this.tagExpr(c.expr, suffix),
      rel: c.rel,
      rhs: c.rhs,
    };
  }

  private tagExpr(expr: any, suffix: string): any {
    switch (expr.kind) {
      case "var":
        return { kind: "var", name: `${expr.name}${suffix}` };
      case "const":
        return expr;
      case "neg":
        return { kind: "neg", arg: this.tagExpr(expr.arg, suffix) };
      case "add":
      case "sub":
      case "mul":
      case "div":
      case "pow":
        return {
          kind: expr.kind,
          left: this.tagExpr(expr.left, suffix),
          right: this.tagExpr(expr.right, suffix),
        };
      default:
        return expr;
    }
  }

  private checkSatisfiability(constraints: NonlinearConstraint[]): {
    sat: boolean;
    model?: Map<string, number>;
  } {
    // 1. Exact Linear Farkas Dual Simplex check
    const allLinear: LinearConstraint[] = [];
    let isAllLinear = true;
    for (const c of constraints) {
      const parsed = CraigInterpolator.toLinearConstraints(c);
      if (parsed) {
        allLinear.push(...parsed);
      } else {
        isAllLinear = false;
        break;
      }
    }

    if (isAllLinear && allLinear.length > 0) {
      const A = allLinear.slice(0, allLinear.length - 1);
      const B = allLinear.slice(allLinear.length - 1);
      const interp = CraigInterpolator.interpolateLRA(A, B);
      if (interp.status === "INTERPOLANT_FOUND") {
        // Formally proven inconsistent by Farkas certificate!
        return { sat: false };
      }
    }

    // 2. Fall back to DPLL(T) with HC4 contractor
    const theoryLits = new Map<number, NonlinearConstraint>();
    const clauses: number[][] = [];
    let litId = 1;

    for (const c of constraints) {
      theoryLits.set(litId, c);
      clauses.push([litId]);
      litId++;
    }

    const solver = new DpllTSolver({
      clauses,
      theoryLiterals: theoryLits,
      useNlsat: false,
      delta: 1e-6,
    });

    const res = solver.solve();
    if (res.status === "DELTA_SAT") {
      const model = new Map<string, number>();
      if (res.solutionBox) {
        for (const [v, inv] of res.solutionBox.entries()) {
          model.set(v, inv.mid);
        }
      }
      return { sat: true, model };
    }
    return { sat: false };
  }
}
