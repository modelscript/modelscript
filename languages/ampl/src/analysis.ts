// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Geometry Extraction, Parameter Sweeps & Multi-Objective Pareto Analysis.
 */

import { instantiateAmpl } from "./instantiator/index.js";
import { parseAmplData } from "./parser/ampl-dat-parser.js";
import { parseAmplModel } from "./parser/ampl-mod-parser.js";
import { solveAmpl } from "./solvers/index.js";
import type { AmplModel, FlatExpression, InstantiatedProblem } from "./types.js";

export interface AmplGeometryVariable {
  id: number;
  name: string;
  type: string;
  lb: number | null;
  ub: number | null;
}

export interface AmplGeometryObjective {
  name: string;
  direction: "minimize" | "maximize";
  constant: number;
  linearCoeffs: Record<string, number>;
  isLinear: boolean;
}

export interface AmplGeometryConstraint {
  name: string;
  lb: number | null;
  ub: number | null;
  constant: number;
  linearCoeffs: Record<string, number>;
  isLinear: boolean;
}

export interface AmplGeometryParameter {
  name: string;
  value: number;
}

export interface AmplGeometryInfo {
  problemName: string;
  problemClass: string;
  variables: AmplGeometryVariable[];
  objectives: AmplGeometryObjective[];
  constraints: AmplGeometryConstraint[];
  parameters: AmplGeometryParameter[];
}

export interface AmplSweepTarget {
  targetType: "param" | "constraint_ub" | "constraint_lb" | "var_ub" | "var_lb";
  targetName: string;
  min: number;
  max: number;
  steps: number;
}

export interface AmplSweepPoint {
  p1: number;
  p2?: number | undefined;
  status: string;
  feasible: boolean;
  objectiveValue: number | null;
  variables: Record<string, number>;
}

export interface AmplSweepResult {
  mode: "1d" | "2d";
  target1: AmplSweepTarget;
  target2?: AmplSweepTarget | undefined;
  points: AmplSweepPoint[];
}

export interface AmplParetoPoint {
  paramValue: number;
  obj1Val: number;
  obj2Val: number;
  isPareto: boolean;
  status: string;
  variables: Record<string, number>;
}

export interface AmplParetoResult {
  mode: "bi-objective" | "constraint-tradeoff";
  obj1: { name: string; direction: "minimize" | "maximize" };
  obj2: { name: string; direction: "minimize" | "maximize" };
  points: AmplParetoPoint[];
}

