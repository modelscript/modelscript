// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — MP-Style Logical, Disjunctive, Indicator, CP (`alldiff`, `atleast`, `atmost`, `exactly`),
 * and Non-Smooth (`abs`, `min`, `max`) Constraint Reformulator.
 */

import type {
  AmplExpr,
  FlatAffineTerm,
  FlatExpression,
  InstantiatedConstraint,
  InstantiatedVar,
  SetElement,
} from "../types.js";
import type { SetEvaluator } from "./set-evaluator.js";

export interface MpReformulatorContext {
  variables: InstantiatedVar[];
  varNameMap: Map<string, number>;
  constraints: InstantiatedConstraint[];
  setEval: SetEvaluator;
  evaluateFlat: (expr: AmplExpr, env: Map<string, SetElement>) => FlatExpression;
  subtractFlat: (a: FlatExpression, b: FlatExpression) => FlatExpression;
  onMilpCreated: () => void;
  defaultBigM?: number | undefined;
}

/**
 * Computes tight upper and lower activity bounds $[L, U]$ on a linear expression $\sum a_j x_j$
 * from variable bounds $[l_j, u_j]$, falling back to `defaultBigM` when unbounded.
 */
export function computeLinearBounds(
  terms: FlatAffineTerm[],
  variables: InstantiatedVar[],
  defaultBigM = 1e4,
): { minActivity: number; maxActivity: number } {
  let minAct = 0;
  let maxAct = 0;
  for (const t of terms) {
    const v = variables[t.varId];
    const lb = v && Number.isFinite(v.lb) && v.lb > -1e12 ? v.lb : -defaultBigM;
    const ub = v && Number.isFinite(v.ub) && v.ub < 1e12 ? v.ub : defaultBigM;
    if (t.coeff >= 0) {
      minAct += t.coeff * lb;
      maxAct += t.coeff * ub;
    } else {
      minAct += t.coeff * ub;
      maxAct += t.coeff * lb;
    }
  }
  return { minActivity: minAct, maxActivity: maxAct };
}

/**
 * Reformulates `abs(arg)`, `max(args...)`, or `min(args...)` when arguments are affine expressions.
 */
export function instantiateNonSmoothCall(
  fn: "abs" | "max" | "min",
  argFlats: FlatExpression[],
  ctx: MpReformulatorContext,
): FlatExpression {
  const id = ctx.variables.length;
  const auxName = `_aux_mp_${fn}_${id}`;
  ctx.variables.push({
    id,
    name: auxName,
    baseName: `_aux_mp_${fn}`,
    indices: [id],
    type: "continuous",
    lb: fn === "abs" ? 0 : Number.NEGATIVE_INFINITY,
    ub: Number.POSITIVE_INFINITY,
    initVal: 0,
  });
  ctx.varNameMap.set(auxName, id);

  if (fn === "abs") {
    const u = argFlats[0]!;
    // t >= u  =>  t - sum(a_j x_j) >= u.constant
    ctx.constraints.push({
      id: ctx.constraints.length,
      name: `_aux_mp_abs_pos_${id}`,
      expr: {
        constant: 0,
        linearTerms: [
          { varId: id, coeff: 1 },
          ...u.linearTerms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
        ],
      },
      lb: u.constant,
      ub: Number.POSITIVE_INFINITY,
    });
    // t >= -u  =>  t + sum(a_j x_j) >= -u.constant
    ctx.constraints.push({
      id: ctx.constraints.length,
      name: `_aux_mp_abs_neg_${id}`,
      expr: {
        constant: 0,
        linearTerms: [
          { varId: id, coeff: 1 },
          ...u.linearTerms.map((t) => ({ varId: t.varId, coeff: t.coeff })),
        ],
      },
      lb: -u.constant,
      ub: Number.POSITIVE_INFINITY,
    });
  } else if (fn === "max") {
    for (let k = 0; k < argFlats.length; k++) {
      const u = argFlats[k]!;
      // t >= u_k  =>  t - sum(a_j x_j) >= u_k.constant
      ctx.constraints.push({
        id: ctx.constraints.length,
        name: `_aux_mp_max_${id}_${k}`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: id, coeff: 1 },
            ...u.linearTerms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
          ],
        },
        lb: u.constant,
        ub: Number.POSITIVE_INFINITY,
      });
    }
  } else if (fn === "min") {
    for (let k = 0; k < argFlats.length; k++) {
      const u = argFlats[k]!;
      // t <= u_k  =>  t - sum(a_j x_j) <= u_k.constant
      ctx.constraints.push({
        id: ctx.constraints.length,
        name: `_aux_mp_min_${id}_${k}`,
        expr: {
          constant: 0,
          linearTerms: [
            { varId: id, coeff: 1 },
            ...u.linearTerms.map((t) => ({ varId: t.varId, coeff: -t.coeff })),
          ],
        },
        lb: Number.NEGATIVE_INFINITY,
        ub: u.constant,
      });
    }
  }

  return {
    constant: 0,
    linearTerms: [{ varId: id, coeff: 1 }],
  };
}

