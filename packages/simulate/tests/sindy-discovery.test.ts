// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import {
  ActivationKind,
  ArenaNeuralBlock,
  DAEBuilder,
  Dual,
  evaluateArenaDualExpression,
  StringInterner,
  Variability,
  VarType,
} from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import {
  buildPhysicsCandidateLibrary,
  discoverSymbolicEquations,
  distillNeuralBlockToArena,
} from "../src/twin/sindy-discovery.js";

describe("Workstream 2: Dimensionally-Guided SINDy Symbolic Equation Discovery", () => {
  it("enforces ISO 80000 dimensional homogeneity when constructing candidate basis libraries", () => {
    const vars = [
      { name: "v", unit: "m/s" },
      { name: "theta", unit: "rad" },
    ];

    const library = buildPhysicsCandidateLibrary(vars, {
      maxPolynomialDegree: 2,
      includeSignedQuadratic: true,
      includeTrigonometric: true,
    });

    const labels = library.map((t) => t.label);
    // Trigonometric terms are allowed on dimensionless 'theta' (rad), but forbidden on 'v' (m/s)
    assert(labels.includes("sin(theta)"));
    assert(labels.includes("cos(theta)"));
    assert(!labels.includes("sin(v)"));
    assert(!labels.includes("cos(v)"));
    assert(labels.includes("v * abs(v)"));
  });

  it("recovers exact sparse nonlinear fluid drag law F_drag = -1.2 * v - 0.45 * v * abs(v) via STLSQ", () => {
    const inputs: Float64Array[] = [];
    const outputs: Float64Array[] = [];

    for (let i = 0; i <= 80; i++) {
      const v = -4.0 + (8.0 * i) / 80;
      const fDrag = -1.2 * v - 0.45 * v * Math.abs(v);
      inputs.push(new Float64Array([v]));
      outputs.push(new Float64Array([fDrag]));
    }

    const res = discoverSymbolicEquations(
      inputs,
      outputs,
      [{ name: "v", unit: "m/s" }],
      [{ name: "F_drag", unit: "N" }],
      {
        maxPolynomialDegree: 3,
        includeSignedQuadratic: true,
        thresholdSweep: [0.005, 0.02, 0.05, 0.1],
      },
    );

    assert.strictEqual(res.equations.length, 1);
    const eq = res.equations[0]!;
    assert(eq.r2 > 0.99999, `Expected R^2 > 0.99999, got ${eq.r2}`);
    assert.strictEqual(
      eq.terms.length,
      2,
      `Expected exactly 2 sparse terms, got ${eq.terms.length}: ${eq.modelicaEquation}`,
    );

    const linTerm = eq.terms.find((t) => t.termLabel === "v");
    const quadDragTerm = eq.terms.find((t) => t.termLabel === "v * abs(v)");
    assert(linTerm, "Expected linear viscous damping term 'v'");
    assert(quadDragTerm, "Expected signed quadratic drag term 'v * abs(v)'");
    assert(Math.abs(linTerm.coefficient - -1.2) < 1e-4);
    assert(Math.abs(quadDragTerm.coefficient - -0.45) < 1e-4);
  });

  it("distills an ArenaNeuralBlock UDE into symbolic DAEBuilder equations in-place", () => {
    const interner = new StringInterner();
    const arena = new DAEBuilder(interner, "HybridPlant");
    arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
    arena.addVariable("f_ude", VarType.Real, Variability.Continuous, 0, 0.0);

    // Construct a linear ArenaNeuralBlock [1 -> 1] with exact weights: f_ude = 0.5 - 2.5 * x
    // Weight layout for [1, 1]: W0_0 at index 0, b0 at index 1
    const weights = new Float64Array([-2.5, 0.5]);
    const block = new ArenaNeuralBlock({
      name: "residual_net",
      layers: [1, 1],
      activation: ActivationKind.Linear,
      outputActivation: ActivationKind.Linear,
      initialWeights: weights,
    });
    block.build(arena, ["x"], ["f_ude"]);

    const samples: Float64Array[] = [];
    for (let i = 0; i < 40; i++) {
      samples.push(new Float64Array([-2.0 + (4.0 * i) / 39]));
    }

    const distilled = distillNeuralBlockToArena(
      arena,
      block,
      samples,
      [{ name: "x", unit: "m" }],
      [{ name: "f_ude", unit: "N" }],
      {
        maxPolynomialDegree: 2,
        includeSignedQuadratic: false,
        threshold: 0.02,
      },
    );

    assert.strictEqual(distilled.equations.length, 1);
    assert(distilled.equations[0]!.r2 > 0.9999);
    assert(distilled.modelicaPatch.includes("f_ude ="));

    // Verify that the synthesized DAEBuilder expression evaluates to 0.5 - 2.5 * x at x = 2.0 (expected = -4.5)
    const exprId = distilled.synthesizedExprIds[0]!;
    const dualEnv = new Map<number, Dual>();
    dualEnv.set(arena.interner.intern("x"), Dual.variable(2.0));
    const evalRes = evaluateArenaDualExpression(arena, exprId, dualEnv);
    assert(evalRes !== null);
    assert(Math.abs(evalRes.val - -4.5) < 1e-5);
    assert(Math.abs(evalRes.dot - -2.5) < 1e-5);
  });
});
