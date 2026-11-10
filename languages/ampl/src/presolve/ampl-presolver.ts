// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Standalone AMPL Presolve & Postsolve Reconstruction Engine.
 *
 * Implements Fourer & Gay (1994) iterative algebraic reductions:
 * 1. Fixed variable removal and constant substitution.
 * 2. Singleton row elimination with variable bound tightening and dual recovery.
 * 3. Implied row activity bound tightening, forcing row variable fixing, and redundant row purging.
 * 4. LIFO Postsolve stack reconstruction for full primal, dual, slack, and reduced-cost recovery.
 */

import type {
  AmplSolverResult,
  FlatAffineTerm,
  FlatExpression,
  InstantiatedConstraint,
  InstantiatedProblem,
  InstantiatedVar,
  PresolveStatistics,
} from "../types.js";

export type PostsolveRecord =
  | {
      kind: "fixed_var";
      varName: string;
      value: number;
      objCoeff: number;
      colEntries: { conName: string; coeff: number }[];
    }
  | {
      kind: "singleton_row";
      conName: string;
      varName: string;
      coeff: number;
      conLb: number;
      conUb: number;
      tightenedLb: boolean;
      tightenedUb: boolean;
    }
  | {
      kind: "redundant_row";
      conName: string;
    };

export interface PresolveResult {
  originalProblem: InstantiatedProblem;
  presolvedProblem: InstantiatedProblem;
  stack: PostsolveRecord[];
  stats: PresolveStatistics;
  infeasible: boolean;
  infeasibleMessage?: string | undefined;
}

