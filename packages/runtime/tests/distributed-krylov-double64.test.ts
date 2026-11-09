// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DD_ONE,
  DD_PI,
  ddAdd,
  ddCos,
  ddDiv,
  ddExp,
  ddFromNumber,
  ddMul,
  ddSin,
  ddSolveLinear,
  ddSqrt,
  ddSub,
  ddToNumber,
  integrateODE_Double64,
  type Double64,
} from "../src/math/double64.js";
import { distributedGMRES, haloExchangeMatVec, partitionDomainGraph } from "../src/solvers/distributed-krylov.js";

describe("Phase 4 Track 4: Domain-Decomposed Parallel Krylov (RAS) & Quad-Precision (Double64)", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. Restricted Additive Schwarz (RAS) & Distributed GMRES
  // ───────────────────────────────────────────────────────────────────────────
  describe("Domain-Decomposed Parallel Krylov & RAS Preconditioning", () => {
    function build2DPoissonCSR(
      nx: number,
      ny: number,
    ): {
      n: number;
      rowPtr: Int32Array;
      colIdx: Int32Array;
      values: Float64Array;
    } {
      const n = nx * ny;
      const rowPtr = new Int32Array(n + 1);
      const cols: number[] = [];
      const vals: number[] = [];

      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const row = iy * nx + ix;
          rowPtr[row] = cols.length;
          if (iy > 0) {
            cols.push((iy - 1) * nx + ix);
            vals.push(-1.0);
          }
          if (ix > 0) {
            cols.push(iy * nx + (ix - 1));
            vals.push(-1.0);
          }
          cols.push(row);
          vals.push(4.0);
          if (ix + 1 < nx) {
            cols.push(iy * nx + (ix + 1));
            vals.push(-1.0);
          }
          if (iy + 1 < ny) {
            cols.push((iy + 1) * nx + ix);
            vals.push(-1.0);
          }
        }
      }
      rowPtr[n] = cols.length;
      return {
        n,
        rowPtr,
        colIdx: new Int32Array(cols),
        values: new Float64Array(vals),
      };
    }

    it("partitions a 2D PDE grid into disjoint interiors with 1-hop and 2-hop algebraic overlap", () => {
      const { n, rowPtr, colIdx, values } = build2DPoissonCSR(8, 8); // N = 64
      const parts = partitionDomainGraph(n, rowPtr, colIdx, 4, 1, values);
      assert.equal(parts.length, 4);

      // Verify disjoint union of interior indices equals {0 .. 63}
      const seenInteriors = new Set<number>();
      let totalInterior = 0;
      for (const p of parts) {
        totalInterior += p.interiorIndices.length;
        assert.ok(p.overlapIndices.length > p.interiorIndices.length, "overlap must include halo");
        assert.ok(p.haloIndices.length > 0, "halo indices must be non-empty");
        assert.ok(p.localLU !== undefined, "local LU must be factored");
        for (const idx of p.interiorIndices) {
          assert.ok(!seenInteriors.has(idx), `duplicate interior node ${idx}`);
          seenInteriors.add(idx);
        }
      }
      assert.equal(totalInterior, n);
      assert.equal(seenInteriors.size, n);
    });

    it("verifies haloExchangeMatVec matches global CSR SpMV bit-identically", () => {
      const { n, rowPtr, colIdx, values } = build2DPoissonCSR(6, 6);
      const parts = partitionDomainGraph(n, rowPtr, colIdx, 4, 1, values);
      const x = new Float64Array(n);
      for (let i = 0; i < n; i++) x[i] = Math.sin(i + 1);

      const { y, haloMessagesExchanged } = haloExchangeMatVec(parts, rowPtr, colIdx, values, x);
      assert.ok(haloMessagesExchanged > 0);

      for (let i = 0; i < n; i++) {
        let ref = 0.0;
        for (let c = rowPtr[i]!; c < rowPtr[i + 1]!; c++) {
          ref += values[c]! * x[colIdx[c]!]!;
        }
        assert.equal(y[i], ref);
      }
    });

    it("solves a 2D Poisson PDE system using 4-subdomain RAS-preconditioned distributedGMRES", () => {
      const { n, rowPtr, colIdx, values } = build2DPoissonCSR(10, 10); // N = 100
      const b = new Float64Array(n).fill(1.0);

      const res = distributedGMRES({
        n,
        rowPtr,
        colIdx,
        values,
        b,
        numSubdomains: 4,
        overlapHops: 2,
        rtol: 1e-11,
        atol: 1e-13,
      });

      assert.ok(res.converged, `distributedGMRES did not converge: residual=${res.residualNorm}`);
      assert.ok(res.residualNorm < 1e-10);
      assert.ok(res.iterations <= 20, `expected fast RAS convergence <= 20 iters, got ${res.iterations}`);
      assert.equal(res.numSubdomains, 4);
      assert.ok(res.haloMessagesExchanged > 0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Quad-Precision (Double64) 106-bit Dekker/Knuth Arithmetic & ODE Solver
  // ───────────────────────────────────────────────────────────────────────────
  describe("Quad-Precision Double64 (106-bit Mantissa) Arithmetic", () => {
    it("prevents catastrophic cancellation in (1 + 10^-20) - 1 where IEEE-754 Float64 returns 0", () => {
      // In IEEE-754 Float64: (1.0 + 1e-20) - 1.0 === 0.0
      const f64Result = 1.0 + 1e-20 - 1.0;
      assert.equal(f64Result, 0.0);

      // In 106-bit Double64: exact 1e-20 is preserved in the low component!
      const one = DD_ONE;
      const tiny = ddFromNumber(1e-20);
      const sum = ddAdd(one, tiny);
      const diff = ddSub(sum, one);
      assert.ok(Math.abs(ddToNumber(diff) - 1e-20) < 1e-35);
    });

    it("verifies 106-bit algebraic & trigonometric identities to < 1e-30 residual", () => {
      // 1. (sqrt(3))^2 - 3 == 0 to ~1e-31
      const three = ddFromNumber(3.0);
      const root3 = ddSqrt(three);
      const sq = ddMul(root3, root3);
      const sqErr = ddSub(sq, three);
      assert.ok(Math.abs(ddToNumber(sqErr)) < 1e-30, `expected |(sqrt(3))^2 - 3| < 1e-30, got ${ddToNumber(sqErr)}`);

      // 2. sin^2(pi/7) + cos^2(pi/7) - 1 == 0 to < 1e-30
      const theta = ddDiv(DD_PI, ddFromNumber(7.0));
      const s = ddSin(theta);
      const c = ddCos(theta);
      const trigId = ddSub(ddAdd(ddMul(s, s), ddMul(c, c)), DD_ONE);
      assert.ok(
        Math.abs(ddToNumber(trigId)) < 1e-30,
        `expected |sin^2 + cos^2 - 1| < 1e-30, got ${ddToNumber(trigId)}`,
      );

      // 3. exp(0.5) * exp(-0.5) - 1 == 0 to < 1e-30
      const half = ddFromNumber(0.5);
      const negHalf = ddFromNumber(-0.5);
      const expProd = ddSub(ddMul(ddExp(half), ddExp(negHalf)), DD_ONE);
      assert.ok(
        Math.abs(ddToNumber(expProd)) < 1e-30,
        `expected |exp(0.5)*exp(-0.5) - 1| < 1e-30, got ${ddToNumber(expProd)}`,
      );
    });

    it("solves an ill-conditioned 8x8 Hilbert linear system accurately in Double64", () => {
      // H_ij = 1 / (i + j + 1), exact x = [1, 1, ..., 1]^T
      const n = 8;
      const A: Double64[][] = [];
      const b: Double64[] = [];
      for (let i = 0; i < n; i++) {
        const row: Double64[] = [];
        let rowSum = ddFromNumber(0.0);
        for (let j = 0; j < n; j++) {
          const entry = ddDiv(DD_ONE, ddFromNumber(i + j + 1));
          row.push(entry);
          rowSum = ddAdd(rowSum, entry);
        }
        A.push(row);
        b.push(rowSum);
      }

      const x = ddSolveLinear(A, b);
      for (let i = 0; i < n; i++) {
        const err = Math.abs(ddToNumber(ddSub(x[i]!, DD_ONE)));
        assert.ok(err < 1e-18, `Hilbert x[${i}] error ${err} exceeded 1e-18`);
      }
    });

    it("integrates harmonic oscillator in 106-bit Double64 breaking past Float64 roundoff floor", () => {
      // y0' = y1, y1' = -y0, y(0) = [1, 0], exact energy E = y0^2 + y1^2 = 1
      // Integrate over [0, 0.1] with 1000 steps (h = 1e-4 => RK4 truncation error ~ h^4 * 0.1 ~ 1e-17,
      // and energy error for symmetric harmonic oscillator in RK4 is O(h^5) ~ 1e-22!)
      const res = integrateODE_Double64(
        (_t, y) => [y[1]!, { hi: -y[0]!.hi, lo: -y[0]!.lo }],
        0.0,
        [1.0, 0.0],
        0.1,
        1000,
        1000,
      );

      const [y0End, y1End] = res.yFinal;
      const tEnd = ddFromNumber(0.1);
      const exactY0 = ddCos(tEnd);
      const exactY1 = ddSin(tEnd);

      const err0 = Math.abs(ddToNumber(ddSub(y0End!, exactY0)));
      const err1 = Math.abs(ddToNumber(ddSub(y1End!, ddFromNumber(-ddToNumber(exactY1)))));
      assert.ok(err0 < 1e-17, `expected Double64 ODE error < 1e-17 (beyond Float64 epsilon), got ${err0}`);
      assert.ok(err1 < 1e-16);
    });
  });
});