function finiteOrNull(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

function extractLinearCoeffs(
  expr: FlatExpression,
  varNamesById: Map<number, string>,
): {
  linearCoeffs: Record<string, number>;
  isLinear: boolean;
} {
  const linearCoeffs: Record<string, number> = {};
  for (const term of expr.linearTerms) {
    const vName = varNamesById.get(term.varId);
    if (vName) {
      linearCoeffs[vName] = (linearCoeffs[vName] ?? 0) + term.coeff;
    }
  }
  const isLinear = (!expr.quadraticTerms || expr.quadraticTerms.length === 0) && !expr.nonlinearTree;
  return { linearCoeffs, isLinear };
}

function evalFlatLinear(expr: FlatExpression, varNamesById: Map<number, string>, sol: Record<string, number>): number {
  let sum = expr.constant;
  for (const term of expr.linearTerms) {
    const vName = varNamesById.get(term.varId);
    if (vName) {
      sum += term.coeff * (sol[vName] ?? 0);
    }
  }
  return sum;
}

export function inspectAmplGeometry(modelText: string, dataText?: string): AmplGeometryInfo {
  const model = parseAmplModel(modelText);
  const data = dataText ? parseAmplData(dataText) : undefined;
  const prob = instantiateAmpl(model, data);

  const varNamesById = new Map<number, string>();
  const variables: AmplGeometryVariable[] = prob.variables.map((v) => {
    varNamesById.set(v.id, v.name);
    return {
      id: v.id,
      name: v.name,
      type: v.type,
      lb: finiteOrNull(v.lb),
      ub: finiteOrNull(v.ub),
    };
  });

  const rawObjectives = prob.objectives && prob.objectives.length > 0 ? prob.objectives : [prob.objective];
  const objectives: AmplGeometryObjective[] = rawObjectives.map((obj) => {
    const { linearCoeffs, isLinear } = extractLinearCoeffs(obj.expr, varNamesById);
    return {
      name: obj.name,
      direction: obj.direction,
      constant: obj.expr.constant,
      linearCoeffs,
      isLinear,
    };
  });

  const constraints: AmplGeometryConstraint[] = prob.constraints
    .filter((c) => !c.dropped)
    .map((c) => {
      const { linearCoeffs, isLinear } = extractLinearCoeffs(c.expr, varNamesById);
      return {
        name: c.name,
        lb: finiteOrNull(c.lb),
        ub: finiteOrNull(c.ub),
        constant: c.expr.constant,
        linearCoeffs,
        isLinear,
      };
    });

  const parameters: AmplGeometryParameter[] = [];
  for (const [name, p] of model.params.entries()) {
    const expr = p.assignExpr;
    if (expr && expr.kind === "number" && Number.isFinite(expr.value)) {
      parameters.push({ name, value: expr.value });
    }
  }

  return {
    problemName: prob.name,
    problemClass: prob.problemClass,
    variables,
    objectives,
    constraints,
    parameters,
  };
}

function applySweepMutation(
  model: AmplModel,
  prob: InstantiatedProblem | null,
  target: AmplSweepTarget,
  value: number,
): void {
  if (target.targetType === "param") {
    const p = model.params.get(target.targetName);
    if (p) {
      p.assignExpr = { kind: "number", value };
    }
    return;
  }
  if (!prob) return;
  if (target.targetType === "constraint_ub") {
    const c = prob.constraints.find((con) => con.name === target.targetName);
    if (c) c.ub = value;
  } else if (target.targetType === "constraint_lb") {
    const c = prob.constraints.find((con) => con.name === target.targetName);
    if (c) c.lb = value;
  } else if (target.targetType === "var_ub") {
    const v = prob.variables.find((vr) => vr.name === target.targetName);
    if (v) v.ub = value;
  } else if (target.targetType === "var_lb") {
    const v = prob.variables.find((vr) => vr.name === target.targetName);
    if (v) v.lb = value;
  }
}

export async function sweepAmplParameter(
  modelText: string,
  params: {
    target1: AmplSweepTarget;
    target2?: AmplSweepTarget | undefined;
    dataText?: string | undefined;
  },
): Promise<AmplSweepResult> {
  const { target1, target2, dataText } = params;
  const data = dataText ? parseAmplData(dataText) : undefined;
  const steps1 = Math.max(2, Math.min(60, Math.round(target1.steps || 21)));
  const points: AmplSweepPoint[] = [];

  const runSingle = async (v1: number, v2?: number): Promise<AmplSweepPoint> => {
    const model = parseAmplModel(modelText);
    if (target1.targetType === "param") applySweepMutation(model, null, target1, v1);
    if (target2 && v2 !== undefined && target2.targetType === "param") {
      applySweepMutation(model, null, target2, v2);
    }
    const prob = instantiateAmpl(model, data);
    if (target1.targetType !== "param") applySweepMutation(model, prob, target1, v1);
    if (target2 && v2 !== undefined && target2.targetType !== "param") {
      applySweepMutation(model, prob, target2, v2);
    }
    try {
      const res = await solveAmpl(prob);
      const feasible = res.status === "OPTIMAL";
      return {
        p1: v1,
        ...(v2 !== undefined ? { p2: v2 } : {}),
        status: res.status,
        feasible,
        objectiveValue: feasible && Number.isFinite(res.objectiveValue) ? res.objectiveValue : null,
        variables: res.variables ?? {},
      };
    } catch {
      return {
        p1: v1,
        ...(v2 !== undefined ? { p2: v2 } : {}),
        status: "INFEASIBLE",
        feasible: false,
        objectiveValue: null,
        variables: {},
      };
    }
  };

  if (!target2) {
    for (let i = 0; i < steps1; i++) {
      const v1 = target1.min + ((target1.max - target1.min) * i) / (steps1 - 1);
      points.push(await runSingle(v1));
    }
    return { mode: "1d", target1, points };
  }

  const steps2 = Math.max(2, Math.min(30, Math.round(target2.steps || 12)));
  const gridSteps1 = Math.min(steps1, 20);
  for (let i = 0; i < gridSteps1; i++) {
    const v1 = target1.min + ((target1.max - target1.min) * i) / (gridSteps1 - 1);
    for (let j = 0; j < steps2; j++) {
      const v2 = target2.min + ((target2.max - target2.min) * j) / (steps2 - 1);
      points.push(await runSingle(v1, v2));
    }
  }
  return { mode: "2d", target1: { ...target1, steps: gridSteps1 }, target2: { ...target2, steps: steps2 }, points };
}

function markParetoFrontier(
  points: AmplParetoPoint[],
  dir1: "minimize" | "maximize",
  dir2: "minimize" | "maximize",
): void {
  const s1 = dir1 === "maximize" ? -1 : 1;
  const s2 = dir2 === "maximize" ? -1 : 1;
  const eps = 1e-9;

  for (let i = 0; i < points.length; i++) {
    const pi = points[i]!;
    if (pi.status !== "OPTIMAL" && pi.status !== "FEASIBLE") {
      pi.isPareto = false;
      continue;
    }
    let dominated = false;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const pj = points[j]!;
      if (pj.status !== "OPTIMAL" && pj.status !== "FEASIBLE") continue;
      const a1 = s1 * pj.obj1Val;
      const a2 = s2 * pj.obj2Val;
      const b1 = s1 * pi.obj1Val;
      const b2 = s2 * pi.obj2Val;
      if (a1 <= b1 + eps && a2 <= b2 + eps && (a1 < b1 - eps || a2 < b2 - eps)) {
        dominated = true;
        break;
      }
    }
    pi.isPareto = !dominated;
  }
}

