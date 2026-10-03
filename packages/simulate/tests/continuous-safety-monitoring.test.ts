// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Causality,
  DAEBuilder,
  EqKind,
  UnaryOp,
  VarAttrKind,
  VarType,
  Variability,
  getDefaultWasmExports,
  initBltWasm,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import {
  ArenaSimulator,
  OnlineSTLMonitor,
  STL,
  evaluateFormulaSignal,
  evaluateFormulaSignalWasm,
  simulateArena,
} from "../src/core/index.js";

describe("Continuous Simulation Real-Time Safety Barrier Monitoring", () => {
  before(async () => {
    await initBltWasm();
  });

  it("should evaluate temporal operators with O(N) sliding window and match WASM acceleration", () => {
    const N = 50;
    const samples: { t: number; y: number[] }[] = [];
    for (let i = 0; i < N; i++) {
      const t = i * 1.0;
      const v = Math.sin(t) * 10;
      samples.push({ t, y: [v] });
    }

    // Globally [0, 3.0] (x <= 15)
    const formGlobally = STL.globally(STL.predicate(0, "<=", 15.0, "x <= 15"), [0.0, 3.0]);
    const tsSigGlobally = evaluateFormulaSignal(formGlobally, samples);
    assert.strictEqual(tsSigGlobally.length, N);
    assert.ok(tsSigGlobally[0]!.v > 0, "Globally x<=15 should be satisfied initially");

    // Eventually [0, 4.0] (x >= 5.0)
    const formEventually = STL.eventually(STL.predicate(0, ">=", 5.0, "x >= 5"), [0.0, 4.0]);
    const tsSigEventually = evaluateFormulaSignal(formEventually, samples);
    assert.strictEqual(tsSigEventually.length, N);
    assert.ok(tsSigEventually[0]!.v > 0, "Eventually x>=5 should be satisfied initially");

    // Until [1.0, 4.0]
    const formUntil = STL.until(
      STL.predicate(0, ">=", -15.0, "x >= -15"),
      STL.predicate(0, ">=", 8.0, "x >= 8"),
      [1.0, 4.0],
    );
    const tsSigUntil = evaluateFormulaSignal(formUntil, samples);
    assert.strictEqual(tsSigUntil.length, N);

    // Verify bit-for-bit equivalence with WASM kernel
    const wasm = getDefaultWasmExports();
    if (wasm && typeof wasm.stl_eval_always === "function") {
      const wasmSigGlobally = evaluateFormulaSignalWasm(formGlobally, samples, wasm);
      assert.ok(wasmSigGlobally !== null, "WASM globally evaluation should succeed");
      for (let i = 0; i < N; i++) {
        assert.strictEqual(
          wasmSigGlobally![i]!.v,
          tsSigGlobally[i]!.v,
          `WASM and TS globally robustness must match exactly at index ${i}`,
        );
      }

      const wasmSigEventually = evaluateFormulaSignalWasm(formEventually, samples, wasm);
      assert.ok(wasmSigEventually !== null, "WASM eventually evaluation should succeed");
      for (let i = 0; i < N; i++) {
        assert.strictEqual(
          wasmSigEventually![i]!.v,
          tsSigEventually[i]!.v,
          `WASM and TS eventually robustness must match exactly at index ${i}`,
        );
      }
    }
  });

  it("should halt simulation early when an STL safety barrier is breached during integration", () => {
    // Harmonic oscillator:
    // der(x) = v
    // der(v) = -x
    // x(0) = 0, v(0) = 1  => x(t) = sin(t), v(t) = cos(t)
    const arena = new DAEBuilder();
    arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    arena.addVariable("v", VarType.Real, Variability.Continuous, Causality.Local, 1.0);

    const xExpr = arena.addNameExpr("x");
    const vExpr = arena.addNameExpr("v");
    const derXExpr = arena.addDerExpr(xExpr);
    const derVExpr = arena.addDerExpr(vExpr);
    const negXExpr = arena.addUnaryExpr(UnaryOp.Negate, xExpr);

    // der(x) = v
    arena.addEquation(EqKind.Simple, derXExpr, vExpr);
    // der(v) = -x
    arena.addEquation(EqKind.Simple, derVExpr, negXExpr);

    const sim = new ArenaSimulator(arena);
    sim.prepare();

    const timeId = arena.interner.intern("time");
    const xNameId = arena.interner.intern("x");
    const vNameId = arena.interner.intern("v");
    const derXNameId = arena.interner.intern("der(x)");
    const derVNameId = arena.interner.intern("der(v)");

    const env = new Float64Array(arena.interner.size + 16);
    env[timeId] = 0.0;
    env[xNameId] = 0.0;
    env[vNameId] = 1.0;

    // Safety Requirement: x <= 0.6
    // Since x(t) = sin(t), at t = asin(0.6) ~ 0.6435s, x will exceed 0.6!
    const safetyReq = STL.globally(STL.predicate(0, "<=", 0.6, "x <= 0.6"), [0.0, 5.0]);
    const monitor = new OnlineSTLMonitor(safetyReq, {
      requirementName: "Req_MaxDisplacement_Barrier",
      terminateOnViolation: true,
    });

    const steps = 100;
    const dt = 0.05; // 5.0 seconds total

    const res = sim.simulate(steps, dt, env, [xNameId, vNameId], [derXNameId, derVNameId], {
      solver: "rk4",
      outputStringIds: [xNameId, vNameId],
      stlMonitors: [monitor],
      earlyTerminateOnViolation: true,
    });

    assert.strictEqual(res.terminatedEarly, true, "Simulation must terminate early when barrier is breached");
    assert.ok(res.safetyViolations.length > 0, "Safety violation must be recorded");
    assert.strictEqual(res.safetyViolations[0]!.monitorName, "Req_MaxDisplacement_Barrier");
    assert.ok(res.safetyViolations[0]!.robustness < 0, "Robustness at breach must be negative");

    // With dt = 0.05, breach happens around t ~ 0.65 - 0.70s (far before t = 5.0s)
    const finalT = res.t[res.t.length - 1]!;
    assert.ok(finalT < 1.0, `Simulation should have stopped around 0.7s, but ran until ${finalT}s`);
    assert.ok(res.t.length < 25, `Should have computed < 25 steps, got ${res.t.length}`);
  });

  it("should detect variable min/max bound violations with interval barrier checks", () => {
    const arena = new DAEBuilder();
    const xVar = arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    // Set variable attribute: max = 2.0
    const maxLiteral = arena.addRealLiteral(2.0);
    arena.setVarAttrExpr(xVar, VarAttrKind.Max, maxLiteral);

    const xExpr = arena.addNameExpr("x");
    const derXExpr = arena.addDerExpr(xExpr);
    const constOne = arena.addRealLiteral(1.0);

    // der(x) = 1.0 -> x(t) = t
    arena.addEquation(EqKind.Simple, derXExpr, constOne);

    const sim = new ArenaSimulator(arena);
    sim.prepare();

    const timeId = arena.interner.intern("time");
    const xNameId = arena.interner.intern("x");
    const derXNameId = arena.interner.intern("der(x)");

    const env = new Float64Array(arena.interner.size + 16);
    env[timeId] = 0.0;
    env[xNameId] = 0.0;
    env[derXNameId] = 1.0;

    // Simulate for 4 seconds with dt = 0.1
    // At t = 2.1s, x > 2.0 which violates max attribute bound 2.0
    const res = sim.simulate(40, 0.1, env, [xNameId], [derXNameId], {
      solver: "euler",
      outputStringIds: [xNameId],
      intervalBarrierCheck: true,
      earlyTerminateOnViolation: true,
    });

    assert.strictEqual(res.terminatedEarly, true, "Simulation must terminate when variable exceeds max bound");
    assert.ok(res.intervalIssues.length > 0, "Interval issue must be recorded");
    assert.ok(
      res.intervalIssues.some((issue) => issue.includes("breached maximum bound")),
      `Expected maximum bound breach diagnostic, got: ${JSON.stringify(res.intervalIssues)}`,
    );
    const finalT = res.t[res.t.length - 1]!;
    assert.ok(finalT <= 2.2, `Simulation should halt near t=2.1s, stopped at ${finalT}s`);
  });

  it("should integrate seamlessly with high-level simulateArena entrypoint", () => {
    const arena = new DAEBuilder();
    arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 10.0);

    const xExpr = arena.addNameExpr("x");
    const derXExpr = arena.addDerExpr(xExpr);
    const negTwo = arena.addRealLiteral(-2.0);
    // der(x) = -2 -> x(t) = 10 - 2t
    arena.addEquation(EqKind.Simple, derXExpr, negTwo);

    // Property: x >= 2.0
    // Violates when t > 4.0
    const monitor = new OnlineSTLMonitor(STL.globally(STL.predicate(0, ">=", 2.0, "x >= 2.0"), [0.0, 10.0]), {
      requirementName: "Req_PositiveMargin",
      terminateOnViolation: true,
    });

    const result = simulateArena(arena, {
      startTime: 0,
      stopTime: 10,
      step: 0.5,
      stlMonitors: [monitor],
      earlyTerminateOnViolation: true,
    });

    assert.strictEqual(result.terminatedEarly, true, "simulateArena must reflect early termination");
    assert.ok(result.safetyViolations !== undefined && result.safetyViolations.length > 0);
    const finalT = result.t[result.t.length - 1]!;
    assert.ok(finalT <= 4.5, `Should terminate near t=4.0-4.5s, stopped at ${finalT}s`);
  });
});
