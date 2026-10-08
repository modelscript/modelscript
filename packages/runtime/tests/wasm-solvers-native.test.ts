// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

describe("Native WebAssembly Solvers: Tsit5, TR-BDF2, Rodas-4P, Symplectic & SIMD Kernels", () => {
  async function loadWasm() {
    const wasmPath = path.resolve(import.meta.dirname, "../build/release.wasm");
    const bytes = await fs.readFile(wasmPath);
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {
      env: {
        abort: (_msg: number, _file: number, line: number, col: number) => {
          console.error(`WASM abort at ${line}:${col}`);
        },
      },
    });
    return { wasm: instance.exports as Record<string, any>, memory: instance.exports.memory as WebAssembly.Memory };
  }

  it("should verify exports exist for all native solvers and SIMD kernels", async () => {
    const { wasm } = await loadWasm();
    assert.strictEqual(typeof wasm.sim_stepTsit5, "function", "sim_stepTsit5 must be exported");
    assert.strictEqual(typeof wasm.sim_stepTRBDF2, "function", "sim_stepTRBDF2 must be exported");
    assert.strictEqual(typeof wasm.sim_stepRodas4P, "function", "sim_stepRodas4P must be exported");
    assert.strictEqual(typeof wasm.sim_interpolateRodas4P, "function", "sim_interpolateRodas4P must be exported");
    assert.strictEqual(typeof wasm.sim_stepSymplectic, "function", "sim_stepSymplectic must be exported");
    assert.strictEqual(typeof wasm.luFactor, "function", "luFactor must be exported");
    assert.strictEqual(typeof wasm.luSolve, "function", "luSolve must be exported");
    assert.strictEqual(typeof wasm.vectorDot, "function", "vectorDot must be exported");
    assert.strictEqual(typeof wasm.vectorNorm2, "function", "vectorNorm2 must be exported");
    assert.strictEqual(typeof wasm.vectorNormInf, "function", "vectorNormInf must be exported");
  });

  it("should evaluate 128-bit SIMD vector kernels (dot, norm2, normInf) accurately", async () => {
    const { wasm, memory } = await loadWasm();
    const N = 8;
    const bytes = N * 8;
    const aPtr = wasm.__new ? wasm.__new(bytes, 0) : 1024;
    const bPtr = wasm.__new ? wasm.__new(bytes, 0) : aPtr + bytes;

    const f64Mem = new Float64Array(memory.buffer);
    const aVals = [1.0, 2.0, 3.0, 4.0, 5.0, -6.0, 7.0, -8.0];
    const bVals = [2.0, -1.0, 4.0, -3.0, 0.5, 2.0, 1.0, -0.5];

    for (let i = 0; i < N; i++) {
      f64Mem[(aPtr >> 3) + i] = aVals[i]!;
      f64Mem[(bPtr >> 3) + i] = bVals[i]!;
    }

    // Expected dot product: 1*2 + 2*(-1) + 3*4 + 4*(-3) + 5*0.5 + (-6)*2 + 7*1 + (-8)*(-0.5)
    // = 2 - 2 + 12 - 12 + 2.5 - 12 + 7 + 4 = 1.5
    const dotResult = wasm.vectorDot(aPtr, bPtr, N);
    assert.ok(Math.abs(dotResult - 1.5) < 1e-12, `Expected dot product 1.5, got ${dotResult}`);

    // NormInf: max(|a|) = 8.0
    const normInfA = wasm.vectorNormInf(aPtr, N);
    assert.strictEqual(normInfA, 8.0, `Expected normInf 8.0, got ${normInfA}`);

    // Norm2: sqrt(1^2 + 2^2 + 3^2 + 4^2 + 5^2 + 6^2 + 7^2 + 8^2) = sqrt(204) ≈ 14.2828568570857
    const norm2A = wasm.vectorNorm2(aPtr, N);
    assert.ok(Math.abs(norm2A - Math.sqrt(204.0)) < 1e-12, `Expected norm2 sqrt(204), got ${norm2A}`);
  });

  it("should solve a dense linear system via SIMD-vectorized LU factorization", async () => {
    const { wasm, memory } = await loadWasm();
    // System:
    // [ 3  2 -1 ] [ x0 ]   [ 1 ]
    // [ 2 -2  4 ] [ x1 ] = [ -2 ]
    // [-1 0.5 -1] [ x2 ]   [ 0 ]
    // Exact solution: x = [1, -2, -2] -> 3(1)+2(-2)-(-2) = 3-4+2 = 1
    const n = 3;
    const aPtr = wasm.__new ? wasm.__new(n * n * 8, 0) : 2048;
    const pivPtr = wasm.__new ? wasm.__new(n * 4, 0) : aPtr + n * n * 8;
    const scalePtr = wasm.__new ? wasm.__new(n * 8, 0) : (pivPtr + n * 4 + 7) & ~7;
    const bPtr = wasm.__new ? wasm.__new(n * 8, 0) : scalePtr + n * 8;
    const scratchPtr = wasm.__new ? wasm.__new(n * 8, 0) : bPtr + n * 8;

    const f64Mem = new Float64Array(memory.buffer);
    const A = [3.0, 2.0, -1.0, 2.0, -2.0, 4.0, -1.0, 0.5, -1.0];
    for (let i = 0; i < n * n; i++) {
      f64Mem[(aPtr >> 3) + i] = A[i]!;
    }
    const b = [1.0, -2.0, 0.0];
    for (let i = 0; i < n; i++) {
      f64Mem[(bPtr >> 3) + i] = b[i]!;
    }

    const factorOk = wasm.luFactor(aPtr, pivPtr, scalePtr, n);
    assert.ok(factorOk, "luFactor should succeed for non-singular matrix");

    wasm.luSolve(aPtr, pivPtr, scalePtr, bPtr, scratchPtr, n);

    const x0 = f64Mem[bPtr >> 3];
    const x1 = f64Mem[(bPtr >> 3) + 1];
    const x2 = f64Mem[(bPtr >> 3) + 2];

    assert.ok(Math.abs(x0 - 1.0) < 1e-10, `Expected x0=1.0, got ${x0}`);
    assert.ok(Math.abs(x1 - -2.0) < 1e-10, `Expected x1=-2.0, got ${x1}`);
    assert.ok(Math.abs(x2 - -2.0) < 1e-10, `Expected x2=-2.0, got ${x2}`);
  });

  it("should preserve Hamiltonian energy invariant using Symplectic Integrator", async () => {
    const { wasm, memory } = await loadWasm();
    // 1D Harmonic oscillator: d^2q/dt^2 = -q (F(q) = -q)
    // Hamiltonian: H(q, p) = 0.5 * p^2 + 0.5 * q^2
    const daePtr = wasm.dae_createBuilder();
    assert.ok(daePtr > 0, "DAE created");

    const varQ = wasm.dae_addVariable(daePtr, 1, 0, 1, 0, 1.0, 0);
    const varP = wasm.dae_addVariable(daePtr, 2, 0, 1, 0, 0.0, 0);

    // der(q) = p
    const derQ = wasm.dae_addDer(daePtr, varQ);
    const refP = wasm.dae_addName(daePtr, varP);
    wasm.dae_addEquation(daePtr, 0, derQ, refP, 0);

    // der(p) = -1.0 * q
    const derP = wasm.dae_addDer(daePtr, varP);
    const refQ = wasm.dae_addName(daePtr, varQ);
    const litMinusOne = wasm.dae_addRealLiteral(daePtr, -1.0);
    const exprF = wasm.dae_addBinaryExpr(daePtr, 2, litMinusOne, refQ); // Mul: 2
    wasm.dae_addEquation(daePtr, 0, derP, exprF, 0);

    const qPtr = wasm.__new ? wasm.__new(16, 0) : 4096;
    const pPtr = qPtr + 8;
    const scratchPtr = wasm.__new ? wasm.__new(128, 0) : qPtr + 32;

    const f64Mem = new Float64Array(memory.buffer);
    // Initial condition: q = 1.0, p = 0.0 -> H0 = 0.5 * (1^2 + 0^2) = 0.5
    f64Mem[qPtr >> 3] = 1.0;
    f64Mem[pPtr >> 3] = 0.0;
    const H0 = 0.5;

    // Simulate for 500 steps with dt = 0.05
    const dt = 0.05;
    const steps = 500;
    for (let s = 0; s < steps; s++) {
      wasm.sim_stepSymplectic(daePtr, qPtr, pPtr, scratchPtr, 1, dt, 4); // 4th-order Candy-Rozmus
    }

    const qFinal = f64Mem[qPtr >> 3];
    const pFinal = f64Mem[pPtr >> 3];
    const HFinal = 0.5 * (pFinal * pFinal + qFinal * qFinal);

    const energyError = Math.abs(HFinal - H0);
    assert.ok(energyError < 1e-3, `Symplectic energy drift must be < 1e-3, got ${energyError}`);
  });

  it("should integrate stiff decay system using Rodas-4P Rosenbrock method", async () => {
    const { wasm, memory } = await loadWasm();
    // Stiff single-state decay: dy/dt = -100 * y, y(0) = 1.0
    // Analytical solution: y(t) = exp(-100 * t)
    const daePtr = wasm.dae_createBuilder();
    const varY = wasm.dae_addVariable(daePtr, 1, 0, 1, 0, 1.0, 0);

    const derY = wasm.dae_addDer(daePtr, varY);
    const refY = wasm.dae_addName(daePtr, varY);
    const litMinus100 = wasm.dae_addRealLiteral(daePtr, -100.0);
    const exprRHS = wasm.dae_addBinaryExpr(daePtr, 2, litMinus100, refY); // Mul: -100 * y
    wasm.dae_addEquation(daePtr, 0, derY, exprRHS, 0);

    const varValuesPtr = wasm.__new ? wasm.__new(16, 0) : 6000;
    const scratchPtr = wasm.__new ? wasm.__new(4096, 0) : varValuesPtr + 16;

    const f64Mem = new Float64Array(memory.buffer);
    f64Mem[varValuesPtr >> 3] = 1.0;

    const dt = 0.005;
    const stepAccepted = wasm.sim_stepRodas4P(daePtr, varValuesPtr, scratchPtr, dt, 1e-4, 1e-4);
    assert.ok(stepAccepted, "Rodas4P step should be accepted for stiff system");

    const yAfter = f64Mem[varValuesPtr >> 3];
    const expectedY = Math.exp(-100.0 * dt);
    assert.ok(Math.abs(yAfter - expectedY) < 1e-3, `Expected y ≈ ${expectedY}, got ${yAfter}`);
  });

  it("should integrate using Tsitouras 5(4) adaptive Runge-Kutta (sim_stepTsit5)", async () => {
    const { wasm, memory } = await loadWasm();
    // Decay: dy/dt = -y, y(0) = 1.0 -> y(dt) = exp(-dt)
    const daePtr = wasm.dae_createBuilder();
    const varY = wasm.dae_addVariable(daePtr, 1, 0, 1, 0, 1.0, 0);
    const derY = wasm.dae_addDer(daePtr, varY);
    const refY = wasm.dae_addName(daePtr, varY);
    const litMinus1 = wasm.dae_addRealLiteral(daePtr, -1.0);
    const exprRHS = wasm.dae_addBinaryExpr(daePtr, 2, litMinus1, refY);
    wasm.dae_addEquation(daePtr, 0, derY, exprRHS, 0);

    const varValuesPtr = wasm.__new ? wasm.__new(16, 0) : 7000;
    const kStagesPtr = wasm.__new ? wasm.__new(7 * 16, 0) : varValuesPtr + 16;
    const tempValuesPtr = wasm.__new ? wasm.__new(16, 0) : kStagesPtr + 7 * 16;
    const yNewPtr = wasm.__new ? wasm.__new(16, 0) : tempValuesPtr + 16;

    const f64Mem = new Float64Array(memory.buffer);
    f64Mem[varValuesPtr >> 3] = 1.0;

    const dt = 0.1;
    const accepted = wasm.sim_stepTsit5(daePtr, varValuesPtr, kStagesPtr, tempValuesPtr, yNewPtr, dt, 1e-6, 1e-6);
    assert.ok(accepted, "Tsit5 step should be accepted");

    const yFinal = f64Mem[varValuesPtr >> 3];
    const expected = Math.exp(-dt);
    assert.ok(Math.abs(yFinal - expected) < 1e-6, `Tsit5 accurate 5th order step: expected ${expected}, got ${yFinal}`);
  });

  it("should integrate stiff decay using TR-BDF2 composite solver (sim_stepTRBDF2)", async () => {
    const { wasm, memory } = await loadWasm();
    // Stiff decay: dy/dt = -50 * y, y(0) = 1.0 -> y(dt) = exp(-50 * dt)
    const daePtr = wasm.dae_createBuilder();
    const varY = wasm.dae_addVariable(daePtr, 1, 0, 1, 0, 1.0, 0);
    const derY = wasm.dae_addDer(daePtr, varY);
    const refY = wasm.dae_addName(daePtr, varY);
    const litMinus50 = wasm.dae_addRealLiteral(daePtr, -50.0);
    const exprRHS = wasm.dae_addBinaryExpr(daePtr, 2, litMinus50, refY);
    wasm.dae_addEquation(daePtr, 0, derY, exprRHS, 0);

    const varValuesPtr = wasm.__new ? wasm.__new(16, 0) : 8000;
    const scratchPtr = wasm.__new ? wasm.__new(4096, 0) : varValuesPtr + 16;

    const f64Mem = new Float64Array(memory.buffer);
    f64Mem[varValuesPtr >> 3] = 1.0;

    const dt = 0.02;
    const accepted = wasm.sim_stepTRBDF2(daePtr, varValuesPtr, scratchPtr, dt, 1e-4, 1e-4);
    assert.ok(accepted, "TR-BDF2 step should be accepted");

    const yFinal = f64Mem[varValuesPtr >> 3];
    const expected = Math.exp(-50.0 * dt);
    assert.ok(Math.abs(yFinal - expected) < 0.05, `TR-BDF2 L-stable step: expected ${expected}, got ${yFinal}`);
  });
});