/**
 * Lowers a logical/CP constraint (implication `==>`, equivalence `<==>`, disjunction `or`,
 * `alldiff`, `atleast`, `atmost`, `exactly`) into MILP constraints.
 */
export function instantiateLogicalConstraint(
  conName: string,
  logicExpr: AmplExpr,
  env: Map<string, SetElement>,
  ctx: MpReformulatorContext,
): void {
  const bigM = ctx.defaultBigM ?? 1e4;
  ctx.onMilpCreated();

  // Case 1: CP calls `alldiff`, `atleast`, `atmost`, `exactly`
  if (logicExpr.kind === "call") {
    const fn = logicExpr.fn.toLowerCase();
    if (fn === "alldiff") {
      const arg = logicExpr.args[0];
      if (!arg) return;
      const varIds: number[] = [];
      if (arg.kind === "reduction" && arg.reduction === "count") {
        const combos = ctx.setEval.generateCombinations({ iterators: arg.iterators }, env);
        for (const cEnv of combos) {
          const flat = ctx.evaluateFlat(arg.expr, cEnv);
          if (flat.linearTerms.length === 1 && Math.abs(flat.linearTerms[0]!.coeff - 1) < 1e-9) {
            varIds.push(flat.linearTerms[0]!.varId);
          }
        }
      }
      // Pairwise disequality: for all p < q, |x_p - x_q| >= 1
      for (let p = 0; p < varIds.length; p++) {
        for (let q = p + 1; q < varIds.length; q++) {
          const vp = ctx.variables[varIds[p]!]!;
          const vq = ctx.variables[varIds[q]!]!;
          const up = Number.isFinite(vp.ub) && vp.ub < 1e12 ? vp.ub : 100;
          const lp = Number.isFinite(vp.lb) && vp.lb > -1e12 ? vp.lb : 0;
          const uq = Number.isFinite(vq.ub) && vq.ub < 1e12 ? vq.ub : 100;
          const lq = Number.isFinite(vq.lb) && vq.lb > -1e12 ? vq.lb : 0;
          const M = Math.max(up - lq, uq - lp) + 1;

          const zId = ctx.variables.length;
          const zName = `_aux_mp_alldiff_${conName}_${p}_${q}`;
          ctx.variables.push({
            id: zId,
            name: zName,
            baseName: "_aux_mp_alldiff",
            indices: [p, q],
            type: "binary",
            lb: 0,
            ub: 1,
            initVal: 0,
          });
          ctx.varNameMap.set(zName, zId);

          // vp - vq + M * z >= 1
          ctx.constraints.push({
            id: ctx.constraints.length,
            name: `${conName}_alldiff_a_${p}_${q}`,
            expr: {
              constant: 0,
              linearTerms: [
                { varId: vp.id, coeff: 1 },
                { varId: vq.id, coeff: -1 },
                { varId: zId, coeff: M },
              ],
            },
            lb: 1,
            ub: Number.POSITIVE_INFINITY,
          });

          // vq - vp - M * z >= 1 - M
          ctx.constraints.push({
            id: ctx.constraints.length,
            name: `${conName}_alldiff_b_${p}_${q}`,
            expr: {
              constant: 0,
              linearTerms: [
                { varId: vq.id, coeff: 1 },
                { varId: vp.id, coeff: -1 },
                { varId: zId, coeff: -M },
              ],
            },
            lb: 1 - M,
            ub: Number.POSITIVE_INFINITY,
          });
        }
      }
      return;
    }

    if (fn === "atleast" || fn === "atmost" || fn === "exactly") {
      const kVal = ctx.setEval.evalScalar(logicExpr.args[0]!, env);
      const countArg = logicExpr.args[1];
      if (!countArg || countArg.kind !== "reduction") return;

      const combos = ctx.setEval.generateCombinations({ iterators: countArg.iterators }, env);
      const indIds: number[] = [];

      for (let idx = 0; idx < combos.length; idx++) {
        const cEnv = combos[idx]!;
        const zId = reifyCondition(`${conName}_${idx}`, countArg.expr, cEnv, ctx, bigM);
        indIds.push(zId);
      }

      const terms = indIds.map((id) => ({ varId: id, coeff: 1 }));
      ctx.constraints.push({
        id: ctx.constraints.length,
        name: `${conName}_card`,
        expr: { constant: 0, linearTerms: terms },
        lb: fn === "atleast" || fn === "exactly" ? kVal : Number.NEGATIVE_INFINITY,
        ub: fn === "atmost" || fn === "exactly" ? kVal : Number.POSITIVE_INFINITY,
      });
      return;
    }
  }

  // Case 2: Binary logical connectives (`==>`, `<==>`, `or`, `and`)
  if (logicExpr.kind === "binary") {
    if (logicExpr.op === "and") {
      instantiateLogicalConstraint(`${conName}_L`, logicExpr.left, env, ctx);
      instantiateLogicalConstraint(`${conName}_R`, logicExpr.right, env, ctx);
      return;
    }

    if (logicExpr.op === "==>") {
      // Check if left is a direct binary indicator `b = 1` or `b = 0` or identifier `b`
      const binCond = extractBinaryIndicator(logicExpr.left, env, ctx);
      if (binCond) {
        enforceIndicatorImplication(
          conName,
          binCond.varId,
          binCond.activeValue,
          logicExpr.right,
          env,
          ctx,
          bigM,
        );
        return;
      }
      // General implication P ==> Q is equivalent to (not P) or Q
      const zId = createAuxBinary(`${conName}_imp`, ctx);
      enforceNegatedConditionWhenZero(`${conName}_ant`, zId, logicExpr.left, env, ctx, bigM);
      enforceIndicatorImplication(`${conName}_cons`, zId, 1, logicExpr.right, env, ctx, bigM);
      return;
    }

    if (logicExpr.op === "<==>") {
      instantiateLogicalConstraint(
        `${conName}_fwd`,
        { kind: "binary", op: "==>", left: logicExpr.left, right: logicExpr.right },
        env,
        ctx,
      );
      instantiateLogicalConstraint(
        `${conName}_rev`,
        { kind: "binary", op: "==>", left: logicExpr.right, right: logicExpr.left },
        env,
        ctx,
      );
      return;
    }

    if (logicExpr.op === "or") {
      // P or Q: binary z in {0, 1}; z = 0 ==> P, z = 1 ==> Q
      const zId = createAuxBinary(`${conName}_or`, ctx);
      enforceIndicatorImplication(`${conName}_orL`, zId, 0, logicExpr.left, env, ctx, bigM);
      enforceIndicatorImplication(`${conName}_orR`, zId, 1, logicExpr.right, env, ctx, bigM);
      return;
    }
  }
}

