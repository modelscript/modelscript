// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  B2BEquivalenceVerifier,
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  initBltWasm,
  StringInterner,
  UnaryOp,
  UnifiedVerifier,
  Variability,
  VarType,
} from "../src/index.js";

describe("Phase 1: Back-to-Back (MiL vs SiL) Equivalence Verification (@modelscript/runtime)", () => {
  it("should confirm MiL vs SiL equivalence for damped oscillator within tolerance", async () => {
    await initBltWasm();

    const interner = new StringInterner();
    const dae = new DAEBuilder(interner, "OscillatorB2B");

    // States & parameters: m*der(vel) + b*vel + k*pos = 0, der(pos) = vel
    const posIdx = dae.addVariable("pos", VarType.Real, Variability.Continuous, Causality.Output, 1.0);
    const velIdx = dae.addVariable("vel", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const derPosIdx = dae.addVariable("der(pos)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const derVelIdx = dae.addVariable("der(vel)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const kIdx = dae.addVariable("k", VarType.Real, Variability.Parameter, Causality.Local, 4.0);
    const bIdx = dae.addVariable("b", VarType.Real, Variability.Parameter, Causality.Local, 0.4);

    // der(pos) = vel
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr("pos")), dae.addNameExpr("vel"));

    // der(vel) = -k * pos - b * vel
    const kPos = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("k"), dae.addNameExpr("pos"));
    const negKPos = dae.addUnaryExpr(UnaryOp.Negate, kPos);
    const bVel = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("b"), dae.addNameExpr("vel"));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr("vel")), dae.addBinaryExpr(BinOp.Sub, negKPos, bVel));

    // Construct analytical MiL reference trajectory
    const wn = 2.0;
    const zeta = 0.1;
    const wd = wn * Math.sqrt(1.0 - zeta * zeta);
    const dt = 0.01;
    const stopTime = 1.0;
    const times: number[] = [];
    const y: number[][] = [];

    for (let t = 0.0; t <= stopTime + 1e-9; t += dt) {
      times.push(t);
      const exactPos = Math.exp(-zeta * wn * t) * (Math.cos(wd * t) + ((zeta * wn) / wd) * Math.sin(wd * t));
      y.push([exactPos]);
    }

    const milResult = {
      t: times,
      states: ["pos"],
      y,
    };

    // Run B2B Equivalence Verification
    const res = await B2BEquivalenceVerifier.verify(dae, milResult, {
      tolerance: 0.02,
      dt: 0.01,
      stopTime: 1.0,
      modelIdentifier: "OscillatorB2B",
    });

    assert.strictEqual(res.passed, true, `B2B verification should pass: ${res.summary}`);
    assert.strictEqual(res.certified, true);
    assert.ok(res.maxError < 0.02, `Max error should be < 0.02, got ${res.maxError}`);
    assert.ok(res.cSourceHash != null && res.cSourceHash.length === 64, "Should compute SHA-256 C source hash");
    assert.ok(res.testedVariables.includes("pos"), "Should have tested 'pos' output");
    assert.strictEqual(res.discrepancies.length, 0, "No discrepancies within tolerance");
  });

  it("should detect discrepancy when SiL exceeds strict tolerance threshold", async () => {
    await initBltWasm();

    const interner = new StringInterner();
    const dae = new DAEBuilder(interner, "DecayModel");

    dae.addVariable("x", VarType.Real, Variability.Continuous, Causality.Output, 1.0);
    dae.addVariable("der(x)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const negX = dae.addUnaryExpr(UnaryOp.Negate, dae.addNameExpr("x"));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr("x")), negX);

    // Intentionally corrupted MiL reference trajectory to test detection
    const times = [0.0, 0.5, 1.0];
    const y = [[1.0], [99.0], [0.367]]; // 99.0 is an intentional error
    const milResult = {
      t: times,
      states: ["x"],
      y,
    };

    const res = await B2BEquivalenceVerifier.verify(dae, milResult, {
      tolerance: 1e-4,
      dt: 0.1,
      stopTime: 1.0,
      modelIdentifier: "DecayModel",
    });

    assert.strictEqual(res.passed, false, "Should fail due to intentional discrepancy");
    assert.strictEqual(res.certified, false);
    assert.ok(res.discrepancies.length > 0, "Should record discrepancy violations");
    assert.strictEqual(res.discrepancies[0]!.variable, "x");
  });

  it("should execute B2B stage seamlessly inside UnifiedVerifier", async () => {
    await initBltWasm();

    const interner = new StringInterner();
    const dae = new DAEBuilder(interner, "UnifiedB2B");

    dae.addVariable("v", VarType.Real, Variability.Continuous, Causality.Output, 2.0);
    dae.addVariable("der(v)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
    const negV = dae.addUnaryExpr(UnaryOp.Negate, dae.addNameExpr("v"));
    dae.addEquation(EqKind.Simple, dae.addDerExpr(dae.addNameExpr("v")), negV);

    const times: number[] = [];
    const y: number[][] = [];
    for (let t = 0.0; t <= 0.5 + 1e-9; t += 0.05) {
      times.push(t);
      y.push([2.0 * Math.exp(-t)]);
    }

    const report = await UnifiedVerifier.verify(
      {
        uri: "file:///test/UnifiedB2B.mo",
        arena: dae,
        simulationResult: { t: times, states: ["v"], y } as any,
      },
      {
        b2b: true,
        b2bTol: 0.01,
        b2bDt: 0.01,
        target: "UnifiedB2B",
      },
    );

    assert.ok(report.stages["b2b"], "Report must contain 'b2b' stage");
    assert.strictEqual(report.stages["b2b"]!.passed, true, `B2B stage failed: ${report.stages["b2b"]!.summary}`);
    assert.strictEqual(report.stages["b2b"]!.certified, true);
    assert.ok(report.stages["b2b"]!.summary.includes("confirmed"));
  });
});
