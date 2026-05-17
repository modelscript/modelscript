// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sparse Jacobian evaluator using graph-coloring-compressed forward-mode AD.
 *
 * Instead of n individual reverse-mode sweeps (one per equation), this module
 * performs `numColors` compressed forward-mode tape evaluations. Each sweep
 * seeds all columns with the same color simultaneously, exploiting the fact
 * that structurally independent columns cannot interfere during decompression.
 *
 * Memory: O(nnz) instead of O(n²)
 * AD sweeps: O(numColors) instead of O(n)
 *
 * For a banded system with bandwidth k, numColors ≈ 2k+1 ≪ n.
 */

import {
  ModelicaArrayEquation,
  type ModelicaDAE,
  type ModelicaExpression,
  StaticTapeBuilder,
  type TapeOp,
  colorJacobianColumns,
  computeJacobianSparsity,
} from "@modelscript/symbolics";

/** Compressed Sparse Row representation of the Jacobian. */
export interface SparseJacobian {
  /** Matrix dimension (n × n). */
  n: number;
  /** Row pointers (length n+1). rowPtr[i]..rowPtr[i+1] are the entries in row i. */
  rowPtr: Int32Array;
  /** Column indices of non-zero entries (length nnz). */
  colIdx: Int32Array;
  /** Values of non-zero entries (length nnz). Mutated in-place on each evaluation. */
  values: Float64Array;
  /** Number of non-zeros. */
  nnz: number;
}

import { extractDerName as extractDer } from "./simulator.js";

/**
 * Forward-mode tape evaluation with a seed vector.
 *
 * Each tape node gets a value t[i] (from forward eval) and a derivative
 * dt[i] (from the seed propagation). The seed vector `seeds` maps
 * variable names to their seed values (0 or 1).
 *
 * Returns both value and derivative arrays.
 */