function createAuxBinary(tag: string, ctx: MpReformulatorContext): number {
  const zId = ctx.variables.length;
  const zName = `_aux_mp_bin_${tag}_${zId}`;
  ctx.variables.push({
    id: zId,
    name: zName,
    baseName: "_aux_mp_bin",
    indices: [zId],
    type: "binary",
    lb: 0,
    ub: 1,
    initVal: 0,
  });
  ctx.varNameMap.set(zName, zId);
  return zId;
}

function extractBinaryIndicator(
  expr: AmplExpr,
  env: Map<string, SetElement>,
  ctx: MpReformulatorContext,
): { varId: number; activeValue: 0 | 1 } | undefined {
  if (expr.kind === "identifier" || expr.kind === "subscript") {
    const flat = ctx.evaluateFlat(expr, env);
    if (flat.linearTerms.length === 1 && Math.abs(flat.linearTerms[0]!.coeff - 1) < 1e-9 && Math.abs(flat.constant) < 1e-9) {
      const v = ctx.variables[flat.linearTerms[0]!.varId];
      if (v && (v.type === "binary" || (v.lb === 0 && v.ub === 1))) {
        return { varId: v.id, activeValue: 1 };
      }
    }
  }
  if (expr.kind === "unary" && (expr.op === "not" || expr.op === "!")) {
    const inner = extractBinaryIndicator(expr.expr, env, ctx);
    if (inner) {
      return { varId: inner.varId, activeValue: inner.activeValue === 1 ? 0 : 1 };
    }
  }
  if (expr.kind === "binary" && (expr.op === "=" || expr.op === "==")) {
    const leftFlat = ctx.evaluateFlat(expr.left, env);
    const rightFlat = ctx.evaluateFlat(expr.right, env);
    if (
      leftFlat.linearTerms.length === 1 &&
      Math.abs(leftFlat.linearTerms[0]!.coeff - 1) < 1e-9 &&
      rightFlat.linearTerms.length === 0
    ) {
      const v = ctx.variables[leftFlat.linearTerms[0]!.varId];
      const val = rightFlat.constant - leftFlat.constant;
      if (v && (Math.abs(val - 1) < 1e-9 || Math.abs(val) < 1e-9)) {
        return { varId: v.id, activeValue: Math.abs(val - 1) < 1e-9 ? 1 : 0 };
      }
    }
  }
  return undefined;
}

/**
 * Enforces: when `var[binVarId] == activeVal`, the relational condition `consequent` holds.
 */
