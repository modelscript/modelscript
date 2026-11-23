// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Two-Phase Simplex LP Solver.
 *
 * Solves general Linear Programs with free, positive, negative, and bounded variables,
 * and `<=`, `>=`, `=` constraints using exact Two-Phase Simplex with Bland's anti-cycling rule.
 */

import type { GamsSolveStatus, InstantiatedGamsProblem } from "../types.js";

export interface SimplexBoundOverride {
  lb?: number | undefined;
  ub?: number | undefined;
}

export interface SimplexResult {
  status: GamsSolveStatus;
  objectiveValue: number;
  primal: number[];
  duals: number[];
  iterations: number;
  message?: string | undefined;
}

const EPS = 1e-9;
const PIVOT_EPS = 1e-10;
const FEAS_EPS = 1e-7;

interface VarTransform {
  kind: "shifted_lb" | "shifted_ub" | "free_split" | "fixed";
  lb: number;
  ub: number;
  colPos: number; // >= 0
  colNeg: number; // >= 0 only for free_split
}

/**
 * Solves the LP relaxation of an `InstantiatedGamsProblem` with optional variable bound overrides.
 */
export function solveLpSimplex(
  problem: InstantiatedGamsProblem,
  boundOverrides?: Map<number, SimplexBoundOverride>,
  maxIterations = 50000,
): SimplexResult {
  const nOrig = problem.variables.length;
  const isMax = problem.sense === "maximizing";

  // 1. Variable transformations to non-negative decision columns y >= 0
  const transforms: VarTransform[] = [];
  const extraUpperBounds: Array<{ col: number; ub: number }> = [];
  let nDecisionCols = 0;

  for (let j = 0; j < nOrig; j++) {
    const v = problem.variables[j]!;
    const ov = boundOverrides?.get(j);
    const lb = ov?.lb !== undefined ? Math.max(v.lb, ov.lb) : v.lb;
    const ub = ov?.ub !== undefined ? Math.min(v.ub, ov.ub) : v.ub;

    if (lb > ub + FEAS_EPS) {
      return {
        status: "infeasible",
        objectiveValue: NaN,
        primal: new Array(nOrig).fill(0),
        duals: new Array(problem.constraints.length).fill(0),
        iterations: 0,
        message: `Conflicting bounds on variable '${v.name}': [${lb}, ${ub}]`,
      };
    }

    if (Number.isFinite(lb) && Number.isFinite(ub) && Math.abs(ub - lb) <= EPS) {
      transforms.push({ kind: "fixed", lb, ub: lb, colPos: -1, colNeg: -1 });
    } else if (Number.isFinite(lb)) {
      const col = nDecisionCols++;
      transforms.push({ kind: "shifted_lb", lb, ub, colPos: col, colNeg: -1 });
      if (Number.isFinite(ub)) {
        extraUpperBounds.push({ col, ub: ub - lb });
      }
    } else if (Number.isFinite(ub)) {
      const col = nDecisionCols++;
      transforms.push({ kind: "shifted_ub", lb, ub, colPos: col, colNeg: -1 });
    } else {
      const colPos = nDecisionCols++;
      const colNeg = nDecisionCols++;
      transforms.push({ kind: "free_split", lb, ub, colPos, colNeg });
    }
  }

  // 2. Build objective vector c (in minimization form: min c^T y)
  const cObj = new Float64Array(nDecisionCols);
  const signObj = isMax ? -1 : 1;

  for (const term of problem.objectiveTerms) {
    const tf = transforms[term.varId];
    if (!tf) continue;
    const coeff = signObj * term.coeff;
    if (tf.kind === "shifted_lb") {
      cObj[tf.colPos] = (cObj[tf.colPos] ?? 0) + coeff;
    } else if (tf.kind === "shifted_ub") {
      cObj[tf.colPos] = (cObj[tf.colPos] ?? 0) - coeff;
    } else if (tf.kind === "free_split") {
      cObj[tf.colPos] = (cObj[tf.colPos] ?? 0) + coeff;
      cObj[tf.colNeg] = (cObj[tf.colNeg] ?? 0) - coeff;
    }
  }

  // 3. Build constraint rows in standard form (RHS >= 0)
  interface StdRow {
    coeffs: Array<{ col: number; val: number }>;
    sense: "<=" | ">=" | "=";
    rhs: number;
    origConIdx: number; // -1 for extra upper bound rows
    flipped: boolean;
  }

  const rows: StdRow[] = [];

  for (let i = 0; i < problem.constraints.length; i++) {
    const con = problem.constraints[i]!;
    const rowAcc = new Map<number, number>();
    let rhs = con.rhs;

    for (const term of con.terms) {
      const tf = transforms[term.varId];
      if (!tf) continue;
      if (tf.kind === "fixed") {
        rhs -= term.coeff * tf.lb;
      } else if (tf.kind === "shifted_lb") {
        rhs -= term.coeff * tf.lb;
        rowAcc.set(tf.colPos, (rowAcc.get(tf.colPos) ?? 0) + term.coeff);
      } else if (tf.kind === "shifted_ub") {
        rhs -= term.coeff * tf.ub;
        rowAcc.set(tf.colPos, (rowAcc.get(tf.colPos) ?? 0) - term.coeff);
      } else {
        rowAcc.set(tf.colPos, (rowAcc.get(tf.colPos) ?? 0) + term.coeff);
        rowAcc.set(tf.colNeg, (rowAcc.get(tf.colNeg) ?? 0) - term.coeff);
      }
    }

    let sense = con.sense;
    let flipped = false;
    if (rhs < -EPS) {
      rhs = -rhs;
      flipped = true;
      for (const [col, val] of rowAcc) {
        rowAcc.set(col, -val);
      }
      if (sense === "<=") sense = ">=";
      else if (sense === ">=") sense = "<=";
    } else if (Math.abs(rhs) <= EPS) {
      rhs = 0;
    }

    const coeffs: Array<{ col: number; val: number }> = [];
    for (const [col, val] of rowAcc) {
      if (Math.abs(val) > 1e-14) coeffs.push({ col, val });
    }
    rows.push({ coeffs, sense, rhs, origConIdx: i, flipped });
  }

  // Add extra upper bound rows: y_col <= ub - lb
  for (const ubRow of extraUpperBounds) {
    rows.push({
      coeffs: [{ col: ubRow.col, val: 1 }],
      sense: "<=",
      rhs: ubRow.ub,
      origConIdx: -1,
      flipped: false,
    });
  }

  const m = rows.length;
  // Count slack/surplus and artificial columns
  let nSlack = 0;
  let nArt = 0;
  for (const r of rows) {
    if (r.sense === "<=" || r.sense === ">=") nSlack++;
    if (r.sense === ">=" || r.sense === "=") nArt++;
  }

  const nTotalCols = nDecisionCols + nSlack + nArt;
  const artStartCol = nDecisionCols + nSlack;
  const stride = nTotalCols + 1; // last column is RHS

  // Tableau: (m + 1) rows x (nTotalCols + 1) cols. Row m is the objective row.
  const tab = new Float64Array((m + 1) * stride);
  const basis = new Int32Array(m);
  const rowSlackCol = new Int32Array(m).fill(-1);
  const rowArtCol = new Int32Array(m).fill(-1);

  let nextSlack = nDecisionCols;
  let nextArt = artStartCol;

  for (let i = 0; i < m; i++) {
    const r = rows[i]!;
    const rowOff = i * stride;
    for (const entry of r.coeffs) {
      tab[rowOff + entry.col] = entry.val;
    }
    tab[rowOff + nTotalCols] = r.rhs;

    if (r.sense === "<=") {
      const sCol = nextSlack++;
      tab[rowOff + sCol] = 1;
      rowSlackCol[i] = sCol;
      basis[i] = sCol;
    } else if (r.sense === ">=") {
      const sCol = nextSlack++;
      const aCol = nextArt++;
      tab[rowOff + sCol] = -1;
      tab[rowOff + aCol] = 1;
      rowSlackCol[i] = sCol;
      rowArtCol[i] = aCol;
      basis[i] = aCol;
    } else {
      const aCol = nextArt++;
      tab[rowOff + aCol] = 1;
      rowArtCol[i] = aCol;
      basis[i] = aCol;
    }
  }

  let totalIterations = 0;

  const pivot = (pivotRow: number, pivotCol: number): void => {
    const pOff = pivotRow * stride;
    const pVal = tab[pOff + pivotCol]!;
    const invP = 1.0 / pVal;
    for (let j = 0; j <= nTotalCols; j++) {
      tab[pOff + j] = tab[pOff + j]! * invP;
    }
    tab[pOff + pivotCol] = 1.0;

    for (let i = 0; i <= m; i++) {
      if (i === pivotRow) continue;
      const rOff = i * stride;
      const factor = tab[rOff + pivotCol]!;
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = 0; j <= nTotalCols; j++) {
        tab[rOff + j] = tab[rOff + j]! - factor * tab[pOff + j]!;
      }
      tab[rOff + pivotCol] = 0.0;
    }
    basis[pivotRow] = pivotCol;
  };

  const runSimplexLoop = (activeCols: number): "optimal" | "unbounded" | "iteration_limit" => {
    const objOff = m * stride;
    let stallCount = 0;
    let lastObj = tab[objOff + nTotalCols]!;

    while (totalIterations < maxIterations) {
      // Choose entering column: Dantzig steepest reduced cost normally, switch to Bland's rule on stall
      let enterCol = -1;
      if (stallCount > 25) {
        for (let j = 0; j < activeCols; j++) {
          if (tab[objOff + j]! < -EPS) {
            enterCol = j;
            break;
          }
        }
      } else {
        let bestRc = -EPS;
        for (let j = 0; j < activeCols; j++) {
          const rc = tab[objOff + j]!;
          if (rc < bestRc) {
            bestRc = rc;
            enterCol = j;
          }
        }
      }

      if (enterCol === -1) return "optimal";

      // Minimum ratio test with Bland tie-breaking (smallest basic var index)
      let leaveRow = -1;
      let minRatio = Infinity;
      for (let i = 0; i < m; i++) {
        const aij = tab[i * stride + enterCol]!;
        if (aij > PIVOT_EPS) {
          const rhs = Math.max(0, tab[i * stride + nTotalCols]!);
          const ratio = rhs / aij;
          if (
            ratio < minRatio - 1e-12 ||
            (Math.abs(ratio - minRatio) <= 1e-12 && (leaveRow === -1 || basis[i]! < basis[leaveRow]!))
          ) {
            minRatio = ratio;
            leaveRow = i;
          }
        }
      }

      if (leaveRow === -1) return "unbounded";

      pivot(leaveRow, enterCol);
      totalIterations++;

      const curObj = tab[objOff + nTotalCols]!;
      if (Math.abs(curObj - lastObj) < 1e-12) {
        stallCount++;
      } else {
        stallCount = 0;
        lastObj = curObj;
      }
    }
    return "iteration_limit";
  };

  // 4. Phase I (if artificial variables exist)
  if (nArt > 0) {
    const objOff = m * stride;
    for (let j = 0; j <= nTotalCols; j++) tab[objOff + j] = 0;
    for (let j = artStartCol; j < nTotalCols; j++) {
      tab[objOff + j] = 1.0;
    }
    // Eliminate basic artificial variables from objective row
    for (let i = 0; i < m; i++) {
      if (basis[i]! >= artStartCol) {
        const rOff = i * stride;
        for (let j = 0; j <= nTotalCols; j++) {
          tab[objOff + j] = tab[objOff + j]! - tab[rOff + j]!;
        }
      }
    }

    const p1Status = runSimplexLoop(nTotalCols);
    if (p1Status === "iteration_limit") {
      return {
        status: "iteration_limit",
        objectiveValue: NaN,
        primal: new Array(nOrig).fill(0),
        duals: new Array(problem.constraints.length).fill(0),
        iterations: totalIterations,
      };
    }

    // Phase I objective is stored as -sum(a_i) in tab[m, nTotalCols]
    const phase1Val = -tab[objOff + nTotalCols]!;
    if (phase1Val > FEAS_EPS) {
      return {
        status: "infeasible",
        objectiveValue: NaN,
        primal: new Array(nOrig).fill(0),
        duals: new Array(problem.constraints.length).fill(0),
        iterations: totalIterations,
        message: `Phase I residual ${phase1Val.toExponential(3)} > 0 (infeasible)`,
      };
    }

    // Pivot out any remaining basic artificial variables at 0
    for (let i = 0; i < m; i++) {
      if (basis[i]! >= artStartCol) {
        const rOff = i * stride;
        let pivotCol = -1;
        for (let j = 0; j < artStartCol; j++) {
          if (Math.abs(tab[rOff + j]!) > PIVOT_EPS) {
            pivotCol = j;
            break;
          }
        }
        if (pivotCol >= 0) {
          pivot(i, pivotCol);
        }
      }
    }
  }

  // 5. Phase II: set true minimization objective c^T y
  const objOff = m * stride;
  for (let j = 0; j <= nTotalCols; j++) tab[objOff + j] = 0;
  for (let j = 0; j < nDecisionCols; j++) {
    tab[objOff + j] = cObj[j]!;
  }
  // Eliminate basic variables from objective row
  for (let i = 0; i < m; i++) {
    const bCol = basis[i]!;
    const cb = tab[objOff + bCol]!;
    if (Math.abs(cb) > 1e-15) {
      const rOff = i * stride;
      for (let j = 0; j <= nTotalCols; j++) {
        tab[objOff + j] = tab[objOff + j]! - cb * tab[rOff + j]!;
      }
    }
  }

  const p2Status = runSimplexLoop(artStartCol);
  if (p2Status !== "optimal") {
    return {
      status: p2Status,
      objectiveValue: p2Status === "unbounded" ? (isMax ? Infinity : -Infinity) : NaN,
      primal: new Array(nOrig).fill(0),
      duals: new Array(problem.constraints.length).fill(0),
      iterations: totalIterations,
    };
  }

  // 6. Recover primal decision vector y >= 0, then transform back to original x
  const y = new Float64Array(nTotalCols);
  for (let i = 0; i < m; i++) {
    const bCol = basis[i]!;
    if (bCol >= 0 && bCol < nTotalCols) {
      const val = tab[i * stride + nTotalCols]!;
      y[bCol] = Math.abs(val) < 1e-12 ? 0 : val;
    }
  }

  const primal = new Array<number>(nOrig).fill(0);
  for (let j = 0; j < nOrig; j++) {
    const tf = transforms[j]!;
    if (tf.kind === "fixed") {
      primal[j] = tf.lb;
    } else if (tf.kind === "shifted_lb") {
      primal[j] = tf.lb + y[tf.colPos]!;
    } else if (tf.kind === "shifted_ub") {
      primal[j] = tf.ub - y[tf.colPos]!;
    } else {
      primal[j] = y[tf.colPos]! - y[tf.colNeg]!;
    }
    if (Math.abs(primal[j]!) < 1e-12) primal[j] = 0;
  }

  // Compute exact objective from primal solution
  let objVal = problem.objectiveConstant;
  for (const term of problem.objectiveTerms) {
    objVal += term.coeff * (primal[term.varId] ?? 0);
  }

  // Extract duals (shadow prices) for original constraints
  const duals = new Array<number>(problem.constraints.length).fill(0);
  for (let i = 0; i < m; i++) {
    const r = rows[i]!;
    if (r.origConIdx < 0) continue;
    const sCol = rowSlackCol[i]!;
    const aCol = rowArtCol[i]!;
    let rawDual = 0;
    if (r.sense === "<=" && sCol >= 0) {
      rawDual = -tab[objOff + sCol]!;
    } else if (r.sense === ">=" && sCol >= 0) {
      rawDual = tab[objOff + sCol]!;
    } else if (aCol >= 0) {
      rawDual = -tab[objOff + aCol]!;
    }
    if (r.flipped) rawDual = -rawDual;
    if (isMax) rawDual = -rawDual;
    duals[r.origConIdx] = Math.abs(rawDual) < 1e-12 ? 0 : rawDual;
  }

  return {
    status: "optimal",
    objectiveValue: objVal,
    primal,
    duals,
    iterations: totalIterations,
  };
}
