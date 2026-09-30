// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { optimizeCosim, parseCosimParams } from "../src/commands/cosim.js";

describe("CLI Co-Simulation Black-Box Parameter Optimization", () => {
  it("should parse various parameter bound syntax forms correctly", () => {
    // Shorthand colon notation
    const p1 = parseCosimParams("kp:0.1:10.0,kd:0.01:1.0");
    assert.deepStrictEqual(p1, [
      { name: "kp", min: 0.1, max: 10.0 },
      { name: "kd", min: 0.01, max: 1.0 },
    ]);

    // Range double-dot notation
    const p2 = parseCosimParams("kp=0.5..5.0;ti=1.0..20.0");
    assert.deepStrictEqual(p2, [
      { name: "kp", min: 0.5, max: 5.0 },
      { name: "ti", min: 1.0, max: 20.0 },
    ]);

    // JSON format
    const p3 = parseCosimParams(JSON.stringify([{ name: "gain", min: 2.0, max: 8.0 }]));
    assert.deepStrictEqual(p3, [{ name: "gain", min: 2.0, max: 8.0 }]);
  });

  it("should optimize parameters across black-box co-simulation with Differential Evolution", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await (optimizeCosim.handler as any)({
        "api-url": "http://127.0.0.1:9999", // Unreachable port -> activates decoupled surrogate
        params: "kp:0.0:10.0,kd:0.0:4.0",
        objective: "error_integral",
        algorithm: "de",
        generations: 15,
        population: 12,
        seed: 42,
      });
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    assert.ok(output.includes("Optimization Complete:"), "Must indicate completion");
    assert.ok(output.includes("Best Objective (error_integral):"), "Must report best objective");
    assert.ok(output.includes("kp = "), "Must report optimal kp parameter");
    assert.ok(output.includes("kd = "), "Must report optimal kd parameter");
  });

  it("should optimize parameters using CMA-ES and PSO algorithms", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      // CMA-ES
      await (optimizeCosim.handler as any)({
        "api-url": "http://127.0.0.1:9999",
        params: "kp:1.0:5.0",
        objective: "tracking_error",
        algorithm: "cmaes",
        generations: 10,
        population: 8,
        seed: 123,
      });

      // PSO
      await (optimizeCosim.handler as any)({
        "api-url": "http://127.0.0.1:9999",
        params: "kd:0.1:2.0",
        objective: "tracking_error",
        algorithm: "pso",
        generations: 10,
        population: 10,
        seed: 456,
      });
    } finally {
      console.log = origLog;
    }

    const output = logs.join("\n");
    assert.ok(output.includes("Algorithm:    CMAES"));
    assert.ok(output.includes("Algorithm:    PSO"));
  });
});