function enforceIndicatorImplication(
  tag: string,
  binVarId: number,
  activeVal: 0 | 1,
  consequent: AmplExpr,
  env: Map<string, SetElement>,
  ctx: MpReformulatorContext,
  defaultBigM: number,
): void {
  if (consequent.kind === "binary" && (consequent.op === "<=" || consequent.op === ">=" || consequent.op === "=" || consequent.op === "==" || consequent.op === "<" || consequent.op === ">")) {
    const lhs = ctx.evaluateFlat(consequent.left, env);
    const rhs = ctx.evaluateFlat(consequent.right, env);
    const diff = ctx.subtractFlat(lhs, rhs); // sum(a_j x_j) + diff.constant (op) 0 => sum(a_j x_j) (op) -diff.constant
    const d = -diff.constant;
    const { minActivity, maxActivity } = computeLinearBounds(diff.linearTerms, ctx.variables, defaultBigM);

    const addLe = (suffix: string) => {
      // Enforce: sum(a_j x_j) <= d when bin == activeVal
      const M = Math.max(1, maxActivity - d);
      if (activeVal === 1) {
        // sum(a_j x_j) + M * b <= d + M
        ctx.constraints.push({
          id: ctx.constraints.length,
          name: `${tag}_${suffix}`,
          expr: {
            constant: 0,
            linearTerms: [...diff.linearTerms, { varId: binVarId, coeff: M }],
          },
          lb: Number.NEGATIVE_INFINITY,
          ub: d + M,
        });
      } else {
        // activeVal === 0: sum(a_j x_j) - M * b <= d
        ctx.constraints.push({
          id: ctx.constraints.length,
          name: `${tag}_${suffix}`,
          expr: {
            constant: 0,
            linearTerms: [...diff.linearTerms, { varId: binVarId, coeff: -M }],
          },
          lb: Number.NEGATIVE_INFINITY,
          ub: d,
        });
      }
    };

    const addGe = (suffix: string) => {
      // Enforce: sum(a_j x_j) >= d when bin == activeVal
      const M = Math.max(1, d - minActivity);
      if (activeVal === 1) {
        // sum(a_j x_j) - M * b >= d - M
        ctx.constraints.push({
          id: ctx.constraints.length,
          name: `${tag}_${suffix}`,
          expr: {
            constant: 0,
            linearTerms: [...diff.linearTerms, { varId: binVarId, coeff: -M }],
          },
          lb: d - M,
          ub: Number.POSITIVE_INFINITY,
        });
      } else {
        // activeVal === 0: sum(a_j x_j) + M * b >= d
        ctx.constraints.push({
          id: ctx.constraints.length,
          name: `${tag}_${suffix}`,
          expr: {
            constant: 0,
            linearTerms: [...diff.linearTerms, { varId: binVarId, coeff: M }],
          },
          lb: d,
          ub: Number.POSITIVE_INFINITY,
        });
      }
    };

    if (consequent.op === "<=" || consequent.op === "<") {
      addLe("le");
    } else if (consequent.op === ">=" || consequent.op === ">") {
      addGe("ge");
    } else if (consequent.op === "=" || consequent.op === "==") {
      addLe("eq_le");
      addGe("eq_ge");
    }
  }
}

function enforceNegatedConditionWhenZero(
  tag: string,
  zId: number,
  cond: AmplExpr,
  env: Map<string, SetElement>,
  ctx: MpReformulatorContext,
  defaultBigM: number,
): void {
  // When z == 0, `cond` must be violated (e.g. if cond is a^T x <= d, then when z == 0, a^T x >= d + 1e-3)
  if (cond.kind === "binary") {
    const eps = 1e-3;
    if (cond.op === "<=" || cond.op === "<") {
      enforceIndicatorImplication(
        tag,
        zId,
        0,
        {
          kind: "binary",
          op: ">=",
          left: cond.left,
          right: { kind: "binary", op: "+", left: cond.right, right: { kind: "number", value: eps } },
        },
        env,
        ctx,
        defaultBigM,
      );
    } else if (cond.op === ">=" || cond.op === ">") {
      enforceIndicatorImplication(
        tag,
        zId,
        0,
        {
          kind: "binary",
          op: "<=",
          left: cond.left,
          right: { kind: "binary", op: "-", left: cond.right, right: { kind: "number", value: eps } },
        },
        env,
        ctx,
        defaultBigM,
      );
    }
  }
}

function reifyCondition(
  tag: string,
  cond: AmplExpr,
  env: Map<string, SetElement>,
  ctx: MpReformulatorContext,
  defaultBigM: number,
): number {
  const direct = extractBinaryIndicator(cond, env, ctx);
  if (direct && direct.activeValue === 1) {
    return direct.varId;
  }
  const zId = createAuxBinary(tag, ctx);
  enforceIndicatorImplication(`${tag}_pos`, zId, 1, cond, env, ctx, defaultBigM);
  enforceNegatedConditionWhenZero(`${tag}_neg`, zId, cond, env, ctx, defaultBigM);
  return zId;
}
