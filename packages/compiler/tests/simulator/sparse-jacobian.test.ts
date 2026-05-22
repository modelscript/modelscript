import { buildCCS, colorJacobianColumns } from "@modelscript/compiler";
import { describe, expect, it } from "vitest";
import { sparseJacobianToDense, type SparseJacobian } from "../../src/simulator/evaluator/sparse-jacobian.js";
import { bdf } from "../../src/simulator/solvers/bdf.js";

describe("sparse-jacobian", () => {
  it("tridiagonal coloring", () => {
    const n = 10;
    const rowDeps: Set<string>[] = [];
    const columns: string[] = [];
    for (let i = 0; i < n; i++) columns.push(`x${i}`);
    for (let i = 0; i < n; i++) {
      const deps = new Set<string>();
      if (i > 0) deps.add(`x${i - 1}`);
      deps.add(`x${i}`);
      if (i < n - 1) deps.add(`x${i + 1}`);
      rowDeps.push(deps);
    }
    const ccs = buildCCS(rowDeps, columns);
    const result = colorJacobianColumns(ccs, n);
    expect(result.numColors).toBe(3);
    for (let i = 0; i < n - 1; i++) {
      expect(result.colors[i]).not.toBe(result.colors[i + 1]);
    }
  });

  it("dense coloring", () => {
    const n = 5;
    const rowDeps: Set<string>[] = [];
    const columns: string[] = [];
    for (let i = 0; i < n; i++) columns.push(`x${i}`);
    for (let i = 0; i < n; i++) {
      const deps = new Set<string>();
      for (let j = 0; j < n; j++) deps.add(`x${j}`);
      rowDeps.push(deps);
    }
    const ccs = buildCCS(rowDeps, columns);
    const result = colorJacobianColumns(ccs, n);
    expect(result.numColors).toBe(n);
  });

  it("diagonal coloring", () => {
    const n = 20;
    const rowDeps: Set<string>[] = [];
    const columns: string[] = [];
    for (let i = 0; i < n; i++) columns.push(`x${i}`);
    for (let i = 0; i < n; i++) rowDeps.push(new Set([`x${i}`]));
    const ccs = buildCCS(rowDeps, columns);
    const result = colorJacobianColumns(ccs, n);
    expect(result.numColors).toBe(1);
  });

  it("coloring validity", () => {
    const blockSize = 3;
    const nBlocks = 5;
    const n = blockSize * nBlocks;
    const rowDeps: Set<string>[] = [];
    const columns: string[] = [];
    for (let i = 0; i < n; i++) columns.push(`x${i}`);
    for (let b = 0; b < nBlocks; b++) {
      for (let r = 0; r < blockSize; r++) {
        const deps = new Set<string>();
        for (let c = 0; c < blockSize; c++) deps.add(`x${b * blockSize + c}`);
        if (b > 0) {
          for (let c = 0; c < blockSize; c++) deps.add(`x${(b - 1) * blockSize + c}`);
        }
        if (b < nBlocks - 1) {
          for (let c = 0; c < blockSize; c++) deps.add(`x${(b + 1) * blockSize + c}`);
        }
        rowDeps.push(deps);
      }
    }
    const ccs = buildCCS(rowDeps, columns);
    const result = colorJacobianColumns(ccs, n);
    const rowToCols = new Map<number, number[]>();
    for (let col = 0; col < n; col++) {
      const start = ccs.col_ptr[col] ?? 0;
      const end = ccs.col_ptr[col + 1] ?? 0;
      for (let p = start; p < end; p++) {
        const row = ccs.row_indices[p] ?? 0;
        let cols = rowToCols.get(row);
        if (!cols) {
          cols = [];
          rowToCols.set(row, cols);
        }
        cols.push(col);
      }
    }
    for (const [, cols] of rowToCols) {
      for (let i = 0; i < cols.length; i++) {
        for (let j = i + 1; j < cols.length; j++) {
          const ci = cols[i] ?? 0;
          const cj = cols[j] ?? 0;
          expect(result.colors[ci]).not.toBe(result.colors[cj]);
        }
      }
    }
  });

  it("BDF with sparse Jacobian", () => {
    const f = (_t: number, y: number[]) => [-(y[0] ?? 0)];
    const sparseFn = (): SparseJacobian => ({
      n: 1,
      rowPtr: new Int32Array([0, 1]),
      colIdx: new Int32Array([0]),
      values: new Float64Array([-1.0]),
      nnz: 1,
    });
    const tEnd = 2.0;
    const nPoints = 100;
    const outputTimes: number[] = [];
    for (let i = 0; i <= nPoints; i++) outputTimes.push((i / nPoints) * tEnd);
    const result = bdf(f, 0, [1.0], tEnd, outputTimes, { sparseJacobian: sparseFn, maxStep: 0.1, maxOrder: 1 });
    expect(result.times.length).toBeGreaterThanOrEqual(2);
    const lastIdx = result.times.length - 1;
    const tLast = result.times[lastIdx] ?? 0;
    const yLast = result.states[lastIdx]?.[0] ?? 0;
    expect(tLast).toBeCloseTo(tEnd, 1);
    expect(yLast).toBeCloseTo(Math.exp(-tEnd), 3);
  });

  it("sparseJacobianToDense conversion", () => {
    const sj: SparseJacobian = {
      n: 3,
      rowPtr: new Int32Array([0, 2, 4, 5]),
      colIdx: new Int32Array([0, 1, 0, 2, 1]),
      values: new Float64Array([1.0, 2.0, 3.0, 4.0, 5.0]),
      nnz: 5,
    };
    const dense = sparseJacobianToDense(sj);
    expect(dense[0]?.[0]).toBe(1);
    expect(dense[0]?.[1]).toBe(2);
    expect(dense[0]?.[2]).toBe(0);
    expect(dense[1]?.[0]).toBe(3);
    expect(dense[1]?.[1]).toBe(0);
    expect(dense[1]?.[2]).toBe(4);
    expect(dense[2]?.[0]).toBe(0);
    expect(dense[2]?.[1]).toBe(5);
    expect(dense[2]?.[2]).toBe(0);
  });
});