function evaluateTapeForwardDual(
  ops: TapeOp[],
  varValues: Map<string, number>,
  seeds: Map<string, number>,
): { t: Float64Array; dt: Float64Array } {
  const n = ops.length;
  const t = new Float64Array(n);
  const dt = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const op = ops[i];
    if (!op) continue;
    switch (op.type) {
      case "const":
        t[i] = op.val;
        // dt[i] = 0 (default)
        break;
      case "var":
        t[i] = varValues.get(op.name) ?? 0;
        dt[i] = seeds.get(op.name) ?? 0;
        break;
      case "add":
        t[i] = (t[op.a] ?? 0) + (t[op.b] ?? 0);
        dt[i] = (dt[op.a] ?? 0) + (dt[op.b] ?? 0);
        break;
      case "sub":
        t[i] = (t[op.a] ?? 0) - (t[op.b] ?? 0);
        dt[i] = (dt[op.a] ?? 0) - (dt[op.b] ?? 0);
        break;
      case "mul": {
        const av = t[op.a] ?? 0;
        const bv = t[op.b] ?? 0;
        t[i] = av * bv;
        dt[i] = av * (dt[op.b] ?? 0) + (dt[op.a] ?? 0) * bv;
        break;
      }
      case "div": {
        const av = t[op.a] ?? 0;
        const bv = t[op.b] ?? 0;
        t[i] = av / bv;
        dt[i] = ((dt[op.a] ?? 0) * bv - av * (dt[op.b] ?? 0)) / (bv * bv);
        break;
      }
      case "pow": {
        const base = t[op.a] ?? 0;
        const exp = t[op.b] ?? 0;
        const v = Math.pow(base, exp);
        t[i] = v;
        const dBase = dt[op.a] ?? 0;
        const dExp = dt[op.b] ?? 0;
        // d(a^b) = a^b * (b * da/a + db * ln(a))
        if (dExp === 0) {
          dt[i] = exp * Math.pow(base, exp - 1) * dBase;
        } else if (dBase === 0) {
          dt[i] = v * Math.log(base) * dExp;
        } else {
          dt[i] = v * ((exp * dBase) / base + dExp * Math.log(base));
        }
        break;
      }
      case "neg":
        t[i] = -(t[op.a] ?? 0);
        dt[i] = -(dt[op.a] ?? 0);
        break;
      case "sin": {
        const av = t[op.a] ?? 0;
        t[i] = Math.sin(av);
        dt[i] = (dt[op.a] ?? 0) * Math.cos(av);
        break;
      }
      case "cos": {
        const av = t[op.a] ?? 0;
        t[i] = Math.cos(av);
        dt[i] = -(dt[op.a] ?? 0) * Math.sin(av);
        break;
      }
      case "tan": {
        const av = t[op.a] ?? 0;
        const tv = Math.tan(av);
        t[i] = tv;
        dt[i] = (dt[op.a] ?? 0) * (1 + tv * tv);
        break;
      }
      case "exp": {
        const v = Math.exp(t[op.a] ?? 0);
        t[i] = v;
        dt[i] = (dt[op.a] ?? 0) * v;
        break;
      }
      case "log": {
        const av = t[op.a] ?? 0;
        t[i] = Math.log(av);
        dt[i] = (dt[op.a] ?? 0) / av;
        break;
      }
      case "sqrt": {
        const v = Math.sqrt(t[op.a] ?? 0);
        t[i] = v;
        dt[i] = (dt[op.a] ?? 0) / (2 * v);
        break;
      }
      // ── Vector ops ──
      case "vec_var":
        for (let k = 0; k < op.size; k++) {
          const name = `${op.baseName}[${k + 1}]`;
          t[i + k] = varValues.get(name) ?? 0;
          dt[i + k] = seeds.get(name) ?? 0;
        }
        break;
      case "vec_const":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = op.vals[k] ?? 0;
          // dt[i+k] = 0
        }
        break;
      case "vec_add":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = (t[op.a + k] ?? 0) + (t[op.b + k] ?? 0);
          dt[i + k] = (dt[op.a + k] ?? 0) + (dt[op.b + k] ?? 0);
        }
        break;
      case "vec_sub":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = (t[op.a + k] ?? 0) - (t[op.b + k] ?? 0);
          dt[i + k] = (dt[op.a + k] ?? 0) - (dt[op.b + k] ?? 0);
        }
        break;
      case "vec_mul":
        for (let k = 0; k < op.size; k++) {
          const a = t[op.a + k] ?? 0;
          const b = t[op.b + k] ?? 0;
          t[i + k] = a * b;
          dt[i + k] = a * (dt[op.b + k] ?? 0) + (dt[op.a + k] ?? 0) * b;
        }
        break;
      case "vec_neg":
        for (let k = 0; k < op.size; k++) {
          t[i + k] = -(t[op.a + k] ?? 0);
          dt[i + k] = -(dt[op.a + k] ?? 0);
        }
        break;
      case "vec_subscript":
        t[i] = t[op.a + op.offset] ?? 0;
        dt[i] = dt[op.a + op.offset] ?? 0;
        break;
      case "nop":
        break;
    }
  }

  return { t, dt };
}

/**
 * Build a sparse AD Jacobian evaluator from a ModelicaDAE.
 *
 * At compile time:
 *   1. Extract derivative equations from the DAE
 *   2. Compute structural sparsity pattern
 *   3. Color the column intersection graph
 *   4. Build per-equation AD tapes
 *
 * Returns a closure `(t, y) → SparseJacobian` that evaluates the exact
 * Jacobian using compressed forward-mode AD with `numColors` sweeps.
 *
 * @param dae The flattened DAE
 * @returns Sparse Jacobian evaluator, or null if no derivative equations found
 */
