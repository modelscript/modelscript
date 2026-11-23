// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — LP/MILP Presolver.
 *
 * Performs iterative algebraic reductions before invoking the Simplex / Branch-and-Bound solver:
 *  1. Bound feasibility check (lb > ub => infeasible)
 *  2. Fixed variable elimination (lb == ub => substitute into RHS and objective offset)
 *  3. Empty row elimination (feasibility check on 0 <= rhs, 0 >= rhs, 0 == rhs)
 *  4. Row singleton bound tightening (a_ij * x_j <=/>=/== b_i => tighten x_j bounds & remove row)
 *  5. Empty column elimination (fix to optimal finite bound, or detect unboundedness)
 */

import type { MpsColumn, MpsModel, MpsPresolveStats, MpsRow } from "../types.js";

export interface MpsPresolveResult {
  status: "reduced" | "infeasible" | "unbounded";
  reducedModel: MpsModel;
  fixedValues: Map<string, number>;
  stats: MpsPresolveStats;
}

const EPS = 1e-10;

function cloneModel(model: MpsModel): MpsModel {
  const rows = new Map<string, MpsRow>();
  for (const [k, r] of model.rows) {
    rows.set(k, { ...r });
  }
  const columns = new Map<string, MpsColumn>();
  for (const [k, c] of model.columns) {
    columns.set(k, {
      ...c,
      entries: c.entries.map((e) => ({ ...e })),
    });
  }
  return {
    ...model,
    rows,
    columns,
    bounds: model.bounds.map((b) => ({ ...b })),
    quadObj: model.quadObj.map((q) => ({ ...q })),
    parseIssues: [...model.parseIssues],
  };
}

/**
 * Presolves an MpsModel (LP/MILP). For QP models with quadratic terms, skips variable
 * substitution to keep the Hessian intact and only validates bounds.
 */
