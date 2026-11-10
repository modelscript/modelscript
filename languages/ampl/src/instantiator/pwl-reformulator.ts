// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Piecewise-Linear (PWL), Semicontinuous/Semi-integer, and SOS1/SOS2 Reformulator.
 */

import type {
  FlatExpression,
  InstantiatedConstraint,
  InstantiatedProblem,
  InstantiatedVar,
  SosSet,
} from "../types.js";
import { evaluatePiecewiseScalar } from "./set-evaluator.js";

/**
 * Expands semicontinuous (`semicont`), semi-integer (`semiint`), and SOS1/SOS2 (`sosno`, `ref`)
 * variable attributes into explicit mixed-integer linear constraints and SOS sets.
 */
export function reformulateSemicontAndSos(
  problem: InstantiatedProblem,
  defaultBigM = 1e4,
): void {
  const vars = problem.variables;
  const origLen = vars.length;

  // 1. Semicontinuous and Semi-integer variables: x in {0} U [semiLb, ub]
  for (let i = 0; i < origLen; i++) {
    const v = vars[i]!;
    if (v.type === "semicont" || v.type === "semiint") {
      const L = v.semiLb ?? (v.lb > 0 ? v.lb : 1);
      const U = Number.isFinite(v.ub) && v.ub < 1e15 ? v.ub : Math.max(L * 10, defaultBigM);

      // Create binary switch z in {0, 1}
      const zId = vars.length;
      const zName = `_aux_semi_${v.name}`;
      const zVar: InstantiatedVar = {
        id: zId,
        name: zName,
        baseName: "_aux_semi",
        indices: [v.name],
        type: "binary",
        lb: 0,
        ub: 1,
        initVal: v.initVal > 0 ? 1 : 0,
      };
      vars.push(zVar);
      problem.varNameMap.set(zName, zId);

      // Update x variable bounds to [0, U] and type to continuous or integer
      v.lb = 0;
      v.ub = U;
      v.type = v.type === "semiint" ? "integer" : "continuous";

      // Constraint 1: x - L * z >= 0
      problem.constraints.push({
        id: problem.constraints.length,
        name: `_aux_semi_lb_${v.name}`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: v.id, coeff: 1 },
            { varId: zId, coeff: -L },
          ],
        },
        lb: 0,
        ub: Number.POSITIVE_INFINITY,
      });

      // Constraint 2: x - U * z <= 0
      problem.constraints.push({
        id: problem.constraints.length,
        name: `_aux_semi_ub_${v.name}`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: v.id, coeff: 1 },
            { varId: zId, coeff: -U },
          ],
        },
        lb: Number.NEGATIVE_INFINITY,
        ub: 0,
      });

      problem.problemClass = problem.problemClass === "NLP" ? "MINLP" : "MILP";
    }
  }

  // 2. SOS1 and SOS2 sets from `.sosno` and `.ref`
  const sosGroups = new Map<number, { varId: number; weight: number }[]>();
  for (let i = 0; i < origLen; i++) {
    const v = vars[i]!;
    if (v.sosno !== undefined && v.sosno !== 0) {
      let grp = sosGroups.get(v.sosno);
      if (!grp) {
        grp = [];
        sosGroups.set(v.sosno, grp);
      }
      grp.push({ varId: v.id, weight: v.ref ?? i + 1 });
    }
  }

  if (sosGroups.size > 0) {
    if (!problem.sosSets) problem.sosSets = [];
    for (const [sosno, members] of sosGroups.entries()) {
      members.sort((a, b) => a.weight - b.weight);
      const sosType: 1 | 2 = sosno > 0 ? 1 : 2;
      const sosSet: SosSet = {
        id: Math.abs(sosno),
        type: sosType,
        name: `SOS_${sosType}_${Math.abs(sosno)}`,
        members,
      };
      problem.sosSets.push(sosSet);

      // Add binary support indicators so standard MILP solvers enforce SOS1 / SOS2
      const binIds: number[] = [];
      for (const m of members) {
        const mv = vars[m.varId]!;
        const U = Number.isFinite(mv.ub) && mv.ub < 1e15 ? mv.ub : defaultBigM;
        const L = Number.isFinite(mv.lb) && mv.lb > -1e15 ? mv.lb : 0;

        const bId = vars.length;
        const bName = `_aux_sos_${ Math.abs(sosno) }_${mv.name}`;
        vars.push({
          id: bId,
          name: bName,
          baseName: "_aux_sos",
          indices: [mv.name],
          type: "binary",
          lb: 0,
          ub: 1,
          initVal: 0,
        });
        problem.varNameMap.set(bName, bId);
        binIds.push(bId);

        // Link: L * b <= x <= U * b
        if (U > 0) {
          problem.constraints.push({
            id: problem.constraints.length,
            name: `_aux_sos_ub_${mv.name}`,
            expr: {
              constant: 0,
              linearTerms: [
                { varId: mv.id, coeff: 1 },
                { varId: bId, coeff: -U },
              ],
            },
            lb: Number.NEGATIVE_INFINITY,
            ub: 0,
          });
        }
        if (L < 0) {
          problem.constraints.push({
            id: problem.constraints.length,
            name: `_aux_sos_lb_${mv.name}`,
            expr: {
              constant: 0,
              linearTerms: [
                { varId: mv.id, coeff: 1 },
                { varId: bId, coeff: -L },
              ],
            },
            lb: 0,
            ub: Number.POSITIVE_INFINITY,
          });
        }
      }

      if (sosType === 1) {
        // SOS1: sum(b_k) <= 1
        problem.constraints.push({
          id: problem.constraints.length,
          name: `_aux_sos1_card_${Math.abs(sosno)}`,
          expr: {
            constant: 0,
            linearTerms: binIds.map((id) => ({ varId: id, coeff: 1 })),
          },
          lb: Number.NEGATIVE_INFINITY,
          ub: 1,
        });
      } else {
        // SOS2: sum(b_k) <= 2 and non-adjacent pairs b_p + b_q <= 1 for |p - q| > 1
        problem.constraints.push({
          id: problem.constraints.length,
          name: `_aux_sos2_card_${Math.abs(sosno)}`,
          expr: {
            constant: 0,
            linearTerms: binIds.map((id) => ({ varId: id, coeff: 1 })),
          },
          lb: Number.NEGATIVE_INFINITY,
          ub: 2,
        });
        for (let p = 0; p < binIds.length; p++) {
          for (let q = p + 2; q < binIds.length; q++) {
            problem.constraints.push({
              id: problem.constraints.length,
              name: `_aux_sos2_adj_${Math.abs(sosno)}_${p}_${q}`,
              expr: {
                constant: 0,
                linearTerms: [
                  { varId: binIds[p]!, coeff: 1 },
                  { varId: binIds[q]!, coeff: 1 },
                ],
              },
              lb: Number.NEGATIVE_INFINITY,
              ub: 1,
            });
          }
        }
      }

      problem.problemClass = problem.problemClass === "NLP" ? "MINLP" : "MILP";
    }
  }
}

