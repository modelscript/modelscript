// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import { WasmCosimEmulator, WasmCosimEngine } from "../src/runtime/wasm_cosim.js";

console.log("Testing WASM Co-Simulation Orchestrator & FMU Bridge...");

// Test 1: WasmCosimEmulator Multi-Rate Stepping & Coupling
{
  const emulator = new WasmCosimEmulator({
    method: "gauss-seidel",
    maxIterations: 5,
    tolerance: 1e-6,
    relaxation: 1.0,
  });

  // Simulated FMU 1 (inst 100): produces y1 = 5.0 * t
  // Simulated FMU 2 (inst 200): has input u2, state x2 = x2 + u2 * dt
  const fmuValues = new Map<number, Map<number, number>>([
    [100, new Map([[0, 0.0]])], // vr 0 = y1
    [
      200,
      new Map([
        [0, 0.0],
        [1, 0.0],
      ]),
    ], // vr 0 = u2, vr 1 = x2
  ]);

  const getReal = (inst: number, vr: number, _ver: number) => {
    return fmuValues.get(inst)?.get(vr) ?? 0.0;
  };

  const setReal = (inst: number, vr: number, _ver: number, val: number) => {
    if (!fmuValues.has(inst)) fmuValues.set(inst, new Map());
    fmuValues.get(inst)!.set(vr, val);
  };

  const doStep = (inst: number, t: number, dt: number, _ver: number) => {
    if (inst === 100) {
      // y1(t + dt) = 5.0 * (t + dt)
      setReal(inst, 0, 2, 5.0 * (t + dt));
    } else if (inst === 200) {
      // x2 = x2 + u2 * dt
      const u2 = getReal(inst, 0, 2);
      const x2 = getReal(inst, 1, 2);
      setReal(inst, 1, 2, x2 + u2 * dt);
    }
  };

  // Add participants
  const p1 = emulator.addParticipant({ instancePtr: 100, fmiVersion: 2, stepRatio: 1 });
  const p2 = emulator.addParticipant({ instancePtr: 200, fmiVersion: 2, stepRatio: 2 }); // 2x multi-rate

  assert.strictEqual(p1, 0);
  assert.strictEqual(p2, 1);

  // Coupling: FMU 2 u2 (vr 0) = 2.0 * FMU 1 y1 (vr 0) + 1.0
  const c1 = emulator.addCoupling({
    srcInstancePtr: 100,
    srcVr: 0,
    dstInstancePtr: 200,
    dstVr: 0,
    scale: 2.0,
    offset: 1.0,
  });
  assert.strictEqual(c1, 0);

  // Advance by step dt = 1.0 from t = 0
  emulator.step(0.0, 1.0, getReal, setReal, doStep);

  // At end of step:
  // FMU 1 y1 = 5.0 * 1.0 = 5.0
  // FMU 2 u2 = 2.0 * 5.0 + 1.0 = 11.0
  const y1 = getReal(100, 0, 2);
  const u2 = getReal(200, 0, 2);
  assert.strictEqual(y1, 5.0, `Expected y1 = 5.0, got ${y1}`);
  assert.strictEqual(u2, 11.0, `Expected u2 = 11.0, got ${u2}`);

  console.log("  ✔ Multi-rate FMU co-simulation stepping & coupling propagation passed");
}

// Test 2: WasmCosimEngine wrapper API
{
  let created = false;
  let stepped = false;
  const mockExports = {
    cosimCreateOrchestrator: (method: number, maxIter: number, tol: number, relax: number) => {
      created = true;
      assert.strictEqual(method, 1); // Gauss-seidel
      assert.strictEqual(maxIter, 15);
      return 1024;
    },
    cosimAddParticipant: (orchPtr: number, instPtr: number, ver: number, ratio: number) => {
      assert.strictEqual(orchPtr, 1024);
      assert.strictEqual(instPtr, 2048);
      assert.strictEqual(ver, 3);
      assert.strictEqual(ratio, 1);
      return 0;
    },
    cosimAddCoupling: (
      orchPtr: number,
      srcPtr: number,
      srcVr: number,
      srcVer: number,
      dstPtr: number,
      dstVr: number,
      dstVer: number,
      scale: number,
      offset: number,
    ) => {
      assert.strictEqual(orchPtr, 1024);
      assert.strictEqual(srcPtr, 2048);
      assert.strictEqual(dstPtr, 4096);
      assert.strictEqual(scale, 1.5);
      return 0;
    },
    cosimStep: (orchPtr: number, t: number, dt: number) => {
      stepped = true;
      assert.strictEqual(orchPtr, 1024);
      assert.strictEqual(t, 0.0);
      assert.strictEqual(dt, 0.1);
      return 0;
    },
    cosimPropagateCouplings: (orchPtr: number) => 0.0,
    cosimGetParticipantCount: (orchPtr: number) => 1,
    cosimGetCouplingCount: (orchPtr: number) => 1,
  };

  const engine = new WasmCosimEngine(mockExports, {
    method: "gauss-seidel",
    maxIterations: 15,
    tolerance: 1e-7,
  });

  assert.ok(created);
  assert.strictEqual(engine.orchestratorPtr, 1024);

  engine.addParticipant({ instancePtr: 2048, fmiVersion: 3 });
  engine.addCoupling({
    srcInstancePtr: 2048,
    srcVr: 0,
    srcFmiVersion: 3,
    dstInstancePtr: 4096,
    dstVr: 1,
    dstFmiVersion: 3,
    scale: 1.5,
  });

  const status = engine.step(0.0, 0.1);
  assert.strictEqual(status, 0);
  assert.ok(stepped);
  assert.strictEqual(engine.participantCount, 1);
  assert.strictEqual(engine.couplingCount, 1);

  console.log("  ✔ WasmCosimEngine WASM export bridge passed");
}

console.log("=== All WASM Co-Simulation Tests Passed Cleanly ===");
