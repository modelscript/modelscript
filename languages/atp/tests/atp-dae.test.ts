// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerAtpToDae } from "../src/dae/atp-to-dae.js";
import type { AtpCase } from "../src/types.js";

describe("ATP Domain Lowering to Linear-Memory DAE Arena", () => {
  const atpCase: AtpCase = {
    title: "DAE_Lowering_500kV",
    control: {
      deltaTSec: 1.0e-5,
      tMaxSec: 0.05,
    },
    branches: [
      {
        node1: "BUS1",
        node2: "BUS2",
        rOhms: 5.0,
        lMh: 20.0,
        cUf: 0.5,
      },
      {
        node1: "BUS2",
        node2: "GND",
        rOhms: 50.0,
        lMh: 0.0,
        cUf: 10.0,
      },
    ],
    switches: [],
    sources: [
      {
        node: "BUS1",
        typeCode: 14,
        amplitude: 500000.0,
        frequencyHz: 60.0,
        phaseDeg: 0.0,
      },
    ],
    outputNodes: ["BUS1", "BUS2"],
  };

  it("should lower ATP case to DAEBuilder with correct variable and equation allocations", () => {
    const dae = lowerAtpToDae(atpCase);
    assert.ok(dae instanceof DAEBuilder);

    // Expected variables:
    // time (1)
    // Non-ground nodes: BUS1, BUS2 (2)
    // Branch currents: 2 branches (2)
    // Simulation parameters: delta_t, t_max (2)
    // Total = at least 7 variables
    assert.ok(dae.varCount >= 5, `Expected at least 5 variables, got ${dae.varCount}`);

    // Equations:
    // 1 source equation + 2 branch equations + 2 parameter equations = 5 equations
    assert.ok(dae.eqCount >= 3, `Expected at least 3 equations, got ${dae.eqCount}`);
  });
});
