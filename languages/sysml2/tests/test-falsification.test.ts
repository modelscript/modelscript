// SPDX-License-Identifier: AGPL-3.0-or-later

import { STLFormula } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RequirementFalsifier } from "../src/falsification-engine.js";

describe("SysML v2 Requirement Falsification Engine", () => {
  it("should discover counterexample parameters that falsify temperature safety", async () => {
    // Requirement: always between [0, 5]s, temp <= 100
    const formula: STLFormula = {
      type: "always",
      interval: [0, 5],
      formula: {
        type: "predicate",
        variable: "temp",
        operator: "<=",
        threshold: 100,
      },
    };

    const res = await RequirementFalsifier.falsify({
      parameters: [
        { name: "ambientTemp", min: 20, max: 40 },
        { name: "heatingPower", min: 10, max: 30 },
      ],
      formula,
      maxGenerations: 10,
      populationSize: 8,
      simulate: async (params) => {
        const times = [0, 1, 2, 3, 4, 5];
        // temp(t) = ambientTemp + heatingPower * t
        // If heatingPower = 20 and ambientTemp = 30 -> at t=5, temp = 130 > 100!
        const temp = times.map((t) => params.ambientTemp + params.heatingPower * t);
        return {
          times,
          signals: { temp },
        };
      },
    });

    assert.strictEqual(res.isFalsified, true);
    assert.ok(res.minRobustness < 0, `Expected negative robustness margin, got ${res.minRobustness}`);
    assert.ok(res.counterexampleParams !== undefined);
    assert.ok(res.evaluationsCount > 0);
    assert.ok(res.summary.includes("Requirement falsified"));
  });

  it("should certify requirement when no parameter vector violates bounds", async () => {
    // Requirement: always between [0, 5]s, voltage >= 10
    const formula: STLFormula = {
      type: "always",
      interval: [0, 5],
      formula: {
        type: "predicate",
        variable: "voltage",
        operator: ">=",
        threshold: 10,
      },
    };

    const res = await RequirementFalsifier.falsify({
      parameters: [{ name: "vMin", min: 12, max: 15 }],
      formula,
      maxGenerations: 5,
      populationSize: 6,
      simulate: async (params) => {
        const times = [0, 1, 2, 3, 4, 5];
        // voltage is always >= 12, so >= 10 is never violated
        const voltage = times.map((t) => params.vMin + t * 0.1);
        return {
          times,
          signals: { voltage },
        };
      },
    });

    assert.strictEqual(res.isFalsified, false);
    assert.ok(res.minRobustness >= 0, `Expected positive robustness margin, got ${res.minRobustness}`);
    assert.ok(res.summary.includes("Requirement held across"));
  });
});