export function presolveAmplProblem(problem: InstantiatedProblem): PresolveResult {
  const origVars = problem.variables.length;
  const origCons = problem.constraints.length;

  // For nonlinear problems, skip linear row elimination to preserve nonlinear AST indices
  if (problem.problemClass === "NLP" || problem.problemClass === "MINLP") {
    return {
      originalProblem: problem,
      presolvedProblem: problem,
      stack: [],
      stats: {
        originalVars: origVars,
        originalConstraints: origCons,
        presolvedVars: origVars,
        presolvedConstraints: origCons,
        eliminatedVars: 0,
        eliminatedConstraints: 0,
      },
      infeasible: false,
    };
  }

  // Deep clone working variables, constraints, and objective
  const workVars: (InstantiatedVar & { active: boolean })[] = problem.variables.map((v) => ({
    ...v,
    indices: [...v.indices],
    active: true,
  }));

  const workCons: (InstantiatedConstraint & { active: boolean })[] = problem.constraints.map((c) => ({
    ...c,
    expr: {
      constant: c.expr.constant,
      linearTerms: c.expr.linearTerms.map((t) => ({ ...t })),
    },
    active: !c.dropped,
  }));

  let objConstant = problem.objective.expr.constant;
  const objCoeffs = new Map<number, number>();
  for (const t of problem.objective.expr.linearTerms) {
    objCoeffs.set(t.varId, (objCoeffs.get(t.varId) ?? 0) + t.coeff);
  }

  const stack: PostsolveRecord[] = [];
  let infeasible = false;
  let infeasibleMessage: string | undefined;

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;

    // 1. Check variable bound consistency and eliminate fixed variables (lb == ub)
    for (const v of workVars) {
      if (!v.active) continue;
      if (v.type === "integer" || v.type === "binary") {
        if (Number.isFinite(v.lb)) v.lb = Math.ceil(v.lb - 1e-9);
        if (Number.isFinite(v.ub)) v.ub = Math.floor(v.ub + 1e-9);
      }
      if (v.lb > v.ub + 1e-8) {
        infeasible = true;
        infeasibleMessage = `Presolve detected infeasible bounds on variable '${v.name}': lb=${v.lb} > ub=${v.ub}.`;
        break;
      }

      if (Number.isFinite(v.lb) && Number.isFinite(v.ub) && Math.abs(v.ub - v.lb) < 1e-10) {
        const val = 0.5 * (v.lb + v.ub);
        const cCoeff = objCoeffs.get(v.id) ?? 0;
        objConstant += cCoeff * val;
        objCoeffs.delete(v.id);

        const colEntries: { conName: string; coeff: number }[] = [];
        for (const c of workCons) {
          if (!c.active) continue;
          const idx = c.expr.linearTerms.findIndex((t) => t.varId === v.id);
          if (idx >= 0) {
            const term = c.expr.linearTerms[idx]!;
            colEntries.push({ conName: c.name, coeff: term.coeff });
            const shift = term.coeff * val;
            if (Number.isFinite(c.lb)) c.lb -= shift;
            if (Number.isFinite(c.ub)) c.ub -= shift;
            c.expr.linearTerms.splice(idx, 1);
          }
        }

        v.active = false;
        stack.push({
          kind: "fixed_var",
          varName: v.name,
          value: val,
          objCoeff: cCoeff,
          colEntries,
        });
        changed = true;
      }
    }
    if (infeasible) break;

    // 2. Singleton and Empty Rows
    for (const c of workCons) {
      if (!c.active) continue;
      // Filter zero coefficients
      c.expr.linearTerms = c.expr.linearTerms.filter(
        (t) => Math.abs(t.coeff) > 1e-14 && workVars[t.varId]?.active,
      );

      if (c.expr.linearTerms.length === 0) {
        // 0 in [c.lb, c.ub]
        if ((Number.isFinite(c.lb) && c.lb > 1e-7) || (Number.isFinite(c.ub) && c.ub < -1e-7)) {
          infeasible = true;
          infeasibleMessage = `Presolve detected infeasible empty constraint '${c.name}': 0 not in [${c.lb}, ${c.ub}].`;
          break;
        }
        c.active = false;
        stack.push({ kind: "redundant_row", conName: c.name });
        changed = true;
        continue;
      }

      if (c.expr.linearTerms.length === 1) {
        const term = c.expr.linearTerms[0]!;
        const v = workVars[term.varId]!;
        const a = term.coeff;
        let impLb = Number.NEGATIVE_INFINITY;
        let impUb = Number.POSITIVE_INFINITY;

        if (a > 0) {
          if (Number.isFinite(c.lb)) impLb = c.lb / a;
          if (Number.isFinite(c.ub)) impUb = c.ub / a;
        } else {
          if (Number.isFinite(c.ub)) impLb = c.ub / a;
          if (Number.isFinite(c.lb)) impUb = c.lb / a;
        }

        let tightenedLb = false;
        let tightenedUb = false;
        if (impLb > v.lb + 1e-12) {
          v.lb = impLb;
          tightenedLb = true;
        }
        if (impUb < v.ub - 1e-12) {
          v.ub = impUb;
          tightenedUb = true;
        }

        c.active = false;
        stack.push({
          kind: "singleton_row",
          conName: c.name,
          varName: v.name,
          coeff: a,
          conLb: c.lb,
          conUb: c.ub,
          tightenedLb,
          tightenedUb,
        });
        changed = true;
      }
    }
    if (infeasible) break;

    // 3. Implied Row Activity Bounds & Redundant / Forcing Row Detection
    for (const c of workCons) {
      if (!c.active || c.expr.linearTerms.length === 0) continue;

      let minAct = 0;
      let maxAct = 0;
      for (const t of c.expr.linearTerms) {
        const v = workVars[t.varId]!;
        if (t.coeff > 0) {
          minAct += Number.isFinite(v.lb) ? t.coeff * v.lb : Number.NEGATIVE_INFINITY;
          maxAct += Number.isFinite(v.ub) ? t.coeff * v.ub : Number.POSITIVE_INFINITY;
        } else {
          minAct += Number.isFinite(v.ub) ? t.coeff * v.ub : Number.NEGATIVE_INFINITY;
          maxAct += Number.isFinite(v.lb) ? t.coeff * v.lb : Number.POSITIVE_INFINITY;
        }
      }

      if (
        (Number.isFinite(c.lb) && maxAct < c.lb - 1e-7) ||
        (Number.isFinite(c.ub) && minAct > c.ub + 1e-7)
      ) {
        infeasible = true;
        infeasibleMessage = `Presolve detected infeasible activity range [${minAct}, ${maxAct}] on constraint '${c.name}' vs bounds [${c.lb}, ${c.ub}].`;
        break;
      }

      const lbRedundant = !Number.isFinite(c.lb) || minAct >= c.lb - 1e-9;
      const ubRedundant = !Number.isFinite(c.ub) || maxAct <= c.ub + 1e-9;
      if (lbRedundant && ubRedundant) {
        c.active = false;
        stack.push({ kind: "redundant_row", conName: c.name });
        changed = true;
        continue;
      }

      // Forcing row check: maxAct == c.lb
      if (Number.isFinite(c.lb) && Number.isFinite(maxAct) && Math.abs(maxAct - c.lb) < 1e-10) {
        for (const t of c.expr.linearTerms) {
          const v = workVars[t.varId]!;
          if (t.coeff > 0) v.lb = v.ub;
          else v.ub = v.lb;
        }
        c.active = false;
        stack.push({ kind: "redundant_row", conName: c.name });
        changed = true;
        continue;
      }

      // Forcing row check: minAct == c.ub
      if (Number.isFinite(c.ub) && Number.isFinite(minAct) && Math.abs(minAct - c.ub) < 1e-10) {
        for (const t of c.expr.linearTerms) {
          const v = workVars[t.varId]!;
          if (t.coeff > 0) v.ub = v.lb;
          else v.lb = v.ub;
        }
        c.active = false;
        stack.push({ kind: "redundant_row", conName: c.name });
        changed = true;
      }
    }

    if (infeasible || !changed) break;
  }

  // Build compacted presolved problem
  const oldToNewVarId = new Map<number, number>();
  const presolvedVars: InstantiatedVar[] = [];
  const presolvedVarNameMap = new Map<string, number>();

  for (const v of workVars) {
    if (!v.active) continue;
    const newId = presolvedVars.length;
    oldToNewVarId.set(v.id, newId);
    const { active: _, ...cleanVar } = v;
    cleanVar.id = newId;
    presolvedVars.push(cleanVar);
    presolvedVarNameMap.set(cleanVar.name, newId);
  }

  const presolvedObjTerms: FlatAffineTerm[] = [];
  for (const [oldId, coeff] of objCoeffs.entries()) {
    const newId = oldToNewVarId.get(oldId);
    if (newId !== undefined && Math.abs(coeff) > 1e-15) {
      presolvedObjTerms.push({ varId: newId, coeff });
    }
  }

  const presolvedCons: InstantiatedConstraint[] = [];
  for (const c of workCons) {
    if (!c.active) continue;
    const mappedTerms: FlatAffineTerm[] = [];
    for (const t of c.expr.linearTerms) {
      const newId = oldToNewVarId.get(t.varId);
      if (newId !== undefined && Math.abs(t.coeff) > 1e-15) {
        mappedTerms.push({ varId: newId, coeff: t.coeff });
      }
    }
    const newConId = presolvedCons.length;
    presolvedCons.push({
      id: newConId,
      name: c.name,
      expr: {
        constant: c.expr.constant,
        linearTerms: mappedTerms,
      },
      lb: c.lb,
      ub: c.ub,
    });
  }

  const hasInt = presolvedVars.some((v) => v.type === "integer" || v.type === "binary");
  const presolvedProblem: InstantiatedProblem = {
    name: problem.name,
    problemClass: hasInt ? "MILP" : "LP",
    variables: presolvedVars,
    varNameMap: presolvedVarNameMap,
    objective: {
      name: problem.objective.name,
      direction: problem.objective.direction,
      expr: {
        constant: objConstant,
        linearTerms: presolvedObjTerms,
      },
    },
    constraints: presolvedCons,
  };

  const stats: PresolveStatistics = {
    originalVars: origVars,
    originalConstraints: origCons,
    presolvedVars: presolvedVars.length,
    presolvedConstraints: presolvedCons.length,
    eliminatedVars: origVars - presolvedVars.length,
    eliminatedConstraints: origCons - presolvedCons.length,
  };

  return {
    originalProblem: problem,
    presolvedProblem,
    stack,
    stats,
    infeasible,
    infeasibleMessage,
  };
}

