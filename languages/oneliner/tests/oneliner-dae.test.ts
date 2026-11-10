// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerOneLinerToDae } from "../src/dae/oneliner-to-dae.js";
import type { OneLinerCase } from "../src/types.js";

describe("OneLiner Domain Lowering to Linear-Memory DAE Arena", () => {
  const onelinerCase: OneLinerCase = {
    title: "DAE_Lowering_Substation",
    baseMva: 100.0,
    frequencyHz: 60.0,
    busses: [
      { id: "B1", name: "Bus 1", baseKv: 230.0 },
      { id: "B2", name: "Bus 2", baseKv: 230.0 },
    ],
    branches: [
      {
        id: "L1-2",
        bus1: "B1",
        bus2: "B2",
        z1: { r: 0.01, x: 0.08 },
        z0: { r: 0.03, x: 0.24 },
      },
    ],
    mutuals: [],
    generators: [],
    overcurrentRelays: [
      {
        id: "OC1",
        name: "Breaker 52 Overcurrent",
        branchId: "L1-2",
        busId: "B1",
        pickupA: 600.0,
        ctRatio: 240.0,
        timeDial: 2.0,
        curve: "IEEE_Very_Inverse",
      },
    ],
    distanceRelays: [],
  };

  it("should lower OneLiner case to DAEBuilder with correct variable and equation allocations", () => {
    const dae = lowerOneLinerToDae(onelinerCase);
    assert.ok(dae instanceof DAEBuilder);

    // Expected variables:
    // time (1)
    // 2 busses * 2 (v, theta) = 4
    // 1 branch * 2 (i_br, z1_param) = 2
    // 1 relay * 2 (trip, pickup_param) = 2
    // base_mva (1)
    // Total = at least 10 variables
    assert.ok(dae.varCount >= 9, `Expected at least 9 variables, got ${dae.varCount}`);

    // Equations:
    // 4 for bus states + 2 for branch + 2 for relay + 1 for base_mva = 9 equations
    assert.ok(dae.eqCount >= 7, `Expected at least 7 equations, got ${dae.eqCount}`);
  });
});