export function presolveMps(model: MpsModel): MpsPresolveResult {
  const reduced = cloneModel(model);
  const fixedValues = new Map<string, number>();
  const stats: MpsPresolveStats = {
    fixedVarsEliminated: 0,
    emptyRowsEliminated: 0,
    emptyColsEliminated: 0,
    singletonRowsEliminated: 0,
    objectiveOffset: 0,
  };

  // Validate bounds upfront
  for (const col of reduced.columns.values()) {
    if (col.lb > col.ub + EPS) {
      return { status: "infeasible", reducedModel: reduced, fixedValues, stats };
    }
  }

  // Skip algebraic elimination if quadratic terms are present
  if (reduced.quadObj.length > 0) {
    return { status: "reduced", reducedModel: reduced, fixedValues, stats };
  }

  const objRow = reduced.objectiveRow;
  const isMax = reduced.sense === "MAX";

  let changed = true;
  let pass = 0;
  const maxPasses = 16;

  while (changed && pass < maxPasses) {
    changed = false;
    pass++;

    // 1. Eliminate fixed variables (lb == ub)
    for (const [colName, col] of [...reduced.columns.entries()]) {
      if (col.lb > col.ub + EPS) {
        return { status: "infeasible", reducedModel: reduced, fixedValues, stats };
      }
      if (Number.isFinite(col.lb) && Number.isFinite(col.ub) && Math.abs(col.ub - col.lb) <= EPS) {
        const val = col.lb;
        if ((col.varType === "integer" || col.varType === "binary") && Math.abs(val - Math.round(val)) > 1e-6) {
          return { status: "infeasible", reducedModel: reduced, fixedValues, stats };
        }
        fixedValues.set(colName, val);
        for (const e of col.entries) {
          if (e.rowName === objRow) {
            stats.objectiveOffset += e.coeff * val;
          } else {
            const row = reduced.rows.get(e.rowName);
            if (row) {
              row.rhs -= e.coeff * val;
            }
          }
        }
        reduced.columns.delete(colName);
        stats.fixedVarsEliminated++;
        changed = true;
      }
    }

    // Build row -> entries map for constraint rows
    const rowEntries = new Map<string, Array<{ colName: string; coeff: number }>>();
    for (const [rName, row] of reduced.rows) {
      if (row.type !== "N") {
        rowEntries.set(rName, []);
      }
    }
    for (const [colName, col] of reduced.columns) {
      for (const e of col.entries) {
        if (Math.abs(e.coeff) <= 1e-15) continue;
        const list = rowEntries.get(e.rowName);
        if (list) list.push({ colName, coeff: e.coeff });
      }
    }

    // 2. Empty rows and singleton rows
    for (const [rName, entries] of rowEntries) {
      const row = reduced.rows.get(rName);
      if (!row || row.type === "N") continue;

      // Compute effective row bounds [rowLb, rowUb]
      let rowLb = -Infinity;
      let rowUb = Infinity;
      const rhs = row.rhs;
      const range = row.range;
      if (row.type === "E") {
        if (range !== undefined && Math.abs(range) > EPS) {
          rowLb = range > 0 ? rhs : rhs + range;
          rowUb = range > 0 ? rhs + range : rhs;
        } else {
          rowLb = rhs;
          rowUb = rhs;
        }
      } else if (row.type === "L") {
        rowUb = rhs;
        if (range !== undefined && Math.abs(range) > EPS) {
          rowLb = rhs - Math.abs(range);
        }
      } else if (row.type === "G") {
        rowLb = rhs;
        if (range !== undefined && Math.abs(range) > EPS) {
          rowUb = rhs + Math.abs(range);
        }
      }

      if (entries.length === 0) {
        if (0 < rowLb - EPS || 0 > rowUb + EPS) {
          return { status: "infeasible", reducedModel: reduced, fixedValues, stats };
        }
        reduced.rows.delete(rName);
        stats.emptyRowsEliminated++;
        changed = true;
        continue;
      }

      if (entries.length === 1) {
        const { colName, coeff } = entries[0]!;
        const col = reduced.columns.get(colName);
        if (!col) continue;

        let newLb = -Infinity;
        let newUb = Infinity;
        if (coeff > 0) {
          if (Number.isFinite(rowLb)) newLb = rowLb / coeff;
          if (Number.isFinite(rowUb)) newUb = rowUb / coeff;
        } else {
          if (Number.isFinite(rowUb)) newLb = rowUb / coeff;
          if (Number.isFinite(rowLb)) newUb = rowLb / coeff;
        }

        if (col.varType === "integer" || col.varType === "binary") {
          if (Number.isFinite(newLb)) newLb = Math.ceil(newLb - 1e-9);
          if (Number.isFinite(newUb)) newUb = Math.floor(newUb + 1e-9);
        }

        col.lb = Math.max(col.lb, newLb);
        col.ub = Math.min(col.ub, newUb);
        if (col.lb > col.ub + EPS) {
          return { status: "infeasible", reducedModel: reduced, fixedValues, stats };
        }

        // Remove this singleton row from the column and from rows
        col.entries = col.entries.filter((e) => e.rowName !== rName);
        reduced.rows.delete(rName);
        stats.singletonRowsEliminated++;
        changed = true;
      }
    }

    // 3. Empty columns (appear in no constraint rows, only possibly objective)
    for (const [colName, col] of [...reduced.columns.entries()]) {
      const hasConstraint = col.entries.some(
        (e) => e.rowName !== objRow && reduced.rows.has(e.rowName) && Math.abs(e.coeff) > 1e-15,
      );
      if (hasConstraint) continue;

      const objEntry = col.entries.find((e) => e.rowName === objRow);
      const c = objEntry ? objEntry.coeff : 0;
      // Effective minimization cost: min c_eff * x
      const cEff = isMax ? -c : c;

      let chosenVal: number;
      if (cEff > EPS) {
        if (!Number.isFinite(col.lb)) {
          return { status: "unbounded", reducedModel: reduced, fixedValues, stats };
        }
        chosenVal = col.lb;
      } else if (cEff < -EPS) {
        if (!Number.isFinite(col.ub)) {
          return { status: "unbounded", reducedModel: reduced, fixedValues, stats };
        }
        chosenVal = col.ub;
      } else {
        chosenVal = Number.isFinite(col.lb) ? col.lb : Number.isFinite(col.ub) ? col.ub : 0;
      }

      fixedValues.set(colName, chosenVal);
      stats.objectiveOffset += c * chosenVal;
      reduced.columns.delete(colName);
      stats.emptyColsEliminated++;
      changed = true;
    }
  }

  return {
    status: "reduced",
    reducedModel: reduced,
    fixedValues,
    stats,
  };
}