/**
 * Synthesizes linear/MILP variables and constraints for a piecewise-linear term
 * `<<breakpoints; slopes>> (argExpr, zeroPoint)` and returns the FlatExpression for the PWL result.
 */
export function instantiatePiecewiseLinearTerm(
  breakpoints: number[],
  slopes: number[],
  argFlat: FlatExpression,
  zeroPoint: number,
  variables: InstantiatedVar[],
  varNameMap: Map<string, number>,
  constraints: InstantiatedConstraint[],
  onMilpCreated: () => void,
): FlatExpression {
  if (slopes.length !== breakpoints.length + 1) {
    throw new Error(
      `Piecewise-linear term requires exactly n+1 slopes for n breakpoints (got ${breakpoints.length} breakpoints and ${slopes.length} slopes).`,
    );
  }

  // Sort breakpoints ascending
  const k = breakpoints.length;
  if (k === 0) {
    // Single slope s_1 * (arg - x0)
    const s = slopes[0]!;
    return {
      constant: s * (argFlat.constant - zeroPoint),
      linearTerms: argFlat.linearTerms.map((t) => ({ varId: t.varId, coeff: s * t.coeff })),
    };
  }

  // Create auxiliary variable w representing f(u)
  const pwlId = variables.length;
  const wName = `_aux_pwl_w_${pwlId}`;
  variables.push({
    id: pwlId,
    name: wName,
    baseName: "_aux_pwl_w",
    indices: [pwlId],
    type: "continuous",
    lb: Number.NEGATIVE_INFINITY,
    ub: Number.POSITIVE_INFINITY,
    initVal: 0,
  });
  varNameMap.set(wName, pwlId);

  // Check if slopes are monotonically non-decreasing (convex)
  let isConvex = true;
  for (let i = 0; i < slopes.length - 1; i++) {
    if (slopes[i + 1]! < slopes[i]! - 1e-12) {
      isConvex = false;
      break;
    }
  }

  if (isConvex) {
    // Epigraph linear inequalities: for each segment m in 0..k, w >= f(p_m) + s_{m+1} * (u - p_m)
    // => w - s_{m+1} * u >= f(p_m) - s_{m+1} * p_m
    for (let m = 0; m <= k; m++) {
      const slope = slopes[m]!;
      const p_m = m === 0 ? breakpoints[0]! : breakpoints[m - 1]!;
      const f_pm = evaluatePiecewiseScalar(breakpoints, slopes, p_m, zeroPoint);

      // w - slope * (arg.constant + sum coeff_j x_j) >= f_pm - slope * p_m
      // w - sum (slope * coeff_j) x_j >= f_pm - slope * p_m + slope * arg.constant
      const rhs = f_pm - slope * p_m + slope * argFlat.constant;
      const terms = [{ varId: pwlId, coeff: 1 }];
      for (const t of argFlat.linearTerms) {
        terms.push({ varId: t.varId, coeff: -slope * t.coeff });
      }
      constraints.push({
        id: constraints.length,
        name: `_aux_pwl_epi_${pwlId}_${m}`,
        expr: { constant: 0, linearTerms: terms },
        lb: rhs,
        ub: Number.POSITIVE_INFINITY,
      });
    }

    return {
      constant: 0,
      linearTerms: [{ varId: pwlId, coeff: 1 }],
    };
  }

  // Non-convex PWL: Incremental MILP formulation
  onMilpCreated();

  // Infer lower and upper bounds on u = argFlat
  let uLB = argFlat.constant;
  let uUB = argFlat.constant;
  for (const t of argFlat.linearTerms) {
    const v = variables[t.varId]!;
    const vlb = Number.isFinite(v.lb) && v.lb > -1e12 ? v.lb : Math.min(0, breakpoints[0]! - 100);
    const vub = Number.isFinite(v.ub) && v.ub < 1e12 ? v.ub : Math.max(100, breakpoints[k - 1]! + 100);
    if (t.coeff >= 0) {
      uLB += t.coeff * vlb;
      uUB += t.coeff * vub;
    } else {
      uLB += t.coeff * vub;
      uUB += t.coeff * vlb;
    }
  }
  const B0 = Math.min(uLB, breakpoints[0]! - 10);
  const Bk1 = Math.max(uUB, breakpoints[k - 1]! + 10);
  const pts = [B0, ...breakpoints, Bk1];

  const deltaIds: number[] = [];
  const zIds: number[] = [];

  for (let m = 0; m <= k; m++) {
    const segLen = Math.max(0, pts[m + 1]! - pts[m]!);
    const dId = variables.length;
    const dName = `_aux_pwl_d_${pwlId}_${m}`;
    variables.push({
      id: dId,
      name: dName,
      baseName: "_aux_pwl_d",
      indices: [pwlId, m],
      type: "continuous",
      lb: 0,
      ub: segLen,
      initVal: 0,
    });
    varNameMap.set(dName, dId);
    deltaIds.push(dId);

    if (m < k) {
      const zId = variables.length;
      const zName = `_aux_pwl_z_${pwlId}_${m}`;
      variables.push({
        id: zId,
        name: zName,
        baseName: "_aux_pwl_z",
        indices: [pwlId, m],
        type: "binary",
        lb: 0,
        ub: 1,
        initVal: 0,
      });
      varNameMap.set(zName, zId);
      zIds.push(zId);
    }
  }

  // Incremental ordering:
  // delta_0 >= (pts[1] - pts[0]) * z_0  => delta_0 - L_0 * z_0 >= 0
  // For m = 1..k-1: L_m * z_m <= delta_m <= L_m * z_{m-1}
  // delta_k <= L_k * z_{k-1}
  for (let m = 0; m <= k; m++) {
    const Lm = Math.max(0, pts[m + 1]! - pts[m]!);
    if (m < k) {
      // delta_m - Lm * z_m >= 0
      constraints.push({
        id: constraints.length,
        name: `_aux_pwl_inc_lb_${pwlId}_${m}`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: deltaIds[m]!, coeff: 1 },
            { varId: zIds[m]!, coeff: -Lm },
          ],
        },
        lb: 0,
        ub: Number.POSITIVE_INFINITY,
      });
    }
    if (m > 0) {
      // delta_m - Lm * z_{m-1} <= 0
      constraints.push({
        id: constraints.length,
        name: `_aux_pwl_inc_ub_${pwlId}_${m}`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: deltaIds[m]!, coeff: 1 },
            { varId: zIds[m - 1]!, coeff: -Lm },
          ],
        },
        lb: Number.NEGATIVE_INFINITY,
        ub: 0,
      });
    }
  }

  // Link argument: u - sum(delta_m) == B0  => sum(coeff_j x_j) - sum(delta_m) == B0 - arg.constant
  const uTerms = argFlat.linearTerms.map((t) => ({ varId: t.varId, coeff: t.coeff }));
  for (const dId of deltaIds) {
    uTerms.push({ varId: dId, coeff: -1 });
  }
  constraints.push({
    id: constraints.length,
    name: `_aux_pwl_arg_${pwlId}`,
    expr: { constant: 0, linearTerms: uTerms },
    lb: B0 - argFlat.constant,
    ub: B0 - argFlat.constant,
  });

  // Link value: w - sum(s_{m+1} * delta_m) == f(B0)
  const fB0 = evaluatePiecewiseScalar(breakpoints, slopes, B0, zeroPoint);
  const wTerms = [{ varId: pwlId, coeff: 1 }];
  for (let m = 0; m <= k; m++) {
    wTerms.push({ varId: deltaIds[m]!, coeff: -slopes[m]! });
  }
  constraints.push({
    id: constraints.length,
    name: `_aux_pwl_val_${pwlId}`,
    expr: { constant: 0, linearTerms: wTerms },
    lb: fB0,
    ub: fB0,
  });

  return {
    constant: 0,
    linearTerms: [{ varId: pwlId, coeff: 1 }],
  };
}
