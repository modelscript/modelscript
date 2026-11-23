// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Two-Phase Revised Simplex LP Solver.
 *
 * Solves general linear programs in MPS form:
 *   min / max  c^T x
 *   s.t.       L_i <= (Ax)_i <= U_i   (supports E, L, G, and RANGES)
 *              lb_j <= x_j <= ub_j    (supports LO, UP, FX, FR, MI, PL)
 *
 * Uses dense LU factorization with partial pivoting for basis solves (zero drift),
 * Phase I artificial basis construction, and Dantzig/Bland anti-cycling pricing.
 */

import type { MpsModel, MpsSolveResult } from "../types.js";

export interface MpsLpSolverOptions {
  maxIterations?: number | undefined;
  feasibilityTol?: number | undefined;
  optimalityTol?: number | undefined;
}

interface LuFactors {
  n: number;
  lu: Float64Array;
  piv: Int32Array;
  singular: boolean;
}

function luFactor(matrix: Float64Array, n: number): LuFactors {
  const lu = new Float64Array(matrix);
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(lu[k * n + k]!);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i * n + k]!);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }
    if (maxVal < 1e-13) {
      return { n, lu, piv, singular: true };
    }
    if (maxRow !== k) {
      const tmpP = piv[k]!;
      piv[k] = piv[maxRow]!;
      piv[maxRow] = tmpP;
      const rowK = k * n;
      const rowM = maxRow * n;
      for (let j = 0; j < n; j++) {
        const tmp = lu[rowK + j]!;
        lu[rowK + j] = lu[rowM + j]!;
        lu[rowM + j] = tmp;
      }
    }
    const diag = lu[k * n + k]!;
    for (let i = k + 1; i < n; i++) {
      const mult = lu[i * n + k]! / diag;
      lu[i * n + k] = mult;
      const rowI = i * n;
      const rowK = k * n;
      for (let j = k + 1; j < n; j++) {
        lu[rowI + j] = lu[rowI + j]! - mult * lu[rowK + j]!;
      }
    }
  }
  return { n, lu, piv, singular: false };
}

/** Solves B x = rhs given LU(P B = L U). */
function luSolve(f: LuFactors, rhs: Float64Array): Float64Array {
  const { n, lu, piv } = f;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = rhs[piv[i]!]!;
  }
  // Forward substitution L y = P rhs
  for (let i = 0; i < n; i++) {
    let sum = x[i]!;
    const rowI = i * n;
    for (let j = 0; j < i; j++) {
      sum -= lu[rowI + j]! * x[j]!;
    }
    x[i] = sum;
  }
  // Back substitution U x = y
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    const rowI = i * n;
    for (let j = i + 1; j < n; j++) {
      sum -= lu[rowI + j]! * x[j]!;
    }
    x[i] = sum / lu[rowI + i]!;
  }
  return x;
}

/** Solves B^T y = rhs given LU(P B = L U) => B^T = U^T L^T P. */
function luSolveTranspose(f: LuFactors, rhs: Float64Array): Float64Array {
  const { n, lu, piv } = f;
  const z = new Float64Array(rhs);
  // Solve U^T w = rhs
  for (let i = 0; i < n; i++) {
    let sum = z[i]!;
    for (let j = 0; j < i; j++) {
      sum -= lu[j * n + i]! * z[j]!;
    }
    z[i] = sum / lu[i * n + i]!;
  }
  // Solve L^T v = w
  for (let i = n - 1; i >= 0; i--) {
    let sum = z[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= lu[j * n + i]! * z[j]!;
    }
    z[i] = sum;
  }
  // Apply P^T
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    y[piv[i]!] = z[i]!;
  }
  return y;
}

interface VarMapping {
  origName: string;
  kind: "shifted_lb" | "shifted_ub" | "free" | "fixed";
  shift: number;
  posIdx: number;
  negIdx: number;
}

/**
 * Solves the LP relaxation of an MpsModel using Two-Phase Revised Simplex.
 */
