// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Mathematical Programming with Equilibrium / Complementarity Constraints (MPEC) Reformulator.
 *
 * Supports two lowering modes for `c1 complements c2`:
 * 1. `"milp"` (default): Exact Fortuny-Amat & McCarl disjunctive MILP reformulation with inferred Big-M bounds.
 * 2. `"nlp"`: Smooth Fischer-Burmeister function $\phi_{FB}(a, b) = a + b - \sqrt{a^2 + b^2 + \epsilon} = 0$.
 */

import type {
  FlatAffineTerm,
  FlatExpression,
  InstantiatedConstraint,
  InstantiatedProblem,
} from "../types.js";
import { computeLinearBounds } from "./mp-reformulator.js";

function toNonNegativeSlack(
  expr: FlatExpression,
  lb: number,
  ub: number,
): { terms: FlatAffineTerm[]; constant: number } {
  const hasLB = Number.isFinite(lb) && lb > -1e15;
  const hasUB = Number.isFinite(ub) && ub < 1e15;

  if (hasLB && !hasUB) {
    // expr >= lb  =>  slack = expr - lb >= 0
    return {
      terms: expr.linearTerms.map((t) => ({ varId: t.varId, coeff: t.coeff })),
      constant: expr.constant - lb,
    };
  }
  if (hasUB && !hasLB) {
    // expr <= ub  =>  slack = ub - expr >= 0
    return {
      terms: expr.linearTerms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
      constant: ub - expr.constant,
    };
  }
  // Default: expr - (hasLB ? lb : 0) >= 0
  const ref = hasLB ? lb : 0;
  return {
    terms: expr.linearTerms.map((t) => ({ varId: t.varId, coeff: t.coeff })),
    constant: expr.constant - ref,
  };
}

/**
 * Reformulates all constraints carrying a `.complements` clause in `problem`.
 */