/**
 * Unrolls the `PostsolveRecord` stack in LIFO order to reconstruct primal values,
 * dual multipliers, and reduced costs on the original problem space.
 */
export function unrollPostsolve(
  presolveRes: PresolveResult,
  solvedPresolved: AmplSolverResult,
): {
  primalMap: Map<string, number>;
  dualMap: Map<string, number>;
  rcMap: Map<string, number>;
} {
  const primalMap = new Map<string, number>();
  const dualMap = new Map<string, number>();
  const rcMap = new Map<string, number>();

  for (const [k, v] of Object.entries(solvedPresolved.variables)) {
    primalMap.set(k, v);
  }
  if (solvedPresolved.duals) {
    for (const [k, v] of Object.entries(solvedPresolved.duals)) {
      dualMap.set(k, v);
    }
  }
  if (solvedPresolved.reducedCosts) {
    for (const [k, v] of Object.entries(solvedPresolved.reducedCosts)) {
      rcMap.set(k, v);
    }
  }

  // Pop postsolve records in reverse order (LIFO)
  for (let i = presolveRes.stack.length - 1; i >= 0; i--) {
    const rec = presolveRes.stack[i]!;
    switch (rec.kind) {
      case "redundant_row": {
        dualMap.set(rec.conName, 0);
        break;
      }
      case "singleton_row": {
        const varRc = rcMap.get(rec.varName) ?? 0;
        const varVal = primalMap.get(rec.varName) ?? 0;
        const body = rec.coeff * varVal;
        let dual = 0;
        const atLb = Number.isFinite(rec.conLb) && Math.abs(body - rec.conLb) < 1e-6 && rec.tightenedLb;
        const atUb = Number.isFinite(rec.conUb) && Math.abs(body - rec.conUb) < 1e-6 && rec.tightenedUb;
        if ((atLb || atUb) && Math.abs(rec.coeff) > 1e-12) {
          dual = varRc / rec.coeff;
          rcMap.set(rec.varName, 0);
        }
        dualMap.set(rec.conName, dual);
        break;
      }
      case "fixed_var": {
        primalMap.set(rec.varName, rec.value);
        // Compute reduced cost: c_j - sum_i pi_i * A_{i,j}
        let sumPiA = 0;
        for (const entry of rec.colEntries) {
          const pi = dualMap.get(entry.conName) ?? 0;
          sumPiA += pi * entry.coeff;
        }
        rcMap.set(rec.varName, rec.objCoeff - sumPiA);
        break;
      }
    }
  }

  return { primalMap, dualMap, rcMap };
}

/**
 * Evaluates a flat expression at a given primal vector `primalByVarId`.
 */
export function evaluateFlatBody(expr: FlatExpression, primalByVarId: number[]): number {
  let sum = expr.constant;
  for (const t of expr.linearTerms) {
    sum += t.coeff * (primalByVarId[t.varId] ?? 0);
  }
  return sum;
}
