// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { solveFlashRachfordRice } from "../src/solvers/flash-solver.js";

describe("@modelscript/aspen Vapor-Liquid Equilibrium (VLE) Flash Solver Suite", () => {
  test("solves binary Methanol-Water mixture VLE flash", () => {
    const res = solveFlashRachfordRice({
      temperature: 75.0,
      pressure: 0.7,
      components: ["METHANOL", "WATER"],
      moleFractions: [0.5, 0.5],
      totalFlow: 100.0,
      propertyMethod: "IDEAL",
    });

    assert.ok(res.vaporFraction > 0.0 && res.vaporFraction < 1.0);
    assert.ok(Math.abs(res.liquidFlow + res.vaporFlow - 100.0) < 1e-4);
    assert.ok(res.vaporFractions[0]! > res.liquidFractions[0]!, "Methanol should concentrate in vapor phase");
  });

  test("handles subcooled liquid regime without crashing", () => {
    const res = solveFlashRachfordRice({
      temperature: 20.0, // cold liquid
      pressure: 5.0,     // elevated pressure
      components: ["WATER", "ETHANOL"],
      moleFractions: [0.5, 0.5],
      totalFlow: 50.0,
      propertyMethod: "IDEAL",
    });

    assert.equal(res.vaporFraction, 0.0);
    assert.equal(res.vaporFlow, 0.0);
    assert.equal(res.liquidFlow, 50.0);
  });

  test("solves non-ideal NRTL activity coefficient equilibrium", () => {
    const res = solveFlashRachfordRice({
      temperature: 78.0,
      pressure: 0.9,
      components: ["ETHANOL", "WATER"],
      moleFractions: [0.4, 0.6],
      totalFlow: 100.0,
      propertyMethod: "NRTL",
    });

    assert.ok(res.vaporFraction > 0.1 && res.vaporFraction < 0.9);
    assert.ok(res.liquidFlow > 0);
    assert.ok(res.vaporFlow > 0);
  });
});