export function reformulateMpecComplements(
  problem: InstantiatedProblem,
  mode: "milp" | "nlp" = "milp",
  defaultBigM = 1e4,
): void {
  const newConstraints: InstantiatedConstraint[] = [];

  for (const con of problem.constraints) {
    if (!con.complements) {
      newConstraints.push(con);
      continue;
    }

    const s1 = toNonNegativeSlack(con.expr, con.lb, con.ub);
    const s2 = toNonNegativeSlack(con.complements.expr, con.complements.lb, con.complements.ub);

    // 1. Enforce s1 >= 0: sum(s1.terms) >= -s1.constant
    newConstraints.push({
      id: newConstraints.length,
      name: `${con.name}_comp_s1_ge0`,
      expr: { constant: 0, linearTerms: s1.terms },
      lb: -s1.constant,
      ub: Number.POSITIVE_INFINITY,
    });

    // 2. Enforce s2 >= 0: sum(s2.terms) >= -s2.constant
    newConstraints.push({
      id: newConstraints.length,
      name: `${con.name}_comp_s2_ge0`,
      expr: { constant: 0, linearTerms: s2.terms },
      lb: -s2.constant,
      ub: Number.POSITIVE_INFINITY,
    });

    if (mode === "milp") {
      // Fortuny-Amat & McCarl disjunctive MILP reformulation:
      // Binary z in {0, 1}:
      //   s1 <= M1 * z       => sum(s1.terms) - M1 * z <= -s1.constant
      //   s2 <= M2 * (1 - z) => sum(s2.terms) + M2 * z <= M2 - s2.constant
      const b1 = computeLinearBounds(s1.terms, problem.variables, defaultBigM);
      const b2 = computeLinearBounds(s2.terms, problem.variables, defaultBigM);
      const M1 = Math.max(10, b1.maxActivity + s1.constant);
      const M2 = Math.max(10, b2.maxActivity + s2.constant);

      const zId = problem.variables.length;
      const zName = `_aux_mpec_z_${con.name}`;
      problem.variables.push({
        id: zId,
        name: zName,
        baseName: "_aux_mpec_z",
        indices: [con.name],
        type: "binary",
        lb: 0,
        ub: 1,
        initVal: 0,
      });
      problem.varNameMap.set(zName, zId);

      newConstraints.push({
        id: newConstraints.length,
        name: `${con.name}_comp_s1_ub`,
        expr: {
          constant: 0,
          linearTerms: [...s1.terms, { varId: zId, coeff: -M1 }],
        },
        lb: Number.NEGATIVE_INFINITY,
        ub: -s1.constant,
      });

      newConstraints.push({
        id: newConstraints.length,
        name: `${con.name}_comp_s2_ub`,
        expr: {
          constant: 0,
          linearTerms: [...s2.terms, { varId: zId, coeff: M2 }],
        },
        lb: Number.NEGATIVE_INFINITY,
        ub: M2 - s2.constant,
      });

      problem.problemClass = problem.problemClass === "NLP" ? "MINLP" : "MILP";
    } else {
      // Smooth Fischer-Burmeister reformulation:
      // Introduce slack vars y1 >= 0, y2 >= 0 such that y1 == s1, y2 == s2,
      // and y1 + y2 - sqrt(y1^2 + y2^2 + 1e-8) == 0.
      const y1Id = problem.variables.length;
      const y1Name = `_aux_mpec_y1_${con.name}`;
      problem.variables.push({
        id: y1Id,
        name: y1Name,
        baseName: "_aux_mpec_y1",
        indices: [con.name],
        type: "continuous",
        lb: 0,
        ub: Number.POSITIVE_INFINITY,
        initVal: 0.1,
      });
      problem.varNameMap.set(y1Name, y1Id);

      const y2Id = problem.variables.length;
      const y2Name = `_aux_mpec_y2_${con.name}`;
      problem.variables.push({
        id: y2Id,
        name: y2Name,
        baseName: "_aux_mpec_y2",
        indices: [con.name],
        type: "continuous",
        lb: 0,
        ub: Number.POSITIVE_INFINITY,
        initVal: 0.1,
      });
      problem.varNameMap.set(y2Name, y2Id);

      // y1 - sum(s1.terms) == s1.constant
      newConstraints.push({
        id: newConstraints.length,
        name: `${con.name}_comp_y1_def`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: y1Id, coeff: 1 },
            ...s1.terms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
          ],
        },
        lb: s1.constant,
        ub: s1.constant,
      });

      // y2 - sum(s2.terms) == s2.constant
      newConstraints.push({
        id: newConstraints.length,
        name: `${con.name}_comp_y2_def`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: y2Id, coeff: 1 },
            ...s2.terms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
          ],
        },
        lb: s2.constant,
        ub: s2.constant,
      });

      // Smooth FB constraint: y1 + y2 - sqrt(y1^2 + y2^2 + 1e-8) == 0
      newConstraints.push({
        id: newConstraints.length,
        name: `${con.name}_comp_fb`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: y1Id, coeff: 1 },
            { varId: y2Id, coeff: 1 },
          ],
          nonlinearTree: {
            kind: "unary",
            op: "-",
            expr: {
              kind: "call",
              fn: "sqrt",
              args: [
                {
                  kind: "binary",
                  op: "+",
                  left: {
                    kind: "binary",
                    op: "+",
                    left: {
                      kind: "binary",
                      op: "^",
                      left: { kind: "identifier", name: y1Name },
                      right: { kind: "number", value: 2 },
                    },
                    right: {
                      kind: "binary",
                      op: "^",
                      left: { kind: "identifier", name: y2Name },
                      right: { kind: "number", value: 2 },
                    },
                  },
                  right: { kind: "number", value: 1e-8 },
                },
              ],
            },
          },
        },
        lb: 0,
        ub: 0,
      });

      problem.problemClass =
        problem.problemClass === "MILP" || problem.problemClass === "MINLP" ? "MINLP" : "NLP";
    }
  }

  problem.constraints = newConstraints;
}