export function solveMpsLp(model: MpsModel, options?: MpsLpSolverOptions): MpsSolveResult {
  const maxIter = options?.maxIterations ?? 5000;
  const feasTol = options?.feasibilityTol ?? 1e-7;
  const optTol = options?.optimalityTol ?? 1e-8;
  const isMax = model.sense === "MAX";
  const sign = isMax ? -1 : 1;

  const colList = [...model.columns.values()];
  const mappings: VarMapping[] = [];

  // Map original columns to non-negative standard variables
  let nStdVars = 0;
  let objOffset = 0;

  // Also collect extra upper-bound rows (y_j <= ub - lb)
  const extraUbConstraints: Array<{ stdIdx: number; ubVal: number }> = [];

  for (const col of colList) {
    if (col.lb > col.ub + feasTol) {
      return {
        status: "infeasible",
        objectiveValue: Number.NaN,
        primal: {},
        dual: {},
        reducedCosts: {},
        iterations: 0,
      };
    }

    const hasLb = Number.isFinite(col.lb);
    const hasUb = Number.isFinite(col.ub);

    if (hasLb && hasUb && Math.abs(col.ub - col.lb) <= 1e-12) {
      mappings.push({ origName: col.name, kind: "fixed", shift: col.lb, posIdx: -1, negIdx: -1 });
    } else if (hasLb) {
      const posIdx = nStdVars++;
      mappings.push({ origName: col.name, kind: "shifted_lb", shift: col.lb, posIdx, negIdx: -1 });
      if (hasUb) {
        extraUbConstraints.push({ stdIdx: posIdx, ubVal: col.ub - col.lb });
      }
    } else if (hasUb) {
      // -inf < x <= ub  ==>  x = ub - y, y >= 0
      const posIdx = nStdVars++;
      mappings.push({ origName: col.name, kind: "shifted_ub", shift: col.ub, posIdx, negIdx: -1 });
    } else {
      // Free variable: x = y+ - y-
      const posIdx = nStdVars++;
      const negIdx = nStdVars++;
      mappings.push({ origName: col.name, kind: "free", shift: 0, posIdx, negIdx });
    }
  }

  const colIndexByName = new Map<string, number>();
  for (let j = 0; j < colList.length; j++) {
    colIndexByName.set(colList[j]!.name, j);
  }

  // Build objective vector c (minimization)
  const objRow = model.objectiveRow;
  const cStd: number[] = new Array<number>(nStdVars).fill(0);

  for (let j = 0; j < colList.length; j++) {
    const col = colList[j]!;
    const m = mappings[j]!;
    const objEntry = objRow ? col.entries.find((e) => e.rowName === objRow) : undefined;
    const rawC = objEntry ? objEntry.coeff : 0;
    const effC = sign * rawC;

    if (m.kind === "fixed") {
      objOffset += rawC * m.shift;
    } else if (m.kind === "shifted_lb") {
      objOffset += rawC * m.shift;
      cStd[m.posIdx] = effC;
    } else if (m.kind === "shifted_ub") {
      objOffset += rawC * m.shift;
      cStd[m.posIdx] = -effC;
    } else {
      cStd[m.posIdx] = effC;
      cStd[m.negIdx] = -effC;
    }
  }

  // Build standard constraint rows (each as sparse list + sense + rhs)
  interface StdRow {
    name: string;
    sense: "E" | "L" | "G";
    rhs: number;
    terms: Array<{ varIdx: number; coeff: number }>;
    origRowName?: string | undefined;
  }

  const stdRows: StdRow[] = [];

  // Invert columns -> rows
  const origRowTerms = new Map<string, Array<{ colIdx: number; coeff: number }>>();
  for (const rName of model.rows.keys()) {
    origRowTerms.set(rName, []);
  }
  for (let j = 0; j < colList.length; j++) {
    for (const e of colList[j]!.entries) {
      if (Math.abs(e.coeff) <= 1e-15) continue;
      origRowTerms.get(e.rowName)?.push({ colIdx: j, coeff: e.coeff });
    }
  }

  for (const row of model.rows.values()) {
    if (row.type === "N") continue;

    const terms: Array<{ varIdx: number; coeff: number }> = [];
    let rhsShift = 0;

    for (const t of origRowTerms.get(row.name) ?? []) {
      const m = mappings[t.colIdx]!;
      if (m.kind === "fixed") {
        rhsShift += t.coeff * m.shift;
      } else if (m.kind === "shifted_lb") {
        rhsShift += t.coeff * m.shift;
        terms.push({ varIdx: m.posIdx, coeff: t.coeff });
      } else if (m.kind === "shifted_ub") {
        rhsShift += t.coeff * m.shift;
        terms.push({ varIdx: m.posIdx, coeff: -t.coeff });
      } else {
        terms.push({ varIdx: m.posIdx, coeff: t.coeff });
        terms.push({ varIdx: m.negIdx, coeff: -t.coeff });
      }
    }

    const rhs = row.rhs - rhsShift;
    const range = row.range;

    if (row.type === "E") {
      if (range !== undefined && Math.abs(range) > 1e-12) {
        const lo = range > 0 ? rhs : rhs + range;
        const hi = range > 0 ? rhs + range : rhs;
        stdRows.push({ name: `${row.name}_lo`, sense: "G", rhs: lo, terms, origRowName: row.name });
        stdRows.push({ name: `${row.name}_hi`, sense: "L", rhs: hi, terms: [...terms], origRowName: row.name });
      } else {
        stdRows.push({ name: row.name, sense: "E", rhs, terms, origRowName: row.name });
      }
    } else if (row.type === "L") {
      stdRows.push({ name: row.name, sense: "L", rhs, terms, origRowName: row.name });
      if (range !== undefined && Math.abs(range) > 1e-12) {
        stdRows.push({
          name: `${row.name}_rng`,
          sense: "G",
          rhs: rhs - Math.abs(range),
          terms: [...terms],
          origRowName: row.name,
        });
      }
    } else if (row.type === "G") {
      stdRows.push({ name: row.name, sense: "G", rhs, terms, origRowName: row.name });
      if (range !== undefined && Math.abs(range) > 1e-12) {
        stdRows.push({
          name: `${row.name}_rng`,
          sense: "L",
          rhs: rhs + Math.abs(range),
          terms: [...terms],
          origRowName: row.name,
        });
      }
    }
  }

  // Add upper-bound rows
  for (let u = 0; u < extraUbConstraints.length; u++) {
    const ub = extraUbConstraints[u]!;
    stdRows.push({
      name: `__ub_${u}`,
      sense: "L",
      rhs: ub.ubVal,
      terms: [{ varIdx: ub.stdIdx, coeff: 1 }],
    });
  }

  // Special case: no constraints
  if (stdRows.length === 0) {
    const primal: Record<string, number> = {};
    let objVal = objOffset;
    for (let j = 0; j < colList.length; j++) {
      const m = mappings[j]!;
      const col = colList[j]!;
      const objEntry = objRow ? col.entries.find((e) => e.rowName === objRow) : undefined;
      const rawC = objEntry ? objEntry.coeff : 0;
      const effC = sign * rawC;
      if (m.kind === "fixed") {
        primal[col.name] = m.shift;
      } else if (m.kind === "shifted_lb") {
        if (effC < -optTol) {
          return {
            status: "unbounded",
            objectiveValue: isMax ? Infinity : -Infinity,
            primal: {},
            dual: {},
            reducedCosts: {},
            iterations: 0,
          };
        }
        primal[col.name] = m.shift;
      } else if (m.kind === "shifted_ub") {
        if (effC > optTol) {
          return {
            status: "unbounded",
            objectiveValue: isMax ? Infinity : -Infinity,
            primal: {},
            dual: {},
            reducedCosts: {},
            iterations: 0,
          };
        }
        primal[col.name] = m.shift;
      } else {
        if (Math.abs(effC) > optTol) {
          return {
            status: "unbounded",
            objectiveValue: isMax ? Infinity : -Infinity,
            primal: {},
            dual: {},
            reducedCosts: {},
            iterations: 0,
          };
        }
        primal[col.name] = 0;
      }
    }
    return { status: "optimal", objectiveValue: objVal, primal, dual: {}, reducedCosts: {}, iterations: 0 };
  }

  // Convert stdRows to A y = b with b >= 0 by adding slacks and artificials
  const m = stdRows.length;
  // Build column-major sparse representation for all variables (structural + slacks + artificials)
  const colEntries: Array<Array<{ row: number; coeff: number }>> = [];
  for (let j = 0; j < nStdVars; j++) colEntries.push([]);

  const b = new Float64Array(m);
  const rowFlipped = new Uint8Array(m);
  const basis = new Int32Array(m);
  const isArtificial: boolean[] = new Array<boolean>(nStdVars).fill(false);

  // Add structural coefficients and slacks
  const naturalSlackForRow = new Int32Array(m).fill(-1);

  for (let i = 0; i < m; i++) {
    const r = stdRows[i]!;
    const flip = r.rhs < 0 ? -1 : 1;
    if (flip < 0) rowFlipped[i] = 1;
    b[i] = flip * r.rhs;

    for (const t of r.terms) {
      colEntries[t.varIdx]!.push({ row: i, coeff: flip * t.coeff });
    }

    if (r.sense === "L") {
      const slackIdx = colEntries.length;
      const slackCoeff = flip * 1;
      colEntries.push([{ row: i, coeff: slackCoeff }]);
      cStd.push(0);
      isArtificial.push(false);
      if (slackCoeff > 0) naturalSlackForRow[i] = slackIdx;
    } else if (r.sense === "G") {
      const surplusIdx = colEntries.length;
      const surplusCoeff = flip * -1;
      colEntries.push([{ row: i, coeff: surplusCoeff }]);
      cStd.push(0);
      isArtificial.push(false);
      if (surplusCoeff > 0) naturalSlackForRow[i] = surplusIdx;
    }
  }

  const nRealCols = colEntries.length;

  // Assign initial basis: use natural +1 slack if available, else create artificial variable
  let numArtificials = 0;
  for (let i = 0; i < m; i++) {
    if (naturalSlackForRow[i]! >= 0) {
      basis[i] = naturalSlackForRow[i]!;
    } else {
      const artIdx = colEntries.length;
      colEntries.push([{ row: i, coeff: 1 }]);
      cStd.push(0);
      isArtificial.push(true);
      basis[i] = artIdx;
      numArtificials++;
    }
  }

  const nTotalCols = colEntries.length;
  const inBasis = new Uint8Array(nTotalCols);
  for (let i = 0; i < m; i++) inBasis[basis[i]!] = 1;

  // Helper to assemble dense m x m basis matrix B
  function buildBasisMatrix(bIndices: Int32Array): Float64Array {
    const mat = new Float64Array(m * m);
    for (let colPos = 0; colPos < m; colPos++) {
      const varIdx = bIndices[colPos]!;
      for (const e of colEntries[varIdx]!) {
        mat[e.row * m + colPos] = e.coeff;
      }
    }
    return mat;
  }

  let totalIterations = 0;

  function runSimplexPhase(
    costVec: Float64Array,
    maxColAllowed: number,
  ): { status: "optimal" | "unbounded" | "iteration_limit"; lu: LuFactors; xB: Float64Array; pi: Float64Array } {
    let lu = luFactor(buildBasisMatrix(basis), m);
    let xB = luSolve(lu, b);
    let degenerateStreak = 0;

    while (totalIterations < maxIter) {
      // Compute duals pi = B^{-T} c_B
      const cB = new Float64Array(m);
      for (let i = 0; i < m; i++) cB[i] = costVec[basis[i]!]!;
      const pi = luSolveTranspose(lu, cB);

      // Pricing: Dantzig (or Bland if degenerateStreak >= 12)
      const useBland = degenerateStreak >= 12;
      let enterCol = -1;
      let bestRc = -optTol;

      for (let j = 0; j < maxColAllowed; j++) {
        if (inBasis[j]) continue;
        let dot = 0;
        for (const e of colEntries[j]!) {
          dot += pi[e.row]! * e.coeff;
        }
        const rc = costVec[j]! - dot;
        if (rc < -optTol) {
          if (useBland) {
            enterCol = j;
            break;
          }
          if (rc < bestRc) {
            bestRc = rc;
            enterCol = j;
          }
        }
      }

      if (enterCol === -1) {
        return { status: "optimal", lu, xB, pi };
      }

      // Direction: solve B d = a_enter
      const aEnter = new Float64Array(m);
      for (const e of colEntries[enterCol]!) {
        aEnter[e.row] = e.coeff;
      }
      const d = luSolve(lu, aEnter);

      // Ratio test
      let leavePos = -1;
      let minRatio = Infinity;
      for (let i = 0; i < m; i++) {
        const di = d[i]!;
        if (di > 1e-10) {
          const ratio = Math.max(0, xB[i]!) / di;
          if (
            ratio < minRatio - 1e-12 ||
            (Math.abs(ratio - minRatio) <= 1e-12 && leavePos >= 0 && basis[i]! < basis[leavePos]!)
          ) {
            minRatio = ratio;
            leavePos = i;
          }
        }
      }

      if (leavePos === -1) {
        return { status: "unbounded", lu, xB, pi };
      }

      if (minRatio <= 1e-12) {
        degenerateStreak++;
      } else {
        degenerateStreak = 0;
      }

      // Pivot
      const leavingVar = basis[leavePos]!;
      inBasis[leavingVar] = 0;
      basis[leavePos] = enterCol;
      inBasis[enterCol] = 1;
      totalIterations++;

      lu = luFactor(buildBasisMatrix(basis), m);
      if (lu.singular) {
        // Revert pivot if numerical singularity encountered
        inBasis[enterCol] = 0;
        basis[leavePos] = leavingVar;
        inBasis[leavingVar] = 1;
        lu = luFactor(buildBasisMatrix(basis), m);
        return { status: "optimal", lu, xB, pi };
      }
      xB = luSolve(lu, b);
    }

    const cB = new Float64Array(m);
    for (let i = 0; i < m; i++) cB[i] = costVec[basis[i]!]!;
    const pi = luSolveTranspose(lu, cB);
    return { status: "iteration_limit", lu, xB, pi };
  }

  // ── Phase I (if artificial variables exist) ──
  if (numArtificials > 0) {
    const phase1Cost = new Float64Array(nTotalCols);
    for (let j = nRealCols; j < nTotalCols; j++) {
      phase1Cost[j] = 1;
    }

    const p1 = runSimplexPhase(phase1Cost, nTotalCols);
    if (p1.status === "iteration_limit") {
      return {
        status: "iteration_limit",
        objectiveValue: Number.NaN,
        primal: {},
        dual: {},
        reducedCosts: {},
        iterations: totalIterations,
      };
    }

    let artSum = 0;
    for (let i = 0; i < m; i++) {
      if (isArtificial[basis[i]!]) {
        artSum += Math.max(0, p1.xB[i]!);
      }
    }
    if (artSum > feasTol) {
      return {
        status: "infeasible",
        objectiveValue: Number.NaN,
        primal: {},
        dual: {},
        reducedCosts: {},
        iterations: totalIterations,
      };
    }

    // Drive any degenerate (0-valued) artificial variables out of the basis
    for (let i = 0; i < m; i++) {
      if (!isArtificial[basis[i]!]) continue;
      const luCur = luFactor(buildBasisMatrix(basis), m);
      const eI = new Float64Array(m);
      eI[i] = 1;
      const rowInv = luSolveTranspose(luCur, eI);

      for (let j = 0; j < nRealCols; j++) {
        if (inBasis[j]) continue;
        let pivVal = 0;
        for (const e of colEntries[j]!) {
          pivVal += rowInv[e.row]! * e.coeff;
        }
        if (Math.abs(pivVal) > 1e-8) {
          inBasis[basis[i]!] = 0;
          basis[i] = j;
          inBasis[j] = 1;
          break;
        }
      }
    }
  }

  // ── Phase II ──
  const phase2Cost = new Float64Array(nTotalCols);
  for (let j = 0; j < nRealCols; j++) {
    phase2Cost[j] = cStd[j]!;
  }

  const p2 = runSimplexPhase(phase2Cost, nRealCols);
  if (p2.status === "unbounded") {
    return {
      status: "unbounded",
      objectiveValue: isMax ? Infinity : -Infinity,
      primal: {},
      dual: {},
      reducedCosts: {},
      iterations: totalIterations,
    };
  }
  if (p2.status === "iteration_limit") {
    return {
      status: "iteration_limit",
      objectiveValue: Number.NaN,
      primal: {},
      dual: {},
      reducedCosts: {},
      iterations: totalIterations,
    };
  }

  // Extract standard variable values
  const yVal = new Float64Array(nTotalCols);
  for (let i = 0; i < m; i++) {
    yVal[basis[i]!] = Math.abs(p2.xB[i]!) < 1e-12 ? 0 : p2.xB[i]!;
  }

  // Reconstruct original primal values and reduced costs
  const primal: Record<string, number> = {};
  const reducedCosts: Record<string, number> = {};
  let objVal = objOffset;

  for (let j = 0; j < colList.length; j++) {
    const col = colList[j]!;
    const map = mappings[j]!;
    let xVal: number;
    if (map.kind === "fixed") {
      xVal = map.shift;
      reducedCosts[col.name] = 0;
    } else if (map.kind === "shifted_lb") {
      xVal = map.shift + yVal[map.posIdx]!;
      let dot = 0;
      for (const e of colEntries[map.posIdx]!) dot += p2.pi[e.row]! * e.coeff;
      reducedCosts[col.name] = sign * (phase2Cost[map.posIdx]! - dot);
    } else if (map.kind === "shifted_ub") {
      xVal = map.shift - yVal[map.posIdx]!;
      let dot = 0;
      for (const e of colEntries[map.posIdx]!) dot += p2.pi[e.row]! * e.coeff;
      reducedCosts[col.name] = -sign * (phase2Cost[map.posIdx]! - dot);
    } else {
      xVal = yVal[map.posIdx]! - yVal[map.negIdx]!;
      reducedCosts[col.name] = 0;
    }
    if (Math.abs(xVal) < 1e-12) xVal = 0;
    primal[col.name] = xVal;

    const objEntry = objRow ? col.entries.find((e) => e.rowName === objRow) : undefined;
    if (objEntry && map.kind !== "fixed") {
      objVal += objEntry.coeff * (xVal - map.shift);
    }
  }

  // Reconstruct duals for original constraint rows
  const dual: Record<string, number> = {};
  for (let i = 0; i < m; i++) {
    const r = stdRows[i]!;
    if (r.origRowName) {
      const flip = rowFlipped[i] ? -1 : 1;
      const dVal = sign * flip * p2.pi[i]!;
      dual[r.origRowName] = (dual[r.origRowName] ?? 0) + (Math.abs(dVal) < 1e-12 ? 0 : dVal);
    }
  }

  return {
    status: "optimal",
    objectiveValue: Math.abs(objVal) < 1e-12 ? 0 : objVal,
    primal,
    dual,
    reducedCosts,
    iterations: totalIterations,
  };
}
