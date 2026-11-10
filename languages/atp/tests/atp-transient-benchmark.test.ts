// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { simulateAtpCase } from "../src/analysis/transient-solver.js";
import type { AtpCase } from "../src/types.js";

describe("ATP-EMTP Transient Benchmark Suite", () => {
  const rlcCase: AtpCase = {
    title: "Series RLC Surge Transient Benchmark",
    control: {
      deltaTSec: 1.0e-5,
      tMaxSec: 0.01,
    },
    branches: [
      {
        node1: "SRC",
        node2: "LOAD",
        rOhms: 10.0,
        lMh: 5.0,
        cUf: 2.0,
      },
    ],
    switches: [],
    sources: [
      {
        node: "SRC",
        typeCode: 14,
        amplitude: 1000.0,
        frequencyHz: 60.0,
        phaseDeg: 0.0,
      },
    ],
    outputNodes: ["SRC", "LOAD"],
  };

  it("simulates electromagnetic transient waveforms converging within tolerance and residual bounds", () => {
    const tolerance = 1e-3;
    const result = simulateAtpCase(rlcCase, { tolerance, maxSteps: 200 });

    assert.equal(result.converged, true, "Transient simulation should converge");
    assert.ok(result.stepCount > 0);
    assert.ok(
      result.residualMax < tolerance,
      `Max residual ${result.residualMax} should be within tolerance ${tolerance}`,
    );
    assert.ok(result.rmse < tolerance, `RMSE ${result.rmse} should be within tolerance ${tolerance}`);

    const srcV = result.nodeVoltages.get("SRC");
    const loadV = result.nodeVoltages.get("LOAD");
    assert.ok(srcV && srcV.length === 200);
    assert.ok(loadV && loadV.length === 200);

    // Initial AC voltage at t=0 should match amplitude * cos(0) = 1000.0
    assert.ok(Math.abs(srcV[0]! - 1000.0) < 1e-4);
  });
});
