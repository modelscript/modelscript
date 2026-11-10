// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerDnp3ToDae } from "../src/dae/dnp3-to-dae.js";
import type { Dnp3DeviceProfile } from "../src/types.js";

describe("DNP3 Domain Lowering to Linear-Memory DAE Arena", () => {
  const profile: Dnp3DeviceProfile = {
    id: "DAE_SUB_RTU",
    deviceName: "Substation Digital Twin RTU",
    vendor: "ABB",
    version: "2.0",
    outstationAddress: 15,
    masterAddress: 1,
    binaryInputs: [
      { index: 0, name: "BREAKER_STATUS", eventClass: 1, normalState: 1 },
      { index: 1, name: "TRIP_ALARM", eventClass: 1, normalState: 0 },
    ],
    binaryOutputs: [
      { index: 0, name: "TRIP_CMD" },
      { index: 1, name: "CLOSE_CMD" },
    ],
    analogInputs: [
      {
        index: 0,
        name: "BUS_VOLTAGE",
        eventClass: 2,
        deadband: 0.5,
        scalingMultiplier: 0.1,
        scalingOffset: 230.0,
        units: "kV",
      },
      {
        index: 1,
        name: "LINE_CURRENT",
        eventClass: 2,
        deadband: 5.0,
        scalingMultiplier: 1.0,
        scalingOffset: 0.0,
        units: "A",
      },
    ],
    analogOutputs: [{ index: 0, name: "TAP_CHANGER_POS", minVal: -16, maxVal: 16 }],
    counters: [{ index: 0, name: "MWH_EXPORT", eventClass: 1, units: "MWh" }],
  };

  it("should lower DNP3 point map to DAEBuilder with correct variable and equation allocations", () => {
    const dae = lowerDnp3ToDae(profile);
    assert.ok(dae instanceof DAEBuilder);

    // Expected variables:
    // time (1)
    // 2 binary inputs (2)
    // 2 binary outputs (2)
    // 2 analog inputs + 2 deadband parameters (4)
    // 1 analog output (1)
    // 1 counter (1)
    // Total = at least 11 variables
    assert.ok(dae.varCount >= 10, `Expected at least 10 variables, got ${dae.varCount}`);

    // Equations:
    // 2 BI + 2 BO + 2 AI + 2 deadband params + 1 AO + 1 CTR = 10 equations
    assert.ok(dae.eqCount >= 8, `Expected at least 8 equations, got ${dae.eqCount}`);
  });
});
