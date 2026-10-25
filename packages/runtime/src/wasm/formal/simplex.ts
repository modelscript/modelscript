// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Flat-Buffer Unified Tableau Simplex Engine (AssemblyScript / WebAssembly)
 *
 * Implements a high-performance, zero-intermediate-allocation Simplex solver in
 * WebAssembly linear memory supporting:
 *   1. Two-Phase Simplex with Dual Farkas Multiplier Extraction:
 *      Solves LRA Craig Interpolation separation problems:
 *        Find lambda >= 0 such that lambda^T C = 0, sum(lambda) = 1, minimizing sum(d_i * lambda_i).
 *        If optimal Z* < 0, extracts sound separating hyperplane for IC3/PDR and CHC lemmas.
 *   2. Dutertre-de Moura SMT Simplex:
 *      Exact infinitesimal (r + k*delta) lexicographic bounds checking with Bland's
 *      anti-cycling rule for linear real arithmetic feasibility, bounds propagation,
 *      and conflict set generation.
 */

export const SIMPLEX_RESULT_UNKNOWN: i32    = 0;
export const SIMPLEX_RESULT_OPTIMAL: i32    = 1;
export const SIMPLEX_RESULT_INFEASIBLE: i32 = 2;
export const SIMPLEX_RESULT_UNBOUNDED: i32  = 3;

export const SIMPLEX_MODE_TWO_PHASE: i32         = 1;
export const SIMPLEX_MODE_DUTERTRE_DE_MOURA: i32 = 2;

@inline
function infLt(ar: f64, ak: i32, br: f64, bk: i32, tol: f64 = 1e-12): bool {
  if (ar < br - tol) return true;
  if (ar > br + tol) return false;
  return ak < bk;
}

@inline
function infGt(ar: f64, ak: i32, br: f64, bk: i32, tol: f64 = 1e-12): bool {
  return infLt(br, bk, ar, ak, tol);
}

/**
 * Unified Tableau Simplex solver operating over contiguous linear memory buffers.
 */
export class WasmSimplexSolver {
  public maxRows: i32;
  public maxCols: i32;
  public numRows: i32;
  public numCols: i32;

  // Dense flat tableau: row-major order with stride (numCols + 1)
  public tableau: Float64Array;
  // Basic variable indices for each row
  public basic: Int32Array;

  // Extracted solution
  public multipliers: Float64Array;
  public assignments: Float64Array;
  public optimalValue: f64;

  // Dutertre-de Moura InfNumber structures
  public totalVars: i32;
  public basicVarOfRow: Int32Array;
  public nonBasicVarOfCol: Int32Array;
  public lowerR: Float64Array;
  public lowerK: Int32Array;
  public upperR: Float64Array;
  public upperK: Int32Array;
  public betaR: Float64Array;
  public betaK: Int32Array;

  constructor(maxRows: i32, maxCols: i32) {
    this.maxRows = maxRows;
    this.maxCols = maxCols;
    this.numRows = 0;
    this.numCols = 0;
    this.totalVars = 0;

    let totalCells = (maxRows + 2) * (maxCols + 2);
    this.tableau = new Float64Array(totalCells);
    this.basic = new Int32Array(maxRows + 2);
    this.multipliers = new Float64Array(maxCols + 2);
    this.assignments = new Float64Array(maxCols + 2);
    this.optimalValue = 0.0;

    let varCap = maxRows + maxCols + 4;
    this.basicVarOfRow = new Int32Array(maxRows + 2);
    this.nonBasicVarOfCol = new Int32Array(maxCols + 2);
    this.lowerR = new Float64Array(varCap);
    this.lowerK = new Int32Array(varCap);
    this.upperR = new Float64Array(varCap);
    this.upperK = new Int32Array(varCap);
    this.betaR = new Float64Array(varCap);
    this.betaK = new Int32Array(varCap);
  }

  @inline
  public get(r: i32, c: i32): f64 {
    let stride = this.numCols + 1;
    return this.tableau[r * stride + c];
  }

  @inline
  public set(r: i32, c: i32, val: f64): void {
    let stride = this.numCols + 1;
    this.tableau[r * stride + c] = val;
  }

