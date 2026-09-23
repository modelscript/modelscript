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

  it("should falsify safety requirements using Cross-Entropy Method (CEM)", async () => {
    // Formula: pressure <= 50.0
    const formula: STLFormula = {
      type: "always",
      interval: [0, 2],
      formula: {
        type: "predicate",
        variable: "pressure",
        operator: "<=",
        threshold: 50.0,
      },
    };

    const res = await RequirementFalsifier.falsify({
      algorithm: "cem",
      parameters: [{ name: "flowRate", min: 1.0, max: 20.0 }],
      formula,
      maxGenerations: 8,
      populationSize: 12,
      eliteFraction: 0.25,
      simulate: async (params) => {
        const times = [0, 1, 2];
        // pressure = flowRate * 4
        // If flowRate > 12.5, pressure > 50 -> violated
        const pressure = times.map((_t) => params.flowRate * 4.0);
        return { times, signals: { pressure } };
      },
    });

    assert.strictEqual(res.isFalsified, true);
    assert.ok(res.minRobustness < 0);
    assert.ok(res.counterexampleParams !== undefined);
    assert.ok(res.counterexampleParams.flowRate * 4.0 > 50.0);
    assert.ok(res.summary.includes("Requirement falsified"));
  });

  it("should evaluate candidates via simulateBatch for batched ODE / GPU acceleration", async () => {
    const formula: STLFormula = {
      type: "always",
      interval: [0, 3],
      formula: {
        type: "predicate",
        variable: "speed",
        operator: "<=",
        threshold: 60.0,
      },
    };

    let batchCallCount = 0;
    let maxBatchSize = 0;

    const res = await RequirementFalsifier.falsify({
      parameters: [{ name: "accel", min: 10, max: 30 }],
      formula,
      maxGenerations: 5,
      populationSize: 8,
      simulateBatch: async (paramsList) => {
        batchCallCount++;
        maxBatchSize = Math.max(maxBatchSize, paramsList.length);
        const times = [0, 1, 2, 3];
        return paramsList.map((p) => {
          const speed = times.map((t) => p.accel * t);
          return { times, signals: { speed } };
        });
      },
    });

    assert.strictEqual(res.isFalsified, true);
    assert.ok(batchCallCount > 0, "simulateBatch must be called");
    assert.strictEqual(maxBatchSize, 8, "Batch size should equal populationSize");
    assert.ok(res.minRobustness < 0);
    assert.ok(res.counterexampleParams !== undefined);
  });

  it("should support parallel chunked simulation via concurrency option", async () => {
    const formula: STLFormula = {
      type: "always",
      interval: [0, 2],
      formula: {
        type: "predicate",
        variable: "power",
        operator: "<=",
        threshold: 100,
      },
    };

    let peakConcurrency = 0;
    let activeSims = 0;

    const res = await RequirementFalsifier.falsify({
      parameters: [{ name: "current", min: 5, max: 20 }],
      formula,
      maxGenerations: 4,
      populationSize: 8,
      concurrency: 4,
      simulate: async (params) => {
        activeSims++;
        peakConcurrency = Math.max(peakConcurrency, activeSims);
        await new Promise((r) => setTimeout(r, 5));
        activeSims--;
        const times = [0, 1, 2];
        const power = times.map((_t) => params.current * 10);
        return { times, signals: { power } };
      },
    });

    assert.strictEqual(res.isFalsified, true);
    assert.ok(peakConcurrency > 1, `Expected concurrent execution, peak was ${peakConcurrency}`);
    assert.ok(peakConcurrency <= 4, `Peak concurrency ${peakConcurrency} should not exceed configured limit of 4`);
  });
});