export async function computeAmplPareto(
  modelText: string,
  params: {
    obj1Name?: string | undefined;
    obj2Name?: string | undefined;
    constraintName?: string | undefined;
    steps?: number | undefined;
    dataText?: string | undefined;
  } = {},
): Promise<AmplParetoResult> {
  const model = parseAmplModel(modelText);
  const data = params.dataText ? parseAmplData(params.dataText) : undefined;
  const baseProb = instantiateAmpl(model, data);
  const steps = Math.max(5, Math.min(41, Math.round(params.steps ?? 21)));

  const varNamesById = new Map<number, string>();
  for (const v of baseProb.variables) varNamesById.set(v.id, v.name);

  const allObjectives =
    baseProb.objectives && baseProb.objectives.length > 0 ? baseProb.objectives : [baseProb.objective];

  // Mode 1: True Bi-Objective Weighted-Sum Sweep
  if (allObjectives.length >= 2) {
    const o1 =
      (params.obj1Name ? allObjectives.find((o) => o.name === params.obj1Name) : undefined) ?? allObjectives[0]!;
    const o2 =
      (params.obj2Name ? allObjectives.find((o) => o.name === params.obj2Name) : undefined) ??
      allObjectives.find((o) => o.name !== o1.name) ??
      allObjectives[1]!;

    const points: AmplParetoPoint[] = [];
    for (let i = 0; i < steps; i++) {
      const w = i / (steps - 1);
      const prob = instantiateAmpl(model, data);
      const s1 = o1.direction === "maximize" ? -1 : 1;
      const s2 = o2.direction === "maximize" ? -1 : 1;

      const combinedMap = new Map<number, number>();
      for (const t of o1.expr.linearTerms) {
        combinedMap.set(t.varId, (combinedMap.get(t.varId) ?? 0) + w * s1 * t.coeff);
      }
      for (const t of o2.expr.linearTerms) {
        combinedMap.set(t.varId, (combinedMap.get(t.varId) ?? 0) + (1 - w) * s2 * t.coeff);
      }
      prob.objective = {
        name: `${o1.name}_vs_${o2.name}`,
        direction: "minimize",
        expr: {
          constant: w * s1 * o1.expr.constant + (1 - w) * s2 * o2.expr.constant,
          linearTerms: Array.from(combinedMap.entries()).map(([varId, coeff]) => ({ varId, coeff })),
        },
      };

      try {
        const res = await solveAmpl(prob);
        const sol = res.variables ?? {};
        points.push({
          paramValue: w,
          obj1Val: evalFlatLinear(o1.expr, varNamesById, sol),
          obj2Val: evalFlatLinear(o2.expr, varNamesById, sol),
          isPareto: false,
          status: res.status,
          variables: sol,
        });
      } catch {
        // skip failed weight
      }
    }

    markParetoFrontier(points, o1.direction, o2.direction);
    return {
      mode: "bi-objective",
      obj1: { name: o1.name, direction: o1.direction },
      obj2: { name: o2.name, direction: o2.direction },
      points,
    };
  }

  // Mode 2: Single-Objective vs. Constraint Resource Trade-off (ε-constraint Pareto)
  const o1 = allObjectives[0]!;
  const targetCon =
    (params.constraintName ? baseProb.constraints.find((c) => c.name === params.constraintName) : undefined) ??
    baseProb.constraints.find((c) => !c.dropped && (Number.isFinite(c.ub) || Number.isFinite(c.lb)));

  if (!targetCon) {
    return {
      mode: "constraint-tradeoff",
      obj1: { name: o1.name, direction: o1.direction },
      obj2: { name: "Resource", direction: "minimize" },
      points: [],
    };
  }

  const isUpper = Number.isFinite(targetCon.ub);
  const baseBound = isUpper ? targetCon.ub : targetCon.lb;
  const span = Math.max(Math.abs(baseBound) * 0.75, 2);
  const minB = Math.max(0, baseBound - span);
  const maxB = baseBound + span;
  const obj2Dir: "minimize" | "maximize" = isUpper ? "minimize" : "maximize";

  const points: AmplParetoPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const b = minB + ((maxB - minB) * i) / (steps - 1);
    const prob = instantiateAmpl(model, data);
    const con = prob.constraints.find((c) => c.name === targetCon.name);
    if (con) {
      if (isUpper) con.ub = b;
      else con.lb = b;
    }
    try {
      const res = await solveAmpl(prob);
      const sol = res.variables ?? {};
      if (res.status === "OPTIMAL") {
        points.push({
          paramValue: b,
          obj1Val: b,
          obj2Val: res.objectiveValue,
          isPareto: false,
          status: res.status,
          variables: sol,
        });
      }
    } catch {
      // skip infeasible bound
    }
  }

  markParetoFrontier(points, obj2Dir, o1.direction);
  return {
    mode: "constraint-tradeoff",
    obj1: { name: `${targetCon.name} (${isUpper ? "Limit" : "Min"})`, direction: obj2Dir },
    obj2: { name: o1.name, direction: o1.direction },
    points,
  };
}