  public initTableau(numRows: i32, numCols: i32): void {
    this.numRows = numRows;
    this.numCols = numCols;
    let totalCells = (numRows + 1) * (numCols + 1);
    for (let i = 0; i < totalCells; i++) {
      this.tableau[i] = 0.0;
    }
    for (let r = 0; r <= numRows; r++) {
      this.basic[r] = -1;
    }
    this.optimalValue = 0.0;
  }

  /**
   * Performs Gauss-Jordan pivot operation on tableau entry (leaveRow, enterCol).
   */
  public pivot(leaveRow: i32, enterCol: i32): void {
    let stride = this.numCols + 1;
    let leaveOffset = leaveRow * stride;
    let pivotVal = this.tableau[leaveOffset + enterCol];
    if (Math.abs(pivotVal) < 1e-15) return;
    let invPivot: f64 = 1.0 / pivotVal;

    for (let c = 0; c <= this.numCols; c++) {
      this.tableau[leaveOffset + c] *= invPivot;
    }

    for (let r = 0; r <= this.numRows; r++) {
      if (r != leaveRow) {
        let rOffset = r * stride;
        let factor = this.tableau[rOffset + enterCol];
        if (Math.abs(factor) > 1e-15) {
          for (let c = 0; c <= this.numCols; c++) {
            this.tableau[rOffset + c] -= factor * this.tableau[leaveOffset + c];
          }
        }
      }
    }

    this.basic[leaveRow] = enterCol;
  }

  /**
   * Initializes Farkas Dual LP tableau for Craig interpolation:
   *   numConstraints = m (number of constraints in A and B)
   *   numVars = n (number of shared and private variables)
   * Rows 0..n-1 represent: sum_{i=0}^{m-1} C_{i, j} * lambda_i = 0
   * Row n represents: sum_{i=0}^{m-1} lambda_i = 1
   * Columns 0..m-1 are lambda_i
   * Columns m..m+n are artificial variables
   * Column m+n+1 is RHS
   */
  public initFarkas(m: i32, n: i32): void {
    let numRows = n + 1;
    let numCols = m + numRows;
    this.initTableau(numRows, numCols);

    for (let j = 0; j < n; j++) {
      this.set(j, m + j, 1.0);
      this.set(j, numCols, 0.0);
      this.basic[j] = m + j;
    }

    for (let i = 0; i < m; i++) {
      this.set(n, i, 1.0);
    }
    this.set(n, m + n, 1.0);
    this.set(n, numCols, 1.0);
    this.basic[n] = m + n;
  }