export function buildSparseAdJacobian(
  dae: ModelicaDAE,
  stateNames: string[],
): { evaluator: (time: number, y: number[]) => SparseJacobian; numColors: number; nnz: number } | null {
  // ── Step 1: Extract derivative equations in the order of stateNames ──
  const derEqsMap = new Map<string, ModelicaExpression>();
  for (const eq of dae.sortedEquations.length > 0 ? dae.sortedEquations : Array.from(dae.arenaEquations())) {
    if (!("expression1" in eq && "expression2" in eq)) continue;
    const se = eq as { expression1: ModelicaExpression; expression2: ModelicaExpression };
    const ld = extractDer(se.expression1);
    const rd = extractDer(se.expression2);

    if (eq instanceof ModelicaArrayEquation) {
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? se.expression2 : se.expression1;
      const v = dae.arenaGetVarByName(baseName);
      const dims = v?.arrayDimensions ?? [];
      const size = dims.length > 0 ? dims.reduce((a: number, b: number) => a * b, 1) : 1;

      if (baseName.includes("[") || size === 1) {
        derEqsMap.set(baseName, rhs);
      } else {
        for (let i = 0; i < size; i++) {
          derEqsMap.set(`${baseName}[${i + 1}]`, rhs);
        }
      }
      continue;
    }

    if (ld) derEqsMap.set(ld, se.expression2);
    else if (rd) derEqsMap.set(rd, se.expression1);
  }

  const derEqs: { state: string; rhs: ModelicaExpression }[] = [];
  for (const name of stateNames) {
    const rhs = derEqsMap.get(name);
    if (!rhs) {
      console.error(
        `buildSparseAdJacobian failed: Missing derivative for state ${name}. Available keys: ${Array.from(derEqsMap.keys()).join(", ")}`,
      );
      return null; // Missing derivative for state variable
    }
    derEqs.push({ state: name, rhs });
  }

  if (derEqs.length === 0) {
    console.error(`buildSparseAdJacobian failed: derEqs is empty.`);
    console.error(`Requested stateNames: ${stateNames.join(", ")}`);
    console.error(`Available keys in derEqsMap: ${Array.from(derEqsMap.keys()).join(", ")}`);
    return null;
  }

  const n = stateNames.length;

  // ── Step 2: Compute sparsity pattern ──
  const { ccs } = computeJacobianSparsity(dae);

  // ── Step 3: Color the column intersection graph ──
  const coloring = colorJacobianColumns(ccs, n);

  // ── Step 4: Build per-equation AD tapes ──
  const tapeData: { ops: TapeOp[]; outputIndex: number }[] = [];
  for (const eq of derEqs) {
    const tape = new StaticTapeBuilder();
    const outIdx = tape.walk(eq.rhs);
    tapeData.push({ ops: [...tape.ops], outputIndex: outIdx });
  }

  // ── Step 5: Build CSR structure from CCS ──
  // Convert CCS (column-oriented) to CSR (row-oriented) for output
  const rowCounts = new Int32Array(n);
  for (let col = 0; col < n; col++) {
    const start = ccs.col_ptr[col] ?? 0;
    const end = ccs.col_ptr[col + 1] ?? 0;
    for (let p = start; p < end; p++) {
      const row = ccs.row_indices[p] ?? 0;
      if (row < n) rowCounts[row] = (rowCounts[row] ?? 0) + 1;
    }
  }

  const rowPtr = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    rowPtr[i + 1] = (rowPtr[i] ?? 0) + (rowCounts[i] ?? 0);
  }
  const nnz = rowPtr[n] ?? 0;
  const colIdx = new Int32Array(nnz);
  const csrFillPos = new Int32Array(n); // temp counter

  // Build row → (col, csrIndex) mapping for decompression
  for (let col = 0; col < n; col++) {
    const start = ccs.col_ptr[col] ?? 0;
    const end = ccs.col_ptr[col + 1] ?? 0;
    for (let p = start; p < end; p++) {
      const row = ccs.row_indices[p] ?? 0;
      if (row >= n) continue;
      const pos = (rowPtr[row] ?? 0) + (csrFillPos[row] ?? 0);
      colIdx[pos] = col;
      csrFillPos[row] = (csrFillPos[row] ?? 0) + 1;
    }
  }

  // Sort each row's column indices (CSR convention)
  for (let row = 0; row < n; row++) {
    const start = rowPtr[row] ?? 0;
    const end = rowPtr[row + 1] ?? 0;
    const slice = Array.from(colIdx.subarray(start, end));
    slice.sort((a, b) => a - b);
    for (let k = 0; k < slice.length; k++) {
      colIdx[start + k] = slice[k] ?? 0;
    }
  }

  // Build lookup: for each (row, color), which CSR index does the decompressed value go?
  // decompressMap[color] = array of { row, csrIndex }
  const decompressMap: { row: number; csrIndex: number }[][] = [];
  for (let c = 0; c < coloring.numColors; c++) {
    decompressMap.push([]);
  }
  for (let row = 0; row < n; row++) {
    const start = rowPtr[row] ?? 0;
    const end = rowPtr[row + 1] ?? 0;
    for (let p = start; p < end; p++) {
      const col = colIdx[p] ?? 0;
      const color = coloring.colors[col] ?? 0;
      const dMap = decompressMap[color];
      if (dMap) dMap.push({ row, csrIndex: p });
    }
  }

  // ── Return the runtime evaluator closure ──
  const values = new Float64Array(nnz);
  const sparseJ: SparseJacobian = { n, rowPtr, colIdx, values, nnz };

  const evaluator = (time: number, y: number[]): SparseJacobian => {
    // Build variable value map
    const varValues = new Map<string, number>();
    varValues.set("time", time);
    for (let i = 0; i < n; i++) {
      const name = stateNames[i];
      if (name) varValues.set(name, y[i] ?? 0);
    }
    for (const v of dae.arenaVariables()) {
      if (!varValues.has(v.name) && v.expression) {
        varValues.set(v.name, 0);
      }
    }

    // Zero out values
    values.fill(0);

    // For each color, run compressed forward-mode sweep on all equations
    for (let c = 0; c < coloring.numColors; c++) {
      const group = coloring.colorGroups[c];
      if (!group) continue;

      // Build seed: all columns with this color get seed = 1
      const seeds = new Map<string, number>();
      for (const col of group) {
        const name = stateNames[col];
        if (name) seeds.set(name, 1);
      }

      // Evaluate each equation tape with this seed
      for (let row = 0; row < n; row++) {
        const td = tapeData[row];
        if (!td) continue;

        const { dt } = evaluateTapeForwardDual(td.ops, varValues, seeds);
        const dVal = dt[td.outputIndex] ?? 0;

        if (dVal !== 0) {
          // Decompress: find which column in this color group has a non-zero
          // in this row, and store the derivative there
          const rStart = rowPtr[row] ?? 0;
          const rEnd = rowPtr[row + 1] ?? 0;
          for (let p = rStart; p < rEnd; p++) {
            const col = colIdx[p] ?? 0;
            if (coloring.colors[col] === c) {
              values[p] = dVal;
              break;
            }
          }
        }
      }
    }

    return sparseJ;
  };

  return { evaluator, numColors: coloring.numColors, nnz };
}

/**
 * Convert a SparseJacobian (CSR) to a dense number[][] for compatibility
 * with the existing BDF integrator.
 */
export function sparseJacobianToDense(sj: SparseJacobian): number[][] {
  const J: number[][] = [];
  for (let i = 0; i < sj.n; i++) {
    const row = new Array<number>(sj.n).fill(0);
    const start = sj.rowPtr[i] ?? 0;
    const end = sj.rowPtr[i + 1] ?? 0;
    for (let p = start; p < end; p++) {
      row[sj.colIdx[p] ?? 0] = sj.values[p] ?? 0;
    }
    J.push(row);
  }
  return J;
}