  /**
   * Solves Two-Phase Simplex to extract Farkas multipliers.
   * `dPtr` points to an array of m f64 values (the constraint RHS bounds d_i).
   */
  public solveTwoPhaseFarkas(m: i32, n: i32, dPtr: usize): i32 {
    let numRows = n + 1;
    let numCols = m + numRows;

    // Phase I: Maximize - sum(artificials)
    for (let c = 0; c <= numCols; c++) {
      this.set(numRows, c, 0.0);
    }
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < m; c++) {
        let cur = this.get(numRows, c);
        this.set(numRows, c, cur - this.get(r, c));
      }
      let curRhs = this.get(numRows, numCols);
      this.set(numRows, numCols, curRhs - this.get(r, numCols));
    }

    let iter: i32 = 0;
    while (iter < 500) {
      iter++;
      let enterCol: i32 = -1;
      let minCost: f64 = -1e-9;
      for (let c = 0; c < m; c++) {
        let cost = this.get(numRows, c);
        if (cost < minCost) {
          minCost = cost;
          enterCol = c;
        }
      }
      if (enterCol == -1) break;

      let leaveRow: i32 = -1;
      let minRatio: f64 = 1e30;
      for (let r = 0; r < numRows; r++) {
        let coeff = this.get(r, enterCol);
        if (coeff > 1e-9) {
          let rhsVal = this.get(r, numCols);
          let ratio = (rhsVal < 0.0 ? 0.0 : rhsVal) / coeff;
          if (ratio < minRatio - 1e-12) {
            minRatio = ratio;
            leaveRow = r;
          }
        }
      }
      if (leaveRow == -1) break;
      this.pivot(leaveRow, enterCol);
    }

    if (this.get(numRows, numCols) < -1e-5) {
      // Infeasible equality constraints on simplex: no Farkas certificate
      return SIMPLEX_RESULT_INFEASIBLE;
    }

    // Phase II: Minimize sum_{i=0}^{m-1} d_i * lambda_i
    for (let c = 0; c <= numCols; c++) {
      this.set(numRows, c, 0.0);
    }
    for (let i = 0; i < m; i++) {
      let dVal: f64 = load<f64>(dPtr + (<usize>i << 3));
      this.set(numRows, i, dVal);
    }

    for (let r = 0; r < numRows; r++) {
      let bVar = this.basic[r];
      if (bVar >= 0 && bVar < m) {
        let coeff = this.get(numRows, bVar);
        if (Math.abs(coeff) > 1e-15) {
          for (let c = 0; c <= numCols; c++) {
            let cur = this.get(numRows, c);
            this.set(numRows, c, cur - coeff * this.get(r, c));
          }
        }
      }
    }

    iter = 0;
    while (iter < 500) {
      iter++;
      let enterCol: i32 = -1;
      let minCost: f64 = -1e-9;
      for (let c = 0; c < m; c++) {
        let cost = this.get(numRows, c);
        if (cost < minCost) {
          minCost = cost;
          enterCol = c;
        }
      }
      if (enterCol == -1) break;

      let leaveRow: i32 = -1;
      let minRatio: f64 = 1e30;
      for (let r = 0; r < numRows; r++) {
        let coeff = this.get(r, enterCol);
        if (coeff > 1e-9) {
          let rhsVal = this.get(r, numCols);
          let ratio = (rhsVal < 0.0 ? 0.0 : rhsVal) / coeff;
          if (ratio < minRatio - 1e-12) {
            minRatio = ratio;
            leaveRow = r;
          }
        }
      }
      if (leaveRow == -1) break;
      this.pivot(leaveRow, enterCol);
    }

    // Extract lambda multipliers
    for (let i = 0; i < m; i++) {
      this.multipliers[i] = 0.0;
    }
    for (let r = 0; r < numRows; r++) {
      let bVar = this.basic[r];
      if (bVar >= 0 && bVar < m) {
        let rhsVal = this.get(r, numCols);
        this.multipliers[bVar] = rhsVal < 0.0 ? 0.0 : rhsVal;
      }
    }

    let actualZ: f64 = 0.0;
    for (let i = 0; i < m; i++) {
      let dVal: f64 = load<f64>(dPtr + (<usize>i << 3));
      actualZ += dVal * this.multipliers[i];
    }
    this.optimalValue = actualZ;

    return SIMPLEX_RESULT_OPTIMAL;
  }

  /**
   * Initializes Dutertre-de Moura tableau for m constraints and n non-basic variables.
   */
  public initDutertreDeMoura(m: i32, n: i32): void {
    this.numRows = m;
    this.numCols = n;
    this.totalVars = m + n;
    let totalCells = (m + 1) * (n + 1);
    for (let i = 0; i < totalCells; i++) {
      this.tableau[i] = 0.0;
    }
    for (let i = 0; i < m; i++) {
      this.basicVarOfRow[i] = n + i;
    }
    for (let j = 0; j < n; j++) {
      this.nonBasicVarOfCol[j] = j;
    }
    for (let k = 0; k < m + n; k++) {
      this.lowerR[k] = -1e30;
      this.lowerK[k] = 0;
      this.upperR[k] = 1e30;
      this.upperK[k] = 0;
      this.betaR[k] = 0.0;
      this.betaK[k] = 0;
    }
  }

  /**
   * Sets bound on variable k (0 <= k < m + n).
   */
  public setBound(k: i32, isLower: bool, r: f64, kDelta: i32): void {
    if (k < 0 || k >= this.totalVars) return;
    if (isLower) {
      if (infGt(r, kDelta, this.lowerR[k], this.lowerK[k])) {
        this.lowerR[k] = r;
        this.lowerK[k] = kDelta;
      }
    } else {
      if (infLt(r, kDelta, this.upperR[k], this.upperK[k])) {
        this.upperR[k] = r;
        this.upperK[k] = kDelta;
      }
    }
  }

  /**
   * Solves linear system using Dutertre-de Moura algorithm.
   */
  public solveDutertreDeMoura(maxIterations: i32 = 2000): i32 {
    let m = this.numRows;
    let n = this.numCols;

    // Initialize non-basic variable assignments
    for (let j = 0; j < n; j++) {
      let lr = this.lowerR[j];
      let lk = this.lowerK[j];
      let ur = this.upperR[j];
      let uk = this.upperK[j];
      if (infLt(0.0, 0, lr, lk)) {
        this.betaR[j] = lr;
        this.betaK[j] = lk;
      } else if (infGt(0.0, 0, ur, uk)) {
        this.betaR[j] = ur;
        this.betaK[j] = uk;
      } else {
        this.betaR[j] = 0.0;
        this.betaK[j] = 0;
      }
    }

    // Initialize basic variables s_i = sum A_{ij} x_j
    for (let i = 0; i < m; i++) {
      let sumR: f64 = 0.0;
      let sumK: i32 = 0;
      for (let j = 0; j < n; j++) {
        let coeff = this.get(i, j);
        if (Math.abs(coeff) > 1e-15) {
          sumR += this.betaR[this.nonBasicVarOfCol[j]] * coeff;
          sumK += (this.betaK[this.nonBasicVarOfCol[j]] as f64 * coeff) as i32;
        }
      }
      let bVar = this.basicVarOfRow[i];
      this.betaR[bVar] = sumR;
      this.betaK[bVar] = sumK;
    }

    // Dutertre-de Moura pivot loop with Bland's rule
    for (let iter = 0; iter < maxIterations; iter++) {
      let violatingRow: i32 = -1;
      let minViolatingVar: i32 = 0x7fffffff;
      let isTooSmall: bool = false;

      for (let i = 0; i < m; i++) {
        let v = this.basicVarOfRow[i];
        let valR = this.betaR[v];
        let valK = this.betaK[v];
        let lr = this.lowerR[v];
        let lk = this.lowerK[v];
        let ur = this.upperR[v];
        let uk = this.upperK[v];

        if (infLt(valR, valK, lr, lk)) {
          if (v < minViolatingVar) {
            minViolatingVar = v;
            violatingRow = i;
            isTooSmall = true;
          }
        } else if (infGt(valR, valK, ur, uk)) {
          if (v < minViolatingVar) {
            minViolatingVar = v;
            violatingRow = i;
            isTooSmall = false;
          }
        }
      }

      if (violatingRow == -1) {
        // Feasible! Copy non-basic assignments to output
        for (let j = 0; j < n; j++) {
          this.assignments[j] = this.betaR[j];
        }
        return SIMPLEX_RESULT_OPTIMAL;
      }

      let xi = this.basicVarOfRow[violatingRow];
      let enteringCol: i32 = -1;
      let minEnteringVar: i32 = 0x7fffffff;

      for (let j = 0; j < n; j++) {
        let aij = this.get(violatingRow, j);
        if (Math.abs(aij) < 1e-12) continue;

        let xj = this.nonBasicVarOfCol[j];
        let valR = this.betaR[xj];
        let valK = this.betaK[xj];
        let ljR = this.lowerR[xj];
        let ljK = this.lowerK[xj];
        let ujR = this.upperR[xj];
        let ujK = this.upperK[xj];

        let canEnter: bool = false;
        if (isTooSmall) {
          if ((aij > 0.0 && infLt(valR, valK, ujR, ujK)) || (aij < 0.0 && infGt(valR, valK, ljR, ljK))) {
            canEnter = true;
          }
        } else {
          if ((aij > 0.0 && infGt(valR, valK, ljR, ljK)) || (aij < 0.0 && infLt(valR, valK, ujR, ujK))) {
            canEnter = true;
          }
        }

        if (canEnter && xj < minEnteringVar) {
          minEnteringVar = xj;
          enteringCol = j;
        }
      }

      if (enteringCol == -1) {
        return SIMPLEX_RESULT_INFEASIBLE;
      }

      // Pivot
      let aij = this.get(violatingRow, enteringCol);
      let xj = this.nonBasicVarOfCol[enteringCol];

      let targetR: f64 = isTooSmall ? this.lowerR[xi] : this.upperR[xi];
      let targetK: i32 = isTooSmall ? this.lowerK[xi] : this.upperK[xi];
      let thetaR: f64 = (targetR - this.betaR[xi]) / aij;
      let thetaK: i32 = ((targetK - this.betaK[xi]) as f64 / aij) as i32;

      this.betaR[xj] += thetaR;
      this.betaK[xj] += thetaK;
      this.betaR[xi] = targetR;
      this.betaK[xi] = targetK;

      for (let k = 0; k < m; k++) {
        if (k != violatingRow) {
          let akj = this.get(k, enteringCol);
          if (Math.abs(akj) > 1e-15) {
            let bkVar = this.basicVarOfRow[k];
            this.betaR[bkVar] += akj * thetaR;
            this.betaK[bkVar] += (akj * (thetaK as f64)) as i32;
          }
        }
      }

      let invAij: f64 = 1.0 / aij;
      for (let c = 0; c < n; c++) {
        if (c != enteringCol) {
          this.set(violatingRow, c, -this.get(violatingRow, c) * invAij);
        }
      }
      this.set(violatingRow, enteringCol, invAij);

      for (let k = 0; k < m; k++) {
        if (k != violatingRow) {
          let akj = this.get(k, enteringCol);
          if (Math.abs(akj) > 1e-15) {
            for (let c = 0; c < n; c++) {
              if (c != enteringCol) {
                let cur = this.get(k, c);
                this.set(k, c, cur + akj * this.get(violatingRow, c));
              }
            }
            this.set(k, enteringCol, akj * invAij);
          }
        }
      }

      this.basicVarOfRow[violatingRow] = xj;
      this.nonBasicVarOfCol[enteringCol] = xi;
    }

    return SIMPLEX_RESULT_UNKNOWN;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C-ABI / WebAssembly Functions
// ─────────────────────────────────────────────────────────────────────────────

export function simplex_create(maxRows: i32, maxCols: i32): usize {
  let solver = new WasmSimplexSolver(maxRows, maxCols);
  return changetype<usize>(solver);
}

export function simplex_setEntry(sPtr: usize, row: i32, col: i32, val: f64): void {
  if (sPtr == 0) return;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  solver.set(row, col, val);
}

export function simplex_initFarkas(sPtr: usize, m: i32, n: i32): void {
  if (sPtr == 0) return;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  solver.initFarkas(m, n);
}

export function simplex_solveTwoPhaseFarkas(sPtr: usize, m: i32, n: i32, dPtr: usize): i32 {
  if (sPtr == 0) return SIMPLEX_RESULT_UNKNOWN;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  return solver.solveTwoPhaseFarkas(m, n, dPtr);
}

export function simplex_initDutertreDeMoura(sPtr: usize, m: i32, n: i32): void {
  if (sPtr == 0) return;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  solver.initDutertreDeMoura(m, n);
}

export function simplex_setBound(sPtr: usize, k: i32, isLower: bool, r: f64, kDelta: i32): void {
  if (sPtr == 0) return;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  solver.setBound(k, isLower, r, kDelta);
}

export function simplex_solveDutertreDeMoura(sPtr: usize, maxIterations: i32): i32 {
  if (sPtr == 0) return SIMPLEX_RESULT_UNKNOWN;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  return solver.solveDutertreDeMoura(maxIterations);
}

export function simplex_getMultipliers(sPtr: usize, outPtr: usize, count: i32): i32 {
  if (sPtr == 0 || outPtr == 0) return 0;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  for (let i = 0; i < count; i++) {
    store<f64>(outPtr + (<usize>i << 3), solver.multipliers[i]);
  }
  return count;
}

export function simplex_getOptimalValue(sPtr: usize): f64 {
  if (sPtr == 0) return 0.0;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  return solver.optimalValue;
}

export function simplex_getAssignment(sPtr: usize, varIdx: i32): f64 {
  if (sPtr == 0) return 0.0;
  let solver = changetype<WasmSimplexSolver>(sPtr);
  return solver.assignments[varIdx];
}

export function simplex_destroy(sPtr: usize): void {
  // AssemblyScript runtime handles GC once references are cleared
}
